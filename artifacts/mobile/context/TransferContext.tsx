import * as FileSystem from "expo-file-system";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { io, Socket } from "socket.io-client";

const CHUNK_SIZE = 64 * 1024;

function getServerUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

export type TransferStatus = "pending" | "sending" | "receiving" | "done" | "error";

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: TransferStatus;
  progress: number;
  direction: "send" | "receive";
  localUri?: string;
  errorMessage?: string;
  totalChunks: number;
  receivedChunks?: Map<number, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (data: any) => void;

interface TransferContextValue {
  socketConnected: boolean;
  peerPresent: boolean;
  transfers: FileTransfer[];
  connectToRoom: (roomId: string, role: "sky" | "link", name: string) => void;
  disconnectFromRoom: () => void;
  sendFile: (uri: string, fileName: string, fileSize: number, mimeType: string) => Promise<void>;
  onMessageReceived: (
    handler: (msg: { content: string; senderRole: string; timestamp: number }) => void
  ) => () => void;
  sendChatMessage: (content: string) => void;
  onControlReceived: (
    handler: (cmd: { command: string; senderRole: string }) => void
  ) => () => void;
  sendControl: (command: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitEvent: (event: string, data: any) => void;
  onEvent: (event: string, handler: EventHandler) => () => void;
  socket: Socket | null;
}

const TransferContext = createContext<TransferContextValue | null>(null);

export function TransferProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [peerPresent, setPeerPresent] = useState(false);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const msgHandlersRef = useRef<Set<(msg: { content: string; senderRole: string; timestamp: number }) => void>>(new Set());
  const ctrlHandlersRef = useRef<Set<(cmd: { command: string; senderRole: string }) => void>>(new Set());
  const eventHandlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());

  const updateTransfer = useCallback((id: string, updates: Partial<FileTransfer>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emitEvent = useCallback((event: string, data: any) => {
    socketRef.current?.emit(event, data);
  }, []);

  const onEvent = useCallback((event: string, handler: EventHandler): (() => void) => {
    if (!eventHandlersRef.current.has(event)) {
      eventHandlersRef.current.set(event, new Set());
    }
    eventHandlersRef.current.get(event)!.add(handler);
    return () => {
      eventHandlersRef.current.get(event)?.delete(handler);
    };
  }, []);

  const connectToRoom = useCallback((roomId: string, role: "sky" | "link", name: string) => {
    if (socketRef.current?.connected) socketRef.current.disconnect();

    const url = getServerUrl();
    const socket = io(url, { transports: ["websocket", "polling"], timeout: 20000 });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("join-room", { roomId, role, name });
    });

    socket.on("room-joined", ({ peersAlready }: { peersAlready: { socketId: string }[] }) => {
      if (peersAlready.length > 0) setPeerPresent(true);
    });

    socket.on("peer-joined", () => setPeerPresent(true));
    socket.on("peer-left", () => setPeerPresent(false));
    socket.on("disconnect", () => { setSocketConnected(false); setPeerPresent(false); });

    socket.on("chat-message", (msg: { content: string; senderRole: string; timestamp: number }) => {
      msgHandlersRef.current.forEach((h) => h(msg));
    });

    socket.on("control-command", (cmd: { command: string; senderRole: string }) => {
      ctrlHandlersRef.current.forEach((h) => h(cmd));
    });

    socket.on("file-start", ({ transferId, fileName, fileSize, mimeType, totalChunks }: {
      transferId: string; fileName: string; fileSize: number; mimeType: string; totalChunks: number;
    }) => {
      setTransfers((prev) => [{
        id: transferId, fileName, fileSize, mimeType,
        status: "receiving", progress: 0, direction: "receive",
        totalChunks, receivedChunks: new Map(),
      }, ...prev]);
    });

    socket.on("file-chunk", ({ transferId, chunkIndex, data }: { transferId: string; chunkIndex: number; data: string }) => {
      setTransfers((prev) => prev.map((t) => {
        if (t.id !== transferId) return t;
        const updated = new Map(t.receivedChunks);
        updated.set(chunkIndex, data);
        return { ...t, receivedChunks: updated, progress: Math.round((updated.size / t.totalChunks) * 100) };
      }));
    });

    socket.on("file-end", async ({ transferId }: { transferId: string }) => {
      setTransfers((prev) => {
        const transfer = prev.find((t) => t.id === transferId);
        if (!transfer?.receivedChunks) return prev;
        assembleFile(transfer).then((localUri) => {
          updateTransfer(transferId, { status: "done", progress: 100, localUri, receivedChunks: undefined });
        }).catch(() => {
          updateTransfer(transferId, { status: "error", errorMessage: "Failed to save file" });
        });
        return prev.map((t) => t.id === transferId ? { ...t, status: "receiving" } : t);
      });
    });

    socket.on("file-error", ({ transferId, error }: { transferId: string; error: string }) => {
      updateTransfer(transferId, { status: "error", errorMessage: error });
    });

    const relayEvents = [
      "camera-frame", "camera-stop", "location-update", "location-stop",
      "audio-chunk", "clipboard-sync", "device-control", "device-info",
      "battery-update", "brightness-update", "typing-indicator",
      "sensor-data", "sensor-log-entry", "wb-stroke", "wb-clear", "wb-undo",
      "tts-speak", "network-info", "contacts-share",
      "macro-trigger", "screenshot-request", "screenshot-response",
      "webrtc-offer", "webrtc-answer", "webrtc-ice", "webrtc-hangup",
      "remote-command", "device-report", "device-report-request",
    ];

    for (const event of relayEvents) {
      socket.on(event, (data: Record<string, unknown>) => {
        eventHandlersRef.current.get(event)?.forEach((h) => h(data));
      });
    }
  }, [updateTransfer]);

  const disconnectFromRoom = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocketConnected(false);
    setPeerPresent(false);
  }, []);

  const sendChatMessage = useCallback((content: string) => {
    socketRef.current?.emit("chat-message", { content });
  }, []);

  const sendControl = useCallback((command: string) => {
    socketRef.current?.emit("control-command", { command });
  }, []);

  const onMessageReceived = useCallback((
    handler: (msg: { content: string; senderRole: string; timestamp: number }) => void
  ) => {
    msgHandlersRef.current.add(handler);
    return () => { msgHandlersRef.current.delete(handler); };
  }, []);

  const onControlReceived = useCallback((
    handler: (cmd: { command: string; senderRole: string }) => void
  ) => {
    ctrlHandlersRef.current.add(handler);
    return () => { ctrlHandlersRef.current.delete(handler); };
  }, []);

  const sendFile = useCallback(async (uri: string, fileName: string, fileSize: number, mimeType: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) throw new Error("Not connected");

    const transferId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    setTransfers((prev) => [{
      id: transferId, fileName, fileSize, mimeType,
      status: "sending", progress: 0, direction: "send",
      totalChunks, localUri: uri,
    }, ...prev]);

    try {
      socket.emit("file-start", { transferId, fileName, fileSize, mimeType, totalChunks });

      if (Platform.OS === "web") {
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let offset = 0, chunkIndex = 0;
        while (offset < bytes.length) {
          const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
          const base64 = btoa(String.fromCharCode(...Array.from(chunk)));
          socket.emit("file-chunk", { transferId, chunkIndex, data: base64 });
          offset += CHUNK_SIZE; chunkIndex++;
          updateTransfer(transferId, { progress: Math.round((chunkIndex / totalChunks) * 100) });
          await new Promise((r) => setTimeout(r, 10));
        }
      } else {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const base64 = await (FileSystem as any).readAsStringAsync(uri, {
            encoding: 'base64',
            position: chunkIndex * CHUNK_SIZE,
            length: CHUNK_SIZE,
          });
          socket.emit("file-chunk", { transferId, chunkIndex, data: base64 });
          updateTransfer(transferId, { progress: Math.round(((chunkIndex + 1) / totalChunks) * 100) });
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      socket.emit("file-end", { transferId });
      updateTransfer(transferId, { status: "done", progress: 100 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      socket.emit("file-error", { transferId, error: message });
      updateTransfer(transferId, { status: "error", errorMessage: message });
    }
  }, [updateTransfer]);

  useEffect(() => {
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const value = useMemo(() => ({
    socketConnected, peerPresent, transfers,
    connectToRoom, disconnectFromRoom, sendFile,
    onMessageReceived, sendChatMessage,
    onControlReceived, sendControl,
    emitEvent, onEvent,
    socket: socketRef.current,
  }), [
    socketConnected, peerPresent, transfers,
    connectToRoom, disconnectFromRoom, sendFile,
    onMessageReceived, sendChatMessage,
    onControlReceived, sendControl,
    emitEvent, onEvent,
  ]);

  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}

async function assembleFile(transfer: FileTransfer): Promise<string> {
  if (!transfer.receivedChunks) throw new Error("No chunks");
  const FS = FileSystem as any;
  const dir = FS.cacheDirectory + "skylink/";
  await FS.makeDirectoryAsync(dir, { intermediates: true });
  const safeFileName = transfer.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outputPath = dir + transfer.id + "_" + safeFileName;
  const sortedChunks = Array.from(transfer.receivedChunks.entries())
    .sort(([a], [b]) => a - b)
    .map(([, data]) => data);
  await FS.writeAsStringAsync(outputPath, sortedChunks.join(""), {
    encoding: 'base64',
  });
  return outputPath;
}

export function useTransfer() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfer must be inside TransferProvider");
  return ctx;
}
