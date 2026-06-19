// server/exposure-resolver.ts
// Vendor Portfolio Exposure Resolver — PURE COMPUTATION
// Maps carrier CDR traffic → prefix → country → portfolio exposure %.
// NO DB writes, NO Sippy calls, NO routing mutations.

import { matchPrefix } from './vendor-prefix-intelligence';

export interface CdrForExposure {
  vendor?: string;
  callee?: string;
  duration?: number;
  cost?: number;
  revenue?: number;
}

export interface PrefixExposure {
  prefix: string;
  country: string;
  iso2: string;
  flag: string;
  callShare: number;    // % of this vendor's calls on this prefix
  revenueShare: number; // % of total portfolio revenue from this prefix
}

export interface VendorExposure {
  carrier: string;
  portfolioExposure: number;  // % of total portfolio calls
  revenueExposure: number;    // % of total portfolio revenue
  affectedPrefixes: string[];
  countries: string[];
  activeCallShare: number;
  revenueShare: number;
  prefixBreakdown: PrefixExposure[];
  totalPortfolioCalls: number;
  vendorCalls: number;
}

export function resolveVendorExposure(
  carrierName: string,
  cdrs: CdrForExposure[],
): VendorExposure {
  const totalCalls   = cdrs.length;
  const totalRevenue = cdrs.reduce((s, c) => s + (c.revenue ?? 0), 0);

  const vendorCdrs = cdrs.filter(
    c => (c.vendor ?? '').toLowerCase() === carrierName.toLowerCase(),
  );
  const vendorCallCount = vendorCdrs.length;
  const vendorRevenue   = vendorCdrs.reduce((s, c) => s + (c.revenue ?? 0), 0);

  const prefixMap = new Map<string, {
    country: string; iso2: string; flag: string; calls: number; revenue: number;
  }>();

  for (const cdr of vendorCdrs) {
    const callee = String(cdr.callee ?? '').replace(/^\+/, '');
    const match  = matchPrefix(callee);
    if (!match) continue;
    const existing = prefixMap.get(match.prefix) ?? {
      country: match.country, iso2: match.iso2, flag: match.flag, calls: 0, revenue: 0,
    };
    existing.calls   += 1;
    existing.revenue += (cdr.revenue ?? 0);
    prefixMap.set(match.prefix, existing);
  }

  const prefixBreakdown: PrefixExposure[] = [];
  for (const [prefix, data] of prefixMap.entries()) {
    prefixBreakdown.push({
      prefix,
      country:      data.country,
      iso2:         data.iso2,
      flag:         data.flag,
      callShare:    vendorCallCount > 0 ? Math.round((data.calls / vendorCallCount) * 100) : 0,
      revenueShare: totalRevenue > 0    ? Math.round((data.revenue / totalRevenue) * 100) : 0,
    });
  }
  prefixBreakdown.sort((a, b) => b.callShare - a.callShare);

  return {
    carrier:            carrierName,
    portfolioExposure:  totalCalls   > 0 ? Math.round((vendorCallCount / totalCalls)   * 100) : 0,
    revenueExposure:    totalRevenue > 0 ? Math.round((vendorRevenue / totalRevenue)   * 100) : 0,
    affectedPrefixes:   prefixBreakdown.map(p => p.prefix),
    countries:          [...new Set(prefixBreakdown.map(p => p.country))],
    activeCallShare:    totalCalls   > 0 ? Math.round((vendorCallCount / totalCalls)   * 100) : 0,
    revenueShare:       totalRevenue > 0 ? Math.round((vendorRevenue / totalRevenue)   * 100) : 0,
    prefixBreakdown,
    totalPortfolioCalls: totalCalls,
    vendorCalls:         vendorCallCount,
  };
}
