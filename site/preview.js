/* Serves the finished website from dist/ so it can be checked before publishing.
   Run with:  npm run preview */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_DIR } from '../studio/lib/paths.js';
import { sendFile, sendText } from '../studio/lib/http.js';
import { safeJoin } from '../studio/lib/paths.js';

const PORT = Number(process.env.PREVIEW_PORT || 4322);

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('Nothing to preview yet. Run "npm run build" first.');
  process.exit(1);
}

http.createServer((req, res) => {
  try {
    const clean = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = safeJoin(DIST_DIR, clean.replace(/^\/+/, '') || 'index.html');
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) return sendText(res, 404, 'Not found');
    sendFile(res, target);
  } catch {
    sendText(res, 400, 'Bad request');
  }
}).listen(PORT, () => {
  console.log(`\n  Website preview: http://localhost:${PORT}\n  Press Ctrl+C to stop.\n`);
});
