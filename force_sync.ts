import { syncRoutingCache } from './server/routing-cache';

async function main() {
  console.log('Running routing cache sync...');
  const result = await syncRoutingCache(true);
  console.log('Result:', result.ok, result.message);
}
main().catch(e => { console.error(e.message); process.exit(1); });
