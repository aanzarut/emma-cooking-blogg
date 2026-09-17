/* One small door to GitHub's REST API, shared by the sync engine, the
   updater, the doctor and the setup wizard. Nothing else in the project
   talks to GitHub directly. */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

/** Where the recipes live. Read from package.json so an update can move it. */
export function repoSource(projectRoot = ROOT) {
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')); } catch { /* fall through */ }
  const source = pkg.updateSource || {};
  return {
    repo: source.repo || 'aanzarut/emma-cooking-blogg',
    branch: source.branch || 'main',
  };
}

/* The test suite points this at a local stand-in. */
export const API_BASE = () => (process.env.RECIPE_STUDIO_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');

export class GitHubError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

let expiry = '';
/** When the publishing key stops working, as GitHub reports it (ISO date or ''). */
export function tokenExpiry() { return expiry; }

const isNetworkError = (err) =>
  /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|terminated|socket|aborted|timed? ?out/i.test(err?.message || '')
  || /AbortError|TimeoutError/.test(err?.name || '');

/**
 * Call the API. Returns parsed JSON, or a Buffer when `raw` is set, or the
 * text when the accept header asks for something that is not JSON.
 * Throws GitHubError for any non-2xx answer; network failures come through
 * as an Error whose .code is 'offline'.
 */
export async function gh(token, method, apiPath, { body, accept, raw = false, timeoutMs = 60000 } = {}) {
  const headers = {
    accept: accept || 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'recipe-studio',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const url = apiPath.startsWith('http') ? apiPath : `${API_BASE()}${apiPath}`;

  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isNetworkError(err)) {
        const offline = new Error('No internet connection. Everything is still saved on this computer — try again later.');
        offline.code = 'offline';
        offline.cause = err;
        throw offline;
      }
      throw err;
    }

    const exp = response.headers.get('github-authentication-token-expiration');
    if (exp) expiry = normaliseExpiry(exp);

    // GitHub asks for a pause when many blobs go up in a row. Do as it says.
    const retryAfter = Number(response.headers.get('retry-after'));
    if ((response.status === 403 || response.status === 429) && retryAfter > 0 && retryAfter <= 120 && attempt < 3) {
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (response.status >= 500 && attempt < 1) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    if (!response.ok) {
      let text = '';
      try { text = await response.text(); } catch { /* ignore */ }
      let message = '';
      try { message = JSON.parse(text).message || ''; } catch { message = text.slice(0, 200); }
      const rateLimited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
      throw new GitHubError(rateLimited ? 429 : response.status, message || `GitHub answered ${response.status}`, text);
    }
    if (raw) return Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || '';
    if (type.includes('json')) return response.json();
    return response.text();
  }
}

/* GitHub writes "2027-09-17 12:00:00 UTC"; keep an ISO string. */
function normaliseExpiry(value) {
  const parsed = new Date(value.replace(' UTC', 'Z').replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Days until the key stops working, or null when unknown. */
export function daysUntilExpiry(iso = expiry) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isNaN(ms) ? null : Math.floor(ms / 86400000);
}

/**
 * Turn an API failure into a sentence the person at the keyboard can act on.
 */
export function explain(err, { repo } = repoSource()) {
  if (err?.code === 'offline') return err.message;
  const status = err?.status;
  if (status === 401) {
    return 'GitHub no longer accepts the publishing key. It has probably expired — run "Set up website publishing" again and paste a new one.';
  }
  if (status === 429) return 'GitHub is asking us to wait. Try again in an hour.';
  if (status === 403) {
    return 'The publishing key is not allowed to write to the recipe store. It needs "Contents: Read and write" for this repository.';
  }
  if (status === 404) {
    return `The recipe store could not be found at github.com/${repo}. Either the key has no access to it, or it was moved.`;
  }
  return err?.message || String(err);
}
