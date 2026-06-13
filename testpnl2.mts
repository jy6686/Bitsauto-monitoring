import { db } from './server/db.js';
import { settings } from './shared/schema.js';

async function main() {
  const rows = await db.select().from(settings).limit(1);
  const s = rows[0] as any;
  const portalUrl = s.sippyUrl || s.portalUrl || s.switchUrl;

  // Manually fetch the P&L page to see what Sippy returns
  const base = portalUrl;
  
  // First login
  const loginResp = await fetch(`${base}/index.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: s.portalUsername, password: s.adminWebPassword || s.portalPassword }),
    redirect: 'manual',
  });
  
  const cookies = loginResp.headers.get('set-cookie') || '';
  console.log('Login status:', loginResp.status);
  console.log('Cookies:', cookies.slice(0, 80));

  // Now fetch P&L with output=csv
  const now = new Date();
  const from = new Date(Date.now() - 2 * 60 * 60_000);
  const fmt = (d: Date) => d.toISOString().slice(0,10).replace(/-/g,'-') + ' ' + d.toISOString().slice(11,19);
  
  const params = new URLSearchParams({
    startDate: fmt(from),
    endDate: fmt(now),
    from_form: '1',
    action: 'update',
    cdr_currency: 'USD',
    output: 'csv',
  });

  const resp = await fetch(`${base}/profit_loss_report.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
    },
    body: params.toString(),
  });

  const body = await resp.text();
  console.log('P&L status:', resp.status);
  console.log('Content-Type:', resp.headers.get('content-type'));
  console.log('Body length:', body.length);
  console.log('First 500 chars:', body.slice(0, 500));
  console.log('---');
  console.log('Last 200 chars:', body.slice(-200));
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
