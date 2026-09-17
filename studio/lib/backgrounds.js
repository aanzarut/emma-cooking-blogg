/* Pictures that can stand behind a cut-out dish.
 *
 * Two shelves: a few neutral textures shipped with the app (assets/backgrounds,
 * generated, no licence to worry about) and whatever she adds herself
 * (library/backgrounds, kept with the rest of her library and never touched
 * by an update). An edit refers to one by filename alone; hers win on a
 * name clash, which cannot happen anyway because uploads are date-stamped. */

import fs from 'node:fs';
import path from 'node:path';
import busboy from 'busboy';
import { ROOT, LIBRARY_DIR, ensureDir } from './paths.js';
import { isAccepted, isRenderable, kindOf, normalizeUpload } from './images.js';

export const BUILTIN_DIR = path.join(ROOT, 'assets', 'backgrounds');
export const MINE_DIR = path.join(LIBRARY_DIR, 'backgrounds');

const MAX_FILE_BYTES = 60 * 1024 * 1024;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/;

const pictures = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => !f.startsWith('.') && kindOf(f) === 'image').sort()
  : []);

/** Everything on both shelves, hers after the built-ins. */
export function listBackgrounds() {
  const mine = pictures(MINE_DIR);
  return [
    ...pictures(BUILTIN_DIR).filter((f) => !mine.includes(f)).map((name) => ({ name, builtin: true })),
    ...mine.map((name) => ({ name, builtin: false })),
  ];
}

/** The file behind a name, or null if there is no such picture. */
export function resolveBackground(name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name) || !isRenderable(name)) return null;
  for (const dir of [MINE_DIR, BUILTIN_DIR]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** A filename that is safe, tells its date, and never overwrites anything. */
function uniqueName(original) {
  const ext = path.extname(original).toLowerCase() || '.jpg';
  const stem = path.basename(original, path.extname(original))
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'background';
  const stamp = new Date().toISOString().slice(0, 10);
  let candidate = `${stamp}-${stem}${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(MINE_DIR, candidate)) || fs.existsSync(path.join(BUILTIN_DIR, candidate))) {
    candidate = `${stamp}-${stem}-${n++}${ext}`;
  }
  return candidate;
}

/** Take one picture from a multipart upload straight onto her shelf. */
export function receiveBackground(req) {
  ensureDir(MINE_DIR);
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
    let pending = Promise.resolve(null);

    bb.on('file', (_name, stream, info) => {
      const original = info.filename || 'background.jpg';
      if (!isAccepted(original) || kindOf(original) === 'pdf') {
        stream.resume();
        pending = Promise.reject(new Error('That is not a picture.'));
        pending.catch(() => {});
        return;
      }
      const target = path.join(MINE_DIR, uniqueName(original));
      const write = fs.createWriteStream(target);
      let truncated = false;
      stream.on('limit', () => { truncated = true; });
      pending = new Promise((res, rej) => {
        write.on('close', async () => {
          if (truncated) {
            fs.rmSync(target, { force: true });
            return rej(new Error('That picture is larger than 60 MB.'));
          }
          try {
            res(path.basename(await normalizeUpload(target)));
          } catch (err) {
            fs.rmSync(target, { force: true });
            rej(new Error(`Could not read that picture (${err.message}).`));
          }
        });
        write.on('error', rej);
      });
      stream.pipe(write);
    });

    bb.on('error', reject);
    bb.on('close', () => {
      pending.then((name) => {
        if (!name) reject(new Error('No picture was sent.'));
        else resolve({ name, builtin: false });
      }, reject);
    });
    req.pipe(bb);
  });
}

/** Only hers can go; the built-ins are part of the app. */
export function deleteBackground(name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) throw new Error('Not a picture name.');
  const file = path.join(MINE_DIR, name);
  if (!fs.existsSync(file)) throw new Error('That picture is not one of yours.');
  fs.rmSync(file);
}
