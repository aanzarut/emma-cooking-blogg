import fs from 'node:fs';
import path from 'node:path';
import busboy from 'busboy';
import { INBOX_DIR, ensureDir, safeJoin, recipePaths } from './paths.js';
import { isAccepted, kindOf, normalizeUpload } from './images.js';

const MAX_FILE_BYTES = 60 * 1024 * 1024; // one 60 MB photo is already huge

/** Keep the phone's filename but make it safe and never overwrite anything. */
function uniqueName(dir, original) {
  const ext = path.extname(original).toLowerCase() || '.jpg';
  const stem =
    path
      .basename(original, path.extname(original))
      .replace(/^\d{4}-\d{2}-\d{2}-/, '') // do not stack a second date on a re-filed photo
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'photo';
  const stamp = new Date().toISOString().slice(0, 10);
  let candidate = `${stamp}-${stem}${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stamp}-${stem}-${n++}${ext}`;
  }
  return candidate;
}

/** Parse a multipart upload straight to disk in the inbox. */
export function receiveUpload(req) {
  ensureDir(INBOX_DIR);
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_BYTES, files: 60 } });
    const saved = [];
    const rejected = [];
    const pending = [];

    bb.on('file', (_name, stream, info) => {
      const original = info.filename || 'photo.jpg';
      if (!isAccepted(original)) {
        rejected.push({ name: original, reason: 'Not a photo or PDF' });
        stream.resume();
        return;
      }
      const target = path.join(INBOX_DIR, uniqueName(INBOX_DIR, original));
      const write = fs.createWriteStream(target);
      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
      });
      const done = new Promise((res) => {
        write.on('close', async () => {
          if (truncated) {
            fs.rmSync(target, { force: true });
            rejected.push({ name: original, reason: 'File larger than 60 MB' });
            return res();
          }
          try {
            const final = await normalizeUpload(target);
            saved.push({ file: path.basename(final), original });
          } catch (err) {
            rejected.push({ name: original, reason: `Could not read the image (${err.message})` });
            fs.rmSync(target, { force: true });
          }
          res();
        });
      });
      pending.push(done);
      stream.pipe(write);
    });

    bb.on('error', reject);
    bb.on('close', async () => {
      await Promise.all(pending);
      resolve({ saved, rejected });
    });
    req.pipe(bb);
  });
}

export function listInbox() {
  ensureDir(INBOX_DIR);
  return fs
    .readdirSync(INBOX_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.') && isAccepted(d.name))
    .map((d) => {
      const full = path.join(INBOX_DIR, d.name);
      const stat = fs.statSync(full);
      return {
        file: d.name,
        kind: kindOf(d.name),
        bytes: stat.size,
        addedAt: stat.mtime.toISOString(),
        src: `/files/inbox/${encodeURIComponent(d.name)}`,
      };
    })
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/**
 * Move an inbox file into a recipe.
 * role 'scan'  -> scans/  (the picture of the paper recipe)
 * role 'photo' -> images/original/ (the finished dish)
 */
export function assignToRecipe(fileName, slug, role) {
  const from = safeJoin(INBOX_DIR, fileName);
  if (!fs.existsSync(from)) throw new Error('That file is no longer in the inbox.');
  const p = recipePaths(slug);
  const destDir = role === 'scan' ? p.scans : p.originals;
  ensureDir(destDir);
  const name = uniqueName(destDir, fileName);
  fs.renameSync(from, path.join(destDir, name));
  return name;
}

export function discardFromInbox(fileName) {
  const target = safeJoin(INBOX_DIR, fileName);
  if (!fs.existsSync(target)) return false;
  const trash = path.join(INBOX_DIR, '.discarded');
  ensureDir(trash);
  fs.renameSync(target, path.join(trash, path.basename(target)));
  return true;
}
