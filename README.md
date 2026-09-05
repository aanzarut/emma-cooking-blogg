# Emma's Cooking Blog

A complete system for turning a box of paper recipe cards and a phone full of
food photos into a searchable recipe library and a public website.

Three parts, one folder:

| Part | What it is | How it runs |
|---|---|---|
| **The library** | `library/` — one folder per recipe, holding the text, the photos, and the picture of the original card. Plain files, readable forever. | It's just files |
| **Recipe Studio** | A private app for adding, reading, tagging and touching up recipes. Runs on the computer, in a web browser. | the desktop icon, or `npm run studio` |
| **The website** | The public blog, built from the library. Fast, searchable, no database. | `npm run build` |

## Which document do I want?

- **[SETUP.md](SETUP.md)** — installing this on a Windows PC. Install Node.js, unzip the download, double-click *Set up on this PC*.
- **[GUIDE.md](GUIDE.md)** — the day-to-day guide for Emma. No terminal, no jargon.
- **[PUBLISHING.md](PUBLISHING.md)** — putting the site on the internet when she's ready.

## How a recipe travels through the system

```
  Paper card                Phone                    Studio                  Website
  ──────────                ─────                    ──────                  ───────
  photograph it   ──▶   scan the QR code   ──▶   Inbox: file it   ──▶   marked "Ready"
                        and send photos           into a recipe            appears live
                                                        │
                                                        ▼
                                            "Read the recipe card"
                                            fills in ingredients,
                                            method, source, tags
                                                        │
                                                        ▼
                                             she checks it, adds
                                             her story, picks the
                                                 main photo
```

## What each folder holds

```
library/
  inbox/                     photos sent from a phone, waiting to be filed
  recipes/
    grandma-ruths-apple-cake/
      recipe.md              the recipe: fields at the top, her story below
      scans/                 photos of the paper card — the permanent record
      images/original/       untouched dish photos
      images/edited/         touched-up copies (originals are never altered)
      edits.json             the sliders used for each photo, so any edit can be undone

config/
  site.json                  website name, tagline, web address
  taxonomy.json              the dropdown lists: food types, cuisines, units, tags
  about.md                   the About page

assets/                      the desktop icon (icon.svg is the source)
studio/                      the private app (server + browser interface)
site/                        the website builder and its stylesheet
dist/                        the finished website — generated, never edited by hand
```

## Design decisions worth knowing

**Plain files, not a database.** Every recipe is a Markdown file next to its
photos. If this project is abandoned in ten years, the recipes are still
readable in Notepad, and the photos still open. Nothing is trapped.

**Originals are never modified.** Photo edits are stored as numbers
(`brightness: 1.2`) and applied to a copy. Any edit can be undone years later.

**Transcription is assistance, not authority.** The model reads the card and
fills the form; a person checks it against the photo, which stays on screen.
Words it wasn't sure about are listed in the notes. Nothing publishes itself.

**Drafts stay private.** Only recipes marked *Ready* or *Published* are built
into the website. Everything else stays on the computer.
