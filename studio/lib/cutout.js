/* Finds the dish in a photo — the mask behind every Background option.
 *
 * A "salient object" model (IS-Net, Apache-2.0) runs locally through ONNX
 * Runtime. Photos never leave the computer and nothing is paid per photo.
 * The model file is fetched once (~170 MB) on first use; each photo's mask
 * is computed once and cached, however many times its background changes. */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LIBRARY_DIR, ensureDir } from './paths.js';

export const MODEL = {
  file: 'isnet-general-use.onnx',
  // The rembg project publishes ONNX conversions of the original weights.
  url: process.env.RECIPE_STUDIO_MODEL_URL
    || 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  side: 1024,                       // the square the model wants
  mean: [0.5, 0.5, 0.5],            // its documented normalisation
  std: [1, 1, 1],
  minBytes: 100 * 1024 * 1024,      // anything smaller is not the model
};

const MODELS_DIR = path.join(LIBRARY_DIR, '.cache', 'models');
const MASKS_DIR = path.join(LIBRARY_DIR, '.cache', 'masks');

/** Thrown when a mask cannot be made; the caller keeps working without one. */
export class CutoutUnavailable extends Error {}

/* ------------------------------------------------------------- the model */

const state = { downloading: false, received: 0, total: 0, error: '' };
let inflight = null;

export function modelPath() {
  return path.join(MODELS_DIR, MODEL.file);
}

export function modelPresent() {
  try { return fs.statSync(modelPath()).size >= MODEL.minBytes; } catch { return false; }
}

export function status() {
  const present = modelPresent();
  return {
    present,
    downloading: state.downloading,
    received: state.received,
    total: state.total,
    percent: state.total ? Math.floor((state.received / state.total) * 100) : 0,
    error: state.error,
  };
}

/**
 * Fetch the model once. Idempotent: a second call while a download is in
 * flight waits on the same one. The file is written as .part and only
 * renamed when every byte has arrived, so a dropped connection can never
 * leave a half model that looks whole.
 */
export function ensureModel() {
  if (modelPresent()) return Promise.resolve(modelPath());
  if (inflight) return inflight;

  inflight = (async () => {
    ensureDir(MODELS_DIR);
    const part = `${modelPath()}.part`;
    state.downloading = true;
    state.received = 0;
    state.total = 0;
    state.error = '';
    try {
      const response = await fetch(MODEL.url, { headers: { 'user-agent': 'recipe-studio' } });
      if (!response.ok || !response.body) throw new Error(`GitHub answered ${response.status}`);
      state.total = Number(response.headers.get('content-length')) || 0;

      const out = fs.createWriteStream(part);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        state.received += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });

      const size = fs.statSync(part).size;
      if ((state.total && size !== state.total) || size < MODEL.minBytes) {
        throw new Error(`download incomplete (${size} of ${state.total || '?'} bytes)`);
      }
      fs.renameSync(part, modelPath());
      return modelPath();
    } catch (err) {
      fs.rmSync(part, { force: true });
      // fetch's own wording ("terminated", "fetch failed") means nothing to
      // the person reading it; say what happened in plain words.
      state.error = /terminated|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(err.message)
        ? 'the connection dropped part-way. Check the internet and try again'
        : err.message;
      throw new CutoutUnavailable(`Could not fetch the cut-out tool: ${state.error}`);
    } finally {
      state.downloading = false;
      inflight = null;
    }
  })();
  return inflight;
}

let session = null;
async function getSession() {
  if (session) return session;
  const ort = await import('onnxruntime-node');
  session = await ort.InferenceSession.create(modelPath(), { executionProviders: ['cpu'] });
  return session;
}

/* -------------------------------------------------------------- the mask */

/** Dimensions after the EXIF rotation that every render applies first. */
async function rotatedSize(sourcePath) {
  const m = await sharp(sourcePath).metadata();
  const swapped = m.orientation && m.orientation >= 5;
  return { width: swapped ? m.height : m.width, height: swapped ? m.width : m.height };
}

function cacheKey(sourcePath) {
  const stat = fs.statSync(sourcePath);
  return createHash('sha1').update(`${sourcePath}|${stat.mtimeMs}|${MODEL.file}`).digest('hex').slice(0, 16);
}

/**
 * The subject mask for a photo, as a path to a one-channel PNG the same size
 * as the EXIF-rotated original: 255 where the dish is, 0 where it is not.
 * Cached after the first call. Throws CutoutUnavailable rather than
 * returning a wrong mask.
 */
export async function maskFor(sourcePath) {
  ensureDir(MASKS_DIR);
  const cached = path.join(MASKS_DIR, `${cacheKey(sourcePath)}.png`);
  if (fs.existsSync(cached)) return cached;

  if (!modelPresent()) {
    throw new CutoutUnavailable('The cut-out tool is not on this computer yet.');
  }

  const ort = await import('onnxruntime-node');
  const s = await getSession();
  const { side, mean, std } = MODEL;
  const { width, height } = await rotatedSize(sourcePath);

  // Model input: the photo squashed to the model's square, RGB, planar float.
  const { data } = await sharp(sourcePath)
    .rotate()
    .resize(side, side, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const planar = new Float32Array(3 * side * side);
  const area = side * side;
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) planar[c * area + i] = (data[i * 3 + c] / 255 - mean[c]) / std[c];
  }

  const input = s.inputNames[0];
  const output = s.outputNames[0];
  const result = await s.run({ [input]: new ort.Tensor('float32', planar, [1, 3, side, side]) });
  const pred = result[output].data;

  // Stretch the raw prediction to 0..255 (the reference implementation does
  // the same), then un-squash it to the photo's real shape.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < area; i++) { const v = pred[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo || 1;
  const small = Buffer.alloc(area);
  for (let i = 0; i < area; i++) small[i] = Math.round(((pred[i] - lo) / range) * 255);

  await sharp(small, { raw: { width: side, height: side, channels: 1 } })
    .resize(width, height, { fit: 'fill' })
    .png()
    .toFile(cached);
  return cached;
}

/** Forget cached masks (after a model change, or to reclaim space). */
export function clearMasks() {
  fs.rmSync(MASKS_DIR, { recursive: true, force: true });
}
