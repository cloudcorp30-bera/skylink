import { Feather } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from "react-native";
import Colors from "@/constants/colors";
import { useTransfer } from "@/context/TransferContext";

interface ContactItem {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
}

interface ContactsShareProps {
  peerConnected: boolean;
  bottomInset?: number;
}

export function ContactsShare({ peerConnected, bottomInset = 0 }: ContactsShareProps) {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [myContacts, setMyContacts] = useState<ContactItem[]>([]);
  const [peerContacts, setPeerContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState<"mine" | "peer">("mine");
  const { emitEvent, onEvent } = useTransfer();

  useEffect(() => {
    const unsub = onEvent("contacts-share", (data: { contacts: ContactItem[] }) => {
      setPeerContacts(data.contacts);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActiveView("peer");
    });
    return unsub;
  }, [onEvent]);

  const requestAndLoad = useCallback(async () => {
    setLoading(true);
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== "granted") {
      setPermission(false);
      setLoading(false);
      return;
    }
    setPermission(true);
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      sort: Contacts.SortTypes.FirstName,
    });

    const mapped: ContactItem[] = data
      .filter((c) => c.name)
      .slice(0, 500)
      .map((c) => ({
        id: c.id ?? Math.random().toString(36),
        name: c.name ?? "Unknown",
        phones: (c.phoneNumbers ?? []).map((p) => p.number ?? "").filter(Boolean),
        emails: (c.emails ?? []).map((e) => e.email ?? "").filter(Boolean),
      }));

    setMyContacts(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { requestAndLoad(); }, []);

  const shareWithPeer = useCallback(() => {
    if (!peerConnected || myContacts.length === 0) return;
    Alert.alert(
      "Share Contacts",
      `Share ${myContacts.length} contacts with your peer?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Share",
          onPress: () => {
            emitEvent("contacts-share", { contacts: myContacts });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            Alert.alert("Sent!", "Contacts shared with peer.");
          },
        },
      ]
    );
  }, [peerConnected, myContacts, emitEvent]);

  const copyContact = useCallback(async (contact: ContactItem) => {
    const text = [contact.name, ...contact.phones, ...contact.emails].join("\n");
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copied!", `${contact.name}'s info copied to clipboard.`);
  }, []);

  const displayed = (activeView === "mine" ? myContacts : peerContacts).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phones.some((p) => p.includes(search))
  );

  if (permission === false) {
    return (
      <View style={styles.center}>
        <Feather name="users" size={40} color={Colors.textSecondary} />
        <Text style={styles.titleText}>Contacts Access Needed</Text>
        <Text style={styles.descText}>Grant permission to share contacts with your peer</Text>
        <Pressable onPress={requestAndLoad} style={styles.grantBtn}>
          <Text style={styles.grantBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.toggle}>
        {(["mine", "peer"] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setActiveView(v)}
            style={[styles.toggleBtn, activeView === v && styles.toggleActive]}
          >
            <Feather
              name={v === "mine" ? "smartphone" : "user"}
              size={14}
              color={activeView === v ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.toggleLabel, activeView === v && { color: Colors.primary }]}>
              {v === "mine" ? `My Contacts (${myContacts.length})` : `Peer Contacts (${peerContacts.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or number..."
          placeholderTextColor={Colors.textSecondary}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.descText}>Loading contacts...</Text>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(item, i) => `${item.id}_${i}`}
          renderItem={({ item }) => (
            <Pressable onLongPress={() => copyContact(item)} style={styles.contactRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{item.name}</Text>
                {item.phones[0] && <Text style={styles.contactDetail}>{item.phones[0]}</Text>}
                {item.emails[0] && <Text style={styles.contactDetail}>{item.emails[0]}</Text>}
              </View>
              <Pressable onPress={() => copyContact(item)} hitSlop={10}>
                <Feather name="copy" size={16} color={Colors.textSecondary} />
              </Pressable>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.border, marginHorizontal: 16 }} />}
          contentContainerStyle={displayed.length === 0 ? { flex: 1 } : undefined}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="users" size={32} color={Colors.textSecondary} />
              <Text style={styles.descText}>
                {activeView === "peer" ? "Ask peer to share their contacts" : "No contacts found"}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {activeView === "mine" && (
        <Pressable
          onPress={shareWithPeer}
          style={[styles.shareBtn, (!peerConnected || myContacts.length === 0) && styles.shareBtnDisabled]}
          disabled={!peerConnected || myContacts.length === 0}
        >
          <Feather name="share-2" size={16} color={Colors.dark} />
          <Text style={styles.shareBtnText}>Share All with Peer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 40 },
  titleText: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textPrimary },
  descText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
  grantBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  grantBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
  toggle: { flexDirection: "row", margin: 12, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10, gap: 6 },
  toggleActive: { backgroundColor: Colors.primary + "22" },
  toggleLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, marginBottom: 8, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary },
  contactRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primary + "22", alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.primary },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontFamily: "Inter_500Medium", fontSize: 15, color: Colors.textPrimary },
  contactDetail: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: Colors.primary, margin: 12, paddingVertical: 15, borderRadius: 16 },
  shareBtnDisabled: { opacity: 0.4 },
  shareBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark },
});
