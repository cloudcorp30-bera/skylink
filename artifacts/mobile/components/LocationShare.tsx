import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  timestamp: number;
}

interface LocationShareProps {
  peerConnected: boolean;
  bottomInset?: number;
}

function formatCoord(val: number, decimals = 5): string {
  return val.toFixed(decimals);
}

function getDistanceKm(a: LocationData, b: LocationData): string {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(x));
  return d < 1 ? `${(d * 1000).toFixed(0)} m` : `${d.toFixed(2)} km`;
}

export function LocationShare({ peerConnected, bottomInset = 0 }: LocationShareProps) {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [myLocation, setMyLocation] = useState<LocationData | null>(null);
  const [peerLocation, setPeerLocation] = useState<LocationData | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setPermission(status === "granted");
    });
  }, []);

  useEffect(() => {
    const unsub = onEvent("location-update", (data: LocationData) => {
      setPeerLocation(data);
    });
    const unsubStop = onEvent("location-stop", () => {
      setPeerLocation(null);
    });
    return () => { unsub(); unsubStop(); };
  }, [onEvent]);

  const requestPermission = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermission(status === "granted");
  }, []);

  const startSharing = useCallback(async () => {
    if (!permission) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      (loc) => {
        const locationData: LocationData = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
          altitude: loc.coords.altitude,
          speed: loc.coords.speed,
          timestamp: loc.timestamp,
        };
        setMyLocation(locationData);
        emitEvent("location-update", locationData);
      }
    );

    watchRef.current = sub;
    setIsSharing(true);
  }, [permission, emitEvent]);

  const stopSharing = useCallback(() => {
    watchRef.current?.remove();
    watchRef.current = null;
    setIsSharing(false);
    emitEvent("location-stop", {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [emitEvent]);

  useEffect(() => {
    return () => { watchRef.current?.remove(); };
  }, []);

  const openInMaps = useCallback((loc: LocationData) => {
    const url = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
    Linking.openURL(url);
  }, []);

  if (permission === null) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <Feather name="map-pin" size={40} color={Colors.textSecondary} />
        <Text style={styles.title}>Location Access Needed</Text>
        <Text style={styles.desc}>Allow location access to share your GPS position with your peer</Text>
        <Pressable onPress={requestPermission} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.cards}>
        <View style={[styles.card, styles.cardMy]}>
          <View style={styles.cardHeader}>
            <Feather name="navigation" size={16} color={Colors.primary} />
            <Text style={[styles.cardTitle, { color: Colors.primary }]}>Your Location</Text>
            {isSharing && (
              <View style={styles.livePill}>
                <View style={[styles.liveDot, { backgroundColor: Colors.primary }]} />
                <Text style={[styles.liveLabel, { color: Colors.primary }]}>LIVE</Text>
              </View>
            )}
          </View>
          {myLocation ? (
            <>
              <Text style={styles.coord}>{formatCoord(myLocation.latitude)}°N</Text>
              <Text style={styles.coord}>{formatCoord(myLocation.longitude)}°E</Text>
              {myLocation.accuracy != null && (
                <Text style={styles.meta}>Accuracy: ±{myLocation.accuracy.toFixed(0)} m</Text>
              )}
              {myLocation.speed != null && myLocation.speed > 0 && (
                <Text style={styles.meta}>Speed: {(myLocation.speed * 3.6).toFixed(1)} km/h</Text>
              )}
              <Pressable onPress={() => openInMaps(myLocation)} style={styles.mapsBtn}>
                <Feather name="map" size={14} color={Colors.primary} />
                <Text style={styles.mapsBtnText}>Open in Maps</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.noDataText}>{isSharing ? "Getting GPS fix..." : "Not sharing"}</Text>
          )}
        </View>

        <View style={[styles.card, styles.cardPeer]}>
          <View style={styles.cardHeader}>
            <Feather name="user" size={16} color={Colors.accent} />
            <Text style={[styles.cardTitle, { color: Colors.accent }]}>Peer Location</Text>
            {peerLocation && (
              <View style={styles.livePill}>
                <View style={[styles.liveDot, { backgroundColor: Colors.accent }]} />
                <Text style={[styles.liveLabel, { color: Colors.accent }]}>LIVE</Text>
              </View>
            )}
          </View>
          {peerLocation ? (
            <>
              <Text style={styles.coord}>{formatCoord(peerLocation.latitude)}°N</Text>
              <Text style={styles.coord}>{formatCoord(peerLocation.longitude)}°E</Text>
              {peerLocation.accuracy != null && (
                <Text style={styles.meta}>Accuracy: ±{peerLocation.accuracy.toFixed(0)} m</Text>
              )}
              {peerLocation.speed != null && peerLocation.speed > 0 && (
                <Text style={styles.meta}>Speed: {(peerLocation.speed * 3.6).toFixed(1)} km/h</Text>
              )}
              {myLocation && (
                <Text style={styles.meta}>
                  Distance: {getDistanceKm(myLocation, peerLocation)} away
                </Text>
              )}
              <Pressable onPress={() => openInMaps(peerLocation)} style={[styles.mapsBtn, { borderColor: Colors.accent + "44" }]}>
                <Feather name="map" size={14} color={Colors.accent} />
                <Text style={[styles.mapsBtnText, { color: Colors.accent }]}>Open in Maps</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.noDataText}>{peerConnected ? "Peer not sharing" : "Not connected"}</Text>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        {isSharing ? (
          <Pressable onPress={stopSharing} style={[styles.actionBtn, styles.actionBtnStop]}>
            <Feather name="map-pin" size={18} color="white" />
            <Text style={styles.actionBtnText}>Stop Sharing Location</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={startSharing}
            style={[styles.actionBtn, !peerConnected && styles.actionBtnDisabled]}
            disabled={!peerConnected}
          >
            <Feather name="navigation" size={18} color={Colors.dark} />
            <Text style={styles.actionBtnText}>
              {peerConnected ? "Share My Location" : "Waiting for peer..."}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  desc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  cards: { padding: 16, gap: 12, flex: 1 },
  card: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 6,
  },
  cardMy: { backgroundColor: Colors.primary + "0D", borderColor: Colors.primary + "44" },
  cardPeer: { backgroundColor: Colors.accent + "0D", borderColor: Colors.accent + "44" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 },
  coord: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary, letterSpacing: 0.5 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  noDataText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, marginTop: 8 },
  mapsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary + "44",
    alignSelf: "flex-start",
  },
  mapsBtnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.primary },
  actions: { padding: 16 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 16,
  },
  actionBtnStop: { backgroundColor: Colors.danger },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  primaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
});
