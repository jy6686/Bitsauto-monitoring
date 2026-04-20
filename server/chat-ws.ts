import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { storage } from "./storage";
import type { IncomingMessage } from "http";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ChatClient {
  ws: WebSocket;
  userId: string;
  userName: string;
  userRole: string;
  roomIds: Set<number>;
  connectedAt: number;
}

interface WsIncoming {
  type: "join" | "message" | "typing" | "ping" | "join_room" | "leave_room";
  userId?: string;
  userName?: string;
  userRole?: string;
  roomId?: number;
  content?: string;
}

interface WsOutgoing {
  type: string;
  [key: string]: unknown;
}

// ── State ──────────────────────────────────────────────────────────────────────
const clients = new Map<string, ChatClient>(); // userId → ChatClient

function broadcast(roomId: number | null, payload: WsOutgoing, excludeUserId?: string): void {
  const data = JSON.stringify(payload);
  for (const [uid, client] of clients) {
    if (excludeUserId && uid === excludeUserId) continue;
    if (roomId !== null && !client.roomIds.has(roomId)) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function broadcastAll(payload: WsOutgoing, excludeUserId?: string): void {
  broadcast(null, payload, excludeUserId);
}

function presenceList() {
  return [...clients.values()].map(c => ({
    userId: c.userId,
    userName: c.userName,
    userRole: c.userRole,
    connectedAt: c.connectedAt,
  }));
}

function sendJson(ws: WebSocket, payload: WsOutgoing): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────────
export function setupChatWebSocket(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/chat/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let myUserId = "";

    ws.on("message", async (raw) => {
      let msg: WsIncoming;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "join": {
          if (!msg.userId || !msg.userName) break;
          myUserId = msg.userId;
          const client: ChatClient = {
            ws,
            userId: msg.userId,
            userName: msg.userName,
            userRole: msg.userRole ?? "viewer",
            roomIds: new Set<number>(),
            connectedAt: Date.now(),
          };
          clients.set(myUserId, client);

          // Auto-join all group rooms
          const rooms = await storage.getChatRooms();
          const groupRooms = rooms.filter(r => r.type === "group");
          for (const room of groupRooms) client.roomIds.add(room.id);

          sendJson(ws, { type: "rooms", rooms });
          sendJson(ws, { type: "presence", online: presenceList() });
          broadcastAll({ type: "user_joined", userId: myUserId, userName: msg.userName, userRole: msg.userRole ?? "viewer", online: presenceList() }, myUserId);
          break;
        }

        case "join_room": {
          if (!msg.roomId || !myUserId) break;
          const client = clients.get(myUserId);
          if (!client) break;
          client.roomIds.add(msg.roomId);
          // Load history and send
          const history = await storage.getChatMessages(msg.roomId, 100);
          sendJson(ws, { type: "history", roomId: msg.roomId, messages: history });
          break;
        }

        case "leave_room": {
          if (!msg.roomId || !myUserId) break;
          const client = clients.get(myUserId);
          if (client) client.roomIds.delete(msg.roomId);
          break;
        }

        case "message": {
          if (!msg.roomId || !msg.content?.trim() || !myUserId) break;
          const client = clients.get(myUserId);
          if (!client) break;
          // Persist to DB
          const saved = await storage.createChatMessage({
            roomId: msg.roomId,
            senderId: client.userId,
            senderName: client.userName,
            senderRole: client.userRole,
            content: msg.content.trim(),
          });
          // Broadcast to all room members
          broadcast(msg.roomId, { type: "message", message: saved });
          break;
        }

        case "typing": {
          if (!msg.roomId || !myUserId) break;
          const client = clients.get(myUserId);
          if (!client) break;
          broadcast(msg.roomId, { type: "typing", roomId: msg.roomId, userId: myUserId, userName: client.userName }, myUserId);
          break;
        }

        case "ping": {
          sendJson(ws, { type: "pong" });
          break;
        }
      }
    });

    ws.on("close", () => {
      if (myUserId) {
        const client = clients.get(myUserId);
        clients.delete(myUserId);
        broadcastAll({ type: "user_left", userId: myUserId, userName: client?.userName ?? myUserId, online: presenceList() });
      }
    });

    ws.on("error", () => {
      if (myUserId) clients.delete(myUserId);
    });
  });

  console.log("[chat-ws] WebSocket chat server attached at /api/chat/ws");
}
