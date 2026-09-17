import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Project root: the folder that holds package.json. */
export const ROOT = path.resolve(here, '..', '..');

export const CONFIG_DIR = path.join(ROOT, 'config');
export const LIBRARY_DIR = path.join(ROOT, 'library');
export const INBOX_DIR = path.join(LIBRARY_DIR, 'inbox');
export const RECIPES_DIR = path.join(LIBRARY_DIR, 'recipes');
export const TRASH_DIR = path.join(LIBRARY_DIR, '.trash');
export const SITE_DIR = path.join(ROOT, 'site');
export const DIST_DIR = path.join(ROOT, 'dist');
export const STUDIO_PUBLIC = path.join(ROOT, 'studio', 'public');

/** Every folder inside one recipe. */
export function recipeDir(slug) {
  return path.join(RECIPES_DIR, slug);
}
export function recipePaths(slug) {
  const dir = recipeDir(slug);
  return {
    dir,
    markdown: path.join(dir, 'recipe.md'),
    edits: path.join(dir, 'edits.json'),
    originals: path.join(dir, 'images', 'original'),
    edited: path.join(dir, 'images', 'edited'),
    scans: path.join(dir, 'scans'),
  };
}

/**
 * Windows refuses to write a file whose full path exceeds 260 characters, and
 * the Studio builds paths this deep beneath the project root:
 *   library/recipes/<slug up to 60>/images/original/<date + name + extension>
 * So the project folder itself has to stay short. Both the installation check
 * and the updater measure against this.
 */
export const WINDOWS_MAX_PATH = Number(process.env.RECIPE_STUDIO_MAX_PATH || 260);
export const DEEPEST_RELATIVE_PATH = path.join(
  'library', 'recipes', 'x'.repeat(60), 'images', 'original', 'y'.repeat(65)
);

export function pathBudget(root = ROOT) {
  const safeRootLength = WINDOWS_MAX_PATH - DEEPEST_RELATIVE_PATH.length - 1;
  return {
    root: root.length,
    deepest: root.length + DEEPEST_RELATIVE_PATH.length + 1,
    limit: WINDOWS_MAX_PATH,
    safeRootLength,
    ok: root.length <= safeRootLength,
  };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureLibrary() {
  [LIBRARY_DIR, INBOX_DIR, RECIPES_DIR].forEach(ensureDir);
}

/**
 * Guard against path traversal. Returns the resolved path only if it really
 * sits inside `base`, otherwise throws.
 */
export function safeJoin(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes its allowed folder: ' + parts.join('/'));
  }
  return resolved;
}
