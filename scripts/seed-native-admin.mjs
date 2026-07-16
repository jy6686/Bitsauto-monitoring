#!/usr/bin/env node
/**
 * seed-native-admin.mjs
 *
 * Creates or updates a native-auth administrator account.
 * Reads the target DB from $DATABASE_URL (or $PROD_DB).
 *
 * Usage:
 *   node scripts/seed-native-admin.mjs \
 *     --email admin@company.com \
 *     --username admin \
 *     --password "YourSecurePassword"
 *
 *   Or omit --password to be prompted (recommended for production):
 *   node scripts/seed-native-admin.mjs \
 *     --email admin@company.com \
 *     --username admin
 */

import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';
import { createInterface } from 'readline';
import { execSync } from 'child_process';

const scryptAsync = promisify(scrypt);

// ── Argument parsing ──────────────────────────────────────────────────────────
function arg(name) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const email    = arg('email');
const username = arg('username');
let   password = arg('password');

if (!email || !username) {
  console.error('Usage: node scripts/seed-native-admin.mjs --email <email> --username <username> [--password <pass>]');
  process.exit(1);
}

// ── Password prompt (if not passed as flag) ───────────────────────────────────
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  password = await new Promise(resolve => {
    rl.question('Password: ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

// ── Hash (same algorithm as nativeAuth.ts) ────────────────────────────────────
const salt = randomBytes(16).toString('hex');
const hash = (await scryptAsync(password, salt, 64)).toString('hex');
const passwordHash = `${salt}:${hash}`;

// ── Build SQL ─────────────────────────────────────────────────────────────────
const sql = `
UPDATE users
   SET username             = '${username.replace(/'/g, "''")}',
       password_hash        = '${passwordHash}',
       platform_access_type = 'full_platform'
 WHERE email = '${email.replace(/'/g, "''")}';
`;

// ── DB connection ─────────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL ?? process.env.PROD_DB;
if (!dbUrl) {
  console.error('Set DATABASE_URL or PROD_DB environment variable.');
  console.error('Or copy and run this SQL manually:');
  console.error(sql);
  process.exit(1);
}

// ── Execute ───────────────────────────────────────────────────────────────────
console.log(`Seeding native admin: ${username} <${email}>`);
try {
  const result = execSync(`psql "${dbUrl}" -c "${sql.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.includes('UPDATE 1')) {
    console.log('✅ Admin account seeded successfully.');
    console.log(`   username: ${username}`);
    console.log(`   email:    ${email}`);
    console.log(`   access:   full_platform`);
  } else if (result.includes('UPDATE 0')) {
    console.error(`❌ No user found with email: ${email}`);
    console.error('   Check the email address and try again.');
    process.exit(1);
  } else {
    console.log(result);
  }
} catch (err) {
  console.error('❌ Database error:', err.stderr ?? err.message);
  process.exit(1);
}
