import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { RECIPES_DIR, TRASH_DIR, recipePaths, ensureDir, safeJoin } from './paths.js';

export const STATUSES = ['draft', 'needs-review', 'ready', 'published'];

/** Turn any title into a safe, stable folder name. */
export function slugify(input, { fallback = 'untitled' } = {}) {
  const base = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

/** Pick a slug that is not taken yet, appending -2, -3 ... if needed. */
export function uniqueSlug(desired) {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;
  while (fs.existsSync(path.join(RECIPES_DIR, candidate))) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

export function blankRecipe(overrides = {}) {
  const now = new Date().toISOString();
  return {
    title: 'Untitled recipe',
    slug: '',
    status: 'draft',
    summary: '',
    source: { author: '', publication: '', url: '', year: '' },
    foodTypes: [],
    cuisines: [],
    courses: [],
    tags: [],
    difficulty: '',
    servings: '',
    times: { prep: '', cook: '', total: '' },
    ingredients: [],
    steps: [],
    notes: '',
    heroImage: '',
    images: [],
    scans: [],
    transcription: { status: 'none', model: '', at: '', confidence: '' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Fill in anything missing so old files keep working as the schema grows. */
function normalize(data, slug) {
  const base = blankRecipe();
  const r = { ...base, ...data };
  r.slug = slug;
  r.source = { ...base.source, ...(data.source || {}) };
  r.times = { ...base.times, ...(data.times || {}) };
  r.transcription = { ...base.transcription, ...(data.transcription || {}) };
  for (const key of ['foodTypes', 'cuisines', 'courses', 'tags', 'images', 'scans', 'steps']) {
    if (!Array.isArray(r[key])) r[key] = [];
  }
  r.ingredients = (Array.isArray(data.ingredients) ? data.ingredients : []).map((ing) =>
    typeof ing === 'string'
      ? { raw: ing, quantity: '', unit: '', name: ing, note: '' }
      : { raw: '', quantity: '', unit: '', name: '', note: '', ...ing }
  );
  r.steps = r.steps.map((s) => (typeof s === 'string' ? s : String(s?.text ?? '')));
  return r;
}

export function listSlugs() {
  if (!fs.existsSync(RECIPES_DIR)) return [];
  return fs
    .readdirSync(RECIPES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(recipePaths(slug).markdown));
}

export function readRecipe(slug) {
  const { markdown } = recipePaths(slug);
  if (!fs.existsSync(markdown)) return null;
  const parsed = matter(fs.readFileSync(markdown, 'utf8'));
  const recipe = normalize(parsed.data, slug);
  recipe.commentary = parsed.content.trim();
  return recipe;
}

export function listRecipes() {
  return listSlugs()
    .map(readRecipe)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function writeRecipe(recipe) {
  if (!recipe.slug) throw new Error('Recipe needs a slug before it can be saved.');
  const p = recipePaths(recipe.slug);
  ensureDir(p.dir);
  ensureDir(p.originals);
  ensureDir(p.edited);
  ensureDir(p.scans);

  const { commentary = '', ...frontmatter } = recipe;
  frontmatter.updatedAt = new Date().toISOString();
  if (!frontmatter.createdAt) frontmatter.createdAt = frontmatter.updatedAt;

  const file = matter.stringify(`\n${commentary.trim()}\n`, frontmatter);
  fs.writeFileSync(p.markdown, file, 'utf8');
  return normalizeAfterWrite(recipe.slug);
}

function normalizeAfterWrite(slug) {
  return readRecipe(slug);
}

export function createRecipe(fields = {}) {
  const slug = uniqueSlug(fields.title || 'untitled recipe');
  return writeRecipe(blankRecipe({ ...fields, slug }));
}

/** Rename a recipe's folder when its title changes. Keeps images with it. */
export function renameRecipe(oldSlug, newTitle) {
  const desired = slugify(newTitle);
  if (!desired || desired === oldSlug) return oldSlug;
  const newSlug = uniqueSlug(desired);
  fs.renameSync(path.join(RECIPES_DIR, oldSlug), path.join(RECIPES_DIR, newSlug));
  const recipe = readRecipe(newSlug);
  recipe.slug = newSlug;
  writeRecipe(recipe);
  return newSlug;
}

/** Nothing is ever hard-deleted: recipes move to library/.trash. */
export function trashRecipe(slug) {
  const from = safeJoin(RECIPES_DIR, slug);
  if (!fs.existsSync(from)) return false;
  ensureDir(TRASH_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(from, path.join(TRASH_DIR, `${slug}--${stamp}`));
  return true;
}

/** Every tag / type / author currently in use, with counts, for filter menus. */
export function facets(recipes = listRecipes()) {
  const count = (key) => {
    const map = new Map();
    for (const r of recipes) {
      const values = key === 'author' ? [r.source?.author].filter(Boolean) : r[key] || [];
      for (const v of values) map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, n]) => ({ value, count: n }));
  };
  return {
    tags: count('tags'),
    foodTypes: count('foodTypes'),
    cuisines: count('cuisines'),
    courses: count('courses'),
    authors: count('author'),
    ingredients: ingredientFacet(recipes),
  };
}

function ingredientFacet(recipes) {
  const map = new Map();
  for (const r of recipes) {
    const seen = new Set();
    for (const ing of r.ingredients || []) {
      const name = (ing.name || ing.raw || '').trim().toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({ value, count: n }));
}
