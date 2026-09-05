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

1. Download the ZIP:
   <https://github.com/aanzarut/emma-cooking-blogg/archive/refs/heads/claude/cooking-blog-asset-system-a4jxrn.zip>
2. In Downloads, right-click it → **Properties** → tick **Unblock** if it is
   offered → **OK**. Then right-click → **Extract All** → **Extract**.
3. Open the extracted folder (keep going in until you see a lot of files) and
   double-click **`Set up on this PC`**. Windows may show a blue "protected your
   PC" box: **More info** → **Run anyway**.

That one double-click:

- puts Recipe Studio at `Documents\emma-cooking-blogg` — a short path, which
  matters (see below);
- looks in Documents, Downloads and the Desktop for an earlier copy, and if it
  finds one, copies its recipes, photos, key and settings across and checks
  every file arrived;
- installs what it needs (a couple of minutes the first time);
- makes the desktop icon;
- runs the installation check.

Nothing is ever deleted. It names the folder it copied from so you can remove
it yourself once the Studio starts from the icon; the unzipped download can
go too. Running it again later simply updates the copy in Documents.

If Git is installed and you would rather work that way:

```
git clone https://github.com/aanzarut/emma-cooking-blogg.git  Documents\emma-cooking-blogg
cd Documents\emma-cooking-blogg
npm install
```

**Why the short path matters.** Windows refuses to write any file whose full
path exceeds 260 characters. A ZIP downloaded from a branch carries a
~57-character folder name, and Explorer's *Extract All* nests it inside another
folder of the same name — enough to push a recipe photo's path past the limit,
at which point saving it silently fails. `Set up on this PC` avoids this by
installing to a short path; `Check for problems` measures it.

## 3. Switch on recipe reading

This is what turns a photo of a recipe card into filled-in ingredients and
method. Without it everything still works; she just types more.

1. Go to <https://console.anthropic.com>, create an account, and add a small
   amount of credit.
2. Open **Settings -> API keys**, create a key, and copy it.
3. In the project folder, double-click **`Set up recipe reading.bat`**, and
   paste the key when it asks.

The script checks the key against Anthropic before saving it, so a partial
copy or a stale key is caught immediately rather than failing weeks later. It
writes `.env` for you — worth having, because creating a file called `.env`
by hand on Windows is awkward: Notepad appends `.txt` and Explorer hides
extensions. Existing settings in the file are kept.

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

`Set up on this PC` already did this. If the icon ever goes missing or the
folder is moved, double-click **`Install desktop icon.bat`** to make it again.

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

## A note on file names

Windows hides the ending of files it recognises, so in the project folder the
launchers appear without their `.bat`:

| What you see | What it really is |
|---|---|
| **Set up on this PC** | `Set up on this PC.bat` |
| **Update** | `Update.bat` |
| **Check for problems** | `Check for problems.bat` |
| **Install desktop icon** | `Install desktop icon.bat` |
| **Set up recipe reading** | `Set up recipe reading.bat` |
| **start-studio** | `start-studio.bat` |

To see the endings: in File Explorer, **View** -> **Show** -> **File name
extensions** (on Windows 10, **View** -> tick **File name extensions**).

The Mac and Linux equivalents live in the `mac-linux` folder, out of the way.

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
| `npm run key` | Set up or replace the recipe-reading key (or double-click `Set up recipe reading.bat`) |

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
