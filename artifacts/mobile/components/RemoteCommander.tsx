import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import { Camera, CameraView } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import * as Location from "expo-location";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Speech from "expo-speech";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
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

type CommandPayload = {
  command: string;
  value?: string | number | boolean;
  pattern?: number[];
  message?: string;
};

type InfoResponse = {
  command: string;
  data: Record<string, string | number | boolean | null>;
  timestamp: number;
};

interface RemoteCommanderProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

export function RemoteCommander({ role, peerConnected, bottomInset = 0 }: RemoteCommanderProps) {
  const isSky = role === "sky";
  const { emitEvent, onEvent } = useTransfer();

  // Sky state
  const [selectedPattern, setSelectedPattern] = useState("single");
  const [alertMsg, setAlertMsg] = useState("");
  const [notifTitle, setNotifTitle] = useState("SkyLink Alert");
  const [notifBody, setNotifBody] = useState("");
  const [brightness, setBrightness] = useState(0.5);
  const [infoResults, setInfoResults] = useState<InfoResponse[]>([]);
  const [clipboardWrite, setClipboardWrite] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [urlToOpen, setUrlToOpen] = useState("https://");

  // Link state
  const [torchOn, setTorchOn] = useState(false);
  const [keepAwakeOn, setKeepAwakeOn] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", message: "" });
  const cameraRef = useRef<CameraView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    Camera.requestCameraPermissionsAsync();
    Notifications.requestPermissionsAsync();
  }, []);

  // ── LINK: receive and execute commands ─────────────────────────────────────
  useEffect(() => {
    const unsub = onEvent("remote-command", async (data: CommandPayload) => {
      const { command, value, pattern, message } = data;

      // ── TORCH ──────────────────────────────────────────────────────────────
      if (command === "TORCH_ON")  setTorchOn(true);
      if (command === "TORCH_OFF") setTorchOn(false);

      // ── KEEP AWAKE ─────────────────────────────────────────────────────────
      if (command === "KEEP_AWAKE_ON")  { KeepAwake.activateKeepAwakeAsync("skylink"); setKeepAwakeOn(true); }
      if (command === "KEEP_AWAKE_OFF") { KeepAwake.deactivateKeepAwake("skylink"); setKeepAwakeOn(false); }

      // ── BRIGHTNESS ─────────────────────────────────────────────────────────
      if (command === "BRIGHTNESS" && typeof value === "number") { try { await Brightness.setBrightnessAsync(value); } catch {} }
      if (command === "BRIGHTNESS_UP")   { try { const c = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.min(1, c + 0.2)); } catch {} }
      if (command === "BRIGHTNESS_DOWN") { try { const c = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.max(0, c - 0.2)); } catch {} }
      if (command === "BRIGHTNESS_MAX")  { try { await Brightness.setBrightnessAsync(1); } catch {} }
      if (command === "BRIGHTNESS_OFF")  { try { await Brightness.setBrightnessAsync(0); } catch {} }

      // ── HAPTICS ────────────────────────────────────────────────────────────
      if (command === "HAPTIC_SUCCESS") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (command === "HAPTIC_ERROR")   Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (command === "HAPTIC_LIGHT")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (command === "HAPTIC_HEAVY")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      // ── VIBRATION ──────────────────────────────────────────────────────────
      if (command === "VIBRATE_PATTERN" && pattern) { Vibration.vibrate(pattern); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }
      if (command === "VIBRATE_STOP") Vibration.cancel();

      // ── ALERT / NOTIFICATION ───────────────────────────────────────────────
      if (command === "SHOW_ALERT" && message) { setAlertContent({ title: "Message from Sky", message }); setShowAlert(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
      if (command === "LOCAL_NOTIFICATION") {
        await Notifications.scheduleNotificationAsync({
          content: { title: (value as string) || "SkyLink Alert", body: message || "Message from Sky", sound: true },
          trigger: null,
        });
      }

      // ── EMERGENCY ──────────────────────────────────────────────────────────
      if (command === "PHONE_FINDER") {
        setTorchOn(true);
        Vibration.vibrate([0,200,100,200,100,200,100,200,100,1000], true);
        try { await Brightness.setBrightnessAsync(1); } catch {}
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => { Vibration.cancel(); setTorchOn(false); }, 10000);
      }
      if (command === "STOP_FINDER") { Vibration.cancel(); setTorchOn(false); }

      // ── CLIPBOARD ──────────────────────────────────────────────────────────
      if (command === "READ_CLIPBOARD") {
        const text = await Clipboard.getStringAsync();
        emitEvent("commander-response", { command, timestamp: Date.now(), data: { text: text || "(empty)" } });
      }
      if (command === "WRITE_CLIPBOARD" && typeof value === "string") {
        await Clipboard.setStringAsync(value);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        emitEvent("commander-response", { command, timestamp: Date.now(), data: { written: value.slice(0, 40) + (value.length > 40 ? "…" : "") } });
      }

      // ── TEXT-TO-SPEECH ─────────────────────────────────────────────────────
      if (command === "SPEAK_TEXT" && typeof message === "string") {
        Speech.stop();
        Speech.speak(message, { rate: 0.9, pitch: 1.0 });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      if (command === "STOP_SPEECH") { Speech.stop(); }

      // ── OPEN URL ───────────────────────────────────────────────────────────
      if (command === "OPEN_URL" && typeof value === "string") {
        try { await WebBrowser.openBrowserAsync(value); } catch {}
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      // ── INFO QUERIES ───────────────────────────────────────────────────────
      if (command === "GET_DEVICE_INFO") {
        emitEvent("commander-response", { command, timestamp: Date.now(), data: {
          brand: Device.brand ?? "—", model: Device.modelName ?? "—",
          os: Device.osName ?? "—", osVersion: Device.osVersion ?? "—",
          totalMemory: Device.totalMemory ? `${(Device.totalMemory / 1024 / 1024 / 1024).toFixed(1)} GB` : "—",
        }});
      }
      if (command === "GET_BATTERY") {
        try {
          const level = await Battery.getBatteryLevelAsync();
          const state = await Battery.getBatteryStateAsync();
          const low = await Battery.isLowPowerModeEnabledAsync();
          emitEvent("commander-response", { command, timestamp: Date.now(), data: {
            level: `${Math.round(level * 100)}%`,
            charging: state === 2 ? "Yes" : "No",
            full: state === 3 ? "Yes" : "No",
            lowPowerMode: low ? "On" : "Off",
          }});
        } catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } }); }
      }
      if (command === "GET_NETWORK") {
        try {
          const net = await Network.getNetworkStateAsync();
          const ip  = await Network.getIpAddressAsync();
          emitEvent("commander-response", { command, timestamp: Date.now(), data: {
            type: net.type ?? "unknown", ip: ip ?? "—",
            connected: net.isConnected ? "Yes" : "No",
            internet: net.isInternetReachable ? "Yes" : "No",
          }});
        } catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } }); }
      }
      if (command === "GET_TIME") {
        const now = new Date();
        emitEvent("commander-response", { command, timestamp: Date.now(), data: {
          time: now.toLocaleTimeString(), date: now.toLocaleDateString(),
          iso: now.toISOString(), tzOffset: `UTC${-now.getTimezoneOffset() >= 0 ? "+" : ""}${(-now.getTimezoneOffset() / 60).toFixed(0)}`,
        }});
      }
      if (command === "GET_BRIGHTNESS") {
        try { const b = await Brightness.getBrightnessAsync(); emitEvent("commander-response", { command, timestamp: Date.now(), data: { brightness: `${Math.round(b * 100)}%` } }); }
        catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } }); }
      }
      if (command === "GET_STORAGE") {
        try {
          const FS = FileSystem as any;
          const free  = await FS.getFreeDiskStorageAsync();
          const total = await FS.getTotalDiskCapacityAsync();
          const toGB = (b: number) => `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
          emitEvent("commander-response", { command, timestamp: Date.now(), data: {
            free: toGB(free), total: toGB(total), used: toGB(total - free),
            pctFree: `${Math.round((free / total) * 100)}%`,
          }});
        } catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } }); }
      }
      if (command === "GET_LOCATION") {
        try {
          const { granted } = await Location.requestForegroundPermissionsAsync();
          if (!granted) { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Permission denied" } }); return; }
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          const place = geo[0] ? `${geo[0].city ?? ""}, ${geo[0].country ?? ""}`.replace(/(^, )|(, $)/, "") : "—";
          emitEvent("commander-response", { command, timestamp: Date.now(), data: {
            lat: loc.coords.latitude.toFixed(5), lng: loc.coords.longitude.toFixed(5),
            accuracy: `${loc.coords.accuracy?.toFixed(0) ?? "—"}m`, place,
          }});
        } catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Could not get location" } }); }
      }
      if (command === "GET_ACCELEROMETER") {
        try {
          const sub = Accelerometer.addListener(data => {
            sub.remove();
            emitEvent("commander-response", { command, timestamp: Date.now(), data: {
              x: data.x.toFixed(3), y: data.y.toFixed(3), z: data.z.toFixed(3),
              magnitude: Math.sqrt(data.x**2 + data.y**2 + data.z**2).toFixed(3),
            }});
          });
          Accelerometer.setUpdateInterval(100);
        } catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } }); }
      }
      if (command === "GET_GYROSCOPE") {
        try {
          const sub = Gyroscope.addListener(data => {
            sub.remove();
            emitEvent("commander-response", { command, timestamp: Date.now(), data: {
              x: data.x.toFixed(3), y: data.y.toFixed(3), z: data.z.toFixed(3),
            }});
          });
          Gyroscope.setUpdateInterval(100);
        } catch { emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } }); }
      }
      if (command === "PING") {
        emitEvent("commander-response", { command, timestamp: Date.now(), data: { pong: "OK", ts: Date.now() } });
      }
    });
    return () => {
      unsub();
      Vibration.cancel();
      KeepAwake.deactivateKeepAwake("skylink");
      soundRef.current?.unloadAsync();
    };
  }, [onEvent, emitEvent]);

  // ── SKY: receive info responses ────────────────────────────────────────────
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

  // ── LINK view ──────────────────────────────────────────────────────────────
  if (!isSky) {
    return (
      <View style={[styles.container, { paddingBottom: bottomInset }]}>
        {torchOn && <CameraView ref={cameraRef} style={styles.hiddenCamera} enableTorch />}
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
          <Text style={styles.linkHeaderText}>Link Device — Ready for Commands</Text>
        </View>
        <ScrollView contentContainerStyle={styles.statusGrid} showsVerticalScrollIndicator={false}>
          {[
            { label: "Torch",      active: torchOn,      icon: "sun"  as const, color: Colors.warning },
            { label: "Keep Awake", active: keepAwakeOn,  icon: "eye"  as const, color: Colors.primary },
            { label: "Connected",  active: peerConnected, icon: "wifi" as const, color: Colors.success },
          ].map(item => (
            <View key={item.label} style={[styles.statusCard, { borderColor: item.active ? item.color : Colors.border }]}>
              <Feather name={item.icon} size={28} color={item.active ? item.color : Colors.textSecondary} />
              <Text style={[styles.statusLabel, item.active && { color: item.color }]}>{item.label}</Text>
              <View style={[styles.statusDot, { backgroundColor: item.active ? item.color : Colors.border }]} />
            </View>
          ))}
        </ScrollView>
        <View style={styles.linkNote}>
          <Feather name="info" size={13} color={Colors.textSecondary} />
          <Text style={styles.linkNoteText}>Commands from Sky are executed instantly. Info queries respond automatically. 30+ commands supported.</Text>
        </View>
      </View>
    );
  }

  // ── SKY control panel ──────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {!peerConnected && (
          <View style={styles.offlineBanner}>
            <Feather name="wifi-off" size={15} color={Colors.warning} />
            <Text style={styles.offlineText}>Connect a peer to send commands</Text>
          </View>
        )}

        {/* ── RESPONSES FEED ── */}
        {infoResults.length > 0 && (
          <View style={styles.responsesFeed}>
            <View style={styles.resultsHeader}>
              <Feather name="terminal" size={14} color={Colors.primary} />
              <Text style={styles.resultsTitle}>Live Responses</Text>
              <Pressable onPress={() => setInfoResults([])} style={styles.clearBtn}>
                <Feather name="trash-2" size={13} color={Colors.textSecondary} />
                <Text style={styles.clearBtnText}>Clear</Text>
              </Pressable>
            </View>
            {infoResults.slice(0, 8).map((r, i) => (
              <View key={i} style={[styles.resultRow, i === 0 && styles.resultRowNew]}>
                <View style={styles.resultMeta}>
                  <Text style={styles.resultCmd}>{r.command}</Text>
                  {r.command === "PING" && (
                    <View style={styles.latencyBadge}>
                      <Text style={styles.latencyText}>{Date.now() - r.timestamp}ms</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.resultData}>
                  {Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── DEVICE INFO QUERIES ── */}
        <Section title="Device Info Queries" icon="cpu" color={Colors.primary}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "GET_DEVICE_INFO",  label: "Device Info",    icon: "smartphone" },
              { cmd: "GET_BATTERY",      label: "Battery",        icon: "battery" },
              { cmd: "GET_NETWORK",      label: "Network & IP",   icon: "wifi" },
              { cmd: "GET_TIME",         label: "Peer Time",      icon: "clock" },
              { cmd: "GET_BRIGHTNESS",   label: "Brightness",     icon: "sun" },
              { cmd: "GET_STORAGE",      label: "Disk Space",     icon: "hard-drive" },
              { cmd: "GET_LOCATION",     label: "GPS Location",   icon: "map-pin" },
              { cmd: "GET_ACCELEROMETER", label: "Accelerometer", icon: "activity" },
              { cmd: "GET_GYROSCOPE",    label: "Gyroscope",      icon: "refresh-cw" },
              { cmd: "PING",             label: "Ping Latency",   icon: "zap" },
            ].map(item => (
              <Pressable key={item.cmd} onPress={() => send(item.cmd)} disabled={!peerConnected}
                style={[styles.cmdChip, !peerConnected && styles.disabled]}>
                <Feather name={item.icon as any} size={14} color={Colors.primary} />
                <Text style={styles.cmdChipText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ── CLIPBOARD ── */}
        <Section title="Clipboard" icon="clipboard" color="#06D6A0">
          <Pressable onPress={() => send("READ_CLIPBOARD")} disabled={!peerConnected}
            style={[styles.solidBtn, { backgroundColor: "#06D6A0" }, !peerConnected && styles.disabled]}>
            <Feather name="clipboard" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Read Peer Clipboard</Text>
          </Pressable>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={clipboardWrite}
              onChangeText={setClipboardWrite}
              placeholder="Text to paste into peer's clipboard..."
              placeholderTextColor={Colors.textSecondary}
            />
            <Pressable
              onPress={() => { if (clipboardWrite.trim()) { send("WRITE_CLIPBOARD", { value: clipboardWrite }); setClipboardWrite(""); } }}
              disabled={!peerConnected || !clipboardWrite.trim()}
              style={[styles.iconBtn, { backgroundColor: "#06D6A0" + "33", borderColor: "#06D6A0" }, (!peerConnected || !clipboardWrite.trim()) && styles.disabled]}
            >
              <Feather name="send" size={16} color="#06D6A0" />
            </Pressable>
          </View>
          <Text style={styles.hint}>Read returns the peer's current clipboard. Write pastes your text into their clipboard silently.</Text>
        </Section>

        {/* ── REMOTE TTS ── */}
        <Section title="Text-to-Speech on Peer" icon="volume-2" color={Colors.accent}>
          <TextInput
            style={styles.input}
            value={ttsText}
            onChangeText={setTtsText}
            placeholder="Type text to speak aloud on peer's device..."
            placeholderTextColor={Colors.textSecondary}
            multiline
            maxLength={300}
          />
          <View style={styles.row}>
            <Pressable
              onPress={() => { if (ttsText.trim()) { send("SPEAK_TEXT", { message: ttsText }); setTtsText(""); } }}
              disabled={!peerConnected || !ttsText.trim()}
              style={[styles.solidBtn, { flex: 1, backgroundColor: Colors.accent }, (!peerConnected || !ttsText.trim()) && styles.disabled]}
            >
              <Feather name="volume-2" size={17} color={Colors.dark} />
              <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Speak on Peer</Text>
            </Pressable>
            <Pressable onPress={() => send("STOP_SPEECH")} disabled={!peerConnected}
              style={[styles.iconBtn, { borderColor: Colors.danger, backgroundColor: Colors.danger + "22" }, !peerConnected && styles.disabled]}>
              <Feather name="square" size={16} color={Colors.danger} />
            </Pressable>
          </View>
        </Section>

        {/* ── OPEN URL ── */}
        <Section title="Open URL on Peer" icon="external-link" color="#F77F00">
          <TextInput
            style={styles.input}
            value={urlToOpen}
            onChangeText={setUrlToOpen}
            placeholder="https://..."
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            keyboardType="url"
          />
          <View style={styles.quickUrls}>
            {["https://maps.google.com", "https://google.com", "https://youtube.com"].map(u => (
              <Pressable key={u} onPress={() => setUrlToOpen(u)} style={styles.quickUrlChip}>
                <Text style={styles.quickUrlText}>{u.replace("https://", "")}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => { if (urlToOpen.startsWith("http")) send("OPEN_URL", { value: urlToOpen }); }}
            disabled={!peerConnected || !urlToOpen.startsWith("http")}
            style={[styles.solidBtn, { backgroundColor: "#F77F00" }, (!peerConnected || !urlToOpen.startsWith("http")) && styles.disabled]}
          >
            <Feather name="external-link" size={17} color="white" />
            <Text style={styles.solidBtnText}>Open in Peer Browser</Text>
          </Pressable>
        </Section>

        {/* ── EMERGENCY ── */}
        <Section title="Emergency" icon="alert-triangle" color={Colors.danger}>
          <Pressable onPress={() => send("PHONE_FINDER")} disabled={!peerConnected}
            style={[styles.bigBtn, !peerConnected && styles.disabled]}>
            <Feather name="map-pin" size={22} color="white" />
            <View>
              <Text style={styles.bigBtnTitle}>Phone Finder</Text>
              <Text style={styles.bigBtnDesc}>Torch + vibrate + max brightness for 10 seconds</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => send("STOP_FINDER")} disabled={!peerConnected}
            style={[styles.outlineBtn, { borderColor: Colors.danger }, !peerConnected && styles.disabled]}>
            <Feather name="square" size={16} color={Colors.danger} />
            <Text style={[styles.outlineBtnText, { color: Colors.danger }]}>Stop Finder</Text>
          </Pressable>
        </Section>

        {/* ── TORCH ── */}
        <Section title="Flashlight" icon="sun" color={Colors.warning}>
          <View style={styles.row}>
            <Pressable onPress={() => send("TORCH_ON")} disabled={!peerConnected}
              style={[styles.halfBtn, { backgroundColor: Colors.warning + "22", borderColor: Colors.warning }, !peerConnected && styles.disabled]}>
              <Feather name="sun" size={18} color={Colors.warning} />
              <Text style={[styles.halfBtnText, { color: Colors.warning }]}>Torch ON</Text>
            </Pressable>
            <Pressable onPress={() => send("TORCH_OFF")} disabled={!peerConnected}
              style={[styles.halfBtn, !peerConnected && styles.disabled]}>
              <Feather name="moon" size={18} color={Colors.textSecondary} />
              <Text style={styles.halfBtnText}>Torch OFF</Text>
            </Pressable>
          </View>
        </Section>

        {/* ── BRIGHTNESS ── */}
        <Section title="Screen Brightness" icon="sliders" color={Colors.primary}>
          <View style={styles.brightnessRow}>
            {[0, 0.25, 0.5, 0.75, 1].map(v => (
              <Pressable key={v} onPress={() => { setBrightness(v); send("BRIGHTNESS", { value: v }); }} disabled={!peerConnected}
                style={[styles.brightBtn, brightness === v && { backgroundColor: Colors.primary, borderColor: Colors.primary }, !peerConnected && styles.disabled]}>
                <Text style={[styles.brightBtnText, brightness === v && { color: Colors.dark }]}>
                  {v === 0 ? "Off" : `${v * 100}%`}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            {[
              { cmd: "BRIGHTNESS_DOWN", label: "Dim",      icon: "minus-circle" },
              { cmd: "BRIGHTNESS_UP",   label: "Brighten", icon: "plus-circle" },
              { cmd: "BRIGHTNESS_MAX",  label: "Max",      icon: "sun" },
            ].map(b => (
              <Pressable key={b.cmd} onPress={() => send(b.cmd)} disabled={!peerConnected}
                style={[styles.thirdBtn, !peerConnected && styles.disabled]}>
                <Feather name={b.icon as any} size={14} color={Colors.primary} />
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
              { cmd: "HAPTIC_LIGHT",   label: "Light Tap", icon: "feather",      color: Colors.accent },
              { cmd: "HAPTIC_HEAVY",   label: "Heavy Tap", icon: "zap",          color: Colors.warning },
            ].map(h => (
              <Pressable key={h.cmd} onPress={() => send(h.cmd)} disabled={!peerConnected}
                style={[styles.cmdChip, { borderColor: h.color + "66", backgroundColor: h.color + "15" }, !peerConnected && styles.disabled]}>
                <Feather name={h.icon as any} size={14} color={h.color} />
                <Text style={[styles.cmdChipText, { color: h.color }]}>{h.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ── SCREEN LOCK ── */}
        <Section title="Screen Lock" icon="eye" color={Colors.accent}>
          <View style={styles.row}>
            <Pressable onPress={() => send("KEEP_AWAKE_ON")} disabled={!peerConnected}
              style={[styles.halfBtn, { backgroundColor: Colors.accent + "22", borderColor: Colors.accent }, !peerConnected && styles.disabled]}>
              <Feather name="eye" size={18} color={Colors.accent} />
              <Text style={[styles.halfBtnText, { color: Colors.accent }]}>Keep Awake</Text>
            </Pressable>
            <Pressable onPress={() => send("KEEP_AWAKE_OFF")} disabled={!peerConnected}
              style={[styles.halfBtn, !peerConnected && styles.disabled]}>
              <Feather name="eye-off" size={18} color={Colors.textSecondary} />
              <Text style={styles.halfBtnText}>Allow Sleep</Text>
            </Pressable>
          </View>
        </Section>

        {/* ── VIBRATION ── */}
        <Section title="Vibration Patterns" icon="activity" color="#FF69B4">
          <View style={styles.patternGrid}>
            {Object.entries(VIBE_PATTERNS).map(([key, p]) => (
              <Pressable key={key} onPress={() => setSelectedPattern(key)}
                style={[styles.patternChip, selectedPattern === key && { backgroundColor: p.color + "33", borderColor: p.color }]}>
                <Feather name={p.icon as any} size={13} color={selectedPattern === key ? p.color : Colors.textSecondary} />
                <Text style={[styles.patternLabel, selectedPattern === key && { color: p.color }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => send("VIBRATE_PATTERN", { pattern: VIBE_PATTERNS[selectedPattern].pattern })}
              disabled={!peerConnected}
              style={[styles.solidBtn, { flex: 1, backgroundColor: VIBE_PATTERNS[selectedPattern].color }, !peerConnected && styles.disabled]}>
              <Feather name="activity" size={17} color="white" />
              <Text style={styles.solidBtnText}>Vibrate: {VIBE_PATTERNS[selectedPattern].label}</Text>
            </Pressable>
            <Pressable onPress={() => send("VIBRATE_STOP")} disabled={!peerConnected}
              style={[styles.iconBtn, !peerConnected && styles.disabled]}>
              <Feather name="square" size={16} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </Section>

        {/* ── FULL-SCREEN ALERT ── */}
        <Section title="Full-Screen Alert" icon="alert-circle" color={Colors.danger}>
          <TextInput
            style={styles.input}
            value={alertMsg}
            onChangeText={setAlertMsg}
            placeholder="Type an urgent message for peer's screen..."
            placeholderTextColor={Colors.textSecondary}
            multiline
            maxLength={200}
          />
          <Pressable
            onPress={() => { if (alertMsg.trim()) { send("SHOW_ALERT", { message: alertMsg }); setAlertMsg(""); } }}
            disabled={!peerConnected || !alertMsg.trim()}
            style={[styles.solidBtn, { backgroundColor: Colors.danger }, (!peerConnected || !alertMsg.trim()) && styles.disabled]}>
            <Feather name="alert-circle" size={17} color="white" />
            <Text style={styles.solidBtnText}>Send Full-Screen Alert</Text>
          </Pressable>
        </Section>

        {/* ── LOCK SCREEN NOTIFICATION ── */}
        <Section title="Lock Screen Notification" icon="bell" color={Colors.success}>
          <TextInput
            style={styles.input}
            value={notifTitle}
            onChangeText={setNotifTitle}
            placeholder="Notification title"
            placeholderTextColor={Colors.textSecondary}
          />
          <TextInput
            style={styles.input}
            value={notifBody}
            onChangeText={setNotifBody}
            placeholder="Notification body..."
            placeholderTextColor={Colors.textSecondary}
            multiline
          />
          <Pressable
            onPress={() => { if (notifBody.trim()) { send("LOCAL_NOTIFICATION", { value: notifTitle, message: notifBody }); setNotifBody(""); } }}
            disabled={!peerConnected || !notifBody.trim()}
            style={[styles.solidBtn, { backgroundColor: Colors.success }, (!peerConnected || !notifBody.trim()) && styles.disabled]}>
            <Feather name="bell" size={17} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Send Notification</Text>
          </Pressable>
        </Section>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

function Section({ title, icon, color, children }: {
  title: string; icon: keyof typeof Feather.glyphMap; color: string; children: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.wrapper}>
      <View style={sectionStyles.header}>
        <View style={[sectionStyles.iconWrap, { backgroundColor: color + "22" }]}>
          <Feather name={icon} size={15} color={color} />
        </View>
        <Text style={[sectionStyles.title, { color }]}>{title}</Text>
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrapper: { marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 14 },
  body: { paddingHorizontal: 16, gap: 10 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenCamera: { width: 1, height: 1, position: "absolute", opacity: 0 },
  offlineBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, margin: 14, padding: 12,
    backgroundColor: Colors.warning + "22", borderRadius: 12, borderWidth: 1, borderColor: Colors.warning + "44",
  },
  offlineText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.warning, flex: 1 },
  responsesFeed: {
    margin: 14, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 8,
  },
  resultsHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.primary, flex: 1 },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  clearBtnText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  resultRow: { paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: Colors.border, gap: 4 },
  resultRowNew: { borderTopColor: Colors.primary + "44" },
  resultMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultCmd: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.primary, letterSpacing: 0.5 },
  latencyBadge: { backgroundColor: Colors.success + "22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  latencyText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.success },
  resultData: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  cmdGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cmdChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary + "44", backgroundColor: Colors.primary + "11",
  },
  cmdChipText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.primary },
  row: { flexDirection: "row", gap: 10 },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  halfBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
  },
  halfBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary },
  thirdBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  thirdBtnText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  brightnessRow: { flexDirection: "row", gap: 6 },
  brightBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: "center" },
  brightBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSecondary },
  patternGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  patternChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
  },
  patternLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary },
  solidBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 9, padding: 14, borderRadius: 14,
  },
  solidBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "white" },
  outlineBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 12, borderRadius: 13, borderWidth: 1,
  },
  outlineBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  iconBtn: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center",
  },
  bigBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 18, borderRadius: 18, backgroundColor: Colors.danger,
  },
  bigBtnTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  bigBtnDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 13, padding: 13, fontFamily: "Inter_400Regular", fontSize: 14,
    color: Colors.textPrimary, minHeight: 52, textAlignVertical: "top",
  },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  quickUrls: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  quickUrlChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: "#F77F00" + "55", backgroundColor: "#F77F00" + "11",
  },
  quickUrlText: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#F77F00" },
  disabled: { opacity: 0.35 },
  linkHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  linkHeaderText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.accent },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", padding: 16, gap: 12 },
  statusCard: {
    width: "30%", alignItems: "center", backgroundColor: Colors.surface,
    borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 8,
  },
  statusLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary, textAlign: "center" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  alertOverlay: { flex: 1, backgroundColor: "#000000CC", alignItems: "center", justifyContent: "center", padding: 32 },
  alertBox: {
    backgroundColor: Colors.surface, borderRadius: 24, padding: 32,
    alignItems: "center", gap: 16, width: "100%", borderWidth: 2, borderColor: Colors.danger,
  },
  alertTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.textPrimary, textAlign: "center" },
  alertMessage: { fontFamily: "Inter_400Regular", fontSize: 16, color: Colors.textSecondary, textAlign: "center", lineHeight: 24 },
  alertDismiss: { backgroundColor: Colors.danger, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 50, marginTop: 8 },
  alertDismissText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  linkNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 16,
    padding: 12, backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  linkNoteText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
});
