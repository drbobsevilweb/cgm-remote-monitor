// QA / validate — measure the captured states against TEST_PLAN §5.
// Consumes captures/current/capture.json + the PNGs; emits a gate report.

import fs from 'node:fs';
import path from 'node:path';
import { readPng } from './png.mjs';
import {
  analyse, aliasing, hueFraction, periodicity, verticalStructure,
  GATES, NEST_VIOLET_HUE,
} from './validators.mjs';

const DIR = process.argv[2] || 'captures/current';
const capture = JSON.parse(fs.readFileSync(path.join(DIR, 'capture.json'), 'utf8'));

const DARK_STATES = new Set(['DARK_CORRIDOR']);
const BRIGHT_STATES = new Set(['EXPLOSION', 'QUEEN']);

const rows = [];
let failures = 0;

function gate(state, name, result) {
  rows.push({ state, gate: name, ...result });
  if (!result.pass) failures++;
}

for (const [state, s] of Object.entries(capture.shots)) {
  if (!s.ok) { gate(state, 'capture', { pass: false, value: 'timeout', limit: 'reached' }); continue; }
  if (s.errors && s.errors.length) {
    gate(state, 'S4_noConsoleErrors', { pass: false, value: s.errors[0].slice(0, 60), limit: '0' });
  } else {
    gate(state, 'S4_noConsoleErrors', { pass: true, value: '0', limit: '0' });
  }

  const img = readPng(s.file);
  const a = analyse(img);
  const dark = DARK_STATES.has(state);
  const bright = BRIGHT_STATES.has(state);

  gate(state, 'V1_crushedBlack', GATES.V1_crushedBlack(a));
  gate(state, 'V2_blownHighlights', GATES.V2_blownHighlights(a, { bright }));
  gate(state, 'V3_meanLuminance', GATES.V3_meanLuminance(a, { dark }));
  gate(state, 'V5_contrastRange', GATES.V5_contrastRange(a));
  gate(state, 'V7_aliasing', GATES.V7_aliasing(aliasing(img)));

  const violet = hueFraction(img, NEST_VIOLET_HUE);
  gate(state, 'V8_queenColour', GATES.V8_queenColour(violet, { queenInFrame: s.queenInFrame }));

  gate(state, 'C4_verticalStructure', GATES.C4_verticalStructure(verticalStructure(img)));

  if (state === 'GRATING') {
    // 250 mm grating at ~16 m under a 60-degree camera lands near 10 px pitch.
    const region = {
      x0: Math.floor(img.width * 0.25), x1: Math.floor(img.width * 0.75),
      y0: Math.floor(img.height * 0.45), y1: Math.floor(img.height * 0.9),
    };
    let best = 0;
    for (const pitch of [7, 9, 11, 13, 16, 20, 26]) {
      best = Math.max(best, periodicity(img, region, pitch));
    }
    gate(state, 'C5_gratingPattern', GATES.C5_gratingPattern(best));
  }

  // composition
  const px = s.playerScreen.x / img.width, py = s.playerScreen.y / img.height;
  gate(state, 'C1_playerInSafeBox', {
    pass: px > 0.2 && px < 0.8 && py > 0.2 && py < 0.8,
    value: `${px.toFixed(2)},${py.toFixed(2)}`, limit: '0.2..0.8',
  });
  gate(state, 'C2_cameraNotInSolid', {
    pass: !s.cameraInSolid, value: String(!!s.cameraInSolid), limit: 'false',
  });

  // structural performance
  gate(state, 'P1_drawCalls', GATES.P1_drawCalls(s.metrics.calls));
  gate(state, 'P2_triangles', GATES.P2_triangles(s.metrics.triangles));
  gate(state, 'P3_lights', GATES.P3_lights(s.metrics.lights));
  gate(state, 'P7_shaderCompiles', GATES.P7_shaderCompiles(s.metrics.compilations));
}

const width = Math.max(...rows.map((r) => r.state.length));
console.log('VISUAL AND STRUCTURAL GATES\n');
let lastState = null;
for (const r of rows) {
  if (r.state !== lastState) { console.log(`  ${r.state}`); lastState = r.state; }
  console.log(`    ${r.pass ? 'ok  ' : 'FAIL'} ${r.gate.padEnd(22)} ${String(r.value).padEnd(24)} ${r.limit}`);
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${rows.length - failures}/${rows.length} gates`);

fs.mkdirSync('captures/reports', { recursive: true });
fs.writeFileSync(`captures/reports/gates.json`, JSON.stringify({ rows, failures }, null, 1));
process.exit(failures === 0 ? 0 : 1);
