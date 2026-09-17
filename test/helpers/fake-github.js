/* A stand-in for the handful of GitHub git-data endpoints the sync engine
   and updater use, kept in memory. Same sha formula as git, same status
   codes GitHub sends for the cases that matter (empty tree, moved branch). */

import http from 'node:http';
import crypto from 'node:crypto';

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

export function startFakeGitHub({ repo = 'aanzarut/emma-cooking-blogg', branch = 'main', token = 'github_pat_test', push = true, files = {} } = {}) {
  const blobs = new Map();       // sha -> Buffer
  const trees = new Map();       // sha -> Map(path -> blobSha)
  const commits = new Map();     // sha -> { tree, parents, message }
  const refs = new Map();        // branch -> commit sha
  const calls = [];
  let counter = 0;

  const makeTree = (map) => {
    const sha = sha1(`tree ${[...map.entries()].sort().map(([p, s]) => `${p}:${s}`).join('\n')}`);
    trees.set(sha, new Map(map));
    return sha;
  };
  const makeCommit = (tree, parents, message) => {
    const sha = sha1(`commit ${tree} ${parents.join(',')} ${message} ${counter++}`);
    commits.set(sha, { tree, parents, message });
    return sha;
  };

  // Seed.
  const seed = new Map();
  for (const [p, content] of Object.entries(files)) {
    const buf = Buffer.from(content);
    const sha = blobSha(buf);
    blobs.set(sha, buf);
    seed.set(p, sha);
  }
  refs.set(branch, makeCommit(makeTree(seed), [], 'seed'));

  const state = {
    blobs, trees, commits, refs, calls,
    head: () => refs.get(branch),
    tree: () => trees.get(commits.get(refs.get(branch)).tree),
    read: (p) => { const s = state.tree().get(p); return s ? blobs.get(s).toString() : null; },
    /** Simulate the other computer committing through some other means. */
    commitFiles: (changes, message = 'elsewhere') => {
      const map = new Map(state.tree());
      for (const [p, content] of Object.entries(changes)) {
        if (content === null) { map.delete(p); continue; }
        const buf = Buffer.from(content);
        const sha = blobSha(buf);
        blobs.set(sha, buf);
        map.set(p, sha);
      }
      refs.set(branch, makeCommit(makeTree(map), [refs.get(branch)], message));
      return refs.get(branch);
    },
    push,
    tarball: null,          // set to a Buffer to serve /tarball
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    calls.push({ method: req.method, path: p });
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'github-authentication-token-expiration': '2027-09-17 12:00:00 UTC' }); res.end(JSON.stringify(obj)); };

    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${token}`) return json(auth ? 401 : 404, { message: auth ? 'Bad credentials' : 'Not Found' });
    if (!p.startsWith(`/repos/${repo}`)) return json(404, { message: 'Not Found' });
    const rest = p.slice(`/repos/${repo}`.length);

    if (rest === '' && req.method === 'GET') return json(200, { full_name: repo, private: true, permissions: { push: state.push, pull: true } });

    let m;
    if ((m = rest.match(/^\/commits\/([^/]+)$/)) && req.method === 'GET') {
      const sha = refs.get(m[1]) || (commits.has(m[1]) ? m[1] : null);
      if (!sha) return json(404, { message: 'Not Found' });
      if ((req.headers.accept || '').includes('sha')) { res.writeHead(200, { 'content-type': 'application/vnd.github.sha' }); return res.end(sha); }
      return json(200, { sha });
    }
    if ((m = rest.match(/^\/tarball\/(.+)$/)) && req.method === 'GET') {
      if (!state.tarball) return json(404, { message: 'Not Found' });
      res.writeHead(200, { 'content-type': 'application/gzip' }); return res.end(state.tarball);
    }
    if ((m = rest.match(/^\/git\/ref\/heads\/(.+)$/)) && req.method === 'GET') {
      if (!refs.has(m[1])) return json(404, { message: 'Not Found' });
      return json(200, { ref: `refs/heads/${m[1]}`, object: { type: 'commit', sha: refs.get(m[1]) } });
    }
    if ((m = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method === 'PATCH') {
      const current = refs.get(m[1]);
      const commit = commits.get(body.sha);
      if (!commit) return json(422, { message: 'Object does not exist' });
      if (!body.force && commit.parents[0] !== current) return json(422, { message: 'Update is not a fast forward' });
      refs.set(m[1], body.sha);
      return json(200, { object: { sha: body.sha } });
    }
    if ((m = rest.match(/^\/git\/commits\/([0-9a-f]+)$/)) && req.method === 'GET') {
      const c = commits.get(m[1]);
      if (!c) return json(404, { message: 'Not Found' });
      return json(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message });
    }
    if (rest === '/git/commits' && req.method === 'POST') {
      if (!trees.has(body.tree)) return json(422, { message: 'Tree SHA does not exist' });
      const sha = makeCommit(body.tree, body.parents, body.message);
      return json(201, { sha, tree: { sha: body.tree } });
    }
    if ((m = rest.match(/^\/git\/trees\/([0-9a-f]+)$/)) && req.method === 'GET') {
      const t = trees.get(m[1]);
      if (!t) return json(404, { message: 'Not Found' });
      return json(200, {
        sha: m[1], truncated: false,
        tree: [...t.entries()].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha, size: blobs.get(sha).length })),
      });
    }
    if (rest === '/git/trees' && req.method === 'POST') {
      if (!Array.isArray(body.tree) || !body.tree.length) return json(422, { message: 'Invalid request. "tree" wasn\'t supplied.' });
      const base = body.base_tree ? trees.get(body.base_tree) : new Map();
      if (body.base_tree && !base) return json(404, { message: 'Not Found' });
      const map = new Map(base);
      for (const e of body.tree) {
        if (e.sha === null) map.delete(e.path);
        else { if (!blobs.has(e.sha)) return json(422, { message: `Blob ${e.sha} does not exist` }); map.set(e.path, e.sha); }
      }
      return json(201, { sha: makeTree(map) });
    }
    if ((m = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/)) && req.method === 'GET') {
      const buf = blobs.get(m[1]);
      if (!buf) return json(404, { message: 'Not Found' });
      if ((req.headers.accept || '').includes('raw')) { res.writeHead(200, { 'content-type': 'application/vnd.github.raw' }); return res.end(buf); }
      return json(200, { sha: m[1], content: buf.toString('base64'), encoding: 'base64' });
    }
    if (rest === '/git/blobs' && req.method === 'POST') {
      if (!state.push) return json(403, { message: 'Resource not accessible by personal access token' });
      const buf = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8');
      const sha = blobSha(buf);
      blobs.set(sha, buf);
      return json(201, { sha });
    }
    return json(404, { message: `No route ${req.method} ${p}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      state.url = `http://127.0.0.1:${server.address().port}`;
      state.close = () => new Promise((r) => server.close(r));
      resolve(state);
    });
  });
}
