#!/usr/bin/env node
// Platform Feature Audit — Phase 1 discovery extractor (read-only).
// Parses SIDEBAR_GROUPS (the Navigation Manager registry), maps each feature
// to its route component in App.tsx, and greps each page for /api/ endpoints.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/mac/Projects/Bitsauto-monitoring';
const shell = fs.readFileSync(path.join(ROOT, 'client/src/components/layout-shell.tsx'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'client/src/App.tsx'), 'utf8');

// ── 1. Parse SIDEBAR_GROUPS ──────────────────────────────────────────────────
const startIdx = shell.indexOf('export const SIDEBAR_GROUPS');
const endIdx = shell.indexOf('\n];', startIdx);
const block = shell.slice(startIdx, endIdx);

const groups = [];
let current = null;
for (const line of block.split('\n')) {
  const keyM = line.match(/^\s*key:\s*'([^']+)'/);
  if (keyM) { current = { key: keyM[1], label: '', items: [] }; groups.push(current); continue; }
  const labelM = line.match(/^\s*label:\s*'([^']+)'/);
  if (labelM && current && !current.label) { current.label = labelM[1]; continue; }
  const itemM = line.match(/\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"/);
  if (itemM && current) {
    const roles = (line.match(/roles:\s*\[([^\]]*)\]/) || [,''])[1]
      .split(',').map(r => r.trim().replace(/'/g, '')).filter(Boolean);
    current.items.push({
      href: itemM[1],
      label: itemM[2],
      roles,
      isNew: /isNew:\s*true/.test(line),
      status: (line.match(/status:\s*'([^']+)'/) || [,''])[1],
      submenu: (line.match(/hasSubmenu:\s*'([^']+)'/) || [,''])[1],
    });
  }
}

// ── 2. Parse App.tsx routes + lazy imports ───────────────────────────────────
const importMap = {}; // ComponentName -> file path
for (const m of app.matchAll(/(?:const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\("([^"]+)"\)\)|import\s+(\w+)\s+from\s+"([^"]+)")/g)) {
  const name = m[1] || m[3];
  const p = m[2] || m[4];
  if (p && p.startsWith('@/pages/')) importMap[name] = p.replace('@/', 'client/src/') ;
}
const wrapperMap = {}; // WrapperName -> real component name
for (const m of app.matchAll(/const\s+(\w+)\s*=\s*withWorkspace\('[^']*',\s*(\w+)\)/g)) {
  wrapperMap[m[1]] = m[2];
}
const routeMap = {}; // path -> component name
// <Route path="/x"> {() => <ProtectedRoute component={Y} ... />} </Route>
for (const m of app.matchAll(/<Route\s+path="([^"]+)"(?:\s+component=\{(\w+)\})?\s*>?\s*(?:\{\(\)\s*=>\s*<ProtectedRoute\s+component=\{(\w+)\})?/g)) {
  const comp = m[2] || m[3];
  if (comp && !(m[1] in routeMap)) routeMap[m[1]] = comp;
}

// ── 3. API endpoints per page file ───────────────────────────────────────────
function apisFor(fileRel) {
  const abs = path.join(ROOT, fileRel + (fileRel.endsWith('.tsx') ? '' : '.tsx'));
  let src = '';
  try { src = fs.readFileSync(abs, 'utf8'); } catch {
    try { src = fs.readFileSync(abs.replace(/\.tsx$/, '.ts'), 'utf8'); } catch { return { apis: null, lines: 0 }; }
  }
  const apis = [...new Set([...src.matchAll(/['"`](\/api\/[a-zA-Z0-9\-_/]+)/g)].map(m => m[1]))].sort();
  // Write operations signal a workflow surface (actions), not just a data view.
  const writes = [...src.matchAll(/apiRequest\(\s*['"](POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`](\/api\/[a-zA-Z0-9\-_/]+)/g)]
    .map(m => `${m[1]} ${m[2]}`);
  const mutations = (src.match(/useMutation/g) || []).length;
  return { apis, writes: [...new Set(writes)].sort(), mutations, lines: src.split('\n').length };
}

// ── 4. Assemble ──────────────────────────────────────────────────────────────
const ALWAYS = new Set(['/', '/chat', '/account', '/navigation-manager']);
let id = 0;
const features = [];
for (const g of groups) {
  for (const it of g.items) {
    const basePath = it.href.split('?')[0];
    let comp = routeMap[basePath];
    if (comp && wrapperMap[comp]) comp = wrapperMap[comp];
    const file = comp ? importMap[comp] : undefined;
    const { apis, writes = [], mutations = 0, lines } = file ? apisFor(file) : { apis: null, lines: 0 };
    features.push({
      id: `PF-${String(++id).padStart(3, '0')}`,
      group: g.label,
      groupKey: g.key,
      label: it.label,
      href: it.href,
      locked: ALWAYS.has(it.href),
      isNew: it.isNew,
      status: it.status || '',
      roles: it.roles,
      component: comp || null,
      file: file || null,
      fileLines: lines,
      apis,
      writes,
      mutations,
    });
  }
}

fs.writeFileSync(process.argv[2] || 'features.json', JSON.stringify({ groups: groups.map(g => ({ key: g.key, label: g.label, count: g.items.length })), features }, null, 2));
console.log(`groups=${groups.length} features=${features.length} configurable=${features.filter(f => !f.locked).length}`);
console.log(`unrouted=${features.filter(f => !f.component).map(f => f.href).join(', ') || 'none'}`);
