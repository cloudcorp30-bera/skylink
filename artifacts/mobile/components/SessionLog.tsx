import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable, SectionList, StyleSheet, Text, View, Alert,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

type EventType = "chat" | "location" | "file" | "control" | "sensor" | "system" | "voice" | "screenshot";

interface LogEntry {
  id: string;
  type: EventType;
  content: string;
  sender: "self" | "peer" | "system";
  timestamp: number;
  meta?: Record<string, any>;
}

const EVENT_COLORS: Record<EventType, string> = {
  chat: Colors.primary,
  location: Colors.success,
  file: Colors.accent,
  control: Colors.warning,
  sensor: "#FF69B4",
  system: Colors.textSecondary,
  voice: Colors.danger,
  screenshot: Colors.primary,
};

const EVENT_ICONS: Record<EventType, string> = {
  chat: "message-circle",
  location: "map-pin",
  file: "paperclip",
  control: "sliders",
  sensor: "activity",
  system: "info",
  voice: "mic",
  screenshot: "camera",
};

function groupByDate(entries: LogEntry[]) {
  const groups: Record<string, LogEntry[]> = {};
  entries.forEach(e => {
    const date = new Date(e.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    if (!groups[date]) groups[date] = [];
    groups[date].push(e);
  });
  return Object.entries(groups).map(([title, data]) => ({ title, data }));
}

interface SessionLogProps {
  role: "sky" | "link";
  roomId: string;
  peerConnected: boolean;
  bottomInset?: number;
}

export function SessionLog({ role, roomId, peerConnected, bottomInset = 0 }: SessionLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<EventType | "all">("all");
  const { onEvent, onMessageReceived, onControlReceived } = useTransfer();
  const startTime = useRef(Date.now());

  const addEntry = useCallback((type: EventType, content: string, sender: "self" | "peer" | "system", meta?: Record<string, any>) => {
    const entry: LogEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      type, content, sender, timestamp: Date.now(), meta,
    };
    setEntries(prev => [entry, ...prev]);
  }, []);

  useEffect(() => {
    addEntry("system", `Session ${roomId} started`, "system");
  }, [roomId]);

  useEffect(() => {
    return onMessageReceived(msg => addEntry("chat", msg.content, "peer"));
  }, [onMessageReceived, addEntry]);

  useEffect(() => {
    return onControlReceived(cmd => addEntry("control", `Command: ${cmd.command}`, "peer"));
  }, [onControlReceived, addEntry]);

  useEffect(() => {
    const unsubLocation = onEvent("location-update", (d: any) => {
      addEntry("location", `Lat ${d.latitude?.toFixed(4)}, Lon ${d.longitude?.toFixed(4)}`, "peer", d);
    });
    const unsubFile = onEvent("file-start", (d: any) => {
      addEntry("file", `File: ${d.fileName} (${(d.fileSize / 1024).toFixed(1)} KB)`, "peer", d);
    });
    const unsubVoice = onEvent("audio-chunk", () => {
      addEntry("voice", "Audio chunk received", "peer");
    });
    const unsubScreenshot = onEvent("screenshot-response", () => {
      addEntry("screenshot", "Screenshot received from peer", "peer");
    });
    return () => { unsubLocation(); unsubFile(); unsubVoice(); unsubScreenshot(); };
  }, [onEvent, addEntry]);

  useEffect(() => {
    if (peerConnected) addEntry("system", `${role === "sky" ? "Link" : "Sky"} peer connected`, "system");
  }, [peerConnected]);

  const filtered = filter === "all" ? entries : entries.filter(e => e.type === filter);
  const sections = groupByDate(filtered);

  const exportLog = useCallback(async (format: "json" | "csv") => {
    const duration = Math.round((Date.now() - startTime.current) / 1000);
    let content: string;

    if (format === "json") {
      const report = {
        sessionId: roomId,
        role,
        startedAt: new Date(startTime.current).toISOString(),
        durationSeconds: duration,
        totalEvents: entries.length,
        events: entries.map(e => ({ ...e, time: new Date(e.timestamp).toISOString() })),
      };
      content = JSON.stringify(report, null, 2);
    } else {
      const header = "timestamp,type,sender,content\n";
      const rows = entries.map(e =>
        `"${new Date(e.timestamp).toISOString()}","${e.type}","${e.sender}","${e.content.replace(/"/g, '""')}"`
      ).join("\n");
      content = header + rows;
    }

    const FS = FileSystem as any;
    const ext = format === "json" ? "json" : "csv";
    const path = FS.cacheDirectory + `skylink_session_${roomId}_${Date.now()}.${ext}`;
    await FS.writeAsStringAsync(path, content, { encoding: "utf8" });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) await Sharing.shareAsync(path, { mimeType: format === "json" ? "application/json" : "text/csv" });
  }, [entries, roomId, role]);

  const handleExport = () => {
    Alert.alert("Export Session Log", "Choose format", [
      { text: "Cancel", style: "cancel" },
      { text: "JSON", onPress: () => exportLog("json") },
      { text: "CSV", onPress: () => exportLog("csv") },
    ]);
  };

  const FILTERS: Array<EventType | "all"> = ["all", "chat", "location", "file", "control", "voice", "sensor", "system"];

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.statsBar}>
        <View style={styles.stat}><Text style={styles.statValue}>{entries.length}</Text><Text style={styles.statLabel}>Events</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{entries.filter(e => e.type === "chat").length}</Text><Text style={styles.statLabel}>Messages</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{Math.round((Date.now() - startTime.current) / 60000)}m</Text><Text style={styles.statLabel}>Duration</Text></View>
        <Pressable onPress={handleExport} style={styles.exportBtn} disabled={entries.length === 0}>
          <Feather name="share" size={14} color={Colors.primary} />
          <Text style={styles.exportBtnText}>Export</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f}
            onPress={() => { Haptics.selectionAsync(); setFilter(f); }}
            style={[styles.filterChip, filter === f && { backgroundColor: (f === "all" ? Colors.primary : EVENT_COLORS[f as EventType]) + "33", borderColor: f === "all" ? Colors.primary : EVENT_COLORS[f as EventType] }]}
          >
            {f !== "all" && <Feather name={EVENT_ICONS[f as EventType] as any} size={11} color={filter === f ? EVENT_COLORS[f as EventType] : Colors.textSecondary} />}
            <Text style={[styles.filterLabel, filter === f && { color: f === "all" ? Colors.primary : EVENT_COLORS[f as EventType] }]}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const color = EVENT_COLORS[item.type];
          return (
            <View style={[styles.entry, { borderLeftColor: color }]}>
              <View style={[styles.entryIcon, { backgroundColor: color + "22" }]}>
                <Feather name={EVENT_ICONS[item.type] as any} size={12} color={color} />
              </View>
              <View style={styles.entryBody}>
                <Text style={styles.entryContent} numberOfLines={2}>{item.content}</Text>
                <View style={styles.entryMeta}>
                  <Text style={[styles.entryType, { color }]}>{item.type}</Text>
                  <Text style={styles.entrySender}>{item.sender}</Text>
                  <Text style={styles.entryTime}>{new Date(item.timestamp).toLocaleTimeString()}</Text>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="list" size={32} color={Colors.textSecondary} />
            <Text style={styles.emptyText}>No events yet</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsBar: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.textPrimary },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + "55", backgroundColor: Colors.primary + "11" },
  exportBtnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.primary },
  filterRow: { flexDirection: "row", padding: 10, gap: 6, flexWrap: "wrap" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  filterLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  sectionHeader: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.dark },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary, letterSpacing: 0.5 },
  entry: { flexDirection: "row", alignItems: "flex-start", padding: 12, borderLeftWidth: 3, marginHorizontal: 10, marginBottom: 2, backgroundColor: Colors.surface, borderRadius: 10, gap: 10 },
  entryIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  entryBody: { flex: 1, gap: 4 },
  entryContent: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textPrimary, lineHeight: 18 },
  entryMeta: { flexDirection: "row", gap: 8, alignItems: "center" },
  entryType: { fontFamily: "Inter_600SemiBold", fontSize: 10, textTransform: "uppercase" },
  entrySender: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary },
  entryTime: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, marginLeft: "auto" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 60 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
});
