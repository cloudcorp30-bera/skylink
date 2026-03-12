import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import { Camera, CameraView } from "expo-camera";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
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
  single:    { label: "Single",    pattern: [0, 300],                           icon: "zap",            color: Colors.primary },
  double:    { label: "Double",    pattern: [0, 200, 100, 200],                 icon: "zap",            color: Colors.accent },
  sos:       { label: "SOS",       pattern: [0,100,100,100,100,100,300,300,300,300,300,300,100,100,100,100,100], icon: "alert-triangle", color: Colors.danger },
  heartbeat: { label: "Heartbeat", pattern: [0,100,80,100,400,100,80,100],      icon: "heart",          color: "#FF69B4" },
  ring:      { label: "Ring",      pattern: [0,300,200,300,200,300,200,300],    icon: "phone",          color: Colors.success },
  buzz:      { label: "Long Buzz", pattern: [0, 1000],                          icon: "activity",       color: Colors.warning },
};

type CommandPayload = {
  command: string;
  value?: string | number | boolean;
  pattern?: number[];
  message?: string;
};

type InfoResponse = {
  command: string;
  data: Record<string, string | number | boolean>;
  timestamp: number;
};

interface RemoteCommanderProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

export function RemoteCommander({ role, peerConnected, bottomInset = 0 }: RemoteCommanderProps) {
  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;
  const { emitEvent, onEvent } = useTransfer();

  // Sky state
  const [selectedPattern, setSelectedPattern] = useState("single");
  const [alertMsg, setAlertMsg] = useState("");
  const [notifTitle, setNotifTitle] = useState("SkyLink Alert");
  const [notifBody, setNotifBody] = useState("");
  const [brightness, setBrightness] = useState(0.5);
  const [infoResults, setInfoResults] = useState<InfoResponse[]>([]);

  // Link state
  const [torchOn, setTorchOn] = useState(false);
  const [keepAwakeOn, setKeepAwakeOn] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertContent, setAlertContent] = useState({ title: "", message: "" });
  const [cameraPermission, setCameraPermission] = useState<boolean | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then(({ granted }) => setCameraPermission(granted));
    Notifications.requestPermissionsAsync();
  }, []);

  // ── LINK: receive and execute commands ─────────────────────────────────────
  useEffect(() => {
    const unsub = onEvent("remote-command", async (data: CommandPayload) => {
      const { command, value, pattern, message } = data;

      if (command === "TORCH_ON")  setTorchOn(true);
      if (command === "TORCH_OFF") setTorchOn(false);

      if (command === "KEEP_AWAKE_ON") { KeepAwake.activateKeepAwakeAsync("skylink"); setKeepAwakeOn(true); }
      if (command === "KEEP_AWAKE_OFF") { KeepAwake.deactivateKeepAwake("skylink"); setKeepAwakeOn(false); }

      if (command === "BRIGHTNESS" && typeof value === "number") {
        try { await Brightness.setBrightnessAsync(value); } catch {}
      }
      if (command === "BRIGHTNESS_UP") {
        try { const cur = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.min(1, cur + 0.2)); } catch {}
      }
      if (command === "BRIGHTNESS_DOWN") {
        try { const cur = await Brightness.getBrightnessAsync(); await Brightness.setBrightnessAsync(Math.max(0, cur - 0.2)); } catch {}
      }
      if (command === "BRIGHTNESS_MAX") { try { await Brightness.setBrightnessAsync(1); } catch {} }
      if (command === "BRIGHTNESS_OFF") { try { await Brightness.setBrightnessAsync(0); } catch {} }

      if (command === "VIBRATE_PATTERN" && pattern) {
        Vibration.vibrate(pattern);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      if (command === "HAPTIC_SUCCESS") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (command === "HAPTIC_ERROR")   Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (command === "HAPTIC_LIGHT")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (command === "HAPTIC_HEAVY")   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      if (command === "SHOW_ALERT" && message) {
        setAlertContent({ title: "Message from Sky", message });
        setShowAlert(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      if (command === "LOCAL_NOTIFICATION") {
        await Notifications.scheduleNotificationAsync({
          content: { title: (value as string) || "SkyLink Alert", body: message || "You have a message", sound: true },
          trigger: null,
        });
      }

      if (command === "PHONE_FINDER") {
        setTorchOn(true);
        Vibration.vibrate([0,200,100,200,100,200,100,200,100,1000], true);
        try { await Brightness.setBrightnessAsync(1); } catch {}
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => { Vibration.cancel(); setTorchOn(false); }, 10000);
      }
      if (command === "STOP_FINDER") { Vibration.cancel(); setTorchOn(false); }

      // ── INFO QUERIES — no special permission needed ────────────────────────
      if (command === "GET_DEVICE_INFO") {
        emitEvent("commander-response", {
          command,
          data: {
            brand: Device.brand ?? "—",
            model: Device.modelName ?? "—",
            os: Device.osName ?? "—",
            osVersion: Device.osVersion ?? "—",
            deviceType: Device.deviceType ?? 0,
            totalMemory: Device.totalMemory ?? 0,
          },
          timestamp: Date.now(),
        });
      }
      if (command === "GET_BATTERY") {
        try {
          const level = await Battery.getBatteryLevelAsync();
          const state = await Battery.getBatteryStateAsync();
          const low = await Battery.isLowPowerModeEnabledAsync();
          const stateLabels = ["Unknown", "Unplugged", "Charging", "Full"];
          emitEvent("commander-response", {
            command, timestamp: Date.now(),
            data: { level: `${Math.round(level * 100)}%`, state: stateLabels[state] ?? "Unknown", lowPowerMode: low },
          });
        } catch {
          emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } });
        }
      }
      if (command === "GET_NETWORK") {
        try {
          const net = await Network.getNetworkStateAsync();
          emitEvent("commander-response", {
            command, timestamp: Date.now(),
            data: { connected: net.isConnected ?? false, type: net.type ?? "unknown", internet: net.isInternetReachable ?? false },
          });
        } catch {
          emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } });
        }
      }
      if (command === "GET_TIME") {
        const now = new Date();
        emitEvent("commander-response", {
          command, timestamp: Date.now(),
          data: {
            time: now.toLocaleTimeString(),
            date: now.toLocaleDateString(),
            iso: now.toISOString(),
            tzOffset: -now.getTimezoneOffset(),
          },
        });
      }
      if (command === "GET_BRIGHTNESS") {
        try {
          const b = await Brightness.getBrightnessAsync();
          emitEvent("commander-response", { command, timestamp: Date.now(), data: { brightness: Math.round(b * 100) + "%" } });
        } catch {
          emitEvent("commander-response", { command, timestamp: Date.now(), data: { error: "Not available" } });
        }
      }
      if (command === "PING") {
        emitEvent("commander-response", { command, timestamp: Date.now(), data: { pong: true, ts: Date.now() } });
      }
    });
    return () => { unsub(); Vibration.cancel(); KeepAwake.deactivateKeepAwake("skylink"); soundRef.current?.unloadAsync(); };
  }, [onEvent, emitEvent]);

  // ── SKY: receive info responses ────────────────────────────────────────────
  useEffect(() => {
    if (!isSky) return;
    const unsub = onEvent("commander-response", (data: InfoResponse) => {
      setInfoResults(prev => [data, ...prev.slice(0, 19)]);
    });
    return () => unsub();
  }, [onEvent, isSky]);

  // ── Sky sends commands ─────────────────────────────────────────────────────
  const send = useCallback((command: string, extra?: Partial<CommandPayload>) => {
    if (!peerConnected) return;
    emitEvent("remote-command", { command, ...extra });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [peerConnected, emitEvent]);

  const sendVibration = () => send("VIBRATE_PATTERN", { pattern: VIBE_PATTERNS[selectedPattern].pattern });
  const sendAlert = () => {
    if (!alertMsg.trim()) return;
    send("SHOW_ALERT", { message: alertMsg.trim() });
    setAlertMsg("");
  };
  const sendNotification = () => {
    if (!notifBody.trim()) return;
    send("LOCAL_NOTIFICATION", { value: notifTitle, message: notifBody });
    Alert.alert("Sent!", "Notification queued on peer device.");
    setNotifBody("");
  };
  const sendBrightness = (v: number) => { setBrightness(v); send("BRIGHTNESS", { value: v }); };

  // ── LINK side render ───────────────────────────────────────────────────────
  if (!isSky) {
    return (
      <View style={[styles.container, { paddingBottom: bottomInset }]}>
        {cameraPermission && torchOn && (
          <CameraView ref={cameraRef} style={styles.hiddenCamera} enableTorch={torchOn} />
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
          <Feather name="link" size={20} color={Colors.accent} />
          <Text style={styles.linkHeaderText}>Link Device — Receiving Commands</Text>
        </View>
        <ScrollView contentContainerStyle={styles.statusGrid} showsVerticalScrollIndicator={false}>
          {[
            { label: "Torch",       active: torchOn,     icon: "sun"   as const, color: Colors.warning },
            { label: "Keep Awake",  active: keepAwakeOn, icon: "eye"   as const, color: Colors.primary },
            { label: "Connected",   active: peerConnected, icon: "wifi" as const, color: Colors.success },
          ].map(item => (
            <View key={item.label} style={[styles.statusCard, { borderColor: item.active ? item.color : Colors.border }]}>
              <Feather name={item.icon} size={28} color={item.active ? item.color : Colors.textSecondary} />
              <Text style={[styles.statusLabel, item.active && { color: item.color }]}>{item.label}</Text>
              <View style={[styles.statusDot, { backgroundColor: item.active ? item.color : Colors.border }]} />
            </View>
          ))}
        </ScrollView>
        <View style={styles.linkNote}>
          <Feather name="info" size={14} color={Colors.textSecondary} />
          <Text style={styles.linkNoteText}>Sky controls this device remotely. Commands execute automatically. Info queries respond instantly.</Text>
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

        {/* ── INFO QUERIES (no permission needed) ── */}
        <Section title="Device Info Queries" icon="cpu" color={Colors.primary}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "GET_DEVICE_INFO", label: "Device Info",    icon: "smartphone" },
              { cmd: "GET_BATTERY",     label: "Battery",        icon: "battery" },
              { cmd: "GET_NETWORK",     label: "Network",        icon: "wifi" },
              { cmd: "GET_TIME",        label: "Peer Time",      icon: "clock" },
              { cmd: "GET_BRIGHTNESS",  label: "Brightness",     icon: "sun" },
              { cmd: "PING",            label: "Ping",           icon: "activity" },
            ].map(item => (
              <Pressable key={item.cmd} onPress={() => send(item.cmd)} disabled={!peerConnected}
                style={[styles.cmdChip, !peerConnected && styles.disabled]}>
                <Feather name={item.icon as any} size={15} color={Colors.primary} />
                <Text style={styles.cmdChipText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {infoResults.length > 0 && (
            <View style={styles.resultsBox}>
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsTitle}>Responses</Text>
                <Pressable onPress={() => setInfoResults([])}>
                  <Feather name="x" size={14} color={Colors.textSecondary} />
                </Pressable>
              </View>
              {infoResults.slice(0, 5).map((r, i) => (
                <View key={i} style={styles.resultRow}>
                  <Text style={styles.resultCmd}>{r.command}</Text>
                  <Text style={styles.resultData}>{Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}</Text>
                  {r.command === "PING" && (
                    <Text style={styles.resultLatency}>{Date.now() - r.timestamp}ms</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </Section>

        {/* ── EMERGENCY ── */}
        <Section title="Emergency" icon="alert-triangle" color={Colors.danger}>
          <Pressable onPress={() => send("PHONE_FINDER")} disabled={!peerConnected} style={[styles.bigBtn, styles.bigBtnDanger, !peerConnected && styles.disabled]}>
            <Feather name="map-pin" size={22} color="white" />
            <View>
              <Text style={styles.bigBtnTitle}>Phone Finder</Text>
              <Text style={styles.bigBtnDesc}>Flashlight + vibration + max brightness for 10s</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => send("STOP_FINDER")} disabled={!peerConnected} style={[styles.outlineBtn, { borderColor: Colors.danger }, !peerConnected && styles.disabled]}>
            <Feather name="square" size={16} color={Colors.danger} />
            <Text style={[styles.outlineBtnText, { color: Colors.danger }]}>Stop Finder</Text>
          </Pressable>
        </Section>

        {/* ── TORCH ── */}
        <Section title="Flashlight" icon="sun" color={Colors.warning}>
          <View style={styles.row}>
            <Pressable onPress={() => send("TORCH_ON")} disabled={!peerConnected} style={[styles.halfBtn, { backgroundColor: Colors.warning + "22", borderColor: Colors.warning }, !peerConnected && styles.disabled]}>
              <Feather name="sun" size={20} color={Colors.warning} />
              <Text style={[styles.halfBtnText, { color: Colors.warning }]}>Torch ON</Text>
            </Pressable>
            <Pressable onPress={() => send("TORCH_OFF")} disabled={!peerConnected} style={[styles.halfBtn, !peerConnected && styles.disabled]}>
              <Feather name="moon" size={20} color={Colors.textSecondary} />
              <Text style={styles.halfBtnText}>Torch OFF</Text>
            </Pressable>
          </View>
        </Section>

        {/* ── BRIGHTNESS ── */}
        <Section title="Screen Brightness" icon="sliders" color={Colors.primary}>
          <View style={styles.brightnessRow}>
            {[0, 0.25, 0.5, 0.75, 1].map(v => (
              <Pressable key={v} onPress={() => sendBrightness(v)} disabled={!peerConnected}
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
                <Feather name={b.icon as any} size={15} color={Colors.primary} />
                <Text style={styles.thirdBtnText}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ── HAPTICS ── */}
        <Section title="Haptics & Feedback" icon="zap" color={Colors.accent}>
          <View style={styles.cmdGrid}>
            {[
              { cmd: "HAPTIC_SUCCESS", label: "Success", icon: "check-circle", color: Colors.success },
              { cmd: "HAPTIC_ERROR",   label: "Error",   icon: "x-circle",     color: Colors.danger },
              { cmd: "HAPTIC_LIGHT",   label: "Light",   icon: "feather",      color: Colors.accent },
              { cmd: "HAPTIC_HEAVY",   label: "Heavy",   icon: "zap",          color: Colors.warning },
            ].map(h => (
              <Pressable key={h.cmd} onPress={() => send(h.cmd)} disabled={!peerConnected}
                style={[styles.cmdChip, { borderColor: h.color + "66" }, !peerConnected && styles.disabled]}>
                <Feather name={h.icon as any} size={15} color={h.color} />
                <Text style={[styles.cmdChipText, { color: h.color }]}>{h.label}</Text>
              </Pressable>
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
              <Pressable key={key} onPress={() => setSelectedPattern(key)}
                style={[styles.patternChip, selectedPattern === key && { backgroundColor: p.color + "33", borderColor: p.color }]}>
                <Feather name={p.icon as any} size={14} color={selectedPattern === key ? p.color : Colors.textSecondary} />
                <Text style={[styles.patternLabel, selectedPattern === key && { color: p.color }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={sendVibration} disabled={!peerConnected} style={[styles.solidBtn, { backgroundColor: VIBE_PATTERNS[selectedPattern].color }, !peerConnected && styles.disabled]}>
            <Feather name="activity" size={18} color="white" />
            <Text style={styles.solidBtnText}>Vibrate: {VIBE_PATTERNS[selectedPattern].label}</Text>
          </Pressable>
        </Section>

        {/* ── ALERT POPUP ── */}
        <Section title="Alert Popup" icon="alert-circle" color={Colors.danger}>
          <TextInput
            style={styles.input}
            value={alertMsg}
            onChangeText={setAlertMsg}
            placeholder="Type alert message for peer's screen..."
            placeholderTextColor={Colors.textSecondary}
            multiline
            maxLength={200}
          />
          <Pressable onPress={sendAlert} disabled={!peerConnected || !alertMsg.trim()} style={[styles.solidBtn, { backgroundColor: Colors.danger }, (!peerConnected || !alertMsg.trim()) && styles.disabled]}>
            <Feather name="alert-circle" size={18} color="white" />
            <Text style={styles.solidBtnText}>Show Full-Screen Alert</Text>
          </Pressable>
        </Section>

        {/* ── LOCAL NOTIFICATION ── */}
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
            placeholder="Notification body text..."
            placeholderTextColor={Colors.textSecondary}
            multiline
          />
          <Pressable onPress={sendNotification} disabled={!peerConnected || !notifBody.trim()} style={[styles.solidBtn, { backgroundColor: Colors.success }, (!peerConnected || !notifBody.trim()) && styles.disabled]}>
            <Feather name="bell" size={18} color={Colors.dark} />
            <Text style={[styles.solidBtnText, { color: Colors.dark }]}>Send Lock Screen Notification</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, icon, color, children }: { title: string; icon: keyof typeof Feather.glyphMap; color: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrapper}>
      <View style={sectionStyles.header}>
        <View style={[sectionStyles.iconWrap, { backgroundColor: color + "22" }]}>
          <Feather name={icon} size={16} color={color} />
        </View>
        <Text style={[sectionStyles.title, { color }]}>{title}</Text>
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrapper: { marginBottom: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  body: { paddingHorizontal: 16, gap: 10 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenCamera: { width: 1, height: 1, position: "absolute", opacity: 0 },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 8, margin: 14, padding: 12, backgroundColor: Colors.warning + "22", borderRadius: 12, borderWidth: 1, borderColor: Colors.warning + "44" },
  offlineText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.warning, flex: 1 },
  cmdGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cmdChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary + "55", backgroundColor: Colors.primary + "11",
  },
  cmdChipText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.primary },
  resultsBox: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 12, gap: 8 },
  resultsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resultsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textPrimary },
  resultRow: { gap: 3, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  resultCmd: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.primary },
  resultData: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  resultLatency: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.success },
  bigBtn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18 },
  bigBtnDanger: { backgroundColor: Colors.danger },
  bigBtnTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  bigBtnDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 13, borderRadius: 14, borderWidth: 1, backgroundColor: "transparent" },
  outlineBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  row: { flexDirection: "row", gap: 10 },
  halfBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.border },
  halfBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary },
  thirdBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  thirdBtnText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  brightnessRow: { flexDirection: "row", gap: 8 },
  brightBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: "center" },
  brightBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary },
  patternGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  patternChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  patternLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  solidBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 15, borderRadius: 16 },
  solidBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "white" },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 13, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, minHeight: 60, textAlignVertical: "top" },
  disabled: { opacity: 0.35 },
  linkHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  linkHeaderText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.accent },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", padding: 16, gap: 12 },
  statusCard: { width: "30%", alignItems: "center", backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 8 },
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
