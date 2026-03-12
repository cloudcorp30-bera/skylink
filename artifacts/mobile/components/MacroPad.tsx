import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

const MACRO_ICONS = ["zap", "star", "bell", "flag", "heart", "camera", "mic", "volume-2", "navigation", "activity", "wifi", "battery", "compass", "sun", "moon", "alert-triangle", "check", "x"] as const;
type MacroIcon = typeof MACRO_ICONS[number];

interface Macro {
  id: string;
  label: string;
  commands: string[];
  icon: MacroIcon;
  color: string;
  description: string;
}

const MACRO_COLORS = [Colors.primary, Colors.accent, Colors.success, Colors.warning, Colors.danger, "#FF69B4", "#00FF7F", "#FF8C00"];

const PRESET_COMMANDS = [
  "VIBRATE", "PING", "BRIGHTNESS_MAX", "BRIGHTNESS_MIN", "BRIGHTNESS_MED",
  "CAMERA_FLASH_ON", "CAMERA_FLASH_OFF", "SCREEN_WAKE",
  "UP", "DOWN", "LEFT", "RIGHT", "FIRE", "SELECT", "BACK",
];

interface MacroPadProps {
  role: "sky" | "link";
  peerConnected: boolean;
  bottomInset?: number;
}

export function MacroPad({ role, peerConnected, bottomInset = 0 }: MacroPadProps) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [editing, setEditing] = useState<Macro | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [activeMacroId, setActiveMacroId] = useState<string | null>(null);
  const { emitEvent, onEvent, sendControl } = useTransfer();
  const isSky = role === "sky";

  useEffect(() => {
    AsyncStorage.getItem("skylink_macros").then(raw => {
      if (raw) setMacros(JSON.parse(raw));
      else setMacros(defaultMacros());
    });
  }, []);

  useEffect(() => {
    const unsub = onEvent("macro-trigger", (data: { macroId: string; commands: string[] }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      data.commands.forEach((cmd, i) => {
        setTimeout(() => sendControl(cmd), i * 300);
      });
      setActiveMacroId(data.macroId);
      setTimeout(() => setActiveMacroId(null), 800);
    });
    return unsub;
  }, [onEvent, sendControl]);

  const saveMacros = useCallback((updated: Macro[]) => {
    setMacros(updated);
    AsyncStorage.setItem("skylink_macros", JSON.stringify(updated));
  }, []);

  const triggerMacro = useCallback((macro: Macro) => {
    if (!peerConnected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setActiveMacroId(macro.id);
    setTimeout(() => setActiveMacroId(null), 600);
    emitEvent("macro-trigger", { macroId: macro.id, commands: macro.commands });
  }, [peerConnected, emitEvent]);

  const openEditor = (macro?: Macro) => {
    setEditing(macro ?? newMacro());
    setShowEditor(true);
  };

  const saveMacro = () => {
    if (!editing || !editing.label.trim()) return;
    const existing = macros.find(m => m.id === editing.id);
    const updated = existing
      ? macros.map(m => m.id === editing.id ? editing : m)
      : [...macros, editing];
    saveMacros(updated);
    setShowEditor(false);
    setEditing(null);
  };

  const deleteMacro = (id: string) => {
    Alert.alert("Delete Macro", "Remove this macro button?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => saveMacros(macros.filter(m => m.id !== id)) },
    ]);
  };

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{isSky ? "Macro Pad" : "Incoming Macros"}</Text>
          <Text style={styles.headerSub}>{isSky ? "Tap to trigger on peer device" : "Sky can trigger commands remotely"}</Text>
        </View>
        {isSky && (
          <Pressable onPress={() => openEditor()} style={styles.addBtn}>
            <Feather name="plus" size={18} color={Colors.dark} />
          </Pressable>
        )}
      </View>

      {!peerConnected && (
        <View style={styles.offlineBanner}>
          <Feather name="wifi-off" size={14} color={Colors.warning} />
          <Text style={styles.offlineText}>Macros fire when peer connects</Text>
        </View>
      )}

      {macros.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="grid" size={40} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>No Macros Yet</Text>
          <Text style={styles.emptyDesc}>{isSky ? "Tap + to create your first macro button" : "Sky hasn't defined any macros yet"}</Text>
          {isSky && (
            <Pressable onPress={() => openEditor()} style={styles.createBtn}>
              <Text style={styles.createBtnText}>Create Macro</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {macros.map(macro => (
            <Pressable
              key={macro.id}
              onPress={() => isSky ? triggerMacro(macro) : undefined}
              onLongPress={() => isSky ? openEditor(macro) : undefined}
              style={[
                styles.macroBtn,
                { borderColor: macro.color + "55", backgroundColor: macro.color + (activeMacroId === macro.id ? "33" : "11") },
                !peerConnected && isSky && { opacity: 0.4 },
                activeMacroId === macro.id && { transform: [{ scale: 0.94 }] },
              ]}
              disabled={isSky ? !peerConnected : true}
            >
              <Feather name={macro.icon as any} size={26} color={macro.color} />
              <Text style={[styles.macroLabel, { color: macro.color }]}>{macro.label}</Text>
              <Text style={styles.macroDesc} numberOfLines={1}>{macro.description || macro.commands.join(" › ")}</Text>
              {isSky && (
                <Pressable onPress={() => deleteMacro(macro.id)} style={styles.deleteBtn} hitSlop={6}>
                  <Feather name="x" size={10} color={Colors.textSecondary} />
                </Pressable>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={showEditor} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowEditor(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowEditor(false)} style={styles.modalClose}>
              <Feather name="x" size={20} color={Colors.textSecondary} />
            </Pressable>
            <Text style={styles.modalTitle}>{editing?.id && macros.find(m => m.id === editing.id) ? "Edit Macro" : "New Macro"}</Text>
            <Pressable onPress={saveMacro} style={styles.modalSave}>
              <Text style={styles.modalSaveText}>Save</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.fieldLabel}>Button Label</Text>
            <TextInput
              style={styles.fieldInput}
              value={editing?.label}
              onChangeText={v => setEditing(e => e ? { ...e, label: v } : e)}
              placeholder="e.g. Flash On"
              placeholderTextColor={Colors.textSecondary}
              maxLength={20}
            />

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={styles.fieldInput}
              value={editing?.description}
              onChangeText={v => setEditing(e => e ? { ...e, description: v } : e)}
              placeholder="What does this do?"
              placeholderTextColor={Colors.textSecondary}
            />

            <Text style={styles.fieldLabel}>Commands (executed in order)</Text>
            {editing?.commands.map((cmd, i) => (
              <View key={i} style={styles.cmdRow}>
                <TextInput
                  style={[styles.fieldInput, { flex: 1, marginBottom: 0 }]}
                  value={cmd}
                  onChangeText={v => setEditing(e => e ? { ...e, commands: e.commands.map((c, j) => j === i ? v : c) } : e)}
                  placeholder="Command"
                  placeholderTextColor={Colors.textSecondary}
                />
                <Pressable onPress={() => setEditing(e => e ? { ...e, commands: e.commands.filter((_, j) => j !== i) } : e)} style={styles.cmdRemove}>
                  <Feather name="minus" size={14} color={Colors.danger} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setEditing(e => e ? { ...e, commands: [...e.commands, ""] } : e)} style={styles.addCmdBtn}>
              <Feather name="plus" size={14} color={Colors.primary} />
              <Text style={styles.addCmdText}>Add Command</Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Quick Commands</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll}>
              {PRESET_COMMANDS.map(cmd => (
                <Pressable key={cmd} onPress={() => setEditing(e => e ? { ...e, commands: [...e.commands, cmd] } : e)} style={styles.presetChip}>
                  <Text style={styles.presetChipText}>{cmd}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Icon</Text>
            <View style={styles.iconGrid}>
              {MACRO_ICONS.map(icon => (
                <Pressable key={icon} onPress={() => setEditing(e => e ? { ...e, icon } : e)} style={[styles.iconBtn, editing?.icon === icon && { backgroundColor: Colors.primary + "33", borderColor: Colors.primary }]}>
                  <Feather name={icon as any} size={18} color={editing?.icon === icon ? Colors.primary : Colors.textSecondary} />
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Color</Text>
            <View style={styles.colorRow}>
              {MACRO_COLORS.map(c => (
                <Pressable key={c} onPress={() => setEditing(e => e ? { ...e, color: c } : e)} style={[styles.colorDot, { backgroundColor: c }, editing?.color === c && { borderColor: "white", transform: [{ scale: 1.3 }] }]} />
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function newMacro(): Macro {
  return { id: Date.now().toString(36), label: "", commands: ["VIBRATE"], icon: "zap", color: Colors.primary, description: "" };
}

function defaultMacros(): Macro[] {
  return [
    { id: "m1", label: "Alert", commands: ["VIBRATE", "PING"], icon: "bell", color: Colors.warning, description: "Vibrate and ping" },
    { id: "m2", label: "Lights On", commands: ["BRIGHTNESS_MAX"], icon: "sun", color: Colors.primary, description: "Max brightness" },
    { id: "m3", label: "Lights Off", commands: ["BRIGHTNESS_MIN"], icon: "moon", color: Colors.accent, description: "Min brightness" },
    { id: "m4", label: "SOS", commands: ["VIBRATE", "PING", "VIBRATE", "PING", "VIBRATE"], icon: "alert-triangle", color: Colors.danger, description: "Triple alert sequence" },
  ];
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.textPrimary },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 10, backgroundColor: Colors.warning + "22", borderRadius: 10, borderWidth: 1, borderColor: Colors.warning + "33" },
  offlineText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.warning },
  grid: { padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  macroBtn: { width: "47%", borderRadius: 20, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 10, position: "relative" },
  macroLabel: { fontFamily: "Inter_700Bold", fontSize: 15, textAlign: "center" },
  macroDesc: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, textAlign: "center" },
  deleteBtn: { position: "absolute", top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 40 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  emptyDesc: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  createBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  createBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  modal: { flex: 1, backgroundColor: Colors.dark },
  modalHeader: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalClose: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  modalTitle: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.textPrimary, textAlign: "center" },
  modalSave: { backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  modalSaveText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.dark },
  modalBody: { padding: 20, gap: 6 },
  fieldLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary, marginTop: 12, marginBottom: 4 },
  fieldInput: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, marginBottom: 8 },
  cmdRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
  cmdRemove: { width: 36, height: 44, borderRadius: 10, backgroundColor: Colors.danger + "22", borderWidth: 1, borderColor: Colors.danger + "33", alignItems: "center", justifyContent: "center" },
  addCmdBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + "55", backgroundColor: Colors.primary + "11" },
  addCmdText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.primary },
  presetScroll: { marginBottom: 12 },
  presetChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, borderWidth: 1, borderColor: Colors.border },
  presetChipText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  iconBtn: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  colorRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  colorDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
});
