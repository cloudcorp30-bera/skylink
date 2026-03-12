import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCard } from "@/components/GlassCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { RoomCodeDisplay } from "@/components/RoomCodeDisplay";
import { StatusDot } from "@/components/StatusDot";
import Colors from "@/constants/colors";
import { useSkyLink } from "@/context/SkyLinkContext";

export default function SkyScreen() {
  const insets = useSafeAreaInsets();
  const { createSkySession, connectionStatus, roomId, peerConnected, disconnect } = useSkyLink();
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  const topInset = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  useEffect(() => {
    if (connectionStatus === "connecting") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [connectionStatus]);

  const handleStart = async () => {
    setLoading(true);
    try {
      await createSkySession();
      setStarted(true);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToSession = () => {
    router.push("/session");
  };

  const handleBack = () => {
    disconnect();
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <LinearGradient
        colors={["#060C1A", "#091226", "#060C1A"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.navBar}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>Sky Portal</Text>
        </View>
        <StatusDot status={connectionStatus} size={8} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Animated.View
            style={[
              styles.orb,
              {
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.3, 0.7],
                }),
              },
            ]}
          >
            <LinearGradient
              colors={[Colors.primary + "88", Colors.primary + "11"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
          </Animated.View>
          <View style={styles.heroIcon}>
            <Feather name="cloud" size={42} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Sky Controller</Text>
          <Text style={styles.heroDesc}>
            Generate a session and share the room code with your Link device to establish a secure peer-to-peer connection.
          </Text>
        </View>

        {!started ? (
          <GlassCard style={styles.card} padding={28}>
            <View style={styles.featureList}>
              {[
                { icon: "message-circle" as const, label: "Encrypted chat" },
                { icon: "file" as const, label: "File transfer" },
                { icon: "terminal" as const, label: "Remote control" },
                { icon: "lock" as const, label: "End-to-end secure" },
              ].map((f) => (
                <View key={f.label} style={styles.featureItem}>
                  <View style={styles.featureIconWrap}>
                    <Feather name={f.icon} size={18} color={Colors.primary} />
                  </View>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
            <PrimaryButton
              label="Create Session"
              icon="plus-circle"
              onPress={handleStart}
              loading={loading}
              style={styles.startBtn}
            />
          </GlassCard>
        ) : (
          <>
            <GlassCard style={styles.card} padding={28}>
              {roomId && <RoomCodeDisplay code={roomId} />}
              <View style={styles.statusRow}>
                <StatusDot status={connectionStatus} size={8} />
                <Text style={styles.statusText}>
                  {connectionStatus === "connecting" && "Waiting for Link to connect..."}
                  {connectionStatus === "connected" && "Link is connected!"}
                  {connectionStatus === "disconnected" && "Session ended"}
                </Text>
              </View>
              {connectionStatus === "connecting" && (
                <ActivityIndicator color={Colors.primary} size="small" style={{ marginTop: 4 }} />
              )}
            </GlassCard>

            {peerConnected && (
              <PrimaryButton
                label="Open Session"
                icon="arrow-right"
                onPress={handleGoToSession}
                style={styles.continueBtn}
              />
            )}

            <GlassCard style={styles.instructCard} padding={20}>
              <Text style={styles.instructTitle}>How to connect</Text>
              {[
                "Share the room code above with your peer",
                "Ask them to open SkyLink and select Link",
                "They enter the 6-character code to connect",
                "Once connected, tap Open Session to begin",
              ].map((step, i) => (
                <View key={i} style={styles.step}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </GlassCard>
          </>
        )}
      </ScrollView>
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
  navCenter: {
    flex: 1,
    alignItems: "center",
  },
  navTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    color: Colors.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 12,
  },
  orb: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -20,
    overflow: "hidden",
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: Colors.primary + "22",
    borderWidth: 1,
    borderColor: Colors.primary + "55",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
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
  featureList: {
    gap: 14,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  featureLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: Colors.textPrimary,
  },
  startBtn: {
    width: "100%",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
  statusText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  continueBtn: {
    width: "100%",
  },
  instructCard: {},
  instructTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 16,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary + "33",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: Colors.primary,
  },
  stepText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 21,
  },
});
