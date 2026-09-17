/* Keeps this computer's recipes in step with the recipe store on GitHub, and
   through it with the other computer. "Put the website online" runs a full
   sync: fetch what changed there, send what changed here, and the website
   rebuilds itself from the result.

   Rules, in order of importance:
     1. Nothing on this computer is ever deleted by a sync. A file the other
        computer removed, or changed while it was also changed here, is moved
        or copied to library/.recovered before anything is written over it.
     2. When the same file was changed on both computers, the version on
        GitHub wins and the local one is set aside — so the person pressing
        the button is the one who gets told, and nobody's work is overwritten
        without a copy being kept.
     3. Nothing is sent to GitHub until every file has been uploaded and
        checked; the branch moves in one step at the very end, or not at all.

   Talks to GitHub's git-data API directly, so no Git needs to be installed. */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ROOT } from './paths.js';
import { githubToken } from './env.js';
import { gh, repoSource, GitHubError, explain, tokenExpiry } from './github.js';
import { recoveredFolder, setAside as setAsideCopy } from './recover.js';

export const STATE_FILE = '.sync-state.json';
const MAX_BLOB = 100 * 1024 * 1024;          // GitHub's limit for one file
const TREE_CHUNK = 500;

/* ------------------------------------------------------------ what syncs */

/**
 * Is this project-relative POSIX path part of the shared library? Mirrors
 * .gitignore: the person's recipes, inbox photos, backgrounds and config,
 * never caches, trash, recovered copies or per-machine leftovers.
 */
export function isSynced(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p.startsWith('.'))) return false;
  const name = parts[parts.length - 1];
  if (/^(thumbs\.db|desktop\.ini)$/i.test(name) || name.endsWith('.part')) return false;
  if (parts[0] === 'config') return parts.length === 2 && !name.endsWith('.new');
  if (parts[0] === 'library' && ['recipes', 'inbox', 'backgrounds'].includes(parts[1])) return parts.length >= 3;
  return false;
}

const SYNCED_DIRS = ['library/recipes', 'library/inbox', 'library/backgrounds', 'config'];

/* --------------------------------------------------------------- hashing */

/** Git's own id for a file's bytes, so unchanged files compare without a download. */
export function blobSha(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function blobShaOfFile(file) {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(file).size;
    const hash = crypto.createHash('sha1');
    hash.update(`blob ${size}\0`);
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/* ----------------------------------------------------------------- state */

function readState(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8')); } catch { return null; }
}

function writeState(root, state) {
  const file = path.join(root, STATE_FILE);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

function freshState(source) {
  return { version: 1, repo: source.repo, branch: source.branch, baseCommit: null, lastSyncAt: '', lastPublishAt: '', lastSummary: [], files: {} };
}

/** What the last sync recorded, for the sidebar. Never the token. */
export function lastState(root = ROOT) {
  const state = readState(root);
  return {
    lastSyncAt: state?.lastSyncAt || '',
    lastPublishAt: state?.lastPublishAt || '',
    lastSummary: state?.lastSummary || [],
    baseCommit: state?.baseCommit || null,
  };
}

/* ------------------------------------------------------------- snapshots */

/** Every synced file on disk: path -> { sha, size, mtimeMs }, hashing only what changed. */
export async function localSnapshot(root, cache = {}) {
  const out = new Map();
  const walk = async (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${prefix}/${entry.name}`;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full, rel); continue; }
      if (!entry.isFile() || !isSynced(rel)) continue;
      const stat = fs.statSync(full);
      const known = cache[rel];
      const sha = known && known.size === stat.size && known.mtimeMs === stat.mtimeMs
        ? known.sha
        : await blobShaOfFile(full);
      out.set(rel, { sha, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  for (const dir of SYNCED_DIRS) await walk(path.join(root, ...dir.split('/')), dir);
  return out;
}

async function remoteSnapshot(token, source) {
  const ref = await gh(token, 'GET', `/repos/${source.repo}/git/ref/heads/${source.branch}`);
  const commit = ref.object.sha;
  const commitData = await gh(token, 'GET', `/repos/${source.repo}/git/commits/${commit}`);
  const tree = commitData.tree.sha;
  const listing = await gh(token, 'GET', `/repos/${source.repo}/git/trees/${tree}?recursive=1`);
  if (listing.truncated) {
    throw new Error('The recipe store on GitHub is too large to list in one go. Tell whoever set this up.');
  }
  const files = new Map();
  for (const entry of listing.tree || []) {
    if (entry.type === 'blob' && isSynced(entry.path)) files.set(entry.path, entry.sha);
  }
  return { commit, tree, files };
}

/* ------------------------------------------------------------- the plan */

/**
 * Decide what to do with every path, given what is here (local), what both
 * sides agreed on last time (base) and what is on GitHub (remote). Pure:
 * touches nothing. Each action carries `pullSafe`, true when applying it
 * cannot lose an edit made on this computer since the last sync.
 *
 *   local, base: Map/object of path -> { sha }     remote: Map of path -> sha
 */
export function plan(local, base, remote) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]);
  const paths = new Set([...keysOf(local), ...keysOf(base), ...keysOf(remote)]);
  const actions = [];
  for (const p of [...paths].sort()) {
    const L = get(local, p)?.sha;
    const B = get(base, p)?.sha;
    const R = remote instanceof Map ? remote.get(p) : remote?.[p];
    const localChanged = L !== B;
    const remoteChanged = R !== B;

    if (!localChanged && !remoteChanged) {
      if (L) actions.push({ path: p, action: 'keep', pullSafe: true });
      continue;
    }
    if (!localChanged) {                                   // only GitHub moved
      if (R) actions.push({ path: p, action: 'download', sha: R, pullSafe: true });
      else if (L) actions.push({ path: p, action: 'set-aside-deleted', pullSafe: true });
      else actions.push({ path: p, action: 'forget', pullSafe: true });
      continue;
    }
    if (!remoteChanged) {                                  // only this computer moved
      if (L) actions.push({ path: p, action: 'upload', pullSafe: false });
      else actions.push({ path: p, action: 'delete-remote', pullSafe: false });
      continue;
    }
    // Both moved.
    if (L === R) {
      actions.push({ path: p, action: L ? 'record' : 'forget', pullSafe: true });
    } else if (!L) {
      actions.push({ path: p, action: 'download', sha: R, pullSafe: false,
        note: 'was removed here but changed on the other computer, so it came back' });
    } else if (!R) {
      actions.push({ path: p, action: 'upload', pullSafe: false,
        note: 'was removed on the other computer but changed here, so your version was kept and put back' });
    } else {
      actions.push({ path: p, action: 'conflict', sha: R, pullSafe: false,
        note: 'was changed on both computers. The other computer\'s version is in use; yours was set aside' });
    }
  }
  return actions;
}

const keysOf = (m) => (m instanceof Map ? [...m.keys()] : Object.keys(m || {}));

/* ----------------------------------------------------------------- doing */

let inflight = null;

export function isConfigured() { return Boolean(githubToken()); }

/** Prove a key can read and write the recipe store. */
export async function checkAccess(token = githubToken(), source = repoSource()) {
  const repo = await gh(token, 'GET', `/repos/${source.repo}`, { timeoutMs: 15000 });
  const push = Boolean(repo.permissions?.push);
  if (!push) {
    const err = new Error('The publishing key can read the recipe store but not write to it. It needs "Contents: Read and write".');
    err.status = 403;
    throw err;
  }
  await gh(token, 'GET', `/repos/${source.repo}/git/ref/heads/${source.branch}`, { timeoutMs: 15000 });
  return { ok: true, push, private: Boolean(repo.private), expiresAt: tokenExpiry() };
}

/**
 * Run a sync. mode 'pull' applies only what cannot lose local work (used
 * quietly at startup); 'full' does everything and pushes. One at a time:
 * a second call while one is running simply joins it.
 */
export function sync({ mode = 'full', onLog = () => {}, root = ROOT, token = githubToken(), source = repoSource(root) } = {}) {
  if (inflight) return inflight;
  inflight = run({ mode, onLog, root, token, source }).finally(() => { inflight = null; });
  return inflight;
}

async function run({ mode, onLog, root, token, source }) {
  if (!token) {
    const err = new Error('Publishing isn\'t set up on this computer yet. Double-click "Set up website publishing" in the Studio folder.');
    err.code = 'not-configured';
    throw err;
  }
  const log = [];
  const say = (line) => { log.push(line); onLog(line); };
  const report = {
    mode, downloaded: 0, uploaded: 0, removedRemotely: 0, pending: 0,
    setAside: [], conflicts: [], commit: null, log, summary: [],
  };

  let state = readState(root);
  if (!state || state.repo !== source.repo || state.branch !== source.branch) state = freshState(source);
  const base = state.files || {};
  const uploadedBlobs = new Map();          // `${path}@${localSha}` -> blob sha, across retries

  try {
    for (let attempt = 1; ; attempt++) {
      say(attempt === 1 ? 'Looking at what is here...' : 'Someone else published at the same moment. Looking again...');
      const local = await localSnapshot(root, base);

      say('Asking GitHub what is there...');
      let remote;
      const ref = await gh(token, 'GET', `/repos/${source.repo}/git/ref/heads/${source.branch}`);
      if (state.baseCommit && ref.object.sha === state.baseCommit) {
        // Nothing moved on GitHub since last time: what we recorded is what is there.
        remote = { commit: ref.object.sha, tree: null, files: new Map(Object.entries(base).map(([p, e]) => [p, e.sha])) };
      } else {
        remote = await remoteSnapshot(token, source);
      }

      const actions = plan(local, base, remote.files);
      const outcome = await apply({ actions, local, base, remote, mode, root, token, source, say, report, uploadedBlobs });
      if (outcome.retry) {
        if (attempt >= 3) throw new Error('Someone else published at the same moment, three times over. Press the button again in a minute.');
        continue;
      }
      // Record where things stand.
      const at = new Date().toISOString();
      state = {
        ...freshState(source),
        baseCommit: outcome.deferred ? null : outcome.commit,
        lastSyncAt: at,
        lastPublishAt: mode === 'full' ? at : (state.lastPublishAt || ''),
        lastSummary: [],
        files: outcome.files,
      };
      report.commit = outcome.commit;
      break;
    }
  } catch (err) {
    if (err instanceof GitHubError) {
      const wrapped = new Error(explain(err, source));
      wrapped.status = err.status;
      throw wrapped;
    }
    throw err;
  }

  report.summary = summarize(report);
  state.lastSummary = report.summary;
  writeState(root, state);
  for (const line of report.summary) say(line);
  return report;
}

async function apply({ actions, local, base, remote, mode, root, token, source, say, report, uploadedBlobs }) {
  const files = { ...base };
  const now = new Date();
  const abs = (p) => path.join(root, ...p.split('/'));
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  let deferred = false;
  let deletedFolder = null;
  let conflictFolder = null;
  const treeEntries = [];
  const libraryDir = path.join(root, 'library');

  const record = (rel) => { const entry = local.get(rel); if (entry) files[rel] = entry; else delete files[rel]; };
  const noteStat = (rel) => { const s = fs.statSync(abs(rel)); files[rel] = { sha: files[rel].sha, size: s.size, mtimeMs: s.mtimeMs }; };

  const download = async (rel, sha) => {
    const bytes = await gh(token, 'GET', `/repos/${source.repo}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json', raw: true });
    if (blobSha(bytes) !== sha) throw new Error(`${rel} did not arrive intact from GitHub. Nothing was changed — try again.`);
    const target = abs(rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.part`, bytes);
    fs.renameSync(`${target}.part`, target);
    files[rel] = { sha };
    noteStat(rel);
    report.downloaded += 1;
  };

  // 1. Bring in what changed on GitHub, and set aside what needs it.
  for (const a of actions) {
    if (mode === 'pull' && !a.pullSafe) { deferred = true; report.pending += 1; continue; }
    switch (a.action) {
      case 'keep': files[a.path] = local.get(a.path); break;
      case 'record': record(a.path); break;
      case 'forget': delete files[a.path]; break;
      case 'download':
        say(`Fetching ${a.path}`);
        await download(a.path, a.sha);
        if (a.note) report.conflicts.push({ path: a.path, kind: 'came-back', note: a.note });
        break;
      case 'set-aside-deleted': {
        deletedFolder ||= recoveredFolder('deleted on the other computer', now, libraryDir);
        const to = setAsideCopy(abs(a.path), deletedFolder, a.path);
        fs.rmSync(abs(a.path), { force: true });
        pruneEmptyDirs(path.dirname(abs(a.path)), root);
        delete files[a.path];
        report.setAside.push({ path: a.path, to: rel(to), folder: rel(deletedFolder), kind: 'deleted' });
        say(`${a.path} was removed on the other computer; your copy is kept in library/.recovered`);
        break;
      }
      case 'conflict': {
        conflictFolder ||= recoveredFolder('changed on both computers', now, libraryDir);
        const to = setAsideCopy(abs(a.path), conflictFolder, a.path);
        report.setAside.push({ path: a.path, to: rel(to), folder: rel(conflictFolder), kind: 'conflict' });
        report.conflicts.push({ path: a.path, kind: 'both-changed', note: a.note });
        say(`${a.path} was changed on both computers; your copy is kept in library/.recovered`);
        await download(a.path, a.sha);
        break;
      }
      case 'upload': case 'delete-remote':
        break;                                        // handled below
      default:
        throw new Error(`Unknown sync action ${a.action}`);
    }
  }

  // 2. Send what changed here.
  if (mode === 'full') {
    for (const a of actions) {
      if (a.action === 'upload') {
        const entry = local.get(a.path);
        if (entry.size > MAX_BLOB) {
          say(`${a.path} is larger than GitHub allows (100 MB) and was left out.`);
          continue;
        }
        const key = `${a.path}@${entry.sha}`;
        let sha = uploadedBlobs.get(key);
        if (!sha) {
          say(`Sending ${a.path}`);
          const content = fs.readFileSync(abs(a.path));
          const blob = await gh(token, 'POST', `/repos/${source.repo}/git/blobs`, {
            body: { content: content.toString('base64'), encoding: 'base64' },
          });
          sha = blob.sha;
          uploadedBlobs.set(key, sha);
          // The file may have changed between hashing and reading; what went
          // up is what we record, so a later edit is noticed next time.
          entry.sha = blobSha(content);
        }
        treeEntries.push({ path: a.path, mode: '100644', type: 'blob', sha });
        files[a.path] = { ...entry, sha };
        report.uploaded += 1;
        if (a.note) report.conflicts.push({ path: a.path, kind: 'put-back', note: a.note });
      } else if (a.action === 'delete-remote') {
        treeEntries.push({ path: a.path, mode: '100644', type: 'blob', sha: null });
        delete files[a.path];
        report.removedRemotely += 1;
      }
    }
  }

  let commit = remote.commit;
  if (treeEntries.length) {
    say('Recording the change on GitHub...');
    let baseTree = remote.tree;
    if (!baseTree) {
      const c = await gh(token, 'GET', `/repos/${source.repo}/git/commits/${remote.commit}`);
      baseTree = c.tree.sha;
    }
    for (let i = 0; i < treeEntries.length; i += TREE_CHUNK) {
      const tree = await gh(token, 'POST', `/repos/${source.repo}/git/trees`, {
        body: { base_tree: baseTree, tree: treeEntries.slice(i, i + TREE_CHUNK) },
      });
      baseTree = tree.sha;
    }
    const changed = report.uploaded;
    const removed = report.removedRemotely;
    const message = `Recipes from ${os.hostname()}: ${changed} added or changed` + (removed ? `, ${removed} removed` : '');
    const created = await gh(token, 'POST', `/repos/${source.repo}/git/commits`, {
      body: { message, tree: baseTree, parents: [remote.commit] },
    });
    try {
      await gh(token, 'PATCH', `/repos/${source.repo}/git/refs/heads/${source.branch}`, {
        body: { sha: created.sha, force: false },
      });
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 422 || err.status === 409)) {
        // The branch moved under us. Start over; uploaded blobs are reused.
        report.uploaded = 0; report.removedRemotely = 0; report.downloaded = 0;
        report.setAside.length = 0; report.conflicts.length = 0; report.pending = 0;
        return { retry: true };
      }
      throw err;
    }
    commit = created.sha;
  }

  return { retry: false, commit, files, deferred };
}

/** Remove now-empty folders left behind by a set-aside file, up to the synced root. */
function pruneEmptyDirs(dir, root) {
  const stopAt = SYNCED_DIRS.map((d) => path.join(root, ...d.split('/')));
  while (!stopAt.includes(dir) && dir.startsWith(root)) {
    try {
      if (fs.readdirSync(dir).length) return;
      fs.rmdirSync(dir);
    } catch { return; }
    dir = path.dirname(dir);
  }
}

/* --------------------------------------------------------------- wording */

const recipeName = (rel) => {
  const m = rel.match(/^library\/recipes\/([^/]+)\//);
  return m ? m[1] : null;
};

/** Plain sentences about what a sync did, for the person who pressed the button. */
export function summarize(report) {
  const lines = [];
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (report.downloaded) {
    lines.push(`${plural(report.downloaded, 'file')} came in from the other computer.`);
  }
  if (report.mode === 'full') {
    if (report.uploaded || report.removedRemotely) {
      const bits = [];
      if (report.uploaded) bits.push(`${plural(report.uploaded, 'file')} sent to GitHub`);
      if (report.removedRemotely) bits.push(`${plural(report.removedRemotely, 'file')} removed there`);
      lines.push(`${bits.join(', ')}. The website will update itself in a few minutes.`);
    } else {
      lines.push('Nothing new to send. The website already has everything.');
    }
  } else if (report.pending) {
    lines.push(`${plural(report.pending, 'change')} on this computer ${report.pending === 1 ? 'is' : 'are'} waiting for "Put the website online".`);
  }
  for (const c of report.conflicts) {
    const who = recipeName(c.path);
    lines.push(`${who ? `In "${who}", ` : ''}${path.posix.basename(c.path)} ${c.note}.`);
  }
  const deleted = report.setAside.filter((s) => s.kind === 'deleted');
  if (deleted.length) {
    lines.push(`${plural(deleted.length, 'file')} removed on the other computer; your ${deleted.length === 1 ? 'copy is' : 'copies are'} kept in ${deleted[0].folder}.`);
  }
  if (!lines.length) lines.push('Everything is already in step.');
  return lines;
}
