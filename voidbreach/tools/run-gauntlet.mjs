// THE GAUNTLET (TEST_PLAN §6) — run everything, in the order that makes the
// results mean something.
//
//   0. validate the validators   — instruments must prove they can fail
//   1. static gates              — architecture and determinism rules
//   2. geometry invariants       — winding, index width
//   3. experience gates          — the 12-beat self-play replay
//   4. visual + structural gates — canonical camera states, fresh page each
//
// Step 0 runs first and aborts the rest on failure, because measurements taken
// with an unproven instrument are not evidence.

import { spawn } from 'node:child_process';
import http from 'node:http';

const STEPS = [
  { id: 'V0', name: 'validate the validators', cmd: ['node', 'tools/validate-validators.mjs'], blocking: true },
  { id: 'S1/S3', name: 'subsystem dependency rules', cmd: ['node', 'tools/check-deps.mjs'], blocking: true },
  { id: 'S2', name: 'determinism of the sim path', cmd: ['node', 'tools/check-determinism.mjs'], blocking: true },
  { id: 'G', name: 'geometry winding invariants', cmd: ['node', 'tools/check-geometry.mjs'], blocking: true },
  { id: 'L', name: 'sector connectivity', cmd: ['node', 'tools/level-check.mjs'], blocking: false },
  { id: 'E1', name: '12-beat self-play replay', cmd: ['node', 'tools/replay.mjs', '1337', '820000'], blocking: false, needsServer: true },
  { id: 'V/C/P', name: 'canonical camera states', cmd: ['node', 'tools/capture.mjs'], blocking: false, needsServer: true },
  { id: 'gates', name: 'visual and structural gates', cmd: ['node', 'tools/validate.mjs'], blocking: false },
];

const only = process.argv[2];

function run(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function serverUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8099/index.html', (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

let server = null;
const results = [];

for (const step of STEPS) {
  if (only && step.id !== only) continue;
  if (step.needsServer && !server && !(await serverUp())) {
    server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', detached: false });
    await new Promise((r) => setTimeout(r, 1200));
  }
  process.stderr.write(`\n=== ${step.id}  ${step.name}\n`);
  const { code, out } = await run(step.cmd);
  const tail = out.trim().split('\n').slice(-3).join('\n');
  console.log(`\n=== ${step.id}  ${step.name}\n${tail}`);
  results.push({ id: step.id, name: step.name, pass: code === 0 });
  if (code !== 0 && step.blocking) {
    console.log(`\nABORTED: ${step.id} is blocking. ` +
      (step.id === 'V0' ? 'Measurements taken with an unproven instrument are not evidence.' : ''));
    break;
  }
}

if (server) server.kill();

console.log('\n\nGAUNTLET SUMMARY');
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(6)} ${r.name}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${failed === 0 ? 'ALL GATES PASS' : failed + ' GATE GROUP(S) FAILING'}`);
process.exit(failed === 0 ? 0 : 1);
