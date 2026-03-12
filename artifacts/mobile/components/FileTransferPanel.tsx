import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer, type FileTransfer } from "@/context/TransferContext";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeIcon(mimeType: string): keyof typeof Feather.glyphMap {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "film";
  if (mimeType.startsWith("audio/")) return "music";
  if (mimeType.includes("pdf")) return "file-text";
  if (mimeType.includes("zip") || mimeType.includes("compressed"))
    return "archive";
  return "file";
}

function TransferItem({ transfer }: { transfer: FileTransfer }) {
  const icon = getMimeIcon(transfer.mimeType);
  const isSending = transfer.direction === "send";
  const isInProgress =
    transfer.status === "sending" || transfer.status === "receiving";
  const isDone = transfer.status === "done";
  const isError = transfer.status === "error";

  const accentColor = isSending ? Colors.primary : Colors.accent;

  const handleSave = async () => {
    if (!transfer.localUri) return;
    try {
      if (Platform.OS === "web") {
        Alert.alert("Saved", "File saved to cache.");
        return;
      }
      if (transfer.mimeType.startsWith("image/") || transfer.mimeType.startsWith("video/")) {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Allow media access to save files.");
          return;
        }
        await MediaLibrary.saveToLibraryAsync(transfer.localUri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Saved!", "File saved to your gallery.");
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(transfer.localUri, {
          mimeType: transfer.mimeType,
        });
      } else {
        Alert.alert("Saved", "File is available in app cache.");
      }
    } catch (err) {
      Alert.alert("Error", "Could not save file.");
    }
  };

  return (
    <View style={styles.transferItem}>
      <View style={[styles.fileIcon, { backgroundColor: accentColor + "22" }]}>
        <Feather name={icon} size={20} color={accentColor} />
      </View>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={1}>
          {transfer.fileName}
        </Text>
        <Text style={styles.fileMeta}>
          {formatBytes(transfer.fileSize)} ·{" "}
          {isSending ? "Sending" : "Receiving"}
        </Text>
        {isInProgress && (
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${transfer.progress}%`,
                  backgroundColor: accentColor,
                },
              ]}
            />
          </View>
        )}
        {isError && (
          <Text style={styles.errorText}>{transfer.errorMessage}</Text>
        )}
      </View>
      <View style={styles.transferStatus}>
        {isInProgress && (
          <View style={styles.progressInfo}>
            <ActivityIndicator size="small" color={accentColor} />
            <Text style={[styles.progressPct, { color: accentColor }]}>
              {transfer.progress}%
            </Text>
          </View>
        )}
        {isDone && transfer.direction === "receive" && (
          <Pressable onPress={handleSave} style={styles.saveBtn} hitSlop={10}>
            <Feather name="download" size={20} color={Colors.success} />
          </Pressable>
        )}
        {isDone && transfer.direction === "send" && (
          <Feather name="check-circle" size={20} color={Colors.success} />
        )}
        {isError && (
          <Feather name="alert-circle" size={20} color={Colors.danger} />
        )}
      </View>
    </View>
  );
}

interface FileTransferPanelProps {
  peerConnected: boolean;
  bottomInset?: number;
}

export function FileTransferPanel({
  peerConnected,
  bottomInset = 0,
}: FileTransferPanelProps) {
  const { transfers, sendFile } = useTransfer();

  const pickDocument = useCallback(async () => {
    if (!peerConnected) {
      Alert.alert("Not connected", "Wait for peer to connect first.");
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const FS = (await import("expo-file-system")) as any;
      const info = await FS.getInfoAsync(asset.uri, { size: true });
      const actualSize = info.size ?? asset.size ?? 0;
      await sendFile(
        asset.uri,
        asset.name,
        actualSize,
        asset.mimeType ?? "application/octet-stream"
      );
    } catch (err) {
      Alert.alert("Error", "Could not pick file.");
    }
  }, [peerConnected, sendFile]);

  const pickMedia = useCallback(async () => {
    if (!peerConnected) {
      Alert.alert("Not connected", "Wait for peer to connect first.");
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow media access to pick photos/videos.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.9,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.uri.split("/").pop() ?? "media";
      const mimeType = asset.type === "video" ? "video/mp4" : "image/jpeg";
      const fileSize = asset.fileSize ?? 0;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await sendFile(asset.uri, fileName, fileSize, mimeType);
    } catch (err) {
      Alert.alert("Error", "Could not pick media.");
    }
  }, [peerConnected, sendFile]);

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Pressable
          onPress={pickMedia}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnMedia,
            pressed && styles.actionBtnPressed,
            !peerConnected && styles.actionBtnDisabled,
          ]}
        >
          <Feather name="image" size={22} color={Colors.primary} />
          <Text style={[styles.actionLabel, { color: Colors.primary }]}>
            Photos & Videos
          </Text>
        </Pressable>
        <Pressable
          onPress={pickDocument}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnDoc,
            pressed && styles.actionBtnPressed,
            !peerConnected && styles.actionBtnDisabled,
          ]}
        >
          <Feather name="file" size={22} color={Colors.accent} />
          <Text style={[styles.actionLabel, { color: Colors.accent }]}>
            Documents
          </Text>
        </Pressable>
      </View>

      {!peerConnected && (
        <View style={styles.waitBanner}>
          <Feather name="wifi" size={14} color={Colors.warning} />
          <Text style={styles.waitText}>
            Waiting for peer to connect before sending files
          </Text>
        </View>
      )}

      {transfers.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="send" size={36} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>No transfers yet</Text>
          <Text style={styles.emptyDesc}>
            Pick photos, videos, or documents above to send them instantly to
            your peer over WiFi
          </Text>
        </View>
      ) : (
        <FlatList
          data={transfers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TransferItem transfer={item} />}
          ItemSeparatorComponent={() => (
            <View
              style={{ height: 1, backgroundColor: Colors.border, marginHorizontal: 16 }}
            />
          )}
          contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  actionBtnMedia: {
    backgroundColor: Colors.primary + "11",
    borderColor: Colors.primary + "44",
  },
  actionBtnDoc: {
    backgroundColor: Colors.accent + "11",
    borderColor: Colors.accent + "44",
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  waitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    backgroundColor: Colors.warning + "11",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.warning + "33",
  },
  waitText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.warning,
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
    paddingVertical: 40,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    color: Colors.textPrimary,
  },
  emptyDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  transferItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: {
    flex: 1,
    gap: 4,
  },
  fileName: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.textPrimary,
  },
  fileMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
  },
  progressBar: {
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 4,
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.danger,
  },
  transferStatus: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
  },
  progressInfo: {
    alignItems: "center",
    gap: 4,
  },
  progressPct: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
  },
  saveBtn: {
    padding: 6,
  },
});
