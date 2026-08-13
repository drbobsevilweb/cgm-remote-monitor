// QA / S1+S3 — subsystem dependency rules (ARCHITECTURE §2).
//
// Parses every import in src/ and fails on any edge not in the allowed table.
// Cross-cutting communication goes UPWARD through the event bus, never through
// an import: WEAPONS does not import VFX, it emits `impact` and lets the
// composition root's wiring do the rest.

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';

// subsystem -> subsystems it may import
const ALLOWED = {
  core: [],
  input: ['core'],
  level: ['core'],
  environment: ['core', 'level'],
  renderer: ['core'],
  lighting: ['core', 'level', 'environment'],
  vfx: ['core', 'level', 'environment'],
  audio: ['core'],
  hud: ['core', 'environment'],
  weapons: ['core', 'level', 'player'],
  player: ['core', 'level', 'weapons'],
  enemies: ['core', 'level', 'environment'],
  director: ['core', 'level', 'enemies'],
  qa: ['core', 'level', 'input', 'enemies', 'environment'],
  game: ['core', 'input', 'level', 'environment', 'renderer', 'lighting', 'vfx',
    'audio', 'hud', 'player', 'weapons', 'enemies', 'director', 'qa'],
};

// PLAYER <-> WEAPONS is a deliberate two-way pair: the operator spec lives with
// the operator, and the weapon numbers live with it. Recorded, not accidental.
const KNOWN_CYCLES = new Set(['player->weapons|weapons->player']);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(SRC);

const violations = [];
const edges = new Set();
const external = new Set();

for (const file of files) {
  const rel = path.relative(SRC, file);
  const subsystem = rel.split(path.sep)[0];
  const src = fs.readFileSync(file, 'utf8');
  const re = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) { external.add(spec); continue; }
    const target = path.normalize(path.join(path.dirname(file), spec));
    if (!target.startsWith(SRC)) {
      // vendor/ is the pinned three.js build; that is the only allowed outside
      if (target.includes('vendor')) { external.add('three (vendored)'); continue; }
      violations.push(`${rel}: imports outside src/ (${spec})`);
      continue;
    }
    const targetSub = path.relative(SRC, target).split(path.sep)[0];
    if (targetSub === subsystem) continue;
    edges.add(`${subsystem}->${targetSub}`);
    const allowed = ALLOWED[subsystem];
    if (!allowed) { violations.push(`${rel}: unknown subsystem "${subsystem}"`); continue; }
    if (!allowed.includes(targetSub)) {
      violations.push(`${subsystem} -> ${targetSub}  (in ${rel}, importing ${spec})`);
    }
  }
}

// cycle detection over the observed edges
const adj = new Map();
for (const e of edges) {
  const [a, b] = e.split('->');
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push(b);
}
const cycles = [];
for (const [a, list] of adj) {
  for (const b of list) {
    if ((adj.get(b) || []).includes(a)) {
      const key = [`${a}->${b}`, `${b}->${a}`].sort().join('|');
      if (!KNOWN_CYCLES.has(key) && !cycles.includes(key)) cycles.push(key);
    }
  }
}

console.log('SUBSYSTEM DEPENDENCY RULES\n');
console.log(`  ${files.length} files, ${edges.size} cross-subsystem edges`);
console.log(`  runtime dependencies outside src/: ${[...external].join(', ') || 'none'}`);

const badExternal = [...external].filter((e) => !e.includes('three'));
if (badExternal.length) violations.push(`S3: unexpected runtime dependency: ${badExternal.join(', ')}`);
for (const c of cycles) violations.push(`cycle: ${c}`);

if (violations.length) {
  console.log('\n  violations:');
  for (const v of violations) console.log(`    FAIL ${v}`);
} else {
  console.log('\n  ok   no illegal edges, no unrecorded cycles, three.js only');
}
console.log(`\n${violations.length === 0 ? 'PASS' : 'FAIL'} — S1/S3`);
process.exit(violations.length === 0 ? 0 : 1);
