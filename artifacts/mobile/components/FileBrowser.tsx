import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface FileItem {
  name: string;
  uri: string;
  size: number;
  modTime?: number;
  isDir: boolean;
}

interface ReceivedFile {
  name: string;
  uri: string;
  size: number;
  receivedAt: number;
}

interface FileBrowserProps {
  peerConnected: boolean;
  bottomInset?: number;
}

const MIME_ICONS: Record<string, string> = {
  pdf: "file-text", jpg: "image", jpeg: "image", png: "image", gif: "image",
  mp4: "video", mov: "video", mp3: "music", m4a: "music",
  doc: "file-text", docx: "file-text", xls: "grid", xlsx: "grid",
  zip: "archive", txt: "file", json: "code", ts: "code", js: "code",
};

function getIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_ICONS[ext] ?? "file";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function FileBrowser({ peerConnected, bottomInset = 0 }: FileBrowserProps) {
  const [view, setView] = useState<"cache" | "received">("cache");
  const [cacheFiles, setCacheFiles] = useState<FileItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const { sendFile, transfers, onEvent } = useTransfer();

  const loadCacheFiles = useCallback(async () => {
    setLoading(true);
    const FS = FileSystem as any;
    const dir = FS.cacheDirectory + "skylink/";
    try {
      await FS.makeDirectoryAsync(dir, { intermediates: true });
      const contents = await FS.readDirectoryAsync(dir);
      const items: FileItem[] = await Promise.all(
        contents.map(async (name: string) => {
          const uri = dir + name;
          const info = await FS.getInfoAsync(uri, { size: true });
          return { name, uri, size: info.size ?? 0, modTime: info.modificationTime, isDir: info.isDirectory ?? false };
        })
      );
      setCacheFiles(items.filter(i => !i.isDir).sort((a, b) => (b.modTime ?? 0) - (a.modTime ?? 0)));
    } catch {
      setCacheFiles([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCacheFiles();
    const doneTransfers = transfers.filter(t => t.status === "done" && t.direction === "receive" && t.localUri);
    setReceivedFiles(doneTransfers.map(t => ({
      name: t.fileName,
      uri: t.localUri!,
      size: t.fileSize,
      receivedAt: Date.now(),
    })));
  }, [transfers]);

  const pickAndSend = useCallback(async () => {
    if (!peerConnected) return;
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSendingId(asset.uri);
    try {
      await sendFile(asset.uri, asset.name, asset.size ?? 0, asset.mimeType ?? "application/octet-stream");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Send Failed", "Could not send the file.");
    } finally {
      setSendingId(null);
    }
  }, [peerConnected, sendFile]);

  const sendCachedFile = useCallback(async (file: FileItem) => {
    if (!peerConnected) return;
    setSendingId(file.uri);
    try {
      const FS = FileSystem as any;
      const info = await FS.getInfoAsync(file.uri, { size: true });
      await sendFile(file.uri, file.name, info.size ?? file.size, "application/octet-stream");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Send Failed");
    } finally {
      setSendingId(null);
    }
  }, [peerConnected, sendFile]);

  const shareFile = useCallback(async (uri: string) => {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) await Sharing.shareAsync(uri);
  }, []);

  const deleteFile = useCallback(async (file: FileItem) => {
    Alert.alert("Delete File", `Delete ${file.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          const FS = FileSystem as any;
          await FS.deleteAsync(file.uri, { idempotent: true });
          loadCacheFiles();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      },
    ]);
  }, [loadCacheFiles]);

  const displayFiles = view === "cache" ? cacheFiles : receivedFiles.map(f => ({ name: f.name, uri: f.uri, size: f.size, isDir: false, modTime: f.receivedAt }));

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.topBar}>
        <View style={styles.toggle}>
          {(["cache", "received"] as const).map(v => (
            <Pressable key={v} onPress={() => setView(v)} style={[styles.toggleBtn, view === v && styles.toggleActive]}>
              <Feather name={v === "cache" ? "folder" : "download-cloud"} size={13} color={view === v ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.toggleLabel, view === v && { color: Colors.primary }]}>
                {v === "cache" ? `SkyLink Cache (${cacheFiles.length})` : `Received (${receivedFiles.length})`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable onPress={pickAndSend} disabled={!peerConnected} style={[styles.sendBtn, !peerConnected && { opacity: 0.4 }]}>
          <Feather name="upload" size={15} color={Colors.dark} />
          <Text style={styles.sendBtnText}>{peerConnected ? "Pick & Send File" : "Waiting for peer..."}</Text>
        </Pressable>
        <Pressable onPress={loadCacheFiles} style={styles.refreshBtn}>
          <Feather name="refresh-cw" size={15} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={displayFiles}
          keyExtractor={(item, i) => `${item.uri}_${i}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={displayFiles.length === 0 ? { flex: 1 } : undefined}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="folder" size={36} color={Colors.textSecondary} />
              <Text style={styles.emptyText}>
                {view === "cache" ? "No files in SkyLink cache" : "No files received yet"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.fileRow}>
              <View style={styles.fileIcon}>
                <Feather name={getIcon(item.name) as any} size={20} color={Colors.primary} />
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.fileMeta}>
                  {formatSize(item.size)}
                  {item.modTime ? ` · ${new Date(item.modTime).toLocaleDateString()}` : ""}
                </Text>
              </View>
              <View style={styles.fileActions}>
                {sendingId === item.uri ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Pressable onPress={() => sendCachedFile(item as FileItem)} disabled={!peerConnected || !!sendingId} style={[styles.fileActionBtn, !peerConnected && { opacity: 0.4 }]}>
                    <Feather name="send" size={14} color={Colors.primary} />
                  </Pressable>
                )}
                <Pressable onPress={() => shareFile(item.uri)} style={styles.fileActionBtn}>
                  <Feather name="share" size={14} color={Colors.textSecondary} />
                </Pressable>
                {view === "cache" && (
                  <Pressable onPress={() => deleteFile(item as FileItem)} style={styles.fileActionBtn}>
                    <Feather name="trash-2" size={14} color={Colors.danger} />
                  </Pressable>
                )}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { padding: 12 },
  toggle: { flexDirection: "row", backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 10, gap: 6 },
  toggleActive: { backgroundColor: Colors.primary + "22" },
  toggleLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.primary, paddingVertical: 13, borderRadius: 14 },
  sendBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.dark },
  refreshBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  fileRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  fileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary + "22", alignItems: "center", justifyContent: "center" },
  fileInfo: { flex: 1, gap: 3 },
  fileName: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.textPrimary },
  fileMeta: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  fileActions: { flexDirection: "row", gap: 4 },
  fileActionBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  separator: { height: 1, backgroundColor: Colors.border, marginHorizontal: 14 },
});
