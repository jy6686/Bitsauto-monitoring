/**
 * Sippy Change Watcher
 *
 * Periodically polls the Sippy softswitch to detect changes:
 * - New / removed client accounts
 * - New / removed / changed auth rule IPs per account
 * - New / removed vendor connections
 * - New client starting traffic (first concurrent calls seen)
 *
 * Sends email alerts via server/email.ts for each detected change.
 * Persists state in the `sippy_snapshots` DB table so restarts don't
 * re-fire alerts for pre-existing state.
 */

import * as sippy from './sippy';
import { storage } from './storage';
import { sendAlertEmail } from './email';
import { sendWhatsAppAlert, formatAuthAlert } from './whatsapp';

const SNAPSHOT_KEY = 'sippy_state_v1';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── State Types ───────────────────────────────────────────────────────────────

interface AccountEntry {
  iAccount: number;
  username: string;
  name?: string;
}

interface VendorEntry {
  iVendor: number;
  name: string;
}

interface ConnectionEntry {
  iVendor:     number;
  vendorName:  string;
  iConnection: number | string;
  name?:       string;
  destination?: string;
}

interface AuthRuleEntry {
  iAuthentication: number | string;
  iAccount:        number;
  accountName:     string;
  remoteIp?:       string;
  username?:       string;
}

interface SippyState {
  capturedAt:   string;
  accounts:     AccountEntry[];
  vendors:      VendorEntry[];
  connections:  ConnectionEntry[];
  authRules:    AuthRuleEntry[];
  seenClients:  string[];  // client names that have ever sent traffic
}

// ── New-client traffic notification hook ─────────────────────────────────────
// routes.ts calls this every time pushConcurrentPoint discovers a new client
// key. The watcher checks if it's truly new and fires an alert if so.

const knownTrafficClients = new Set<string>();
let watcherInitialized = false;
let lastRunAt: Date | null = null;
let lastRunChanges: number | null = null;
let lastRunError: string | null = null;
let currentSnapshot: SippyState | null = null;

export function getWatcherStatus() {
  return {
    initialized: watcherInitialized,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunChanges,
    lastRunError,
    snapshot: currentSnapshot ? {
      capturedAt: currentSnapshot.capturedAt,
      accounts: currentSnapshot.accounts.length,
      vendors: currentSnapshot.vendors.length,
      connections: currentSnapshot.connections.length,
      authRules: currentSnapshot.authRules.length,
      seenClients: currentSnapshot.seenClients.length,
      accountNames: currentSnapshot.accounts.map(a => a.name || a.username),
      vendorNames: currentSnapshot.vendors.map(v => v.name),
    } : null,
  };
}

export async function sendTestWatcherAlert(): Promise<{ ok: boolean; error?: string }> {
  try {
    const status = getWatcherStatus();
    const snap = status.snapshot;
    await sendAlertEmail({
      subject: '🧪 Sippy Watcher Test Alert — System OK',
      bodyHtml: buildSippyChangeEmail('Test Alert — Change Detection Active', [
        { icon: '✅', label: 'Status', value: 'Watcher is running and configured correctly' },
        { icon: '🕐', label: 'Last Run', value: status.lastRunAt ? new Date(status.lastRunAt).toUTCString() : 'Not yet run' },
        { icon: '👤', label: 'Client Accounts', value: snap ? String(snap.accounts) : 'unknown' },
        { icon: '🏢', label: 'Vendor Accounts', value: snap ? String(snap.vendors) : 'unknown' },
        { icon: '🔌', label: 'Connections', value: snap ? String(snap.connections) : 'unknown' },
        { icon: '🔐', label: 'Auth IP Rules', value: snap ? String(snap.authRules) : 'unknown' },
        { icon: '📅', label: 'Snapshot Taken', value: snap ? snap.capturedAt : 'No snapshot yet' },
        { icon: '🕵️', label: 'Test Sent At', value: new Date().toUTCString() },
      ], 'green', 'This is a test email. If you received it, your Sippy change-detection watcher is working correctly and will alert you on any real changes.'),
      includeWatcherRecipients: true,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function notifyNewClientTraffic(clientName: string): void {
  if (!watcherInitialized) return;
  if (!clientName || clientName === 'Unknown' || clientName === 'Unassigned') return;
  if (knownTrafficClients.has(clientName)) return;
  knownTrafficClients.add(clientName);
  // Fire-and-forget alert
  fireNewTrafficAlert(clientName).catch(e =>
    console.warn('[sippy-watcher] new-traffic alert error:', e.message));
}

async function fireNewTrafficAlert(clientName: string): Promise<void> {
  console.log(`[sippy-watcher] 🆕 New client traffic detected: ${clientName}`);
  storage.recordSippyChangeEvents([{
    category: 'seenClients',
    changeType: 'new_traffic',
    subject: `🆕 New Client Traffic — ${clientName}`,
    clientName,
    vendorName: null,
    oldValue: null,
    newValue: 'First calls observed',
    meta: null,
  }]).catch(e => console.warn('[sippy-watcher] persist new-traffic error:', e.message));
  await sendAlertEmail({
    subject: `🆕 New Client Traffic — ${clientName}`,
    includeWatcherRecipients: true,
    bodyHtml: buildSippyChangeEmail('New Client Traffic Detected', [
      { icon: '🆕', label: 'Client', value: clientName },
      { icon: '📞', label: 'Status', value: 'First calls observed on this account' },
      { icon: '🕐', label: 'Detected At', value: new Date().toUTCString() },
    ], 'cyan', 'This client has started sending traffic for the first time. Verify this is an authorised account.'),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type RowItem = { icon: string; label: string; value: string };

function buildSippyChangeEmail(
  title: string,
  rows: RowItem[],
  color: 'green' | 'red' | 'orange' | 'cyan' | 'yellow',
  note?: string,
): string {
  const colors: Record<string, string> = {
    green: '#4ade80', red: '#f87171', orange: '#fb923c', cyan: '#22d3ee', yellow: '#fbbf24',
  };
  const c = colors[color] ?? '#e0e0e0';
  const rowsHtml = rows.map(r =>
    `<tr>
      <td style="padding:8px;color:#aaa">${r.icon} ${r.label}</td>
      <td style="padding:8px;font-family:monospace;color:${c}">${r.value}</td>
    </tr>`
  ).join('');
  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#0f0f0f;color:#e0e0e0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#1a1a2e;border-radius:12px;overflow:hidden">
    <div style="background:#4f46e5;padding:20px 24px">
      <h1 style="margin:0;font-size:18px;color:#fff">📡 Bitsauto Monitoring — ${title}</h1>
    </div>
    <div style="padding:24px">
      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        ${rowsHtml}
      </table>
      ${note ? `<p style="margin-top:16px;color:#fbbf24;font-size:13px">${note}</p>` : ''}
    </div>
    <div style="padding:12px 24px;background:#111;font-size:12px;color:#666">
      VoIP Monitor &bull; Alert generated at ${new Date().toUTCString()}
    </div>
  </div>
</body>
</html>`;
}

async function getSippyCredentials(): Promise<{
  username: string; password: string; portalUrl: string;
} | null> {
  const settings = await storage.getSippySettings();
  if (!settings) return null;
  const username = settings.apiAdminUsername || settings.portalUsername;
  const password = settings.apiAdminPassword || settings.portalPassword;
  const portalUrl = settings.portalUrl || '';
  if (!username || !password || !portalUrl) return null;
  return { username, password, portalUrl };
}

// Run up to `concurrency` promises at a time
async function pLimit<T>(fns: Array<() => Promise<T>>, concurrency = 4): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;
  async function run(): Promise<void> {
    while (idx < fns.length) {
      const i = idx++;
      results[i] = await fns[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, run));
  return results;
}

// ── State Fetcher ─────────────────────────────────────────────────────────────

async function fetchCurrentState(creds: {
  username: string; password: string; portalUrl: string;
}): Promise<SippyState | null> {
  const { username, password, portalUrl } = creds;
  try {
    // 1. Accounts
    const { accounts: rawAccounts = [], error: aErr } =
      await sippy.listSippyAccounts(username, password, { limit: 500 }, portalUrl);
    if (aErr && rawAccounts.length === 0) {
      console.warn('[sippy-watcher] listSippyAccounts error:', aErr);
    }
    const accounts: AccountEntry[] = rawAccounts.map(a => ({
      iAccount: Number(a.iAccount),
      username: String(a.username || ''),
      name: a.name || a.username || String(a.iAccount),
    }));

    // 2. Vendors — try both credential pairs (portalUsername may be the actual admin)
    let rawVendors: Awaited<ReturnType<typeof sippy.listSippyVendors>>['vendors'] = [];
    {
      const vResult = await sippy.listSippyVendors(username, password, {}, portalUrl);
      if (vResult.vendors.length > 0) {
        rawVendors = vResult.vendors;
      } else {
        // Try the alternate credential pair stored in settings
        const altSettings = await storage.getSippySettings();
        if (altSettings) {
          const altPairs = [
            { u: altSettings.portalUsername, p: altSettings.portalPassword },
            { u: altSettings.apiAdminUsername, p: altSettings.apiAdminPassword },
          ].filter(x => x.u && x.p && x.u !== username);
          for (const { u, p } of altPairs) {
            const altResult = await sippy.listSippyVendors(u!, p!, {}, portalUrl);
            if (altResult.vendors.length > 0) { rawVendors = altResult.vendors; break; }
          }
        }
        if (rawVendors.length === 0 && vResult.error) {
          console.warn('[sippy-watcher] listSippyVendors error:', vResult.error);
        }
      }
    }
    const vendors: VendorEntry[] = rawVendors.map(v => ({
      iVendor: Number(v.iVendor),
      name: String(v.name || `Vendor#${v.iVendor}`),
    }));

    // 3. Vendor connections (in parallel)
    const connections: ConnectionEntry[] = [];
    await pLimit(vendors.map(v => async () => {
      try {
        const { connections: conns = [] } =
          await sippy.listVendorConnections(username, password, v.iVendor, portalUrl);
        for (const c of conns) {
          connections.push({
            iVendor: v.iVendor,
            vendorName: v.name,
            iConnection: c.iConnection ?? 0,
            name: c.name,
            destination: c.destination,
          });
        }
      } catch { /* skip */ }
    }), 4);

    // 4. Auth rules per account (in parallel, batched)
    const authRules: AuthRuleEntry[] = [];
    await pLimit(accounts.map(a => async () => {
      try {
        const { authRules: rules = [] } =
          await sippy.listSippyAuthRules(username, password, { iAccount: a.iAccount }, portalUrl);
        for (const r of rules) {
          authRules.push({
            iAuthentication: r.iAuthentication ?? 0,
            iAccount: a.iAccount,
            accountName: a.name ?? a.username,
            remoteIp: r.remoteIp,
            username: r.username,
          });
        }
      } catch { /* skip — some accounts may have restricted auth listing */ }
    }), 4);

    return {
      capturedAt: new Date().toISOString(),
      accounts,
      vendors,
      connections,
      authRules,
      seenClients: Array.from(knownTrafficClients),
    };
  } catch (e: any) {
    console.error('[sippy-watcher] fetchCurrentState error:', e.message);
    return null;
  }
}

// ── Diff & Alert ──────────────────────────────────────────────────────────────

interface Change {
  type: 'account_added' | 'account_removed'
      | 'vendor_added' | 'vendor_removed'
      | 'connection_added' | 'connection_removed'
      | 'ip_added' | 'ip_removed' | 'ip_changed';
  category: 'accounts' | 'vendors' | 'connections' | 'authRules';
  subject: string;
  bodyHtml: string;
  clientName?: string;
  vendorName?: string;
  oldValue?: string;
  newValue?: string;
  meta?: Record<string, any>;
}

function diffStates(prev: SippyState, curr: SippyState): Change[] {
  const changes: Change[] = [];

  // ── Accounts ──────────────────────────────────────────────────────────────
  const prevAccIds = new Set(prev.accounts.map(a => a.iAccount));
  const currAccIds = new Set(curr.accounts.map(a => a.iAccount));

  for (const a of curr.accounts) {
    if (!prevAccIds.has(a.iAccount)) {
      changes.push({
        type: 'account_added',
        category: 'accounts',
        clientName: a.name || a.username,
        oldValue: null as any, newValue: `iAccount ${a.iAccount} (${a.username})`,
        meta: { iAccount: a.iAccount, username: a.username },
        subject: `🆕 New Client Account — ${a.name || a.username}`,
        bodyHtml: buildSippyChangeEmail('New Client Account Added', [
          { icon: '👤', label: 'Account',  value: a.name || a.username },
          { icon: '🔑', label: 'Username', value: a.username },
          { icon: '🆔', label: 'iAccount', value: String(a.iAccount) },
          { icon: '🕐', label: 'Detected', value: new Date().toUTCString() },
        ], 'green', 'A new client account was created in Sippy. Verify this was intentional.'),
      });
    }
  }

  for (const a of prev.accounts) {
    if (!currAccIds.has(a.iAccount)) {
      changes.push({
        type: 'account_removed',
        category: 'accounts',
        clientName: a.name || a.username,
        oldValue: `iAccount ${a.iAccount} (${a.username})`, newValue: null as any,
        meta: { iAccount: a.iAccount, username: a.username },
        subject: `🗑️ Client Account Removed — ${a.name || a.username}`,
        bodyHtml: buildSippyChangeEmail('Client Account Removed', [
          { icon: '👤', label: 'Account',  value: a.name || a.username },
          { icon: '🔑', label: 'Username', value: a.username },
          { icon: '🆔', label: 'iAccount', value: String(a.iAccount) },
          { icon: '🕐', label: 'Detected', value: new Date().toUTCString() },
        ], 'red', 'A client account was deleted from Sippy. Verify this was an authorised action.'),
      });
    }
  }

  // ── Vendors ───────────────────────────────────────────────────────────────
  const prevVenIds = new Set(prev.vendors.map(v => v.iVendor));
  const currVenIds = new Set(curr.vendors.map(v => v.iVendor));

  for (const v of curr.vendors) {
    if (!prevVenIds.has(v.iVendor)) {
      changes.push({
        type: 'vendor_added',
        category: 'vendors',
        vendorName: v.name,
        oldValue: null as any, newValue: `iVendor ${v.iVendor} (${v.name})`,
        meta: { iVendor: v.iVendor },
        subject: `🆕 New Vendor Added — ${v.name}`,
        bodyHtml: buildSippyChangeEmail('New Vendor Added', [
          { icon: '🏢', label: 'Vendor',  value: v.name },
          { icon: '🆔', label: 'iVendor', value: String(v.iVendor) },
          { icon: '🕐', label: 'Detected', value: new Date().toUTCString() },
        ], 'green', 'A new vendor was added to Sippy. Verify this was an authorised action.'),
      });
    }
  }

  for (const v of prev.vendors) {
    if (!currVenIds.has(v.iVendor)) {
      changes.push({
        type: 'vendor_removed',
        category: 'vendors',
        vendorName: v.name,
        oldValue: `iVendor ${v.iVendor} (${v.name})`, newValue: null as any,
        meta: { iVendor: v.iVendor },
        subject: `🗑️ Vendor Removed — ${v.name}`,
        bodyHtml: buildSippyChangeEmail('Vendor Removed', [
          { icon: '🏢', label: 'Vendor',  value: v.name },
          { icon: '🆔', label: 'iVendor', value: String(v.iVendor) },
          { icon: '🕐', label: 'Detected', value: new Date().toUTCString() },
        ], 'red', 'A vendor was removed from Sippy. Verify this was an authorised action.'),
      });
    }
  }

  // ── Vendor Connections ────────────────────────────────────────────────────
  const prevConnKeys = new Set(prev.connections.map(c => `${c.iVendor}:${c.iConnection}`));
  const currConnKeys = new Set(curr.connections.map(c => `${c.iVendor}:${c.iConnection}`));

  for (const c of curr.connections) {
    const k = `${c.iVendor}:${c.iConnection}`;
    if (!prevConnKeys.has(k)) {
      changes.push({
        type: 'connection_added',
        category: 'connections',
        vendorName: c.vendorName,
        oldValue: null as any, newValue: `${c.name || c.iConnection} → ${c.destination || 'N/A'}`,
        meta: { iVendor: c.iVendor, iConnection: c.iConnection, destination: c.destination },
        subject: `🔌 New Connection — ${c.vendorName} / ${c.name || c.iConnection}`,
        bodyHtml: buildSippyChangeEmail('Vendor Connection Added', [
          { icon: '🏢', label: 'Vendor',      value: c.vendorName },
          { icon: '🔌', label: 'Connection',  value: c.name || String(c.iConnection) },
          { icon: '🌐', label: 'Destination', value: c.destination || 'N/A' },
          { icon: '🕐', label: 'Detected',    value: new Date().toUTCString() },
        ], 'cyan', 'A new connection was added to a vendor. Verify the destination IP and configuration.'),
      });
    }
  }

  for (const c of prev.connections) {
    const k = `${c.iVendor}:${c.iConnection}`;
    if (!currConnKeys.has(k)) {
      changes.push({
        type: 'connection_removed',
        category: 'connections',
        vendorName: c.vendorName,
        oldValue: `${c.name || c.iConnection} → ${c.destination || 'N/A'}`, newValue: null as any,
        meta: { iVendor: c.iVendor, iConnection: c.iConnection, destination: c.destination },
        subject: `🗑️ Connection Removed — ${c.vendorName} / ${c.name || c.iConnection}`,
        bodyHtml: buildSippyChangeEmail('Vendor Connection Removed', [
          { icon: '🏢', label: 'Vendor',      value: c.vendorName },
          { icon: '🔌', label: 'Connection',  value: c.name || String(c.iConnection) },
          { icon: '🌐', label: 'Destination', value: c.destination || 'N/A' },
          { icon: '🕐', label: 'Detected',    value: new Date().toUTCString() },
        ], 'orange', 'A vendor connection was removed from Sippy. This may affect call routing.'),
      });
    }
  }

  // ── Auth Rules (IPs) ──────────────────────────────────────────────────────
  // Key: iAccount + remoteIp (or iAuthentication for username-based rules)
  const authRuleKey = (r: AuthRuleEntry) =>
    r.remoteIp ? `${r.iAccount}:ip:${r.remoteIp}` : `${r.iAccount}:auth:${r.iAuthentication}`;

  const prevAuthMap = new Map(prev.authRules.map(r => [authRuleKey(r), r]));
  const currAuthMap = new Map(curr.authRules.map(r => [authRuleKey(r), r]));

  // Check for IPs changed on same account (same iAuthentication but different IP)
  const prevAuthById = new Map(prev.authRules.map(r => [String(r.iAuthentication), r]));
  const currAuthById = new Map(curr.authRules.map(r => [String(r.iAuthentication), r]));

  for (const [id, currRule] of currAuthById) {
    const prevRule = prevAuthById.get(id);
    if (prevRule && currRule.remoteIp && prevRule.remoteIp &&
        currRule.remoteIp !== prevRule.remoteIp) {
      changes.push({
        type: 'ip_changed',
        category: 'authRules',
        clientName: currRule.accountName,
        oldValue: prevRule.remoteIp, newValue: currRule.remoteIp,
        meta: { iAuthentication: id, iAccount: currRule.iAccount },
        subject: `⚠️ IP Changed — ${currRule.accountName} (${prevRule.remoteIp} → ${currRule.remoteIp})`,
        bodyHtml: buildSippyChangeEmail('Auth IP Address Changed', [
          { icon: '👤', label: 'Account',   value: currRule.accountName },
          { icon: '🔴', label: 'Old IP',    value: prevRule.remoteIp },
          { icon: '🟢', label: 'New IP',    value: currRule.remoteIp },
          { icon: '🆔', label: 'Auth ID',   value: String(id) },
          { icon: '🕐', label: 'Detected',  value: new Date().toUTCString() },
        ], 'orange', '⚠️ An authentication IP was changed. If this was not authorised, disable the rule immediately.'),
      });
    }
  }

  // New auth rules (IPs added)
  for (const [key, r] of currAuthMap) {
    if (!prevAuthMap.has(key)) {
      // Skip if already handled as ip_changed above
      const existing = changes.find(c => c.type === 'ip_changed' &&
        c.subject.includes(r.remoteIp || ''));
      if (existing) continue;
      changes.push({
        type: 'ip_added',
        category: 'authRules',
        clientName: r.accountName,
        oldValue: null as any, newValue: r.remoteIp || r.username || 'N/A',
        meta: { iAuthentication: r.iAuthentication, iAccount: r.iAccount, username: r.username },
        subject: `🔐 IP Added — ${r.accountName} (${r.remoteIp || r.username || 'N/A'})`,
        bodyHtml: buildSippyChangeEmail('Auth IP Added', [
          { icon: '👤', label: 'Account',   value: r.accountName },
          { icon: '🌐', label: 'IP Address', value: r.remoteIp || 'N/A' },
          { icon: '👤', label: 'Username',  value: r.username || 'N/A' },
          { icon: '🆔', label: 'Auth ID',   value: String(r.iAuthentication) },
          { icon: '🕐', label: 'Detected',  value: new Date().toUTCString() },
        ], 'green', 'A new authentication rule (IP) was added. Verify this is an authorised source.'),
      });
    }
  }

  // Removed auth rules (IPs deleted)
  for (const [key, r] of prevAuthMap) {
    if (!currAuthMap.has(key)) {
      const isByChange = changes.some(c => c.type === 'ip_changed' &&
        c.subject.includes(r.remoteIp || ''));
      if (isByChange) continue;
      changes.push({
        type: 'ip_removed',
        category: 'authRules',
        clientName: r.accountName,
        oldValue: r.remoteIp || r.username || 'N/A', newValue: null as any,
        meta: { iAuthentication: r.iAuthentication, iAccount: r.iAccount, username: r.username },
        subject: `🗑️ IP Removed — ${r.accountName} (${r.remoteIp || r.username || 'N/A'})`,
        bodyHtml: buildSippyChangeEmail('Auth IP Removed', [
          { icon: '👤', label: 'Account',   value: r.accountName },
          { icon: '🌐', label: 'IP Address', value: r.remoteIp || 'N/A' },
          { icon: '👤', label: 'Username',  value: r.username || 'N/A' },
          { icon: '🆔', label: 'Auth ID',   value: String(r.iAuthentication) },
          { icon: '🕐', label: 'Detected',  value: new Date().toUTCString() },
        ], 'red', 'An authentication rule (IP) was removed. If this was not authorised, investigate immediately.'),
      });
    }
  }

  return changes;
}

// ── Main Poll Loop ────────────────────────────────────────────────────────────

async function runWatcherCycle(): Promise<void> {
  const creds = await getSippyCredentials();
  if (!creds) return;  // Sippy not configured

  const curr = await fetchCurrentState(creds);
  if (!curr) return;

  // Load known traffic clients from stored state into in-memory set
  // (so server restarts don't re-fire traffic alerts for existing clients)
  if (!watcherInitialized) {
    watcherInitialized = true;
  }

  // Load previous snapshot
  let prev: SippyState | null = null;
  try {
    prev = await storage.getSippySnapshot(SNAPSHOT_KEY) as SippyState | null;
  } catch (e: any) {
    console.warn('[sippy-watcher] could not load snapshot:', e.message);
  }

  // Seed known traffic clients from stored snapshot
  if (prev?.seenClients) {
    for (const c of prev.seenClients) knownTrafficClients.add(c);
  }

  if (!prev) {
    // First run — save baseline, no alerts (avoid false positives)
    console.log('[sippy-watcher] No previous snapshot — saving baseline.');
    currentSnapshot = curr;
    await storage.setSippySnapshot(SNAPSHOT_KEY, curr);
    lastRunAt = new Date();
    lastRunChanges = 0;
    return;
  }

  // Merge current seenClients with whatever the notification hook has already collected
  curr.seenClients = Array.from(knownTrafficClients);

  // Detect diffs
  const changes = diffStates(prev, curr);
  if (changes.length > 0) {
    console.log(`[sippy-watcher] Detected ${changes.length} change(s) — sending alerts.`);
    // Persist to audit trail (fire-and-forget — don't block alerts on DB)
    storage.recordSippyChangeEvents(changes.map(ch => ({
      category:   ch.category,
      changeType: ch.type,
      subject:    ch.subject,
      clientName: ch.clientName ?? null,
      vendorName: ch.vendorName ?? null,
      oldValue:   ch.oldValue ?? null,
      newValue:   ch.newValue ?? null,
      meta:       ch.meta ?? null,
    }))).catch(e => console.warn('[sippy-watcher] persist events error:', e.message));

    for (const ch of changes) {
      console.log(`[sippy-watcher]  • ${ch.subject}`);
      await sendAlertEmail({ subject: ch.subject, bodyHtml: ch.bodyHtml, includeWatcherRecipients: true });
      // WhatsApp: fire for auth IP events (security-critical)
      if (ch.type === 'ip_added' || ch.type === 'ip_removed' || ch.type === 'ip_changed') {
        const m = ch.subject.match(/— (.+?) \(/);
        const accountName = m?.[1] ?? 'Unknown Account';
        const ipM = ch.subject.match(/\(([^)]+)\)/);
        const ipAddress = ipM?.[1];
        const action = ch.type === 'ip_added' ? 'added' : 'deleted';
        sendWhatsAppAlert('auth', formatAuthAlert({ accountName, action, ipAddress })).catch(() => {});
      }
    }
  } else {
    console.log('[sippy-watcher] No Sippy changes detected.');
  }

  // Save updated snapshot and track run stats
  currentSnapshot = curr;
  lastRunAt = new Date();
  lastRunChanges = changes.length;
  await storage.setSippySnapshot(SNAPSHOT_KEY, curr);
}

// ── Initialiser ───────────────────────────────────────────────────────────────

export function initSippyWatcher(): void {
  console.log('[sippy-watcher] Starting Sippy change-detection watcher.');

  // First run after 30 seconds (let server finish startup)
  setTimeout(async () => {
    watcherInitialized = true;
    try {
      lastRunError = null;
      await runWatcherCycle();
    } catch (e: any) {
      lastRunError = e.message;
      console.warn('[sippy-watcher] first cycle error:', e.message);
    }
  }, 30_000);

  // Then every 5 minutes
  setInterval(async () => {
    try {
      lastRunError = null;
      await runWatcherCycle();
    } catch (e: any) {
      lastRunError = e.message;
      console.warn('[sippy-watcher] poll cycle error:', e.message);
    }
  }, POLL_INTERVAL_MS);
}
