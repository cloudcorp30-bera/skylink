import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
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
import { ChatInput } from "@/components/ChatInput";
import { ControlPad } from "@/components/ControlPad";
import { MessageBubble } from "@/components/MessageBubble";
import { StatusDot } from "@/components/StatusDot";
import Colors from "@/constants/colors";
import { useSkyLink } from "@/context/SkyLinkContext";
import * as Haptics from "expo-haptics";

type TabKey = "chat" | "remote" | "info";

export default function SessionScreen() {
  const insets = useSafeAreaInsets();
  const {
    role,
    roomId,
    connectionStatus,
    peerConnected,
    peerName,
    messages,
    sendMessage,
    sendControlCommand,
    disconnect,
  } = useSkyLink();
  const [activeTab, setActiveTab] = useState<TabKey>("chat");

  const topInset = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const isSky = role === "sky";
  const accentColor = isSky ? Colors.primary : Colors.accent;

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "End this SkyLink session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => {
          disconnect();
          router.replace("/");
        },
      },
    ]);
  };

  const TABS: { key: TabKey; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { key: "chat", icon: "message-circle", label: "Chat" },
    ...(isSky
      ? [{ key: "remote" as TabKey, icon: "terminal" as const, label: "Control" }]
      : []),
    { key: "info", icon: "info", label: "Info" },
  ];

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <LinearGradient
        colors={["#060C1A", "#0A0E1A", "#060C1A"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.navBar}>
        <Pressable onPress={handleDisconnect} style={styles.endBtn} hitSlop={12}>
          <Feather name="x" size={20} color={Colors.danger} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>
            {isSky ? "Sky" : "Link"} · {roomId}
          </Text>
          <View style={styles.statusRow}>
            <StatusDot status={connectionStatus} size={6} />
            <Text style={styles.statusText}>
              {connectionStatus === "connected"
                ? `Connected to ${peerName ?? "peer"}`
                : connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
            </Text>
          </View>
        </View>
        <View style={[styles.rolePill, { backgroundColor: accentColor + "22", borderColor: accentColor + "55" }]}>
          <Text style={[styles.roleText, { color: accentColor }]}>
            {isSky ? "SKY" : "LINK"}
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(tab.key);
            }}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          >
            <Feather
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? accentColor : Colors.textSecondary}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === tab.key && { color: accentColor },
              ]}
            >
              {tab.label}
            </Text>
            {activeTab === tab.key && (
              <View style={[styles.tabIndicator, { backgroundColor: accentColor }]} />
            )}
          </Pressable>
        ))}
      </View>

      {activeTab === "chat" && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <Feather name="message-circle" size={40} color={Colors.textSecondary} />
              <Text style={styles.emptyChatTitle}>No messages yet</Text>
              <Text style={styles.emptyChatDesc}>
                {peerConnected
                  ? "Say something to your peer!"
                  : "Waiting for peer to connect..."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <MessageBubble message={item} />}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              inverted
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
            />
          )}
          <View style={{ paddingBottom: bottomInset }}>
            <ChatInput
              onSend={sendMessage}
              disabled={!peerConnected}
              placeholder={peerConnected ? "Message..." : "Waiting for peer..."}
            />
          </View>
        </KeyboardAvoidingView>
      )}

      {activeTab === "remote" && isSky && (
        <ScrollView
          contentContainerStyle={[styles.remoteContent, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {!peerConnected && (
            <View style={styles.notConnectedBanner}>
              <Feather name="alert-circle" size={16} color={Colors.warning} />
              <Text style={styles.notConnectedText}>
                Controls are disabled until Link connects
              </Text>
            </View>
          )}
          <Text style={styles.remoteTitle}>Remote Controls</Text>
          <Text style={styles.remoteDesc}>
            Tap any control to send a command to the Link device in real time.
          </Text>
          <ControlPad onCommand={sendControlCommand} disabled={!peerConnected} />
        </ScrollView>
      )}

      {activeTab === "info" && (
        <ScrollView
          contentContainerStyle={[styles.infoContent, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.infoSection}>
            <Text style={styles.infoSectionTitle}>Session Details</Text>
            {[
              { label: "Room ID", value: roomId ?? "—" },
              { label: "Your Role", value: isSky ? "Sky (Controller)" : "Link (Device)" },
              { label: "Peer", value: peerName ?? "Not connected" },
              { label: "Status", value: connectionStatus },
              { label: "Messages", value: messages.filter(m => m.type === "text").length.toString() },
              { label: "Commands Sent", value: messages.filter(m => m.type === "control" && m.sender === "self").length.toString() },
            ].map((row) => (
              <View key={row.label} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{row.label}</Text>
                <Text style={styles.infoValue}>{row.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.infoSection}>
            <Text style={styles.infoSectionTitle}>Connection Security</Text>
            {[
              { icon: "lock" as const, label: "End-to-End Encrypted", ok: true },
              { icon: "shield" as const, label: "Secure P2P Channel", ok: true },
              { icon: "eye-off" as const, label: "No Server Storage", ok: true },
            ].map((item) => (
              <View key={item.label} style={styles.securityRow}>
                <Feather name={item.icon} size={16} color={Colors.success} />
                <Text style={styles.securityLabel}>{item.label}</Text>
                <Feather name="check" size={14} color={Colors.success} />
              </View>
            ))}
          </View>

          <Pressable
            onPress={handleDisconnect}
            style={styles.disconnectBtn}
          >
            <Feather name="log-out" size={16} color={Colors.danger} />
            <Text style={styles.disconnectText}>End Session</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  endBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.danger + "22",
    borderWidth: 1,
    borderColor: Colors.danger + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  navCenter: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  navTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: Colors.textPrimary,
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
  },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  roleText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    letterSpacing: 1,
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
    position: "relative",
  },
  tabActive: {},
  tabLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: "25%",
    right: "25%",
    height: 2,
    borderRadius: 1,
  },
  messageList: {
    paddingVertical: 12,
    gap: 4,
  },
  emptyChat: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyChatTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.textPrimary,
  },
  emptyChatDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  remoteContent: {
    padding: 20,
    gap: 16,
  },
  notConnectedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.warning + "22",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.warning + "44",
  },
  notConnectedText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.warning,
    flex: 1,
  },
  remoteTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.textPrimary,
  },
  remoteDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  infoContent: {
    padding: 20,
    gap: 20,
  },
  infoSection: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    gap: 4,
  },
  infoSectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.textPrimary,
    textTransform: "capitalize",
  },
  securityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  securityLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 1,
  },
  disconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.danger + "22",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.danger + "44",
  },
  disconnectText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.danger,
  },
});
