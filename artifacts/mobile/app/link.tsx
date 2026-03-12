import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCard } from "@/components/GlassCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { StatusDot } from "@/components/StatusDot";
import Colors from "@/constants/colors";
import { useSkyLink } from "@/context/SkyLinkContext";

const CODE_LENGTH = 6;

export default function LinkScreen() {
  const insets = useSafeAreaInsets();
  const { joinAsLink, connectionStatus, peerConnected, disconnect } = useSkyLink();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const topInset = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const handleConnect = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== CODE_LENGTH) {
      Alert.alert("Invalid Code", `Please enter a ${CODE_LENGTH}-character room code.`);
      return;
    }
    setLoading(true);
    try {
      await joinAsLink(trimmed);
      router.push("/session");
    } catch {
      Alert.alert("Connection Failed", "Could not connect to the session. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    disconnect();
    router.back();
  };

  const handleCodeChange = (text: string) => {
    const cleaned = text.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, CODE_LENGTH);
    setCode(cleaned);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[styles.container, { paddingTop: topInset }]}>
        <LinearGradient
          colors={["#060C1A", "#0D0B20", "#060C1A"]}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.navBar}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
          </Pressable>
          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Link Portal</Text>
          </View>
          <StatusDot status={connectionStatus} size={8} />
        </View>

        <View style={[styles.content, { paddingBottom: bottomInset + 24 }]}>
          <View style={styles.hero}>
            <LinearGradient
              colors={[Colors.accent + "44", Colors.accent + "11"]}
              style={styles.orbAccent}
            />
            <View style={styles.heroIcon}>
              <Feather name="link" size={42} color={Colors.accent} />
            </View>
            <Text style={styles.heroTitle}>Link Device</Text>
            <Text style={styles.heroDesc}>
              Enter the room code shown on the Sky controller to establish a secure peer-to-peer connection.
            </Text>
          </View>

          <GlassCard style={styles.card} padding={28}>
            <Text style={styles.inputLabel}>Room Code</Text>
            <Pressable
              onPress={() => inputRef.current?.focus()}
              style={styles.codeInputWrapper}
            >
              {Array.from({ length: CODE_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.charBox,
                    i < code.length && styles.charBoxFilled,
                    i === code.length && styles.charBoxActive,
                  ]}
                >
                  <Text style={styles.charText}>
                    {code[i] ?? ""}
                  </Text>
                  {i === code.length && (
                    <View style={styles.cursor} />
                  )}
                </View>
              ))}
            </Pressable>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={handleCodeChange}
              style={styles.hiddenInput}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              maxLength={CODE_LENGTH}
              returnKeyType="go"
              onSubmitEditing={handleConnect}
            />
            <PrimaryButton
              label="Connect to Sky"
              icon="link-2"
              onPress={handleConnect}
              loading={loading}
              disabled={code.length !== CODE_LENGTH}
              style={styles.connectBtn}
            />
          </GlassCard>

          <GlassCard padding={20} style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Feather name="info" size={16} color={Colors.accent} />
              <Text style={styles.infoText}>
                The room code is shown on the Sky controller's screen. It's a 6-character alphanumeric code.
              </Text>
            </View>
          </GlassCard>
        </View>
      </View>
    </KeyboardAvoidingView>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  navCenter: { flex: 1, alignItems: "center" },
  navTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    color: Colors.textPrimary,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 16,
  },
  hero: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 20,
  },
  orbAccent: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    top: -40,
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: Colors.accent + "22",
    borderWidth: 1,
    borderColor: Colors.accent + "55",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    color: Colors.textPrimary,
  },
  heroDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: 12,
  },
  card: {},
  inputLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 16,
    textAlign: "center",
  },
  codeInputWrapper: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginBottom: 24,
  },
  charBox: {
    width: 44,
    height: 54,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  charBoxFilled: {
    borderColor: Colors.accent + "88",
    backgroundColor: Colors.accent + "11",
  },
  charBoxActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + "11",
  },
  charText: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.accent,
  },
  cursor: {
    position: "absolute",
    width: 2,
    height: 26,
    backgroundColor: Colors.accent,
    borderRadius: 1,
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
  connectBtn: {
    width: "100%",
  },
  infoCard: {},
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  infoText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
});
