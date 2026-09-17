/* Nothing in this project is ever deleted outright. When two versions of a
   file meet, the one not chosen goes under library/.recovered, in a folder
   that says when and why, keeping its own path underneath. The updater and
   the sync engine both set files aside this way. */

import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_DIR } from './paths.js';

export const RECOVERED_DIR = path.join(LIBRARY_DIR, '.recovered');

/** "2026-09-17 14.05" — sortable, and legal in a Windows folder name. */
export function stamp(date = new Date()) {
  return date.toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
}

/** Where a set-aside copy for this reason goes, e.g. ".../2026-09-17 14.05 from Downloads". */
export function recoveredFolder(label, date = new Date(), libraryDir = LIBRARY_DIR) {
  return path.join(libraryDir, '.recovered', `${stamp(date)} ${label}`);
}

export function copyFileKeepingTime(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const { atime, mtime } = fs.statSync(from);
  fs.utimesSync(to, atime, mtime);
}

/**
 * Copy `absPath` (a file inside the library or config) to the recovered
 * folder, under `relPath` — its path relative to the project root, POSIX
 * slashes. Returns the destination.
 */
export function setAside(absPath, folder, relPath) {
  const to = path.join(folder, ...relPath.split('/'));
  copyFileKeepingTime(absPath, to);
  return to;
}
