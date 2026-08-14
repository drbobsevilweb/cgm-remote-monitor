// QA / replay-matrix — gates E2 and E3 (TEST_PLAN §4.1).
//
//   E2  the same seed, run twice, must produce the same run. Not "roughly the
//       same" — the same beat times to the frame and the same end-state hash.
//   E3  several seeds must each complete every beat. A level that only works on
//       the seed it was tuned against has not been balanced, it has been fitted.
//
// Both were listed as UNVERIFIED in TEST_PLAN §6c for as long as this file did
// not exist, which is the honest reason it exists.
//
//   node tools/replay-matrix.mjs                 # 1337 x2, 4242, 777
//   node tools/replay-matrix.mjs 1337,4242 2     # explicit seeds, 2 repeats
//
// Runs are deliberately allowed to overlap. A pair that only matches when the
// machine is quiet is not deterministic, it is lucky.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SEEDS = (process.argv[2] || '1337,4242,777').split(',').map((s) => s.trim());
const REPEATS = +(process.argv[3] || 1);
const PAIR_SEED = SEEDS[0];                 // the one we run twice for E2
const OUT = process.env.MATRIX_OUT || path.join(os.tmpdir(), 'voidbreach-matrix');
const CONCURRENCY = +(process.env.MATRIX_CONCURRENCY || 2);
const TIMEOUT_MS = +(process.env.MATRIX_TIMEOUT_MS || 1400000);

fs.mkdirSync(OUT, { recursive: true });

function runOne(seed, tag) {
  return new Promise((resolve) => {
    const file = path.join(OUT, `${seed}_${tag}.json`);
    const fd = fs.openSync(file, 'w');
    const t0 = Date.now();
    const child = spawn(process.execPath,
      [path.join(import.meta.dirname, 'replay.mjs'), String(seed), String(TIMEOUT_MS)],
      { stdio: ['ignore', fd, fd] });
    child.on('exit', () => {
      fs.closeSync(fd);
      resolve({ seed, tag, file, elapsedMs: Date.now() - t0, result: parse(file) });
    });
  });
}

/** replay.mjs interleaves progress lines with the JSON; take the last object. */
function parse(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Everything that must be identical between two runs of one seed. */
function fingerprint(r) {
  if (!r) return null;
  return JSON.stringify({
    reason: r.reason,
    simTime: r.simTime,
    beats: r.beats.map((b) => [b.name, b.done, b.at]),
    stats: r.stats,
    hash: r.endStateHash,
  });
}

async function pool(tasks, n) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) out.push(await tasks[i++]());
  });
  await Promise.all(workers);
  return out;
}

const jobs = [];
for (const seed of SEEDS) {
  const repeats = seed === PAIR_SEED ? Math.max(2, REPEATS) : REPEATS;
  for (let k = 0; k < repeats; k++) jobs.push(() => runOne(seed, String.fromCharCode(97 + k)));
}

console.error(`replay-matrix: ${jobs.length} runs, ${CONCURRENCY} at a time, output in ${OUT}`);
const runs = await pool(jobs, CONCURRENCY);
runs.sort((a, b) => (a.seed + a.tag).localeCompare(b.seed + b.tag));

let failed = 0;
const report = { seeds: {}, e2: null, e3: null };

// ---- E3: every seed completes every beat
console.log('\nE3 — every seed completes every beat\n');
for (const seed of SEEDS) {
  const mine = runs.filter((r) => r.seed === seed);
  for (const r of mine) {
    const res = r.result;
    const ok = res && res.pass;
    if (!ok) failed++;
    const missed = res ? res.beats.filter((b) => !b.pass).map((b) => b.name) : ['NO RESULT'];
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  seed ${seed}${mine.length > 1 ? ' (' + r.tag + ')' : ''}  ` +
      `${res ? res.beatsPassed : '?'}/${res ? res.beatsTotal : '?'}  ` +
      `${res ? res.reason : '-'} @ ${res ? res.simTime : '-'}s  ` +
      `hp ${res ? res.stats.health : '-'}  ${(Date.now(), (r.elapsedMs / 1000) | 0)}s wall` +
      (ok ? '' : `\n        missed: ${missed.join(', ')}`));
    report.seeds[`${seed}_${r.tag}`] = res
      ? { pass: res.pass, beats: res.beatsPassed, reason: res.reason, hash: res.endStateHash }
      : null;
  }
}
report.e3 = failed === 0;

// ---- E2: the paired seed produces the same run twice
console.log('\nE2 — the same seed produces the same run\n');
const pair = runs.filter((r) => r.seed === PAIR_SEED);
if (pair.length < 2) {
  console.log('  SKIP  fewer than two runs of the paired seed');
} else {
  const fps = pair.map((r) => fingerprint(r.result));
  const same = fps.every((f) => f !== null && f === fps[0]);
  report.e2 = same;
  if (same) {
    console.log(`  PASS  seed ${PAIR_SEED} x${pair.length} identical ` +
      `(hash ${pair[0].result.endStateHash}, ${pair.map((r) => (r.elapsedMs / 1000) | 0).join('s / ')}s wall)`);
  } else {
    failed++;
    console.log(`  FAIL  seed ${PAIR_SEED} diverged`);
    // Say WHERE. "The runs differ" is not a bug report.
    const a = pair[0].result, b = pair[1].result;
    if (!a || !b) console.log('        one run produced no result at all');
    else {
      if (a.endStateHash !== b.endStateHash) console.log(`        endStateHash ${a.endStateHash} vs ${b.endStateHash}`);
      if (a.reason !== b.reason) console.log(`        reason ${a.reason} vs ${b.reason}`);
      if (a.simTime !== b.simTime) console.log(`        simTime ${a.simTime} vs ${b.simTime}`);
      for (let i = 0; i < a.beats.length; i++) {
        if (a.beats[i].at !== b.beats[i].at) {
          console.log(`        beat ${a.beats[i].name}: ${a.beats[i].at} vs ${b.beats[i].at}`);
        }
      }
      for (const k of Object.keys(a.stats)) {
        const av = JSON.stringify(a.stats[k]), bv = JSON.stringify(b.stats[k]);
        if (av !== bv) console.log(`        stats.${k}: ${av} vs ${bv}`);
      }
    }
  }
}

fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(report, null, 1));
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — E2 ${report.e2 ? 'ok' : 'FAILED'}, E3 ${report.e3 ? 'ok' : 'FAILED'}\n`);
process.exit(failed === 0 ? 0 : 1);
