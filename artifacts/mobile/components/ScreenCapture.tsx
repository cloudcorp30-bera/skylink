import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as MediaLibrary from "expo-media-library";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface ScreenCaptureProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
  children?: React.ReactNode;
}

export function ScreenCapture({ role, peerConnected, bottomInset = 0, children }: ScreenCaptureProps) {
  const [peerScreenshot, setPeerScreenshot] = useState<string | null>(null);
  const [myScreenshot, setMyScreenshot] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [peerTimestamp, setPeerTimestamp] = useState<number | null>(null);
  const [history, setHistory] = useState<{ uri: string; ts: number; from: string }[]>([]);
  const viewShotRef = useRef<ViewShot>(null);
  const { emitEvent, onEvent } = useTransfer();
  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;

  useEffect(() => {
    const unsubReq = onEvent("screenshot-request", async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await sendMyScreen();
    });
    const unsubResp = onEvent("screenshot-response", (data: { image: string; timestamp: number }) => {
      setPeerScreenshot(`data:image/jpeg;base64,${data.image}`);
      setPeerTimestamp(data.timestamp);
      setRequesting(false);
      setHistory(h => [{ uri: `data:image/jpeg;base64,${data.image}`, ts: data.timestamp, from: "peer" }, ...h].slice(0, 20));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    return () => { unsubReq(); unsubResp(); };
  }, [onEvent]);

  const sendMyScreen = useCallback(async () => {
    try {
      setCapturing(true);
      const uri = await captureRef(viewShotRef, {
        format: "jpg",
        quality: 0.5,
        result: "base64",
      });
      emitEvent("screenshot-response", { image: uri, timestamp: Date.now() });
      setMyScreenshot(`data:image/jpeg;base64,${uri}`);
      setHistory(h => [{ uri: `data:image/jpeg;base64,${uri}`, ts: Date.now(), from: "self" }, ...h].slice(0, 20));
    } catch (e) {
      Alert.alert("Capture Failed", "Could not capture screen. Make sure you have a development build.");
    } finally {
      setCapturing(false);
    }
  }, [emitEvent]);

  const requestScreenshot = useCallback(() => {
    if (!peerConnected) return;
    setRequesting(true);
    setRequesting(true);
    emitEvent("screenshot-request", { timestamp: Date.now() });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => setRequesting(false), 10000);
  }, [peerConnected, emitEvent]);

  const saveToLibrary = useCallback(async (uri: string) => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed"); return; }
    try {
      await MediaLibrary.saveToLibraryAsync(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved!", "Screenshot saved to your photo library.");
    } catch {
      Alert.alert("Save Failed");
    }
  }, []);

  return (
    <ViewShot ref={viewShotRef} options={{ format: "jpg", quality: 0.5 }} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.actions}>
          <Pressable
            onPress={requestScreenshot}
            disabled={!peerConnected || requesting}
            style={[styles.actionBtn, { borderColor: accentColor + "55", backgroundColor: accentColor + "11" }, (!peerConnected || requesting) && { opacity: 0.4 }]}
          >
            {requesting ? <ActivityIndicator size="small" color={accentColor} /> : <Feather name="download" size={18} color={accentColor} />}
            <Text style={[styles.actionBtnText, { color: accentColor }]}>
              {requesting ? "Requesting..." : "Get Peer Screenshot"}
            </Text>
          </Pressable>
          <Pressable
            onPress={sendMyScreen}
            disabled={capturing}
            style={[styles.actionBtn, { borderColor: Colors.primary + "55", backgroundColor: Colors.primary + "11" }, capturing && { opacity: 0.4 }]}
          >
            {capturing ? <ActivityIndicator size="small" color={Colors.primary} /> : <Feather name="upload" size={18} color={Colors.primary} />}
            <Text style={[styles.actionBtnText, { color: Colors.primary }]}>
              {capturing ? "Capturing..." : "Send My Screen"}
            </Text>
          </Pressable>
        </View>

        {peerScreenshot && (
          <View style={styles.screenshotCard}>
            <View style={styles.cardHeader}>
              <Feather name="user" size={14} color={accentColor} />
              <Text style={[styles.cardTitle, { color: accentColor }]}>Peer Screen</Text>
              {peerTimestamp && <Text style={styles.cardTime}>{new Date(peerTimestamp).toLocaleTimeString()}</Text>}
              <Pressable onPress={() => saveToLibrary(peerScreenshot)} style={styles.saveBtn}>
                <Feather name="download" size={13} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <Image source={{ uri: peerScreenshot }} style={styles.screenshot} resizeMode="contain" />
          </View>
        )}

        {myScreenshot && (
          <View style={styles.screenshotCard}>
            <View style={styles.cardHeader}>
              <Feather name="smartphone" size={14} color={Colors.primary} />
              <Text style={[styles.cardTitle, { color: Colors.primary }]}>My Screen (sent)</Text>
              <Pressable onPress={() => saveToLibrary(myScreenshot)} style={styles.saveBtn}>
                <Feather name="download" size={13} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <Image source={{ uri: myScreenshot }} style={styles.screenshot} resizeMode="contain" />
          </View>
        )}

        {!peerScreenshot && !myScreenshot && (
          <View style={styles.empty}>
            <Feather name="monitor" size={44} color={Colors.textSecondary} />
            <Text style={styles.emptyTitle}>No Screenshots Yet</Text>
            <Text style={styles.emptyDesc}>
              {peerConnected
                ? "Request a screenshot from your peer or send your own screen"
                : "Connect to a peer to capture screens"}
            </Text>
          </View>
        )}

        {history.length > 1 && (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>History</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.historyScroll}>
              {history.map((item, i) => (
                <Pressable key={i} onPress={() => {
                  if (item.from === "peer") setPeerScreenshot(item.uri);
                  else setMyScreenshot(item.uri);
                }}>
                  <View style={styles.historyItem}>
                    <Image source={{ uri: item.uri }} style={styles.historyThumb} resizeMode="cover" />
                    <Text style={styles.historyLabel}>{item.from === "peer" ? "Peer" : "Mine"}</Text>
                    <Text style={styles.historyTime}>{new Date(item.ts).toLocaleTimeString()}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.note}>
          <Feather name="info" size={13} color={Colors.textSecondary} />
          <Text style={styles.noteText}>Screen capture requires a native development build. Does not work in Expo Go.</Text>
        </View>
      </ScrollView>
    </ViewShot>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  actions: { gap: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  actionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 },
  screenshotCard: { backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 },
  cardTime: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  saveBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.dark, alignItems: "center", justifyContent: "center" },
  screenshot: { width: "100%", aspectRatio: 0.46, backgroundColor: "#000" },
  empty: { alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 60 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  emptyDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  historySection: { gap: 10 },
  historyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary },
  historyScroll: {},
  historyItem: { width: 80, marginRight: 10, gap: 4 },
  historyThumb: { width: 80, height: 140, borderRadius: 10, backgroundColor: Colors.surface },
  historyLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary, textAlign: "center" },
  historyTime: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, textAlign: "center" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  noteText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
});
