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
