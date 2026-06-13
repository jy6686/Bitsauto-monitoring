import { db } from './server/db.js';
import { settings } from './shared/schema.js';
import * as sippy from './server/sippy.js';

async function main() {
  const rows = await db.select().from(settings).limit(1);
  const s = rows[0] as any;
  const portalUrl = s.sippyUrl || s.portalUrl || s.switchUrl;

  // Use sippy's internal rawRequest which handles SSL correctly
  // Access it via the module internals
  const now = new Date();
  const from = new Date(Date.now() - 2 * 60 * 60_000);
  
  // Format date same way sippy does
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  console.log('Date range:', fmt(from), 'to', fmt(now));
  
  // Test with the actual XML-RPC CDR method instead
  // This is what the CDR cache uses and we know it works
  const creds = { username: s.apiAdminUsername, password: s.apiAdminPassword };
  console.log('Testing XML-RPC getCDRs...');
  
  try {
    const cdrs = await sippy.getSippyCDRs(
      portalUrl,
      creds.username,
      creds.password,
      from,
      now,
      100
    );
    console.log('XML-RPC CDRs returned:', cdrs.length);
    if (cdrs.length > 0) {
      const c = cdrs[0];
      console.log('Sample CDR fields:', Object.keys(c));
      console.log('Sample CDR cost:', (c as any).cost);
      console.log('Sample CDR vendorCost:', (c as any).vendorCost ?? (c as any).vendor_cost ?? 'MISSING');
      console.log('Full sample:', JSON.stringify(c).slice(0, 400));
    }
  } catch(e: any) {
    console.log('XML-RPC error:', e.message);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
