import { Feather } from "@expo/vector-icons";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
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

interface DeviceInfo {
  batteryLevel: number | null;
  batteryState: string | null;
  brightness: number | null;
  platform: string;
  timestamp: number;
}

interface DeviceControlsProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

const BATTERY_STATE_LABELS: Record<number, string> = {
  0: "Unknown",
  1: "Unplugged",
  2: "Charging",
  3: "Full",
};

export function DeviceControls({ role, peerConnected, bottomInset = 0 }: DeviceControlsProps) {
  const [myInfo, setMyInfo] = useState<DeviceInfo | null>(null);
  const [peerInfo, setPeerInfo] = useState<DeviceInfo | null>(null);
  const [clipboardText, setClipboardText] = useState("");
  const [incomingClipboard, setIncomingClipboard] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const { emitEvent, onEvent } = useTransfer();

  const fetchMyInfo = useCallback(async () => {
    try {
      const [battery, batteryState, brightnessVal] = await Promise.all([
        Battery.getBatteryLevelAsync().catch(() => null),
        Battery.getBatteryStateAsync().catch(() => null),
        Brightness.getBrightnessAsync().catch(() => null),
      ]);

      const info: DeviceInfo = {
        batteryLevel: battery,
        batteryState: batteryState !== null ? BATTERY_STATE_LABELS[batteryState] ?? "Unknown" : null,
        brightness: brightnessVal,
        platform: Platform.OS,
        timestamp: Date.now(),
      };

      setMyInfo(info);
      emitEvent("device-info", info);
    } catch {}
  }, [emitEvent]);

  useEffect(() => {
    fetchMyInfo();
    const interval = setInterval(fetchMyInfo, 30000);
    return () => clearInterval(interval);
  }, [fetchMyInfo]);

  useEffect(() => {
    const unsubInfo = onEvent("device-info", (data: DeviceInfo) => {
      setPeerInfo(data);
    });
    const unsubClip = onEvent("clipboard-sync", (data: { text: string }) => {
      setIncomingClipboard(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    const unsubCtrl = onEvent("device-control", (data: { action: string; value?: number }) => {
      handleIncomingControl(data);
    });
    return () => { unsubInfo(); unsubClip(); unsubCtrl(); };
  }, [onEvent]);

  const handleIncomingControl = useCallback(async (data: { action: string; value?: number }) => {
    switch (data.action) {
      case "vibrate":
        Vibration.vibrate([0, 300, 100, 300]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case "brightness":
        if (data.value !== undefined) {
          await Brightness.setBrightnessAsync(data.value).catch(() => {});
          await fetchMyInfo();
        }
        break;
      case "ping":
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Ping!", "Your peer pinged you.");
        break;
    }
  }, [fetchMyInfo]);

  const sendClipboard = useCallback(async () => {
    const text = clipboardText.trim();
    if (!text) {
      const fromClip = await Clipboard.getStringAsync().catch(() => "");
      if (fromClip) {
        emitEvent("clipboard-sync", { text: fromClip });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert("Sent!", "Clipboard content sent to peer.");
      } else {
        Alert.alert("Empty", "Your clipboard is empty. Type something to send.");
      }
      return;
    }
    emitEvent("clipboard-sync", { text });
    setClipboardText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Sent!", `Text sent to peer's clipboard.`);
  }, [clipboardText, emitEvent]);

  const pasteIncoming = useCallback(async () => {
    if (!incomingClipboard) return;
    await Clipboard.setStringAsync(incomingClipboard);
    setIncomingClipboard(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copied!", "Text pasted to your clipboard.");
  }, [incomingClipboard]);

  const sendControl = useCallback((action: string, value?: number) => {
    if (!peerConnected) return;
    emitEvent("device-control", { action, value });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [peerConnected, emitEvent]);

  const sendBrightness = useCallback((val: number) => {
    sendControl("brightness", val);
    Alert.alert("Sent", `Setting peer brightness to ${Math.round(val * 100)}%`);
  }, [sendControl]);

  function batteryIcon(level: number | null): keyof typeof Feather.glyphMap {
    if (level === null) return "battery";
    if (level > 0.6) return "battery-charging";
    if (level > 0.3) return "battery";
    return "battery";
  }

  function batteryColor(level: number | null): string {
    if (level === null) return Colors.textSecondary;
    if (level > 0.5) return Colors.success;
    if (level > 0.2) return Colors.warning;
    return Colors.danger;
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: bottomInset + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.deviceCards}>
        {[
          { label: "Your Device", info: myInfo, accent: role === "sky" ? Colors.primary : Colors.accent },
          { label: "Peer Device", info: peerInfo, accent: role === "sky" ? Colors.accent : Colors.primary },
        ].map(({ label, info, accent }) => (
          <View key={label} style={[styles.deviceCard, { borderColor: accent + "44", backgroundColor: accent + "0D" }]}>
            <Text style={[styles.deviceCardTitle, { color: accent }]}>{label}</Text>
            {info ? (
              <>
                <View style={styles.infoRow}>
                  <Feather name={batteryIcon(info.batteryLevel)} size={16} color={batteryColor(info.batteryLevel)} />
                  <Text style={styles.infoValue}>
                    {info.batteryLevel !== null ? `${Math.round(info.batteryLevel * 100)}%` : "N/A"}
                    {info.batteryState ? ` · ${info.batteryState}` : ""}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Feather name="sun" size={16} color={Colors.warning} />
                  <Text style={styles.infoValue}>
                    {info.brightness !== null ? `${Math.round(info.brightness * 100)}% brightness` : "N/A"}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Feather name="smartphone" size={16} color={Colors.textSecondary} />
                  <Text style={styles.infoValue}>{info.platform}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.noInfoText}>
                {label === "Peer Device" ? (peerConnected ? "Waiting..." : "Not connected") : "Loading..."}
              </Text>
            )}
          </View>
        ))}
      </View>

      {incomingClipboard && (
        <View style={styles.incomingClip}>
          <View style={styles.incomingClipHeader}>
            <Feather name="clipboard" size={16} color={Colors.success} />
            <Text style={styles.incomingClipTitle}>Incoming Clipboard</Text>
          </View>
          <Text style={styles.incomingClipText} numberOfLines={3}>{incomingClipboard}</Text>
          <Pressable onPress={pasteIncoming} style={styles.pasteBtn}>
            <Feather name="copy" size={14} color={Colors.dark} />
            <Text style={styles.pasteBtnText}>Copy to Clipboard</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Clipboard Sync</Text>
        <TextInput
          style={styles.clipInput}
          value={clipboardText}
          onChangeText={setClipboardText}
          placeholder="Type text or leave empty to send current clipboard..."
          placeholderTextColor={Colors.textSecondary}
          multiline
          maxLength={2000}
        />
        <Pressable
          onPress={sendClipboard}
          style={[styles.sendClipBtn, !peerConnected && styles.btnDisabled]}
          disabled={!peerConnected}
        >
          <Feather name="send" size={16} color={Colors.dark} />
          <Text style={styles.sendClipBtnText}>Send to Peer</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Remote Controls (affects peer)</Text>
        <View style={styles.controlGrid}>
          {[
            { icon: "zap" as const, label: "Ping Peer", action: () => sendControl("ping"), color: Colors.primary },
            { icon: "activity" as const, label: "Vibrate", action: () => sendControl("vibrate"), color: Colors.accent },
            { icon: "sun" as const, label: "Brighten", action: () => sendBrightness(1.0), color: Colors.warning },
            { icon: "moon" as const, label: "Dim Screen", action: () => sendBrightness(0.1), color: Colors.textSecondary },
          ].map((item) => (
            <Pressable
              key={item.label}
              onPress={item.action}
              disabled={!peerConnected}
              style={({ pressed }) => [
                styles.controlTile,
                { borderColor: item.color + "44", backgroundColor: item.color + "11" },
                pressed && styles.controlTilePressed,
                !peerConnected && styles.btnDisabled,
              ]}
            >
              <Feather name={item.icon} size={24} color={item.color} />
              <Text style={[styles.controlTileLabel, { color: item.color }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable onPress={fetchMyInfo} style={styles.refreshBtn}>
        <Feather name="refresh-cw" size={14} color={Colors.textSecondary} />
        <Text style={styles.refreshBtnText}>Refresh Device Info</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20 },
  deviceCards: { flexDirection: "row", gap: 12 },
  deviceCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  deviceCardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, marginBottom: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoValue: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textPrimary, flex: 1 },
  noInfoText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  incomingClip: {
    backgroundColor: Colors.success + "11",
    borderWidth: 1,
    borderColor: Colors.success + "44",
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  incomingClipHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  incomingClipTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.success },
  incomingClipText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  pasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.success,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  pasteBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.dark },
  section: { gap: 12 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary },
  clipInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textPrimary,
    minHeight: 80,
    textAlignVertical: "top",
  },
  sendClipBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 13,
    borderRadius: 14,
  },
  sendClipBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.dark },
  controlGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  controlTile: {
    width: "47%",
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    alignItems: "center",
    gap: 10,
  },
  controlTilePressed: { opacity: 0.7 },
  controlTileLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, textAlign: "center" },
  btnDisabled: { opacity: 0.35 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  refreshBtnText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
});
