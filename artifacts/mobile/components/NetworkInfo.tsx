import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface NetData {
  ip: string | null;
  networkType: string;
  isConnected: boolean;
  isInternetReachable: boolean | null;
  timestamp: number;
}

interface NetworkInfoProps {
  peerConnected: boolean;
  bottomInset?: number;
}

const NET_TYPE_LABELS: Record<string, string> = {
  WIFI: "WiFi",
  CELLULAR: "Cellular",
  BLUETOOTH: "Bluetooth",
  ETHERNET: "Ethernet",
  WIMAX: "WiMAX",
  VPN: "VPN",
  OTHER: "Other",
  NONE: "No Connection",
  UNKNOWN: "Unknown",
};

function NetCard({ title, data, accent }: { title: string; data: NetData | null; accent: string }) {
  const copyIP = async (ip: string) => {
    await Clipboard.setStringAsync(ip);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copied!", `IP address ${ip} copied.`);
  };

  return (
    <View style={[nStyles.card, { borderColor: accent + "44", backgroundColor: accent + "0A" }]}>
      <Text style={[nStyles.cardTitle, { color: accent }]}>{title}</Text>
      {data ? (
        <>
          {[
            { label: "IP Address", value: data.ip ?? "N/A", copy: true },
            { label: "Network Type", value: NET_TYPE_LABELS[data.networkType] ?? data.networkType },
            { label: "Connected", value: data.isConnected ? "Yes" : "No" },
            { label: "Internet", value: data.isInternetReachable === true ? "Reachable" : data.isInternetReachable === false ? "Not Reachable" : "Unknown" },
          ].map((row) => (
            <View key={row.label} style={nStyles.row}>
              <Text style={nStyles.label}>{row.label}</Text>
              <Pressable
                onPress={row.copy && data.ip ? () => copyIP(data.ip!) : undefined}
                style={nStyles.valueWrap}
              >
                <Text style={[nStyles.value, { color: accent }]}>{row.value}</Text>
                {row.copy && data.ip && (
                  <Feather name="copy" size={12} color={Colors.textSecondary} />
                )}
              </Pressable>
            </View>
          ))}
        </>
      ) : (
        <Text style={nStyles.noData}>Not connected</Text>
      )}
    </View>
  );
}

const nStyles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 10 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  valueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  value: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  noData: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
});

export function NetworkInfo({ peerConnected, bottomInset = 0 }: NetworkInfoProps) {
  const [myNet, setMyNet] = useState<NetData | null>(null);
  const [peerNet, setPeerNet] = useState<NetData | null>(null);
  const { emitEvent, onEvent } = useTransfer();

  const fetchMyNet = useCallback(async () => {
    try {
      const [ip, state] = await Promise.all([
        Network.getIpAddressAsync(),
        Network.getNetworkStateAsync(),
      ]);
      const data: NetData = {
        ip,
        networkType: state.type ?? "UNKNOWN",
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? null,
        timestamp: Date.now(),
      };
      setMyNet(data);
      emitEvent("network-info", data);
    } catch {}
  }, [emitEvent]);

  useEffect(() => {
    fetchMyNet();
    const interval = setInterval(fetchMyNet, 15000);
    return () => clearInterval(interval);
  }, [fetchMyNet]);

  useEffect(() => {
    const unsub = onEvent("network-info", (data: NetData) => {
      setPeerNet(data);
    });
    return unsub;
  }, [onEvent]);

  const onSameNetwork = myNet?.ip && peerNet?.ip
    ? myNet.ip.split(".").slice(0, 3).join(".") === peerNet.ip.split(".").slice(0, 3).join(".")
    : null;

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
      {onSameNetwork !== null && (
        <View style={[styles.sameBanner, { backgroundColor: (onSameNetwork ? Colors.success : Colors.warning) + "22", borderColor: (onSameNetwork ? Colors.success : Colors.warning) + "44" }]}>
          <Feather name={onSameNetwork ? "wifi" : "alert-triangle"} size={16} color={onSameNetwork ? Colors.success : Colors.warning} />
          <Text style={[styles.sameBannerText, { color: onSameNetwork ? Colors.success : Colors.warning }]}>
            {onSameNetwork ? "Both on same WiFi network — fastest possible transfer speeds" : "Different networks — transfers relay via internet"}
          </Text>
        </View>
      )}

      <NetCard title="Your Network" data={myNet} accent={Colors.primary} />
      <NetCard title="Peer Network" data={peerNet} accent={Colors.accent} />

      <Pressable onPress={fetchMyNet} style={styles.refreshBtn}>
        <Feather name="refresh-cw" size={14} color={Colors.textSecondary} />
        <Text style={styles.refreshText}>Refresh Network Info</Text>
      </Pressable>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Transfer Speed Guide</Text>
        {[
          { net: "Same WiFi", speed: "~10–50 MB/s (fastest)", icon: "zap" as const, color: Colors.success },
          { net: "Different WiFi", speed: "~1–5 MB/s (server relay)", icon: "wifi" as const, color: Colors.warning },
          { net: "Cellular", speed: "~0.5–2 MB/s (limited)", icon: "bar-chart-2" as const, color: Colors.danger },
        ].map((item) => (
          <View key={item.net} style={styles.speedRow}>
            <Feather name={item.icon} size={14} color={item.color} />
            <Text style={styles.speedNet}>{item.net}</Text>
            <Text style={[styles.speedVal, { color: item.color }]}>{item.speed}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  sameBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1 },
  sameBannerText: { fontFamily: "Inter_500Medium", fontSize: 13, flex: 1, lineHeight: 18 },
  refreshBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10 },
  refreshText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  infoSection: { backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 18, gap: 12 },
  infoTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary, marginBottom: 4 },
  speedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  speedNet: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1 },
  speedVal: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
});
