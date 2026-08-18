// ENVIRONMENT / Textures — every surface in VOIDBREACH is generated at boot.
//
// No binary assets (ARCHITECTURE §1). Each material produces three maps from one
// authoring pass: albedo, ORM (r=AO, g=roughness, b=metalness — three.js reads
// roughnessMap.g and metalnessMap.b, so one texture serves both) and a normal map
// derived from the height channel by Sobel.
//
// The dimensions here are the construction language of DIRECTION §7. Changing a
// number here changes the whole station, which is the point.

import * as THREE from '../../vendor/three.module.js';
import { fbm2, valueNoise2, clamp01 } from '../core/Mathx.js';

const SIZE = 512;              // texels per tile
const TILE = 2.5;              // metres per tile — one grid cell
const PPM = SIZE / TILE;       // ~205 px per metre


/**
 * Every number that defines how the station looks, as DATA rather than as
 * literals buried in drawing code. The Studio (studio.html) edits a copy of
 * this and hands it back; the game merges any saved overrides at boot.
 *
 * Dimensions in metres are the construction language of DIRECTION §7 — change
 * `panel` here and every wall in the sector changes with it.
 */
export const TEXTURE_DEFAULTS = {
  steel: {
    base: '#616a75', rough: 0.58, metal: 0.22,
    panel: 1.25, seam: 0.008, inset: 0.04,
    rivetSpacing: 0.30, rivetSize: 0.022,
    scratches: 46, scratchBright: 0.28,
    grime: 0.38, grimeTint: '#141a1e', streaks: true,
    normalStrength: 2.0,
  },
  deck: {
    base: '#5a626c', rough: 0.66, metal: 0.18,
    plate: 1.25, tread: 0.125, treadStrength: 0.20,
    scratches: 70, scratchBright: 0.22,
    grime: 0.50, grimeTint: '#141a1e', streaks: false,
    wear: 1.0,
    normalStrength: 1.3,
  },
  painted: {
    base: '#7a7d78', rough: 0.60, metal: 0.08,
    rib: 0.20, chips: 150,
    scratches: 60, scratchBright: 0.30,
    grime: 0.55, grimeTint: '#2a2117', streaks: true,
    normalStrength: 1.5,
  },
  ceramic: {
    base: '#7d858c', rough: 0.80, metal: 0.02,
    panel: 0.625,
    scratches: 30, scratchBright: 0.18,
    grime: 0.70, grimeTint: '#1b1a16', streaks: true,
    normalStrength: 1.0,
  },
  flesh: {
    base: '#43264a', rough: 0.34,
    blotchScale: 4.5, veins: 26, veinColour: '#b43cc8',
    pustules: 70, pustuleColour: '#d778eb',
    normalStrength: 2.4,
  },
  hazard: {
    colA: '#f0a63a', colB: '#16181c', pitch: 0.2,
    rough: 0.58, metal: 0.10, grime: 0.55,
    normalStrength: 0.6,
  },
  // SILK. Deliberately not violet: violet means "alive and spawning" and
  // nothing else (DIRECTION §5.5), and silk is neither. It is a near-white
  // dielectric whose entire job is to take on the colour of whatever light
  // finds it — amber under a work lamp, red under an alarm.
  silk: {
    base: '#d8dee6', rough: 0.24,
    threads: 34, threadWidth: 0.011, crossThreads: 22,
    fuzz: 260, fuzzAlpha: 0.13,
    beads: 90, beadAlpha: 0.5,
    normalStrength: 0.7,
  },
};

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

class TexGen {
  constructor(rng, size = SIZE, tile = TILE) {
    this.rng = rng;
    this.size = size;
    this.tile = tile;
    this.ppm = size / tile;
    this.albedo = canvas(size);
    this.height = canvas(size);
    this.orm = canvas(size);
    this.a = this.albedo.getContext('2d');
    this.h = this.height.getContext('2d');
    this.o = this.orm.getContext('2d');
  }

  m(v) { return v * this.ppm; }   // metres -> pixels

  base(albedoHex, heightGrey, rough, metal, ao = 1) {
    this.a.fillStyle = albedoHex; this.a.fillRect(0, 0, this.size, this.size);
    this.h.fillStyle = grey(heightGrey); this.h.fillRect(0, 0, this.size, this.size);
    this.o.fillStyle = rgb(ao, rough, metal); this.o.fillRect(0, 0, this.size, this.size);
  }

  /** Per-pixel pass with access to all three targets. fn(x,y) -> {a,h,r,m,ao} deltas */
  pixels(fn) {
    const s = this.size;
    const ai = this.a.getImageData(0, 0, s, s), ad = ai.data;
    const hi = this.h.getImageData(0, 0, s, s), hd = hi.data;
    const oi = this.o.getImageData(0, 0, s, s), od = oi.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        fn(x, y, ad, hd, od, i);
      }
    }
    this.a.putImageData(ai, 0, 0);
    this.h.putImageData(hi, 0, 0);
    this.o.putImageData(oi, 0, 0);
  }

  /** Seamless fbm sampled in tile space (wraps because we sample a torus). */
  noise(x, y, scale, octaves = 4, seed = 0) {
    const s = this.size;
    // torus sampling for seamlessness
    const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
    const nx = Math.cos(u) * scale, ny = Math.sin(u) * scale;
    const nz = Math.cos(v) * scale, nw = Math.sin(v) * scale;
    return fbm2(nx + nz * 1.7, ny + nw * 1.3, octaves, seed);
  }

  finish(name, { normalStrength = 1.6, srgb = true } = {}) {
    const map = new THREE.CanvasTexture(this.albedo);
    map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    map.name = name + '_albedo';

    const orm = new THREE.CanvasTexture(this.orm);
    orm.colorSpace = THREE.NoColorSpace;
    orm.wrapS = orm.wrapT = THREE.RepeatWrapping;
    orm.anisotropy = 4;
    orm.name = name + '_orm';

    const normal = new THREE.CanvasTexture(heightToNormal(this.height, normalStrength));
    normal.colorSpace = THREE.NoColorSpace;
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.anisotropy = 4;
    normal.name = name + '_normal';

    return { map, orm, normal };
  }
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function grey(v) { const c = Math.round(clamp01(v) * 255); return `rgb(${c},${c},${c})`; }
function rgb(r, g, b) {
  return `rgb(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)})`;
}

function heightToNormal(heightCanvas, strength) {
  const s = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, s, s).data;
  const out = canvas(s);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(s, s);
  const d = img.data;
  const at = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const l = at(x - 1, y), r = at(x + 1, y);
      const u = at(x, y - 1), dn = at(x, y + 1);
      let nx = (l - r) * strength * 4;
      let ny = (u - dn) * strength * 4;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * s + x) * 4;
      d[i] = ((nx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// ---------------------------------------------------------------- surfaces

/** Rivets along a line, at the construction-language spacing of 300 mm. */
function rivets(g, x0, y0, x1, y1, spacing = 0.3, r = 0.022) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.round(len / g.m(spacing)));
  const rr = g.m(r);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + dx * t, y = y0 + dy * t;
    g.h.fillStyle = grey(0.72);
    g.h.beginPath(); g.h.arc(x, y, rr, 0, Math.PI * 2); g.h.fill();
    g.a.fillStyle = 'rgba(168,176,188,0.34)';
    g.a.beginPath(); g.a.arc(x, y, rr, 0, Math.PI * 2); g.a.fill();
    g.a.fillStyle = 'rgba(0,0,0,0.35)';
    g.a.beginPath(); g.a.arc(x, y + rr * 0.5, rr * 0.9, 0, Math.PI * 2); g.a.fill();
  }
}

function grimeAndWear(g, { grime = 0.55, streaks = true, seed = 0, dirt = '#141a1e' } = {}) {
  const s = g.size;
  // vertical grime streaks from seams and fixtures
  if (streaks) {
    g.a.save();
    for (let i = 0; i < 26; i++) {
      const x = g.rng.next() * s;
      const w = g.rng.range(2, 14);
      const top = g.rng.next() * s * 0.6;
      const len = g.rng.range(s * 0.15, s * 0.7);
      const grad = g.a.createLinearGradient(0, top, 0, top + len);
      grad.addColorStop(0, 'rgba(10,14,17,0.34)');
      grad.addColorStop(1, 'rgba(10,14,17,0)');
      g.a.fillStyle = grad;
      g.a.fillRect(x, top, w, len);
    }
    g.a.restore();
  }
  // blotchy grime + roughness response
  const dr = parseInt(dirt.slice(1, 3), 16), dg = parseInt(dirt.slice(3, 5), 16), db = parseInt(dirt.slice(5, 7), 16);
  g.pixels((x, y, ad, hd, od, i) => {
    const n = g.noise(x, y, 3.1, 4, seed);
    const n2 = g.noise(x, y, 11.0, 3, seed + 31);
    const dirtAmt = clamp01((n - 0.42) * 1.9) * grime + n2 * 0.10 * grime;
    ad[i] = ad[i] * (1 - dirtAmt) + dr * dirtAmt;
    ad[i + 1] = ad[i + 1] * (1 - dirtAmt) + dg * dirtAmt;
    ad[i + 2] = ad[i + 2] * (1 - dirtAmt) + db * dirtAmt;
    od[i + 1] = Math.min(255, od[i + 1] + dirtAmt * 150);   // grime is rough
    od[i + 2] = Math.max(0, od[i + 2] - dirtAmt * 170);     // and not metal
    od[i] = Math.max(0, od[i] - dirtAmt * 40);              // and occludes
  });
}

function scratches(g, count = 40, bright = 0.35) {
  g.a.save();
  g.a.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = g.rng.next() * g.size, y = g.rng.next() * g.size;
    const a = g.rng.next() * Math.PI * 2;
    const len = g.rng.range(6, 70);
    g.a.strokeStyle = `rgba(180,192,205,${g.rng.range(0.05, bright)})`;
    g.a.lineWidth = g.rng.range(0.6, 1.8);
    g.a.beginPath();
    g.a.moveTo(x, y);
    g.a.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.a.stroke();
  }
  g.a.restore();
}

/** STEEL — the station's wall panel. 1.25 m panels, 40 mm rivets at 300 mm. */
function steelWall(rng, p) {
  const g = new TexGen(rng);
  g.base(p.base, 0.55, p.rough, p.metal, 1.0);
  const panel = g.m(p.panel);
  const seam = Math.max(2, g.m(p.seam));

  // recessed panel field
  for (let py = 0; py < g.size; py += panel) {
    for (let px = 0; px < g.size; px += panel) {
      const inset = g.m(p.inset);
      g.h.fillStyle = grey(0.62);
      g.h.fillRect(px + inset, py + inset, panel - inset * 2, panel - inset * 2);
      const v = rng.range(-0.03, 0.05);
      const bc = hexToRgb(p.base);
      g.a.fillStyle = `rgba(${Math.round(bc[0] + v * 255)},${Math.round(bc[1] + v * 255)},${Math.round(bc[2] + v * 255)},1)`;
      g.a.fillRect(px + inset, py + inset, panel - inset * 2, panel - inset * 2);
    }
  }
  // seams
  g.h.fillStyle = grey(0.30);
  g.a.fillStyle = 'rgba(14,18,23,0.95)';
  for (let q = 0; q <= g.size; q += panel) {
    g.h.fillRect(q - seam / 2, 0, seam, g.size);
    g.h.fillRect(0, q - seam / 2, g.size, seam);
    g.a.fillRect(q - seam / 2, 0, seam, g.size);
    g.a.fillRect(0, q - seam / 2, g.size, seam);
  }
  // rivet lines along every seam
  for (let q = 0; q <= g.size; q += panel) {
    rivets(g, q + g.m(0.06), 0, q + g.m(0.06), g.size, p.rivetSpacing, p.rivetSize);
    rivets(g, 0, q + g.m(0.06), g.size, q + g.m(0.06), p.rivetSpacing, p.rivetSize);
  }
  scratches(g, p.scratches, p.scratchBright);
  grimeAndWear(g, { grime: p.grime, dirt: p.grimeTint, streaks: p.streaks, seed: 7 });
  return g.finish('steel', { normalStrength: p.normalStrength });
}

/** DECK PLATE — 1.25 m plates, diamond tread, worn along traffic lines. */
function deckPlate(rng, p) {
  const g = new TexGen(rng);
  g.base(p.base, 0.5, p.rough, p.metal, 1.0);
  const plate = g.m(p.plate);
  const step = g.m(p.tread);
  g.a.save(); g.h.save();
  for (let y = 0; y < g.size + step; y += step) {
    for (let x = 0; x < g.size + step; x += step) {
      const ox = ((y / step) | 0) % 2 ? step * 0.5 : 0;
      const cx = x + ox, cy = y;
      const r = step * 0.30;
      for (const [ctx, fill] of [[g.a, `rgba(120,130,142,${p.treadStrength})`], [g.h, grey(0.70)]]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((x + y) / step | 0) % 2 ? 0.6 : -0.6);
        ctx.fillStyle = fill;
        ctx.fillRect(-r * 1.7, -r * 0.45, r * 3.4, r * 0.9);
        ctx.restore();
      }
    }
  }
  g.a.restore(); g.h.restore();
  // plate seams
  g.h.fillStyle = grey(0.24);
  g.a.fillStyle = 'rgba(12,16,20,0.95)';
  for (let q = 0; q <= g.size; q += plate) {
    g.h.fillRect(q - 2, 0, 4, g.size); g.h.fillRect(0, q - 2, g.size, 4);
    g.a.fillRect(q - 2, 0, 4, g.size); g.a.fillRect(0, q - 2, g.size, 4);
  }
  rivets(g, g.m(0.08), g.m(0.08), g.size - g.m(0.08), g.m(0.08), 0.4, 0.018);
  // traffic wear: a smoother, brighter band
  g.pixels((x, y, ad, hd, od, i) => {
    const wear = clamp01(g.noise(x, y, 1.7, 3, 91) * 1.5 - 0.45) * p.wear;
    ad[i] += wear * 26; ad[i + 1] += wear * 28; ad[i + 2] += wear * 30;
    od[i + 1] = Math.max(0, od[i + 1] - wear * 90);
  });
  scratches(g, p.scratches, p.scratchBright);
  grimeAndWear(g, { grime: p.grime, dirt: p.grimeTint, streaks: p.streaks, seed: 13 });
  return g.finish('deck', { normalStrength: p.normalStrength });
}

/** PAINTED — containers, machinery housings. Tinted per mesh by vertex colour. */
function paintedMetal(rng, p) {
  const g = new TexGen(rng);
  g.base(p.base, 0.55, p.rough, p.metal, 1.0);
  // corrugation, the language of a shipping container
  const rib = g.m(p.rib);
  for (let x = 0; x < g.size; x += rib) {
    const grad = g.a.createLinearGradient(x, 0, x + rib, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.22)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.a.fillStyle = grad; g.a.fillRect(x, 0, rib, g.size);
    const hg = g.h.createLinearGradient(x, 0, x + rib, 0);
    hg.addColorStop(0, grey(0.35)); hg.addColorStop(0.5, grey(0.75)); hg.addColorStop(1, grey(0.35));
    g.h.fillStyle = hg; g.h.fillRect(x, 0, rib, g.size);
  }
  // paint chips revealing steel
  for (let i = 0; i < p.chips; i++) {
    const x = rng.next() * g.size, y = rng.next() * g.size;
    const r = rng.range(1.5, 9);
    g.a.fillStyle = `rgba(58,52,46,${rng.range(0.35, 0.85)})`;
    g.a.beginPath(); g.a.ellipse(x, y, r, r * rng.range(0.5, 1.4), rng.angle(), 0, Math.PI * 2); g.a.fill();
  }
  scratches(g, p.scratches, p.scratchBright);
  grimeAndWear(g, { grime: p.grime, seed: 23, dirt: p.grimeTint, streaks: p.streaks });
  return g.finish('painted', { normalStrength: p.normalStrength });
}

/** CERAMIC — pale composite panelling for habitation and control spaces. */
function ceramicPanel(rng, p) {
  const g = new TexGen(rng);
  g.base(p.base, 0.55, p.rough, p.metal, 1.0);
  const panel = g.m(p.panel);
  g.a.strokeStyle = 'rgba(20,24,28,0.75)';
  g.a.lineWidth = 2;
  g.h.strokeStyle = grey(0.32); g.h.lineWidth = 3;
  for (let q = 0; q <= g.size; q += panel) {
    g.a.beginPath(); g.a.moveTo(q, 0); g.a.lineTo(q, g.size); g.a.stroke();
    g.a.beginPath(); g.a.moveTo(0, q); g.a.lineTo(g.size, q); g.a.stroke();
    g.h.beginPath(); g.h.moveTo(q, 0); g.h.lineTo(q, g.size); g.h.stroke();
    g.h.beginPath(); g.h.moveTo(0, q); g.h.lineTo(g.size, q); g.h.stroke();
  }
  scratches(g, p.scratches, p.scratchBright);
  grimeAndWear(g, { grime: p.grime, seed: 37, dirt: p.grimeTint, streaks: p.streaks });
  return g.finish('ceramic', { normalStrength: p.normalStrength });
}

/** CHORUSFLESH — the infestation. Wet, violet, veined. Never used elsewhere. */
function chorusFlesh(rng, p) {
  const g = new TexGen(rng);
  g.base(p.base, 0.5, p.rough, 0.0, 0.85);
  const bc = hexToRgb(p.base);
  const vc = hexToRgb(p.veinColour);
  const pc = hexToRgb(p.pustuleColour);
  // blotchy mass
  g.pixels((x, y, ad, hd, od, i) => {
    const n = g.noise(x, y, p.blotchScale, 5, 5);
    const n2 = g.noise(x, y, 14.0, 3, 55);
    const v = n * 0.8 + n2 * 0.2;
    ad[i] = bc[0] * 0.6 + v * bc[0] * 1.3;
    ad[i + 1] = bc[1] * 0.6 + v * bc[1] * 1.3;
    ad[i + 2] = bc[2] * 0.6 + v * bc[2] * 1.3;
    hd[i] = hd[i + 1] = hd[i + 2] = 60 + v * 150;
    od[i + 1] = 40 + (1 - v) * 90;      // wetter in the hollows
    od[i] = 150 + v * 80;
  });
  // veins: branching bright lines
  g.a.save();
  g.a.lineCap = 'round';
  for (let i = 0; i < p.veins; i++) {
    let x = rng.next() * g.size, y = rng.next() * g.size;
    let a = rng.angle();
    let w = rng.range(1.5, 5);
    g.a.beginPath(); g.a.moveTo(x, y);
    g.h.beginPath(); g.h.moveTo(x, y);
    for (let k = 0; k < 16; k++) {
      a += rng.range(-0.55, 0.55);
      x += Math.cos(a) * 10; y += Math.sin(a) * 10;
      g.a.lineTo(x, y); g.h.lineTo(x, y);
    }
    g.a.strokeStyle = `rgba(${vc[0] + rng.int(0, 40)},${vc[1]},${vc[2]},0.30)`;
    g.a.lineWidth = w; g.a.stroke();
    g.h.strokeStyle = grey(0.85); g.h.lineWidth = w * 1.2; g.h.stroke();
  }
  // pustules
  for (let i = 0; i < p.pustules; i++) {
    const x = rng.next() * g.size, y = rng.next() * g.size, r = rng.range(3, 14);
    const grad = g.a.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, `rgba(${pc[0]},${pc[1]},${pc[2]},0.55)`);
    grad.addColorStop(1, 'rgba(60,20,70,0.0)');
    g.a.fillStyle = grad;
    g.a.beginPath(); g.a.arc(x, y, r, 0, Math.PI * 2); g.a.fill();
    g.h.fillStyle = grey(0.9);
    g.h.beginPath(); g.h.arc(x, y, r * 0.7, 0, Math.PI * 2); g.h.fill();
  }
  g.a.restore();
  return g.finish('flesh', { normalStrength: p.normalStrength });
}

/**
 * SILK — the only texture in the station with an alpha channel.
 *
 * Everything else here paints a surface. This paints a *mask*: the holes are
 * the point. Silk is drawn as threads on transparent, so a single flat quad
 * becomes a net, and the net reading comes from the texture rather than from
 * geometry — which is the only way to afford webbing across a whole sector.
 *
 * Because it is alpha-TESTED rather than alpha-blended it still writes depth,
 * so a dozen overlapping layers of web need no sorting and cost nothing to get
 * right. The cost of that choice is that the threads have to be bold enough to
 * survive minification: at 512 px over a 2.5 m tile these are about 1 cm of
 * rope, which is far thicker than real silk and the only honest way to keep a
 * web legible twenty metres from the camera.
 *
 * Everything is drawn nine times, offset by ±one tile, so every thread that
 * leaves an edge arrives back on the opposite one and the tile is seamless.
 */
function silkWeb(rng, p) {
  const g = new TexGen(rng);
  const s = g.size;
  // Transparent albedo; the other two maps are only ever read where a thread
  // survives the alpha test, so their background merely has to be sane.
  g.a.clearRect(0, 0, s, s);
  g.h.fillStyle = grey(0.5); g.h.fillRect(0, 0, s, s);
  g.o.fillStyle = rgb(1, p.rough, 0); g.o.fillRect(0, 0, s, s);

  const wrapped = (draw) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        g.a.save(); g.h.save();
        g.a.translate(ox * s, oy * s); g.h.translate(ox * s, oy * s);
        draw();
        g.a.restore(); g.h.restore();
      }
    }
  };

  g.a.lineCap = 'round'; g.h.lineCap = 'round';

  /** One thread: a slack line that wanders, drawn into albedo and height. */
  const thread = (x0, y0, x1, y1, width, alpha, sagPx) => {
    const segs = 9;
    const nx = -(y1 - y0), ny = (x1 - x0);
    const nl = Math.hypot(nx, ny) || 1;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // A parabola, not a straight line. A web under gravity has no straight
      // edges anywhere, and a straight thread instantly reads as wire.
      const sag = sagPx * 4 * t * (1 - t);
      pts.push([
        x0 + (x1 - x0) * t + (nx / nl) * sag + rng.range(-1.4, 1.4),
        y0 + (y1 - y0) * t + (ny / nl) * sag + rng.range(-1.4, 1.4),
      ]);
    }
    wrapped(() => {
      for (const [ctx, style, w] of [
        [g.a, `rgba(236,242,250,${alpha})`, width],
        [g.h, grey(0.92), width * 1.35],
      ]) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = style; ctx.lineWidth = w; ctx.stroke();
      }
    });
  };

  // Long structural threads, edge to edge, at every angle.
  const w = g.m(p.threadWidth);
  for (let i = 0; i < p.threads; i++) {
    const horizontal = rng.bool();
    const a = rng.next() * s, b = rng.next() * s;
    if (horizontal) thread(-s * 0.1, a, s * 1.1, b, w * rng.range(0.7, 1.5), rng.range(0.7, 1), rng.range(-26, 26));
    else thread(a, -s * 0.1, b, s * 1.1, w * rng.range(0.7, 1.5), rng.range(0.7, 1), rng.range(-26, 26));
  }
  // Shorter cross-threads tie the structural ones into a mesh rather than a
  // pile of parallel lines.
  for (let i = 0; i < p.crossThreads; i++) {
    const x = rng.next() * s, y = rng.next() * s;
    const a = rng.angle(), len = rng.range(s * 0.12, s * 0.42);
    thread(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len,
      w * rng.range(0.5, 0.9), rng.range(0.5, 0.85), rng.range(-14, 14));
  }
  // Fuzz: the loose broken ends that make silk look abandoned rather than
  // engineered. Very faint — these mostly die at the alpha test and what
  // survives is a suggestion of lint.
  for (let i = 0; i < p.fuzz; i++) {
    const x = rng.next() * s, y = rng.next() * s;
    const a = rng.angle(), len = rng.range(4, 22);
    thread(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, w * 0.45, p.fuzzAlpha, 0);
  }
  // Beads. Real silk carries condensate, and a thread with nodes on it reads
  // as organic where a clean thread reads as netting. They are also the part
  // that catches a lamp.
  for (let i = 0; i < p.beads; i++) {
    const x = rng.next() * s, y = rng.next() * s, r = rng.range(1.2, 3.4);
    wrapped(() => {
      g.a.fillStyle = `rgba(246,250,255,${p.beadAlpha})`;
      g.a.beginPath(); g.a.arc(x, y, r, 0, Math.PI * 2); g.a.fill();
      g.h.fillStyle = grey(1.0);
      g.h.beginPath(); g.h.arc(x, y, r * 0.8, 0, Math.PI * 2); g.h.fill();
    });
  }

  // Roughness follows the threads: the beads and thread crowns are the shiny
  // part, the fuzz is not.
  const ai = g.a.getImageData(0, 0, s, s).data;
  const oi = g.o.getImageData(0, 0, s, s), od = oi.data;
  for (let i = 0; i < od.length; i += 4) {
    const cover = ai[i + 3] / 255;
    od[i] = 255;                                        // AO: silk is unoccluded
    od[i + 1] = Math.round((p.rough + (1 - cover) * 0.45) * 255);
    od[i + 2] = 0;                                      // never metal
  }
  g.o.putImageData(oi, 0, 0);

  return g.finish('silk', { normalStrength: p.normalStrength });
}

/** HAZARD — 45 degree stripes at 200 mm. Tile is 1 m, not 2.5 m. */
function hazardStripe(rng, p) {
  const g = new TexGen(rng, 256, 1.0);
  const colA = p.colA, colB = p.colB;
  g.base(colB, 0.6, p.rough, p.metal, 1.0);
  const pitch = g.m(p.pitch);
  g.a.save();
  g.a.translate(g.size / 2, g.size / 2); g.a.rotate(Math.PI / 4); g.a.translate(-g.size, -g.size);
  g.a.fillStyle = colA;
  for (let x = 0; x < g.size * 2; x += pitch * 2) g.a.fillRect(x, 0, pitch, g.size * 2);
  g.a.restore();
  scratches(g, 24, 0.25);
  grimeAndWear(g, { grime: p.grime, streaks: false, seed: 77 });
  return g.finish('hazard', { normalStrength: p.normalStrength });
}

/** SCREEN — emissive console face. Returns an extra emissive map. */
function screenFace(rng) {
  const c = canvas(256);
  const x = c.getContext('2d');
  x.fillStyle = '#04161d'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#5fd8ff';
  for (let i = 0; i < 26; i++) {
    const y = 12 + i * 9;
    if (rng.bool(0.25)) continue;
    x.globalAlpha = rng.range(0.25, 0.95);
    x.fillRect(14, y, rng.range(20, 200), rng.range(1.5, 3.5));
  }
  x.globalAlpha = 0.85;
  x.fillStyle = '#ff6a4a';
  x.fillRect(14, 220, 120, 12);
  x.globalAlpha = 0.18;
  for (let y = 0; y < 256; y += 3) { x.fillStyle = '#000'; x.fillRect(0, y, 256, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Radial light-pool decal with grating shadow bars baked in (DIRECTION §6). */
function lightPool(rng, withBars) {
  const s = 256;
  const c = canvas(s);
  const x = c.getContext('2d');
  // Falloff is baked into RGB against black, not into alpha: the pool is drawn
  // with additive blending, where black contributes nothing. Alpha-modulated
  // additive is fragile across premultiplication paths; this is not.
  x.fillStyle = '#000'; x.fillRect(0, 0, s, s);
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.30, 'rgba(150,150,150,1)');
  g.addColorStop(0.62, 'rgba(46,46,46,1)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  if (withBars) {
    // 250 mm grating pitch projected across the pool -> 20 bars of shadow
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = 'rgba(30,30,30,1)';
    const pitch = s / 20;
    for (let i = 0; i < 20; i++) x.fillRect(i * pitch, 0, pitch * 0.34, s);
    x.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * The shadow a catwalk grating throws on the deck below it.
 *
 * This is the DIRECTION §6 signature, solved the only way it can be solved in a
 * forward renderer with one shadow-casting light: the catwalk is real geometry
 * overhead, and its shadow is a MULTIPLY layer projected onto the floor. White
 * is "unshadowed" and multiplies to nothing; the bars darken.
 *
 * Softness is baked in rather than filtered at runtime. A grating four metres
 * up, lit by a fixture two metres above THAT, throws an edge that is a good
 * 60 mm of penumbra by the time it reaches the deck — a hard-edged stripe reads
 * as a decal, and a soft one reads as light.
 */
function catwalkShadow(rng) {
  const s = 512;
  const c = canvas(s);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, s, s);

  // 250 mm bar pitch, projected: the tile is 2.5 m of FLOOR, and the projection
  // from a lamp 2 m above a 4 m catwalk magnifies it by 1.5.
  const bars = 7;
  const pitch = s / bars;
  const w = pitch * 0.40;
  // The bars are a MODULATION, not the shadow. How dark the band gets is decided
  // per vertex by how much light is actually falling there; if the texture also
  // goes near-black the two multiply together and the deck turns into a painted
  // ladder with hard rungs. Blur is heavy for the same reason — four metres of
  // throw from a two-metre-wide fixture is most of a bar-width of penumbra.
  x.filter = 'blur(9px)';
  x.fillStyle = 'rgba(108,112,124,1)';
  for (let i = 0; i < bars; i++) x.fillRect(i * pitch + pitch * 0.3, -8, w, s + 16);
  // cross-bracing every metre, thinner and lighter: it is further from the deck
  x.fillStyle = 'rgba(168,172,182,1)';
  for (let i = 0; i < 3; i++) x.fillRect(-8, i * (s / 3) + s / 9, s + 16, s * 0.055);
  x.filter = 'none';

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A shaft of light: the vertical gradient and the stripe the catwalk cuts into
 * it. Drawn additively, so — like the light pools — the falloff lives in RGB
 * against black rather than in alpha (see lightPool for why).
 *
 * V runs from the fixture at the top to the deck at the bottom. The shaft is
 * brightest just under the lamp and gone before it lands, because a volume of
 * dust scatters most where the light is densest, and because a shaft that
 * reaches the floor at full strength hides the floor.
 */
function lightShaft(rng) {
  const s = 256;
  const c = canvas(s);
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, s, s);
  const g = x.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(190,190,190,1)');
  g.addColorStop(0.52, 'rgba(64,64,64,1)');
  g.addColorStop(0.84, 'rgba(12,12,12,1)');
  g.addColorStop(1.00, 'rgba(0,0,0,1)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);

  // The same grating that shadows the deck also slices the shaft. This is what
  // makes the two features read as one fact about the room rather than as two
  // unrelated effects.
  x.globalCompositeOperation = 'multiply';
  x.filter = 'blur(2px)';
  const bars = 7, pitch = s / bars;
  x.fillStyle = 'rgba(38,38,38,1)';
  for (let i = 0; i < bars; i++) x.fillRect(i * pitch + pitch * 0.3, 0, pitch * 0.40, s);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-over';

  // Soften the vertical edges so the shaft has no visible silhouette.
  x.globalCompositeOperation = 'multiply';
  const e = x.createLinearGradient(0, 0, s, 0);
  e.addColorStop(0.00, 'rgba(0,0,0,1)');
  e.addColorStop(0.13, 'rgba(255,255,255,1)');
  e.addColorStop(0.87, 'rgba(255,255,255,1)');
  e.addColorStop(1.00, 'rgba(0,0,0,1)');
  x.fillStyle = e; x.fillRect(0, 0, s, s);
  x.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Soft particle sprite (dust, smoke, spark) — one atlas row of 4. */
function particleAtlas() {
  const s = 256, c = canvas(s), x = c.getContext('2d');
  x.clearRect(0, 0, s, s);
  const cell = s / 2;
  // 0: soft round (dust/smoke)
  let g = x.createRadialGradient(cell * 0.5, cell * 0.5, 0, cell * 0.5, cell * 0.5, cell * 0.48);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, cell, cell);
  // 1: hard spark point
  g = x.createRadialGradient(cell * 1.5, cell * 0.5, 0, cell * 1.5, cell * 0.5, cell * 0.42);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(cell, 0, cell, cell);
  // 2: fluid blob
  x.save(); x.translate(cell * 0.5, cell * 1.5);
  g = x.createRadialGradient(0, 0, 0, 0, 0, cell * 0.45);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.72, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, cell * 0.34, cell * 0.44, 0, 0, Math.PI * 2); x.fill();
  x.restore();
  // 3: streak / tracer
  x.save(); x.translate(cell * 1.5, cell * 1.5);
  g = x.createLinearGradient(-cell * 0.45, 0, cell * 0.45, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.beginPath(); x.ellipse(0, 0, cell * 0.46, cell * 0.10, 0, 0, Math.PI * 2); x.fill();
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Impact decals: 0 metal pit, 1 ceramic chip, 2 scorch, 3 fluid splat. */
function decalAtlas(rng) {
  const s = 512, c = canvas(s), x = c.getContext('2d');
  x.clearRect(0, 0, s, s);
  const cell = s / 2;
  const draw = (cx, cy, fn) => { x.save(); x.translate(cx, cy); fn(); x.restore(); };
  // metal pit: dark centre, bright torn rim
  draw(cell * 0.5, cell * 0.5, () => {
    let g = x.createRadialGradient(0, 0, 0, 0, 0, cell * 0.30);
    g.addColorStop(0, 'rgba(8,9,11,0.95)'); g.addColorStop(0.62, 'rgba(30,33,38,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, cell * 0.3, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(190,200,215,0.55)'; x.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = rng.angle(), r0 = cell * 0.09, r1 = cell * rng.range(0.13, 0.26);
      x.beginPath(); x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); x.stroke();
    }
  });
  // ceramic chip: pale crater with radial cracks
  draw(cell * 1.5, cell * 0.5, () => {
    let g = x.createRadialGradient(0, 0, 0, 0, 0, cell * 0.32);
    g.addColorStop(0, 'rgba(205,208,210,0.85)'); g.addColorStop(0.5, 'rgba(120,124,128,0.55)');
    g.addColorStop(1, 'rgba(90,94,98,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, cell * 0.32, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(20,22,26,0.5)'; x.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const a = rng.angle();
      x.beginPath(); x.moveTo(0, 0);
      let px = 0, py = 0, aa = a;
      for (let k = 0; k < 4; k++) { aa += rng.range(-0.3, 0.3); px += Math.cos(aa) * cell * 0.07; py += Math.sin(aa) * cell * 0.07; x.lineTo(px, py); }
      x.stroke();
    }
  });
  // scorch
  draw(cell * 0.5, cell * 1.5, () => {
    for (let i = 0; i < 22; i++) {
      const a = rng.angle(), r = cell * rng.range(0.06, 0.42);
      const g2 = x.createRadialGradient(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, 0,
        Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.7);
      g2.addColorStop(0, 'rgba(10,9,8,0.55)'); g2.addColorStop(1, 'rgba(10,9,8,0)');
      x.fillStyle = g2;
      x.beginPath(); x.arc(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.7, 0, Math.PI * 2); x.fill();
    }
  });
  // fluid splat
  draw(cell * 1.5, cell * 1.5, () => {
    x.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 16; i++) {
      const a = rng.angle(), r = cell * rng.range(0.0, 0.34);
      const rr = cell * rng.range(0.02, 0.10);
      x.beginPath(); x.ellipse(Math.cos(a) * r, Math.sin(a) * r, rr, rr * rng.range(0.6, 1.5), a, 0, Math.PI * 2); x.fill();
    }
    x.beginPath(); x.ellipse(0, 0, cell * 0.17, cell * 0.14, 0, 0, Math.PI * 2); x.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * @param params  material parameter set; defaults to TEXTURE_DEFAULTS. The
 *                Studio passes an edited copy, and GAME merges any saved
 *                overrides (ignored in deterministic runs — see Overrides.js).
 */
export function buildTextures(rng, params) {
  const r = rng.child('textures');
  const P = params || TEXTURE_DEFAULTS;
  const m = (k) => ({ ...TEXTURE_DEFAULTS[k], ...(P[k] || {}) });
  return {
    steel: steelWall(r, m('steel')),
    deck: deckPlate(r, m('deck')),
    painted: paintedMetal(r, m('painted')),
    ceramic: ceramicPanel(r, m('ceramic')),
    flesh: chorusFlesh(r, m('flesh')),
    silk: silkWeb(r, m('silk')),
    hazard: hazardStripe(r, m('hazard')),
    screen: screenFace(r),
    poolPlain: lightPool(r, false),
    poolGrate: lightPool(r, true),
    catwalkShadow: catwalkShadow(r),
    lightShaft: lightShaft(r),
    particles: particleAtlas(),
    decals: decalAtlas(r),
  };
}

export { TILE as TEXTURE_TILE };
