/* The bits the two key-setup scripts share: a plain line reader, a careful
   .env writer, and a way to wipe a pasted secret off the screen. */

import fs from 'node:fs';
import { ENV_FILE } from '../studio/lib/env.js';

export const say = (line = '') => console.log(line);

/** Show enough of a key to recognise it, never enough to leak it. */
export const mask = (key) => `${key.slice(0, 11)}...${key.slice(-4)}  (${key.length} characters)`;

export function readEnvLines() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
}

/** The current value of one setting in .env, or ''. */
export function currentEnvValue(name) {
  const line = readEnvLines().find((l) => new RegExp(`^\\s*${name}\\s*=\\s*\\S`).test(l));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

/** Replace the setting's line if there is one, otherwise add it; keep everything else. */
export function writeEnvValue(name, value, comment) {
  const lines = readEnvLines();
  const at = lines.findIndex((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
  if (at >= 0) {
    lines[at] = `${name}=${value}`;
  } else {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    if (comment) lines.push(comment);
    lines.push(`${name}=${value}`);
  }
  fs.writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, {
    encoding: 'utf8',
    mode: 0o600,        // owner-only, where the operating system honours it
  });
}

/* A plain line reader rather than readline.
   Two readline prompts in a row lose whatever the first has already buffered,
   which silently ate the pasted key; and readline's terminal handling differs
   between a console window and a pipe, which makes it hard to be sure of. This
   behaves the same either way. */
let buffer = '';
const ready = [];      // lines that arrived before anything asked for them
const waiting = [];    // askers with no line yet

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let cut;
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).replace(/\r$/, '');
    buffer = buffer.slice(cut + 1);
    // Hold onto anything nobody is waiting for yet: a paste can deliver every
    // line in one chunk, well before the second question is asked.
    if (waiting.length) waiting.shift()(line);
    else ready.push(line);
  }
});
process.stdin.on('end', () => { while (waiting.length) waiting.shift()(''); });

export function ask(question) {
  process.stdout.write(question);
  if (ready.length) return Promise.resolve(ready.shift().trim());
  return new Promise((resolve) => waiting.push((line) => resolve(line.trim())));
}

/** Wipe the window so a pasted key is not left sitting on screen. */
export function clearScreen() {
  if (process.stdout.isTTY) process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
}

export const finish = () => process.stdin.pause();
