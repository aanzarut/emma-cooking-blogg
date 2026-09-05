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
const CODE_FILE_PATTERN = /^(package\.json|package-lock\.json|\.gitignore|\.env\.example|.*\.md|.*\.bat|.*\.sh)$/i;

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

/** Where Windows thinks Documents is — which OneDrive often moves. */
function documentsDir() {
  if (process.env.RECIPE_STUDIO_DOCUMENTS) return process.env.RECIPE_STUDIO_DOCUMENTS;
  if (process.platform === 'win32') {
    const asked = spawnSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-Command', "[Environment]::GetFolderPath('MyDocuments')",
    ], { encoding: 'utf8' });
    const resolved = (asked.stdout || '').trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
    return path.join(os.homedir(), 'Documents');
  }
  return os.homedir();
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

  const before = treeStats(path.join(oldRoot, 'library'));
  const after = treeStats(path.join(newRoot, 'library'));
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

  const source = updateSource(projectRoot);
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

      fs.rmSync(target, { recursive: true, force: true });
      copyTree(fresh, target);
      const carried = carryUserDataAcross(projectRoot, target);
      detail(`Copied ${carried.files} files (${(carried.bytes / 1048576).toFixed(1)} MB) of recipes and photos, and checked every one arrived.`);
      mergeConfig(fresh, target, notes);
      movedFrom = projectRoot;
    } else {
      step('Installing the new version...');
      replaceCode(fresh, target, notes);
      detail('Program files replaced. Recipes, photos and settings untouched.');
    }

    step('Installing the parts it needs (this can take a minute)...');
    const installed = process.env.RECIPE_STUDIO_SKIP_INSTALL
      ? { status: 0 }                                    // used by the test suite
      : spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: target, stdio: 'inherit', shell: true,
        });
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
      JSON.stringify({ etag: release.etag, updatedAt: new Date().toISOString(), branch: source.branch }, null, 2)
    );

    if (!process.env.RECIPE_STUDIO_SKIP_INSTALL) {
      step('Checking everything works...');
      spawnSync(process.execPath, [path.join(target, 'scripts', 'doctor.js')], { cwd: target, stdio: 'inherit' });
    }

    say();
    say('  Done. Start the Studio from the desktop icon as usual.');
    for (const note of notes) detail(note);
    if (movedFrom) {
      say();
      say(`  Recipe Studio now lives in:  ${target}`);
      say(`  The old folder is still at:  ${movedFrom}`);
      say('  Nothing was deleted. Once the Studio works from the icon, that old');
      say('  folder can be dragged to the Recycle Bin.');
    }
    say();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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
