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

export interface ApprovalExpiredEvent {
  actionId:        number;
  accountName:     string;
  actionType:      string;
  requestedByName: string;
  ttlMinutes:      number;
  expiredAt:       string;
}

export interface SipSpikeEvent {
  vendorName:   string;
  code:         number;
  codeLabel:    string;
  currentRate:  number;
  baselineRate: number;
  multiplier:   number;
  severity:     string;
  incidentId:   number;
  detectedAt:   string;
}

export interface IncidentUpdatedEvent {
  incidentId:   number;
  status:       string;
  incidentType: string;
  entityName?:  string | null;
}

interface UseNocWebSocketResult {
  lastTick: NocTickData | null;
  lastVoiceOtpUpdate: VoiceOtpUpdateEvent | null;
  lastRollbackFailure: RollbackFailureAlert | null;
  lastPendingApproval: PendingApprovalEvent | null;
  lastApprovalExpired: ApprovalExpiredEvent | null;
  lastSipSpike: SipSpikeEvent | null;
  lastIncidentUpdated: IncidentUpdatedEvent | null;
  connected: boolean;
  /**
   * True once fast reconnects have been exhausted — the live push channel is
   * unavailable (e.g. the environment's proxy blocks WebSocket upgrades) and
   * the UI should rely on its polling queries. The hook still retries in the
   * background at a slow interval, so this can flip back to false if the
   * channel recovers. Use it to show a "polling mode" badge.
   */
  liveUnavailable: boolean;
}

// After this many consecutive failures, stop the fast reconnect loop (which
// otherwise hammers the server and floods the console) and drop to a slow
// background retry. Kept small so a genuinely transient blip still recovers
// quickly, but a hard block (proxy/auth-shield rejecting the upgrade) settles
// into polling mode within a few seconds instead of looping forever.
const MAX_FAST_ATTEMPTS = 4;
const SLOW_RETRY_MS     = 180_000; // 3 min — occasional probe once degraded

export function useNocWebSocket(): UseNocWebSocketResult {
  const [lastTick, setLastTick] = useState<NocTickData | null>(null);
  const [lastVoiceOtpUpdate, setLastVoiceOtpUpdate] = useState<VoiceOtpUpdateEvent | null>(null);
  const [lastRollbackFailure, setLastRollbackFailure] = useState<RollbackFailureAlert | null>(null);
  const [lastPendingApproval, setLastPendingApproval] = useState<PendingApprovalEvent | null>(null);
  const [lastApprovalExpired, setLastApprovalExpired] = useState<ApprovalExpiredEvent | null>(null);
  const [lastSipSpike, setLastSipSpike] = useState<SipSpikeEvent | null>(null);
  const [lastIncidentUpdated, setLastIncidentUpdated] = useState<IncidentUpdatedEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attemptsRef = useRef(0);

  // Schedule the next reconnect. Fast backoff (1s→8s) for the first few
  // attempts, then settle into a slow periodic probe and flag the channel as
  // unavailable so the UI can fall back to polling instead of the console
  // filling with failed-handshake errors every 5s forever.
  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (!mountedRef.current) return;
    attemptsRef.current += 1;
    const fast = attemptsRef.current <= MAX_FAST_ATTEMPTS;
    if (!fast) setLiveUnavailable(true);
    const delay = fast
      ? Math.min(1000 * 2 ** (attemptsRef.current - 1), 8000)
      : SLOW_RETRY_MS;
    reconnectRef.current = setTimeout(connectFn, delay);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/noc`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        attemptsRef.current = 0;      // reset backoff on a healthy connection
        setLiveUnavailable(false);
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
          } else if (data.type === "approval_expired") {
            setLastApprovalExpired({
              actionId:        data.actionId,
              accountName:     data.accountName,
              actionType:      data.actionType,
              requestedByName: data.requestedByName,
              ttlMinutes:      data.ttlMinutes,
              expiredAt:       data.expiredAt,
            });
          } else if (data.type === "sip_spike_detected") {
            setLastSipSpike({
              vendorName:   data.vendorName,
              code:         data.code,
              codeLabel:    data.codeLabel,
              currentRate:  data.currentRate,
              baselineRate: data.baselineRate,
              multiplier:   data.multiplier,
              severity:     data.severity,
              incidentId:   data.incidentId,
              detectedAt:   data.detectedAt,
            });
          } else if (data.type === "incident_updated") {
            setLastIncidentUpdated({
              incidentId:   data.incidentId,
              status:       data.status,
              incidentType: data.incidentType,
              entityName:   data.entityName ?? null,
            });
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        setConnected(false);
        scheduleReconnect(connect);
      };

      ws.onerror = () => {
        ws.close();   // triggers onclose → scheduleReconnect
      };
    } catch {
      // new WebSocket() threw synchronously — no onclose will fire, so
      // schedule the retry here instead.
      scheduleReconnect(connect);
    }
  }, [scheduleReconnect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { lastTick, lastVoiceOtpUpdate, lastRollbackFailure, lastPendingApproval, lastApprovalExpired, lastSipSpike, lastIncidentUpdated, connected, liveUnavailable };
}
