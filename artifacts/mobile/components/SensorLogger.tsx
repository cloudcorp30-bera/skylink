import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { Accelerometer, Gyroscope, Magnetometer } from "expo-sensors";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View, FlatList,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface SensorEntry {
  t: number;
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
  mx: number; my: number; mz: number;
}

interface SensorLoggerProps {
  peerConnected: boolean;
  bottomInset?: number;
}

function fmt(n: number) { return n.toFixed(4); }

export function SensorLogger({ peerConnected, bottomInset = 0 }: SensorLoggerProps) {
  const [isLogging, setIsLogging] = useState(false);
  const [entries, setEntries] = useState<SensorEntry[]>([]);
  const [peerEntries, setPeerEntries] = useState<SensorEntry[]>([]);
  const [view, setView] = useState<"mine" | "peer">("mine");
  const latestRef = useRef<Partial<SensorEntry>>({});
  const subRefs = useRef<{ a?: any; g?: any; m?: any }>({});
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    const unsub = onEvent("sensor-log-entry", (d: SensorEntry) => {
      setPeerEntries(prev => [d, ...prev].slice(0, 1000));
    });
    return unsub;
  }, [onEvent]);

  const startLogging = useCallback(() => {
    Accelerometer.setUpdateInterval(500);
    Gyroscope.setUpdateInterval(500);
    Magnetometer.setUpdateInterval(500);
    const snap = latestRef.current;
    subRefs.current.a = Accelerometer.addListener(d => { latestRef.current.ax = d.x; latestRef.current.ay = d.y; latestRef.current.az = d.z; });
    subRefs.current.g = Gyroscope.addListener(d => { latestRef.current.gx = d.x; latestRef.current.gy = d.y; latestRef.current.gz = d.z; });
    subRefs.current.m = Magnetometer.addListener(d => {
      latestRef.current.mx = d.x; latestRef.current.my = d.y; latestRef.current.mz = d.z;
      const entry: SensorEntry = {
        t: Date.now(),
        ax: latestRef.current.ax ?? 0, ay: latestRef.current.ay ?? 0, az: latestRef.current.az ?? 0,
        gx: latestRef.current.gx ?? 0, gy: latestRef.current.gy ?? 0, gz: latestRef.current.gz ?? 0,
        mx: d.x, my: d.y, mz: d.z,
      };
      setEntries(prev => [entry, ...prev].slice(0, 2000));
      if (peerConnected) emitEvent("sensor-log-entry", entry);
    });
    setIsLogging(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [peerConnected, emitEvent]);

  const stopLogging = useCallback(() => {
    subRefs.current.a?.remove();
    subRefs.current.g?.remove();
    subRefs.current.m?.remove();
    subRefs.current = {};
    setIsLogging(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  useEffect(() => () => stopLogging(), []);

  const exportCSV = useCallback(async (data: SensorEntry[], label: string) => {
    if (data.length === 0) return;
    const header = "timestamp,ax,ay,az,gx,gy,gz,mx,my,mz\n";
    const rows = data.map(e =>
      `${e.t},${fmt(e.ax)},${fmt(e.ay)},${fmt(e.az)},${fmt(e.gx)},${fmt(e.gy)},${fmt(e.gz)},${fmt(e.mx)},${fmt(e.my)},${fmt(e.mz)}`
    ).join("\n");
    const csv = header + rows;
    const FS = FileSystem as any;
    const path = FS.cacheDirectory + `skylink_sensors_${label}_${Date.now()}.csv`;
    await FS.writeAsStringAsync(path, csv, { encoding: "utf8" });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Export Sensor Log" });
    }
  }, []);

  const displayData = view === "mine" ? entries : peerEntries;

  const stats = displayData.length > 0 ? {
    duration: ((displayData[0].t - displayData[displayData.length - 1].t) / 1000).toFixed(1),
    count: displayData.length,
    avgAx: (displayData.reduce((s, e) => s + e.ax, 0) / displayData.length).toFixed(3),
  } : null;

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.toggle}>
        {(["mine", "peer"] as const).map(v => (
          <Pressable key={v} onPress={() => setView(v)} style={[styles.toggleBtn, view === v && styles.toggleActive]}>
            <Feather name={v === "mine" ? "smartphone" : "user"} size={13} color={view === v ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.toggleLabel, view === v && { color: Colors.primary }]}>
              {v === "mine" ? `My Log (${entries.length})` : `Peer Log (${peerEntries.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.statChip}><Text style={styles.statLabel}>Duration</Text><Text style={styles.statValue}>{stats.duration}s</Text></View>
          <View style={styles.statChip}><Text style={styles.statLabel}>Samples</Text><Text style={styles.statValue}>{stats.count}</Text></View>
          <View style={styles.statChip}><Text style={styles.statLabel}>Avg Ax</Text><Text style={styles.statValue}>{stats.avgAx}g</Text></View>
        </View>
      )}

      <FlatList
        data={displayData.slice(0, 100)}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={styles.entryRow}>
            <Text style={styles.entryTime}>{new Date(item.t).toISOString().slice(11, 23)}</Text>
            <Text style={styles.entryData}>
              A({fmt(item.ax)},{fmt(item.ay)},{fmt(item.az)})
            </Text>
            <Text style={styles.entryDataG}>
              G({fmt(item.gx)},{fmt(item.gy)},{fmt(item.gz)})
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="activity" size={32} color={Colors.textSecondary} />
            <Text style={styles.emptyText}>
              {view === "peer" ? "Peer sensor log will appear here" : "Press Start to begin logging"}
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.footer}>
        <Pressable
          onPress={() => exportCSV(displayData, view)}
          disabled={displayData.length === 0}
          style={[styles.exportBtn, displayData.length === 0 && { opacity: 0.3 }]}
        >
          <Feather name="download" size={15} color={Colors.textSecondary} />
          <Text style={styles.exportText}>Export CSV</Text>
        </Pressable>
        {view === "mine" && (
          isLogging ? (
            <Pressable onPress={stopLogging} style={[styles.actionBtn, { backgroundColor: Colors.danger }]}>
              <Feather name="square" size={15} color="white" />
              <Text style={styles.actionBtnText}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startLogging} style={styles.actionBtn}>
              <Feather name="play" size={15} color={Colors.dark} />
              <Text style={styles.actionBtnText}>Start Logging</Text>
            </Pressable>
          )
        )}
        {view === "mine" && entries.length > 0 && (
          <Pressable onPress={() => setEntries([])} style={styles.clearBtn}>
            <Feather name="trash-2" size={15} color={Colors.danger} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toggle: { flexDirection: "row", margin: 12, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 10, gap: 6 },
  toggleActive: { backgroundColor: Colors.primary + "22" },
  toggleLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  statsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  statChip: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.primary, marginTop: 2 },
  entryRow: { paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.border + "66", flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  entryTime: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, width: 80 },
  entryData: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.primary, flex: 1 },
  entryDataG: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.success, flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 60 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  footer: { flexDirection: "row", padding: 12, gap: 8, alignItems: "center", borderTopWidth: 1, borderTopColor: Colors.border },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  exportText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.primary, paddingVertical: 12, borderRadius: 14 },
  actionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.dark },
  clearBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: Colors.danger + "22", borderWidth: 1, borderColor: Colors.danger + "33", alignItems: "center", justifyContent: "center" },
});
