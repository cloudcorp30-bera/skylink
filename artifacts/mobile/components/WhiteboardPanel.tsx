import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface Point { x: number; y: number }
interface Stroke { id: string; points: Point[]; color: string; width: number; owner: "self" | "peer" }

const COLORS_PALETTE = [
  Colors.primary, Colors.accent, Colors.success,
  Colors.warning, Colors.danger, "#FFFFFF",
  "#FF69B4", "#00FF7F",
];
const WIDTHS = [2, 4, 8, 14];

function pointsToPath(points: Point[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

interface WhiteboardPanelProps {
  peerConnected: boolean;
  bottomInset?: number;
}

export function WhiteboardPanel({ peerConnected, bottomInset = 0 }: WhiteboardPanelProps) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [selectedColor, setSelectedColor] = useState(Colors.primary);
  const [selectedWidth, setSelectedWidth] = useState(4);
  const [canvasLayout, setCanvasLayout] = useState({ width: 0, height: 0 });
  const currentStrokeRef = useRef<Stroke | null>(null);
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    const unsubStroke = onEvent("wb-stroke", (data: { stroke: Stroke }) => {
      setStrokes((prev) => [...prev, { ...data.stroke, owner: "peer" }]);
    });
    const unsubClear = onEvent("wb-clear", () => {
      setStrokes([]);
    });
    const unsubUndo = onEvent("wb-undo", () => {
      setStrokes((prev) => {
        const lastPeerIdx = [...prev].reverse().findIndex((s) => s.owner === "peer");
        if (lastPeerIdx === -1) return prev;
        const realIdx = prev.length - 1 - lastPeerIdx;
        return prev.filter((_, i) => i !== realIdx);
      });
    });
    return () => { unsubStroke(); unsubClear(); unsubUndo(); };
  }, [onEvent]);

  const startStroke = useCallback((x: number, y: number) => {
    const stroke: Stroke = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      points: [{ x, y }],
      color: selectedColor,
      width: selectedWidth,
      owner: "self",
    };
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
  }, [selectedColor, selectedWidth]);

  const addPoint = useCallback((x: number, y: number) => {
    if (!currentStrokeRef.current) return;
    const updated: Stroke = {
      ...currentStrokeRef.current,
      points: [...currentStrokeRef.current.points, { x, y }],
    };
    currentStrokeRef.current = updated;
    setCurrentStroke({ ...updated });
  }, []);

  const endStroke = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (!stroke || stroke.points.length < 2) {
      currentStrokeRef.current = null;
      setCurrentStroke(null);
      return;
    }
    setStrokes((prev) => [...prev, stroke]);
    emitEvent("wb-stroke", { stroke });
    currentStrokeRef.current = null;
    setCurrentStroke(null);
  }, [emitEvent]);

  const panGesture = Gesture.Pan()
    .onBegin((e) => startStroke(e.x, e.y))
    .onUpdate((e) => addPoint(e.x, e.y))
    .onEnd(() => endStroke())
    .runOnJS(true)
    .minDistance(0);

  const handleClear = () => {
    Alert.alert("Clear Board", "Clear the entire whiteboard for both users?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear", style: "destructive",
        onPress: () => { setStrokes([]); emitEvent("wb-clear", {}); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); },
      },
    ]);
  };

  const handleUndo = () => {
    setStrokes((prev) => {
      const lastSelfIdx = [...prev].reverse().findIndex((s) => s.owner === "self");
      if (lastSelfIdx === -1) return prev;
      const realIdx = prev.length - 1 - lastSelfIdx;
      return prev.filter((_, i) => i !== realIdx);
    });
    emitEvent("wb-undo", {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.toolbar}>
        <View style={styles.colorPicker}>
          {COLORS_PALETTE.map((c) => (
            <Pressable
              key={c}
              onPress={() => setSelectedColor(c)}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                selectedColor === c && styles.colorDotSelected,
              ]}
            />
          ))}
        </View>
        <View style={styles.widthPicker}>
          {WIDTHS.map((w) => (
            <Pressable
              key={w}
              onPress={() => setSelectedWidth(w)}
              style={[styles.widthBtn, selectedWidth === w && { borderColor: selectedColor }]}
            >
              <View style={[styles.widthDot, { width: w + 4, height: w + 4, borderRadius: (w + 4) / 2, backgroundColor: selectedWidth === w ? selectedColor : Colors.textSecondary }]} />
            </Pressable>
          ))}
        </View>
        <View style={styles.actions}>
          <Pressable onPress={handleUndo} style={styles.toolBtn} hitSlop={8}>
            <Feather name="corner-up-left" size={18} color={Colors.textSecondary} />
          </Pressable>
          <Pressable onPress={handleClear} style={styles.toolBtn} hitSlop={8}>
            <Feather name="trash-2" size={18} color={Colors.danger} />
          </Pressable>
        </View>
      </View>

      <GestureDetector gesture={panGesture}>
        <View
          style={styles.canvas}
          onLayout={(e) => setCanvasLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        >
          <Svg width={canvasLayout.width} height={canvasLayout.height} style={StyleSheet.absoluteFill}>
            {strokes.map((stroke) => (
              <Path
                key={stroke.id}
                d={pointsToPath(stroke.points)}
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={stroke.owner === "peer" ? 0.85 : 1}
              />
            ))}
            {currentStroke && (
              <Path
                d={pointsToPath(currentStroke.points)}
                stroke={currentStroke.color}
                strokeWidth={currentStroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )}
          </Svg>
          {strokes.length === 0 && !currentStroke && (
            <View style={styles.placeholder} pointerEvents="none">
              <Feather name="edit-3" size={32} color={Colors.border} />
              <Text style={styles.placeholderText}>
                {peerConnected ? "Draw something — your peer sees it instantly" : "Waiting for peer to connect..."}
              </Text>
            </View>
          )}
        </View>
      </GestureDetector>

      <View style={styles.footer}>
        <View style={[styles.legendDot, { backgroundColor: selectedColor }]} />
        <Text style={styles.footerText}>Your strokes</Text>
        <View style={[styles.legendDot, { backgroundColor: Colors.textSecondary, opacity: 0.6 }]} />
        <Text style={styles.footerText}>Peer strokes</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 8,
  },
  colorPicker: { flex: 1, flexDirection: "row", gap: 6, flexWrap: "wrap" },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "transparent" },
  colorDotSelected: { borderColor: "white", transform: [{ scale: 1.2 }] },
  widthPicker: { flexDirection: "row", gap: 6, alignItems: "center" },
  widthBtn: {
    width: 28, height: 28, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  widthDot: {},
  actions: { flexDirection: "row", gap: 4 },
  toolBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.dark, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  canvas: {
    flex: 1,
    backgroundColor: "#0A0F1E",
    margin: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  placeholderText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.border, textAlign: "center", lineHeight: 20 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  footerText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, marginRight: 8 },
});
