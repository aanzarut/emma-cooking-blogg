/* Builds the public website from the recipe library into dist/.
   Run with:  npm run build   (or the Build button in the Studio) */

import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

import { ROOT, DIST_DIR, SITE_DIR, recipePaths, ensureDir } from '../studio/lib/paths.js';
import { listRecipes } from '../studio/lib/recipes.js';
import { renderEdit, mergeEdit, kindOf, WEB_SIZES } from '../studio/lib/images.js';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'site.json'), 'utf8'));

const PUBLISHABLE = new Set(['ready', 'published']);

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ------------------------------------------------------------------ images */

async function exportImages(recipe) {
  const p = recipePaths(recipe.slug);
  const outDir = path.join(DIST_DIR, 'photos', recipe.slug);
  const edits = fs.existsSync(p.edits) ? JSON.parse(fs.readFileSync(p.edits, 'utf8')) : {};
  const sources = fs.existsSync(p.originals)
    ? fs.readdirSync(p.originals).filter((f) => !f.startsWith('.') && kindOf(f) === 'image').sort()
    : [];
  if (!sources.length) return [];

  ensureDir(outDir);
  const ordered = recipe.heroImage && sources.includes(recipe.heroImage)
    ? [recipe.heroImage, ...sources.filter((s) => s !== recipe.heroImage)]
    : sources;

  const exported = [];
  for (const name of ordered) {
    const stem = path.basename(name, path.extname(name));
    const edit = mergeEdit(edits[name] || {});
    const variants = {};
    for (const size of WEB_SIZES) {
      const file = `${stem}-${size.name}.jpg`;
      const buffer = await renderEdit(path.join(p.originals, name), edit, {
        maxWidth: size.width,
        quality: size.quality,
      });
      fs.writeFileSync(path.join(outDir, file), buffer);
      variants[size.name] = `/photos/${recipe.slug}/${file}`;
    }
    exported.push({ name, ...variants });
  }
  return exported;
}

/* --------------------------------------------------------------- templates */

function layout({ title, description, body, bodyClass = '', extraHead = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || site.description)}">
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍲</text></svg>">
${extraHead}
</head>
<body class="${bodyClass}">
<header class="masthead">
  <a class="wordmark" href="/">${esc(site.title)}</a>
  <nav>
    <a href="/">Recipes</a>
    <a href="/about/">About</a>
  </nav>
</header>
<main>
${body}
</main>
<footer class="footer">
  <p>${esc(site.footer || site.title)}</p>
</footer>
</body>
</html>`;
}

function recipeCard(r) {
  const image = r.photos[0];
  return `<a class="card" href="/recipes/${esc(r.slug)}/">
  <div class="card-photo">${image
    ? `<img src="${esc(image.card)}" alt="${esc(r.title)}" loading="lazy" width="800" height="600">`
    : '<span class="noimage">🍽</span>'}</div>
  <div class="card-body">
    <h2>${esc(r.title)}</h2>
    ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
    <p class="card-meta">${[r.source?.author && `From ${r.source.author}`, r.foodTypes[0], r.times?.total]
      .filter(Boolean).map(esc).join(' · ')}</p>
  </div>
</a>`;
}

function indexPage(recipes) {
  const body = `
<section class="hero">
  <h1>${esc(site.title)}</h1>
  <p>${esc(site.tagline || site.description)}</p>
</section>

<section class="finder">
  <div class="searchbar">
    <input type="search" id="q" placeholder="Search recipes, ingredients, cooks…" autocomplete="off" aria-label="Search recipes">
  </div>
  <div class="facets" id="facets"></div>
  <p class="resultcount" id="count">${recipes.length} recipes</p>
</section>

<section class="cards" id="results">
${recipes.map(recipeCard).join('\n')}
</section>
<p class="empty" id="noresults" hidden>Nothing matched. Try a shorter word, or clear the filters.</p>
<script src="/assets/search.js" defer></script>`;
  return layout({ title: site.title, description: site.description, body, bodyClass: 'home' });
}

function recipePage(r, all) {
  const hero = r.photos[0];
  const gallery = r.photos.slice(1);
  const related = all
    .filter((o) => o.slug !== r.slug)
    .map((o) => ({
      recipe: o,
      score: o.tags.filter((t) => r.tags.includes(t)).length +
             o.foodTypes.filter((t) => r.foodTypes.includes(t)).length +
             (o.source?.author && o.source.author === r.source?.author ? 2 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.recipe);

  const chips = [
    ...r.foodTypes.map((v) => ({ v, kind: 'type' })),
    ...r.cuisines.map((v) => ({ v, kind: 'cuisine' })),
    ...r.tags.map((v) => ({ v, kind: 'tag' })),
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.title,
    description: r.summary || undefined,
    author: r.source?.author ? { '@type': 'Person', name: r.source.author } : undefined,
    recipeYield: r.servings || undefined,
    prepTime: r.times?.prep || undefined,
    cookTime: r.times?.cook || undefined,
    totalTime: r.times?.total || undefined,
    recipeCategory: r.foodTypes[0] || undefined,
    recipeCuisine: r.cuisines[0] || undefined,
    keywords: r.tags.join(', ') || undefined,
    image: hero ? [hero.full] : undefined,
    recipeIngredient: r.ingredients.map(ingredientLine),
    recipeInstructions: r.steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })),
  };

  const body = `
<article class="recipe">
  <nav class="crumbs"><a href="/">← All recipes</a></nav>

  <header class="recipe-head">
    <h1>${esc(r.title)}</h1>
    ${r.summary ? `<p class="lede">${esc(r.summary)}</p>` : ''}
    <dl class="facts">
      ${r.source?.author ? `<div><dt>From</dt><dd>${esc(r.source.author)}${r.source.publication ? `, <i>${esc(r.source.publication)}</i>` : ''}${r.source.year ? ` (${esc(r.source.year)})` : ''}</dd></div>` : ''}
      ${r.servings ? `<div><dt>Serves</dt><dd>${esc(r.servings)}</dd></div>` : ''}
      ${r.times?.prep ? `<div><dt>Prep</dt><dd>${esc(r.times.prep)}</dd></div>` : ''}
      ${r.times?.cook ? `<div><dt>Cook</dt><dd>${esc(r.times.cook)}</dd></div>` : ''}
      ${r.difficulty ? `<div><dt>Effort</dt><dd>${esc(r.difficulty)}</dd></div>` : ''}
    </dl>
    ${chips.length ? `<p class="chips">${chips.map((c) => `<a class="chip" href="/?${c.kind}=${encodeURIComponent(c.v)}">${esc(c.v)}</a>`).join('')}</p>` : ''}
  </header>

  ${hero ? `<figure class="hero-photo"><img src="${esc(hero.full)}" alt="${esc(r.title)}"></figure>` : ''}

  ${r.commentary ? `<section class="story">${md.render(r.commentary)}</section>` : ''}

  <div class="cook">
    <section class="ingredients">
      <h2>Ingredients</h2>
      <ul>${r.ingredients.map((i) => `<li>${esc(ingredientLine(i))}</li>`).join('')}</ul>
    </section>
    <section class="method">
      <h2>Method</h2>
      <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </section>
  </div>

  ${r.notes ? `<section class="notes"><h2>Notes from the card</h2>${md.render(r.notes)}</section>` : ''}

  ${gallery.length ? `<section class="gallery"><h2>More photos</h2><div class="gallery-grid">${
    gallery.map((p) => `<img src="${esc(p.card)}" alt="${esc(r.title)}" loading="lazy">`).join('')
  }</div></section>` : ''}

  ${related.length ? `<section class="related"><h2>You might also like</h2><div class="cards">${
    related.map(recipeCard).join('')
  }</div></section>` : ''}
</article>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  return layout({ title: `${r.title} — ${site.title}`, description: r.summary, body, bodyClass: 'recipe-page' });
}

function ingredientLine(ing) {
  if (ing.raw && !ing.name) return ing.raw;
  const parts = [ing.quantity, ing.unit, ing.name].filter(Boolean).join(' ').trim();
  return ing.note ? `${parts}, ${ing.note}` : parts || ing.raw || '';
}

function aboutPage() {
  const file = path.join(ROOT, 'config', 'about.md');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# About\n';
  return layout({
    title: `About — ${site.title}`,
    description: `About ${site.title}`,
    body: `<article class="recipe"><section class="story">${md.render(text)}</section></article>`,
  });
}

/* ------------------------------------------------------------------ build */

async function build() {
  const started = Date.now();
  const all = listRecipes();
  const published = all.filter((r) => PUBLISHABLE.has(r.status));

  console.log(`Found ${all.length} recipes; ${published.length} marked Ready or Published.`);
  const skipped = all.length - published.length;
  if (skipped) console.log(`Leaving ${skipped} draft${skipped === 1 ? '' : 's'} out of the website.`);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  ensureDir(DIST_DIR);

  const prepared = [];
  for (const recipe of published) {
    process.stdout.write(`  ${recipe.title} … `);
    const photos = await exportImages(recipe);
    prepared.push({ ...recipe, photos });
    console.log(`${photos.length} photo${photos.length === 1 ? '' : 's'}`);
  }

  prepared.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), indexPage(prepared), 'utf8');
  for (const recipe of prepared) {
    const dir = path.join(DIST_DIR, 'recipes', recipe.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), recipePage(recipe, prepared), 'utf8');
  }
  ensureDir(path.join(DIST_DIR, 'about'));
  fs.writeFileSync(path.join(DIST_DIR, 'about', 'index.html'), aboutPage(), 'utf8');

  // Search index: small enough to ship whole, so search works with no server.
  const index = prepared.map((r) => ({
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    author: r.source?.author || '',
    publication: r.source?.publication || '',
    foodTypes: r.foodTypes,
    cuisines: r.cuisines,
    courses: r.courses,
    tags: r.tags,
    ingredients: [...new Set(r.ingredients.map((i) => (i.name || i.raw || '').toLowerCase().trim()).filter(Boolean))],
    text: [r.title, r.summary, r.commentary, r.notes, ...r.steps].join(' ').toLowerCase().slice(0, 4000),
  }));
  ensureDir(path.join(DIST_DIR, 'assets'));
  fs.writeFileSync(path.join(DIST_DIR, 'assets', 'index.json'), JSON.stringify(index), 'utf8');

  for (const asset of fs.readdirSync(path.join(SITE_DIR, 'assets'))) {
    fs.copyFileSync(path.join(SITE_DIR, 'assets', asset), path.join(DIST_DIR, 'assets', asset));
  }
  fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');
  fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap(prepared), 'utf8');
  if (site.customDomain) fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), site.customDomain, 'utf8');

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. The website is in dist/.`);
}

function sitemap(recipes) {
  const base = (site.url || '').replace(/\/$/, '');
  const urls = ['/', '/about/', ...recipes.map((r) => `/recipes/${r.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(base + u)}</loc></url>`).join('\n')}
</urlset>`;
}

build().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
