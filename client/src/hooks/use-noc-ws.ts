import { useEffect, useRef, useState, useCallback } from "react";

export interface NocTickData {
  callCount: number;
  alertCount: number;
  updatedAt: string;
}

interface UseNocWebSocketResult {
  lastTick: NocTickData | null;
  connected: boolean;
}

export function useNocWebSocket(): UseNocWebSocketResult {
  const [lastTick, setLastTick] = useState<NocTickData | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/noc`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "noc_tick") {
            setLastTick({ callCount: data.callCount, alertCount: data.alertCount, updatedAt: data.updatedAt });
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        setConnected(false);
        if (mountedRef.current) {
          reconnectRef.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch { /* ignore connection errors — reconnect will handle */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { lastTick, connected };
}
