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

"Put the website online" keeps this library in step with the other computer
through GitHub. It never deletes here either: a file the other computer
removed goes to `.recovered/<date> deleted on the other computer/`, and a
file changed on both computers has this computer's version kept in
`.recovered/<date> changed on both computers/` before the other one is used.
`.cache`, `.trash`, `.recovered` and the two hidden inbox folders stay on this
computer; everything else in here is shared.

iPhones shoot HEIC, which no browser can display. Those are converted to JPEG
the moment they arrive, and the untouched camera file is kept in
`inbox/.heic-originals/`. Nothing in the app reads that folder — it exists so
the original is never lost. If disk space gets tight it is safe to delete.

**That one folder is not committed to git.** A few hundred HEIC files would add
a gigabyte or more to the repository, for files nothing can open. So it is the
one part of the library that pushing to GitHub does not back up — only a copy
of the `library` folder to an external drive covers it. The JPEG the Studio
actually uses *is* committed, so no recipe or photo you can see is at risk.
