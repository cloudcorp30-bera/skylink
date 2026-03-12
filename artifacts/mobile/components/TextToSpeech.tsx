import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

const QUICK_PHRASES = [
  "Hello! Can you hear me?",
  "Please call me back.",
  "I'm on my way.",
  "Are you there?",
  "This is a test message.",
  "Please respond when you can.",
  "Turn up the volume.",
  "I need your attention.",
];

interface TextToSpeechProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

export function TextToSpeech({ role, peerConnected, bottomInset = 0 }: TextToSpeechProps) {
  const [textToSend, setTextToSend] = useState("");
  const [incomingText, setIncomingText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [rate, setRate] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    Speech.getAvailableVoicesAsync().then((v) => {
      const english = v.filter((x) => x.language?.startsWith("en"));
      setVoices(english.slice(0, 8));
    });
  }, []);

  useEffect(() => {
    const unsub = onEvent("tts-speak", (data: { text: string }) => {
      setIncomingText(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakText(data.text);
    });
    return () => { unsub(); Speech.stop(); };
  }, [onEvent, selectedVoice, rate, pitch]);

  const speakText = useCallback((text: string) => {
    Speech.stop();
    setIsSpeaking(true);
    Speech.speak(text, {
      language: "en-US",
      voice: selectedVoice ?? undefined,
      rate,
      pitch,
      onDone: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  }, [selectedVoice, rate, pitch]);

  const sendToSpeak = useCallback((text: string) => {
    if (!text.trim() || !peerConnected) return;
    emitEvent("tts-speak", { text: text.trim() });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Sent!", "Your peer's device will read this aloud.");
    setTextToSend("");
  }, [peerConnected, emitEvent]);

  const speakLocal = useCallback(() => {
    if (!textToSend.trim()) return;
    speakText(textToSend.trim());
  }, [textToSend, speakText]);

  const accentColor = role === "sky" ? Colors.primary : Colors.accent;

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
      {incomingText && (
        <View style={styles.incomingCard}>
          <View style={styles.incomingHeader}>
            <Feather name="volume-2" size={16} color={Colors.success} />
            <Text style={styles.incomingTitle}>Message from Peer</Text>
            {isSpeaking && <Text style={styles.speakingBadge}>SPEAKING</Text>}
          </View>
          <Text style={styles.incomingText}>{incomingText}</Text>
          <View style={styles.incomingActions}>
            <Pressable onPress={() => speakText(incomingText)} style={[styles.replayBtn, { borderColor: Colors.success + "55" }]}>
              <Feather name="repeat" size={14} color={Colors.success} />
              <Text style={[styles.replayBtnText, { color: Colors.success }]}>Replay</Text>
            </Pressable>
            <Pressable onPress={() => setIncomingText(null)} style={styles.dismissBtn}>
              <Text style={styles.dismissBtnText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Make Peer's Phone Speak</Text>
        <TextInput
          style={styles.input}
          value={textToSend}
          onChangeText={setTextToSend}
          placeholder="Type what you want to say on their phone..."
          placeholderTextColor={Colors.textSecondary}
          multiline
          maxLength={500}
        />
        <View style={styles.inputActions}>
          <Pressable onPress={speakLocal} style={styles.localBtn}>
            <Feather name="play" size={14} color={accentColor} />
            <Text style={[styles.localBtnText, { color: accentColor }]}>Preview</Text>
          </Pressable>
          <Pressable
            onPress={() => sendToSpeak(textToSend)}
            style={[styles.sendBtn, { backgroundColor: accentColor }, (!peerConnected || !textToSend.trim()) && styles.btnDisabled]}
            disabled={!peerConnected || !textToSend.trim()}
          >
            <Feather name="volume-2" size={16} color={Colors.dark} />
            <Text style={styles.sendBtnText}>{peerConnected ? "Speak on Peer" : "Waiting..."}</Text>
          </Pressable>
        </View>
        <Text style={styles.charCount}>{textToSend.length}/500</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Phrases</Text>
        <View style={styles.phrasesGrid}>
          {QUICK_PHRASES.map((phrase) => (
            <Pressable
              key={phrase}
              onPress={() => setTextToSend(phrase)}
              style={styles.phraseChip}
            >
              <Text style={styles.phraseChipText}>{phrase}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Voice Settings</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Rate</Text>
          <View style={styles.rateButtons}>
            {[0.5, 0.75, 1.0, 1.25, 1.5].map((r) => (
              <Pressable
                key={r}
                onPress={() => setRate(r)}
                style={[styles.rateBtn, rate === r && { backgroundColor: accentColor + "33", borderColor: accentColor }]}
              >
                <Text style={[styles.rateBtnText, rate === r && { color: accentColor }]}>{r}x</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Pitch</Text>
          <View style={styles.rateButtons}>
            {[0.75, 0.9, 1.0, 1.1, 1.25].map((p) => (
              <Pressable
                key={p}
                onPress={() => setPitch(p)}
                style={[styles.rateBtn, pitch === p && { backgroundColor: accentColor + "33", borderColor: accentColor }]}
              >
                <Text style={[styles.rateBtnText, pitch === p && { color: accentColor }]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {voices.length > 0 && (
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Voice</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.voiceScroll}>
              {voices.map((v) => (
                <Pressable
                  key={v.identifier}
                  onPress={() => setSelectedVoice(v.identifier)}
                  style={[styles.voiceBtn, selectedVoice === v.identifier && { backgroundColor: accentColor + "33", borderColor: accentColor }]}
                >
                  <Text style={[styles.voiceBtnText, selectedVoice === v.identifier && { color: accentColor }]}>
                    {v.name?.replace("com.apple.", "") ?? v.identifier}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20 },
  incomingCard: { backgroundColor: Colors.success + "11", borderWidth: 1, borderColor: Colors.success + "44", borderRadius: 18, padding: 16, gap: 10 },
  incomingHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  incomingTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.success, flex: 1 },
  speakingBadge: { fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.success, letterSpacing: 0.5, backgroundColor: Colors.success + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  incomingText: { fontFamily: "Inter_400Regular", fontSize: 15, color: Colors.textPrimary, lineHeight: 22 },
  incomingActions: { flexDirection: "row", gap: 10 },
  replayBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  replayBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  dismissBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  dismissBtnText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  section: { gap: 12 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, minHeight: 90, textAlignVertical: "top" },
  inputActions: { flexDirection: "row", gap: 10 },
  localBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: Colors.border },
  localBtnText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14 },
  btnDisabled: { opacity: 0.4 },
  sendBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  charCount: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, textAlign: "right" },
  phrasesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  phraseChip: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  phraseChipText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  settingRow: { gap: 8 },
  settingLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  rateButtons: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  rateBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  rateBtnText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  voiceScroll: { maxHeight: 44 },
  voiceBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginRight: 8 },
  voiceBtnText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
});
