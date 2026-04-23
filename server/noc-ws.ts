import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

interface NocClient {
  ws: WebSocket;
  connectedAt: number;
}

export interface NocTickData {
  callCount: number;
  alertCount: number;
  updatedAt: string;
}

const nocClients = new Set<NocClient>();

export function broadcastNocTick(data: NocTickData): void {
  if (nocClients.size === 0) return;
  const payload = JSON.stringify({ type: "noc_tick", ...data });
  for (const client of nocClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try { client.ws.send(payload); } catch { /* ignore send errors */ }
    }
  }
}

export function setupNocWebSocket(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/noc" });

  wss.on("connection", (ws: WebSocket) => {
    const client: NocClient = { ws, connectedAt: Date.now() };
    nocClients.add(client);

    ws.on("close", () => { nocClients.delete(client); });
    ws.on("error", () => { nocClients.delete(client); ws.close(); });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "noc_connected", connectedAt: new Date().toISOString() }));
    }
  });

  console.log("[noc-ws] NOC WebSocket server attached at /ws/noc");
}

export function nocClientCount(): number {
  return nocClients.size;
}
