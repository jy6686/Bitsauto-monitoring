import { db } from './server/db.js';
import { settings } from './shared/schema.js';
import * as sippy from './server/sippy.js';

async function main() {
  const rows = await db.select().from(settings).limit(1);
  const s = rows[0] as any;
  console.log('portalUsername:', s.portalUsername);
  console.log('apiAdminUsername:', s.apiAdminUsername);
  const portalUrl = s.sippyUrl || s.portalUrl || s.switchUrl;
  console.log('portalUrl:', portalUrl);

  const fromDate = new Date(Date.now() - 2 * 60 * 60_000);
  const toDate = new Date();

  const report = await sippy.downloadPnlCsv(
    s.portalUsername,
    s.adminWebPassword || s.portalPassword,
    s.apiAdminUsername,
    s.apiAdminPassword,
    fromDate,
    toDate,
    portalUrl
  );

  console.log('ok:', report.ok);
  console.log('error:', report.error || 'none');
  console.log('rows:', report.rows.length);
  report.probe.forEach((p: any) => console.log(' probe:', p.attempt, 'HTTP', p.statusCode, 'bodyLen', p.bodyLen, p.contentType));
  if (report.rows.length > 0) console.log('sample:', JSON.stringify(report.rows[0]));
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
