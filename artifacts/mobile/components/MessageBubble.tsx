import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import type { Message } from "@/context/SkyLinkContext";

interface MessageBubbleProps {
  message: Message;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.type === "system") {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{message.content}</Text>
      </View>
    );
  }

  const isSelf = message.sender === "self";

  if (message.type === "control") {
    return (
      <View style={[styles.controlRow, isSelf && styles.controlRowSelf]}>
        <View style={[styles.controlBubble, isSelf && styles.controlBubbleSelf]}>
          <Feather
            name="terminal"
            size={12}
            color={isSelf ? Colors.primary : Colors.accent}
            style={styles.controlIcon}
          />
          <Text style={[styles.controlText, isSelf && styles.controlTextSelf]}>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, isSelf && styles.rowSelf]}>
      <View style={[styles.bubble, isSelf ? styles.bubbleSelf : styles.bubblePeer]}>
        <Text style={[styles.text, isSelf ? styles.textSelf : styles.textPeer]}>
          {message.content}
        </Text>
      </View>
      <Text style={[styles.time, isSelf && styles.timeSelf]}>
        {formatTime(message.timestamp)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  systemRow: {
    alignItems: "center",
    marginVertical: 8,
    paddingHorizontal: 32,
  },
  systemText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  row: {
    alignItems: "flex-start",
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  rowSelf: {
    alignItems: "flex-end",
  },
  bubble: {
    maxWidth: "75%",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleSelf: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubblePeer: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
  },
  textSelf: {
    color: "#000",
  },
  textPeer: {
    color: Colors.textPrimary,
  },
  time: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    marginLeft: 4,
  },
  timeSelf: {
    marginLeft: 0,
    marginRight: 4,
  },
  controlRow: {
    alignItems: "flex-start",
    marginVertical: 3,
    paddingHorizontal: 16,
  },
  controlRowSelf: {
    alignItems: "flex-end",
  },
  controlBubble: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.accent + "44",
    gap: 6,
  },
  controlBubbleSelf: {
    borderColor: Colors.primary + "44",
  },
  controlIcon: {},
  controlText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.accent,
  },
  controlTextSelf: {
    color: Colors.primary,
  },
});
