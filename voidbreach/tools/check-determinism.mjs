// QA / S2 — no wall-clock time and no unseeded randomness in the simulation path
// (ARCHITECTURE §3.1, §3.2).
//
// Simulation, animation and shader state must be functions of the engine clock
// and the seeded RNG tree. Anything else makes a capture unreproducible, which
// makes visual review worthless.

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';

// Files allowed to touch wall time, with the reason. Presentation-only damping,
// profiling and the audio graph are outside the deterministic simulation.
const ALLOW = {
  'core/Clock.js': 'owns the clock; converts wall time into fixed steps',
  'qa/Profiler.js': 'measures wall time by definition',
  'game/Main.js': 'requestAnimationFrame driver',
  'audio/Audio.js': 'WebAudio schedules against the audio context clock',
  'game/Game.js': 'boot timing and loading screen only',
  // Gesture recognition is wall-clock BY DEFINITION: a tap is 240 ms of real
  // time whether the machine renders at 20 fps or 200. This entry is only safe
  // because the replay harness never constructs Input at all — it builds an
  // InputFrame itself and calls game.step directly — so no wall-clock reading
  // in this file can reach a deterministic run. That claim is asserted below
  // rather than trusted, because an allowlist entry that depends on a property
  // nobody checks is how a gate quietly stops being a gate.
  'input/Input.js': 'gesture timing; unreachable from the replay path (asserted)',
};

// The allowlist entry for input/Input.js is conditional on this staying true.
const ASSERTIONS = [
  {
    file: 'qa/Replay.js',
    mustNotMatch: /\bnew\s+Input\s*\(/,
    why: 'the replay harness must never construct Input — it builds its own ' +
         'InputFrame. If it does, wall-clock gesture timing reaches the ' +
         'deterministic path and the input/Input.js allowlist entry is invalid.',
  },
];

const BANNED = [
  { re: /\bMath\.random\s*\(/g, what: 'Math.random()' },
  { re: /\bDate\.now\s*\(/g, what: 'Date.now()' },
  { re: /\bperformance\.now\s*\(/g, what: 'performance.now()' },
  { re: /\bnew Date\b/g, what: 'new Date' },
  { re: /\bsetTimeout\s*\(/g, what: 'setTimeout()' },
  { re: /\bsetInterval\s*\(/g, what: 'setInterval()' },
];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(SRC);

const violations = [];
let scanned = 0;

for (const file of files) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');
  scanned++;
  const allowed = ALLOW[rel];
  for (const b of BANNED) {
    b.re.lastIndex = 0;
    let m;
    while ((m = b.re.exec(src))) {
      // ignore occurrences inside comments
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const line = src.slice(lineStart, src.indexOf('\n', m.index));
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      if (allowed) continue;
      violations.push(`${rel}:${lineNumber(src, m.index)}  ${b.what}`);
    }
  }
}

function lineNumber(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

// Verify the conditions the allowlist depends on.
for (const a of ASSERTIONS) {
  let src = '';
  try { src = fs.readFileSync(path.join(SRC, a.file), 'utf8'); }
  catch { violations.push(`${a.file}  missing; cannot verify allowlist assertion`); continue; }
  if (a.mustNotMatch.test(src)) violations.push(`${a.file}  ${a.why}`);
}

console.log('DETERMINISM: SIMULATION PATH\n');
console.log(`  ${scanned} files scanned`);
console.log('  allowlist:');
for (const [f, why] of Object.entries(ALLOW)) console.log(`    ${f.padEnd(20)} ${why}`);
if (violations.length) {
  console.log('\n  violations:');
  for (const v of violations) console.log(`    FAIL ${v}`);
} else {
  console.log('\n  ok   no wall-clock or unseeded randomness outside the allowlist');
}
console.log(`\n${violations.length === 0 ? 'PASS' : 'FAIL'} — S2`);
process.exit(violations.length === 0 ? 0 : 1);
