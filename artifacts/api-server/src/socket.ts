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
    rooms.set(roomId, {
      roomId,
      peers: new Map(),
      createdAt: Date.now(),
    });
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

export function initSocketServer(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 50 * 1024 * 1024,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket) => {
    let currentRoom: string | null = null;
    let currentRole: "sky" | "link" | null = null;

    console.log(`[Socket] Connected: ${socket.id}`);

    socket.on("join-room", ({ roomId, role, name }: { roomId: string; role: "sky" | "link"; name: string }) => {
      if (currentRoom) {
        socket.leave(currentRoom);
        const prevRoom = rooms.get(currentRoom);
        if (prevRoom) prevRoom.peers.delete(socket.id);
      }

      currentRoom = roomId.toUpperCase();
      currentRole = role;
      const room = getOrCreateRoom(currentRoom);
      const peer: PeerInfo = { socketId: socket.id, role, name };
      room.peers.set(socket.id, peer);
      socket.join(currentRoom);

      const otherPeers = Array.from(room.peers.values()).filter(
        (p) => p.socketId !== socket.id
      );

      socket.emit("room-joined", {
        roomId: currentRoom,
        peersAlready: otherPeers,
      });

      socket.to(currentRoom).emit("peer-joined", {
        socketId: socket.id,
        role,
        name,
      });

      console.log(`[Room ${currentRoom}] ${role}/${name} joined. Peers: ${room.peers.size}`);
    });

    socket.on("chat-message", ({ content }: { content: string }) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("chat-message", {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content,
        senderSocketId: socket.id,
        senderRole: currentRole,
        timestamp: Date.now(),
      });
    });

    socket.on("control-command", ({ command }: { command: string }) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("control-command", {
        command,
        senderSocketId: socket.id,
        senderRole: currentRole,
        timestamp: Date.now(),
      });
    });

    socket.on(
      "file-start",
      ({
        transferId,
        fileName,
        fileSize,
        mimeType,
        totalChunks,
      }: {
        transferId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        totalChunks: number;
      }) => {
        if (!currentRoom) return;
        console.log(`[Transfer] Start: ${fileName} (${fileSize} bytes, ${totalChunks} chunks)`);
        socket.to(currentRoom).emit("file-start", {
          transferId,
          fileName,
          fileSize,
          mimeType,
          totalChunks,
          senderSocketId: socket.id,
          senderRole: currentRole,
        });
      }
    );

    socket.on(
      "file-chunk",
      ({
        transferId,
        chunkIndex,
        data,
      }: {
        transferId: string;
        chunkIndex: number;
        data: string;
      }) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit("file-chunk", {
          transferId,
          chunkIndex,
          data,
        });
      }
    );

    socket.on("file-end", ({ transferId }: { transferId: string }) => {
      if (!currentRoom) return;
      console.log(`[Transfer] Complete: ${transferId}`);
      socket.to(currentRoom).emit("file-end", { transferId });
    });

    socket.on("file-error", ({ transferId, error }: { transferId: string; error: string }) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("file-error", { transferId, error });
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      if (currentRoom) {
        const room = rooms.get(currentRoom);
        if (room) {
          room.peers.delete(socket.id);
          socket.to(currentRoom).emit("peer-left", {
            socketId: socket.id,
            role: currentRole,
          });
        }
      }
    });
  });

  return io;
}
