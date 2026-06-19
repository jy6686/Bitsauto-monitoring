import { useEffect, useRef, useState, useCallback } from "react";
import type { LiveTrafficSnapshot } from "@/types/live-traffic";

interface UseLiveTrafficWsResult {
  snapshot: LiveTrafficSnapshot | null;
  connected: boolean;
}

export function useLiveTrafficWs(): UseLiveTrafficWsResult {
  const [snapshot, setSnapshot] = useState<LiveTrafficSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live-traffic`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "live_traffic_snapshot") {
            setSnapshot({ windows: data.windows, computedAt: data.computedAt });
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setConnected(false);
        if (mountedRef.current) {
          reconnectRef.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = () => { ws.close(); };
    } catch { /* ignore — reconnect will handle */ }
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

  return { snapshot, connected };
}
