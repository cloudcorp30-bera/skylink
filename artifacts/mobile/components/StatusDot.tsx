import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Colors from "@/constants/colors";
import type { ConnectionStatus } from "@/context/SkyLinkContext";

interface StatusDotProps {
  status: ConnectionStatus;
  size?: number;
}

export function StatusDot({ status, size = 10 }: StatusDotProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  const color =
    status === "connected"
      ? Colors.success
      : status === "connecting"
        ? Colors.warning
        : status === "error"
          ? Colors.danger
          : Colors.textSecondary;

  useEffect(() => {
    if (status === "connecting") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.8,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulse.setValue(1);
    }
  }, [status, pulse]);

  return (
    <View style={[styles.wrapper, { width: size * 2, height: size * 2 }]}>
      {status === "connecting" && (
        <Animated.View
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              transform: [{ scale: pulse }],
              opacity: pulse.interpolate({
                inputRange: [1, 1.8],
                outputRange: [0.5, 0],
              }),
            },
          ]}
        />
      )}
      <View
        style={[
          styles.dot,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
  },
  ring: {
    position: "absolute",
    borderWidth: 2,
  },
});
