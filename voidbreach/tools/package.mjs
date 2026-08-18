#!/usr/bin/env node
/**
 * Build the playtest zip.
 *
 * Everything needed to play, and nothing else: no node_modules, no capture
 * output, no .git. The recipient unzips it, runs `node tools/serve.mjs`, and
 * plays — there is no build step and no install step, which is the whole
 * reason this project vendors three.js.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? resolve(process.argv[2]) : join(root, '..', 'voidbreach.zip');
const stage = join(root, '.package');

const INCLUDE = [
  'index.html', 'studio.html', 'src', 'vendor', 'tools',
  'DIRECTION.md', 'ARCHITECTURE.md', 'TEST_PLAN.md', 'PLAYTEST.md',
  'ATLAS_PROGRESS.md', 'MULTIPLAYER.md', 'README.md',
];

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'voidbreach'), { recursive: true });
let n = 0;
for (const rel of INCLUDE) {
  const src = join(root, rel);
  if (!existsSync(src)) { console.warn('  skip (missing) ' + rel); continue; }
  cpSync(src, join(stage, 'voidbreach', rel), { recursive: true });
  n++;
}
rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, 'voidbreach'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
const size = execFileSync('du', ['-h', out]).toString().split('\t')[0];
console.log(`packaged ${n} entries -> ${out} (${size})`);
