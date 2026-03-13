import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import { Camera, CameraView } from "expo-camera";
import type { CameraType } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Contacts from "expo-contacts";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Accelerometer, Barometer, Gyroscope, Magnetometer, Pedometer } from "expo-sensors";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraStream } from "@/components/CameraStream";
import { ChatInput } from "@/components/ChatInput";
import { ContactsShare } from "@/components/ContactsShare";
import { ControlPad } from "@/components/ControlPad";
import { DeviceControls } from "@/components/DeviceControls";
import { FileBrowser } from "@/components/FileBrowser";
import { FileTransferPanel } from "@/components/FileTransferPanel";
import { LocationShare } from "@/components/LocationShare";
import { MacroPad } from "@/components/MacroPad";
import { MessageBubble } from "@/components/MessageBubble";
import { NetworkInfo } from "@/components/NetworkInfo";
import { ScreenCapture } from "@/components/ScreenCapture";
import { SensorLogger } from "@/components/SensorLogger";
import { SessionLog } from "@/components/SessionLog";
import { StatusDot } from "@/components/StatusDot";
import { TextToSpeech } from "@/components/TextToSpeech";
import { VoiceWalkie } from "@/components/VoiceWalkie";
import { WebRTCCall } from "@/components/WebRTCCall";
import { WhiteboardPanel } from "@/components/WhiteboardPanel";
import { RemoteCommander } from "@/components/RemoteCommander";
import { DeviceDashboard } from "@/components/DeviceDashboard";
import Colors from "@/constants/colors";
import { useSkyLink } from "@/context/SkyLinkContext";
import { useTransfer } from "@/context/TransferContext";
import type { Message } from "@/context/SkyLinkContext";

type TabKey =
  | "chat" | "voice" | "call" | "files" | "browse"
  | "camera" | "board" | "location" | "controls"
  | "sensors" | "contacts" | "network" | "tts"
  | "macro" | "capture" | "log" | "remote" | "info"
  | "commander" | "dashboard";

const ALL_TABS: { key: TabKey; icon: keyof typeof Feather.glyphMap; label: string; skyOnly?: boolean }[] = [
  { key: "chat",     icon: "message-circle", label: "Chat" },
  { key: "voice",    icon: "mic",            label: "Voice" },
  { key: "call",     icon: "phone",          label: "Call" },
  { key: "files",    icon: "send",           label: "Send" },
  { key: "browse",   icon: "folder",         label: "Browse" },
  { key: "camera",   icon: "video",          label: "Camera" },
  { key: "board",    icon: "edit-3",         label: "Board" },
  { key: "location", icon: "map-pin",        label: "GPS" },
  { key: "controls", icon: "sliders",        label: "Controls" },
  { key: "sensors",  icon: "activity",       label: "Sensors" },
  { key: "contacts", icon: "users",          label: "Contacts" },
  { key: "network",  icon: "wifi",           label: "Network" },
  { key: "tts",      icon: "volume-2",       label: "Speak" },
  { key: "macro",    icon: "grid",           label: "Macros" },
  { key: "capture",  icon: "camera",         label: "Screen" },
  { key: "log",      icon: "list",           label: "Log" },
  { key: "commander", icon: "command",       label: "Command", skyOnly: true },
  { key: "dashboard", icon: "cpu",           label: "Device" },
  { key: "remote",    icon: "terminal",      label: "Remote", skyOnly: true },
  { key: "info",      icon: "info",          label: "Info" },
];

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}

export default function SessionScreen() {
  const insets = useSafeAreaInsets();
  const { role, roomId, peerName, disconnect } = useSkyLink();
  const {
    socketConnected, peerPresent,
    wsUrl, lastError,
    connectToRoom, disconnectFromRoom,
    sendChatMessage, onMessageReceived,
    sendControl, onControlReceived,
    transfers, emitEvent, onEvent, sendFile,
  } = useTransfer();

  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const hasConnectedRef = useRef(false);

  // ── Global walkie-talkie audio (plays on any tab) ─────────────────────────
  const [peerSpeaking, setPeerSpeaking] = useState(false);
  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const peerSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Camera remote control state (Sky navigates + auto-starts Link's camera) ─
  const [cameraAutoStart, setCameraAutoStart] = useState(false);
  const [cameraExternalFacing, setCameraExternalFacing] = useState<CameraType | undefined>(undefined);

  // ── Global Link-side command state (works on any tab) ────────────────────
  const [linkTorchOn, setLinkTorchOn] = useState(false);
  const [linkKeepAwakeOn, setLinkKeepAwakeOn] = useState(false);
  const [linkCameraMode, setLinkCameraMode] = useState<"off" | "front" | "back">("off");
  const [linkPhotoReady, setLinkPhotoReady] = useState(false);
  const [linkAlertVisible, setLinkAlertVisible] = useState(false);
  const [linkAlertContent, setLinkAlertContent] = useState({ title: "", message: "" });
  const [cmdToast, setCmdToast] = useState<string | null>(null);
  const linkCameraRef = useRef<CameraView>(null);
  const pendingPhotoCmdRef = useRef<string>("");
  const cmdToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topInset = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;
  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;
  const isPeerConn = peerPresent;

  const addMessage = useCallback((
    type: Message["type"], content: string, sender: Message["sender"], extras?: Partial<Message>
  ) => {
    setMessages(prev => [{ id: generateId(), type, content, sender, timestamp: Date.now(), ...extras }, ...prev]);
  }, []);

  // ── Connect on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !role || hasConnectedRef.current) return;
    hasConnectedRef.current = true;
    connectToRoom(roomId, role, isSky ? "Sky Controller" : "Link Device");
    addMessage("system", `Session ${roomId} started.`, "system");
  }, [roomId, role]);

  useEffect(() => onMessageReceived(msg => addMessage("text", msg.content, "peer")), [onMessageReceived, addMessage]);
  useEffect(() => onControlReceived(cmd => addMessage("control", `Received: ${cmd.command}`, "peer", { controlCommand: cmd.command })), [onControlReceived, addMessage]);

  const prevPeerRef = useRef(false);
  useEffect(() => {
    if (peerPresent && !prevPeerRef.current) {
      addMessage("system", `${isSky ? "Link" : "Sky"} connected.`, "system");
    } else if (!peerPresent && prevPeerRef.current) {
      addMessage("system", `${isSky ? "Link" : "Sky"} disconnected.`, "system");
    }
    prevPeerRef.current = peerPresent;
  }, [peerPresent]);

  // ── Global audio listener — plays walkie-talkie audio on ANY tab ──────────
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true }).catch(() => {});

    const unsub = onEvent("audio-chunk", async (data: { chunk: string }) => {
      try {
        if (audioSoundRef.current) {
          await audioSoundRef.current.unloadAsync();
          audioSoundRef.current = null;
        }
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:audio/m4a;base64,${data.chunk}` },
          { shouldPlay: true, volume: 1.0 }
        );
        audioSoundRef.current = sound;
        setPeerSpeaking(true);
        if (peerSpeakingTimerRef.current) clearTimeout(peerSpeakingTimerRef.current);
        peerSpeakingTimerRef.current = setTimeout(() => setPeerSpeaking(false), 2500);
        sound.setOnPlaybackStatusUpdate((s) => {
          if ("didJustFinish" in s && s.didJustFinish) {
            setPeerSpeaking(false);
            sound.unloadAsync().catch(() => {});
          }
        });
      } catch {}
    });

    return () => {
      unsub();
      audioSoundRef.current?.unloadAsync().catch(() => {});
      if (peerSpeakingTimerRef.current) clearTimeout(peerSpeakingTimerRef.current);
    };
  }, [onEvent]);

  // ── Camera request stream — navigate + auto-start streaming ───────────────
  useEffect(() => {
    const unsub = onEvent("camera-request-stream", () => {
      setActiveTab("camera");
      setCameraAutoStart(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    return () => unsub();
  }, [onEvent]);

  // ── Camera remote facing switch from this device ──────────────────────────
  useEffect(() => {
    const unsub = onEvent("camera-switch-facing", () => {
      setCameraExternalFacing(f => f === "front" ? "back" : "front");
    });
    return () => unsub();
  }, [onEvent]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showCmdToast = useCallback((msg: string) => {
    setCmdToast(msg);
    if (cmdToastTimerRef.current) clearTimeout(cmdToastTimerRef.current);
    cmdToastTimerRef.current = setTimeout(() => setCmdToast(null), 3000);
  }, []);

  // ── Link camera: take photo when camera is ready ──────────────────────────
  useEffect(() => {
    if (!linkPhotoReady || linkCameraMode === "off") return;
    const cmd = pendingPhotoCmdRef.current;
    const t = setTimeout(async () => {
      try {
        const photo = await linkCameraRef.current?.takePictureAsync({
          quality: 0.35, base64: true, skipProcessing: true, shutterSound: false,
        } as Parameters<CameraView["takePictureAsync"]>[0]);
        if (photo?.base64) {
          emitEvent("commander-response", { command: cmd, timestamp: Date.now(), data: { size: `${Math.round(photo.base64.length / 1024)}KB` }, imageBase64: photo.base64 });
          showCmdToast("Photo captured and sent");
        }
      } catch {
        emitEvent("commander-response", { command: cmd, timestamp: Date.now(), data: { error: "Capture failed" } });
      } finally {
        setLinkCameraMode("off");
        setLinkPhotoReady(false);
        pendingPhotoCmdRef.current = "";
      }
    }, 400);
    return () => clearTimeout(t);
  }, [linkPhotoReady, linkCameraMode, emitEvent, showCmdToast]);

  // ── GLOBAL Link-side command handler (fires on ANY active tab) ────────────
  useEffect(() => {
    if (isSky) return; // Sky does not execute commands

    type CmdPayload = { command: string; value?: string | number | boolean; pattern?: number[]; message?: string };

    const unsub = onEvent("remote-command", async (data: CmdPayload) => {
      const { command, value, pattern, message } = data;

      const respond = (d: Record<string, string | number | boolean | null>, extra?: object) =>
        emitEvent("commander-response", { command, timestamp: Date.now(), data: d, ...extra });

      // ── Torch ────────────────────────────────────────────────────────────
      if (command === "TORCH_ON")  { setLinkTorchOn(true); showCmdToast("Torch on"); }
      if (command === "TORCH_OFF") { setLinkTorchOn(false); showCmdToast("Torch off"); }

      // ── Keep Awake ───────────────────────────────────────────────────────
      if (command === "KEEP_AWAKE_ON")  { KeepAwake.activateKeepAwakeAsync("skylink"); setLinkKeepAwakeOn(true); showCmdToast("Keep awake enabled"); }
      if (command === "KEEP_AWAKE_OFF") { KeepAwake.deactivateKeepAwake("skylink"); setLinkKeepAwakeOn(false); }

      // ── Brightness ───────────────────────────────────────────────────────
      if (command === "BRIGHTNESS" && typeof value === "number") { try { await Brightness.setBrightnessAsync(value); } catch {} }
      if (command === "BRIGHTNESS_UP")   { try { const c = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.min(1, c + 0.2)); } catch {} }
      if (command === "BRIGHTNESS_DOWN") { try { const c = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.max(0, c - 0.2)); } catch {} }
      if (command === "BRIGHTNESS_MAX")  { try { await Brightness.setBrightnessAsync(1); } catch {} }
      if (command === "BRIGHTNESS_OFF")  { try { await Brightness.setBrightnessAsync(0); } catch {} }

      // ── Haptics ──────────────────────────────────────────────────────────
      if (command === "HAPTIC_SUCCESS") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (command === "HAPTIC_ERROR")   Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (command === "HAPTIC_LIGHT")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (command === "HAPTIC_HEAVY")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      // ── Vibration ────────────────────────────────────────────────────────
      if (command === "VIBRATE_PATTERN" && pattern) Vibration.vibrate(pattern);
      if (command === "VIBRATE_STOP")  Vibration.cancel();

      // ── Full-screen alert overlay ─────────────────────────────────────────
      if (command === "SHOW_ALERT" && message) {
        setLinkAlertContent({ title: "Message from Sky", message });
        setLinkAlertVisible(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Vibration.vibrate([0, 200, 100, 200]);
      }

      // ── Local notification (lock screen) ─────────────────────────────────
      if (command === "LOCAL_NOTIFICATION") {
        await Notifications.scheduleNotificationAsync({
          content: { title: (value as string) || "SkyLink Alert", body: message || "Message from Sky", sound: true },
          trigger: null,
        });
        showCmdToast("Notification sent to lock screen");
      }

      // ── Emergency ────────────────────────────────────────────────────────
      if (command === "PHONE_FINDER") {
        setLinkTorchOn(true);
        Vibration.vibrate([0,200,100,200,100,200,100,200,100,1000], true);
        try { await Brightness.setBrightnessAsync(1); } catch {}
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showCmdToast("Phone Finder — ACTIVE");
        setTimeout(() => { Vibration.cancel(); setLinkTorchOn(false); }, 10000);
      }
      if (command === "STOP_FINDER") { Vibration.cancel(); setLinkTorchOn(false); showCmdToast("Finder stopped"); }

      // ── Visual effects ────────────────────────────────────────────────────
      if (command === "FLASHBANG") {
        try { const p = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(1); showCmdToast("Flashbang!"); setTimeout(async () => { try { await Brightness.setBrightnessAsync(p); } catch {} }, 3000); } catch {}
      }
      if (command === "STROBE_TORCH") {
        showCmdToast("Strobe torch");
        for (let i = 0; i < 12; i++) setTimeout(() => setLinkTorchOn(i % 2 === 0), i * 150);
        setTimeout(() => setLinkTorchOn(false), 12 * 150 + 50);
      }
      if (command === "SCREEN_PULSE") {
        try { const p = await Brightness.getBrightnessAsync(); for (let i = 0; i < 6; i++) setTimeout(async () => { try { await Brightness.setBrightnessAsync(i % 2 === 0 ? 1 : 0.05); } catch {} }, i * 300); setTimeout(async () => { try { await Brightness.setBrightnessAsync(p); } catch {} }, 1800); } catch {}
      }

      // ── Clipboard ────────────────────────────────────────────────────────
      if (command === "READ_CLIPBOARD") {
        const text = await Clipboard.getStringAsync();
        respond({ text: text || "(clipboard empty)" });
        showCmdToast("Clipboard read and sent");
      }
      if (command === "WRITE_CLIPBOARD" && typeof value === "string") {
        await Clipboard.setStringAsync(value);
        respond({ written: value.slice(0, 60) });
        showCmdToast("Clipboard updated");
      }

      // ── Text-to-Speech ───────────────────────────────────────────────────
      if (command === "SPEAK_TEXT" && typeof message === "string") {
        Speech.stop();
        Speech.speak(message, { rate: 0.9, pitch: 1.0 });
        showCmdToast(`Speaking: "${message.slice(0, 40)}${message.length > 40 ? "…" : ""}"`);
      }
      if (command === "STOP_SPEECH") { Speech.stop(); }

      // ── Open URL ─────────────────────────────────────────────────────────
      if (command === "OPEN_URL" && typeof value === "string") {
        try { await WebBrowser.openBrowserAsync(value); showCmdToast(`Opening ${value.slice(0, 30)}…`); } catch {}
      }

      // ── Phone actions ─────────────────────────────────────────────────────
      if (command === "DIAL_NUMBER" && typeof value === "string") {
        const url = `tel:${value}`;
        const can = await Linking.canOpenURL(url);
        if (can) { await Linking.openURL(url); respond({ dialing: value }); showCmdToast(`Dialing ${value}`); }
        else respond({ error: "Cannot open dialer" });
      }
      if (command === "COMPOSE_SMS" && typeof value === "string") {
        const body = encodeURIComponent(message || "");
        const url = `sms:${value}${body ? `?body=${body}` : ""}`;
        const can = await Linking.canOpenURL(url);
        if (can) { await Linking.openURL(url); respond({ to: value }); showCmdToast(`Opening SMS to ${value}`); }
        else respond({ error: "Cannot open SMS" });
      }
      if (command === "COMPOSE_EMAIL") {
        const to = typeof value === "string" ? value : "";
        const parts = message?.split("||") ?? [];
        const url = `mailto:${to}?subject=${encodeURIComponent(parts[0] ?? "")}&body=${encodeURIComponent(parts[1] ?? "")}`;
        try { await Linking.openURL(url); respond({ to }); showCmdToast(`Opening email to ${to}`); }
        catch { respond({ error: "Cannot open email" }); }
      }

      // ── Remote camera capture ─────────────────────────────────────────────
      if (command === "TAKE_SELFIE") {
        const { granted } = await Camera.requestCameraPermissionsAsync();
        if (!granted) { respond({ error: "Camera permission denied" }); return; }
        pendingPhotoCmdRef.current = command;
        setLinkCameraMode("front");
        showCmdToast("Taking selfie…");
      }
      if (command === "TAKE_BACK_PHOTO") {
        const { granted } = await Camera.requestCameraPermissionsAsync();
        if (!granted) { respond({ error: "Camera permission denied" }); return; }
        pendingPhotoCmdRef.current = command;
        setLinkCameraMode("back");
        showCmdToast("Taking back photo…");
      }

      // ── Ambient audio recording ───────────────────────────────────────────
      if (command === "RECORD_AMBIENT_3S") {
        try {
          const { granted } = await Audio.requestPermissionsAsync();
          if (!granted) { respond({ error: "Mic permission denied" }); return; }
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          showCmdToast("Recording 3s ambient audio…");
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
            respond({ duration: "3s", size: `${Math.round(base64.length / 1024)}KB` }, { audioBase64: base64 });
            showCmdToast("Ambient audio sent");
          }
        } catch { respond({ error: "Recording failed" }); }
      }

      // ── Media Library ─────────────────────────────────────────────────────
      if (command === "GET_PHOTO_COUNT") {
        try {
          const { granted } = await MediaLibrary.requestPermissionsAsync();
          if (!granted) { respond({ error: "Permission denied" }); return; }
          const p = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1 });
          const v = await MediaLibrary.getAssetsAsync({ mediaType: "video", first: 1 });
          respond({ photos: p.totalCount, videos: v.totalCount, total: p.totalCount + v.totalCount });
        } catch { respond({ error: "Media Library unavailable" }); }
      }
      if (command === "GET_RECENT_PHOTOS") {
        try {
          const { granted } = await MediaLibrary.requestPermissionsAsync();
          if (!granted) { respond({ error: "Permission denied" }); return; }
          const result = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 8, sortBy: [["creationTime", false]] });
          respond({ count: result.assets.length, files: result.assets.map(a => `${a.filename} (${new Date(a.creationTime).toLocaleDateString()})`).join(" | ") });
        } catch { respond({ error: "Media Library unavailable" }); }
      }
      if (command === "GET_ALBUMS") {
        try {
          const { granted } = await MediaLibrary.requestPermissionsAsync();
          if (!granted) { respond({ error: "Permission denied" }); return; }
          const albums = await MediaLibrary.getAlbumsAsync();
          respond({ count: albums.length, albums: albums.slice(0, 8).map(a => `${a.title}(${a.assetCount})`).join(" · ") });
        } catch { respond({ error: "Albums unavailable" }); }
      }

      // ── Contacts ─────────────────────────────────────────────────────────
      if (command === "GET_CONTACT_COUNT") {
        try {
          const { granted } = await Contacts.requestPermissionsAsync();
          if (!granted) { respond({ error: "Permission denied" }); return; }
          const r = await Contacts.getContactsAsync({ fields: [] });
          respond({ totalContacts: r.total ?? r.data.length });
        } catch { respond({ error: "Contacts unavailable" }); }
      }
      if (command === "GET_RECENT_CONTACTS") {
        try {
          const { granted } = await Contacts.requestPermissionsAsync();
          if (!granted) { respond({ error: "Permission denied" }); return; }
          const r = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Name], pageSize: 10 });
          respond({ contacts: r.data.slice(0, 10).map(c => c.name ?? "Unknown").join(" · "), shown: Math.min(10, r.data.length) });
        } catch { respond({ error: "Contacts unavailable" }); }
      }

      // ── Device Info ───────────────────────────────────────────────────────
      if (command === "GET_DEVICE_INFO") {
        respond({ brand: Device.brand ?? "—", model: Device.modelName ?? "—", os: Device.osName ?? "—", osVersion: Device.osVersion ?? "—" });
      }
      if (command === "GET_BATTERY") {
        try {
          const level = await Battery.getBatteryLevelAsync();
          const state = await Battery.getBatteryStateAsync();
          const low = await Battery.isLowPowerModeEnabledAsync();
          respond({ level: `${Math.round(level * 100)}%`, state: ["Unknown","Discharging","Charging","Full","Unknown"][state] ?? "Unknown", lowPower: low ? "On" : "Off" });
        } catch { respond({ error: "Battery unavailable" }); }
      }
      if (command === "GET_NETWORK") {
        try {
          const net = await Network.getNetworkStateAsync();
          const ip = await Network.getIpAddressAsync();
          respond({ type: net.type ?? "unknown", ip: ip ?? "—", internet: net.isInternetReachable ? "Yes" : "No" });
        } catch { respond({ error: "Network unavailable" }); }
      }
      if (command === "GET_TIME") {
        const now = new Date();
        respond({ time: now.toLocaleTimeString(), date: now.toLocaleDateString(), tz: `UTC${(-now.getTimezoneOffset() / 60) >= 0 ? "+" : ""}${(-now.getTimezoneOffset() / 60).toFixed(0)}` });
      }
      if (command === "GET_BRIGHTNESS") {
        try { respond({ brightness: `${Math.round((await Brightness.getBrightnessAsync()) * 100)}%` }); }
        catch { respond({ error: "Not available" }); }
      }
      if (command === "GET_STORAGE") {
        try {
          const FS = FileSystem as any;
          const free = await FS.getFreeDiskStorageAsync();
          const total = await FS.getTotalDiskCapacityAsync();
          const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
          respond({ free: gb(free), total: gb(total), used: gb(total - free), pct: `${Math.round(((total - free) / total) * 100)}% used` });
        } catch { respond({ error: "Not available" }); }
      }

      // ── Location ──────────────────────────────────────────────────────────
      if (command === "GET_LOCATION") {
        try {
          const { granted } = await Location.requestForegroundPermissionsAsync();
          if (!granted) { respond({ error: "Permission denied" }); return; }
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          const place = geo[0] ? `${geo[0].city ?? ""}, ${geo[0].country ?? ""}`.trim() : "—";
          respond({ lat: loc.coords.latitude.toFixed(5), lng: loc.coords.longitude.toFixed(5), accuracy: `±${loc.coords.accuracy?.toFixed(0) ?? "?"}m`, place });
        } catch { respond({ error: "Location unavailable" }); }
      }

      // ── Sensors ───────────────────────────────────────────────────────────
      if (command === "GET_ACCELEROMETER") {
        const sub = Accelerometer.addListener(d => { sub.remove(); respond({ x: d.x.toFixed(3), y: d.y.toFixed(3), z: d.z.toFixed(3), g: Math.sqrt(d.x**2+d.y**2+d.z**2).toFixed(3) }); });
        Accelerometer.setUpdateInterval(100);
      }
      if (command === "GET_GYROSCOPE") {
        const sub = Gyroscope.addListener(d => { sub.remove(); respond({ x: d.x.toFixed(3), y: d.y.toFixed(3), z: d.z.toFixed(3) }); });
        Gyroscope.setUpdateInterval(100);
      }
      if (command === "GET_MAGNETOMETER") {
        try {
          const sub = Magnetometer.addListener(d => {
            sub.remove();
            const h = Math.atan2(d.y, d.x) * (180 / Math.PI);
            respond({ x: d.x.toFixed(1), y: d.y.toFixed(1), z: d.z.toFixed(1), heading: `${h.toFixed(1)}°`, direction: ["N","NE","E","SE","S","SW","W","NW"][Math.round(((h + 360) % 360) / 45) % 8] });
          });
          Magnetometer.setUpdateInterval(100);
        } catch { respond({ error: "Magnetometer unavailable" }); }
      }
      if (command === "GET_BAROMETER") {
        try {
          const sub = Barometer.addListener(d => {
            sub.remove();
            const alt = 44330 * (1 - Math.pow(d.pressure / 1013.25, 0.1903));
            respond({ pressure: `${d.pressure.toFixed(1)} hPa`, altEstimate: `~${alt.toFixed(0)} m` });
          });
          Barometer.setUpdateInterval(100);
        } catch { respond({ error: "Barometer unavailable" }); }
      }
      if (command === "GET_PEDOMETER") {
        try {
          const avail = await Pedometer.isAvailableAsync();
          if (!avail) { respond({ error: "Pedometer not available" }); return; }
          const now = new Date(); const midnight = new Date(now); midnight.setHours(0,0,0,0);
          const r = await Pedometer.getStepCountAsync(midnight, now);
          respond({ stepsToday: r.steps, distance: `~${(r.steps * 0.762).toFixed(0)} m` });
        } catch { respond({ error: "Step count unavailable" }); }
      }

      // ── Ping ─────────────────────────────────────────────────────────────
      if (command === "PING") respond({ pong: "OK", ts: Date.now() });

      // ── Permissions audit ─────────────────────────────────────────────────
      if (command === "GET_PERMISSIONS") {
        const results: Record<string, string> = {};
        try { results.camera = (await Camera.getCameraPermissionsAsync()).status; } catch {}
        try { results.microphone = (await Audio.getPermissionsAsync()).status; } catch {}
        try { results.location = (await Location.getForegroundPermissionsAsync()).status; } catch {}
        try { results.contacts = (await Contacts.getPermissionsAsync()).status; } catch {}
        try { results.mediaLibrary = (await MediaLibrary.getPermissionsAsync()).status; } catch {}
        try { results.notifications = (await Notifications.getPermissionsAsync()).status; } catch {}
        respond(results);
      }
    });

    return () => {
      unsub();
      Vibration.cancel();
      KeepAwake.deactivateKeepAwake("skylink");
      if (cmdToastTimerRef.current) clearTimeout(cmdToastTimerRef.current);
    };
  }, [isSky, onEvent, emitEvent, showCmdToast]);

  // ── Peer browse-files request: respond with our local SkyLink cache ────────
  useEffect(() => {
    const unsub = onEvent("browse-files-request", async (data: { requestId: string }) => {
      try {
        const FS = FileSystem as any;
        const dir = FS.cacheDirectory + "skylink/";
        await FS.makeDirectoryAsync(dir, { intermediates: true });
        const names: string[] = await FS.readDirectoryAsync(dir);
        const files = await Promise.all(names.map(async (name: string) => {
          const info = await FS.getInfoAsync(dir + name, { size: true });
          return { name, size: info.size ?? 0, modTime: info.modificationTime ?? 0 };
        }));
        emitEvent("browse-files-response", { requestId: data.requestId, files });
      } catch {
        emitEvent("browse-files-response", { requestId: data.requestId, files: [] });
      }
    });
    return () => unsub();
  }, [onEvent, emitEvent]);

  // ── Peer file-fetch request: send the requested file ──────────────────────
  useEffect(() => {
    const unsub = onEvent("file-fetch-request", async (data: { name: string; requestId: string }) => {
      try {
        const FS = FileSystem as any;
        const uri = FS.cacheDirectory + "skylink/" + data.name;
        const info = await FS.getInfoAsync(uri, { size: true });
        if (!info.exists) {
          emitEvent("file-fetch-error", { requestId: data.requestId, error: "File not found" });
          return;
        }
        await sendFile(uri, data.name, info.size ?? 0, "application/octet-stream");
      } catch (e) {
        emitEvent("file-fetch-error", { requestId: data.requestId, error: "Failed to send" });
      }
    });
    return () => unsub();
  }, [onEvent, emitEvent, sendFile]);

  const handleRetry = useCallback(() => {
    if (!roomId || !role) return;
    hasConnectedRef.current = false;
    connectToRoom(roomId, role, isSky ? "Sky Controller" : "Link Device");
    addMessage("system", "Retrying connection...", "system");
    hasConnectedRef.current = true;
  }, [roomId, role, isSky, connectToRoom, addMessage]);

  const handleSendMessage = useCallback((content: string) => {
    sendChatMessage(content);
    addMessage("text", content, "self");
  }, [sendChatMessage, addMessage]);

  const handleSendControl = useCallback((command: string) => {
    sendControl(command);
    addMessage("control", `Sent: ${command}`, "self", { controlCommand: command });
  }, [sendControl, addMessage]);

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "End this SkyLink session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect", style: "destructive",
        onPress: () => { disconnectFromRoom(); disconnect(); router.replace("/"); },
      },
    ]);
  };

  const visibleTabs = ALL_TABS.filter(t => !t.skyOnly || isSky);

  const statusText = !socketConnected
    ? "Connecting to server..."
    : isPeerConn
      ? `${peerName ?? (isSky ? "Link" : "Sky")} connected`
      : "Waiting for peer to join...";
  const connStatus = !socketConnected ? "error" : isPeerConn ? "connected" : "connecting";

  return (
    <View style={[styles.root, { paddingTop: topInset }]}>
      <LinearGradient colors={["#060C1A", "#0A0E1A", "#060C1A"]} style={StyleSheet.absoluteFill} />

      {/* Hidden camera — serves Link-side torch & remote photo capture */}
      {!isSky && (linkTorchOn || linkCameraMode !== "off") && (
        <CameraView
          ref={linkCameraRef}
          style={{ width: 1, height: 1, position: "absolute", opacity: 0 }}
          enableTorch={linkTorchOn}
          facing={linkCameraMode === "off" ? "back" : linkCameraMode}
          onCameraReady={() => { if (linkCameraMode !== "off") setLinkPhotoReady(true); }}
        />
      )}

      {/* Full-screen alert modal (Link side) */}
      {!isSky && (
        <Modal visible={linkAlertVisible} animationType="fade" statusBarTranslucent>
          <View style={styles.alertOverlay}>
            <LinearGradient colors={["#1A0008", "#0A0E1A"]} style={StyleSheet.absoluteFill} />
            <Feather name="alert-circle" size={56} color={Colors.danger} />
            <Text style={styles.alertTitle}>{linkAlertContent.title}</Text>
            <Text style={styles.alertMessage}>{linkAlertContent.message}</Text>
            <Pressable
              onPress={() => { setLinkAlertVisible(false); Vibration.cancel(); }}
              style={styles.alertDismiss}
            >
              <Text style={styles.alertDismissText}>Dismiss</Text>
            </Pressable>
          </View>
        </Modal>
      )}

      {/* Command toast — shows executed command on any tab */}
      {!isSky && cmdToast && (
        <View style={styles.cmdToast} pointerEvents="none">
          <Feather name="terminal" size={12} color={Colors.accent} />
          <Text style={styles.cmdToastText} numberOfLines={1}>{cmdToast}</Text>
        </View>
      )}

      {/* Nav Bar */}
      <View style={styles.navBar}>
        <Pressable onPress={handleDisconnect} style={styles.endBtn} hitSlop={12}>
          <Feather name="x" size={20} color={Colors.danger} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>{isSky ? "Sky" : "Link"} · {roomId}</Text>
          <View style={styles.statusRow}>
            <StatusDot status={connStatus} size={6} />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        </View>
        <View style={[styles.rolePill, { backgroundColor: accentColor + "22", borderColor: accentColor + "55" }]}>
          <Text style={[styles.roleText, { color: accentColor }]}>{isSky ? "SKY" : "LINK"}</Text>
        </View>
      </View>

      {/* Server not connected banner */}
      {!socketConnected && (
        <Pressable onPress={handleRetry} style={styles.retryBanner}>
          <Feather name="wifi-off" size={14} color={Colors.warning} />
          <Text style={styles.retryText}>Not connected to server — tap to retry</Text>
          <Feather name="refresh-cw" size={14} color={Colors.warning} />
        </Pressable>
      )}

      {/* Peer speaking overlay — visible on any tab */}
      {peerSpeaking && activeTab !== "voice" && (
        <View style={styles.speakingToast}>
          <Feather name="volume-2" size={14} color={Colors.accent} />
          <Text style={styles.speakingToastText}>Peer is speaking</Text>
        </View>
      )}

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
        {visibleTabs.map(tab => (
          <Pressable
            key={tab.key}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(tab.key); }}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          >
            <Feather name={tab.icon} size={14} color={activeTab === tab.key ? accentColor : Colors.textSecondary} />
            <Text style={[styles.tabLabel, activeTab === tab.key && { color: accentColor }]}>{tab.label}</Text>
            {activeTab === tab.key && <View style={[styles.tabIndicator, { backgroundColor: accentColor }]} />}
          </Pressable>
        ))}
      </ScrollView>

      {/* Chat */}
      {activeTab === "chat" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="message-circle" size={40} color={Colors.textSecondary} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyDesc}>{isPeerConn ? "Start the conversation!" : "Waiting for peer to connect..."}</Text>
            </View>
          ) : (
            <FlatList
              data={messages}
              keyExtractor={item => item.id}
              renderItem={({ item }) => <MessageBubble message={item} />}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              inverted
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
            />
          )}
          <View style={{ paddingBottom: bottomInset }}>
            <ChatInput onSend={handleSendMessage} disabled={!isPeerConn} placeholder={isPeerConn ? "Message..." : "Waiting for peer..."} />
          </View>
        </KeyboardAvoidingView>
      )}

      {activeTab === "voice" && (
        <VoiceWalkie peerConnected={isPeerConn} bottomInset={bottomInset} peerSpeaking={peerSpeaking} />
      )}
      {activeTab === "call"     && <WebRTCCall        role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "files"    && <FileTransferPanel peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "browse"   && <FileBrowser       peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "camera"   && (
        <CameraStream
          peerConnected={isPeerConn}
          bottomInset={bottomInset}
          autoStart={cameraAutoStart}
          externalFacing={cameraExternalFacing}
          onAutoStartDone={() => setCameraAutoStart(false)}
        />
      )}
      {activeTab === "board"    && <WhiteboardPanel   peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "location" && <LocationShare     peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "controls" && <DeviceControls    role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "sensors"  && <SensorLogger      peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "contacts" && <ContactsShare     peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "network"  && <NetworkInfo       peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "tts"      && <TextToSpeech      role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "macro"    && <MacroPad          role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "capture"  && <ScreenCapture     role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "log"       && <SessionLog        role={role ?? "link"} roomId={roomId ?? ""} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "commander" && (
        <RemoteCommander
          role={role ?? "link"}
          peerConnected={isPeerConn}
          bottomInset={bottomInset}
          linkTorchOn={linkTorchOn}
          linkKeepAwakeOn={linkKeepAwakeOn}
          linkCameraReady={linkCameraMode !== "off"}
        />
      )}
      {activeTab === "dashboard" && <DeviceDashboard   role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}

      {/* Remote (Sky only) */}
      {activeTab === "remote" && isSky && (
        <ScrollView contentContainerStyle={[styles.scrollPad, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          {!isPeerConn && (
            <View style={styles.warnBanner}>
              <Feather name="alert-circle" size={16} color={Colors.warning} />
              <Text style={styles.warnText}>Controls disabled until Link connects</Text>
            </View>
          )}
          <Text style={styles.sectionTitle}>Remote Control Pad</Text>
          <Text style={styles.sectionDesc}>Send directional commands to the Link device in real time.</Text>
          <ControlPad onCommand={handleSendControl} disabled={!isPeerConn} />
        </ScrollView>
      )}

      {/* Info */}
      {activeTab === "info" && (
        <ScrollView contentContainerStyle={[styles.scrollPad, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          <View style={[styles.infoCard, { borderColor: lastError ? Colors.danger : socketConnected ? Colors.success : Colors.warning, borderWidth: 1 }]}>
            <Text style={styles.infoCardTitle}>Connection Diagnostics</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Relay URL</Text>
              <Text style={[styles.infoValue, { flex: 1, flexWrap: "wrap", fontSize: 10 }]}>{wsUrl}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={[styles.infoValue, { color: socketConnected ? Colors.success : Colors.danger }]}>
                {socketConnected ? "CONNECTED" : "DISCONNECTED"}
              </Text>
            </View>
            {lastError && (
              <View style={[styles.infoRow, { marginTop: 4 }]}>
                <Text style={[styles.infoLabel, { color: Colors.danger }]}>Last Error</Text>
                <Text style={[styles.infoValue, { color: Colors.danger, flex: 1, flexWrap: "wrap", fontSize: 11 }]}>{lastError}</Text>
              </View>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>Session Details</Text>
            {[
              ["Room ID", roomId ?? "—"],
              ["Your Role", isSky ? "Sky (Controller)" : "Link (Device)"],
              ["Peer", peerName ?? "Not connected"],
              ["Socket", socketConnected ? "Connected" : "Offline"],
              ["Peer Present", isPeerConn ? "Yes" : "No"],
              ["Messages", messages.filter(m => m.type === "text").length.toString()],
              ["Transfers", transfers.length.toString()],
            ].map(([label, value]) => (
              <View key={label} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue}>{value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>All 20 Features</Text>
            {[
              ["message-circle", "Real-Time Chat"],
              ["mic",            "Walkie-Talkie (background audio)"],
              ["phone",          "P2P WebRTC Audio/Video Call"],
              ["send",           "File Transfer (Chunked, 64KB)"],
              ["folder",         "File Browser & Peer Files"],
              ["video",          "Live Camera Stream (remote request)"],
              ["edit-3",         "Collaborative Whiteboard"],
              ["map-pin",        "GPS Location Sharing"],
              ["sliders",        "Device Controls (Brightness, Torch, Vibrate)"],
              ["clipboard",      "Clipboard Sync"],
              ["activity",       "Sensor Logger (CSV Export)"],
              ["users",          "Contacts Sharing"],
              ["wifi",           "Network Info & Speed Estimate"],
              ["volume-2",       "Text-to-Speech on Peer Device"],
              ["grid",           "Macro Pad (Custom Command Buttons)"],
              ["camera",         "Remote Screen Capture"],
              ["list",           "Session Log (JSON/CSV Export)"],
              ["battery",        "Device Dashboard (Battery, Storage)"],
              ["command",        "Remote Commander (30+ commands)"],
              ["terminal",       "Remote Control Pad"],
            ].map(([icon, label]) => (
              <View key={label} style={styles.featureRow}>
                <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={accentColor} />
                <Text style={styles.featureLabel}>{label}</Text>
                <Feather name="check" size={12} color={Colors.success} />
              </View>
            ))}
          </View>

          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
            <Feather name="log-out" size={16} color={Colors.danger} />
            <Text style={styles.disconnectText}>End Session</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  alertOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 },
  alertTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.textPrimary, textAlign: "center" },
  alertMessage: { fontFamily: "Inter_400Regular", fontSize: 16, color: Colors.textSecondary, textAlign: "center", lineHeight: 26 },
  alertDismiss: { backgroundColor: Colors.danger, paddingHorizontal: 40, paddingVertical: 14, borderRadius: 50, marginTop: 12 },
  alertDismissText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  cmdToast: {
    position: "absolute", bottom: 90, left: 20, right: 20, zIndex: 999,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.surface + "F0", borderWidth: 1, borderColor: Colors.accent + "55",
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
  },
  cmdToastText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1 },
  navBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 10,
  },
  endBtn: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.danger + "22", borderWidth: 1, borderColor: Colors.danger + "44",
    alignItems: "center", justifyContent: "center",
  },
  navCenter: { flex: 1, alignItems: "center", gap: 4 },
  navTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.textPrimary, letterSpacing: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  rolePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  roleText: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 },
  speakingToast: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.accent + "22", borderBottomWidth: 1, borderBottomColor: Colors.accent + "44",
    paddingHorizontal: 16, paddingVertical: 8,
  },
  speakingToastText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.accent },
  tabsScroll: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface, flexGrow: 0, maxHeight: 48,
  },
  tabsContent: { flexDirection: "row", paddingHorizontal: 4 },
  tab: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 11, gap: 5, position: "relative" },
  tabActive: {},
  tabLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  tabIndicator: { position: "absolute", bottom: 0, left: 6, right: 6, height: 2, borderRadius: 1 },
  messageList: { paddingVertical: 12, gap: 4 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  emptyDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  scrollPad: { padding: 20, gap: 16 },
  warnBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.warning + "22", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.warning + "44",
  },
  warnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.warning, flex: 1 },
  retryBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.warning + "18", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.warning + "33",
  },
  retryText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.warning, flex: 1 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary },
  sectionDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  infoCard: {
    backgroundColor: Colors.surface, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, padding: 20, gap: 4,
  },
  infoCardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary, marginBottom: 12 },
  infoRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  infoLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
  infoValue: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary },
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  featureLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textPrimary, flex: 1 },
  disconnectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: Colors.danger + "22", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.danger + "44",
  },
  disconnectText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.danger },
});
