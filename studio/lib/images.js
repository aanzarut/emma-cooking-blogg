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

/** What can stand behind the dish. */
export const BACKGROUND_MODES = ['none', 'black', 'white', 'picture', 'pop'];

export const DEFAULT_EDIT = {
  rotate: 0,          // 0 | 90 | 180 | 270
  straighten: 0,      // -15..15 degrees
  flipH: false,
  crop: null,         // { x, y, w, h } as fractions of the image, 0..1
  background: {       // what goes behind the dish once it is cut out
    mode: 'none',     // none | black | white | picture | pop (background in mono, dish in colour)
    picture: '',      // filename in library/backgrounds or assets/backgrounds, for 'picture'
    feather: 6,       // how soft the edge is, in pixels at full size, 0..30
  },
  mono: false,        // the whole photo in black and white
  brightness: 1,      // 0.5 .. 1.5
  contrast: 1,        // 0.5 .. 1.5
  saturation: 1,      // 0 .. 2
  warmth: 0,          // -0.3 .. 0.3
  sharpen: 0,         // 0 .. 3
  autoLevels: false,
};

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/;

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
  e.mono = Boolean(e.mono);
  if (e.crop) {
    const c = e.crop;
    const x = clamp(c.x, 0, 1, 0);
    const y = clamp(c.y, 0, 1, 0);
    const w = clamp(c.w, 0.02, 1 - x, 1 - x);
    const h = clamp(c.h, 0.02, 1 - y, 1 - y);
    e.crop = w >= 0.999 && h >= 0.999 && x === 0 && y === 0 ? null : { x, y, w, h };
  }
  const b = e.background && typeof e.background === 'object' ? e.background : {};
  const mode = BACKGROUND_MODES.includes(b.mode) ? b.mode : 'none';
  const picture = typeof b.picture === 'string' && SAFE_NAME.test(b.picture) ? b.picture : '';
  e.background = mode === 'none'
    ? { ...DEFAULT_EDIT.background }
    : { mode, picture: mode === 'picture' ? picture : '', feather: clamp(b.feather, 0, 30, 6) };
  return e;
}

export function isIdentityEdit(edit) {
  const e = mergeEdit(edit);
  return JSON.stringify(e) === JSON.stringify(mergeEdit({}));
}

/** Does this edit need the dish cut out from its surroundings? */
export function needsCutout(edit) {
  return mergeEdit(edit).background.mode !== 'none';
}

/* ------------------------------------------------------------- pipeline
   Every stage hands the next a raw pixel buffer plus its dimensions, so that
   what sharp applies is exactly the order written here. (sharp otherwise
   reorders some operations — composite always runs last, for one — which
   would put the backdrop behind the crop rather than before it.) */

const GREY = [0.2126, 0.7152, 0.0722];
const toRaw = (img) => img.raw().toBuffer({ resolveWithObject: true });
const fromRaw = ({ data, info }) =>
  sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

/**
 * Turning only: EXIF orientation, straighten, quarter-turns, flip.
 * The crop box in the editor is drawn over exactly this result, so cropping
 * always means "keep the part I can see".
 *
 * The same function turns the dish mask, which is why the two line up: a
 * mask made from the original goes through precisely the moves the photo did.
 * The only difference is what fills the corners a straighten exposes — white
 * in the photo, "not the dish" in the mask.
 */
async function turned(input, e, { mask = false } = {}) {
  let img = sharp(input).rotate(); // honour the EXIF orientation first
  if (e.straighten) img = img.rotate(e.straighten, { background: mask ? '#000000' : '#ffffff' });
  if (e.rotate) img = sharp(await img.toBuffer()).rotate(e.rotate);
  if (e.flipH) img = img.flop();
  return img;
}

/** Crop a turned photo, given as raw pixels. */
function cropped(raw, e) {
  if (!e.crop) return fromRaw(raw);
  const { width, height } = raw.info;
  const left = Math.min(Math.round(e.crop.x * width), width - 1);
  const top = Math.min(Math.round(e.crop.y * height), height - 1);
  return fromRaw(raw).extract({
    left,
    top,
    width: Math.min(Math.max(1, Math.round(e.crop.w * width)), width - left),
    height: Math.min(Math.max(1, Math.round(e.crop.h * height)), height - top),
  });
}

/**
 * Put something else behind the dish. Takes the turned photo as raw pixels
 * and returns the same, so it slots in before the crop.
 *
 * The dish mask comes from cutout.js, computed once per photo and cached.
 * Throws CutoutUnavailable if there is no mask to be had; the caller decides
 * whether that means "carry on without a background".
 */
async function withBackground(raw, sourcePath, e) {
  const { maskFor } = await import('./cutout.js');
  const maskPath = await maskFor(sourcePath);
  const { width, height } = raw.info;
  const { mode, feather, picture } = e.background;

  let mask = await turned(maskPath, e, { mask: true });
  if (feather > 0) mask = mask.blur(feather);
  let alpha = await mask.toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  if (alpha.info.width !== width || alpha.info.height !== height) {
    // Should never happen — both went through the same turns — but a
    // mis-sized alpha would throw deep inside libvips with a baffling message.
    alpha = await fromRaw(alpha).resize(width, height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  }

  const rgb = raw.info.channels === 3 ? raw : await toRaw(fromRaw(raw).removeAlpha());
  const subject = await fromRaw(rgb)
    .joinChannel(alpha.data, { raw: { width, height, channels: 1 } })
    .raw()
    .toBuffer();

  let backdrop;
  if (mode === 'black' || mode === 'white') {
    backdrop = sharp({ create: { width, height, channels: 3, background: mode === 'black' ? '#000000' : '#ffffff' } });
  } else if (mode === 'picture') {
    const { resolveBackground } = await import('./backgrounds.js');
    const file = resolveBackground(picture);
    if (!file) throw new Error(`The background picture "${picture}" is missing.`);
    backdrop = sharp(file).rotate().resize(width, height, { fit: 'cover' }).removeAlpha();
  } else {
    // 'pop': the same photo with its colour drained, the dish laid back on top.
    backdrop = fromRaw(rgb).recomb([GREY, GREY, GREY]);
  }

  return toRaw(backdrop.composite([{ input: subject, raw: { width, height, channels: 4 }, blend: 'over' }]));
}

/**
 * What the editor shows behind the crop box: the photo turned and, if asked,
 * with its new background — the two things the browser cannot fake with a
 * CSS filter. Colour sliders and black-and-white are previewed client-side.
 *
 * With `onIssue`, a missing cut-out becomes a note rather than an error and
 * the plain turned photo is returned.
 */
export async function renderPreview(sourcePath, edit, { maxWidth = 1200, onIssue = null } = {}) {
  const e = mergeEdit(edit);
  let raw = await toRaw(await turned(sourcePath, e));
  if (e.background.mode !== 'none') raw = await backgroundOrNote(raw, sourcePath, e, onIssue);
  return fromRaw(raw)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

/** Kept for anything still calling the old name. */
export const renderGeometry = renderPreview;

async function backgroundOrNote(raw, sourcePath, e, onIssue) {
  const { CutoutUnavailable } = await import('./cutout.js');
  try {
    return await withBackground(raw, sourcePath, e);
  } catch (err) {
    if (!(err instanceof CutoutUnavailable) || !onIssue) throw err;
    onIssue(err.message);
    return raw;
  }
}

/**
 * Apply an edit recipe to an image. Edits are stored as numbers, never baked
 * into the original, so any adjustment can be undone or redone later.
 */
export async function renderEdit(sourcePath, edit, { maxWidth = null, quality = 88, format = 'jpeg', onIssue = null } = {}) {
  const e = mergeEdit(edit);

  // Order matters, and it matches what the editor shows: turn the photo, put
  // the new background behind the dish, crop what you see, then adjust the
  // colours, and finally drain them if black and white was asked for.
  let raw = await toRaw(await turned(sourcePath, e));
  if (e.background.mode !== 'none') raw = await backgroundOrNote(raw, sourcePath, e, onIssue);
  let img = cropped(raw, e);

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
  if (e.mono) img = img.grayscale();

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
