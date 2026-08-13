// TEST_PLAN §2 — VALIDATING THE VALIDATORS.
//
// Every detector is fed a deliberately broken input and must FAIL, and a known
// good input and must PASS. If a detector cannot detect its own failure mode it
// is not evidence, and the gauntlet aborts before any gameplay test runs.
//
// This file exists because during development a "too dark" screenshot turned out
// to be back-face-culled floors: the eye said "lighting", the instrument would
// have said "no geometry". Instruments only earn that trust by being tested.

import {
  analyse, aliasing, hueFraction, periodicity, verticalStructure,
  GATES, NEST_VIOLET_HUE,
} from './validators.mjs';
import { writePng } from './png.mjs';

let failures = 0;
const results = [];

function expect(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  if (!condition) failures++;
}

// ---------------------------------------------------------------- synthesis
function makeImage(w, h, fn) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const W = 320, H = 180;

// A plausible "good" reference: a lit corridor. Mid-grey floor with a warm pool,
// a darker wall band at the top, some structure edges, no crushed black.
const reference = makeImage(W, H, (x, y) => {
  const floor = y > H * 0.42;
  const pool = Math.max(0, 1 - Math.hypot(x - W * 0.55, (y - H * 0.7) * 1.8) / (W * 0.42));
  let v = floor ? 0.16 + pool * 0.55 : 0.06 + (y / H) * 0.10;
  if (!floor && (x % 37 < 3)) v += 0.13;            // ribs
  if (floor && (y % 23 < 2)) v += 0.05;             // deck seams
  v = Math.min(1, Math.max(0.02, v));
  return [v * 255 * 1.0, v * 255 * 0.92, v * 255 * 0.80];
});

// ------------------------------------------------------------------- luma V1
{
  const good = analyse(reference);
  expect('V1 passes reference', GATES.V1_crushedBlack(good).pass,
    GATES.V1_crushedBlack(good).value);

  // 92% of pixels crushed to pure black
  const crushed = makeImage(W, H, (x, y) => (y > H * 0.08 ? [0, 0, 0] : [200, 200, 200]));
  expect('V1 FAILS crushed-black frame', !GATES.V1_crushedBlack(analyse(crushed)).pass,
    GATES.V1_crushedBlack(analyse(crushed)).value);
}

// ------------------------------------------------------------------- luma V2
{
  const good = analyse(reference);
  expect('V2 passes reference', GATES.V2_blownHighlights(good).pass,
    GATES.V2_blownHighlights(good).value);
  const blown = makeImage(W, H, () => [254, 254, 254]);
  expect('V2 FAILS blown frame', !GATES.V2_blownHighlights(analyse(blown)).pass,
    GATES.V2_blownHighlights(analyse(blown)).value);
}

// ------------------------------------------------------------------- luma V3
{
  const good = analyse(reference);
  expect('V3 passes reference', GATES.V3_meanLuminance(good).pass, good.mean.toFixed(3));
  const tooBright = analyse(makeImage(W, H, () => [250, 250, 250]));
  expect('V3 FAILS over-exposed frame', !GATES.V3_meanLuminance(tooBright).pass,
    tooBright.mean.toFixed(3));
  const tooDark = analyse(makeImage(W, H, () => [1, 1, 2]));
  expect('V3 FAILS under-exposed frame', !GATES.V3_meanLuminance(tooDark).pass,
    tooDark.mean.toFixed(3));
}

// --------------------------------------------------------------- contrast V5
{
  const good = analyse(reference);
  expect('V5 passes reference', GATES.V5_contrastRange(good).pass, good.range.toFixed(3));
  // luminance compressed into a +-6/255 band: the classic "foggy" failure
  const flat = analyse(makeImage(W, H, (x, y) => {
    const v = 120 + ((x * 7 + y * 3) % 12) - 6;
    return [v, v, v];
  }));
  expect('V5 FAILS flat/foggy frame', !GATES.V5_contrastRange(flat).pass, flat.range.toFixed(3));
}

// --------------------------------------------------------------- aliasing V7
{
  const checker = makeImage(W, H, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
  const shimmering = aliasing(checker);
  expect('V7 FAILS 1px chequerboard', !GATES.V7_aliasing(shimmering).pass, shimmering.toFixed(3));

  // box-blur the same image; the detector must now pass
  const blurred = makeImage(W, H, (x, y) => {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += ((xx + yy) % 2 ? 255 : 0); n++;
      }
    }
    const v = s / n;
    return [v, v, v];
  });
  const soft = aliasing(blurred);
  expect('V7 passes blurred version of the same image', GATES.V7_aliasing(soft).pass,
    soft.toFixed(3));
  expect('V7 separates the two by >5x', shimmering > soft * 5,
    `${shimmering.toFixed(3)} vs ${soft.toFixed(3)}`);
}

// ------------------------------------------------------- colour meaning V8
{
  const violet = makeImage(W, H, (x, y) => (x > W * 0.4 && x < W * 0.6 && y > H * 0.4 && y < H * 0.6)
    ? [194, 59, 216] : [40, 44, 52]);
  const withNest = hueFraction(violet, NEST_VIOLET_HUE);
  expect('V8 detects nest violet when present',
    GATES.V8_nestColour(withNest, { nestInFrame: true }).pass, (withNest * 100).toFixed(3) + '%');
  const noViolet = hueFraction(reference, NEST_VIOLET_HUE);
  expect('V8 FAILS when violet appears with no nest',
    !GATES.V8_nestColour(withNest, { nestInFrame: false }).pass, (withNest * 100).toFixed(3) + '%');
  expect('V8 passes a violet-free frame with no nest',
    GATES.V8_nestColour(noViolet, { nestInFrame: false }).pass, (noViolet * 100).toFixed(3) + '%');
}

// ----------------------------------------------------- grating pattern C5
{
  const pitch = 12;
  const grating = makeImage(W, H, (x, y) => {
    const bar = (x % pitch) < 4 ? 0.10 : 0.55;
    return [bar * 255, bar * 255, bar * 255];
  });
  const region = { x0: 10, y0: 10, x1: W - 10, y1: H - 10 };
  const withBars = periodicity(grating, region, pitch);
  expect('C5 detects a periodic grating signal', GATES.C5_gratingPattern(withBars).pass,
    withBars.toFixed(3));
  const smooth = makeImage(W, H, () => [110, 112, 118]);
  const noBars = periodicity(smooth, region, pitch);
  expect('C5 FAILS on a floor with no grating', !GATES.C5_gratingPattern(noBars).pass,
    noBars.toFixed(3));
}

// --------------------------------------------------- vertical structure C4
{
  const good = verticalStructure(reference);
  expect('C4 detects architecture in the reference', GATES.C4_verticalStructure(good).pass,
    good.toFixed(3));
  const flatFloor = verticalStructure(makeImage(W, H, () => [90, 92, 98]));
  expect('C4 FAILS on a flat floor plane', !GATES.C4_verticalStructure(flatFloor).pass,
    flatFloor.toFixed(3));
}

// ------------------------------------------------------------- performance
{
  expect('P1 passes a normal draw-call count', GATES.P1_drawCalls(140).pass, '140');
  expect('P1 FAILS an excessive draw-call count', !GATES.P1_drawCalls(900).pass, '900');
  expect('P2 FAILS an excessive triangle count', !GATES.P2_triangles(2_000_000).pass, '2M');
  expect('P3 FAILS an excessive light count', !GATES.P3_lights(40).pass, '40');
  expect('P4 passes a healthy sim time', GATES.P4_simTime(1.8).pass, '1.8ms');
  expect('P4 FAILS a slow sim step', !GATES.P4_simTime(19).pass, '19ms');
  expect('P7 FAILS a post-prewarm shader compile', !GATES.P7_shaderCompiles(3).pass, '3');
}

// --------------------------------------------------- hitch detector (real)
{
  const { Profiler } = await import('../src/qa/Profiler.js');
  const p = new Profiler();
  // 200 normal frames
  for (let i = 0; i < 200; i++) {
    p.beginFrame();
    const end = performance.now() + 1;
    while (performance.now() < end) { /* ~1 ms */ }
    p.endFrame();
  }
  const before = p.hitches;
  p.beginFrame();
  p.injectHitch(120);
  p.endFrame();
  expect('hitch detector FAILS a run with an injected 120 ms stall', p.hitches > before,
    `${before} -> ${p.hitches}`);
  const clean = new Profiler();
  for (let i = 0; i < 200; i++) {
    clean.beginFrame();
    const end = performance.now() + 1;
    while (performance.now() < end) { /* ~1 ms */ }
    clean.endFrame();
  }
  expect('hitch detector passes a clean run', clean.hitches === 0, String(clean.hitches));
}

// ------------------------------------------------- determinism of the RNG
{
  const { Rng } = await import('../src/core/Rng.js');
  const a = new Rng(1337), b = new Rng(1337), c = new Rng(4242);
  let same = true, diff = false;
  for (let i = 0; i < 2000; i++) {
    const va = a.next(), vb = b.next(), vc = c.next();
    if (va !== vb) same = false;
    if (va !== vc) diff = true;
  }
  expect('determinism: same seed produces the same stream', same);
  expect('determinism: different seeds produce different streams', diff);

  const parent = new Rng(1337);
  const vfxBefore = [];
  const vfx = parent.child('vfx');
  for (let i = 0; i < 5; i++) vfxBefore.push(vfx.next());
  const parent2 = new Rng(1337);
  parent2.child('sim').next();   // a gameplay draw happens
  const vfx2 = parent2.child('vfx');
  const vfxAfter = [];
  for (let i = 0; i < 5; i++) vfxAfter.push(vfx2.next());
  expect('determinism: child streams are independent of sibling consumption',
    vfxBefore.every((v, i) => v === vfxAfter[i]));
}

// ------------------------------------------------------------------ report
console.log('VALIDATE THE VALIDATORS\n');
for (const r of results) {
  console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? '   (' + r.detail + ')' : ''}`);
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${results.length - failures}/${results.length} detector self-tests`);
process.exit(failures === 0 ? 0 : 1);
