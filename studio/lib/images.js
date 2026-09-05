import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ensureDir, ROOT } from './paths.js';

sharp.cache(false);

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.avif']);
export const HEIC_EXTS = new Set(['.heic', '.heif']);
export const DOC_EXTS = new Set(['.pdf']);

const CACHE_DIR = path.join(ROOT, 'library', '.cache', 'thumbs');

/**
 * 'image' — a browser can show it and sharp can process it.
 * 'heic'  — an iPhone original: accepted on upload, converted, then put away.
 *           Nothing downstream can display or edit it.
 * 'pdf'   — kept and sent to the transcriber, shown as an icon.
 */
export function kindOf(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (HEIC_EXTS.has(ext)) return 'heic';
  if (DOC_EXTS.has(ext)) return 'pdf';
  return 'other';
}

/** Will an upload of this be taken at all? HEIC counts: it gets converted. */
export function isAccepted(filename) {
  return kindOf(filename) !== 'other';
}

/** Can this file be put in front of a person as-is? HEIC never can. */
export function isRenderable(filename) {
  const kind = kindOf(filename);
  return kind === 'image' || kind === 'pdf';
}

/** Where camera originals go once a working JPEG has been made from them. */
export const HEIC_ORIGINALS_DIRNAME = '.heic-originals';

/**
 * iPhones shoot HEIC, which no browser can display. Anything HEIC is converted
 * to a high-quality JPEG on arrival, and the camera original is moved into a
 * hidden folder beside it — kept, because it is the untouched original, but
 * out of the way, because nothing in the app can show or edit it.
 */
export async function normalizeUpload(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!HEIC_EXTS.has(ext)) return filePath;

  const jpegPath = filePath.slice(0, -ext.length) + '.jpg';
  try {
    // sharp only decodes HEIF when libvips was built with an HEVC-capable
    // libheif; the published binaries handle AVIF only, so this usually throws.
    await sharp(filePath).rotate().jpeg({ quality: 92 }).toFile(jpegPath);
  } catch {
    // Fall back to the pure-JavaScript decoder, which does handle iPhone HEIC.
    const { default: heicConvert } = await import('heic-convert');
    const buffer = await heicConvert({
      buffer: fs.readFileSync(filePath),
      format: 'JPEG',
      quality: 0.92,
    });
    fs.writeFileSync(jpegPath, buffer);
  }

  // Only once the JPEG is definitely on disk.
  if (fs.existsSync(jpegPath) && fs.statSync(jpegPath).size > 0) {
    const keep = ensureDir(path.join(path.dirname(filePath), HEIC_ORIGINALS_DIRNAME));
    fs.renameSync(filePath, path.join(keep, path.basename(filePath)));
  }
  return jpegPath;
}

export async function metadata(filePath) {
  if (kindOf(filePath) !== 'image') return { width: 0, height: 0, kind: kindOf(filePath) };
  const m = await sharp(filePath).metadata();
  const rotated = m.orientation && m.orientation >= 5;
  return {
    kind: 'image',
    width: rotated ? m.height : m.width,
    height: rotated ? m.width : m.height,
    format: m.format,
    bytes: fs.statSync(filePath).size,
  };
}

/**
 * Cached thumbnail, keyed by file path + mtime so edits invalidate it.
 *
 * The key is hashed rather than derived from the path itself. A readable key
 * grows with the path, and on Windows the whole cache path then runs past the
 * 260-character limit and every write fails — which is exactly what broke
 * every preview in the Inbox. Sixteen hex characters is short, fixed-length
 * however deep the project sits, and cannot collide the way a truncated
 * prefix could.
 */
export async function thumbnail(filePath, width = 480) {
  ensureDir(CACHE_DIR);
  const stat = fs.statSync(filePath);
  const key = createHash('sha1')
    .update(`${filePath}|${stat.mtimeMs}|${width}`)
    .digest('hex')
    .slice(0, 16);
  const out = path.join(CACHE_DIR, `${key}.jpg`);
  if (fs.existsSync(out)) return out;
  await sharp(filePath)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(out);
  return out;
}

export const DEFAULT_EDIT = {
  rotate: 0,          // 0 | 90 | 180 | 270
  straighten: 0,      // -15..15 degrees
  flipH: false,
  crop: null,         // { x, y, w, h } as fractions of the image, 0..1
  brightness: 1,      // 0.5 .. 1.5
  contrast: 1,        // 0.5 .. 1.5
  saturation: 1,      // 0 .. 2
  warmth: 0,          // -0.3 .. 0.3
  sharpen: 0,         // 0 .. 3
  autoLevels: false,
};

export function mergeEdit(edit = {}) {
  const e = { ...DEFAULT_EDIT, ...edit };
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  e.rotate = [0, 90, 180, 270].includes(Number(e.rotate)) ? Number(e.rotate) : 0;
  e.straighten = clamp(e.straighten, -15, 15, 0);
  e.brightness = clamp(e.brightness, 0.4, 1.8, 1);
  e.contrast = clamp(e.contrast, 0.4, 1.8, 1);
  e.saturation = clamp(e.saturation, 0, 2, 1);
  e.warmth = clamp(e.warmth, -0.35, 0.35, 0);
  e.sharpen = clamp(e.sharpen, 0, 3, 0);
  e.flipH = Boolean(e.flipH);
  e.autoLevels = Boolean(e.autoLevels);
  if (e.crop) {
    const c = e.crop;
    const x = clamp(c.x, 0, 1, 0);
    const y = clamp(c.y, 0, 1, 0);
    const w = clamp(c.w, 0.02, 1 - x, 1 - x);
    const h = clamp(c.h, 0.02, 1 - y, 1 - y);
    e.crop = w >= 0.999 && h >= 0.999 && x === 0 && y === 0 ? null : { x, y, w, h };
  }
  return e;
}

export function isIdentityEdit(edit) {
  const e = mergeEdit(edit);
  return JSON.stringify(e) === JSON.stringify(mergeEdit({}));
}

/**
 * Turning only: EXIF orientation, straighten, quarter-turns, flip.
 * The crop box in the editor is drawn over exactly this result, so cropping
 * always means "keep the part I can see".
 */
async function geometry(sourcePath, e) {
  let img = sharp(sourcePath).rotate(); // honour the EXIF orientation first
  if (e.straighten) img = img.rotate(e.straighten, { background: '#ffffff' });
  if (e.rotate) img = sharp(await img.toBuffer()).rotate(e.rotate);
  if (e.flipH) img = img.flop();
  return img;
}

/** A quick, turn-only render used as the backdrop for the crop box. */
export async function renderGeometry(sourcePath, edit, { maxWidth = 1200 } = {}) {
  const img = await geometry(sourcePath, mergeEdit(edit));
  return sharp(await img.toBuffer())
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

/**
 * Apply an edit recipe to an image. Edits are stored as numbers, never baked
 * into the original, so any adjustment can be undone or redone later.
 */
export async function renderEdit(sourcePath, edit, { maxWidth = null, quality = 88, format = 'jpeg' } = {}) {
  const e = mergeEdit(edit);

  // Order matters, and it matches what the editor shows: turn the photo first,
  // then crop what you see, then adjust the colours.
  let img = await geometry(sourcePath, e);

  if (e.crop) {
    const meta = await sharp(await img.toBuffer()).metadata();
    const left = Math.round(e.crop.x * meta.width);
    const top = Math.round(e.crop.y * meta.height);
    const width = Math.max(1, Math.round(e.crop.w * meta.width));
    const height = Math.max(1, Math.round(e.crop.h * meta.height));
    img = sharp(await img.toBuffer()).extract({
      left: Math.min(left, meta.width - 1),
      top: Math.min(top, meta.height - 1),
      width: Math.min(width, meta.width - left),
      height: Math.min(height, meta.height - top),
    });
  }

  if (e.autoLevels) img = img.normalize();

  if (e.brightness !== 1 || e.saturation !== 1) {
    img = img.modulate({ brightness: e.brightness, saturation: e.saturation });
  }
  if (e.contrast !== 1) {
    // linear(a, b) maps v -> a*v + b; pivot around mid-grey so the image
    // does not simply get lighter or darker as contrast changes.
    img = img.linear(e.contrast, 128 * (1 - e.contrast));
  }
  if (e.warmth) {
    const w = e.warmth;
    img = img.recomb([
      [1 + w, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - w],
    ]);
  }
  if (e.sharpen) img = img.sharpen({ sigma: 0.6 + e.sharpen * 0.6 });

  if (maxWidth) img = img.resize({ width: maxWidth, withoutEnlargement: true });

  return format === 'webp'
    ? img.webp({ quality }).toBuffer()
    : img.jpeg({ quality, mozjpeg: true }).toBuffer();
}

export async function renderEditToFile(sourcePath, edit, outPath, options) {
  ensureDir(path.dirname(outPath));
  const buf = await renderEdit(sourcePath, edit, options);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

/** Sizes the published site uses: one small card, one full-width hero. */
export const WEB_SIZES = [
  { name: 'card', width: 800, quality: 80 },
  { name: 'full', width: 1800, quality: 84 },
];
