import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import { Animated, Pressable, Share, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

interface RoomCodeDisplayProps {
  code: string;
}

export function RoomCodeDisplay({ code }: RoomCodeDisplayProps) {
  const [copied, setCopied] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const handleCopy = async () => {
    await Share.share({ message: `SkyLink Room Code: ${code}` });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.94, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const letters = code.split("");

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Room Code</Text>
      <Pressable onPress={handleCopy}>
        <Animated.View style={[styles.codeRow, { transform: [{ scale }] }]}>
          {letters.map((ch, i) => (
            <View key={i} style={styles.charBox}>
              <Text style={styles.char}>{ch}</Text>
            </View>
          ))}
        </Animated.View>
      </Pressable>
      <Pressable onPress={handleCopy} style={styles.copyRow}>
        <Feather
          name={copied ? "check" : "copy"}
          size={14}
          color={copied ? Colors.success : Colors.textSecondary}
        />
        <Text style={[styles.copyText, copied && styles.copyTextSuccess]}>
          {copied ? "Shared!" : "Tap code to share"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    gap: 12,
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  codeRow: {
    flexDirection: "row",
    gap: 8,
  },
  charBox: {
    width: 44,
    height: 54,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + "55",
    alignItems: "center",
    justifyContent: "center",
  },
  char: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.primary,
    letterSpacing: 1,
  },
  copyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  copyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  copyTextSuccess: {
    color: Colors.success,
  },
});
