# Setting this up on the PC

One-time, about fifteen minutes. You need a terminal for this part; Emma
never will.

## 1. Install Node.js

Download the **LTS** version from <https://nodejs.org> and run the installer,
accepting the defaults. This is the engine the Studio runs on.

Check it worked — open **Command Prompt** and run:

```
node --version
```

You should see `v20.something` or higher.

## 2. Get the project onto the PC

If Git is installed:

```
git clone https://github.com/aanzarut/emma-cooking-blogg.git
cd emma-cooking-blogg
npm install
```

If Git isn't installed, download the repository as a ZIP from GitHub, unzip it,
open Command Prompt in that folder, and run `npm install`.

**Keep the folder path short — this matters.** Put it at
`C:\Users\<name>\Documents\emma-cooking-blogg` and rename the folder to
exactly that if the download gave it a longer name. Windows refuses to write
any file whose full path exceeds 260 characters. A ZIP downloaded from a branch
carries a ~57-character folder name, and Explorer's *Extract All* nests it
inside another folder of the same name — enough on its own to push the Studio's
internal files past the limit. When that happens, **photo previews in the Inbox
fail** with nothing on screen to say why. `npm run doctor` measures this and
warns before it bites.

`npm install` takes a couple of minutes the first time — it fetches the photo
processing library, which includes compiled Windows binaries.

## 3. Switch on recipe reading

This is what turns a photo of a recipe card into filled-in ingredients and
method. Without it everything still works; she just types more.

1. Go to <https://console.anthropic.com>, create an account, and add a small
   amount of credit.
2. Create an API key and copy it.
3. In the project folder, copy `.env.example` to a new file named `.env`.
4. Paste the key in:

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is listed in `.gitignore`, so the key never leaves the computer and is
never committed.

**Cost.** Each recipe card costs roughly one to three cents to read, depending
on how much is written on it. Several hundred cards is a few dollars, one time.
If you'd rather trade some accuracy for a lower bill, set
`RECIPE_MODEL=claude-sonnet-5` in `.env` — good on clean printed cards,
less reliable on difficult handwriting.

## 4. Check everything

```
npm run doctor
```

Every line should have a tick, except "Recipe reading configured" if you
skipped step 3.

## 5. Put the icon on her desktop

In the project folder, double-click **`Install desktop icon.bat`**.

That creates a *Recipe Studio* shortcut on the desktop with its own icon — a
steaming bowl, so it doesn't look like a script. It finds the desktop even if
OneDrive has moved it. Run it once; run it again any time the project folder
moves.

Double-clicking the icon starts the Studio and opens the browser by itself,
on whatever port is configured. It also runs `npm install` on its own if the
packages are ever missing. A small black window stays open showing the
address to use from a phone — **closing that window stops the Studio.**

If PowerShell is blocked by policy on this PC, make the shortcut by hand
instead: right-click `start-studio.bat` → **Send to** → **Desktop (create
shortcut)**, then right-click the new shortcut → **Properties** → **Change
Icon** → browse to `assets\recipe-studio.ico`.

To change the icon later, edit `assets/icon.svg`, run `npm run icon`, and
double-click `Install desktop icon.bat` again.

## 6. Let the phones reach it

The upload page works over the local wifi. The first time she uses it, Windows
Defender Firewall will ask whether to allow Node.js — tick **Private
networks** and allow it. Without this, phones on the same wifi can't connect.

If the phone still can't reach it, check that the PC and phone are on the same
network (not one on wifi and one on cellular), and that the wifi isn't a
"guest" network with client isolation turned on.

## Updating later

Double-click **`Update.bat`**. That is the whole procedure.

It fetches the latest version, replaces the program files, and leaves recipes,
photos, `.env` and any settings you have edited exactly as they were. If a
config file has changed upstream, yours is kept and the new one is saved beside
it as `*.new`.

If the project folder is too deeply nested for Windows, the updater installs a
fresh copy at `Documents\emma-cooking-blogg`, copies the library across,
verifies every file arrived, and re-points the desktop icon. **It never deletes
anything** — it prints where the old folder is so you can remove it yourself
once the Studio starts cleanly from the icon.

It refuses to run while the Studio is open, and a failed or interrupted
download leaves the installation untouched.

The Studio checks for a new version once when it starts and, if there is one,
shows a quiet line in the sidebar. The check is a single conditional request
that transfers nothing when there is no update, and it is silent when there is
no internet.

**After the pull request is merged**, change `updateSource.branch` in
`package.json` from the feature branch to `main`. The updater reads that from
the copy it installs, so the switch reaches every PC on its next update.

## Commands

| Command | What it does |
|---|---|
| `npm run studio` | Start the Studio (same as the .bat file) |
| `npm run build` | Build the website into `dist/` |
| `npm run preview` | Serve the built website on its own at <http://localhost:4322> |
| `npm run doctor` | Check the installation (or double-click `Check for problems.bat`) |
| `npm run icon` | Rebuild the desktop icon from `assets/icon.svg` |
| `npm run update` | Fetch and install the latest version (or double-click `Update.bat`) |

## Changing the dropdown lists

`config/taxonomy.json` holds the food types, cuisines, units and suggested
tags. Edit it and restart the Studio. `config/site.json` holds the website's
name, tagline and address.

## If something breaks

**"Port 4321 is already in use"** — something else is on that port. Add
`PORT=4400` to `.env` and restart. The Studio also uses the next port up
(4322 by default) to serve the website preview.

**Photos won't upload from the phone** — see step 6.

**Photos in the Inbox are broken or blank** — almost always the folder path is
too long; see step 2. Double-click `Check for problems.bat`, which reports the
path length and whether thumbnails can actually be written. Move the project to
`Documents\emma-cooking-blogg` and restart the Studio.

**HEIC photos look broken** — iPhones shoot HEIC; the Studio converts them to
JPEG on arrival and files the camera original away in
`library/inbox/.heic-originals/`, so only the JPEG ever appears in the Inbox.
If a conversion fails outright, the phone's upload page says so; setting the
iPhone's *Settings → Camera → Formats* to **Most Compatible** avoids HEIC
altogether.

**A recipe disappeared** — nothing is deleted outright. Look in
`library/.trash/` (recipes) and `library/inbox/.discarded/` (photos).
