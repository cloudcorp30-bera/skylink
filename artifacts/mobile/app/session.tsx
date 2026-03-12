import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraStream } from "@/components/CameraStream";
import { ChatInput } from "@/components/ChatInput";
import { ContactsShare } from "@/components/ContactsShare";
import { ControlPad } from "@/components/ControlPad";
import { DeviceControls } from "@/components/DeviceControls";
import { FileBrowser } from "@/components/FileBrowser";
import { FileTransferPanel } from "@/components/FileTransferPanel";
import { LocationShare } from "@/components/LocationShare";
import { MacroPad } from "@/components/MacroPad";
import { MessageBubble } from "@/components/MessageBubble";
import { NetworkInfo } from "@/components/NetworkInfo";
import { ScreenCapture } from "@/components/ScreenCapture";
import { SensorLogger } from "@/components/SensorLogger";
import { SessionLog } from "@/components/SessionLog";
import { StatusDot } from "@/components/StatusDot";
import { TextToSpeech } from "@/components/TextToSpeech";
import { VoiceWalkie } from "@/components/VoiceWalkie";
import { WebRTCCall } from "@/components/WebRTCCall";
import { WhiteboardPanel } from "@/components/WhiteboardPanel";
import { RemoteCommander } from "@/components/RemoteCommander";
import { DeviceDashboard } from "@/components/DeviceDashboard";
import Colors from "@/constants/colors";
import { useSkyLink } from "@/context/SkyLinkContext";
import { useTransfer } from "@/context/TransferContext";
import type { Message } from "@/context/SkyLinkContext";

type TabKey =
  | "chat" | "voice" | "call" | "files" | "browse"
  | "camera" | "board" | "location" | "controls"
  | "sensors" | "contacts" | "network" | "tts"
  | "macro" | "capture" | "log" | "remote" | "info"
  | "commander" | "dashboard";

const ALL_TABS: { key: TabKey; icon: keyof typeof Feather.glyphMap; label: string; skyOnly?: boolean }[] = [
  { key: "chat",     icon: "message-circle", label: "Chat" },
  { key: "voice",    icon: "mic",            label: "Voice" },
  { key: "call",     icon: "phone",          label: "Call" },
  { key: "files",    icon: "send",           label: "Send" },
  { key: "browse",   icon: "folder",         label: "Browse" },
  { key: "camera",   icon: "video",          label: "Camera" },
  { key: "board",    icon: "edit-3",         label: "Board" },
  { key: "location", icon: "map-pin",        label: "GPS" },
  { key: "controls", icon: "sliders",        label: "Controls" },
  { key: "sensors",  icon: "activity",       label: "Sensors" },
  { key: "contacts", icon: "users",          label: "Contacts" },
  { key: "network",  icon: "wifi",           label: "Network" },
  { key: "tts",      icon: "volume-2",       label: "Speak" },
  { key: "macro",    icon: "grid",           label: "Macros" },
  { key: "capture",  icon: "camera",         label: "Screen" },
  { key: "log",      icon: "list",           label: "Log" },
  { key: "commander", icon: "command",        label: "Command", skyOnly: true },
  { key: "dashboard", icon: "cpu",           label: "Device" },
  { key: "remote",    icon: "terminal",      label: "Remote", skyOnly: true },
  { key: "info",      icon: "info",          label: "Info" },
];

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}

export default function SessionScreen() {
  const insets = useSafeAreaInsets();
  const { role, roomId, peerConnected: localPeerConnected, peerName, disconnect } = useSkyLink();
  const {
    socketConnected, peerPresent,
    connectToRoom, disconnectFromRoom,
    sendChatMessage, onMessageReceived,
    sendControl, onControlReceived,
    transfers,
  } = useTransfer();

  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const hasConnectedRef = useRef(false);

  const topInset = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;
  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;
  const isPeerConnected = peerPresent || localPeerConnected;

  const addMessage = useCallback((
    type: Message["type"], content: string, sender: Message["sender"], extras?: Partial<Message>
  ) => {
    setMessages(prev => [{ id: generateId(), type, content, sender, timestamp: Date.now(), ...extras }, ...prev]);
  }, []);

  useEffect(() => {
    if (!roomId || !role || hasConnectedRef.current) return;
    hasConnectedRef.current = true;
    connectToRoom(roomId, role, isSky ? "Sky Controller" : "Link Device");
    addMessage("system", `Session ${roomId} started.`, "system");
  }, [roomId, role]);

  useEffect(() => onMessageReceived(msg => addMessage("text", msg.content, "peer")), [onMessageReceived, addMessage]);

  useEffect(() => onControlReceived(cmd => addMessage("control", `Received: ${cmd.command}`, "peer", { controlCommand: cmd.command })), [onControlReceived, addMessage]);

  useEffect(() => {
    if (peerPresent) addMessage("system", `${isSky ? "Link" : "Sky"} connected.`, "system");
  }, [peerPresent]);

  const handleSendMessage = useCallback((content: string) => {
    sendChatMessage(content);
    addMessage("text", content, "self");
  }, [sendChatMessage, addMessage]);

  const handleSendControl = useCallback((command: string) => {
    sendControl(command);
    addMessage("control", `Sent: ${command}`, "self", { controlCommand: command });
  }, [sendControl, addMessage]);

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "End this SkyLink session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect", style: "destructive",
        onPress: () => { disconnectFromRoom(); disconnect(); router.replace("/"); },
      },
    ]);
  };

  const visibleTabs = ALL_TABS.filter(t => !t.skyOnly || isSky);
  const isPeerConn = isPeerConnected;

  const statusText = socketConnected
    ? isPeerConn ? `${peerName ?? (isSky ? "Link" : "Sky")} connected` : "Waiting for peer..."
    : "Connecting...";
  const connStatus = socketConnected ? (isPeerConn ? "connected" : "connecting") : "connecting";

  return (
    <View style={[styles.root, { paddingTop: topInset }]}>
      <LinearGradient colors={["#060C1A", "#0A0E1A", "#060C1A"]} style={StyleSheet.absoluteFill} />

      {/* Nav Bar */}
      <View style={styles.navBar}>
        <Pressable onPress={handleDisconnect} style={styles.endBtn} hitSlop={12}>
          <Feather name="x" size={20} color={Colors.danger} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>{isSky ? "Sky" : "Link"} · {roomId}</Text>
          <View style={styles.statusRow}>
            <StatusDot status={connStatus} size={6} />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        </View>
        <View style={[styles.rolePill, { backgroundColor: accentColor + "22", borderColor: accentColor + "55" }]}>
          <Text style={[styles.roleText, { color: accentColor }]}>{isSky ? "SKY" : "LINK"}</Text>
        </View>
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
        {visibleTabs.map(tab => (
          <Pressable
            key={tab.key}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(tab.key); }}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          >
            <Feather name={tab.icon} size={14} color={activeTab === tab.key ? accentColor : Colors.textSecondary} />
            <Text style={[styles.tabLabel, activeTab === tab.key && { color: accentColor }]}>{tab.label}</Text>
            {activeTab === tab.key && <View style={[styles.tabIndicator, { backgroundColor: accentColor }]} />}
          </Pressable>
        ))}
      </ScrollView>

      {/* Chat */}
      {activeTab === "chat" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="message-circle" size={40} color={Colors.textSecondary} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyDesc}>{isPeerConn ? "Start the conversation!" : "Waiting for peer to connect..."}</Text>
            </View>
          ) : (
            <FlatList
              data={messages}
              keyExtractor={item => item.id}
              renderItem={({ item }) => <MessageBubble message={item} />}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              inverted
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
            />
          )}
          <View style={{ paddingBottom: bottomInset }}>
            <ChatInput onSend={handleSendMessage} disabled={!isPeerConn} placeholder={isPeerConn ? "Message..." : "Waiting for peer..."} />
          </View>
        </KeyboardAvoidingView>
      )}

      {activeTab === "voice"    && <VoiceWalkie      peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "call"     && <WebRTCCall        role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "files"    && <FileTransferPanel peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "browse"   && <FileBrowser       peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "camera"   && <CameraStream      peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "board"    && <WhiteboardPanel   peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "location" && <LocationShare     peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "controls" && <DeviceControls    role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "sensors"  && <SensorLogger      peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "contacts" && <ContactsShare     peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "network"  && <NetworkInfo       peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "tts"      && <TextToSpeech      role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "macro"    && <MacroPad          role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "capture"  && <ScreenCapture     role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "log"       && <SessionLog        role={role ?? "link"} roomId={roomId ?? ""} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "commander" && <RemoteCommander   role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}
      {activeTab === "dashboard" && <DeviceDashboard   role={role ?? "link"} peerConnected={isPeerConn} bottomInset={bottomInset} />}

      {/* Remote (Sky only) */}
      {activeTab === "remote" && isSky && (
        <ScrollView contentContainerStyle={[styles.scrollPad, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          {!isPeerConn && (
            <View style={styles.warnBanner}>
              <Feather name="alert-circle" size={16} color={Colors.warning} />
              <Text style={styles.warnText}>Controls disabled until Link connects</Text>
            </View>
          )}
          <Text style={styles.sectionTitle}>Remote Control Pad</Text>
          <Text style={styles.sectionDesc}>Send directional commands to the Link device in real time.</Text>
          <ControlPad onCommand={handleSendControl} disabled={!isPeerConn} />
        </ScrollView>
      )}

      {/* Info */}
      {activeTab === "info" && (
        <ScrollView contentContainerStyle={[styles.scrollPad, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>Session Details</Text>
            {[
              ["Room ID", roomId ?? "—"],
              ["Your Role", isSky ? "Sky (Controller)" : "Link (Device)"],
              ["Peer", peerName ?? "Not connected"],
              ["Socket", socketConnected ? "Connected" : "Offline"],
              ["Peer Present", isPeerConn ? "Yes" : "No"],
              ["Messages", messages.filter(m => m.type === "text").length.toString()],
              ["Transfers", transfers.length.toString()],
            ].map(([label, value]) => (
              <View key={label} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue}>{value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>All 18 Features</Text>
            {[
              ["message-circle", "Real-Time Chat"],
              ["mic",            "Walkie-Talkie (Push to Talk)"],
              ["phone",          "P2P WebRTC Audio/Video Call"],
              ["send",           "File Transfer (Chunked, 64KB)"],
              ["folder",         "File Browser & Cache Manager"],
              ["video",          "Live Camera Stream"],
              ["edit-3",         "Collaborative Whiteboard"],
              ["map-pin",        "GPS Location Sharing"],
              ["sliders",        "Device Controls (Brightness, Vibrate, Ping)"],
              ["clipboard",      "Clipboard Sync"],
              ["activity",       "Sensor Logger (CSV Export)"],
              ["users",          "Contacts Sharing"],
              ["wifi",           "Network Info & Speed Estimate"],
              ["volume-2",       "Text-to-Speech on Peer Device"],
              ["grid",           "Macro Pad (Custom Command Buttons)"],
              ["camera",         "Remote Screen Capture"],
              ["list",           "Session Log (JSON/CSV Export)"],
              ["battery",        "Battery & Brightness Monitor"],
            ].map(([icon, label]) => (
              <View key={label} style={styles.featureRow}>
                <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={accentColor} />
                <Text style={styles.featureLabel}>{label}</Text>
                <Feather name="check" size={12} color={Colors.success} />
              </View>
            ))}
          </View>

          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
            <Feather name="log-out" size={16} color={Colors.danger} />
            <Text style={styles.disconnectText}>End Session</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  navBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 10,
  },
  endBtn: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.danger + "22", borderWidth: 1, borderColor: Colors.danger + "44",
    alignItems: "center", justifyContent: "center",
  },
  navCenter: { flex: 1, alignItems: "center", gap: 4 },
  navTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.textPrimary, letterSpacing: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  rolePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  roleText: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 },
  tabsScroll: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface, flexGrow: 0, maxHeight: 48,
  },
  tabsContent: { flexDirection: "row", paddingHorizontal: 4 },
  tab: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 11, gap: 5, position: "relative" },
  tabActive: {},
  tabLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  tabIndicator: { position: "absolute", bottom: 0, left: 6, right: 6, height: 2, borderRadius: 1 },
  messageList: { paddingVertical: 12, gap: 4 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  emptyDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  scrollPad: { padding: 20, gap: 16 },
  warnBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.warning + "22", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.warning + "44",
  },
  warnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.warning, flex: 1 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary },
  sectionDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  infoCard: {
    backgroundColor: Colors.surface, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, padding: 20, gap: 4,
  },
  infoCardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary, marginBottom: 12 },
  infoRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  infoLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
  infoValue: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary },
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  featureLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textPrimary, flex: 1 },
  disconnectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: Colors.danger + "22", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.danger + "44",
  },
  disconnectText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.danger },
});
