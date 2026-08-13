// CORE / Clock + FixedLoop — the single source of time (ARCHITECTURE §3.1).
//
// Nothing outside this file may read performance.now() for simulation purposes.
// `simTime` is the only time value passed to gameplay, animation and shaders.

export const STEP = 1 / 60;
export const MAX_STEPS = 5;

export class Clock {
  constructor() {
    this.simTime = 0;       // seconds of simulated time (deterministic)
    this.frame = 0;         // rendered frames
    this.step = 0;          // simulation steps executed
    this.alpha = 0;         // interpolation factor for rendering
    this.timeScale = 1;     // slow-motion for cinematic beats
    this.accumulator = 0;
    this.realDelta = 0;     // wall-clock delta of last frame (profiling only)
    this.paused = false;
  }

  /** Advance the accumulator by a wall-clock delta and return the step count to run. */
  begin(realDeltaSeconds) {
    this.realDelta = realDeltaSeconds;
    if (this.paused) { this.alpha = 1; return 0; }
    this.accumulator += Math.min(realDeltaSeconds, 0.25) * this.timeScale;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.accumulator -= STEP;
      steps++;
    }
    if (this.accumulator > STEP * MAX_STEPS) this.accumulator = 0; // give up on huge stalls
    return steps;
  }

  advance() { this.simTime += STEP; this.step++; }
  endFrame() { this.alpha = this.accumulator / STEP; this.frame++; }
}

/**
 * DeterministicClock — used by ?test=replay and ?shot=. Ignores wall time entirely:
 * every rendered frame advances exactly one fixed step. Guarantees a headless run
 * and a live run produce the same simulation.
 */
export class DeterministicClock extends Clock {
  begin() { this.realDelta = STEP; return this.paused ? 0 : 1; }
  endFrame() { this.alpha = 1; this.frame++; }
}
