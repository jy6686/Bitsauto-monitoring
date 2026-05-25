// server/simulation-engine.ts
// ══════════════════════════════════════════════════════════════════════════════
// PURE COMPUTATION MODULE — Route Simulation Engine
// DO NOT IMPORT: db | storage | sippy | routing APIs | mutation utilities
// This module MUST remain side-effect free. All functions are deterministic.
// ══════════════════════════════════════════════════════════════════════════════

export interface CarrierMetrics {
  carrierName:    string;
  stabilityScore: number;  // 0–100
  rollingAsr:     number;  // 0–100 (%)
  avgPddMs:       number;  // milliseconds
  failureRate:    number;  // 0–100 (%)
  fasRate:        number;  // 0–100 (%)
  sampleCount:    number;
  revenueShare:   number;  // % of portfolio
  trafficShare:   number;  // % of portfolio
}

export interface SimulationInput {
  fromCarrier:  string;
  toCarrier:    string;
  shiftPercent: number;  // 0–50
  carriers:     CarrierMetrics[];
}

export interface PortfolioMetrics {
  portfolioAsr:        number;
  portfolioStability:  number;
  portfolioFasRate:    number;
  portfolioMargin:     number;  // synthetic proxy
  vendorConcentration: number;  // HHI-style 0–100
  projectedRevenue:    number;  // index (100 = baseline)
}

export interface CarrierSimState {
  carrierName:  string;
  trafficShare: number;
  asr:          number;
  stability:    number;
  fasRate:      number;
}

export interface SimulationResult {
  valid:    boolean;
  reason?:  string;
  input:    SimulationInput;
  current:  PortfolioMetrics;
  simulated: PortfolioMetrics;
  delta: {
    asr:           number;
    stability:     number;
    fasRate:       number;
    margin:        number;
    concentration: number;
  };
  carrierStates: {
    current:   CarrierSimState[];
    simulated: CarrierSimState[];
  };
}

// ── Internal portfolio aggregation ────────────────────────────────────────────

function aggregatePortfolio(states: CarrierSimState[]): PortfolioMetrics {
  const totalShare = states.reduce((s, c) => s + c.trafficShare, 0);
  if (totalShare === 0) {
    return { portfolioAsr: 0, portfolioStability: 0, portfolioFasRate: 0, portfolioMargin: 0, vendorConcentration: 0, projectedRevenue: 100 };
  }

  let wAsr = 0, wStability = 0, wFas = 0;
  for (const c of states) {
    const w  = c.trafficShare / totalShare;
    wAsr       += c.asr       * w;
    wStability += c.stability * w;
    wFas       += c.fasRate   * w;
  }

  // HHI-style concentration (normalised 0–100)
  const hhi = states.reduce((s, c) => {
    const share = c.trafficShare / totalShare;
    return s + share * share;
  }, 0);
  const concentration = Math.round(hhi * 100);

  // Margin proxy: ASR-weighted, penalise FAS exposure and concentration
  const margin = Math.max(0, Math.round(wAsr * 0.6 - wFas * 2.5 - concentration * 0.15));

  // Revenue index: reflects stability level relative to baseline
  const revenueIndex = Math.round((wStability / 100) * 100);

  return {
    portfolioAsr:        Math.round(wAsr * 10) / 10,
    portfolioStability:  Math.round(wStability * 10) / 10,
    portfolioFasRate:    Math.round(wFas * 1000) / 1000,
    portfolioMargin:     margin,
    vendorConcentration: concentration,
    projectedRevenue:    revenueIndex,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function runSimulation(input: SimulationInput): SimulationResult {
  const { fromCarrier, toCarrier, shiftPercent, carriers } = input;

  const invalid = (reason: string): SimulationResult => ({
    valid: false, reason, input,
    current: aggregatePortfolio([]),
    simulated: aggregatePortfolio([]),
    delta: { asr: 0, stability: 0, fasRate: 0, margin: 0, concentration: 0 },
    carrierStates: { current: [], simulated: [] },
  });

  if (shiftPercent < 0 || shiftPercent > 50) return invalid('shiftPercent must be 0–50');
  if (fromCarrier === toCarrier)             return invalid('fromCarrier and toCarrier must differ');

  const from = carriers.find(c => c.carrierName === fromCarrier);
  const to   = carriers.find(c => c.carrierName === toCarrier);
  if (!from) return invalid(`Carrier "${fromCarrier}" not found`);
  if (!to)   return invalid(`Carrier "${toCarrier}" not found`);

  // Current snapshot
  const currentStates: CarrierSimState[] = carriers.map(c => ({
    carrierName:  c.carrierName,
    trafficShare: c.trafficShare,
    asr:          c.rollingAsr,
    stability:    c.stabilityScore,
    fasRate:      c.fasRate,
  }));

  // Simulated snapshot — transfer shiftPercent of from's share to to
  const actualShift = Math.min(shiftPercent, from.trafficShare);

  const simulatedStates: CarrierSimState[] = carriers.map(c => {
    if (c.carrierName === fromCarrier) {
      return {
        carrierName:  c.carrierName,
        trafficShare: Math.max(0, c.trafficShare - actualShift),
        asr:          c.rollingAsr,
        stability:    c.stabilityScore,
        fasRate:      c.fasRate,
      };
    }
    if (c.carrierName === toCarrier) {
      const newShare = c.trafficShare + actualShift;
      const blendW   = actualShift / newShare;  // weight of incoming traffic
      return {
        carrierName:  c.carrierName,
        trafficShare: newShare,
        asr:          c.rollingAsr       * (1 - blendW) + from.rollingAsr       * blendW,
        stability:    c.stabilityScore   * (1 - blendW) + from.stabilityScore   * blendW,
        fasRate:      c.fasRate          * (1 - blendW) + from.fasRate          * blendW,
      };
    }
    return {
      carrierName:  c.carrierName,
      trafficShare: c.trafficShare,
      asr:          c.rollingAsr,
      stability:    c.stabilityScore,
      fasRate:      c.fasRate,
    };
  });

  const current   = aggregatePortfolio(currentStates);
  const simulated = aggregatePortfolio(simulatedStates);

  return {
    valid: true,
    input,
    current,
    simulated,
    delta: {
      asr:           Math.round((simulated.portfolioAsr        - current.portfolioAsr)        * 10) / 10,
      stability:     Math.round((simulated.portfolioStability  - current.portfolioStability)  * 10) / 10,
      fasRate:       Math.round((simulated.portfolioFasRate    - current.portfolioFasRate)    * 1000) / 1000,
      margin:        simulated.portfolioMargin     - current.portfolioMargin,
      concentration: simulated.vendorConcentration - current.vendorConcentration,
    },
    carrierStates: { current: currentStates, simulated: simulatedStates },
  };
}
