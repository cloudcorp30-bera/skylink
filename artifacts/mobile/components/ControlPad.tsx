import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

interface ControlPadProps {
  onCommand: (command: string) => void;
  disabled?: boolean;
}

const CONTROLS = [
  { icon: "arrow-up" as const, label: "Up", command: "MOVE_UP" },
  { icon: "arrow-down" as const, label: "Down", command: "MOVE_DOWN" },
  { icon: "arrow-left" as const, label: "Left", command: "MOVE_LEFT" },
  { icon: "arrow-right" as const, label: "Right", command: "MOVE_RIGHT" },
  { icon: "rotate-cw" as const, label: "Rotate", command: "ROTATE" },
  { icon: "zoom-in" as const, label: "Zoom In", command: "ZOOM_IN" },
  { icon: "zoom-out" as const, label: "Zoom Out", command: "ZOOM_OUT" },
  { icon: "camera" as const, label: "Capture", command: "CAPTURE" },
  { icon: "volume-2" as const, label: "Volume+", command: "VOL_UP" },
  { icon: "volume-1" as const, label: "Volume-", command: "VOL_DOWN" },
  { icon: "lock" as const, label: "Lock", command: "LOCK_SCREEN" },
  { icon: "refresh-cw" as const, label: "Refresh", command: "REFRESH" },
];

interface ControlButtonProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  command: string;
  onCommand: (cmd: string) => void;
  disabled?: boolean;
}

function ControlButton({ icon, label, command, onCommand, disabled }: ControlButtonProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onCommand(command);
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.ctrlBtn,
        pressed && styles.ctrlBtnPressed,
        disabled && styles.ctrlBtnDisabled,
      ]}
    >
      <Feather name={icon} size={22} color={disabled ? Colors.textSecondary : Colors.primary} />
      <Text style={[styles.ctrlLabel, disabled && { color: Colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ControlPad({ onCommand, disabled }: ControlPadProps) {
  return (
    <View style={styles.grid}>
      {CONTROLS.map((ctrl) => (
        <ControlButton
          key={ctrl.command}
          icon={ctrl.icon}
          label={ctrl.label}
          command={ctrl.command}
          onCommand={onCommand}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  ctrlBtn: {
    width: "22%",
    aspectRatio: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  ctrlBtnPressed: {
    backgroundColor: Colors.primary + "22",
    borderColor: Colors.primary + "66",
  },
  ctrlBtnDisabled: {
    opacity: 0.3,
  },
  ctrlLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: Colors.textPrimary,
    textAlign: "center",
  },
});
