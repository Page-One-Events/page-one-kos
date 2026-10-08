#!/usr/bin/env node
// One-shot setup & deploy for Franklin Kos Trip!
//   npm run setup
// Safe to run again for every new release: it reuses the existing database,
// re-applies the (idempotent) schema, deploys, and refreshes the password secret.

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const DB_NAME = 'franklin-kos-trip';
const CONFIG = 'wrangler.jsonc';
const wrangler = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function step(msg) {
  console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
}

function run(args, { capture = false, input } = {}) {
  const res = spawnSync(wrangler, ['wrangler', ...args], {
    stdio: [input !== undefined ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', 'inherit'],
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`\nwrangler ${args.join(' ')} failed.`);
    process.exit(res.status ?? 1);
  }
  return res.stdout || '';
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))));
}

function readPassword() {
  if (process.env.SITE_PASSWORD) return process.env.SITE_PASSWORD;
  try {
    const vars = fs.readFileSync('.dev.vars', 'utf8');
    const m = vars.match(/^PASSWORD\s*=\s*"?(.*?)"?\s*$/m);
    if (m && m[1]) return m[1];
  } catch {}
  return null;
}

// 1. Dependencies
if (!fs.existsSync('node_modules/wrangler')) {
  step('Installing dependencies');
  execSync('npm install', { stdio: 'inherit' });
}

// 2. Cloudflare login
step('Checking Cloudflare login');
const who = spawnSync(wrangler, ['wrangler', 'whoami'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (who.status !== 0 || /not authenticated/i.test(`${who.stdout}${who.stderr}`)) {
  run(['login']);
} else {
  console.log('Already logged in.');
}

// 3. Database
step(`Finding D1 database "${DB_NAME}"`);
const findDb = () => {
  const out = run(['d1', 'list', '--json'], { capture: true });
  const list = JSON.parse(out.slice(out.indexOf('[')));
  return list.find((d) => d.name === DB_NAME);
};
let db = findDb();
if (!db) {
  step(`Creating D1 database "${DB_NAME}"`);
  run(['d1', 'create', DB_NAME]);
  db = findDb();
}
if (!db) {
  console.error('Could not find or create the database.');
  process.exit(1);
}
const dbId = db.uuid || db.id || db.database_id;
console.log(`Database id: ${dbId}`);

const config = fs.readFileSync(CONFIG, 'utf8');
const updated = config.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${dbId}$2`);
if (updated !== config) fs.writeFileSync(CONFIG, updated);

// 4. Schema (idempotent)
step('Applying database schema');
run(['d1', 'execute', DB_NAME, '--remote', '--file=schema.sql']);

// 5. Deploy
step('Deploying to holiday.page-one.events');
run(['deploy']);

// 6. Password
step('Setting the site password');
let password = readPassword();
if (!password) password = await ask('Site password: ');
if (!password) {
  console.error('No password given — the site will refuse every login until PASSWORD is set.');
  process.exit(1);
}
run(['secret', 'put', 'PASSWORD'], { input: `${password}\n` });

console.log('\n\x1b[1m✓ Done — https://holiday.page-one.events\x1b[0m');
console.log('  (A brand-new custom domain can take a minute or two to start answering.)\n');
