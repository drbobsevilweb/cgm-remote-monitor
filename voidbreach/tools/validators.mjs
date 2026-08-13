// QA / validators — image and metric detectors used by the gauntlet.
//
// Each one is a pure function of pixels or numbers so that
// validate-validators.mjs can feed it a deliberately broken input and prove it
// fails. A validator that has never failed is not evidence (TEST_PLAN §2).

/** Rec.709 luminance in 0..1, from 8-bit sRGB (kept in display space on purpose:
 *  these gates are about what the player sees, not about scene-referred light). */
export function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function analyse(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  let sum = 0, black = 0, blown = 0;
  const lumas = new Float32Array(n);
  // central 60% safe box
  const bx0 = Math.floor(w * 0.2), bx1 = Math.floor(w * 0.8);
  const by0 = Math.floor(h * 0.2), by1 = Math.floor(h * 0.8);
  let boxBlack = 0, boxCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      lumas[y * w + x] = l;
      sum += l;
      const isBlack = data[i] < 2 && data[i + 1] < 2 && data[i + 2] < 2;
      if (isBlack) black++;
      if (l > 250 / 255) blown++;
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) {
        boxCount++;
        if (isBlack) boxBlack++;
      }
    }
  }
  const sorted = Float32Array.from(lumas).sort();
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  return {
    width: w, height: h,
    mean: sum / n,
    pctBlack: black / n,
    pctBlackCentre: boxCount ? boxBlack / boxCount : 0,
    pctBlown: blown / n,
    p5: pct(0.05), p50: pct(0.5), p95: pct(0.95),
    range: pct(0.95) - pct(0.05),
    lumas,
  };
}

/**
 * Aliasing energy: mean absolute second difference along X, restricted to
 * high-frequency content. A shimmering 1px chequerboard scores near the maximum;
 * a blurred image scores near zero.
 */
export function aliasing(img) {
  const { width: w, height: h, data } = img;
  let energy = 0, count = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      const lm = luma(data[i - 4], data[i - 3], data[i - 2]);
      const lp = luma(data[i + 4], data[i + 5], data[i + 6]);
      energy += Math.abs(2 * l - lm - lp);
      count++;
    }
  }
  return count ? energy / count : 0;
}

/**
 * Hue-cluster presence. Used for the colour-meaning gate: nest violet must
 * appear if and only if a nest is in frame.
 */
export function hueFraction(img, targetHue, tolerance = 22, minSat = 0.25, minVal = 0.16) {
  const { width: w, height: h, data } = img;
  let hits = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max;
    const s = max === 0 ? 0 : (max - min) / max;
    if (s < minSat || v < minVal) continue;
    let hue;
    const d = max - min;
    if (d === 0) continue;
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
    let delta = Math.abs(hue - targetHue);
    if (delta > 180) delta = 360 - delta;
    if (delta <= tolerance) hits++;
  }
  return hits / n;
}

/** Periodic signal detection: is there a repeating pattern at ~`pitchPx`? */
export function periodicity(img, region, pitchPx) {
  const { width: w, data } = img;
  const { x0, y0, x1, y1 } = region;
  let best = 0;
  for (const lag of [pitchPx - 2, pitchPx - 1, pitchPx, pitchPx + 1, pitchPx + 2]) {
    if (lag < 2) continue;
    let num = 0, denA = 0, denB = 0, count = 0;
    for (let y = y0; y < y1; y += 2) {
      let mean = 0, mn = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        mean += luma(data[i], data[i + 1], data[i + 2]); mn++;
      }
      mean /= Math.max(1, mn);
      for (let x = x0; x < x1 - lag; x++) {
        const i = (y * w + x) * 4, j = (y * w + x + lag) * 4;
        const a = luma(data[i], data[i + 1], data[i + 2]) - mean;
        const b = luma(data[j], data[j + 1], data[j + 2]) - mean;
        num += a * b; denA += a * a; denB += b * b; count++;
      }
    }
    // A flat surface has ~zero variance; normalised correlation of denormal
    // noise against itself is 1.0, which would report "grating detected" on a
    // blank floor. Require real signal before trusting the correlation.
    const variance = count ? denA / count : 0;
    if (count > 64 && variance > 1e-5 && denA > 0 && denB > 0) {
      best = Math.max(best, num / Math.sqrt(denA * denB));
    }
  }
  return best;
}

/** Vertical structure: fraction of the frame occupied by non-floor geometry. */
export function verticalStructure(img) {
  // Approximated by edge density in the upper half, where walls and machinery
  // live in this camera. A flat floor plane produces almost none.
  const { width: w, height: h, data } = img;
  let edges = 0, count = 0;
  for (let y = 2; y < Math.floor(h * 0.60); y += 2) {
    for (let x = 2; x < w - 4; x += 2) {
      const i = (y * w + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      const dy = (y + 2) * w * 4 + x * 4;
      const dx = i + 8;
      const ly = luma(data[dy], data[dy + 1], data[dy + 2]);
      const lx = luma(data[dx], data[dx + 1], data[dx + 2]);
      if (Math.abs(l - ly) > 0.035 || Math.abs(l - lx) > 0.035) edges++;
      count++;
    }
  }
  return count ? edges / count : 0;
}

// --------------------------------------------------------------- gate checks
export const GATES = {
  V1_crushedBlack: (a) => ({
    pass: a.pctBlack <= 0.35 && a.pctBlackCentre <= 0.12,
    value: `${(a.pctBlack * 100).toFixed(1)}% / centre ${(a.pctBlackCentre * 100).toFixed(1)}%`,
    limit: '<=35% / <=12%',
  }),
  V2_blownHighlights: (a, ctx = {}) => {
    const limit = ctx.bright ? 0.09 : 0.04;
    return {
      pass: a.pctBlown <= limit,
      value: `${(a.pctBlown * 100).toFixed(2)}%`,
      limit: `<=${(limit * 100).toFixed(0)}%`,
    };
  },
  V3_meanLuminance: (a, ctx = {}) => {
    const [lo, hi] = ctx.dark ? [0.02, 0.13] : [0.10, 0.42];
    return { pass: a.mean >= lo && a.mean <= hi, value: a.mean.toFixed(4), limit: `${lo}..${hi}` };
  },
  V5_contrastRange: (a) => ({
    pass: a.range >= 0.28, value: a.range.toFixed(4), limit: '>=0.28',
  }),
  V7_aliasing: (v, ctx = {}) => ({
    pass: v <= (ctx.limit ?? 0.15), value: v.toFixed(4), limit: `<=${ctx.limit ?? 0.15}`,
  }),
  C4_verticalStructure: (v) => ({
    pass: v >= 0.12, value: v.toFixed(4), limit: '>=0.12',
  }),
  C5_gratingPattern: (v) => ({
    pass: v >= 0.25, value: v.toFixed(4), limit: '>=0.25',
  }),
  V8_nestColour: (frac, ctx = {}) => ({
    pass: ctx.nestInFrame ? frac >= 0.0008 : frac <= 0.0008,
    value: (frac * 100).toFixed(4) + '%',
    limit: ctx.nestInFrame ? 'present' : 'absent',
  }),
  P1_drawCalls: (v) => ({ pass: v <= 220, value: String(v), limit: '<=220' }),
  P2_triangles: (v) => ({ pass: v <= 900000, value: String(v), limit: '<=900k' }),
  P3_lights: (v) => ({ pass: v <= 11, value: String(v), limit: '<=11' }),
  P4_simTime: (v) => ({ pass: v <= 4.0, value: v.toFixed(2) + 'ms', limit: '<=4.0ms' }),
  P7_shaderCompiles: (v) => ({ pass: v === 0, value: String(v), limit: '0' }),
};

export const NEST_VIOLET_HUE = 292;   // PAL.violet #c23bd8
