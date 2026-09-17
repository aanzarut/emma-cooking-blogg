# Putting the site online

## How it works

```
 Emma's PC ──┐                                       ┌── the MacBook
  Studio     │  "Put the website online"             │  Studio
  library/   ├──────────► GitHub (private) ◄─────────┤  library/
             │            aanzarut/emma-cooking-blogg │
             │                    │ every push to main
             │                    ▼
             │            GitHub Actions: npm run build
             │                    │
             │                    ▼
             └─────────  Cloudflare Pages ──► https://<the domain>
```

- The recipes and photos live in a **private GitHub repository**. It is the
  shared copy and the backup.
- Each computer runs the Studio. **Put the website online** (on the Publish
  screen) sends that computer's new and changed recipes to GitHub and brings
  back whatever the other computer sent. No Git is installed anywhere; the
  Studio talks to GitHub directly with a key that lives in `.env`.
- Every push rebuilds the website with GitHub Actions and puts the result on
  **Cloudflare Pages**, which serves it at the domain. Two or three minutes
  from button to live.
- The Studio also checks GitHub quietly when it starts, and brings in anything
  the other computer sent. It never sends anything, and never writes over
  something edited on this computer, until the button is pressed.

The site itself is a folder of plain HTML (`dist/`), so none of this locks
you to Cloudflare; any static host would do.

## One-time setup, by the owner

### 1. The recipe store

The repository `aanzarut/emma-cooking-blogg` on GitHub. Keep it **private**
(Settings → General → Danger Zone → Change visibility): the photographed
recipe cards are committed to it, and only the finished website is meant to
be public. See *Order of operations* below before switching it.

### 2. Cloudflare Pages

1. Make a Cloudflare account at <https://dash.cloudflare.com> (free).
2. **Workers & Pages → Create → Pages → Upload assets** (not "connect to
   Git" — the build runs on GitHub, Cloudflare only hosts). Project name:
   **`emmas-kitchen`**. Upload anything for now, even an empty folder; the
   first real push replaces it. The name must match `--project-name` in
   `.github/workflows/publish.yml`.
3. Note the **Account ID** from the dashboard's overview page (right-hand
   column).
4. **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**
   template, or a custom token with the permission *Account → Cloudflare
   Pages → Edit*. Copy the token.
5. On GitHub: **Settings → Secrets and variables → Actions → New repository
   secret**, twice:
   - `CLOUDFLARE_API_TOKEN` — the token from step 4
   - `CLOUDFLARE_ACCOUNT_ID` — the ID from step 3
6. **Actions → Publish website → Run workflow** once by hand. A couple of
   minutes later the site is at `https://emmas-kitchen.pages.dev`.

### 3. The domain

Buy one anywhere (Cloudflare Registrar is the least fuss, as the DNS is then
already in the right place; Namecheap or Porkbun work too, roughly $12/year).

1. In the Pages project: **Custom domains → Set up a custom domain** and
   enter it. If the domain is at Cloudflare it is wired up automatically;
   otherwise Cloudflare shows the one CNAME record to add at the registrar.
2. Put the address in `config/site.json` as `"url": "https://emmaskitchen.com"`
   (it is used for the sitemap). `customDomain` is no longer needed and can
   be left empty.
3. Press *Put the website online* from either computer.

HTTPS is automatic. The `.pages.dev` address keeps working alongside.

## The publishing key, on each computer

Each computer that will press the button needs its own key. Made once, on
GitHub, signed in as the account that owns the repository:

1. <https://github.com/settings/personal-access-tokens/new>
2. **Token name**: *Recipe Studio on Emma's PC* (or *on the MacBook*).
   **Expiration**: the longest offered, a year.
3. **Repository access**: *Only select repositories* →
   `emma-cooking-blogg`.
4. **Permissions → Repository permissions → Contents**: *Read and write*.
   Nothing else.
5. **Generate token**, copy it.
6. On that computer, double-click **`Set up website publishing`** in the
   Studio folder (Mac: `mac-linux/set-up-publishing.sh`) and paste it. The
   key is checked against GitHub before it is saved, so a partial copy or a
   read-only key is caught now rather than a month later. It goes into
   `.env`, which never leaves the computer.

`Set up on this PC` and `set-up.sh` ask for this key during first-time setup,
right after the recipe-reading key, so on a new computer it is one step.

**When the key runs out.** Fine-grained keys last at most a year. From a month
before, the Studio's sidebar and *Check for problems* say so; after it
expires, the button says "GitHub no longer accepts the publishing key". Make
a new one exactly as above and run the setup launcher again. Nothing else
changes, and nothing is lost in between — recipes are still saved locally.

## Every time after that

Work in the Studio as usual. When something should go online, go to
**Publish**:

1. **Build the website** and open the preview, to look at it. Optional.
2. **Put the website online.** The panel says what happened, in sentences:

   - *N files came in from the other computer.* — the other computer's work
     is now here too.
   - *N files sent to GitHub. The website will update itself in a few
     minutes.* — done.
   - *Nothing new to send.* — everything was already there.
   - *In "lemon-cake", recipe.md was changed on both computers. The other
     computer's version is in use; yours was set aside.* — see below.

Only recipes marked *Ready* or *Published* appear on the website; drafts are
sent to GitHub (so they are backed up and reach the other computer) but stay
off the site.

## Working on two computers

The same recipe can be edited on both computers, and it is all fine as long as
each presses the button now and then. What the sync does, every time:

- A file changed only on one side goes to the other side.
- A file **removed** on one side, untouched on the other: it is removed there
  too — but moved to `library/.recovered/<date> deleted on the other
  computer/`, never deleted.
- A file changed on **both** sides since they were last in step: the version
  on GitHub (the other computer's) is used, and this computer's version is
  copied to `library/.recovered/<date> changed on both computers/` before
  being replaced. The panel names the recipe. Open both, decide, fix, press
  the button again. Nobody's work is overwritten without a copy being kept.
- A file removed on one side but changed on the other: the changed version
  wins and comes back.

Nothing in `library/.recovered`, `.trash` or `.cache` is ever sent to GitHub.
`.sync-state.json` in the project folder is the Studio's memory of the last
sync; deleting it is harmless, the next sync simply re-checks every file.

## If you work with git yourself

A `git clone` of the repository works as a Studio folder too. Two things to
know:

- After the Studio's button pushes from that folder, the working tree matches
  `origin/main` but `HEAD` does not. Run `git checkout -- library config &&
  git pull` — those files are byte-identical to what was just pushed, so
  nothing is lost.
- Committing recipes with git and pushing, then pressing the button, is fine:
  the sync sees identical bytes on both sides and does nothing.

`Update.bat` refuses to run in a git checkout with uncommitted changes, as
before.

## Other hosts

The build output is static, so all of these work with no code changes:

- **Netlify / Vercel** — connect the repo, build command `npm run build`,
  publish directory `dist`. Both offer password protection on cheap tiers,
  useful if the site should stay private for a while.
- **Any web host** — run `npm run build` and upload the contents of `dist/`
  over FTP. No Node.js needed on the server.

## Backups

The recipes and photos live in `library/`, and photos are committed to git, so
pressing the button *is* a backup — and the other computer holds a full copy
too. For a third copy, occasionally copy the `library` folder to an external
drive; that folder alone is the whole archive.

One exception: `library/inbox/.heic-originals/` — the untouched iPhone files
kept after conversion — is deliberately left out of git, because a few hundred
of them would add a gigabyte to the repository for files nothing can open. Only
the external-drive copy covers those. Everything the Studio and the website
actually use is committed.

## Order of operations, the first time

Do these in this order, because the last one closes the door behind it:

1. Merge the code to `main`.
2. On each computer: **Update**, then **Set up website publishing** with that
   computer's key, then **Check for problems** shows *Website publishing
   configured ✓*. (While the repository is still public, Update works without
   a key; afterwards it needs one.)
3. Press **Put the website online** on the PC first, so its library goes up,
   then on the Mac, so it comes down.
4. Cloudflare Pages: project, token, the two secrets, one manual run.
5. Now make the repository **private**.
6. The domain, whenever it is bought.
