import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

const CHUNK_MS = 1200;

interface VoiceWalkieProps {
  peerConnected: boolean;
  bottomInset?: number;
}

export function VoiceWalkie({ peerConnected, bottomInset = 0 }: VoiceWalkieProps) {
  const [permGranted, setPermGranted] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState("Idle");
  const recordingRef = useRef<Audio.Recording | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted }) => {
      setPermGranted(granted);
      if (granted) {
        Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });
      }
    });
  }, []);

  useEffect(() => {
    const unsub = onEvent("audio-chunk", async (data: { chunk: string }) => {
      try {
        setIsSpeaking(true);
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:audio/m4a;base64,${data.chunk}` },
          { shouldPlay: true, volume: 1.0 }
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((s) => {
          if ("didJustFinish" in s && s.didJustFinish) setIsSpeaking(false);
        });
      } catch (e) {
        setIsSpeaking(false);
      }
    });
    return () => { unsub(); soundRef.current?.unloadAsync(); };
  }, [onEvent]);

  const sendChunk = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      if (uri) {
        const base64 = await (FileSystem as any).readAsStringAsync(uri, {
          encoding: 'base64',
        });
        emitEvent("audio-chunk", { chunk: base64 });
      }
      const newRec = new Audio.Recording();
      await newRec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRec.startAsync();
      recordingRef.current = newRec;
    } catch {}
  }, [emitEvent]);

  const startTalking = useCallback(async () => {
    if (!permGranted || !peerConnected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setStatus("Transmitting...");
    try {
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setIsRecording(true);
      chunkTimerRef.current = setInterval(sendChunk, CHUNK_MS);
    } catch (e) {
      setStatus("Error starting mic");
    }
  }, [permGranted, peerConnected, sendChunk]);

  const stopTalking = useCallback(async () => {
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
      recordingRef.current = null;
    }
    setIsRecording(false);
    setStatus("Idle");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  useEffect(() => () => { stopTalking(); }, []);

  if (permGranted === null) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (!permGranted) {
    return (
      <View style={styles.center}>
        <Feather name="mic-off" size={40} color={Colors.textSecondary} />
        <Text style={styles.titleText}>Microphone Needed</Text>
        <Text style={styles.descText}>Allow microphone access for walkie-talkie</Text>
        <Pressable onPress={() => Audio.requestPermissionsAsync().then(({ granted }) => setPermGranted(granted))} style={styles.grantBtn}>
          <Text style={styles.grantBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, { backgroundColor: isSpeaking ? Colors.accent : isRecording ? Colors.danger : Colors.textSecondary }]} />
        <Text style={styles.statusText}>
          {isSpeaking ? "Peer is talking..." : isRecording ? "You are transmitting" : peerConnected ? "Ready — hold to talk" : "Waiting for peer..."}
        </Text>
      </View>

      <View style={styles.pttArea}>
        <View style={[styles.pttRing, isRecording && styles.pttRingActive]}>
          <Pressable
            onPressIn={startTalking}
            onPressOut={stopTalking}
            disabled={!peerConnected}
            style={[styles.pttBtn, isRecording && styles.pttBtnActive, !peerConnected && styles.pttBtnDisabled]}
          >
            <Feather name={isRecording ? "mic" : "mic-off"} size={44} color={isRecording ? Colors.dark : Colors.textSecondary} />
          </Pressable>
        </View>
        <Text style={styles.pttLabel}>
          {peerConnected ? "Hold to Talk" : "Waiting for peer"}
        </Text>
      </View>

      {isSpeaking && (
        <View style={styles.speakingBanner}>
          <Feather name="volume-2" size={16} color={Colors.accent} />
          <Text style={styles.speakingText}>Peer is speaking</Text>
          <ActivityIndicator size="small" color={Colors.accent} />
        </View>
      )}

      <View style={styles.instructions}>
        {[
          { icon: "mic" as const, text: "Hold the button to transmit your voice" },
          { icon: "volume-2" as const, text: "Release to stop — peer hears you in real time" },
          { icon: "wifi" as const, text: "Audio relayed over WiFi via server" },
        ].map((item) => (
          <View key={item.text} style={styles.instructionRow}>
            <Feather name={item.icon} size={14} color={Colors.textSecondary} />
            <Text style={styles.instructionText}>{item.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  titleText: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  descText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  grantBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  grantBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  statusBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    margin: 16, padding: 14,
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.textPrimary },
  pttArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24 },
  pttRing: {
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 3, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  pttRingActive: { borderColor: Colors.danger, borderWidth: 4 },
  pttBtn: {
    width: 150, height: 150, borderRadius: 75,
    backgroundColor: Colors.surface,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  pttBtnActive: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  pttBtnDisabled: { opacity: 0.3 },
  pttLabel: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.textSecondary },
  speakingBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    margin: 16, padding: 14,
    backgroundColor: Colors.accent + "22", borderRadius: 14, borderWidth: 1, borderColor: Colors.accent + "44",
  },
  speakingText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.accent, flex: 1 },
  instructions: { padding: 16, gap: 10 },
  instructionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  instructionText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1 },
});
