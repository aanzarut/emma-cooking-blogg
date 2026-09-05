/* Sets up the key that lets the Studio read photographed recipe cards.
   Run with:  npm run key   (or double-click "Set up recipe reading.bat")

   This exists because creating a file called ".env" by hand on Windows is
   genuinely awkward — Notepad appends .txt and Explorer hides extensions —
   and because a mistyped key otherwise fails silently weeks later. */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../studio/lib/paths.js';

const ENV_FILE = path.join(ROOT, '.env');
const say = (line = '') => console.log(line);

/** Show enough of a key to recognise it, never enough to leak it. */
const mask = (key) => `${key.slice(0, 11)}...${key.slice(-4)}  (${key.length} characters)`;

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
}

/** Replace the key line if there is one, otherwise add it; keep everything else. */
function writeKey(key) {
  const lines = readEnv();
  const at = lines.findIndex((line) => /^\s*ANTHROPIC_API_KEY\s*=/.test(line));
  if (at >= 0) {
    lines[at] = `ANTHROPIC_API_KEY=${key}`;
  } else {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('# Lets the Studio read photographed recipe cards.');
    lines.push(`ANTHROPIC_API_KEY=${key}`);
  }
  fs.writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, {
    encoding: 'utf8',
    mode: 0o600,        // owner-only, where the operating system honours it
  });
}

/**
 * Prove the key works before saving it, so a typo surfaces now rather than
 * weeks later in the middle of filing recipes.
 *
 * The smallest possible message rather than the models endpoint, because the
 * SDK version this project pins does not have client.models. One token in,
 * one out, against the model that will actually do the reading — so this also
 * catches a model name the account cannot use. It costs a fraction of a penny.
 */
async function keyWorks(key) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });
  await client.messages.create({
    model: process.env.RECIPE_MODEL || 'claude-opus-5',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
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

function ask(question) {
  process.stdout.write(question);
  if (ready.length) return Promise.resolve(ready.shift().trim());
  return new Promise((resolve) => waiting.push((line) => resolve(line.trim())));
}

/** Wipe the window so a pasted key is not left sitting on screen. */
function clearScreen() {
  if (process.stdout.isTTY) process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
}

// Run from first-time setup, where skipping is a normal choice, not a failure.
const OPTIONAL = process.argv.includes('--optional');

async function main() {
  say();
  say('  Recipe reading - setup');
  say('  ----------------------');
  say();
  say('  This lets the Studio read a photographed recipe card and fill in the');
  say('  ingredients and method for you. Everything else works without it.');
  if (OPTIONAL) {
    say();
    say('  You can do this now, or later by double-clicking "Set up recipe reading".');
    say('  To do it later, just press Enter when asked for the key.');
  }
  say();

  const existing = readEnv().find((line) => /^\s*ANTHROPIC_API_KEY\s*=\s*\S/.test(line));
  if (existing) {
    const current = existing.split('=').slice(1).join('=').trim();
    say(`  There is already a key set up:  ${mask(current)}`);
    const replace = await ask('  Replace it? (y/N) ');
    say();
    if (!/^y(es)?$/i.test(replace)) {
      say('  Left as it was. Nothing changed.');
      say();
      return;
    }
  }

  say('  1. Go to  https://console.anthropic.com');
  say('  2. Sign in, then open  Settings -> API keys  and create a key.');
  say('  3. Copy it, come back here, and paste it below.');
  say();
  say('     Right-click pastes into this window. The window is cleared as soon');
  say('     as you press Enter, so the key is not left on screen.');
  say();

  const key = await ask('  Paste the key, then press Enter: ');
  clearScreen();
  say();
  say('  Recipe reading - setup');
  say('  ----------------------');
  say();

  if (!key) {
    if (OPTIONAL) {
      say('  Skipped for now. Double-click "Set up recipe reading" whenever you');
      say('  are ready - everything else works in the meantime.');
      say();
      return;
    }
    say('  Nothing pasted, so nothing was changed. Run this again when ready.');
    say();
    process.exitCode = 1;
    return;
  }
  if (!/^sk-ant-\S{20,}$/.test(key)) {
    say('  That does not look like an Anthropic key - they begin "sk-ant-".');
    say('  Nothing was changed. Copy the whole key and run this again.');
    say();
    process.exitCode = 1;
    return;
  }

  say('  Checking the key with Anthropic...');
  try {
    if (!process.env.RECIPE_STUDIO_SKIP_KEY_CHECK) await keyWorks(key);
  } catch (err) {
    const status = err?.status;
    say();
    if (status === 401 || status === 403) {
      say('  Anthropic rejected that key. It may have been copied incompletely,');
      say('  or deleted from the console. Nothing was changed - try again.');
    } else if (err?.name === 'APIConnectionError' || /fetch failed|ENOTFOUND|EAI_AGAIN/i.test(err?.message || '')) {
      say('  Could not reach Anthropic to check the key. Check the internet');
      say('  connection. Nothing was changed.');
    } else if (status === 404 || /model/i.test(err?.message || '')) {
      say('  The key works, but the model named in .env was refused:');
      say(`    ${err?.message || err}`);
      say('  Set RECIPE_MODEL in .env to a model the account can use.');
    } else {
      say(`  The check failed: ${err?.message || err}`);
      say('  Nothing was changed.');
    }
    say();
    process.exitCode = 1;
    return;
  }

  writeKey(key);
  say('  The key works.');
  say();
  say(`  Saved to:  ${ENV_FILE}`);
  say(`  Key:       ${mask(key)}`);
  say();
  say('  That file stays on this computer and is never uploaded to GitHub.');
  say();
  say('  Start the Studio from the desktop icon, open a recipe that has a photo');
  say('  of its card, and press "Read the recipe card" at the top.');
  say();
  say('  Reading a card costs roughly one to three cents. A working key is not');
  say('  the same as having credit - if the console says the balance is zero,');
  say('  add a small amount there.');
  say();
}

main()
  .catch((err) => {
    say();
    say(`  Something went wrong: ${err.message}`);
    say('  Nothing was changed.');
    say();
    process.exitCode = 1;
  })
  .finally(() => process.stdin.pause());
