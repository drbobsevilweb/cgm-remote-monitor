// GAME / Main — entry point and the run loop.
//
// URL parameters:
//   ?seed=N        deterministic seed (default 1337)
//   ?q=low|medium|high
//   ?test=replay   run the 12-beat self-play script (deterministic clock)
//   ?shot=NAME     advance deterministically to a canonical camera state
//   ?stats=1       live profiler overlay

import { Game } from './Game.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const hudCanvas = document.getElementById('hud');
const testMode = params.get('test');
const shot = params.get('shot');
const deterministic = !!(testMode || shot);

const game = new Game({
  canvas,
  hudCanvas,
  seed: +(params.get('seed') || 1337),
  quality: params.get('q'),
  deterministic,
  capture: !!(shot || params.get('capture')),
});
window.__GAME = game;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.resize(w, h, dpr);
}
window.addEventListener('resize', resize);

// Audio needs a gesture. Until then the station is silent, which is honest.
const startAudio = () => {
  if (game.audio.start()) game.audio.resume();
  window.removeEventListener('pointerdown', startAudio);
  window.removeEventListener('keydown', startAudio);
};
window.addEventListener('pointerdown', startAudio);
window.addEventListener('keydown', startAudio);

let last = 0;
let harness = null;
let statsEl = null;

function loop(t) {
  const realDelta = last ? Math.min(0.25, (t - last) / 1000) : 1 / 60;
  last = t;
  if (harness) harness.frame();
  else game.frame(realDelta);
  if (statsEl) drawStats();
  requestAnimationFrame(loop);
}

function drawStats() {
  const r = game.profiler.report();
  statsEl.textContent =
    `frame ${r.frame.p50.toFixed(1)}ms  p95 ${r.frame.p95.toFixed(1)}  p99 ${r.frame.p99.toFixed(1)}  worst ${r.frame.worst.toFixed(1)}\n` +
    `sim   ${r.sim.p50.toFixed(2)}ms  p95 ${r.sim.p95.toFixed(2)}   hitches ${r.hitches}\n` +
    `draws ${r.counters.calls}  tris ${(r.counters.triangles / 1000).toFixed(0)}k  lights ${r.counters.lights}\n` +
    `chorus ${r.counters.enemies} (peak ${r.peak.enemies})  proj ${r.counters.projectiles}  fx ${r.counters.particles}\n` +
    `shaders after prewarm ${r.counters.compilations}`;
}

(async () => {
  resize();
  game.hud.draw(game.hudState(0));
  await game.boot();
  resize();

  if (params.get('stats') === '1') {
    statsEl = document.createElement('pre');
    statsEl.id = 'stats';
    document.body.appendChild(statsEl);
  }

  if (testMode === 'replay' || shot) {
    const { Harness } = await import('../qa/Replay.js');
    harness = new Harness(game, { shot, seed: +(params.get('seed') || 1337) });
    window.__HARNESS = harness;
  }

  // Redeploy on R after death.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && (game.mode === 'dead' || game.mode === 'won')) location.reload();
  });

  requestAnimationFrame(loop);
})();
