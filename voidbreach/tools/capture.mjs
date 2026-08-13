// QA / capture — canonical camera states, each from a FRESH page load.
//
// TEST_PLAN §6: a golden image must never be taken from a contaminated browser
// state, so every shot gets its own context and its own deterministic run.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.argv[2]
  ? process.argv[2].split(',')
  : ['OPENING', 'FIRST_COMBAT', 'GRATING', 'DARK_CORRIDOR', 'SWARM', 'NEST', 'EXPLOSION', 'ELITE'];
const SEED = process.argv[3] || '1337';
const OUT = process.argv[4] || 'captures/current';
const W = 1600, H = 900;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});

const report = { seed: SEED, shots: {} };

for (const shot of SHOTS) {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:8099/index.html?shot=${shot}&seed=${SEED}&capture=1`,
    { waitUntil: 'load' });
  let ok = true;
  try {
    await page.waitForFunction(() => window.__SHOT_READY === true, { timeout: 600000 });
  } catch (e) { ok = false; }

  const info = await page.evaluate(() => {
    const g = window.__GAME;
    if (!g) return null;
    const p = g.player;
    const nest = g.nests.nearest(p.x, p.z);
    // Is a live nest actually inside the camera frustum? The colour-meaning gate
    // needs the ground truth, not a guess from the pixels.
    let nestInFrame = false;
    for (const n of g.nests.list) {
      if (!n.alive) continue;
      const v = new (window.__THREE ? window.__THREE.Vector3 : Object)();
      const s = g.worldToScreen(n.x, 1.2, n.z);
      if (s.x > -80 && s.x < g.hud.w + 80 && s.y > -80 && s.y < g.hud.h + 80) {
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < 42 && g.sector.grid.lineOfSight(p.x, p.z, n.x, n.z)) nestInFrame = true;
      }
    }
    // player screen position, for the composition gates
    const ps = g.worldToScreen(p.x, 1.0, p.z);
    return {
      info: window.__SHOT_INFO,
      room: g.sector.roomAtWorld(p.x, p.z)?.id,
      roomTone: g.sector.roomAtWorld(p.x, p.z)?.tone,
      enemies: g.enemies.aliveNow || 0,
      nestsRemaining: g.nests.remaining,
      nestInFrame,
      nestDist: nest ? +nest.dist.toFixed(1) : null,
      player: { x: +p.x.toFixed(2), z: +p.z.toFixed(2), health: +p.health.toFixed(1) },
      playerScreen: { x: Math.round(ps.x), y: Math.round(ps.y) },
      camera: {
        x: +g.renderer.camera.position.x.toFixed(2),
        y: +g.renderer.camera.position.y.toFixed(2),
        z: +g.renderer.camera.position.z.toFixed(2),
      },
      cameraInSolid: g.sector.grid.solidAtWorld(g.renderer.camera.position.x, g.renderer.camera.position.z),
      metrics: {
        calls: g.renderer.stats.calls,
        triangles: g.renderer.stats.triangles,
        lights: g.lighting.activeLights,
        compilations: g.renderer.compilationsSinceMark,
        simP95: g.profiler.report().sim.p95,
        simMean: g.profiler.report().sim.mean,
        particles: g.vfx.particleCount || 0,
      },
    };
  });

  // Hide the HUD so visual gates measure the rendered world, not the overlay.
  await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
  await page.waitForTimeout(120);
  const file = path.join(OUT, `${shot}.png`);
  await page.screenshot({ path: file });

  report.shots[shot] = {
    ok, file, elapsedMs: Date.now() - t0, errors: errors.slice(0, 4), ...info,
  };
  console.error(`${ok ? 'captured' : 'TIMEOUT '} ${shot.padEnd(14)} ${((Date.now() - t0) / 1000).toFixed(0)}s  ` +
    `room=${info?.room} enemies=${info?.enemies} calls=${info?.metrics.calls}`);
  await context.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
