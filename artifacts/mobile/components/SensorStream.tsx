import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Accelerometer, Gyroscope, Magnetometer } from "expo-sensors";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface SensorData {
  accel: { x: number; y: number; z: number } | null;
  gyro: { x: number; y: number; z: number } | null;
  mag: { x: number; y: number; z: number } | null;
}

interface SensorStreamProps {
  peerConnected: boolean;
  bottomInset?: number;
}

function SensorBar({ label, value, max = 2, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.min(Math.abs(value) / max, 1);
  return (
    <View style={barStyles.row}>
      <Text style={barStyles.label}>{label}</Text>
      <Text style={[barStyles.value, { color }]}>{value.toFixed(3)}</Text>
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const barStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  label: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary, width: 14 },
  value: { fontFamily: "Inter_700Bold", fontSize: 11, width: 60, textAlign: "right" },
  track: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
});

export function SensorStream({ peerConnected, bottomInset = 0 }: SensorStreamProps) {
  const [isSharing, setIsSharing] = useState(false);
  const [mySensors, setMySensors] = useState<SensorData>({ accel: null, gyro: null, mag: null });
  const [peerSensors, setPeerSensors] = useState<SensorData>({ accel: null, gyro: null, mag: null });
  const subRefs = useRef<{ accel?: ReturnType<typeof Accelerometer.addListener>; gyro?: ReturnType<typeof Gyroscope.addListener>; mag?: ReturnType<typeof Magnetometer.addListener> }>({});
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    const unsub = onEvent("sensor-data", (data: SensorData) => {
      setPeerSensors(data);
    });
    return unsub;
  }, [onEvent]);

  const startSharing = useCallback(async () => {
    Accelerometer.setUpdateInterval(200);
    Gyroscope.setUpdateInterval(200);
    Magnetometer.setUpdateInterval(200);

    const latest: SensorData = { accel: null, gyro: null, mag: null };

    subRefs.current.accel = Accelerometer.addListener((d) => {
      latest.accel = d;
      setMySensors((p) => ({ ...p, accel: d }));
      emitEvent("sensor-data", latest);
    });
    subRefs.current.gyro = Gyroscope.addListener((d) => {
      latest.gyro = d;
      setMySensors((p) => ({ ...p, gyro: d }));
    });
    subRefs.current.mag = Magnetometer.addListener((d) => {
      latest.mag = d;
      setMySensors((p) => ({ ...p, mag: d }));
    });

    setIsSharing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [emitEvent]);

  const stopSharing = useCallback(() => {
    subRefs.current.accel?.remove();
    subRefs.current.gyro?.remove();
    subRefs.current.mag?.remove();
    subRefs.current = {};
    setIsSharing(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  useEffect(() => () => stopSharing(), []);

  function SensorCard({ title, data, accent, isPeer }: { title: string; data: SensorData; accent: string; isPeer: boolean }) {
    return (
      <View style={[sCard.container, { borderColor: accent + "44", backgroundColor: accent + "0A" }]}>
        <View style={sCard.header}>
          <Feather name={isPeer ? "user" : "smartphone"} size={14} color={accent} />
          <Text style={[sCard.title, { color: accent }]}>{title}</Text>
          {isPeer && !peerSensors.accel && (
            <Text style={sCard.noData}>Not sharing</Text>
          )}
        </View>
        {data.accel && (
          <View style={sCard.section}>
            <Text style={sCard.sectionLabel}>Accelerometer (g)</Text>
            <SensorBar label="X" value={data.accel.x} color={Colors.primary} />
            <SensorBar label="Y" value={data.accel.y} color={Colors.success} />
            <SensorBar label="Z" value={data.accel.z} color={Colors.warning} />
          </View>
        )}
        {data.gyro && (
          <View style={sCard.section}>
            <Text style={sCard.sectionLabel}>Gyroscope (rad/s)</Text>
            <SensorBar label="X" value={data.gyro.x} max={5} color={Colors.primary} />
            <SensorBar label="Y" value={data.gyro.y} max={5} color={Colors.success} />
            <SensorBar label="Z" value={data.gyro.z} max={5} color={Colors.warning} />
          </View>
        )}
        {data.mag && (
          <View style={sCard.section}>
            <Text style={sCard.sectionLabel}>Magnetometer (μT)</Text>
            <SensorBar label="X" value={data.mag.x} max={100} color={Colors.accent} />
            <SensorBar label="Y" value={data.mag.y} max={100} color={Colors.danger} />
            <SensorBar label="Z" value={data.mag.z} max={100} color="#FF69B4" />
          </View>
        )}
        {!data.accel && !data.gyro && !data.mag && (
          <Text style={sCard.noDataFull}>{isPeer ? "Waiting for peer to share sensors" : "Not sharing yet"}</Text>
        )}
      </View>
    );
  }

  const sCard = StyleSheet.create({
    container: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
    header: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 },
    noData: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
    section: { gap: 4 },
    sectionLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
    noDataFull: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", padding: 12 },
  });

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.cards}>
        <SensorCard title="Your Sensors" data={mySensors} accent={Colors.primary} isPeer={false} />
        <SensorCard title="Peer Sensors" data={peerSensors} accent={Colors.accent} isPeer />
      </View>
      <View style={styles.footer}>
        {isSharing ? (
          <Pressable onPress={stopSharing} style={[styles.btn, styles.btnStop]}>
            <Feather name="pause" size={18} color="white" />
            <Text style={styles.btnText}>Stop Sharing Sensors</Text>
          </Pressable>
        ) : (
          <Pressable onPress={startSharing} style={[styles.btn, !peerConnected && styles.btnDisabled]} disabled={!peerConnected}>
            <Feather name="activity" size={18} color={Colors.dark} />
            <Text style={styles.btnText}>{peerConnected ? "Share My Sensors" : "Waiting for peer..."}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cards: { flex: 1, padding: 16, gap: 14 },
  footer: { padding: 16 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 16 },
  btnStop: { backgroundColor: Colors.danger },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
});
