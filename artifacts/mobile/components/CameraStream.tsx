import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

// ── Tuning constants ────────────────────────────────────────────────────────
const TARGET_FPS        = 3;
const TARGET_INTERVAL   = Math.round(1000 / TARGET_FPS); // 333 ms
const JPEG_QUALITY      = 0.22;
const MAX_B64_BYTES     = 110_000; // drop frames over ~80 KB JPEG

interface CameraStreamProps {
  peerConnected: boolean;
  bottomInset?: number;
  autoStart?: boolean;
  externalFacing?: CameraType;
  onAutoStartDone?: () => void;
}

export function CameraStream({
  peerConnected,
  bottomInset = 0,
  autoStart = false,
  externalFacing,
  onAutoStartDone,
}: CameraStreamProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(externalFacing ?? "back");
  const [isStreaming, setIsStreaming] = useState(false);
  const [remoteFrame, setRemoteFrame] = useState<string | null>(null);
  const [peerStreaming, setPeerStreaming] = useState(false);
  const [viewMode, setViewMode] = useState<"local" | "remote">("remote");
  const [requestSent, setRequestSent] = useState(false);
  const [fps, setFps] = useState(0);

  const cameraRef       = useRef<CameraView>(null);
  const isStreamingRef  = useRef(false);          // controls the async capture loop
  const autoStartedRef  = useRef(false);
  const frameCountRef   = useRef(0);
  const fpsTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    if (externalFacing) setFacing(externalFacing);
  }, [externalFacing]);

  // ── Receive remote events ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub      = onEvent("camera-frame", (data: { frame: string }) => {
      setRemoteFrame(data.frame);
      setPeerStreaming(true);
    });
    const unsubStop  = onEvent("camera-stop", () => {
      setPeerStreaming(false);
      setRemoteFrame(null);
    });
    const unsubSwitch = onEvent("camera-switch-facing", () => {
      setFacing(f => (f === "back" ? "front" : "back"));
    });
    return () => { unsub(); unsubStop(); unsubSwitch(); };
  }, [onEvent]);

  // ── Sequential capture loop — never overlaps ──────────────────────────────
  const startStreaming = useCallback(async () => {
    if (!cameraRef.current || !peerConnected || isStreamingRef.current) return;
    isStreamingRef.current = true;
    setIsStreaming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // FPS counter
    frameCountRef.current = 0;
    fpsTimerRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    while (isStreamingRef.current) {
      const t0 = Date.now();
      try {
        if (!cameraRef.current) break;
        const photo = await cameraRef.current.takePictureAsync({
          quality: JPEG_QUALITY,
          base64: true,
          skipProcessing: true,
          shutterSound: false,
        } as Parameters<CameraView["takePictureAsync"]>[0]);

        if (photo?.base64 && isStreamingRef.current) {
          if (photo.base64.length <= MAX_B64_BYTES) {
            emitEvent("camera-frame", { frame: photo.base64 });
            frameCountRef.current += 1;
          }
        }
      } catch { /* camera not ready or unmounted — just wait */ }

      const elapsed = Date.now() - t0;
      const wait = Math.max(16, TARGET_INTERVAL - elapsed);
      await new Promise(r => setTimeout(r, wait));
    }
  }, [peerConnected, emitEvent]);

  const stopStreaming = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);
    setFps(0);
    if (fpsTimerRef.current) { clearInterval(fpsTimerRef.current); fpsTimerRef.current = null; }
    emitEvent("camera-stop", {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [emitEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStreamingRef.current = false;
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
    };
  }, []);

  // Auto-start (triggered remotely)
  useEffect(() => {
    if (autoStart && !autoStartedRef.current && permission?.granted && peerConnected) {
      autoStartedRef.current = true;
      setViewMode("local");
      setTimeout(() => {
        startStreaming();
        onAutoStartDone?.();
      }, 600);
    }
  }, [autoStart, permission?.granted, peerConnected, startStreaming, onAutoStartDone]);

  const requestStream = useCallback(() => {
    if (!peerConnected) return;
    emitEvent("camera-request-stream", {});
    setRequestSent(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => setRequestSent(false), 8000);
  }, [peerConnected, emitEvent]);

  const requestFacingSwitch = useCallback(() => {
    if (!peerConnected) return;
    emitEvent("camera-switch-facing", {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [peerConnected, emitEvent]);

  // ── Permission screens ────────────────────────────────────────────────────
  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
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

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      {/* View toggle */}
      <View style={styles.viewToggle}>
        {(["remote", "local"] as const).map(mode => (
          <Pressable
            key={mode}
            onPress={() => setViewMode(mode)}
            style={[styles.toggleBtn, viewMode === mode && styles.toggleBtnActive]}
          >
            <Feather
              name={mode === "remote" ? "eye" : "video"}
              size={14}
              color={viewMode === mode ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.toggleLabel, viewMode === mode && { color: Colors.primary }]}>
              {mode === "remote" ? "Peer Camera" : "Your Camera"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Stream box */}
      <View style={styles.streamBox}>
        {viewMode === "remote" ? (
          remoteFrame ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${remoteFrame}` }}
              style={styles.streamView}
              resizeMode="cover"
              fadeDuration={0}
            />
          ) : (
            <View style={styles.noStreamBox}>
              <Feather name="video-off" size={40} color={Colors.textSecondary} />
              <Text style={styles.noStreamText}>
                {peerConnected ? "Peer is not streaming" : "Waiting for peer to connect"}
              </Text>
              {peerConnected && (
                <View style={styles.remoteActions}>
                  <Pressable
                    onPress={requestStream}
                    disabled={requestSent}
                    style={[styles.requestBtn, requestSent && styles.requestBtnSent]}
                  >
                    <Feather
                      name={requestSent ? "clock" : "video"}
                      size={16}
                      color={requestSent ? Colors.textSecondary : Colors.dark}
                    />
                    <Text style={[styles.requestBtnText, requestSent && { color: Colors.textSecondary }]}>
                      {requestSent ? "Request sent..." : "Request Stream"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={requestFacingSwitch} style={styles.switchBtn}>
                    <Feather name="refresh-cw" size={16} color={Colors.accent} />
                    <Text style={styles.switchBtnText}>Switch Camera</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )
        ) : (
          <CameraView ref={cameraRef} style={styles.streamView} facing={facing} />
        )}

        {/* Live badge + FPS */}
        {peerStreaming && viewMode === "remote" && (
          <>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <Pressable onPress={requestFacingSwitch} style={styles.remoteFlipBtn}>
              <Feather name="refresh-cw" size={16} color="white" />
            </Pressable>
          </>
        )}

        {/* Local streaming status */}
        {viewMode === "local" && isStreaming && (
          <View style={styles.streamingBadge}>
            <View style={styles.streamingDot} />
            <Text style={styles.streamingText}>{fps} fps</Text>
          </View>
        )}

        {/* Flip (local) */}
        {viewMode === "local" && (
          <Pressable
            onPress={() => setFacing(f => (f === "back" ? "front" : "back"))}
            style={styles.flipBtn}
          >
            <Feather name="refresh-cw" size={20} color={Colors.textPrimary} />
          </Pressable>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {viewMode === "local" && (
          isStreaming ? (
            <Pressable onPress={stopStreaming} style={[styles.streamBtn, styles.streamBtnStop]}>
              <Feather name="square" size={20} color="white" />
              <Text style={[styles.streamBtnLabel, { color: "white" }]}>Stop Streaming</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={startStreaming}
              style={[styles.streamBtn, !peerConnected && styles.streamBtnDisabled]}
              disabled={!peerConnected}
            >
              <Feather name="video" size={20} color={Colors.dark} />
              <Text style={styles.streamBtnLabel}>
                {peerConnected ? "Start Streaming to Peer" : "Waiting for peer..."}
              </Text>
            </Pressable>
          )
        )}
        <Text style={styles.hint}>
          {viewMode === "local"
            ? isStreaming
              ? `Streaming at ${fps} fps — sequential capture, no overlap`
              : "Your camera will stream to peer when started"
            : "Tap Request Stream to ask the peer to start their camera"}
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
  permBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  permBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  viewToggle: {
    flexDirection: "row", margin: 12,
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 4, gap: 4,
  },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10, gap: 6 },
  toggleBtnActive: { backgroundColor: Colors.primary + "22" },
  toggleLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  streamBox: {
    flex: 1, marginHorizontal: 12, borderRadius: 20, overflow: "hidden",
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, position: "relative",
  },
  streamView: { flex: 1 },
  noStreamBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  noStreamText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  remoteActions: { gap: 10, width: "100%", alignItems: "center" },
  requestBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 14, width: "80%", justifyContent: "center",
  },
  requestBtnSent: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  requestBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.dark },
  switchBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 12, width: "80%", justifyContent: "center",
  },
  switchBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.accent },
  liveBadge: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.danger, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "white" },
  liveText: { fontFamily: "Inter_700Bold", fontSize: 11, color: "white", letterSpacing: 1 },
  streamingBadge: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  streamingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.danger },
  streamingText: { fontFamily: "Inter_700Bold", fontSize: 11, color: "white", letterSpacing: 0.8 },
  remoteFlipBtn: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: "rgba(0,0,0,0.55)", width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  flipBtn: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: "rgba(0,0,0,0.55)", width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },
  controls: { padding: 12, gap: 10 },
  streamBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 16,
  },
  streamBtnStop: { backgroundColor: Colors.danger },
  streamBtnDisabled: { opacity: 0.4 },
  streamBtnLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, textAlign: "center", lineHeight: 18 },
});
