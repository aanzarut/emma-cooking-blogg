# The library

This folder is the archive. Everything else in the project can be rebuilt from
what is in here.

```
inbox/                     photos sent from a phone, not yet filed
recipes/<recipe-name>/
  recipe.md                the recipe — fields at the top, her story below
  scans/                   photos of the paper card (the permanent record)
  images/original/         dish photos exactly as they came off the phone
  images/edited/           touched-up copies, made from the originals
  edits.json               the adjustment for each photo, so edits can be undone
```

`recipe.md` is a plain text file. The part between the `---` lines is the
structured data the website reads; everything after it is the personal
commentary, written in Markdown.

Anything deleted through the Studio is moved, not destroyed:
recipes to `.trash/`, discarded photos to `inbox/.discarded/`.
