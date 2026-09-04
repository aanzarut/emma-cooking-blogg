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

If Git isn't installed, download the repository as a ZIP from GitHub, unzip it
somewhere sensible (`C:\Users\<name>\Documents\emma-cooking-blogg`), open
Command Prompt in that folder, and run `npm install`.

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

## Commands

| Command | What it does |
|---|---|
| `npm run studio` | Start the Studio (same as the .bat file) |
| `npm run build` | Build the website into `dist/` |
| `npm run preview` | Serve the built website on its own at <http://localhost:4322> |
| `npm run doctor` | Check the installation |
| `npm run icon` | Rebuild the desktop icon from `assets/icon.svg` |

## Changing the dropdown lists

`config/taxonomy.json` holds the food types, cuisines, units and suggested
tags. Edit it and restart the Studio. `config/site.json` holds the website's
name, tagline and address.

## If something breaks

**"Port 4321 is already in use"** — something else is on that port. Add
`PORT=4400` to `.env` and restart. The Studio also uses the next port up
(4322 by default) to serve the website preview.

**Photos won't upload from the phone** — see step 6.

**HEIC photos look broken** — iPhones shoot HEIC; the Studio converts them to
JPEG when they arrive. If one fails, set the iPhone's *Settings → Camera →
Formats* to **Most Compatible** and re-send it.

**A recipe disappeared** — nothing is deleted outright. Look in
`library/.trash/` (recipes) and `library/inbox/.discarded/` (photos).
