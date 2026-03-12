import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCard } from "@/components/GlassCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SessionCard } from "@/components/SessionCard";
import Colors from "@/constants/colors";
import { useSkyLink } from "@/context/SkyLinkContext";
import { Platform } from "react-native";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const {
    sessions,
    isLoadingSessions,
    loadSessions,
    deleteSession,
    resumeSession,
    disconnect,
    connectionStatus,
  } = useSkyLink();

  useEffect(() => {
    if (connectionStatus !== "idle") {
      disconnect();
    }
  }, []);

  const topInset =
    Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomInset =
    Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const handleSky = () => {
    router.push("/sky");
  };

  const handleLink = () => {
    router.push("/link");
  };

  const handleResumeSession = (session: Parameters<typeof resumeSession>[0]) => {
    resumeSession(session);
    router.push("/session");
  };

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert("Delete Session", "Remove this session from history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteSession(sessionId),
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <LinearGradient
        colors={["#0A0E1A", "#0D1528", "#0A0E1A"]}
        style={StyleSheet.absoluteFill}
      />

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomInset + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoadingSessions}
            onRefresh={loadSessions}
            tintColor={Colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.logoWrap}>
                <Feather name="link-2" size={20} color={Colors.primary} />
              </View>
              <Text style={styles.brand}>SkyLink</Text>
            </View>
            <Text style={styles.tagline}>
              Peer-to-peer connection made simple
            </Text>

            <GlassCard style={styles.actionCard} padding={24}>
              <View style={styles.roles}>
                <Pressable
                  onPress={handleSky}
                  style={({ pressed }) => [
                    styles.roleBtn,
                    styles.roleSky,
                    pressed && styles.roleBtnPressed,
                  ]}
                >
                  <LinearGradient
                    colors={[Colors.primary + "33", Colors.primary + "11"]}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  />
                  <View style={styles.roleIconWrap}>
                    <Feather name="cloud" size={28} color={Colors.primary} />
                  </View>
                  <Text style={styles.roleTitle}>Sky</Text>
                  <Text style={styles.roleDesc}>
                    Control mode — generate a room code and invite Link
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleLink}
                  style={({ pressed }) => [
                    styles.roleBtn,
                    styles.roleLink,
                    pressed && styles.roleBtnPressed,
                  ]}
                >
                  <LinearGradient
                    colors={[Colors.accent + "33", Colors.accent + "11"]}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  />
                  <View style={[styles.roleIconWrap, styles.roleIconLink]}>
                    <Feather name="link" size={28} color={Colors.accent} />
                  </View>
                  <Text style={[styles.roleTitle, styles.roleTitleLink]}>
                    Link
                  </Text>
                  <Text style={styles.roleDesc}>
                    Device mode — enter a code to connect to Sky
                  </Text>
                </Pressable>
              </View>
            </GlassCard>

            {sessions.length > 0 && (
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>Recent Sessions</Text>
                <Text style={styles.historyCount}>{sessions.length}</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            onResume={() => handleResumeSession(item)}
            onDelete={() => handleDeleteSession(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          sessions.length === 0 && !isLoadingSessions ? (
            <View style={styles.emptyState}>
              <Feather name="wifi" size={36} color={Colors.textSecondary} />
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.emptyDesc}>
                Start a Sky session or join one as Link to get connected
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 20,
    marginBottom: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + "22",
    borderWidth: 1,
    borderColor: Colors.primary + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    color: Colors.textPrimary,
  },
  tagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: -10,
  },
  actionCard: {
    overflow: "hidden",
  },
  roles: {
    flexDirection: "row",
    gap: 12,
  },
  roleBtn: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    overflow: "hidden",
  },
  roleSky: {
    borderColor: Colors.primary + "55",
  },
  roleLink: {
    borderColor: Colors.accent + "55",
  },
  roleBtnPressed: {
    opacity: 0.8,
  },
  roleIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  roleIconLink: {
    backgroundColor: Colors.accent + "22",
  },
  roleTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.primary,
  },
  roleTitleLink: {
    color: Colors.accent,
  },
  roleDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: Colors.textPrimary,
  },
  historyCount: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  list: {
    paddingHorizontal: 20,
    gap: 0,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.textPrimary,
  },
  emptyDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
});
