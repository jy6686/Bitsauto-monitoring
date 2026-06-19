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
  type: "join" | "message" | "typing" | "ping" | "join_room" | "leave_room" | "open_dm";
  userId?: string;
  userName?: string;
  userRole?: string;
  roomId?: number;
  content?: string;
  targetUserId?: string;
  targetUserName?: string;
}

interface WsOutgoing {
  type: string;
  [key: string]: unknown;
}

// ── State ──────────────────────────────────────────────────────────────────────
export const clients = new Map<string, ChatClient>(); // userId → ChatClient (exported for routes)

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

function sendTo(userId: string, payload: WsOutgoing): void {
  const client = clients.get(userId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(payload));
  }
}

export function presenceList() {
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

// Build a stable DM slug from two user IDs (sorted so A↔B === B↔A)
function dmSlug(uid1: string, uid2: string): string {
  return "dm_" + [uid1, uid2].sort().join("_");
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

          // Also auto-join any existing DM rooms this user participated in
          const myDmRooms = rooms.filter(r =>
            r.type === "direct" && r.slug.includes(myUserId)
          );
          for (const room of myDmRooms) client.roomIds.add(room.id);

          sendJson(ws, { type: "rooms", rooms });
          sendJson(ws, { type: "presence", online: presenceList() });
          broadcastAll(
            { type: "user_joined", userId: myUserId, userName: msg.userName, userRole: msg.userRole ?? "viewer", online: presenceList() },
            myUserId
          );
          break;
        }

        case "join_room": {
          if (!msg.roomId || !myUserId) break;
          const client = clients.get(myUserId);
          if (!client) break;
          client.roomIds.add(msg.roomId);
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

        case "open_dm": {
          if (!msg.targetUserId || !myUserId) break;
          const myClient = clients.get(myUserId);
          if (!myClient) break;

          const targetId = msg.targetUserId;
          const targetName = msg.targetUserName ?? targetId;
          const slug = dmSlug(myUserId, targetId);

          // Find or create the DM room
          let room = await storage.getChatRoom(slug);
          if (!room) {
            room = await storage.createChatRoom({
              name: `${myClient.userName} ↔ ${targetName}`,
              type: "direct",
              slug,
            });
          }

          // Subscribe initiator to this room
          myClient.roomIds.add(room.id);
          const history = await storage.getChatMessages(room.id, 100);
          sendJson(ws, { type: "dm_opened", room, messages: history, withUserId: targetId, withUserName: targetName });

          // If target is online, invite them into the room too
          const targetClient = clients.get(targetId);
          if (targetClient) {
            targetClient.roomIds.add(room.id);
            sendJson(targetClient.ws, {
              type: "dm_invited",
              room,
              messages: history,
              fromUserId: myUserId,
              fromUserName: myClient.userName,
            });
          }
          break;
        }

        case "message": {
          if (!msg.roomId || !msg.content?.trim() || !myUserId) break;
          const client = clients.get(myUserId);
          if (!client) break;

          const saved = await storage.createChatMessage({
            roomId: msg.roomId,
            senderId: client.userId,
            senderName: client.userName,
            senderRole: client.userRole,
            content: msg.content.trim(),
          });

          // For DM rooms — make sure BOTH participants receive it,
          // even if one of them hasn't explicitly joined the room in this session.
          const room = (await storage.getChatRooms()).find(r => r.id === msg.roomId);
          if (room?.type === "direct") {
            // Extract participant IDs from slug: "dm_uid1_uid2"
            const parts = room.slug.replace(/^dm_/, "").split("_");
            // Replit IDs are numeric, split gives us exactly 2 parts
            // (safe because numeric IDs have no underscores)
            for (const uid of parts) {
              const c = clients.get(uid);
              if (c && c.ws.readyState === WebSocket.OPEN) {
                if (!c.roomIds.has(msg.roomId)) c.roomIds.add(msg.roomId);
                c.ws.send(JSON.stringify({ type: "message", message: saved }));
              }
            }
          } else {
            // Group room — broadcast to all subscribers
            broadcast(msg.roomId, { type: "message", message: saved });
          }
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
        broadcastAll({
          type: "user_left",
          userId: myUserId,
          userName: client?.userName ?? myUserId,
          online: presenceList(),
        });
      }
    });

    ws.on("error", () => {
      if (myUserId) clients.delete(myUserId);
    });
  });

  console.log("[chat-ws] WebSocket chat server attached at /api/chat/ws");
}
