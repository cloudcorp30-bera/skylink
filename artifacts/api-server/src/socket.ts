import type { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";

interface PeerInfo {
  socketId: string;
  role: "sky" | "link";
  name: string;
}

interface Room {
  roomId: string;
  peers: Map<string, PeerInfo>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { roomId, peers: new Map(), createdAt: Date.now() });
  }
  return rooms.get(roomId)!;
}

function cleanupRooms() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  for (const [roomId, room] of rooms) {
    if (room.peers.size === 0 && now - room.createdAt > ONE_HOUR) {
      rooms.delete(roomId);
    }
  }
}

setInterval(cleanupRooms, 10 * 60 * 1000);

const RELAY_EVENTS = [
  "chat-message",
  "control-command",
  "file-start",
  "file-chunk",
  "file-end",
  "file-error",
  "camera-frame",
  "camera-stop",
  "location-update",
  "location-stop",
  "audio-chunk",
  "clipboard-sync",
  "device-control",
  "device-info",
  "battery-update",
  "brightness-update",
  "typing-indicator",
  "screen-share-frame",
  "sensor-data",
  "sensor-log-entry",
  "wb-stroke",
  "wb-clear",
  "wb-undo",
  "tts-speak",
  "network-info",
  "contacts-share",
  "macro-trigger",
  "screenshot-request",
  "screenshot-response",
  "webrtc-offer",
  "webrtc-answer",
  "webrtc-ice",
  "webrtc-hangup",
  "remote-command",
  "device-report",
  "device-report-request",
];

export function initSocketServer(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 50 * 1024 * 1024,
    pingTimeout: 60000,
    pingInterval: 25000,
    // Replit proxy keeps the /api prefix when forwarding to port 8080,
    // so socket.io must be mounted at /api/socket.io not /socket.io
    path: "/api/socket.io",
  });

  io.on("connection", (socket) => {
    let currentRoom: string | null = null;
    let currentRole: "sky" | "link" | null = null;

    console.log(`[Socket] Connected: ${socket.id}`);

    socket.on(
      "join-room",
      ({ roomId, role, name }: { roomId: string; role: "sky" | "link"; name: string }) => {
        if (currentRoom) {
          socket.leave(currentRoom);
          rooms.get(currentRoom)?.peers.delete(socket.id);
        }

        currentRoom = roomId.toUpperCase();
        currentRole = role;
        const room = getOrCreateRoom(currentRoom);
        room.peers.set(socket.id, { socketId: socket.id, role, name });
        socket.join(currentRoom);

        const otherPeers = Array.from(room.peers.values()).filter(
          (p) => p.socketId !== socket.id
        );

        socket.emit("room-joined", { roomId: currentRoom, peersAlready: otherPeers });
        socket.to(currentRoom).emit("peer-joined", { socketId: socket.id, role, name });
        console.log(`[Room ${currentRoom}] ${role}/${name} joined. Peers: ${room.peers.size}`);
      }
    );

    for (const event of RELAY_EVENTS) {
      socket.on(event, (data: unknown) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit(event, {
          ...(typeof data === "object" && data !== null ? data : { data }),
          senderSocketId: socket.id,
          senderRole: currentRole,
        });
      });
    }

    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      if (currentRoom) {
        rooms.get(currentRoom)?.peers.delete(socket.id);
        socket.to(currentRoom).emit("peer-left", { socketId: socket.id, role: currentRole });
      }
    });
  });

  return io;
}
