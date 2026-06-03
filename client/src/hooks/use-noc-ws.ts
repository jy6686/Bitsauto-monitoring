import { useEffect, useRef, useState, useCallback } from "react";

export interface NocTickData {
  callCount: number;
  alertCount: number;
  updatedAt: string;
}

export interface VoiceOtpUpdateEvent {
  callId: number;
  status: string;
  asteriskId?: string | null;
  errorMessage?: string | null;
}

export interface RollbackFailureAlert {
  actionId:       number;
  accountName:    string;
  errorMessage:   string;
  manualRequired: boolean;
  occurredAt:     string;
}

export interface PendingApprovalEvent {
  actionId:        number;
  actionType:      string;
  accountName:     string;
  requestedByName: string;
  primaryAction:   string;
}

interface UseNocWebSocketResult {
  lastTick: NocTickData | null;
  lastVoiceOtpUpdate: VoiceOtpUpdateEvent | null;
  lastRollbackFailure: RollbackFailureAlert | null;
  lastPendingApproval: PendingApprovalEvent | null;
  connected: boolean;
}

export function useNocWebSocket(): UseNocWebSocketResult {
  const [lastTick, setLastTick] = useState<NocTickData | null>(null);
  const [lastVoiceOtpUpdate, setLastVoiceOtpUpdate] = useState<VoiceOtpUpdateEvent | null>(null);
  const [lastRollbackFailure, setLastRollbackFailure] = useState<RollbackFailureAlert | null>(null);
  const [lastPendingApproval, setLastPendingApproval] = useState<PendingApprovalEvent | null>(null);
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
          } else if (data.type === "voice_otp_update") {
            setLastVoiceOtpUpdate({
              callId: data.callId,
              status: data.status,
              asteriskId: data.asteriskId ?? null,
              errorMessage: data.errorMessage ?? null,
            });
          } else if (data.type === "rollback_failure_alert") {
            setLastRollbackFailure({
              actionId:       data.actionId,
              accountName:    data.accountName,
              errorMessage:   data.errorMessage,
              manualRequired: data.manualRequired,
              occurredAt:     data.occurredAt,
            });
          } else if (data.type === "pending_approval_required") {
            setLastPendingApproval({
              actionId:        data.actionId,
              actionType:      data.actionType,
              accountName:     data.accountName,
              requestedByName: data.requestedByName,
              primaryAction:   data.primaryAction,
            });
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

  return { lastTick, lastVoiceOtpUpdate, lastRollbackFailure, lastPendingApproval, connected };
}
