/* Updates Recipe Studio in place, or moves it somewhere Windows can cope with.
   Run with:  npm run update   (or double-click Update.bat)

   Two rules govern everything below:
     1. Recipes and photos are never moved, altered or deleted. The library is
        copied, never cut, and always verified afterwards.
     2. Nothing is changed on disk until the new version has been downloaded,
        unpacked and checked. A failure part-way leaves the install as it was. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, pathBudget } from '../studio/lib/paths.js';

/* ------------------------------------------------------------------ shape */

// Folders and files the update replaces. Everything else is left alone.
const CODE_DIRS = ['studio', 'site', 'scripts', 'assets', '.github'];
const CODE_FILE_PATTERN = /^(package\.json|package-lock\.json|\.gitignore|\.npmrc|\.env\.example|.*\.md|.*\.bat|.*\.sh)$/i;

// Never touched, in either direction, for any reason.
const SACRED = new Set(['library', '.env', 'node_modules', 'dist', '.git']);

const STATE_FILE = '.update-state.json';

/* ---------------------------------------------------------------- output */

const say = (line = '') => console.log(line);
const step = (line) => console.log(`\n  ${line}`);
const detail = (line) => console.log(`    ${line}`);
const problem = (line) => console.log(`\n  ${line}`);

class Stop extends Error {}
const stop = (message) => { throw new Stop(message); };

/* ----------------------------------------------------------------- tools */

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Is this folder really a Recipe Studio install? */
function isProject(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  return Boolean(pkg && pkg.name === 'emma-cooking-blog' && fs.existsSync(path.join(dir, 'studio', 'server.js')));
}

/** Every file below dir, as a sorted list of [relative path, bytes]. */
function treeStats(dir) {
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.push([rel, fs.statSync(full).size]);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true, preserveTimestamps: true });
}

/** Where Windows thinks a special folder is — OneDrive often moves them. */
function knownFolder(name, fallback) {
  if (process.platform === 'win32') {
    const asked = spawnSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-Command', `[Environment]::GetFolderPath('${name}')`,
    ], { encoding: 'utf8' });
    const resolved = (asked.stdout || '').trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  }
  return fallback;
}

function documentsDir() {
  if (process.env.RECIPE_STUDIO_DOCUMENTS) return process.env.RECIPE_STUDIO_DOCUMENTS;
  if (process.platform === 'win32') return knownFolder('MyDocuments', path.join(os.homedir(), 'Documents'));
  return os.homedir();
}

/** Places a downloaded-and-unzipped copy, or an older install, tends to be. */
function likelyPlaces() {
  if (process.env.RECIPE_STUDIO_SEARCH_DIRS) {
    return process.env.RECIPE_STUDIO_SEARCH_DIRS.split(path.delimiter).filter(Boolean);
  }
  const home = os.homedir();
  return [
    documentsDir(),
    knownFolder('UserProfile', home) && path.join(home, 'Downloads'),
    knownFolder('Desktop', path.join(home, 'Desktop')),
    home,
  ].filter(Boolean);
}

/**
 * Find every Recipe Studio install with a library in it, a few levels deep
 * under the usual folders. Used by first-time setup to find the photos and
 * recipes already on the machine.
 */
function findInstalls(exclude = []) {
  const skip = new Set(exclude.map((p) => path.resolve(p)));
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (isProject(dir) && fs.existsSync(path.join(dir, 'library'))) {
      const key = path.resolve(dir);
      if (!skip.has(key)) found.set(key, libraryFileCount(dir));
      return;                                  // do not descend into an install
    }
    for (const e of entries) {
      if (!e.isDirectory() || SACRED.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const place of likelyPlaces()) walk(place, 0);
  return [...found.entries()]
    .map(([dir, files]) => ({ dir, files }))
    .sort((a, b) => b.files - a.files);
}

/** How much of a person's own work an install holds. */
function libraryFileCount(dir) {
  let n = 0;
  for (const sub of ['recipes', 'inbox']) {
    n += treeStats(path.join(dir, 'library', sub)).filter(([rel]) => !rel.endsWith('.gitkeep')).length;
  }
  return n;
}

/** Uncommitted work in a git checkout, or '' when there is none to worry about. */
function gitChanges(projectRoot) {
  if (!fs.existsSync(path.join(projectRoot, '.git'))) return '';
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' });
  if (result.status !== 0) return '';
  const lines = (result.stdout || '').trim().split('\n').filter(Boolean);
  return lines.length ? lines.slice(0, 8).map((l) => `    ${l}`).join('\n') : '';
}

/** Refuse to work underneath a running Studio. */
function studioIsRunning(projectRoot) {
  let port = 4321;
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const found = fs.readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (found) port = Number(found[1]);
  }
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, '127.0.0.1');
  });
}

/* -------------------------------------------------------------- download */

function updateSource(projectRoot) {
  const pkg = readJson(path.join(projectRoot, 'package.json'), {});
  const source = pkg.updateSource || {};
  return {
    repo: source.repo || 'aanzarut/emma-cooking-blogg',
    branch: source.branch || 'main',
  };
}

/**
 * Conditional download. When nothing has changed GitHub answers 304 with an
 * empty body, so the routine check costs no bandwidth at all.
 */
export async function fetchRelease({ repo, branch }, knownTag) {
  // RECIPE_STUDIO_UPDATE_URL lets the test suite serve a known release locally
  // instead of reaching GitHub.
  const url = process.env.RECIPE_STUDIO_UPDATE_URL
    || `https://github.com/${repo}/archive/refs/heads/${branch}.tar.gz`;
  const headers = { 'user-agent': 'recipe-studio-updater' };
  if (knownTag) headers['if-none-match'] = knownTag;

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    stop(`Could not reach GitHub (${err.message}). Check the internet connection and try again.`);
  }
  if (response.status === 304) return { changed: false };
  if (response.status === 404) {
    stop(`GitHub has no branch called "${branch}" in ${repo}. Nothing was changed.`);
  }
  if (!response.ok) stop(`GitHub answered ${response.status}. Nothing was changed.`);

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 1024) stop('The download was too small to be real. Nothing was changed.');
  return { changed: true, body, etag: response.headers.get('etag') || '' };
}

/** Unpack with tar, which Windows 10 has shipped since 2018, else PowerShell. */
function unpack(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  const tar = spawnSync('tar', ['-xzf', archive, '-C', into, '--strip-components=1'], { encoding: 'utf8' });
  if (tar.status === 0) return;

  if (process.platform === 'win32') {
    // Expand-Archive only reads .zip, so fall back to a zip download.
    stop('This computer has no "tar" command, which the updater needs. '
       + 'Updating Windows usually adds it; otherwise follow the manual steps in SETUP.md.');
  }
  stop('The download was damaged and could not be unpacked. Nothing was changed — '
     + 'check the internet connection and try again.');
}

/* ----------------------------------------------------------------- apply */

/** Replace the program files, leaving recipes, photos and settings alone. */
function replaceCode(fresh, target, notes) {
  const rescue = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-rollback-'));
  const restore = [];

  try {
    for (const dir of CODE_DIRS) {
      const to = path.join(target, dir);
      if (fs.existsSync(to)) {
        copyTree(to, path.join(rescue, dir));
        restore.push(dir);
        fs.rmSync(to, { recursive: true, force: true });
      }
      const from = path.join(fresh, dir);
      if (fs.existsSync(from)) copyTree(from, to);
    }

    for (const entry of fs.readdirSync(fresh, { withFileTypes: true })) {
      if (!entry.isFile() || !CODE_FILE_PATTERN.test(entry.name)) continue;
      const to = path.join(target, entry.name);
      if (fs.existsSync(to)) {
        fs.copyFileSync(to, path.join(rescue, entry.name));
        restore.push(entry.name);
      }
      fs.copyFileSync(path.join(fresh, entry.name), to);
    }

    mergeConfig(fresh, target, notes);
  } catch (err) {
    for (const name of restore) {
      const back = path.join(rescue, name);
      const to = path.join(target, name);
      fs.rmSync(to, { recursive: true, force: true });
      if (fs.existsSync(back)) copyTree(back, to);
    }
    stop(`The update failed (${err.message}). The previous version was put back.`);
  } finally {
    fs.rmSync(rescue, { recursive: true, force: true });
  }
}

/**
 * config/ holds choices the cook has made — the site name, the dropdown lists.
 * Those always win. A changed incoming file is written alongside as .new so
 * nothing is lost in either direction.
 */
function mergeConfig(fresh, target, notes) {
  const from = path.join(fresh, 'config');
  const to = path.join(target, 'config');
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const incoming = path.join(from, entry.name);
    const existing = path.join(to, entry.name);
    if (!fs.existsSync(existing)) {
      fs.copyFileSync(incoming, existing);
      continue;
    }
    const same = fs.readFileSync(incoming).equals(fs.readFileSync(existing));
    if (!same) {
      fs.copyFileSync(incoming, `${existing}.new`);
      notes.push(`config/${entry.name} has a newer version saved beside it as ${entry.name}.new — your own settings were kept.`);
    }
  }
}

/**
 * Lay down a fresh copy at `target` from `source`, carry a person's data
 * across from `dataFrom` (if any), and keep their config. Shared by the
 * too-deep relocation and first-time setup, which are the same operation.
 */
function installFresh(source, target, dataFrom, notes) {
  if (path.resolve(source) !== path.resolve(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', STATE_FILE].includes(entry.name)) continue;
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) copyTree(from, to); else fs.copyFileSync(from, to);
    }
  }
  let carried = null;
  if (dataFrom && path.resolve(dataFrom) !== path.resolve(target)) {
    carried = carryUserDataAcross(dataFrom, target);
    // the library's own README is not the person's data; keep the newest one
    const readme = path.join(source, 'library', 'README.md');
    if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(target, 'library', 'README.md'));
    mergeConfig(source, target, notes);
  }
  return carried;
}

/** Copy recipes, photos and settings into a fresh install, then prove it. */
function carryUserDataAcross(oldRoot, newRoot) {
  for (const name of ['library', '.env']) {
    const from = path.join(oldRoot, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(newRoot, name);
    fs.rmSync(to, { recursive: true, force: true });
    if (fs.statSync(from).isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
  // library/.cache holds thumbnails, dish masks and the 170 MB cut-out model:
  // all of it is remade on demand, none of it is hers. Leave it behind rather
  // than double the copy for nothing. (The check below compares what is
  // left, so it is dropped from both sides.)
  fs.rmSync(path.join(newRoot, 'library', '.cache'), { recursive: true, force: true });

  // The person's own settings win over the shipped defaults. mergeConfig(),
  // run afterwards by the caller, then offers any changed upstream file as
  // .new beside them — the same outcome as an in-place update.
  const oldConfig = path.join(oldRoot, 'config');
  if (fs.existsSync(oldConfig)) {
    fs.mkdirSync(path.join(newRoot, 'config'), { recursive: true });
    for (const entry of fs.readdirSync(oldConfig, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.endsWith('.new')) {
        fs.copyFileSync(path.join(oldConfig, entry.name), path.join(newRoot, 'config', entry.name));
      }
    }
  }

  const notCache = (list) => list.filter(([rel]) => !rel.split(/[\\/]/).includes('.cache'));
  const before = notCache(treeStats(path.join(oldRoot, 'library')));
  const after = notCache(treeStats(path.join(newRoot, 'library')));
  const bytes = (list) => list.reduce((sum, [, size]) => sum + size, 0);
  if (before.length !== after.length || bytes(before) !== bytes(after)) {
    stop(`The copy could not be verified (${before.length} files in, ${after.length} out). `
       + `Your original folder at ${oldRoot} has not been touched — use it and tell whoever set this up.`);
  }
  return { files: before.length, bytes: bytes(before) };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const projectRoot = ROOT;
  const force = process.argv.includes('--force');
  const checkOnly = process.argv.includes('--check');

  say();
  say('  Recipe Studio updater');
  say('  ---------------------');

  if (!isProject(projectRoot)) {
    stop(`${projectRoot} does not look like the Recipe Studio folder. Nothing was changed.`);
  }
  if (await studioIsRunning(projectRoot)) {
    stop('Recipe Studio is still running. Close its black window, then run this again.');
  }
  // Someone working on the project itself would lose uncommitted edits, since
  // the update replaces every code file. The people this is built for install
  // from a download and have no repository here, so this never fires for them.
  const uncommitted = gitChanges(projectRoot);
  if (uncommitted && !force) {
    stop(`This folder is a git checkout with uncommitted changes:\n${uncommitted}\n`
       + '  Updating would overwrite them. Commit or stash first, or pass --force.');
  }

  const source = updateSource(projectRoot);
  if (process.argv.includes('--setup')) return firstTimeSetup(projectRoot, source);

  const statePath = path.join(projectRoot, STATE_FILE);
  const state = readJson(statePath, {});

  step(`Checking ${source.repo} (${source.branch}) for a new version...`);
  const release = await fetchRelease(source, force ? null : state.etag);

  if (!release.changed) {
    detail('Already up to date. Nothing to do.');
    say();
    return;
  }
  if (checkOnly) {
    detail('A newer version is available. Run the updater to install it.');
    say();
    return;
  }
  detail(`Downloaded ${(release.body.length / 1024).toFixed(0)} KB.`);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-update-'));
  const fresh = path.join(workspace, 'fresh');
  try {
    const archive = path.join(workspace, 'release.tar.gz');
    fs.writeFileSync(archive, release.body);
    unpack(archive, fresh);
    if (!isProject(fresh)) stop('The download did not contain a usable copy. Nothing was changed.');
    detail('Unpacked and checked.');

    const notes = [];
    let target = projectRoot;
    let movedFrom = null;

    const budget = pathBudget(projectRoot);
    if (!budget.ok) {
      step('This folder sits too deep for Windows to cope with.');
      detail(`${budget.root} characters; ${budget.safeRootLength} is the most that leaves room for recipe photos.`);

      target = path.join(documentsDir(), 'emma-cooking-blogg');
      let n = 2;
      while (fs.existsSync(target) && !isProject(target)) target = path.join(documentsDir(), `emma-cooking-blogg-${n++}`);
      detail(`Setting up a fresh copy at ${target}`);

      const carried = installFresh(fresh, target, projectRoot, notes);
      detail(`Copied ${carried.files} files (${(carried.bytes / 1048576).toFixed(1)} MB) of recipes and photos, and checked every one arrived.`);
      movedFrom = projectRoot;
    } else {
      step('Installing the new version...');
      replaceCode(fresh, target, notes);
      detail('Program files replaced. Recipes, photos and settings untouched.');
    }

    await finishInstall(target, release.etag, source.branch, notes, movedFrom);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * First-time setup, run from a freshly unzipped download. This folder *is* the
 * new version, so there is nothing to fetch: put a copy where Windows can cope
 * with it, find any earlier install and bring its recipes and photos across,
 * and make the desktop icon. One double-click, wherever the ZIP was unzipped.
 */
async function firstTimeSetup(here, source) {
  const notes = [];
  const docs = documentsDir();
  let target = path.join(docs, 'emma-cooking-blogg');
  let n = 2;
  while (fs.existsSync(target) && !isProject(target)) target = path.join(docs, `emma-cooking-blogg-${n++}`);

  step(`Recipe Studio will live at:  ${target}`);

  const targetIsInstall = isProject(target) && path.resolve(target) !== path.resolve(here);
  const others = findInstalls([here, target]);
  const withData = others.filter((o) => o.files > 0);

  let movedFrom = null;
  if (targetIsInstall) {
    // Already set up there: refresh its program files, keep its library.
    step('There is already a copy there. Updating it and keeping its recipes and photos.');
    replaceCode(here, target, notes);
    if (withData.length) {
      notes.push(`Another copy with ${withData[0].files} files was also found at ${withData[0].dir} — it was left alone.`);
    }
  } else {
    const from = withData[0] || null;
    if (from) {
      step(`Found your earlier copy, with ${from.files} recipe and photo files:`);
      detail(from.dir);
      if (withData.length > 1) {
        detail(`(${withData.length - 1} other copies found with fewer files; the fullest one is used.)`);
      }
    } else {
      step('No earlier copy with recipes or photos was found, so this is a clean start.');
    }
    const carried = installFresh(here, target, from?.dir, notes);
    if (carried) {
      detail(`Copied ${carried.files} files (${(carried.bytes / 1048576).toFixed(1)} MB) and checked every one arrived.`);
      movedFrom = from.dir;
    }
  }

  // A downloaded copy carries no history, so the first update check must not
  // report the version just installed as new: record what it is.
  let etag = '';
  try { etag = (await fetchRelease(source, null)).etag || ''; } catch { /* offline is fine */ }

  await finishInstall(target, etag, source.branch, notes, movedFrom, { offerKey: true });
}

/**
 * Run a long command and say something every so often while it runs. npm's
 * own progress display renders poorly in a plain console window and can go
 * silent for minutes while it downloads, which reads as "frozen" to someone
 * watching — the exact moment they close the window.
 */
function runWithHeartbeat(command, args, { cwd, everyMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: true });
    const beat = setInterval(() => {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`    ... still installing (${secs}s so far). Leave this window open.`);
    }, everyMs);
    child.on('exit', (code) => { clearInterval(beat); resolve({ status: code ?? 1 }); });
    child.on('error', (err) => { clearInterval(beat); console.log(`    npm could not be started: ${err.message}`); resolve({ status: 1 }); });
  });
}

/** Everything that happens once the files are in place. */
async function finishInstall(target, etag, branch, notes, movedFrom, { offerKey = false } = {}) {
  step('Installing the parts it needs (this can take a few minutes)...');
  detail('It may look as though nothing is happening. It is. Leave this window open.');
  const installed = process.env.RECIPE_STUDIO_SKIP_INSTALL
    ? { status: 0 }                                    // used by the test suite
    : await runWithHeartbeat('npm', ['install', '--no-audit', '--no-fund'], { cwd: target });
  if (installed.status !== 0) {
    problem('npm install did not finish cleanly. The files are in place — try starting the Studio, and run "Check for problems" if it misbehaves.');
  }

  if (process.platform === 'win32') {
    step('Pointing the desktop icon at the current folder...');
    spawnSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(target, 'scripts', 'install-shortcut.ps1'),
    ], { cwd: target, stdio: 'inherit' });
  }

  fs.writeFileSync(
    path.join(target, STATE_FILE),
    JSON.stringify({ etag, updatedAt: new Date().toISOString(), branch }, null, 2)
  );

  // First-time setup: the person wants card reading from the start, so ask
  // for the key here rather than sending them to a second launcher. Runs
  // after npm install (it needs the SDK) and before the health check (so the
  // check reflects the answer). Skipping is fine and is not a failure.
  if (offerKey && !process.env.RECIPE_STUDIO_SKIP_INSTALL) {
    spawnSync(process.execPath, [path.join(target, 'scripts', 'setup-key.js'), '--optional'],
      { cwd: target, stdio: 'inherit' });
  } else if (offerKey && process.env.RECIPE_STUDIO_SKIP_INSTALL) {
    // the test suite has no SDK in a bare install; still exercise the prompt
    spawnSync(process.execPath, [path.join(target, 'scripts', 'setup-key.js'), '--optional'],
      { cwd: target, stdio: 'inherit', env: { ...process.env, RECIPE_STUDIO_SKIP_KEY_CHECK: '1' } });
  }

  let health = { status: 0 };
  if (!process.env.RECIPE_STUDIO_SKIP_INSTALL) {
    step('Checking everything works...');
    health = spawnSync(process.execPath, [path.join(target, 'scripts', 'doctor.js')],
      { cwd: target, stdio: 'inherit' });
  }

  say();
  if (health.status === 0) {
    say('  Done. Start the Studio from the desktop icon as usual.');
  } else {
    // Never claim success over the top of a failed check.
    say('  The new version is installed, but the check above found something');
    say('  that still needs attention. Read the line marked with an X and do');
    say('  what it says, then double-click "Check for problems" again.');
  }
  for (const note of notes) detail(note);
  if (movedFrom) {
    say();
    say(`  Recipe Studio now lives in:  ${target}`);
    say(`  The old folder is still at:  ${movedFrom}`);
    say('  Nothing was deleted. Once the Studio works from the icon, that old');
    say('  folder can be dragged to the Recycle Bin.');
  }
  say();
}

/** Used by the Studio at startup to show a quiet "newer version" note. */
export async function checkForUpdate(projectRoot = ROOT) {
  const statePath = path.join(projectRoot, STATE_FILE);
  const state = readJson(statePath, {});
  const release = await fetchRelease(updateSource(projectRoot), state.etag);

  // With nothing recorded yet, this install came straight from a download and
  // is current by definition — remember the tag rather than crying wolf.
  if (!state.etag) {
    if (release.etag) {
      fs.writeFileSync(statePath, JSON.stringify(
        { etag: release.etag, updatedAt: new Date().toISOString() }, null, 2));
    }
    return { available: false, checkedAt: new Date().toISOString() };
  }
  return { available: release.changed, checkedAt: new Date().toISOString() };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!invokedDirectly) {
  // imported for checkForUpdate; do not run the updater
} else main().catch((err) => {
  say();
  if (err instanceof Stop) {
    say(`  ${err.message}`);
  } else {
    say(`  The updater hit a problem and stopped: ${err.message}`);
    say('  Nothing was deleted. Show this to whoever set this up.');
  }
  say();
  process.exit(1);
});
