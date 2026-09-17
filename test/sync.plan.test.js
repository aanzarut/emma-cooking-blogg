import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, isSynced, blobSha, summarize } from '../studio/lib/sync.js';

const one = (local, base, remote) => {
  const actions = plan(
    local === undefined ? {} : { 'library/recipes/x/recipe.md': { sha: local } },
    base === undefined ? {} : { 'library/recipes/x/recipe.md': { sha: base } },
    new Map(remote === undefined ? [] : [['library/recipes/x/recipe.md', remote]])
  );
  assert.equal(actions.length, local === undefined && base === undefined && remote === undefined ? 0 : 1);
  return actions[0];
};

test('row 1: unchanged everywhere is kept and pull-safe', () => {
  assert.deepEqual(one('a', 'a', 'a'), { path: 'library/recipes/x/recipe.md', action: 'keep', pullSafe: true });
});

test('row 2: changed only on GitHub is downloaded', () => {
  const a = one('a', 'a', 'b');
  assert.equal(a.action, 'download'); assert.equal(a.sha, 'b'); assert.equal(a.pullSafe, true);
});

test('row 3: removed on GitHub, untouched here, is set aside (never deleted)', () => {
  const a = one('a', 'a', undefined);
  assert.equal(a.action, 'set-aside-deleted'); assert.equal(a.pullSafe, true);
});

test('row 4: removed here, untouched on GitHub, is removed there — only on a full sync', () => {
  const a = one(undefined, 'a', 'a');
  assert.equal(a.action, 'delete-remote'); assert.equal(a.pullSafe, false);
});

test('row 5: gone on both sides is forgotten', () => {
  assert.equal(one(undefined, 'a', undefined).action, 'forget');
});

test('row 6: removed here but changed on GitHub comes back, and says so', () => {
  const a = one(undefined, 'a', 'b');
  assert.equal(a.action, 'download'); assert.equal(a.pullSafe, false); assert.match(a.note, /came back/);
});

test('row 7: changed or new here is uploaded', () => {
  assert.equal(one('b', 'a', 'a').action, 'upload');
  assert.equal(one('b', undefined, undefined).action, 'upload');
  assert.equal(one('b', 'a', 'a').pullSafe, false);
});

test('row 8: removed on GitHub but changed here is put back', () => {
  const a = one('b', 'a', undefined);
  assert.equal(a.action, 'upload'); assert.match(a.note, /put back/);
});

test('row 9: same new bytes on both sides is simply recorded', () => {
  assert.equal(one('b', 'a', 'b').action, 'record');
  assert.equal(one('b', undefined, 'b').action, 'record');
});

test('row 10: different changes on both sides is a conflict; GitHub wins, local set aside', () => {
  const a = one('b', 'a', 'c');
  assert.equal(a.action, 'conflict'); assert.equal(a.sha, 'c'); assert.equal(a.pullSafe, false);
});

test('first sync has no base: identical files cost nothing, differing ones conflict, new ones upload', () => {
  const actions = plan(
    { 'config/site.json': { sha: 's' }, 'library/recipes/a/recipe.md': { sha: 'local' }, 'library/recipes/b/recipe.md': { sha: 'new' } },
    {},
    new Map([['config/site.json', 's'], ['library/recipes/a/recipe.md', 'remote'], ['library/recipes/c/recipe.md', 'only-there']])
  );
  const byPath = Object.fromEntries(actions.map((a) => [a.path, a.action]));
  assert.deepEqual(byPath, {
    'config/site.json': 'record',
    'library/recipes/a/recipe.md': 'conflict',
    'library/recipes/b/recipe.md': 'upload',
    'library/recipes/c/recipe.md': 'download',
  });
});

test('isSynced mirrors .gitignore', () => {
  for (const ok of ['library/recipes/x/recipe.md', 'library/recipes/x/images/original/a.jpg', 'library/inbox/2026-01-01 a.jpg', 'library/backgrounds/mine.jpg', 'config/site.json']) {
    assert.equal(isSynced(ok), true, ok);
  }
  for (const no of ['library/.cache/x', 'library/.trash/x/recipe.md', 'library/.recovered/a/b', 'library/inbox/.discarded/a.jpg',
    'library/inbox/.heic-originals/a.heic', 'library/recipes/.gitkeep', 'library/README.md', 'config/site.json.new', 'config/sub/x.json',
    'config/.env', 'library/recipes/x/Thumbs.db', 'library/recipes/x/a.jpg.part', '.env', 'studio/server.js', 'library/recipes']) {
    assert.equal(isSynced(no), false, no);
  }
});

test('blobSha matches git', () => {
  // `printf 'hello\n' | git hash-object --stdin` → ce013625030ba8dba906f756967f9e9ca394464a
  assert.equal(blobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('summary speaks plainly', () => {
  assert.deepEqual(summarize({ mode: 'full', downloaded: 0, uploaded: 0, removedRemotely: 0, pending: 0, setAside: [], conflicts: [] }),
    ['Nothing new to send. The website already has everything.']);
  const lines = summarize({ mode: 'full', downloaded: 2, uploaded: 3, removedRemotely: 1, pending: 0,
    setAside: [{ path: 'library/recipes/a/recipe.md', kind: 'deleted', folder: 'library/.recovered/2026-01-01 10.00 deleted on the other computer' }],
    conflicts: [{ path: 'library/recipes/lemon-cake/recipe.md', kind: 'both-changed', note: 'was changed on both computers' }] });
  assert.equal(lines[0], '2 files came in from the other computer.');
  assert.equal(lines[1], '3 files sent to GitHub, 1 file removed there. The website will update itself in a few minutes.');
  assert.match(lines[2], /^In "lemon-cake", recipe.md was changed/);
  assert.match(lines[3], /kept in library\/\.recovered\/2026-01-01 10\.00 deleted on the other computer\.$/);
  assert.deepEqual(summarize({ mode: 'pull', downloaded: 0, uploaded: 0, removedRemotely: 0, pending: 2, setAside: [], conflicts: [] }),
    ['2 changes on this computer are waiting for "Put the website online".']);
});
