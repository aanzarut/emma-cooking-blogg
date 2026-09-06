/* Checks that everything this project needs is in place.
   Run with:  npm run doctor */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LIBRARY_DIR, RECIPES_DIR, INBOX_DIR, pathBudget } from '../studio/lib/paths.js';

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

// Rendering a thumbnail into the real cache folder, because that is where it
// actually broke: on Windows the cache path ran past the 260-character limit
// and every preview in the Inbox failed with nothing to show for it.
const probe = path.join(LIBRARY_DIR, '.cache', 'doctor-probe.jpg');
try {
  const sharp = (await import('sharp')).default;
  const { thumbnail } = await import('../studio/lib/images.js');
  fs.mkdirSync(path.dirname(probe), { recursive: true });
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c2643c' } })
    .jpeg().toFile(probe);
  const out = await thumbnail(probe, 240);
  check('Photo previews work', fs.existsSync(out) && fs.statSync(out).size > 0,
    'thumbnails could not be written');

  // The cache path is not the worst case — a recipe photo sits far deeper.
  const budget = pathBudget();
  check('Folder path is short enough', budget.ok,
    `this folder is ${budget.root} characters deep, and saving a recipe photo would need ` +
    `${budget.deepest} of the ${budget.limit} Windows allows. Move the project to ` +
    'Documents\\emma-cooking-blogg, or double-click Update.bat, which moves it for you',
    `${budget.deepest} of ${budget.limit} characters at its deepest`);
} catch (err) {
  check('Photo previews work', false, err.message);
} finally {
  fs.rmSync(probe, { force: true });
}

for (const dir of [LIBRARY_DIR, RECIPES_DIR, INBOX_DIR]) {
  check(`Folder ${path.relative(ROOT, dir)}`, fs.existsSync(dir), 'created automatically on first run');
}

const envFile = path.join(ROOT, '.env');
const hasEnv = fs.existsSync(envFile);
const hasKey = hasEnv && /^\s*ANTHROPIC_API_KEY\s*=\s*\S/m.test(fs.readFileSync(envFile, 'utf8'));
check('Recipe reading configured', hasKey,
  'optional — copy .env.example to .env and add a key to switch it on');

// The cut-out model behind the photo editor's Background tool. Absent is
// not a fault — it is fetched the first time a background is chosen — so
// this line is informational either way.
try {
  const { modelPath, modelPresent, MODEL } = await import('../studio/lib/cutout.js');
  const present = modelPresent();
  const mb = present ? `${Math.round(fs.statSync(modelPath()).size / 1048576)} MB` : '';
  check('Photo cut-out tool', true, '',
    present ? `${MODEL.file}, ${mb}` : 'not fetched yet — happens the first time a Background is chosen');
} catch (err) {
  check('Photo cut-out tool', false, `could not load it: ${err.message}`);
}

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
