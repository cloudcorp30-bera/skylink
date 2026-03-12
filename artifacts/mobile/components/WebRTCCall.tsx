import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View, Platform,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

// react-native-webrtc requires a native build. We dynamically import to
// avoid crashing in Expo Go where the native module is unavailable.
let RTCPeerConnection: any = null;
let RTCSessionDescription: any = null;
let RTCIceCandidate: any = null;
let mediaDevices: any = null;
let RTCView: any = null;

try {
  const webrtc = require("react-native-webrtc");
  RTCPeerConnection = webrtc.RTCPeerConnection;
  RTCSessionDescription = webrtc.RTCSessionDescription;
  RTCIceCandidate = webrtc.RTCIceCandidate;
  mediaDevices = webrtc.mediaDevices;
  RTCView = webrtc.RTCView;
} catch {}

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.ekiga.net" },
];

type CallState = "idle" | "calling" | "ringing" | "connected" | "ended";

interface WebRTCCallProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

export function WebRTCCall({ role, peerConnected, bottomInset = 0 }: WebRTCCallProps) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const [nativeAvailable] = useState(() => !!RTCPeerConnection);
  const pcRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { emitEvent, onEvent } = useTransfer();
  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;

  useEffect(() => {
    const unsubOffer = onEvent("webrtc-offer", async (data: { sdp: string }) => {
      if (!nativeAvailable) return;
      setCallState("ringing");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await setupPeerConnection(false);
      try {
        await pcRef.current?.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
      } catch {}
    });

    const unsubAnswer = onEvent("webrtc-answer", async (data: { sdp: string }) => {
      if (!nativeAvailable || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
        setCallState("connected");
        startTimer();
      } catch {}
    });

    const unsubICE = onEvent("webrtc-ice", async (data: { candidate: any }) => {
      try {
        await pcRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {}
    });

    const unsubHangup = onEvent("webrtc-hangup", () => {
      hangup(false);
    });

    return () => { unsubOffer(); unsubAnswer(); unsubICE(); unsubHangup(); };
  }, [onEvent, nativeAvailable]);

  useEffect(() => () => { hangup(false); }, []);

  const startTimer = useCallback(() => {
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setDuration(0);
  }, []);

  const setupPeerConnection = useCallback(async (isInitiator: boolean) => {
    if (!nativeAvailable) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (e: any) => {
      if (e.candidate) emitEvent("webrtc-ice", { candidate: e.candidate });
    };

    pc.ontrack = (e: any) => {
      setRemoteStream(e.streams?.[0] ?? null);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") { setCallState("connected"); startTimer(); }
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) hangup(false);
    };

    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user", width: 640, height: 480 } });
      setLocalStream(stream);
      stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
    } catch (e) {
      console.warn("No media:", e);
    }
  }, [nativeAvailable, emitEvent, startTimer]);

  const startCall = useCallback(async () => {
    if (!peerConnected || !nativeAvailable) return;
    setCallState("calling");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await setupPeerConnection(true);
    try {
      const offer = await pcRef.current?.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pcRef.current?.setLocalDescription(offer);
      emitEvent("webrtc-offer", { sdp: offer.sdp });
    } catch {}
  }, [peerConnected, nativeAvailable, setupPeerConnection, emitEvent]);

  const answerCall = useCallback(async () => {
    setCallState("connected");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const answer = await pcRef.current?.createAnswer();
      await pcRef.current?.setLocalDescription(answer);
      emitEvent("webrtc-answer", { sdp: answer.sdp });
      startTimer();
    } catch {}
  }, [emitEvent, startTimer]);

  const hangup = useCallback((notify = true) => {
    if (notify) emitEvent("webrtc-hangup", {});
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks?.()?.forEach((t: any) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setCallState("idle");
    stopTimer();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [localStream, emitEvent, stopTimer]);

  const toggleMute = useCallback(() => {
    localStream?.getAudioTracks?.()?.forEach((t: any) => { t.enabled = isMuted; });
    setIsMuted(m => !m);
    Haptics.selectionAsync();
  }, [localStream, isMuted]);

  const toggleVideo = useCallback(() => {
    localStream?.getVideoTracks?.()?.forEach((t: any) => { t.enabled = !isVideoOn; });
    setIsVideoOn(v => !v);
    Haptics.selectionAsync();
  }, [localStream, isVideoOn]);

  function fmtDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  if (!nativeAvailable) {
    return (
      <View style={[styles.container, styles.center, { paddingBottom: bottomInset }]}>
        <Feather name="phone-off" size={48} color={Colors.textSecondary} />
        <Text style={styles.unavailTitle}>Native Build Required</Text>
        <Text style={styles.unavailDesc}>WebRTC P2P calling uses react-native-webrtc which is a native module. Build with EAS (eas build --profile development) and run on a real device to use this feature.</Text>
        <View style={styles.infoCard}>
          {[
            ["No server relay", "Audio/video go peer-to-peer via WebRTC"],
            ["STUN servers", "Google STUN for NAT traversal"],
            ["ICE signaling", "Via SkyLink relay server only for handshake"],
            ["Codec", "VP8 video + Opus audio"],
          ].map(([title, desc]) => (
            <View key={title} style={styles.infoRow}>
              <Feather name="check" size={13} color={Colors.success} />
              <View>
                <Text style={styles.infoTitle}>{title}</Text>
                <Text style={styles.infoDesc}>{desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      {callState === "connected" && remoteStream && RTCView ? (
        <View style={styles.videoContainer}>
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
            mirror={false}
          />
          {localStream && RTCView && (
            <RTCView
              streamURL={localStream.toURL()}
              style={styles.localVideo}
              objectFit="cover"
              mirror
            />
          )}
          <View style={styles.callOverlay}>
            <View style={styles.timerBadge}>
              <View style={styles.timerDot} />
              <Text style={styles.timerText}>{fmtDuration(duration)}</Text>
            </View>
          </View>
          <View style={styles.callControls}>
            <Pressable onPress={toggleMute} style={[styles.ctrlBtn, isMuted && { backgroundColor: Colors.warning }]}>
              <Feather name={isMuted ? "mic-off" : "mic"} size={22} color="white" />
            </Pressable>
            <Pressable onPress={() => hangup(true)} style={[styles.ctrlBtn, styles.hangupBtn]}>
              <Feather name="phone-off" size={22} color="white" />
            </Pressable>
            <Pressable onPress={toggleVideo} style={[styles.ctrlBtn, !isVideoOn && { backgroundColor: Colors.warning }]}>
              <Feather name={isVideoOn ? "video" : "video-off"} size={22} color="white" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.center, { flex: 1 }]}>
          {callState === "idle" && (
            <>
              <View style={[styles.avatarLarge, { borderColor: accentColor }]}>
                <Feather name="phone" size={44} color={accentColor} />
              </View>
              <Text style={styles.callTitle}>P2P WebRTC Call</Text>
              <Text style={styles.callDesc}>
                {peerConnected ? "Direct peer-to-peer — no server relay for audio/video" : "Waiting for peer to connect..."}
              </Text>
              <Pressable
                onPress={startCall}
                disabled={!peerConnected}
                style={[styles.callBtn, { backgroundColor: accentColor }, !peerConnected && { opacity: 0.4 }]}
              >
                <Feather name="phone" size={22} color="white" />
                <Text style={styles.callBtnText}>Start Call</Text>
              </Pressable>
            </>
          )}

          {callState === "calling" && (
            <>
              <ActivityIndicator size="large" color={accentColor} />
              <Text style={styles.callTitle}>Calling peer...</Text>
              <Text style={styles.callDesc}>Establishing P2P connection</Text>
              <Pressable onPress={() => hangup(true)} style={[styles.callBtn, { backgroundColor: Colors.danger }]}>
                <Feather name="phone-off" size={22} color="white" />
                <Text style={styles.callBtnText}>Cancel</Text>
              </Pressable>
            </>
          )}

          {callState === "ringing" && (
            <>
              <View style={[styles.avatarLarge, { borderColor: Colors.success }]}>
                <Feather name="phone-incoming" size={44} color={Colors.success} />
              </View>
              <Text style={styles.callTitle}>Incoming Call</Text>
              <Text style={styles.callDesc}>Your peer wants to start a P2P call</Text>
              <View style={styles.answerRow}>
                <Pressable onPress={() => hangup(true)} style={[styles.callBtn, { backgroundColor: Colors.danger, flex: 1 }]}>
                  <Feather name="phone-off" size={20} color="white" />
                  <Text style={styles.callBtnText}>Decline</Text>
                </Pressable>
                <Pressable onPress={answerCall} style={[styles.callBtn, { backgroundColor: Colors.success, flex: 1 }]}>
                  <Feather name="phone" size={20} color="white" />
                  <Text style={styles.callBtnText}>Answer</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark },
  center: { alignItems: "center", justifyContent: "center", gap: 20, padding: 32 },
  unavailTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary, textAlign: "center" },
  unavailDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  infoCard: { backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 18, width: "100%", gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  infoTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textPrimary },
  infoDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  avatarLarge: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface },
  callTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.textPrimary },
  callDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  callBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 50 },
  callBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "white" },
  answerRow: { flexDirection: "row", gap: 16, width: "100%" },
  videoContainer: { flex: 1, position: "relative" },
  remoteVideo: { flex: 1, backgroundColor: "#000" },
  localVideo: { position: "absolute", top: 20, right: 16, width: 100, height: 140, borderRadius: 14, borderWidth: 2, borderColor: "white", overflow: "hidden", backgroundColor: "#000" },
  callOverlay: { position: "absolute", top: 20, left: 16 },
  timerBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#00000088", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  timerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.danger },
  timerText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "white" },
  callControls: { position: "absolute", bottom: 40, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 24 },
  ctrlBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#00000088", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#ffffff33" },
  hangupBtn: { backgroundColor: Colors.danger },
});
