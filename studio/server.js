import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

import {
  ROOT, CONFIG_DIR, LIBRARY_DIR, INBOX_DIR, RECIPES_DIR, DIST_DIR,
  STUDIO_PUBLIC, ensureLibrary, ensureDir, safeJoin, recipePaths,
} from './lib/paths.js';
import { createRouter, sendJson, sendFile, sendText, readJsonBody } from './lib/http.js';
import * as store from './lib/recipes.js';
import * as images from './lib/images.js';
import * as inbox from './lib/inbox.js';
import * as ai from './lib/transcribe.js';
import { checkForUpdate } from '../scripts/update.js';

const PORT = Number(process.env.PORT || 4321);
const PREVIEW_PORT = PORT + 1;

loadEnvFile();
ensureLibrary();

const router = createRouter();

/* ------------------------------------------------------------------ setup */

/** Read a plain KEY=value .env file, if the user made one. */
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function taxonomy() {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'taxonomy.json'), 'utf8'));
}

/** The address the phones should open. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return `http://${net.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}

const fail = (res, err, status = 400) =>
  sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });

/* ------------------------------------------------------------ bootstrap */

router.get('/api/bootstrap', async (_req, res) => {
  const recipes = store.listRecipes();
  sendJson(res, 200, {
    taxonomy: taxonomy(),
    facets: store.facets(recipes),
    counts: {
      total: recipes.length,
      inbox: inbox.listInbox().length,
      byStatus: store.STATUSES.reduce((acc, s) => {
        acc[s] = recipes.filter((r) => r.status === s).length;
        return acc;
      }, {}),
    },
    ai: { available: ai.isAvailable(), model: ai.DEFAULT_MODEL },
    update: updateStatus,
    uploadUrl: `${lanAddress()}/upload`,
    previewUrl: `http://localhost:${PREVIEW_PORT}/`,
    statuses: store.STATUSES,
    siteBuilt: fs.existsSync(path.join(DIST_DIR, 'index.html')),
  });
});

router.get('/api/qr', async (_req, res) => {
  const { default: QRCode } = await import('qrcode');
  const svg = await QRCode.toString(`${lanAddress()}/upload`, {
    type: 'svg', margin: 1, width: 260, color: { dark: '#1d2733', light: '#ffffff' },
  });
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
  res.end(svg);
});

/* --------------------------------------------------------------- recipes */

function summarize(r) {
  return {
    slug: r.slug,
    title: r.title,
    status: r.status,
    summary: r.summary,
    author: r.source?.author || '',
    foodTypes: r.foodTypes,
    cuisines: r.cuisines,
    tags: r.tags,
    ingredientCount: r.ingredients.length,
    stepCount: r.steps.length,
    hasCommentary: Boolean(r.commentary?.trim()),
    photoCount: countFiles(recipePaths(r.slug).originals),
    scanCount: countFiles(recipePaths(r.slug).scans),
    heroImage: r.heroImage,
    heroSrc: heroSrc(r),
    updatedAt: r.updatedAt,
  };
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && images.isRenderable(f)).length;
}

function heroSrc(r) {
  const p = recipePaths(r.slug);
  const pick = r.heroImage || firstFile(p.edited) || firstFile(p.originals) || firstFile(p.scans);
  if (!pick) return '';
  for (const [dir, rel] of [
    [p.edited, `recipes/${r.slug}/images/edited`],
    [p.originals, `recipes/${r.slug}/images/original`],
    [p.scans, `recipes/${r.slug}/scans`],
  ]) {
    if (fs.existsSync(path.join(dir, pick))) {
      return `/files/${rel}/${encodeURIComponent(pick)}?w=480`;
    }
  }
  return '';
}

function firstFile(dir) {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && images.isRenderable(f)).sort()[0] || '';
}

router.get('/api/recipes', async (_req, res) => {
  sendJson(res, 200, { recipes: store.listRecipes().map(summarize) });
});

router.post('/api/recipes', async (req, res) => {
  try {
    const body = await readJsonBody(req);
    const recipe = store.createRecipe({ title: (body.title || '').trim() || 'Untitled recipe' });
    sendJson(res, 201, { recipe });
  } catch (err) { fail(res, err); }
});

router.get('/api/recipes/:slug', async (_req, res, { params }) => {
  const recipe = store.readRecipe(params.slug);
  if (!recipe) return fail(res, 'That recipe no longer exists.', 404);
  sendJson(res, 200, { recipe, photos: photoList(params.slug) });
});

router.put('/api/recipes/:slug', async (req, res, { params }) => {
  try {
    const existing = store.readRecipe(params.slug);
    if (!existing) return fail(res, 'That recipe no longer exists.', 404);
    const body = await readJsonBody(req);
    const incoming = body.recipe || {};

    let slug = params.slug;
    const titleChanged =
      incoming.title && incoming.title.trim() && incoming.title.trim() !== existing.title;
    const merged = { ...existing, ...incoming, slug };
    store.writeRecipe(merged);
    if (titleChanged && body.renameFolder !== false) {
      slug = store.renameRecipe(params.slug, incoming.title.trim());
    }
    sendJson(res, 200, { recipe: store.readRecipe(slug), photos: photoList(slug), slug });
  } catch (err) { fail(res, err); }
});

router.delete('/api/recipes/:slug', async (_req, res, { params }) => {
  try {
    store.trashRecipe(params.slug);
    sendJson(res, 200, { ok: true });
  } catch (err) { fail(res, err); }
});

router.post('/api/recipes/:slug/transcribe', async (req, res, { params }) => {
  try {
    const recipe = store.readRecipe(params.slug);
    if (!recipe) return fail(res, 'That recipe no longer exists.', 404);
    const body = await readJsonBody(req).catch(() => ({}));

    const p = recipePaths(params.slug);
    const scans = fs.existsSync(p.scans)
      ? fs.readdirSync(p.scans).filter((f) => !f.startsWith('.') && images.isRenderable(f)).sort()
      : [];
    if (!scans.length) {
      return fail(res, 'Add a photo of the recipe card first, then press Read again.');
    }
    const files = scans.map((f) => path.join(p.scans, f));
    const { fields, usage } = await ai.transcribeFiles(files);
    const updated = body.overwrite
      ? ai.applyTranscription({ ...recipe, ingredients: [], steps: [], notes: '' }, fields)
      : ai.applyTranscription(recipe, fields);
    updated.transcription.model = ai.DEFAULT_MODEL;
    store.writeRecipe(updated);
    sendJson(res, 200, { recipe: store.readRecipe(params.slug), fields, usage });
  } catch (err) { fail(res, err, 500); }
});

/* ---------------------------------------------------------------- photos */

function loadEdits(slug) {
  const file = recipePaths(slug).edits;
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveEdits(slug, edits) {
  fs.writeFileSync(recipePaths(slug).edits, JSON.stringify(edits, null, 2), 'utf8');
}

function photoList(slug) {
  const p = recipePaths(slug);
  const edits = loadEdits(slug);
  const collect = (dir, role, urlBase) => {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => !f.startsWith('.') && images.isRenderable(f))
      .sort()
      .map((name) => {
        const editedPath = path.join(p.edited, name);
        const hasEdited = role === 'photo' && fs.existsSync(editedPath);
        return {
          name,
          role,
          kind: images.kindOf(name),
          edit: edits[name] || null,
          hasEdited,
          src: `/files/${urlBase}/${encodeURIComponent(name)}`,
          thumb: `/files/${urlBase}/${encodeURIComponent(name)}?w=420`,
          editedSrc: hasEdited
            ? `/files/recipes/${slug}/images/edited/${encodeURIComponent(name)}?v=${fs.statSync(editedPath).mtimeMs}`
            : '',
        };
      });
  };
  return [
    ...collect(p.originals, 'photo', `recipes/${slug}/images/original`),
    ...collect(p.scans, 'scan', `recipes/${slug}/scans`),
  ];
}

router.get('/api/recipes/:slug/photos', async (_req, res, { params }) => {
  sendJson(res, 200, { photos: photoList(params.slug) });
});

router.post('/api/recipes/:slug/photos/:name/edit', async (req, res, { params }) => {
  try {
    const p = recipePaths(params.slug);
    const source = safeJoin(p.originals, params.name);
    if (!fs.existsSync(source)) return fail(res, 'That photo is missing.', 404);

    const body = await readJsonBody(req);
    const edit = images.mergeEdit(body.edit || {});
    const edits = loadEdits(params.slug);

    if (images.isIdentityEdit(edit)) {
      delete edits[params.name];
      fs.rmSync(path.join(p.edited, params.name), { force: true });
    } else {
      edits[params.name] = edit;
      await images.renderEditToFile(source, edit, path.join(p.edited, params.name), { quality: 92 });
    }
    saveEdits(params.slug, edits);
    sendJson(res, 200, { photos: photoList(params.slug) });
  } catch (err) { fail(res, err, 500); }
});

router.get('/api/recipes/:slug/photos/:name/geometry', async (_req, res, { params, query }) => {
  try {
    const source = safeJoin(recipePaths(params.slug).originals, params.name);
    if (!fs.existsSync(source)) return sendText(res, 404, 'Not found');
    let edit = {};
    try { edit = JSON.parse(query.get('edit') || '{}'); } catch { edit = {}; }
    const buffer = await images.renderGeometry(source, edit);
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': buffer.length,
      'cache-control': 'no-store',
    });
    res.end(buffer);
  } catch (err) { sendText(res, 500, err.message); }
});

router.delete('/api/recipes/:slug/photos/:name', async (_req, res, { params }) => {
  try {
    const p = recipePaths(params.slug);
    let removed = false;
    for (const dir of [p.originals, p.scans, p.edited]) {
      const target = path.join(dir, params.name);
      if (fs.existsSync(target)) { fs.rmSync(target); removed = true; }
    }
    const edits = loadEdits(params.slug);
    delete edits[params.name];
    saveEdits(params.slug, edits);

    const recipe = store.readRecipe(params.slug);
    if (recipe && recipe.heroImage === params.name) {
      recipe.heroImage = '';
      store.writeRecipe(recipe);
    }
    sendJson(res, 200, { removed, photos: photoList(params.slug) });
  } catch (err) { fail(res, err, 500); }
});

router.post('/api/recipes/:slug/hero', async (req, res, { params }) => {
  try {
    const body = await readJsonBody(req);
    const recipe = store.readRecipe(params.slug);
    if (!recipe) return fail(res, 'That recipe no longer exists.', 404);
    recipe.heroImage = body.name || '';
    store.writeRecipe(recipe);
    sendJson(res, 200, { recipe: store.readRecipe(params.slug) });
  } catch (err) { fail(res, err); }
});

/* ----------------------------------------------------------------- inbox */

router.get('/api/inbox', async (_req, res) => {
  sendJson(res, 200, { items: inbox.listInbox() });
});

router.post('/api/inbox/upload', async (req, res) => {
  try {
    const result = await inbox.receiveUpload(req);
    sendJson(res, 200, result);
  } catch (err) { fail(res, err, 500); }
});

router.post('/api/inbox/assign', async (req, res) => {
  try {
    const body = await readJsonBody(req);
    const role = body.role === 'scan' ? 'scan' : 'photo';
    let slug = body.slug;
    if (!slug) {
      const created = store.createRecipe({ title: (body.newTitle || '').trim() || 'Untitled recipe' });
      slug = created.slug;
    }
    for (const file of body.files || []) inbox.assignToRecipe(file, slug, role);
    sendJson(res, 200, { slug, photos: photoList(slug), items: inbox.listInbox() });
  } catch (err) { fail(res, err); }
});

router.post('/api/inbox/discard', async (req, res) => {
  try {
    const body = await readJsonBody(req);
    for (const file of body.files || []) inbox.discardFromInbox(file);
    sendJson(res, 200, { items: inbox.listInbox() });
  } catch (err) { fail(res, err); }
});

/* ------------------------------------------------------------ file serving */

router.get('/files/*', async (_req, res, { params, query }) => {
  try {
    const target = safeJoin(LIBRARY_DIR, params.wildcard);
    if (!fs.existsSync(target)) return sendText(res, 404, 'Not found');

    const width = Number(query.get('w'));
    if (width && images.kindOf(target) === 'image') {
      try {
        const thumb = await images.thumbnail(target, Math.min(2000, Math.max(80, width)));
        return sendFile(res, thumb, { cache: 'private, max-age=60' });
      } catch (err) {
        // A thumbnail is an optimisation, never a precondition for seeing the
        // photo. Serving the original keeps the picture on screen, and the
        // console line means the cause is not invisible.
        console.warn(`  Could not make a thumbnail for ${path.basename(target)}: ${err.message}`);
        console.warn('  Showing the full-size photo instead. Run "npm run doctor" for details.');
      }
    }
    sendFile(res, target, { cache: 'private, max-age=60' });
  } catch (err) { sendText(res, 400, err.message); }
});

/* --------------------------------------------------------------- publish */

let lastBuild = { running: false, log: '', ok: null, at: '' };

/* Asked once at startup, never on a schedule. Anything that goes wrong here —
   no internet, GitHub down, a slow line — leaves the Studio working exactly as
   it did, with the notice simply absent. */
let updateStatus = { available: false, checkedAt: '' };

function lookForUpdateQuietly() {
  const timeout = setTimeout(() => {}, 0);
  clearTimeout(timeout);
  Promise.race([
    checkForUpdate(ROOT),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5000)),
  ])
    .then((result) => { updateStatus = result; })
    .catch(() => { /* offline, or GitHub unreachable: say nothing */ });
}

router.get('/api/publish/status', async (_req, res) => sendJson(res, 200, lastBuild));

router.post('/api/publish', async (_req, res) => {
  if (lastBuild.running) return sendJson(res, 200, lastBuild);
  lastBuild = { running: true, log: '', ok: null, at: new Date().toISOString() };
  const child = spawn(process.execPath, [path.join(ROOT, 'site', 'build.js')], { cwd: ROOT });
  child.stdout.on('data', (d) => { lastBuild.log += d.toString(); });
  child.stderr.on('data', (d) => { lastBuild.log += d.toString(); });
  child.on('close', (code) => {
    lastBuild.running = false;
    lastBuild.ok = code === 0;
  });
  sendJson(res, 202, { started: true });
});

/* ------------------------------------------------------------ static app */

router.get('/', async (_req, res) => sendFile(res, path.join(STUDIO_PUBLIC, 'index.html')));
router.get('/upload', async (_req, res) => sendFile(res, path.join(STUDIO_PUBLIC, 'upload.html')));
router.get('/app/*', async (_req, res, { params }) => {
  try {
    sendFile(res, safeJoin(STUDIO_PUBLIC, params.wildcard));
  } catch { sendText(res, 404, 'Not found'); }
});

/* ------------------------------------------------------------------ boot */

/* The built website is served from its own port, at the root, so the preview
   behaves exactly like the live site — absolute links, stylesheet and all. */
const previewServer = http.createServer((req, res) => {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    return sendText(res, 503, 'Nothing built yet. Press "Build the website" in the Studio.');
  }
  try {
    const clean = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = safeJoin(DIST_DIR, clean.replace(/^\/+/, '') || 'index.html');
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) return sendText(res, 404, 'Not found');
    sendFile(res, target, { cache: 'no-store' });
  } catch {
    sendText(res, 400, 'Bad request');
  }
});
previewServer.listen(PREVIEW_PORT, '0.0.0.0');

const server = http.createServer(async (req, res) => {
  try {
    const handled = await router.handle(req, res);
    if (!handled) sendText(res, 404, 'Not found');
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
  }
});

/** Open the Studio in the default browser, once it is actually answering. */
function openInBrowser(url) {
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] :
    process.platform === 'darwin' ? ['open', [url]] :
    ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    console.log(`  Could not open the browser automatically. Go to ${url}`);
  });
  child.unref();
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddress();
  console.log('');
  console.log('  Recipe Studio is running.');
  console.log('');
  console.log(`    On this computer:  http://localhost:${PORT}`);
  console.log(`    From a phone:      ${lan}/upload`);
  console.log(`    Website preview:   http://localhost:${PREVIEW_PORT}`);
  console.log('');
  console.log(`    Recipes live in:   ${RECIPES_DIR}`);
  console.log(`    Photo inbox:       ${INBOX_DIR}`);
  console.log(ai.isAvailable()
    ? `    Recipe reading:    on (${ai.DEFAULT_MODEL})`
    : '    Recipe reading:    off (no ANTHROPIC_API_KEY in .env)');
  console.log('');
  const launchedFromIcon = process.argv.includes('--open') || process.env.OPEN_BROWSER === '1';
  console.log(launchedFromIcon
    ? '  Leave this window open while you work. Close it when you are finished.'
    : '  Press Ctrl+C to stop.');
  console.log('');

  if (launchedFromIcon) openInBrowser(`http://localhost:${PORT}`);
  lookForUpdateQuietly();
});
