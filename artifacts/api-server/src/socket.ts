import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Client, Pool } from "pg";

// ─── Database setup ──────────────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL;

// Pool for regular queries (session logging, etc.)
const pool = DB_URL
  ? new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  : null;

// CRITICAL: without this handler Node.js will crash when the DB admin
// terminates an idle pooled connection and pg emits an 'error' event.
pool?.on("error", (err) => {
  console.error("[DB] Pool client error (non-fatal):", err.message);
});

// Dedicated listener client — LISTEN/NOTIFY requires a persistent connection
let listenerClient: Client | null = null;

async function dbQuery(sql: string, params: unknown[] = []) {
  if (!pool) return null;
  try {
    return await pool.query(sql, params);
  } catch (e) {
    console.error("[DB] Query error:", (e as Error).message);
    return null;
  }
}

async function logMessage(roomId: string, senderRole: string, eventType: string, payload: object) {
  await dbQuery(
    "INSERT INTO skylink_messages(room_id, sender_role, event_type, payload) VALUES($1,$2,$3,$4)",
    [roomId, senderRole, eventType, JSON.stringify(payload)]
  );
}

async function recordSessionJoin(roomId: string, role: "sky" | "link") {
  const col = role === "sky" ? "sky_joined_at" : "link_joined_at";
  await dbQuery(
    `INSERT INTO skylink_sessions(id, ${col}) VALUES($1, NOW())
     ON CONFLICT(id) DO UPDATE SET ${col} = NOW()`,
    [roomId]
  );
}

async function recordSessionEnd(roomId: string) {
  await dbQuery(
    "UPDATE skylink_sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL",
    [roomId]
  );
}

// ─── In-memory room state (local to this instance) ───────────────────────────

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

// Deliver a raw JSON string to all local room members (excludes sender)
function deliverLocally(fromWs: WebSocket | null, roomId: string, msgStr: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const w of room) {
    if (w !== fromWs && w.readyState === WebSocket.OPEN) {
      w.send(msgStr);
    }
  }
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── PostgreSQL pub/sub for cross-instance relay ──────────────────────────────

const NOTIFY_CHANNEL = "skylink_relay";

let listenerReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleListenerReconnect() {
  if (listenerReconnectTimer) return; // already scheduled
  listenerReconnectTimer = setTimeout(() => {
    listenerReconnectTimer = null;
    setupListener();
  }, 5000);
}

async function setupListener() {
  if (!DB_URL) return;

  // Tear down any existing broken client first
  if (listenerClient) {
    const old = listenerClient;
    listenerClient = null;
    old.removeAllListeners();
    try { await old.end(); } catch {}
  }

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  // Attach error handler BEFORE connect() to avoid unhandled-error crashes
  client.on("error", (e) => {
    console.error("[DB] Listener error:", e.message);
    scheduleListenerReconnect();
  });

  client.on("end", () => {
    console.warn("[DB] Listener connection ended — will reconnect");
    scheduleListenerReconnect();
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    listenerClient = client;
    console.log("[DB] LISTEN ready on channel:", NOTIFY_CHANNEL);

    client.on("notification", (n) => {
      if (!n.payload) return;
      try {
        const { roomId, msg, originInstance } = JSON.parse(n.payload) as {
          roomId: string;
          msg: string;
          originInstance: string;
        };
        if (originInstance === INSTANCE_ID) return;
        deliverLocally(null, roomId, msg);
      } catch {}
    });
  } catch (e) {
    console.error("[DB] Could not start listener:", (e as Error).message);
    try { await client.end(); } catch {}
    scheduleListenerReconnect();
  }
}

// Unique ID for this server instance — prevents echo of own NOTIFY messages
const INSTANCE_ID = genId();

async function broadcastViaDB(roomId: string, msg: string) {
  if (!pool) return;
  try {
    const payload = JSON.stringify({ roomId, msg, originInstance: INSTANCE_ID });
    // pg NOTIFY payload max is 8000 bytes — skip large payloads (camera frames etc.)
    if (payload.length > 7800) return;
    await pool.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, payload]);
  } catch (e) {
    console.error("[DB] NOTIFY error:", (e as Error).message);
  }
}

// ─── Main WebSocket server ────────────────────────────────────────────────────

export async function initSocketServer(httpServer: HttpServer) {
  await setupListener();

  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });
  console.log(`[WS] Ready on /api/ws  instance=${INSTANCE_ID}  db=${pool ? "yes" : "no"}`);

  // Heartbeat — detect and terminate unresponsive connections
  const heartbeat = setInterval(() => {
    for (const [ws, info] of peers) {
      if (!info.alive) {
        console.log(`[WS] Terminating unresponsive ${info.socketId}`);
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

    ws.on("message", async (raw) => {
      let msg: { event: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Client keepalive ping
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

        // Notify local room members
        const joinMsg = JSON.stringify({ event: "peer-joined", socketId, role, name });
        deliverLocally(ws, roomId, joinMsg);

        // Also notify other instances via DB
        broadcastViaDB(roomId, joinMsg);

        console.log(`[WS][${roomId}] ${role}/${name} joined. Local peers: ${rooms.get(roomId)!.size}  peersAlready: ${peersAlready.length}`);
        recordSessionJoin(roomId, role);
        return;
      }

      // All other events: relay to local room members + broadcast via DB
      const info = peers.get(ws);
      if (!info) return;

      const outMsg = JSON.stringify({
        ...msg,
        senderRole: info.role,
        senderSocketId: info.socketId,
      });

      // Local delivery (fast path)
      deliverLocally(ws, info.roomId, outMsg);

      // Cross-instance delivery via PostgreSQL NOTIFY
      broadcastViaDB(info.roomId, outMsg);

      // Persist chat messages to DB
      if (msg.event === "chat-message") {
        logMessage(info.roomId, info.role, "chat", { content: msg.content });
      }
    });

    ws.on("close", (code, reason) => {
      const info = peers.get(ws);
      console.log(`[WS] Closed: ${info?.socketId ?? socketId}  room=${info?.roomId ?? "none"}  code=${code}  reason=${reason.toString() || "—"}`);
      if (info?.roomId && rooms.get(info.roomId)?.size === 1) {
        recordSessionEnd(info.roomId);
      }
      leaveRoom(ws);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error ${socketId}: ${err.message}`);
    });

    ws.send(JSON.stringify({ event: "connected", socketId }));
  });

  return wss;
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

  const leftMsg = JSON.stringify({ event: "peer-left", role: info.role, name: info.name });
  deliverLocally(ws, info.roomId, leftMsg);
  broadcastViaDB(info.roomId, leftMsg);

  console.log(`[WS][${info.roomId}] ${info.role}/${info.name} left. Room size: ${room?.size ?? 0}`);
}
