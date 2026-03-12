import { Feather } from "@expo/vector-icons";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface DeviceReport {
  // Hardware
  brand: string | null;
  manufacturer: string | null;
  modelName: string | null;
  modelId: string | null;
  designName: string | null;
  deviceType: string;
  // OS
  osName: string | null;
  osVersion: string | null;
  osBuildId: string | null;
  platformApiLevel: number | null;
  // State
  batteryLevel: number;
  batteryState: string;
  brightness: number;
  // Network
  ip: string | null;
  networkType: string;
  isConnected: boolean;
  // Meta
  isEmulator: boolean;
  timestamp: number;
}

function deviceTypeLabel(t: Device.DeviceType | null): string {
  switch (t) {
    case Device.DeviceType.PHONE: return "Phone";
    case Device.DeviceType.TABLET: return "Tablet";
    case Device.DeviceType.DESKTOP: return "Desktop";
    case Device.DeviceType.TV: return "TV";
    default: return "Unknown";
  }
}

function batteryStateLabel(level: number): string {
  if (level > 0.9) return "Full";
  if (level > 0.5) return "Good";
  if (level > 0.2) return "Low";
  return "Critical";
}

function batteryColor(level: number): string {
  if (level > 0.5) return Colors.success;
  if (level > 0.2) return Colors.warning;
  return Colors.danger;
}

interface DashboardCardProps {
  title: string;
  accent: string;
  label: string;
  report: DeviceReport | null;
  loading: boolean;
}

function DashboardCard({ title, accent, label, report, loading }: DashboardCardProps) {
  if (loading) {
    return (
      <View style={[card.container, { borderColor: accent + "44" }]}>
        <Text style={[card.title, { color: accent }]}>{title}</Text>
        <ActivityIndicator color={accent} style={{ margin: 20 }} />
      </View>
    );
  }
  if (!report) {
    return (
      <View style={[card.container, { borderColor: accent + "44" }]}>
        <Text style={[card.title, { color: accent }]}>{title}</Text>
        <Text style={card.noData}>{label === "peer" ? "Waiting for peer to share info" : "Tap refresh to load"}</Text>
      </View>
    );
  }

  const rows: [string, string, string?][] = [
    // Hardware
    ["Brand",         report.brand ?? "—"],
    ["Model",         report.modelName ?? "—"],
    ["Manufacturer",  report.manufacturer ?? "—"],
    ["Device Type",   report.deviceType],
    ["Emulator",      report.isEmulator ? "Yes" : "No", report.isEmulator ? Colors.warning : Colors.success],
    // OS
    ["OS",            `${report.osName ?? "—"} ${report.osVersion ?? ""}`],
    ["Build",         report.osBuildId ?? "—"],
    ...(report.platformApiLevel ? [["API Level", `${report.platformApiLevel}`] as [string, string]] : []),
    // State
    ["Battery",       `${Math.round(report.batteryLevel * 100)}% · ${batteryStateLabel(report.batteryLevel)}`, batteryColor(report.batteryLevel)],
    ["Brightness",    `${Math.round(report.brightness * 100)}%`],
    // Network
    ["IP Address",    report.ip ?? "—"],
    ["Network",       report.networkType],
    ["Internet",      report.isConnected ? "Connected" : "Offline", report.isConnected ? Colors.success : Colors.danger],
  ];

  return (
    <View style={[card.container, { borderColor: accent + "44", backgroundColor: accent + "08" }]}>
      <View style={card.header}>
        <Text style={[card.title, { color: accent }]}>{title}</Text>
        <Text style={card.timestamp}>
          {new Date(report.timestamp).toLocaleTimeString()}
        </Text>
      </View>
      {rows.map(([label, value, color]) => (
        <View key={label} style={card.row}>
          <Text style={card.label}>{label}</Text>
          <Text style={[card.value, color ? { color } : {}]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const card = StyleSheet.create({
  container: { borderRadius: 20, borderWidth: 1, overflow: "hidden", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  timestamp: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  noData: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, padding: 20, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border + "44" },
  label: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  value: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textPrimary, maxWidth: "55%", textAlign: "right" },
});

interface DeviceDashboardProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

export function DeviceDashboard({ role, peerConnected, bottomInset = 0 }: DeviceDashboardProps) {
  const [myReport, setMyReport] = useState<DeviceReport | null>(null);
  const [peerReport, setPeerReport] = useState<DeviceReport | null>(null);
  const [myLoading, setMyLoading] = useState(false);
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    const unsub = onEvent("device-report", (data: DeviceReport) => {
      setPeerReport(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    const unsubReq = onEvent("device-report-request", () => {
      gatherAndSendReport();
    });
    return () => { unsub(); unsubReq(); };
  }, [onEvent]);

  const gatherReport = useCallback(async (): Promise<DeviceReport> => {
    const [battery, netState, ip, bright] = await Promise.all([
      Battery.getBatteryLevelAsync().catch(() => 0),
      Network.getNetworkStateAsync().catch(() => ({ isConnected: false, type: "UNKNOWN" })),
      Network.getIpAddressAsync().catch(() => null),
      Brightness.getBrightnessAsync().catch(() => 0.5),
    ]);
    return {
      brand: Device.brand,
      manufacturer: Device.manufacturer,
      modelName: Device.modelName,
      modelId: Device.modelId,
      designName: Device.designName,
      deviceType: deviceTypeLabel(Device.deviceType),
      osName: Device.osName,
      osVersion: Device.osVersion,
      osBuildId: Device.osBuildId,
      platformApiLevel: Device.platformApiLevel,
      batteryLevel: battery,
      batteryState: batteryStateLabel(battery),
      brightness: bright,
      ip,
      networkType: (netState as any).type ?? "UNKNOWN",
      isConnected: (netState as any).isConnected ?? false,
      isEmulator: Device.isDevice === false,
      timestamp: Date.now(),
    };
  }, []);

  const gatherAndSendReport = useCallback(async () => {
    const report = await gatherReport();
    emitEvent("device-report", report);
  }, [gatherReport, emitEvent]);

  const loadMyReport = useCallback(async () => {
    setMyLoading(true);
    const report = await gatherReport();
    setMyReport(report);
    emitEvent("device-report", report);
    setMyLoading(false);
  }, [gatherReport, emitEvent]);

  const requestPeerReport = useCallback(() => {
    if (!peerConnected) return;
    emitEvent("device-report-request", {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [peerConnected, emitEvent]);

  useEffect(() => { loadMyReport(); }, []);

  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.actions}>
        <Pressable onPress={loadMyReport} style={[styles.btn, { backgroundColor: accentColor }]}>
          <Feather name="refresh-cw" size={15} color={Colors.dark} />
          <Text style={styles.btnText}>Refresh Mine</Text>
        </Pressable>
        <Pressable onPress={requestPeerReport} disabled={!peerConnected} style={[styles.btn, { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }, !peerConnected && { opacity: 0.4 }]}>
          <Feather name="download" size={15} color={Colors.textPrimary} />
          <Text style={[styles.btnText, { color: Colors.textPrimary }]}>{peerConnected ? "Get Peer Info" : "Waiting..."}</Text>
        </Pressable>
      </View>

      <DashboardCard title="Your Device" accent={accentColor} label="self" report={myReport} loading={myLoading} />
      <DashboardCard title="Peer Device" accent={Colors.textSecondary} label="peer" report={peerReport} loading={false} />

      {myReport && peerReport && (
        <View style={styles.compareCard}>
          <Text style={styles.compareTitle}>Comparison</Text>
          {[
            ["OS", myReport.osName ?? "?", peerReport.osName ?? "?"],
            ["Battery", `${Math.round(myReport.batteryLevel * 100)}%`, `${Math.round(peerReport.batteryLevel * 100)}%`],
            ["Network", myReport.networkType, peerReport.networkType],
            ["Same WiFi", myReport.ip?.split(".").slice(0,3).join(".") === peerReport.ip?.split(".").slice(0,3).join(".") ? "Yes" : "No", "—"],
          ].map(([label, mine, peer]) => (
            <View key={label} style={styles.compareRow}>
              <Text style={styles.compareLabel}>{label}</Text>
              <Text style={[styles.compareVal, { color: accentColor }]}>{mine}</Text>
              <Feather name="arrow-right" size={12} color={Colors.textSecondary} />
              <Text style={[styles.compareVal, { color: Colors.textSecondary }]}>{peer}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  actions: { flexDirection: "row", gap: 10, marginBottom: 16 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14 },
  btnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.dark },
  compareCard: { backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 10 },
  compareTitle: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.textPrimary, marginBottom: 4 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compareLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, width: 80 },
  compareVal: { fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 },
});
