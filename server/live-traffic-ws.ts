import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export interface LiveTrafficRow {
  name: string;
  calls: number;
  billable: number;
  asr: number;
  acd: number;
  duration: number;
  delta: number | null;
  iVendor?: number;
  iConnection?: number;
}

export interface LiveTrafficWindow {
  origination: LiveTrafficRow[];
  termination: LiveTrafficRow[];
  totalCalls: number;
  totalBillable: number;
  overallAsr: number;
}

export interface LiveTrafficSnapshot {
  windows: Record<string, LiveTrafficWindow>;
  computedAt: string;
}

interface LtClient {
  ws: WebSocket;
}

const ltClients = new Set<LtClient>();
let _lastSnapshot: LiveTrafficSnapshot | null = null;

export function getLastLiveTrafficSnapshot(): LiveTrafficSnapshot | null {
  return _lastSnapshot;
}

export function broadcastLiveTrafficSnapshot(snapshot: LiveTrafficSnapshot): void {
  _lastSnapshot = snapshot;
  if (ltClients.size === 0) return;
  const payload = JSON.stringify({ type: "live_traffic_snapshot", ...snapshot });
  for (const client of ltClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try { client.ws.send(payload); } catch { /* ignore send errors */ }
    }
  }
}

export function setupLiveTrafficWebSocket(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/live-traffic" });

  wss.on("connection", (ws: WebSocket) => {
    const client: LtClient = { ws };
    ltClients.add(client);

    ws.on("close", () => ltClients.delete(client));
    ws.on("error", () => { ltClients.delete(client); ws.close(); });

    if (_lastSnapshot && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "live_traffic_snapshot", ..._lastSnapshot }));
      } catch { /* ignore */ }
    }
  });

  console.log("[live-traffic-ws] WebSocket server attached at /ws/live-traffic");
}

export function ltClientCount(): number {
  return ltClients.size;
}
