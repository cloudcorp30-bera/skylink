import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

interface PeerInfo {
  ws: WebSocket;
  socketId: string;
  role: "sky" | "link";
  name: string;
  roomId: string;
  alive: boolean;
}

const peers = new Map<WebSocket, PeerInfo>();
const rooms = new Map<string, Set<WebSocket>>();

function getRoommates(ws: WebSocket): WebSocket[] {
  const info = peers.get(ws);
  if (!info) return [];
  const room = rooms.get(info.roomId);
  if (!room) return [];
  return Array.from(room).filter((w) => w !== ws && w.readyState === WebSocket.OPEN);
}

function broadcast(from: WebSocket, payload: object) {
  const msg = JSON.stringify(payload);
  for (const peer of getRoommates(from)) {
    peer.send(msg);
  }
}

function leaveRoom(ws: WebSocket) {
  const info = peers.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(info.roomId);
  }
  peers.delete(ws);
  broadcast(ws, { event: "peer-left", role: info.role, name: info.name });
  console.log(`[WS] ${info.role}/${info.name} left room ${info.roomId}. Room size: ${room?.size ?? 0}`);
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function initSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });

  console.log("[WS] WebSocket server ready on path /api/ws");

  // Server-side ping/pong heartbeat — keeps connections alive through proxies
  const heartbeat = setInterval(() => {
    for (const [ws, info] of peers) {
      if (!info.alive) {
        console.log(`[WS] Terminating unresponsive socket ${info.socketId}`);
        ws.terminate();
        leaveRoom(ws);
        continue;
      }
      info.alive = false;
      try { ws.ping(); } catch {}
    }
  }, 20000);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws) => {
    const socketId = genId();
    console.log(`[WS] Connected: ${socketId}`);

    ws.on("pong", () => {
      const info = peers.get(ws);
      if (info) info.alive = true;
    });

    ws.on("message", (raw) => {
      let msg: { event: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.event === "ping") {
        ws.send(JSON.stringify({ event: "pong" }));
        return;
      }

      if (msg.event === "join-room") {
        const roomId = String(msg.roomId ?? "").toUpperCase().trim();
        const role = msg.role as "sky" | "link";
        const name = String(msg.name ?? role);

        if (!roomId || !role) return;

        if (peers.has(ws)) leaveRoom(ws);

        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        rooms.get(roomId)!.add(ws);

        const info: PeerInfo = { ws, socketId, role, name, roomId, alive: true };
        peers.set(ws, info);

        const roomMates = getRoommates(ws);
        const peersAlready = roomMates.map((w) => {
          const p = peers.get(w)!;
          return { socketId: p.socketId, role: p.role, name: p.name };
        });

        ws.send(JSON.stringify({ event: "room-joined", roomId, peersAlready }));
        broadcast(ws, { event: "peer-joined", socketId, role, name });

        console.log(`[WS][Room ${roomId}] ${role}/${name} joined. Room size: ${rooms.get(roomId)!.size}  peersAlready=${peersAlready.length}`);
        return;
      }

      const info = peers.get(ws);
      if (!info) return;

      broadcast(ws, { ...msg, senderRole: info.role, senderSocketId: info.socketId });
    });

    ws.on("close", (code, reason) => {
      const info = peers.get(ws);
      console.log(`[WS] Disconnected: ${info?.socketId ?? socketId}  room=${info?.roomId ?? "none"}  code=${code}  reason=${reason.toString() || "—"}`);
      leaveRoom(ws);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error on ${socketId}: ${err.message}`);
    });

    ws.send(JSON.stringify({ event: "connected", socketId }));
  });

  return wss;
}
