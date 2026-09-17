/* Sets up the key that lets the Studio read photographed recipe cards.
   Run with:  npm run key   (or double-click "Set up recipe reading.bat")

   This exists because creating a file called ".env" by hand on Windows is
   genuinely awkward — Notepad appends .txt and Explorer hides extensions —
   and because a mistyped key otherwise fails silently weeks later. */

import { ENV_FILE } from '../studio/lib/env.js';
import { say, mask, ask, clearScreen, currentEnvValue, writeEnvValue, finish } from './wizard.js';

const writeKey = (key) => writeEnvValue('ANTHROPIC_API_KEY', key, '# Lets the Studio read photographed recipe cards.');

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

  const current = currentEnvValue('ANTHROPIC_API_KEY');
  if (current) {
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
  .finally(finish);
