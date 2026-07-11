#!/usr/bin/env node
// Generates FEATURE-INVENTORY.md and DUPLICATE-ANALYSIS.md from features.json.
// Discovery only — every duplicate decision is "Pending".
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('features.json', 'utf8'));
const feats = d.features;
const today = '2026-07-11';

// ── Business capability layer ────────────────────────────────────────────────
// Capability per feature: curated cluster name where assigned, else nav group.
const CAPABILITY = {
  'Live Calls': 'Live Call Monitoring', 'Live Traffic': 'Live Call Monitoring', 'Traffic Map': 'Live Call Monitoring',
  'NOC Dashboard': 'NOC Operations', 'NOC Command': 'NOC Operations', 'Ops Console': 'NOC Operations',
  'Incident Command': 'Incident Management', 'Alerts': 'Alerting', 'Console': 'Incident Management',
  'Routing Manager': 'Routing Configuration', 'LCR Analyser': 'Routing Analysis',
  'Route Simulator': 'Routing Validation', 'Route Tester': 'Routing Validation',
  'Route Intelligence': 'Routing Recommendations', 'Routing Intelligence': 'Routing Recommendations', 'Route Optimisation': 'Routing Recommendations',
  'Vendor List': 'Carrier Management', 'Carrier Scoring': 'Carrier Performance', 'Carrier Intelligence': 'Carrier Performance',
  'SLA Scorecard': 'Carrier SLA', 'Stability Timeline': 'Carrier Performance', 'Vendor RCA': 'Carrier Diagnostics',
  'Balance Monitor': 'Carrier Finance', 'Prefix Intelligence': 'Prefix Analysis', 'Number Intelligence': 'Number Analysis',
  'Traffic Analytics': 'Traffic Analytics', 'RTP Analytics': 'Media Quality', 'QoS Heatmap': 'Media Quality',
  'Codec Analytics': 'Media Quality', 'ASR / ACD': 'Traffic Analytics', 'Revenue Heatmap': 'Revenue Analytics',
  'BitsEye': 'Unified Analytics', 'BitsEye 2': 'Unified Analytics', 'Graphs': 'Performance Charts', 'Reports': 'Reporting',
  'Margin Intelligence': 'Margin Analytics', 'Cost Optimisation': 'Cost Recommendations', 'AI Assurance': 'Financial Assurance',
  'AI Ops Center': 'AI Decisioning', 'Decision Overlay': 'AI Decisioning', 'Intelligence Hub': 'AI Decisioning',
  'Validation Console': 'AI Validation', 'Simulation Sandbox': 'AI Validation', 'Traffic Steering': 'Traffic Steering',
  'Approval Queue': 'Change Approval', 'Approval Rules': 'Change Approval', 'Audit Log': 'Audit Trail', 'Compliance': 'Compliance',
  'Client Reconciliation': 'Reconciliation', 'Carrier Reconciliation': 'Reconciliation',
  'Tariff Versions': 'Rating Lifecycle', 'Rating Snapshots': 'Rating Lifecycle', 'Rating Verification': 'Rating Lifecycle', 'Rate Cards': 'Commercial Rates',
  'Notifications': 'Notifications', 'Notification Centre': 'Notifications', 'Commercial Notices': 'Notifications',
  'Sender Profiles': 'Notifications', 'WhatsApp Alerts': 'Notifications',
};
const cap = f => CAPABILITY[f.label] || f.group;

// Primary API namespace per feature = most frequent first path segment after /api/.
function namespaces(f) {
  const counts = {};
  for (const a of f.apis ?? []) {
    const seg = a.split('/')[2];
    if (seg) counts[seg] = (counts[seg] || 0) + 1;
  }
  return Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k]) => k);
}
// Candidate canonical owner per namespace = feature with most endpoints under it.
const nsOwner = {};
for (const f of feats) {
  const counts = {};
  for (const a of f.apis ?? []) { const s = a.split('/')[2]; if (s) counts[s] = (counts[s] || 0) + 1; }
  for (const [ns, c] of Object.entries(counts)) {
    if (!nsOwner[ns] || c > nsOwner[ns].count) nsOwner[ns] = { label: f.label, count: c };
  }
}
// Shared-with map: features sharing >=1 endpoint.
function sharedWith(f) {
  const A = new Set(f.apis ?? []);
  return feats
    .filter(g => g !== f && g.apis?.some(x => A.has(x)))
    .map(g => ({ label: g.label, n: g.apis.filter(x => A.has(x)).length }))
    .sort((x, y) => y.n - x.n);
}

// ── API overlap (Jaccard) between all pairs ──────────────────────────────────
function jaccard(a, b) {
  if (!a?.length || !b?.length) return 0;
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / (A.size + B.size - inter);
}
const pairs = [];
for (let i = 0; i < feats.length; i++) {
  for (let j = i + 1; j < feats.length; j++) {
    const a = feats[i], b = feats[j];
    if (a.locked || b.locked) continue;
    const sameFile = a.file && a.file === b.file;
    const sim = jaccard(a.apis, b.apis);
    const sharedApis = a.apis && b.apis ? a.apis.filter(x => b.apis.includes(x)) : [];
    if (sameFile || (sim >= 0.25 && sharedApis.length >= 2)) {
      pairs.push({ a, b, sim: sameFile ? 1 : sim, sharedApis, sameFile });
    }
  }
}
pairs.sort((x, y) => y.sim - x.sim);

// ── FEATURE-INVENTORY.md ─────────────────────────────────────────────────────
let inv = `# Platform Feature Inventory

> **Project:** Platform Feature Rationalization (PFR) — Phase 1 Discovery
> **Generated:** ${today} · extracted programmatically from \`SIDEBAR_GROUPS\` (client/src/components/layout-shell.tsx), routes (client/src/App.tsx), and per-page \`/api/\` usage.
> **Scope:** Documentation only. No feature has been changed, hidden, or deactivated.
>
> **Registry facts:** ${feats.length} registered features · ${feats.filter(f => !f.locked).length} configurable in Navigation Manager · ${feats.filter(f => f.locked).length} always-visible (locked).

## Status legend

| Status | Meaning |
|---|---|
| Registered | Route + page component exist; runtime verification pending |
| Planned | Marked \`status: 'planned'\` in the registry (SOON badge) |
| No backend calls | Page makes zero \`/api/\` calls — possible placeholder |

## Master index

| ID | Feature | Group | Path | Page component | Page size (LOC) | Backend APIs (count) | Flags |
|---|---|---|---|---|---|---|---|
`;
for (const f of feats) {
  const flags = [
    f.locked && 'LOCKED',
    f.isNew && 'NEW',
    f.status === 'planned' && 'PLANNED',
    f.status === 'live' && 'LIVE',
    f.file && (!f.apis || !f.apis.length) && 'PLACEHOLDER-CANDIDATE',
  ].filter(Boolean).join(', ');
  inv += `| ${f.id} | ${f.label} | ${cap(f)} | \`${f.href}\` | \`${f.file?.replace('client/src/pages/', '') ?? '—'}\` | ${f.fileLines} | ${f.apis?.length ?? 0} | ${flags} |\n`;
}

inv += `\n## Per-feature detail\n`;
for (const f of feats) {
  inv += `\n### ${f.id} — ${f.label}\n\n`;
  inv += `- **Group:** ${f.group} (\`${f.groupKey}\`)\n`;
  inv += `- **Path:** \`${f.href}\`${f.locked ? ' · **always visible (locked)**' : ''}\n`;
  inv += `- **Page:** \`${f.file}\` (${f.fileLines} LOC)\n`;
  inv += `- **Roles:** ${f.roles.join(', ') || '—'}\n`;
  if (f.status) inv += `- **Registry status:** ${f.status}\n`;
  if (f.isNew) inv += `- **Badge:** NEW\n`;
  const apis = f.apis ?? [];
  const ns = namespaces(f);
  const primaryNs = ns[0];
  const owner = primaryNs ? nsOwner[primaryNs]?.label : null;
  const sw = sharedWith(f);
  inv += `- **Business capability:** ${cap(f)}\n`;
  inv += `- **System of record (primary API namespace):** ${primaryNs ? `\`/api/${primaryNs}\`` : '—'} _(DB-table mapping pending server-side verification)_\n`;
  inv += `- **Canonical owner (heuristic):** ${owner ? (owner === f.label ? `**this feature** — largest consumer of \`/api/${primaryNs}\`` : `${owner} (this feature is a consumer)`) : 'n/a'}\n`;
  inv += `- **Backend APIs (${apis.length}):** ${apis.length ? apis.map(a => `\`${a}\``).join(', ') : '_none detected — Placeholder Candidate, verify (may be client-side only)_'}\n`;
  inv += `- **Write operations:** ${f.writes?.length ? f.writes.map(w => `\`${w}\``).join(', ') : 'none detected (read-only view)'}\n`;
  inv += `- **Shares endpoints with:** ${sw.length ? sw.slice(0, 6).map(s => `${s.label} (${s.n})`).join(', ') + (sw.length > 6 ? `, +${sw.length - 6} more` : '') : 'none'}\n`;
  inv += `- **Business purpose:** _to be verified during runtime audit_\n`;
  inv += `- **Production tested:** Pending\n`;
  inv += `- **Decision:** — (inventory only)\n`;
}
fs.writeFileSync(process.argv[2], inv);

// ── DUPLICATE-ANALYSIS.md ────────────────────────────────────────────────────
let dup = `# Platform Duplicate Analysis Register

> **Project:** Platform Feature Rationalization (PFR) — Phase 1 Discovery
> **Generated:** ${today} · derived from shared page components and backend-API overlap (Jaccard similarity of \`/api/\` endpoint sets per page).
>
> **Every entry is a _candidate_, not a confirmed duplicate. Every Decision is Pending. Nothing will be merged, hidden, or deactivated until reviewed and approved.**

## Classification key

| Class | Meaning | Default action |
|---|---|---|
| A — True duplicate | Same screens, backend, workflow | Candidate for merge (after approval) |
| B — Partial duplicate | 60–90% overlap | Needs comparison/redesign |
| C — Shared data, different purpose | Same tables/APIs, different business process | Keep both |
| D — Workflow dependency | One creates records, another reviews them | Never merge |
| E — Unknown | Needs engineering review | Investigate |

## Confidence levels

| Confidence | Meaning |
|---|---|
| High | Likely duplicate — same component or majority backend overlap |
| Medium | Needs workflow review — significant shared data |
| Low | Probably different purposes — minor overlap |
| Informational | Shared backend only — likely different presentations of the same data |

> **Caution:** a shared API is _evidence, not proof_. Two features can be different presentations of the same operational data. The "Shared workflow" column tracks whether both surfaces also perform the same **write actions**; only then does overlap suggest a true duplicate.

## Machine-detected overlap (API/component evidence)

| DUP ID | Feature A | Feature B | Evidence | API overlap | Shared APIs | Shared workflow (writes) | Confidence | Duplicate? | Decision |
|---|---|---|---|---|---|---|---|---|---|
`;
let n = 0;
for (const p of pairs) {
  const ev = p.sameFile
    ? 'Same page component'
    : `${p.sharedApis.length} shared endpoint(s)`;
  const wA = new Set(p.a.writes ?? []), wB = new Set(p.b.writes ?? []);
  const sharedWrites = [...wA].filter(x => wB.has(x));
  const wf = p.sameFile ? 'YES (same page)' : sharedWrites.length ? `YES (${sharedWrites.length} shared write op)` : 'NO — reads only';
  const conf = p.sameFile ? 'High' : p.sim >= 0.6 ? 'High' : p.sim >= 0.4 ? 'Medium' : sharedWrites.length ? 'Medium' : 'Informational';
  dup += `| DUP-${String(++n).padStart(3, '0')} | ${p.a.label} (\`${p.a.href}\`) | ${p.b.label} (\`${p.b.href}\`) | ${ev} | ${(p.sim * 100).toFixed(0)}% | YES | ${wf} | **${conf}** | Unknown | **Pending** |\n`;
}
dup += `\n### Shared-endpoint detail\n`;
n = 0;
for (const p of pairs) {
  n++;
  if (!p.sharedApis.length && !p.sameFile) continue;
  dup += `\n**DUP-${String(n).padStart(3, '0')} — ${p.a.label} ↔ ${p.b.label}**\n`;
  if (p.sameFile) dup += `- Both routes render \`${p.a.file}\`\n`;
  if (p.sharedApis.length) dup += p.sharedApis.map(a => `- \`${a}\`\n`).join('');
}
// ── Curated capability clusters (from PFR discovery plan) ────────────────────
const clusters = [
  { name: 'Live Operations', members: ['Live Calls', 'Live Traffic', 'Traffic Map', 'NOC Dashboard', 'NOC Command', 'Ops Console', 'Console', 'Incident Command'],
    q: 'Which surface is the canonical NOC view? NOC Command ↔ Ops Console already show 70% API overlap.' },
  { name: 'Routing', members: ['Routing Manager', 'Route Intelligence', 'Routing Intelligence', 'Route Simulator', 'Route Tester', 'Route Optimisation', 'LCR Analyser'],
    q: 'Manager = configuration, Tester/Simulator = validation, Intelligence/Optimisation = recommendations — confirm each owns a distinct step of that lifecycle.' },
  { name: 'Carrier / Vendor health', members: ['Vendor List', 'Carrier Scoring', 'Carrier Intelligence', 'SLA Scorecard', 'Stability Timeline', 'Vendor RCA'],
    q: 'Registry comment in app-nav-shell.tsx says Stability Timeline was removed with "canonical home is BitsEye", yet it is still registered in SIDEBAR_GROUPS.' },
  { name: 'Prefix / Number', members: ['Prefix Intelligence', 'Number Intelligence'],
    q: 'Vendor-prefix vs number-level analysis — confirm distinct data domains.' },
  { name: 'Analytics', members: ['Traffic Analytics', 'RTP Analytics', 'ASR / ACD', 'QoS Heatmap', 'Codec Analytics', 'Revenue Heatmap', 'BitsEye', 'BitsEye 2', 'Graphs', 'Reports'],
    q: 'BitsEye vs BitsEye 2 dual registration needs an owner decision; each analytics page should own one metric family.' },
  { name: 'Margin / Cost', members: ['Margin Intelligence', 'Cost Optimisation', 'AI Assurance'],
    q: 'Margin reporting vs cost recommendation vs assurance — verify boundaries.' },
  { name: 'AI / Decisioning', members: ['AI Ops Center', 'Decision Overlay', 'Intelligence Hub', 'Validation Console', 'Simulation Sandbox', 'Traffic Steering'],
    q: 'Decision Overlay is the same page as AI Ops Center (tab deep-link) — a nav alias, not a separate feature.' },
  { name: 'Approvals & audit', members: ['Approval Queue', 'Approval Rules', 'Audit Log', 'Compliance'],
    q: 'Likely class D (workflow dependency) — queue executes, rules configure, log records. Never merge without workflow review.' },
  { name: 'Reconciliation', members: ['Client Reconciliation', 'Carrier Reconciliation'],
    q: 'Mirror-image workflows sharing 3 endpoints — confirm they stay separate or share one engine.' },
  { name: 'Rating / Tariff', members: ['Tariff Versions', 'Rating Snapshots', 'Rating Verification', 'Rate Cards'],
    q: 'Version control vs snapshot vs verification vs commercial cards — verify lifecycle boundaries.' },
  { name: 'Notifications', members: ['Notifications', 'Notification Centre', 'Commercial Notices', 'Sender Profiles', 'WhatsApp Alerts', 'Console'],
    q: 'Console ↔ Notification Centre share 50% of endpoints; multiple notification surfaces need one ownership map.' },
];
const byLabel = Object.fromEntries(feats.map(f => [f.label, f]));
dup += `\n## Capability-cluster review candidates (curated)\n\nThese are the business-capability groupings agreed in the PFR plan. They are **comparison candidates, not confirmed duplicates** — several will resolve to class C or D (keep both).\n`;
let c = 0;
for (const cl of clusters) {
  dup += `\n### CLUSTER-${String(++c).padStart(2, '0')} — ${cl.name}\n\n`;
  dup += `| Feature | Path | Page | APIs |\n|---|---|---|---|\n`;
  for (const m of cl.members) {
    const f = byLabel[m];
    if (!f) { dup += `| ${m} | _not found in registry_ | — | — |\n`; continue; }
    dup += `| ${f.label} | \`${f.href}\` | \`${f.file?.replace('client/src/pages/', '')}\` | ${f.apis?.length ?? 0} |\n`;
  }
  dup += `\n**Review question:** ${cl.q}\n\n**Decision:** Pending\n`;
}
dup += `\n## Governance\n\nSequence: Inventory → purpose verification → overlap analysis → joint review → approval → merge/retirement plan → regression testing → production validation → only then deactivate/archive.\n\nNo feature will be hidden, merged, archived, or removed before explicit approval of the corresponding DUP/CLUSTER entry.\n`;
fs.writeFileSync(process.argv[3], dup);

// ── DEPENDENCY-MATRIX.md ─────────────────────────────────────────────────────
let dep = `# Platform Dependency Matrix

> **Project:** Platform Feature Rationalization (PFR) — Phase 1 Discovery
> **Generated:** ${today} · dependency = the \`/api/\` namespaces a feature's page calls; "shared with" = other features calling at least one identical endpoint (count in parentheses).
>
> Use this before planning any merge: it shows the blast radius of changing or retiring a feature. Data-level only — cross-page component imports are not yet mapped.

## Namespace ownership (heuristic)

Candidate canonical owner = the feature whose page consumes the most endpoints under a namespace. **Heuristic, pending verification** — the owner of the data is not necessarily the page with the most calls.

| API namespace | Candidate owner | Consumers |
|---|---|---|
`;
const nsConsumers = {};
for (const f of feats) for (const ns of new Set((f.apis ?? []).map(a => a.split('/')[2]).filter(Boolean))) {
  (nsConsumers[ns] = nsConsumers[ns] || []).push(f.label);
}
for (const [ns, consumers] of Object.entries(nsConsumers).sort((a, b) => b[1].length - a[1].length)) {
  if (consumers.length < 2) continue; // single-consumer namespaces are not shared dependencies
  dep += `| \`/api/${ns}\` | ${nsOwner[ns].label} | ${consumers.filter(c => c !== nsOwner[ns].label).join(', ')} |\n`;
}
dep += `\n## Per-feature dependencies\n\n| Feature | Capability | Depends on (namespaces) | Writes | Shared with (top) |\n|---|---|---|---|---|\n`;
for (const f of feats) {
  const ns = namespaces(f);
  const sw = sharedWith(f);
  dep += `| ${f.label} | ${cap(f)} | ${ns.slice(0, 5).map(x => `\`${x}\``).join(', ') || '—'}${ns.length > 5 ? ` +${ns.length - 5}` : ''} | ${f.writes?.length ?? 0} | ${sw.slice(0, 4).map(s => `${s.label} (${s.n})`).join(', ') || '—'} |\n`;
}
fs.writeFileSync(process.argv[4], dep);
console.log(`inventory features=${feats.length}, dup pairs=${pairs.length}, clusters=${clusters.length}, shared namespaces=${Object.values(nsConsumers).filter(c => c.length > 1).length}`);
