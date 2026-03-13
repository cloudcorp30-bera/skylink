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

const CHUNK_SIZE = 64 * 1024;

function getWsUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const url = domain
    ? `wss://${domain}/api/ws`
    : "ws://localhost:8080/api/ws";
  console.log(`[SkyLink] getWsUrl → ${url}  (EXPO_PUBLIC_DOMAIN="${domain ?? ""}")`);
  return url;
}

export const RELAY_WS_URL = getWsUrl();

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
  wsUrl: string;
  lastError: string | null;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: any;
}

const TransferContext = createContext<TransferContextValue | null>(null);

// ─── Native-WebSocket wrapper with auto-reconnect ────────────────────────────

interface WsWrapper {
  send: (event: string, data?: object) => void;
  close: () => void;
  connected: boolean;
  /** Send an immediate ping — used when the tab becomes visible again. */
  immediateCheck: () => void;
}

/**
 * Web Worker source: runs off the main thread so browser tab-throttling
 * (which can delay setInterval to 1 minute+) cannot kill our heartbeat.
 */
const HEARTBEAT_WORKER_SRC = `
var t = null;
self.onmessage = function(e) {
  if (e.data === 'start') { clearInterval(t); t = setInterval(function(){ self.postMessage('tick'); }, 25000); }
  else if (e.data === 'stop')  { clearInterval(t); t = null; }
  else if (e.data === 'now')   { self.postMessage('tick'); }
};
`;

function createWsWrapper(
  url: string,
  handlers: {
    onOpen: () => void;
    onClose: (code: number, reason: string) => void;
    onError: (msg: string) => void;
    onMessage: (msg: { event: string; [k: string]: unknown }) => void;
  },
  reconnectRef: { current: boolean }
): WsWrapper {
  let ws: WebSocket | null = null;
  let alive = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatWorker: Worker | null = null;

  const wrapper: WsWrapper = {
    connected: false,
    send(event, data = {}) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, ...data }));
      }
    },
    close() {
      reconnectRef.current = false;
      stopHeartbeat();
      ws?.close(1000, "manual close");
    },
    immediateCheck() {
      if (!wrapper.connected) return;
      alive = false;
      wrapper.send("ping");
    },
  };

  function stopHeartbeat() {
    if (heartbeatWorker) {
      heartbeatWorker.postMessage("stop");
      heartbeatWorker.terminate();
      heartbeatWorker = null;
    }
    clearInterval(pingTimer!);
    pingTimer = null;
  }

  function doPing() {
    if (!alive) {
      console.warn("[SkyLink] No pong — reconnecting");
      ws?.close();
      return;
    }
    alive = false;
    wrapper.send("ping");
  }

  function startHeartbeat() {
    stopHeartbeat();
    // On web: use a Worker so browser tab-throttling can't kill our timer
    if (Platform.OS === "web" && typeof Worker !== "undefined") {
      try {
        const blob = new Blob([HEARTBEAT_WORKER_SRC], { type: "application/javascript" });
        const workerUrl = URL.createObjectURL(blob);
        heartbeatWorker = new Worker(workerUrl);
        heartbeatWorker.onmessage = () => doPing();
        heartbeatWorker.postMessage("start");
        return;
      } catch (err) {
        console.warn("[SkyLink] Worker unavailable, falling back to setInterval", err);
      }
    }
    pingTimer = setInterval(doPing, 25000);
  }

  function connect() {
    console.log(`[SkyLink] WebSocket connecting → ${url}`);
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[SkyLink] WebSocket connected ✓");
      alive = true;
      wrapper.connected = true;
      handlers.onOpen();
      startHeartbeat();
    };

    ws.onmessage = (e) => {
      let msg: { event: string; [k: string]: unknown };
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.event === "pong" || msg.event === "ping") { alive = true; return; }
      handlers.onMessage(msg);
    };

    ws.onclose = (e) => {
      stopHeartbeat();
      wrapper.connected = false;
      console.warn(`[SkyLink] WebSocket closed  code=${e.code}  reason=${e.reason || "—"}`);
      handlers.onClose(e.code, e.reason);

      if (reconnectRef.current && e.code !== 1000) {
        const delay = 3000;
        console.log(`[SkyLink] Reconnecting in ${delay}ms…`);
        setTimeout(connect, delay);
      }
    };

    ws.onerror = (e) => {
      const msg = (e as ErrorEvent).message ?? "WebSocket error";
      console.error(`[SkyLink] WebSocket error: ${msg}`);
      handlers.onError(msg);
    };
  }

  connect();
  return wrapper;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function TransferProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WsWrapper | null>(null);
  const reconnectRef = useRef(false);
  const pendingJoin = useRef<{ roomId: string; role: string; name: string } | null>(null);

  const [socketConnected, setSocketConnected] = useState(false);
  const [peerPresent, setPeerPresent] = useState(false);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const msgHandlersRef = useRef<Set<(msg: { content: string; senderRole: string; timestamp: number }) => void>>(new Set());
  const ctrlHandlersRef = useRef<Set<(cmd: { command: string; senderRole: string }) => void>>(new Set());
  const eventHandlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());

  const updateTransfer = useCallback((id: string, updates: Partial<FileTransfer>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const emit = useCallback((event: string, data: object = {}) => {
    wsRef.current?.send(event, data);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emitEvent = useCallback((event: string, data: any) => {
    wsRef.current?.send(event, data);
  }, []);

  const onEvent = useCallback((event: string, handler: EventHandler): (() => void) => {
    if (!eventHandlersRef.current.has(event)) {
      eventHandlersRef.current.set(event, new Set());
    }
    eventHandlersRef.current.get(event)!.add(handler);
    return () => { eventHandlersRef.current.get(event)?.delete(handler); };
  }, []);

  const handleMessage = useCallback((msg: { event: string; [k: string]: unknown }) => {
    const { event, ...data } = msg;

    if (event === "connected") {
      console.log(`[SkyLink] Server assigned id=${data.socketId}`);
      if (pendingJoin.current) {
        wsRef.current?.send("join-room", pendingJoin.current);
      }
      return;
    }

    if (event === "room-joined") {
      const peersAlready = (data.peersAlready as { socketId: string; role: string; name: string }[]) ?? [];
      console.log(`[SkyLink] room-joined  room=${data.roomId}  peersAlready=${peersAlready.length}`);
      if (peersAlready.length > 0) {
        setPeerPresent(true);
        console.log(`[SkyLink] Peer already in room: ${peersAlready.map(p => p.name).join(", ")}`);
      }
      return;
    }

    if (event === "peer-joined") {
      console.log(`[SkyLink] peer-joined  role=${data.role}  name=${data.name}`);
      setPeerPresent(true);
      return;
    }

    if (event === "peer-left") {
      console.log(`[SkyLink] peer-left  role=${data.role}`);
      setPeerPresent(false);
      return;
    }

    if (event === "chat-message") {
      msgHandlersRef.current.forEach((h) =>
        h(data as { content: string; senderRole: string; timestamp: number })
      );
      return;
    }

    if (event === "control-command") {
      ctrlHandlersRef.current.forEach((h) =>
        h(data as { command: string; senderRole: string })
      );
      return;
    }

    if (event === "file-start") {
      const { transferId, fileName, fileSize, mimeType, totalChunks } = data as {
        transferId: string; fileName: string; fileSize: number; mimeType: string; totalChunks: number;
      };
      setTransfers((prev) => [{
        id: transferId, fileName, fileSize, mimeType,
        status: "receiving", progress: 0, direction: "receive",
        totalChunks, receivedChunks: new Map(),
      }, ...prev]);
      return;
    }

    if (event === "file-chunk") {
      const { transferId, chunkIndex, data: chunkData } = data as { transferId: string; chunkIndex: number; data: string };
      setTransfers((prev) => prev.map((t) => {
        if (t.id !== transferId) return t;
        const updated = new Map(t.receivedChunks);
        updated.set(chunkIndex, chunkData);
        return { ...t, receivedChunks: updated, progress: Math.round((updated.size / t.totalChunks) * 100) };
      }));
      return;
    }

    if (event === "file-end") {
      const { transferId } = data as { transferId: string };
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
      return;
    }

    if (event === "file-error") {
      const { transferId, error } = data as { transferId: string; error: string };
      updateTransfer(transferId, { status: "error", errorMessage: error });
      return;
    }

    eventHandlersRef.current.get(event)?.forEach((h) => h(data));
  }, [updateTransfer]);

  const connectToRoom = useCallback((roomId: string, role: "sky" | "link", name: string) => {
    wsRef.current?.close();
    wsRef.current = null;
    reconnectRef.current = true;
    pendingJoin.current = { roomId, role, name };

    setSocketConnected(false);
    setPeerPresent(false);

    const url = getWsUrl();
    console.log(`[SkyLink] Connecting → ${url}  room=${roomId}  role=${role}`);

    wsRef.current = createWsWrapper(url, {
      onOpen: () => {
        setSocketConnected(true);
        setLastError(null);
      },
      onClose: (code, reason) => {
        if (code !== 1000) {
          setSocketConnected(false);
          setPeerPresent(false);
          if (code !== 1001) setLastError(`Closed (code ${code}${reason ? ": " + reason : ""})`);
        }
      },
      onError: (msg) => {
        setSocketConnected(false);
        setLastError(`Connection error: ${msg}`);
      },
      onMessage: handleMessage,
    }, reconnectRef);
  }, [handleMessage]);

  const disconnectFromRoom = useCallback(() => {
    reconnectRef.current = false;
    pendingJoin.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setSocketConnected(false);
    setPeerPresent(false);
  }, []);

  const sendChatMessage = useCallback((content: string) => {
    emit("chat-message", { content, timestamp: Date.now() });
  }, [emit]);

  const sendControl = useCallback((command: string) => {
    emit("control-command", { command });
  }, [emit]);

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
    if (!wsRef.current?.connected) throw new Error("Not connected");

    const transferId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    setTransfers((prev) => [{
      id: transferId, fileName, fileSize, mimeType,
      status: "sending", progress: 0, direction: "send",
      totalChunks, localUri: uri,
    }, ...prev]);

    try {
      emit("file-start", { transferId, fileName, fileSize, mimeType, totalChunks });

      if (Platform.OS === "web") {
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let offset = 0, chunkIndex = 0;
        while (offset < bytes.length) {
          const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
          const base64 = btoa(String.fromCharCode(...Array.from(chunk)));
          emit("file-chunk", { transferId, chunkIndex, data: base64 });
          offset += CHUNK_SIZE; chunkIndex++;
          updateTransfer(transferId, { progress: Math.round((chunkIndex / totalChunks) * 100) });
          await new Promise((r) => setTimeout(r, 10));
        }
      } else {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const base64 = await (FileSystem as any).readAsStringAsync(uri, {
            encoding: "base64",
            position: chunkIndex * CHUNK_SIZE,
            length: CHUNK_SIZE,
          });
          emit("file-chunk", { transferId, chunkIndex, data: base64 });
          updateTransfer(transferId, { progress: Math.round(((chunkIndex + 1) / totalChunks) * 100) });
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      emit("file-end", { transferId });
      updateTransfer(transferId, { status: "done", progress: 100 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      emit("file-error", { transferId, error: message });
      updateTransfer(transferId, { status: "error", errorMessage: message });
    }
  }, [emit, updateTransfer]);

  // ── Web-only: keep connection alive across background tabs ─────────────────
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    // Wake Lock API — prevents mobile browsers from suspending the tab
    let wakeLock: { release: () => Promise<void> } | null = null;
    async function acquireWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
        }
      } catch { /* not supported or permission denied */ }
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;

      // Tab just came back into focus
      acquireWakeLock();

      if (wsRef.current?.connected) {
        // Connection looks open — send an immediate ping to confirm it's live
        wsRef.current.immediateCheck();
      } else if (reconnectRef.current && pendingJoin.current) {
        // Connection was dropped while hidden — reconnect immediately (no 3s wait)
        const { roomId, role, name } = pendingJoin.current;
        connectToRoom(roomId, role as "sky" | "link", name);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    acquireWakeLock();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLock?.release().catch(() => {});
    };
  }, [connectToRoom]);

  useEffect(() => {
    return () => {
      reconnectRef.current = false;
      wsRef.current?.close();
    };
  }, []);

  const value = useMemo(() => ({
    socketConnected, peerPresent, transfers,
    wsUrl: RELAY_WS_URL, lastError,
    connectToRoom, disconnectFromRoom, sendFile,
    onMessageReceived, sendChatMessage,
    onControlReceived, sendControl,
    emitEvent, onEvent,
    socket: wsRef.current,
  }), [
    socketConnected, peerPresent, transfers,
    lastError,
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
    encoding: "base64",
  });
  return outputPath;
}

export function useTransfer() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfer must be inside TransferProvider");
  return ctx;
}
