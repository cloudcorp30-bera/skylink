import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

const FRAME_INTERVAL_MS = 600;
const JPEG_QUALITY = 0.3;

interface CameraStreamProps {
  peerConnected: boolean;
  bottomInset?: number;
}

export function CameraStream({ peerConnected, bottomInset = 0 }: CameraStreamProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [isStreaming, setIsStreaming] = useState(false);
  const [remoteFrame, setRemoteFrame] = useState<string | null>(null);
  const [peerStreaming, setPeerStreaming] = useState(false);
  const [viewMode, setViewMode] = useState<"local" | "remote">("remote");
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    const unsub = onEvent("camera-frame", (data: { frame: string }) => {
      setRemoteFrame(data.frame);
      setPeerStreaming(true);
    });
    const unsubStop = onEvent("camera-stop", () => {
      setPeerStreaming(false);
      setRemoteFrame(null);
    });
    return () => { unsub(); unsubStop(); };
  }, [onEvent]);

  const startStreaming = useCallback(async () => {
    if (!cameraRef.current || !peerConnected) return;
    setIsStreaming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    intervalRef.current = setInterval(async () => {
      try {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({
          quality: JPEG_QUALITY,
          base64: true,
          skipProcessing: true,
          shutterSound: false,
        } as Parameters<CameraView["takePictureAsync"]>[0]);
        if (photo?.base64) {
          emitEvent("camera-frame", { frame: photo.base64 });
        }
      } catch {}
    }, FRAME_INTERVAL_MS);
  }, [peerConnected, emitEvent]);

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsStreaming(false);
    emitEvent("camera-stop", {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [emitEvent]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Feather name="camera-off" size={40} color={Colors.textSecondary} />
        <Text style={styles.permTitle}>Camera Access Needed</Text>
        <Text style={styles.permDesc}>Allow camera access to stream live video to your peer</Text>
        <Pressable onPress={requestPermission} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.viewToggle}>
        <Pressable
          onPress={() => setViewMode("remote")}
          style={[styles.toggleBtn, viewMode === "remote" && styles.toggleBtnActive]}
        >
          <Feather name="eye" size={14} color={viewMode === "remote" ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.toggleLabel, viewMode === "remote" && { color: Colors.primary }]}>
            Peer Camera
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode("local")}
          style={[styles.toggleBtn, viewMode === "local" && styles.toggleBtnActive]}
        >
          <Feather name="video" size={14} color={viewMode === "local" ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.toggleLabel, viewMode === "local" && { color: Colors.primary }]}>
            Your Camera
          </Text>
        </Pressable>
      </View>

      <View style={styles.streamBox}>
        {viewMode === "remote" ? (
          remoteFrame ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${remoteFrame}` }}
              style={styles.streamView}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.noStreamBox}>
              <Feather name="video-off" size={40} color={Colors.textSecondary} />
              <Text style={styles.noStreamText}>
                {peerConnected
                  ? peerStreaming
                    ? "Loading..."
                    : "Peer is not streaming yet"
                  : "Waiting for peer to connect"}
              </Text>
            </View>
          )
        ) : (
          <CameraView
            ref={cameraRef}
            style={styles.streamView}
            facing={facing}
          />
        )}

        {peerStreaming && viewMode === "remote" && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}

        {viewMode === "local" && (
          <Pressable
            onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
            style={styles.flipBtn}
          >
            <Feather name="refresh-cw" size={20} color={Colors.textPrimary} />
          </Pressable>
        )}
      </View>

      <View style={styles.controls}>
        {viewMode === "local" && (
          isStreaming ? (
            <Pressable onPress={stopStreaming} style={[styles.streamBtn, styles.streamBtnStop]}>
              <Feather name="square" size={20} color={Colors.dark} />
              <Text style={styles.streamBtnLabel}>Stop Streaming</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={startStreaming}
              style={[styles.streamBtn, !peerConnected && styles.streamBtnDisabled]}
              disabled={!peerConnected}
            >
              <Feather name="video" size={20} color={Colors.dark} />
              <Text style={styles.streamBtnLabel}>
                {peerConnected ? "Start Streaming" : "Waiting for peer..."}
              </Text>
            </Pressable>
          )
        )}

        <Text style={styles.hint}>
          {viewMode === "local"
            ? "Your camera feed streams to your peer in real time over WiFi"
            : "Your peer's camera stream — ask them to start streaming"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  permTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  permDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  permBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  permBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  viewToggle: {
    flexDirection: "row",
    margin: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  toggleBtnActive: { backgroundColor: Colors.primary + "22" },
  toggleLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  streamBox: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
  },
  streamView: { flex: 1 },
  noStreamBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 40,
  },
  noStreamText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  liveBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.danger,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "white" },
  liveText: { fontFamily: "Inter_700Bold", fontSize: 11, color: "white", letterSpacing: 1 },
  flipBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  controls: { padding: 16, gap: 12 },
  streamBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 16,
  },
  streamBtnStop: { backgroundColor: Colors.danger },
  streamBtnDisabled: { opacity: 0.4 },
  streamBtnLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  hint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
});
