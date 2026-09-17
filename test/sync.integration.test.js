/* Two installs, A and B, sharing one (fake) GitHub. Drives the real engine
   over real folders; only the network is a stand-in. */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeGitHub } from './helpers/fake-github.js';
import { sync, STATE_FILE, localSnapshot, checkAccess } from '../studio/lib/sync.js';
import { GitHubError } from '../studio/lib/github.js';

const TOKEN = 'github_pat_test';
const source = { repo: 'aanzarut/emma-cooking-blogg', branch: 'main' };
let hub;
let A;
let B;

const write = (root, rel, content) => {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
const recovered = (root) => {
  const dir = path.join(root, 'library', '.recovered');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${prefix}${e.name}/`);
      else out.push(`${prefix}${e.name}`);
    }
  };
  walk(dir, '');
  return out.sort();
};
const run = (root, mode = 'full') => sync({ mode, root, token: TOKEN, source });

before(async () => {
  hub = await startFakeGitHub({
    files: {
      'README.md': '# code, not data',
      'library/recipes/.gitkeep': '',
      'config/site.json': '{"title":"Emma"}',
      'library/recipes/soup/recipe.md': '---\nname: Soup\n---\n',
    },
  });
  process.env.RECIPE_STUDIO_GITHUB_API = hub.url;
  A = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-a-'));
  B = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-b-'));
  for (const root of [A, B]) {
    fs.mkdirSync(path.join(root, 'library', 'recipes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'library', 'inbox'), { recursive: true });
    write(root, 'config/site.json', '{"title":"Emma"}');
  }
});

after(async () => {
  await hub.close();
  delete process.env.RECIPE_STUDIO_GITHUB_API;
  fs.rmSync(A, { recursive: true, force: true });
  fs.rmSync(B, { recursive: true, force: true });
});

test('checkAccess proves read and write', async () => {
  const ok = await checkAccess(TOKEN, source);
  assert.equal(ok.push, true);
  assert.equal(ok.expiresAt, '2027-09-17T12:00:00.000Z');
  hub.push = false;
  await assert.rejects(() => checkAccess(TOKEN, source), /Read and write/);
  hub.push = true;
  await assert.rejects(() => checkAccess('wrong', source), (e) => e instanceof GitHubError && e.status === 401);
});

test('first sync on A: pulls the soup, pushes the cake, ignores code and dot-files', async () => {
  write(A, 'library/recipes/cake/recipe.md', '---\nname: Cake\n---\n');
  write(A, 'library/recipes/cake/images/original/cake.jpg', Buffer.from([0xff, 0xd8, 1, 2, 3]));
  write(A, 'library/.cache/thumb.jpg', 'no');
  write(A, 'library/recipes/cake/.DS_Store', 'no');

  const report = await run(A);
  assert.equal(report.downloaded, 1);
  assert.equal(report.uploaded, 2);
  assert.equal(report.conflicts.length, 0);
  assert.equal(read(A, 'library/recipes/soup/recipe.md'), '---\nname: Soup\n---\n');
  assert.equal(hub.read('library/recipes/cake/recipe.md'), '---\nname: Cake\n---\n');
  assert.equal(hub.read('README.md'), '# code, not data');
  assert.equal(hub.tree().has('library/recipes/.gitkeep'), true, 'remote .gitkeep untouched');
  assert.equal(hub.tree().has('library/.cache/thumb.jpg'), false);
  assert.equal(hub.tree().has('library/recipes/cake/.DS_Store'), false);
  assert.match(hub.commits.get(hub.head()).message, /^Recipes from .*: 2 added or changed$/);

  const state = JSON.parse(read(A, STATE_FILE));
  assert.equal(state.baseCommit, hub.head());
  assert.ok(state.files['library/recipes/cake/recipe.md'].sha);
  assert.match(report.summary[0], /^1 file came in/);
  assert.match(report.summary[1], /^2 files sent to GitHub\./);
});

test('nothing to do is cheap: no tree fetch when GitHub has not moved', async () => {
  hub.calls.length = 0;
  const report = await run(A);
  assert.equal(report.uploaded + report.downloaded, 0);
  assert.equal(hub.calls.some((c) => c.path.includes('/git/trees/')), false);
  assert.deepEqual(report.summary, ['Nothing new to send. The website already has everything.']);
});

test('B pulls everything A sent', async () => {
  const report = await run(B, 'pull');
  assert.equal(report.downloaded, 3, 'soup, cake, cake photo');
  assert.equal(read(B, 'library/recipes/cake/recipe.md'), '---\nname: Cake\n---\n');
  assert.deepEqual([...fs.readFileSync(path.join(B, 'library/recipes/cake/images/original/cake.jpg'))], [0xff, 0xd8, 1, 2, 3]);
});

test('a startup pull never sends and never overwrites local edits', async () => {
  write(B, 'library/recipes/cake/recipe.md', '---\nname: Cake (B)\n---\n');
  hub.commitFiles({ 'library/recipes/cake/recipe.md': '---\nname: Cake (A)\n---\n' });
  const report = await run(B, 'pull');
  assert.equal(report.pending, 1);
  assert.equal(report.downloaded, 0);
  assert.equal(read(B, 'library/recipes/cake/recipe.md'), '---\nname: Cake (B)\n---\n');
  assert.equal(JSON.parse(read(B, STATE_FILE)).baseCommit, null);
  assert.match(report.summary[0], /1 change on this computer is waiting/);
});

test('the same file changed on both computers: GitHub wins, local copy set aside, both told', async () => {
  const report = await run(B, 'full');
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].kind, 'both-changed');
  assert.equal(read(B, 'library/recipes/cake/recipe.md'), '---\nname: Cake (A)\n---\n');
  const aside = recovered(B);
  assert.equal(aside.length, 1);
  assert.match(aside[0], /changed on both computers\/library\/recipes\/cake\/recipe\.md$/);
  assert.equal(fs.readFileSync(path.join(B, 'library', '.recovered', aside[0]), 'utf8'), '---\nname: Cake (B)\n---\n');
  assert.equal(report.uploaded, 0, 'nothing else to send');
  assert.match(report.summary.join('\n'), /In "cake", recipe.md was changed on both computers/);
});

test('a recipe removed on A is set aside on B, never deleted; an empty folder is tidied', async () => {
  fs.rmSync(path.join(A, 'library', 'recipes', 'soup'), { recursive: true });
  let report = await run(A);
  assert.equal(report.removedRemotely, 1);
  assert.equal(hub.tree().has('library/recipes/soup/recipe.md'), false);

  report = await run(B);
  assert.equal(report.setAside.length, 1);
  assert.equal(report.setAside[0].kind, 'deleted');
  assert.equal(exists(B, 'library/recipes/soup'), false);
  assert.ok(recovered(B).some((p) => /deleted on the other computer\/library\/recipes\/soup\/recipe\.md$/.test(p)));
  assert.match(report.summary.join('\n'), /1 file removed on the other computer; your copy is kept in library\/\.recovered\//);
});

test('removed on GitHub but edited here: the local version is put back', async () => {
  hub.commitFiles({ 'library/recipes/cake/recipe.md': null });
  write(A, 'library/recipes/cake/recipe.md', '---\nname: Cake (A2)\n---\n');
  const report = await run(A);
  assert.equal(report.uploaded, 1);
  assert.equal(report.conflicts[0].kind, 'put-back');
  assert.equal(hub.read('library/recipes/cake/recipe.md'), '---\nname: Cake (A2)\n---\n');
});

test('the branch moving mid-sync is retried and lands on top', async () => {
  write(A, 'library/recipes/pie/recipe.md', '---\nname: Pie\n---\n');
  // Race: as soon as A has fetched the ref, someone else commits.
  const original = hub.commitFiles;
  let raced = false;
  const patched = hub.calls.length;
  const interval = setInterval(() => {
    if (!raced && hub.calls.length > patched && hub.calls.some((c) => c.method === 'POST' && c.path.endsWith('/git/blobs'))) {
      raced = true;
      original({ 'library/recipes/tart/recipe.md': '---\nname: Tart\n---\n' });
    }
  }, 1);
  const report = await run(A);
  clearInterval(interval);
  assert.equal(raced, true);
  assert.equal(report.uploaded, 1);
  assert.equal(report.downloaded, 1, 'the racing commit was picked up on the retry');
  assert.equal(hub.read('library/recipes/pie/recipe.md'), '---\nname: Pie\n---\n');
  assert.equal(hub.read('library/recipes/tart/recipe.md'), '---\nname: Tart\n---\n');
  assert.equal(read(A, 'library/recipes/tart/recipe.md'), '---\nname: Tart\n---\n');
  assert.equal(hub.commits.get(hub.head()).message, `Recipes from ${os.hostname()}: 1 added or changed`);
});

test('the hash cache means unchanged photos are not re-read', async () => {
  const state = JSON.parse(read(A, STATE_FILE));
  const snap = await localSnapshot(A, state.files);
  const entry = snap.get('library/recipes/cake/images/original/cake.jpg');
  assert.equal(entry.sha, state.files['library/recipes/cake/images/original/cake.jpg'].sha);
});

test('errors are sentences: no key, bad key, no internet', async () => {
  await assert.rejects(() => sync({ root: A, token: '', source }), /isn't set up on this computer yet/);
  await assert.rejects(() => sync({ root: A, token: 'github_pat_wrong', source }), /no longer accepts the publishing key/);
  const saved = process.env.RECIPE_STUDIO_GITHUB_API;
  process.env.RECIPE_STUDIO_GITHUB_API = 'http://127.0.0.1:9';
  await assert.rejects(() => sync({ root: A, token: TOKEN, source }), /No internet connection/);
  process.env.RECIPE_STUDIO_GITHUB_API = saved;
});

test('a second call while one runs joins it', async () => {
  const p1 = run(A);
  const p2 = run(A);
  assert.equal(p1, p2);
  await p1;
});
