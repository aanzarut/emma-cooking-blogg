/* Sets up the key that lets this computer put the website online.
   Run with:  npm run publish-setup   (or double-click "Set up website publishing.bat")

   The recipes live in a private store on GitHub. "Put the website online" in
   the Studio sends new and changed recipes there, brings back what the other
   computer added, and the website rebuilds itself. All of that needs one key,
   made once on GitHub and pasted here. It is checked before it is saved. */

import { ENV_FILE } from '../studio/lib/env.js';
import { repoSource, explain, tokenExpiry, daysUntilExpiry, GitHubError } from '../studio/lib/github.js';
import { checkAccess } from '../studio/lib/sync.js';
import { say, mask, ask, clearScreen, currentEnvValue, writeEnvValue, finish } from './wizard.js';

// Run from first-time setup, where skipping is a normal choice, not a failure.
const OPTIONAL = process.argv.includes('--optional');
const { repo, branch } = repoSource();

const title = () => {
  say();
  say('  Website publishing - setup');
  say('  --------------------------');
  say();
};

const niceDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

async function main() {
  title();
  say('  This lets the Studio put the website online from this computer, and');
  say('  keeps its recipes in step with the other computer. Everything else');
  say('  works without it.');
  if (OPTIONAL) {
    say();
    say('  You can do this now, or later by double-clicking "Set up website publishing".');
    say('  To do it later, just press Enter when asked for the key.');
  }
  say();

  const current = currentEnvValue('GITHUB_TOKEN');
  if (current) {
    say(`  There is already a publishing key set up:  ${mask(current)}`);
    const replace = await ask('  Replace it? (y/N) ');
    say();
    if (!/^y(es)?$/i.test(replace)) {
      say('  Left as it was. Nothing changed.');
      say();
      return;
    }
  }

  say('  The key is made on GitHub, signed in as the account that owns the');
  say(`  recipe store (github.com/${repo}):`);
  say();
  say('  1. Go to  https://github.com/settings/personal-access-tokens/new');
  say('  2. Token name:  Recipe Studio on this computer');
  say('     Expiration:  choose the longest offered (a year). The Studio will');
  say('                  remind you a month before it runs out.');
  say('  3. Repository access:  "Only select repositories", then pick');
  say(`     ${repo.split('/')[1]}`);
  say('  4. Permissions -> Repository permissions -> Contents: "Read and write".');
  say('     Leave everything else as it is.');
  say('  5. Press "Generate token", copy it, come back here and paste it below.');
  say();
  say('     Right-click pastes into this window. The window is cleared as soon');
  say('     as you press Enter, so the key is not left on screen.');
  say();

  const key = await ask('  Paste the key, then press Enter: ');
  clearScreen();
  title();

  if (!key) {
    if (OPTIONAL) {
      say('  Skipped for now. Double-click "Set up website publishing" whenever you');
      say('  are ready - everything else works in the meantime.');
      say();
      return;
    }
    say('  Nothing pasted, so nothing was changed. Run this again when ready.');
    say();
    process.exitCode = 1;
    return;
  }
  if (!/^(github_pat_|ghp_)\S{20,}$/.test(key)) {
    say('  That does not look like a GitHub key - they begin "github_pat_".');
    say('  Nothing was changed. Copy the whole key and run this again.');
    say();
    process.exitCode = 1;
    return;
  }

  say('  Checking the key with GitHub...');
  try {
    if (!process.env.RECIPE_STUDIO_SKIP_TOKEN_CHECK) await checkAccess(key, { repo, branch });
  } catch (err) {
    say();
    if (err instanceof GitHubError && err.status === 404) {
      say(`  The key works, but it cannot see github.com/${repo}.`);
      say('  In step 3, make sure that repository is one of the selected ones,');
      say('  and that the key was made by the account that owns it.');
    } else if (err?.status === 403) {
      say('  The key can read the recipe store but not write to it.');
      say('  In step 4, set Contents to "Read and write".');
    } else if (err instanceof GitHubError && err.status === 401) {
      say('  GitHub rejected that key. It may have been copied incompletely.');
      say('  Nothing was changed - try again.');
    } else if (err?.code === 'offline') {
      say('  Could not reach GitHub to check the key. Check the internet');
      say('  connection. Nothing was changed.');
    } else {
      say(`  The check failed: ${explain(err, { repo })}`);
      say('  Nothing was changed.');
    }
    say();
    process.exitCode = 1;
    return;
  }

  writeEnvValue('GITHUB_TOKEN', key, '# Lets the Studio put the website online and share recipes with the other computer.');
  say('  The key works.');
  say();
  say(`  Saved to:  ${ENV_FILE}`);
  say(`  Key:       ${mask(key)}`);
  const expires = tokenExpiry();
  if (expires) {
    const days = daysUntilExpiry(expires);
    say(`  Expires:   ${niceDate(expires)}${days !== null ? ` (in ${days} days)` : ''}`);
  }
  say();
  say('  That file stays on this computer and is never uploaded anywhere.');
  say();
  say('  Start the Studio from the desktop icon, go to Publish, and press');
  say('  "Put the website online".');
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
