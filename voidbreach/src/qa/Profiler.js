// QA / Profiler — average FPS is insufficient; hitches are what players feel.
// Tracks p50/p95/p99, worst frame and hitch count alongside structural counters.

import { Ring } from '../core/Pool.js';

export class Profiler {
  constructor(window = 600) {
    this.frameMs = new Ring(window);
    this.simMs = new Ring(window);
    this.presentMs = new Ring(window);
    this.marks = new Map();
    this.counters = {
      calls: 0, triangles: 0, enemies: 0, projectiles: 0,
      particles: 0, lights: 0, compilations: 0,
    };
    this.peak = { enemies: 0, projectiles: 0, particles: 0, calls: 0, triangles: 0, lights: 0 };
    this.hitches = 0;
    this.frames = 0;
    this.startedAt = now();
    this.lastSim = 0;
    this.enabled = true;
  }

  beginFrame() { this._frameStart = now(); }

  mark(name) { this.marks.set(name, now()); }
  measure(name) {
    const t0 = this.marks.get(name);
    if (t0 === undefined) return 0;
    const dt = now() - t0;
    if (name === 'sim') { this.simMs.push(dt); this.lastSim = dt; }
    else if (name === 'present') this.presentMs.push(dt);
    return dt;
  }

  endFrame() {
    const ms = now() - this._frameStart;
    this.frameMs.push(ms);
    this.frames++;
    // A hitch is a frame more than 3x the running median, after warm-up.
    if (this.frames > 120) {
      const median = this.frameMs.percentile(0.5);
      if (median > 0 && ms > median * 3 && ms > 12) this.hitches++;
    }
  }

  sample(counters) {
    Object.assign(this.counters, counters);
    for (const k of Object.keys(this.peak)) {
      if (counters[k] !== undefined && counters[k] > this.peak[k]) this.peak[k] = counters[k];
    }
  }

  report() {
    return {
      frames: this.frames,
      frame: percentiles(this.frameMs),
      sim: percentiles(this.simMs),
      present: percentiles(this.presentMs),
      hitches: this.hitches,
      counters: { ...this.counters },
      peak: { ...this.peak },
    };
  }

  /** Deliberate stall, used by validate-validators to prove the detector works. */
  injectHitch(ms) {
    const end = now() + ms;
    while (now() < end) { /* spin */ }
  }
}

function percentiles(ring) {
  return {
    mean: +ring.mean().toFixed(3),
    p50: +ring.percentile(0.5).toFixed(3),
    p95: +ring.percentile(0.95).toFixed(3),
    p99: +ring.percentile(0.99).toFixed(3),
    worst: +ring.max().toFixed(3),
  };
}

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}
