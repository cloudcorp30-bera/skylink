import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type Role = "sky" | "link";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type MessageType = "text" | "system" | "file" | "control";

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  sender: "self" | "peer" | "system";
  timestamp: number;
  fileName?: string;
  fileSize?: number;
  controlCommand?: string;
}

export interface Session {
  id: string;
  roomId: string;
  role: Role;
  createdAt: number;
  lastActivity: number;
  peerName?: string;
  messageCount: number;
}

interface SkyLinkContextValue {
  role: Role | null;
  roomId: string | null;
  connectionStatus: ConnectionStatus;
  peerConnected: boolean;
  peerName: string | null;
  messages: Message[];
  sessions: Session[];
  isLoadingSessions: boolean;
  createSkySession: () => Promise<string>;
  joinAsLink: (roomId: string) => Promise<void>;
  sendMessage: (content: string) => void;
  sendControlCommand: (command: string) => void;
  disconnect: () => void;
  clearMessages: () => void;
  loadSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  resumeSession: (session: Session) => void;
}

const SkyLinkContext = createContext<SkyLinkContextValue | null>(null);

const SESSIONS_KEY = "skylink_sessions";

function generateId(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function uniqueSessionId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function SkyLinkProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [peerConnected, setPeerConnected] = useState(false);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const currentSessionRef = useRef<Session | null>(null);

  const addMessage = useCallback(
    (
      type: MessageType,
      content: string,
      sender: "self" | "peer" | "system",
      extras?: Partial<Message>
    ) => {
      const msg: Message = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        type,
        content,
        sender,
        timestamp: Date.now(),
        ...extras,
      };
      setMessages((prev) => [msg, ...prev]);
      return msg;
    },
    []
  );

  const saveSessions = useCallback(async (updatedSessions: Session[]) => {
    try {
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));
    } catch (e) {
      console.error("Failed to save sessions", e);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const stored = await AsyncStorage.getItem(SESSIONS_KEY);
      if (stored) {
        const parsed: Session[] = JSON.parse(stored);
        const seen = new Set<string>();
        const deduped = parsed.filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        setSessions(deduped.sort((a, b) => b.lastActivity - a.lastActivity));
      }
    } catch (e) {
      console.error("Failed to load sessions", e);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const updated = sessions.filter((s) => s.id !== sessionId);
      setSessions(updated);
      await saveSessions(updated);
    },
    [sessions, saveSessions]
  );

  const createSkySession = useCallback(async (): Promise<string> => {
    const newRoomId = generateId(6);
    const session: Session = {
      id: uniqueSessionId(),
      roomId: newRoomId,
      role: "sky",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
    };
    setRole("sky");
    setRoomId(newRoomId);
    setConnectionStatus("connecting");
    setMessages([]);
    setPeerConnected(false);
    setPeerName(null);
    currentSessionRef.current = session;

    const updated = [session, ...sessions];
    setSessions(updated);
    await saveSessions(updated);
    return newRoomId;
  }, [sessions, saveSessions]);

  const joinAsLink = useCallback(
    async (targetRoomId: string) => {
      const session: Session = {
        id: uniqueSessionId(),
        roomId: targetRoomId,
        role: "link",
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
      };
      setRole("link");
      setRoomId(targetRoomId);
      setConnectionStatus("connecting");
      setMessages([]);
      setPeerConnected(false);
      setPeerName(null);
      currentSessionRef.current = session;

      const updated = [session, ...sessions];
      setSessions(updated);
      await saveSessions(updated);
    },
    [sessions, saveSessions]
  );

  const resumeSession = useCallback((session: Session) => {
    setRole(session.role);
    setRoomId(session.roomId);
    setConnectionStatus("connecting");
    setMessages([]);
    setPeerConnected(false);
    setPeerName(null);
    currentSessionRef.current = session;
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      addMessage("text", content, "self");
      if (currentSessionRef.current) {
        currentSessionRef.current = {
          ...currentSessionRef.current,
          lastActivity: Date.now(),
          messageCount: (currentSessionRef.current.messageCount ?? 0) + 1,
        };
        setSessions((prev) => {
          const updated = prev.map((s) =>
            s.id === currentSessionRef.current?.id ? currentSessionRef.current! : s
          );
          saveSessions(updated);
          return updated;
        });
      }
    },
    [addMessage, saveSessions]
  );

  const sendControlCommand = useCallback(
    (command: string) => {
      addMessage("control", `Sent: ${command}`, "self", { controlCommand: command });
    },
    [addMessage]
  );

  const disconnect = useCallback(() => {
    setConnectionStatus("disconnected");
    setPeerConnected(false);
    setRole(null);
    setRoomId(null);
    setConnectionStatus("idle");
    setMessages([]);
    currentSessionRef.current = null;
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const value = useMemo(
    () => ({
      role,
      roomId,
      connectionStatus,
      peerConnected,
      peerName,
      messages,
      sessions,
      isLoadingSessions,
      createSkySession,
      joinAsLink,
      sendMessage,
      sendControlCommand,
      disconnect,
      clearMessages,
      loadSessions,
      deleteSession,
      resumeSession,
    }),
    [
      role,
      roomId,
      connectionStatus,
      peerConnected,
      peerName,
      messages,
      sessions,
      isLoadingSessions,
      createSkySession,
      joinAsLink,
      sendMessage,
      sendControlCommand,
      disconnect,
      clearMessages,
      loadSessions,
      deleteSession,
      resumeSession,
    ]
  );

  return (
    <SkyLinkContext.Provider value={value}>{children}</SkyLinkContext.Provider>
  );
}

export function useSkyLink() {
  const ctx = useContext(SkyLinkContext);
  if (!ctx) throw new Error("useSkyLink must be used inside SkyLinkProvider");
  return ctx;
}
