/* The .env file: a plain KEY=value file that stays on this computer.
   It holds the recipe-reading key and the publishing key, and is never
   committed or synced. */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

export const ENV_FILE = path.join(ROOT, '.env');

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Load .env into process.env, never overriding a value already set. */
export function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const values = parse(fs.readFileSync(ENV_FILE, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

/** Read one value straight from the file, without touching process.env. */
export function readEnvValue(name) {
  if (!fs.existsSync(ENV_FILE)) return '';
  return parse(fs.readFileSync(ENV_FILE, 'utf8'))[name] || '';
}

/** The key that lets this computer send recipes to GitHub and fetch them. */
export function githubToken() {
  return (process.env.GITHUB_TOKEN || readEnvValue('GITHUB_TOKEN') || '').trim();
}
