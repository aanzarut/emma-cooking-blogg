/* Checks that everything this project needs is in place.
   Run with:  npm run doctor */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LIBRARY_DIR, RECIPES_DIR, INBOX_DIR } from '../studio/lib/paths.js';

const results = [];
const check = (label, ok, failDetail = '', okDetail = '') =>
  results.push({ label, ok, detail: ok ? okDetail : failDetail });

const [major] = process.versions.node.split('.').map(Number);
check('Node.js 20 or newer', major >= 20, `found v${process.versions.node}`, `v${process.versions.node}`);
check('Packages installed', fs.existsSync(path.join(ROOT, 'node_modules', 'sharp')),
  'run "npm install" if this fails');

try {
  const sharp = (await import('sharp')).default;
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  check('Photo processing works', true, '');
} catch (err) {
  check('Photo processing works', false, err.message);
}

for (const dir of [LIBRARY_DIR, RECIPES_DIR, INBOX_DIR]) {
  check(`Folder ${path.relative(ROOT, dir)}`, fs.existsSync(dir), 'created automatically on first run');
}

const envFile = path.join(ROOT, '.env');
const hasEnv = fs.existsSync(envFile);
const hasKey = hasEnv && /^\s*ANTHROPIC_API_KEY\s*=\s*\S/m.test(fs.readFileSync(envFile, 'utf8'));
check('Recipe reading configured', hasKey,
  'optional — copy .env.example to .env and add a key to switch it on');

const recipes = fs.existsSync(RECIPES_DIR)
  ? fs.readdirSync(RECIPES_DIR).filter((d) => !d.startsWith('.')).length
  : 0;

console.log('');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'}  ${r.label}${r.detail ? `  — ${r.detail}` : ''}`);
}
console.log(`\n  ${recipes} recipe${recipes === 1 ? '' : 's'} in the library.\n`);

const blocking = results.filter((r) => !r.ok && r.label !== 'Recipe reading configured');
if (blocking.length) {
  console.log('  Something needs fixing before the Studio will run.\n');
  process.exit(1);
}
console.log('  Everything looks fine. Run "npm run studio" to start.\n');
