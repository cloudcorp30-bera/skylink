import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useRef, useState } from "react";
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

interface PeerFileItem {
  name: string;
  size: number;
  modTime: number;
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
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type ViewTab = "cache" | "received" | "peer";

export function FileBrowser({ peerConnected, bottomInset = 0 }: FileBrowserProps) {
  const [view, setView] = useState<ViewTab>("cache");
  const [cacheFiles, setCacheFiles] = useState<FileItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [peerFiles, setPeerFiles] = useState<PeerFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [peerLoading, setPeerLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [fetchingName, setFetchingName] = useState<string | null>(null);
  const requestIdRef = useRef<string>("");
  const { sendFile, transfers, onEvent, emitEvent } = useTransfer();

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
      name: t.fileName, uri: t.localUri!, size: t.fileSize, receivedAt: Date.now(),
    })));
  }, [transfers]);

  // Listen for peer file list response
  useEffect(() => {
    const unsub = onEvent("browse-files-response", (data: { requestId: string; files: PeerFileItem[] }) => {
      if (data.requestId !== requestIdRef.current) return;
      setPeerFiles(data.files.sort((a, b) => (b.modTime ?? 0) - (a.modTime ?? 0)));
      setPeerLoading(false);
    });
    return () => unsub();
  }, [onEvent]);

  const requestPeerFiles = useCallback(() => {
    if (!peerConnected) return;
    const reqId = Date.now().toString(36);
    requestIdRef.current = reqId;
    setPeerLoading(true);
    setPeerFiles([]);
    emitEvent("browse-files-request", { requestId: reqId });
    setTimeout(() => setPeerLoading(false), 8000);
  }, [peerConnected, emitEvent]);

  const fetchPeerFile = useCallback((name: string) => {
    if (!peerConnected || fetchingName) return;
    setFetchingName(name);
    emitEvent("file-fetch-request", { name, requestId: Date.now().toString(36) });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => setFetchingName(null), 15000);
  }, [peerConnected, fetchingName, emitEvent]);

  // Clear fetching state when transfer completes
  useEffect(() => {
    if (!fetchingName) return;
    const done = transfers.find(t => t.fileName === fetchingName && t.status === "done");
    if (done) setFetchingName(null);
  }, [transfers, fetchingName]);

  const pickAndSend = useCallback(async () => {
    if (!peerConnected) return;
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSendingId(asset.uri);
    try {
      const FS = FileSystem as any;
      const info = await FS.getInfoAsync(asset.uri, { size: true });
      const size = info.size ?? asset.size ?? 0;
      await sendFile(asset.uri, asset.name, size, asset.mimeType ?? "application/octet-stream");
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

  const TABS: { key: ViewTab; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { key: "cache", icon: "folder", label: `Cache (${cacheFiles.length})` },
    { key: "received", icon: "download-cloud", label: `Received (${receivedFiles.length})` },
    { key: "peer", icon: "wifi", label: `Peer Files (${peerFiles.length})` },
  ];

  const localFiles = view === "cache"
    ? cacheFiles
    : receivedFiles.map(f => ({ name: f.name, uri: f.uri, size: f.size, isDir: false, modTime: f.receivedAt }));

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.topBar}>
        <ScrollViewHorizontal tabs={TABS} activeTab={view} onSelect={(k) => {
          setView(k as ViewTab);
          if (k === "peer" && peerConnected && peerFiles.length === 0) requestPeerFiles();
        }} />
      </View>

      {view !== "peer" && (
        <View style={styles.actions}>
          <Pressable onPress={pickAndSend} disabled={!peerConnected} style={[styles.sendBtn, !peerConnected && { opacity: 0.4 }]}>
            <Feather name="upload" size={15} color={Colors.dark} />
            <Text style={styles.sendBtnText}>{peerConnected ? "Pick & Send File" : "Waiting for peer..."}</Text>
          </Pressable>
          <Pressable onPress={loadCacheFiles} style={styles.refreshBtn}>
            <Feather name="refresh-cw" size={15} color={Colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {view === "peer" && (
        <View style={styles.actions}>
          <Pressable onPress={requestPeerFiles} disabled={!peerConnected || peerLoading} style={[styles.sendBtn, { backgroundColor: Colors.accent }, (!peerConnected || peerLoading) && { opacity: 0.4 }]}>
            <Feather name={peerLoading ? "loader" : "refresh-cw"} size={15} color={Colors.dark} />
            <Text style={styles.sendBtnText}>{peerLoading ? "Requesting..." : "Refresh Peer Files"}</Text>
          </Pressable>
        </View>
      )}

      {(view === "peer" ? peerLoading : loading) ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : view === "peer" ? (
        <FlatList
          data={peerFiles}
          keyExtractor={(item, i) => `peer_${item.name}_${i}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={peerFiles.length === 0 ? { flex: 1 } : undefined}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="wifi" size={36} color={Colors.textSecondary} />
              <Text style={styles.emptyText}>
                {peerConnected ? "Tap 'Refresh Peer Files' to browse peer's cache" : "Connect a peer to browse their files"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.fileRow}>
              <View style={styles.fileIcon}>
                <Feather name={getIcon(item.name) as any} size={20} color={Colors.accent} />
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.fileMeta}>
                  {formatSize(item.size)}{item.modTime ? ` · ${new Date(item.modTime * 1000).toLocaleDateString()}` : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => fetchPeerFile(item.name)}
                disabled={!!fetchingName || !peerConnected}
                style={[styles.fileActionBtn, (!!fetchingName || !peerConnected) && { opacity: 0.4 }]}
              >
                {fetchingName === item.name
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Feather name="download" size={14} color={Colors.accent} />}
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <FlatList
          data={localFiles}
          keyExtractor={(item, i) => `${item.uri}_${i}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={localFiles.length === 0 ? { flex: 1 } : undefined}
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

function ScrollViewHorizontal({
  tabs, activeTab, onSelect,
}: {
  tabs: { key: string; icon: keyof typeof Feather.glyphMap; label: string }[];
  activeTab: string;
  onSelect: (k: string) => void;
}) {
  return (
    <View style={tabStyles.row}>
      {tabs.map(t => (
        <Pressable key={t.key} onPress={() => onSelect(t.key)} style={[tabStyles.btn, activeTab === t.key && tabStyles.active]}>
          <Feather name={t.icon} size={12} color={activeTab === t.key ? Colors.primary : Colors.textSecondary} />
          <Text style={[tabStyles.label, activeTab === t.key && { color: Colors.primary }]}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  row: { flexDirection: "row", backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 4, gap: 4 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 10, gap: 5 },
  active: { backgroundColor: Colors.primary + "22" },
  label: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { padding: 12, paddingBottom: 0 },
  actions: { flexDirection: "row", gap: 10, padding: 12 },
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
