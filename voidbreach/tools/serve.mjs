// Dev server. No caching, ever: a golden capture must never be taken against a
// stale module (TEST_PLAN §6 — fresh state per capture).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.css': 'text/css', '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? '/index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
    });
    res.end(data);
  });
});
// Loopback by default — a dev server should not appear on the network because
// somebody happened to start it. `--lan` (or HOST=0.0.0.0) opts in, and is what
// you need to play-test the touch scheme, because a phone cannot reach your
// laptop's 127.0.0.1 and that is the single most likely reason a first attempt
// at testing touch fails.
const wantLan = process.argv.includes('--lan') || process.env.HOST === '0.0.0.0';
const HOST = wantLan ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');

server.listen(PORT, HOST, () => {
  console.log(`voidbreach dev server: http://127.0.0.1:${PORT}/`);
  if (!wantLan) {
    console.log('  (to play-test on a phone: node tools/serve.mjs --lan)');
    return;
  }
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      console.log(`  on your network:      http://${a.address}:${PORT}/    (${name})`);
    }
  }
  console.log('  open that on the phone, on the same wifi. Plain http is fine.');
});
