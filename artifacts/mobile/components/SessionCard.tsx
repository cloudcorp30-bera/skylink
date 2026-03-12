import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import type { Session } from "@/context/SkyLinkContext";

interface SessionCardProps {
  session: Session;
  onResume: () => void;
  onDelete: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SessionCard({ session, onResume, onDelete }: SessionCardProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
  };

  const isSky = session.role === "sky";
  const roleColor = isSky ? Colors.primary : Colors.accent;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onResume();
        }}
        style={styles.card}
      >
        <View style={[styles.iconBox, { backgroundColor: roleColor + "22" }]}>
          <Feather
            name={isSky ? "cloud" : "link"}
            size={22}
            color={roleColor}
          />
        </View>
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.roomId}>{session.roomId}</Text>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + "22" }]}>
              <Text style={[styles.roleText, { color: roleColor }]}>
                {isSky ? "SKY" : "LINK"}
              </Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Feather name="clock" size={11} color={Colors.textSecondary} />
            <Text style={styles.meta}>{timeAgo(session.lastActivity)}</Text>
            {session.messageCount > 0 && (
              <>
                <Feather name="message-circle" size={11} color={Colors.textSecondary} />
                <Text style={styles.meta}>{session.messageCount}</Text>
              </>
            )}
            {session.peerName && (
              <>
                <Feather name="user" size={11} color={Colors.textSecondary} />
                <Text style={styles.meta}>{session.peerName}</Text>
              </>
            )}
          </View>
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            onDelete();
          }}
          style={styles.deleteBtn}
          hitSlop={12}
        >
          <Feather name="trash-2" size={16} color={Colors.textSecondary} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 14,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  roomId: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.textPrimary,
    letterSpacing: 2,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  meta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    marginRight: 6,
  },
  deleteBtn: {
    padding: 4,
  },
});
