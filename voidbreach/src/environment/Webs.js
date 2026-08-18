// ENVIRONMENT / Webs — the silk engine.
//
// The Chorus does not just grow flesh on the station, it STRINGS it. Webbing
// hangs from every ceiling, chokes every corner, and drapes across corridors in
// sheets you walk through. This module authors all of it, renders all of it in
// one draw call, moves it in the wind, and burns it.
//
// Four ideas, in the order they matter:
//
//   1. THE NET IS THE TEXTURE, NOT THE GEOMETRY. Silk is an alpha-tested mask
//      (Textures.js/silkWeb) on flat panels. That is the only way to afford
//      webbing across a whole sector, and because it is alpha-TESTED rather
//      than blended it still writes depth — a dozen overlapping layers need no
//      sorting and cost nothing to get right.
//
//   2. SWAY IS AN ATTRIBUTE. Every vertex carries `aSway`, 0 where the silk is
//      anchored to architecture and 1 at a free edge. The wind is three sine
//      terms in the vertex shader multiplied by that number. There is no cloth
//      simulation here and there does not need to be one: what the eye reads as
//      "hanging" is that the top does not move and the bottom does.
//
//   3. BURN IS A TEXTURE LOOKUP. Every vertex carries `aElem`, an index into a
//      32x32 data texture holding one burn value per element. Setting one byte
//      ignites a whole drape. Fire spreads along a neighbour graph built at
//      authoring time, which is the point of the whole system: silk is how fire
//      travels between rooms.
//
//   4. IT IS NEVER VIOLET. Violet means "alive and spawning" and nothing else
//      (DIRECTION §5.5). Silk is a near-white dielectric whose job is to take
//      the colour of whatever light finds it — amber under a work lamp, red
//      under an alarm, orange while it burns.
//
// WEBS owns silk. It does not own damage: when an element catches it emits
// `webIgnited` and GAME decides what burning means.

import * as THREE from '../../vendor/three.module.js';
import { CELL, C } from '../level/Grid.js';
import { clamp01 } from '../core/Mathx.js';

// Elements per sector by tier. The cost of an element is a handful of triangles
// and one texel; the cost of TOO MANY is that the station stops reading as a
// station and starts reading as a cave.
const BUDGET = { low: 420, medium: 700, high: 950 };

const BURN_DIM = 32;                  // 32x32 = 1024 element slots
const BURN_RATE = 0.42;               // silk is gone about two and a half seconds after it catches
const SPREAD_AT = 0.30;               // how far through its own burn an element lights its neighbours
const SPREAD_DIST = 4.2;              // metres; how far silk carries fire
const MAX_NEIGHBOURS = 5;

export const WEB = { CANOPY: 0, CORNER: 1, DRAPE: 2, STRAND: 3 };

/**
 * A vertex sink with the three attributes silk needs on top of the usual ones.
 *
 * This is deliberately NOT MeshBuilder. MeshBuilder exists to merge axis-aligned
 * architecture with world-derived UVs, and silk is none of those things: no
 * panel of it is axis-aligned, its UVs are per-panel rather than per-world, and
 * every vertex carries state that no wall ever needs.
 */
class SilkBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = [];
    this.sway = []; this.phase = []; this.elem = []; this.idx = [];
  }

  vert(x, y, z, nx, ny, nz, u, v, sway, phase, elem, shade) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(shade, shade, shade);
    this.sway.push(sway);
    this.phase.push(phase);
    this.elem.push(elem);
    return (this.pos.length / 3) - 1;
  }

  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  get isEmpty() { return this.idx.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setAttribute('aElem', new THREE.Float32BufferAttribute(this.elem, 1));
    const vertexCount = this.pos.length / 3;
    g.setIndex(vertexCount > 65535
      ? new THREE.Uint32BufferAttribute(this.idx, 1)
      : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.name = 'silk';
    return g;
  }
}

export class Webs {
  /**
   * @param sector   built Sector (grid, rooms, queens)
   * @param quality  tier record from Quality.js
   * @param rng      parent Rng; WEBS takes its own named stream
   * @param events   event bus — `webIgnited` goes out, nothing comes in
   * @param textures the shared texture set; `silk` must be in it
   */
  constructor(sector, quality, rng, events, textures) {
    this.sector = sector;
    this.quality = quality;
    this.rng = rng.child('webs');
    this.events = events;
    this.textures = textures;
    this.budget = BUDGET[quality.name] || BUDGET.medium;

    this.elements = [];      // { kind, x, y, z, low, r, burn, lit, dead, links[] }
    this.burning = [];       // indices currently on fire — the only thing update() walks
    this.time = 0;

    this.burnData = new Uint8Array(BURN_DIM * BURN_DIM);
    this.burnTex = new THREE.DataTexture(
      this.burnData, BURN_DIM, BURN_DIM, THREE.RedFormat, THREE.UnsignedByteType);
    this.burnTex.minFilter = this.burnTex.magFilter = THREE.NearestFilter;
    this.burnTex.needsUpdate = true;

    this.uniforms = {
      uSilkTime: { value: 0 },
      uWind: { value: 0.35 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uBurnTex: { value: this.burnTex },
      uPlayer: { value: new THREE.Vector3(0, 0, 0) },
      uClearRadius: { value: 4.6 },
    };

    this.root = new THREE.Group();
    this.root.name = 'silk';
    this.material = this.makeMaterial();
    this.build();
  }

  // ------------------------------------------------------------- material
  /**
   * MeshStandardMaterial with injections rather than a bespoke ShaderMaterial.
   *
   * Silk has to be lit by the same lamps, the same shadows and the same IBL as
   * everything else, because "it takes the colour of the light that finds it" is
   * the entire look. Hand-rolling that lighting would mean silk quietly drifting
   * out of step with the rest of the station every time the grade changed.
   */
  makeMaterial() {
    const t = this.textures.silk;
    const mat = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normal,
      roughnessMap: t.orm, metalnessMap: t.orm,
      // Low roughness and zero metalness: silk is a shiny dielectric. With the
      // scene's IBL that alone gives it a sheen; the injected term below is what
      // makes it flare when it is edge-on to the camera, which is the thing a
      // real web does in a torch beam.
      roughness: 0.30, metalness: 0.0,
      color: new THREE.Color(0xcfd6e0),
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.42,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    mat.envMapIntensity = 1.35;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          attribute float aSway;
          attribute float aPhase;
          attribute float aElem;
          uniform float uSilkTime;
          uniform float uWind;
          uniform vec2  uWindDir;
          uniform sampler2D uBurnTex;
          varying float vBurn;
          varying vec2  vSilkUv;
          varying vec3  vSilkWorld;
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          #include <begin_vertex>
          vSilkUv = uv;
          {
            // One texel per element: setting a byte on the CPU moves every
            // vertex of a whole drape.
            float ex = mod(aElem, ${BURN_DIM}.0);
            float ey = floor(aElem / ${BURN_DIM}.0);
            vBurn = texture2D(uBurnTex, (vec2(ex, ey) + 0.5) / ${BURN_DIM}.0).r;

            // WIND. Two frequencies so it never settles into a visible loop, and
            // a third slower one on the vertical so the sheet breathes rather
            // than only swinging. All of it scaled by aSway, which is 0 wherever
            // the silk is tied to the station — that contrast is the whole
            // effect, and it is why this is an attribute and not a uniform.
            float t = uSilkTime * 1.6 + aPhase;
            float amp = aSway * (0.055 + 0.30 * uWind);
            float swing = sin(t) * 0.62 + sin(t * 2.37 + 1.7) * 0.26;
            transformed.x += uWindDir.x * swing * amp;
            transformed.z += uWindDir.y * swing * amp;
            transformed.y -= abs(sin(t * 0.83 + aPhase)) * amp * 0.34;
            // Silk that has caught goes slack and drops as it burns through.
            transformed.y -= vBurn * aSway * 0.55;
          }
          vSilkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          uniform vec3  uPlayer;
          uniform float uClearRadius;
          varying float vBurn;
          varying vec2  vSilkUv;
          varying vec3  vSilkWorld;
        `)
        .replace('#include <map_fragment>', /* glsl */`
          #include <map_fragment>
          {
            // A cheap per-fragment hash, used for BOTH dissolves below so the
            // silk always tears along the same ragged line rather than fading
            // like a decal. Silk does not fade; it goes.
            float n = fract(sin(dot(floor(vSilkUv * 220.0), vec2(41.3, 289.1))) * 43758.545);

            // 1. Burning away. The threshold sweeps past the noise so holes open
            //    in the middle of a sheet and grow, which is how paper goes.
            if (vBurn > 0.02 && vBurn * 1.30 > 0.28 + 0.72 * n) discard;

            // 2. Getting out of the player's way. The camera sits above the
            //    ceiling plane, so silk hung under a six-metre roof is directly
            //    between the lens and the operator. Overhead structure already
            //    hides itself for the occupied room (Build.updateOverhead); this
            //    is the same contract, done per fragment so it dissolves instead
            //    of popping a whole mesh.
            float near = 1.0 - smoothstep(uClearRadius * 0.55, uClearRadius, distance(vSilkWorld.xz, uPlayer.xz));
            float high = smoothstep(2.3, 3.3, vSilkWorld.y - uPlayer.y);
            if (near * high > 0.15 + 0.85 * n) discard;

            // Char. It darkens well before it tears, so a burning sheet reads as
            // burning for a moment rather than simply vanishing.
            diffuseColor.rgb *= mix(1.0, 0.09, smoothstep(0.0, 0.45, vBurn));
          }
        `)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            // The burning edge. Bright only in the narrow band where the tear is
            // actually happening — held back deliberately, because pushed any
            // further it goes through the AgX shoulder and comes out white, and
            // white fire is a light bulb.
            float n = fract(sin(dot(floor(vSilkUv * 220.0), vec2(41.3, 289.1))) * 43758.545);
            float edge = 1.0 - clamp(abs(vBurn * 1.30 - (0.28 + 0.72 * n)) * 7.0, 0.0, 1.0);
            totalEmissiveRadiance += vec3(1.45, 0.46, 0.08) * edge * step(0.02, vBurn);
          }
        `)
        .replace('#include <opaque_fragment>', /* glsl */`
          {
            // SHEEN. A web in a torch beam is brightest edge-on, and a standard
            // GGX lobe alone does not sell that at this camera distance. Added
            // AFTER lighting and scaled by the light already present, so silk
            // can never glow in a dark room — which is the failure this ordering
            // exists to prevent.
            float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
            float sheen = pow(1.0 - ndv, 3.0) * 0.85 * (1.0 - smoothstep(0.0, 0.35, vBurn));
            float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            outgoingLight += vec3(0.88, 0.92, 1.0) * sheen * min(lum * 2.6, 1.1);
          }
          #include <opaque_fragment>
        `);
    };
    // onBeforeCompile rewrites the source, so three needs to be told that this
    // is not the same program as an unmodified standard material.
    mat.customProgramCacheKey = () => 'voidbreach_silk';
    return mat;
  }

  // -------------------------------------------------------------- authoring
  /**
   * How infested a point is, 0..1.
   *
   * Distance to the nearest queen, with a floor: even the arrival deck has some
   * silk in the corners, because "the station is already lost" has to be true
   * before the player meets anything. The floor is low enough that the opening
   * still reads as a working dock rather than as a nest.
   */
  infestation(wx, wz) {
    let best = 1e9;
    for (const q of this.sector.spec.queens) {
      const d = Math.hypot(wx - (q.x + 0.5) * CELL, wz - (q.z + 0.5) * CELL);
      if (d < best) best = d;
    }
    return 0.32 + 0.68 * Math.pow(clamp01(1 - best / 34), 1.3);
  }

  solid(cx, cz) {
    const g = this.sector.grid;
    if (!g.inBounds(cx, cz)) return true;
    const c = g.cells[g.idx(cx, cz)];
    return c === C.WALL || c === C.PROP || c === C.VENT;
  }

  open(cx, cz) {
    const g = this.sector.grid;
    if (!g.inBounds(cx, cz)) return false;
    const c = g.cells[g.idx(cx, cz)];
    return c === C.FLOOR || c === C.GRATE || c === C.HAZARD;
  }

  build() {
    const b = new SilkBuilder();
    for (const room of this.sector.rooms) {
      if (this.elements.length >= this.budget) break;
      this.buildRoom(room, b);
    }
    this.linkNeighbours();

    if (b.isEmpty) return;
    this.mesh = new THREE.Mesh(b.build(), this.material);
    // Silk does not cast: an alpha-tested net in a shadow map is noise, and the
    // depth pass would not carry the wind displacement anyway, so the shadow
    // would sit still while the web moved.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  /**
   * One room's worth of silk, in the order the eye notices it: corners first
   * because they are always readable, then the ceiling because that is where
   * most of it lives, then drapes and strands to tie it together.
   */
  buildRoom(room, b) {
    const rng = this.rng;
    const ceil = room.ceil;
    const corridor = room.kind === 'corridor';

    // --- the wall-and-ceiling line. Silk gathers where two surfaces meet, so
    // every cell against a wall gets a sheet slung in the wall/roof junction and
    // every true inside corner gets a net across it. This is the rule that makes
    // a room read as colonised the moment you enter it, before you have looked
    // up: the edges of the space are furred, and the middle is not.
    for (let cz = room.z; cz < room.z + room.h; cz++) {
      for (let cx = room.x; cx < room.x + room.w; cx++) {
        if (!this.open(cx, cz)) continue;
        const wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
        const inf = this.infestation(wx, wz);
        for (let k = 0; k < 4; k++) {
          const dx = k === 0 ? 1 : k === 1 ? -1 : 0;
          const dz = k === 2 ? 1 : k === 3 ? -1 : 0;
          if (!this.solid(cx + dx, cz + dz)) continue;
          if (this.elements.length >= this.budget) return;
          if (rng.bool(inf * 0.62)) {
            this.wallSheet(b, wx + dx * CELL * 0.5, wz + dz * CELL * 0.5, dx, dz, ceil, inf);
          }
          // A true inside corner: this wall and the one round the turn.
          const px = dx !== 0 ? 0 : 1, pz = dx !== 0 ? 1 : 0;
          for (const s of [1, -1]) {
            if (!this.solid(cx + px * s, cz + pz * s)) continue;
            if (!rng.bool(inf * 0.85)) continue;
            if (this.elements.length >= this.budget) return;
            this.cornerNet(b, wx + dx * CELL * 0.5 + px * s * CELL * 0.5,
              wz + dz * CELL * 0.5 + pz * s * CELL * 0.5,
              dx || px * s, dz || pz * s, Math.min(ceil - 0.35, 3.8), inf);
          }
        }
      }
    }

    // --- ceiling canopies. Big irregular sheets slung across the roof space.
    // These are what makes a hall feel colonised rather than decorated, and they
    // are also the reason the fragment shader has a dissolve: they sit exactly
    // between the camera and the operator.
    const area = room.w * room.h;
    const roomInf = this.infestation((room.x + room.w / 2) * CELL, (room.z + room.h / 2) * CELL);
    const canopies = Math.round(area * (corridor ? 0.05 : 0.10) * roomInf);
    for (let i = 0; i < canopies; i++) {
      if (this.elements.length >= this.budget) return;
      const cx = room.x + rng.range(0.5, room.w - 0.5);
      const cz = room.z + rng.range(0.5, room.h - 0.5);
      const wx = cx * CELL, wz = cz * CELL;
      if (!this.open(Math.floor(cx), Math.floor(cz))) continue;
      const span = rng.range(2.2, Math.min(6.5, Math.max(3, Math.min(room.w, room.h) * CELL * 0.55)));
      this.canopy(b, wx, wz, ceil - rng.range(0.25, 1.1), span, this.infestation(wx, wz));
    }

    // --- drapes. Curtains hanging from the roof, mostly in the tight spaces,
    // and the only silk the player walks THROUGH rather than under. They hang
    // free at the bottom, so they are the piece that actually flails.
    const drapes = Math.round(area * (corridor ? 0.16 : 0.09) * roomInf);
    for (let i = 0; i < drapes; i++) {
      if (this.elements.length >= this.budget) return;
      const cx = Math.floor(room.x + rng.range(0, room.w));
      const cz = Math.floor(room.z + rng.range(0, room.h));
      if (!this.open(cx, cz)) continue;
      const wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
      this.drape(b, wx, wz, ceil, rng.angle(), this.infestation(wx, wz));
    }

    // --- strands. Individual lines from the roof to the deck and wall to wall.
    // Visually they are the least of it; structurally they are the most, because
    // they are what carries fire from one sheet to the next.
    const strands = Math.round(area * 0.22 * roomInf);
    for (let i = 0; i < strands; i++) {
      if (this.elements.length >= this.budget) return;
      const cx = Math.floor(room.x + rng.range(0, room.w));
      const cz = Math.floor(room.z + rng.range(0, room.h));
      if (!this.open(cx, cz)) continue;
      const wx = (cx + 0.5) * CELL + rng.range(-0.8, 0.8);
      const wz = (cz + 0.5) * CELL + rng.range(-0.8, 0.8);
      const a = rng.angle();
      const len = rng.range(1.6, 4.2);
      const top = ceil - rng.range(0.2, 0.9);
      // Either roof-to-deck, or a line slung across the space at head height.
      if (rng.bool(0.55)) {
        this.strand(b, wx, top, wz, wx + Math.cos(a) * 0.7, rng.range(0.05, 1.4), wz + Math.sin(a) * 0.7,
          this.infestation(wx, wz));
      } else {
        const h = rng.range(1.8, Math.min(3.2, ceil - 0.6));
        this.strand(b, wx, h, wz, wx + Math.cos(a) * len, h + rng.range(-0.5, 0.5), wz + Math.sin(a) * len,
          this.infestation(wx, wz));
      }
    }
  }

  /** Register an element and return its index, or -1 if the budget is spent. */
  push(kind, x, y, z, low, r) {
    if (this.elements.length >= this.budget) return -1;
    const i = this.elements.length;
    this.elements.push({ kind, x, y, z, low, r, burn: 0, lit: false, dead: false, links: [] });
    return i;
  }

  // ------------------------------------------------------------- primitives
  /**
   * A sagging quad panel.
   *
   * Every sheet in this file is this function. `anchor` names which of the four
   * edges are tied to architecture; the sway attribute is the distance from the
   * nearest anchored edge, so a sheet tied along its top swings from the bottom
   * and a sheet tied along two edges swings from the far corner. That single
   * rule is the whole wind system.
   *
   * Corners are given as (p00, p10, p01, p11) over (u, v).
   */
  panel(b, elem, p00, p10, p01, p11, opts) {
    const { su = 3, sv = 3, sag = 0.5, uvScale = 1, shade = 1, anchorU0 = false,
      anchorU1 = false, anchorV0 = true, anchorV1 = false } = opts;
    const phase = this.rng.next() * 6.283;
    const base = b.pos.length / 3;
    // A flat panel has a constant normal; sag bends it, but silk is thin enough
    // that one normal per panel is honest and it keeps the vertex count down.
    const ex = p10[0] - p00[0], ey = p10[1] - p00[1], ez = p10[2] - p00[2];
    const fx = p01[0] - p00[0], fy = p01[1] - p00[1], fz = p01[2] - p00[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    for (let iv = 0; iv <= sv; iv++) {
      const v = iv / sv;
      for (let iu = 0; iu <= su; iu++) {
        const u = iu / su;
        const x = p00[0] * (1 - u) * (1 - v) + p10[0] * u * (1 - v) + p01[0] * (1 - u) * v + p11[0] * u * v;
        const y = p00[1] * (1 - u) * (1 - v) + p10[1] * u * (1 - v) + p01[1] * (1 - u) * v + p11[1] * u * v;
        const z = p00[2] * (1 - u) * (1 - v) + p10[2] * u * (1 - v) + p01[2] * (1 - u) * v + p11[2] * u * v;
        // Distance from the anchored edges, in edge-fractions. 0 on an anchor.
        let free = 1;
        if (anchorU0) free = Math.min(free, u);
        if (anchorU1) free = Math.min(free, 1 - u);
        if (anchorV0) free = Math.min(free, v);
        if (anchorV1) free = Math.min(free, 1 - v);
        if (!anchorU0 && !anchorU1 && !anchorV0 && !anchorV1) free = 1;
        // Sag is a parabola between the anchors, not a linear droop: nothing
        // hanging under its own weight has a straight edge.
        const droop = sag * (free * (2 - free));
        b.vert(x, y - droop, z, nx, ny, nz,
          u * uvScale, v * uvScale, clamp01(free), phase, elem, shade);
      }
    }
    for (let iv = 0; iv < sv; iv++) {
      for (let iu = 0; iu < su; iu++) {
        const a = base + iv * (su + 1) + iu;
        b.quad(a, a + 1, a + su + 2, a + su + 1);
      }
    }
  }

  /**
   * The corner net: a triangle thrown across the inside of a corner, anchored
   * along both walls and free along the diagonal. Modelled as a panel whose two
   * far corners meet, which keeps one primitive doing all the work.
   */
  cornerNet(b, px, pz, dirx, dirz, y, inf) {
    const rng = this.rng;
    const reach = rng.range(1.0, 2.1) * (0.6 + inf * 0.6);
    const drop = rng.range(0.5, 1.5);
    // Two edges run back along the walls from the corner post; the diagonal
    // between their far ends is the free edge, and it is the one that moves.
    const e1x = px - dirx * reach, e1z = pz;
    const e2x = px, e2z = pz - dirz * reach;
    const i = this.push(WEB.CORNER, px, y, pz, y - drop, reach);
    if (i < 0) return;
    this.panel(b, i,
      [px, y, pz], [e1x, y - drop * 0.25, e1z],
      [e2x, y - drop * 0.25, e2z], [e1x + (e2x - px), y - drop, e1z + (e2z - pz)],
      { su: 3, sv: 3, sag: drop * 0.45, uvScale: reach * 0.75,
        shade: 0.82 + inf * 0.18, anchorU0: true, anchorV0: true });
  }

  /**
   * The wall/ceiling junction: a sheet tied along the top of a wall and sloping
   * down and out into the room, free along its lower edge.
   *
   * This is the most common piece of silk in the station and the least
   * remarkable one, which is exactly its job. It furs the edges of every space
   * so that the room reads as colonised from the doorway, and because its free
   * edge hangs at head height it is also the silk the player brushes past most
   * often — so it is the piece that has to move.
   *
   * (dx, dz) points from the open cell INTO the wall.
   */
  wallSheet(b, px, pz, dx, dz, ceil, inf) {
    const rng = this.rng;
    const top = ceil - rng.range(0.05, 0.5);
    const out = rng.range(0.7, 1.9) * (0.65 + inf * 0.6);
    const drop = rng.range(0.8, 2.2) * (0.6 + inf * 0.7);
    const bottom = Math.max(0.35, top - drop);
    // Along the wall, perpendicular to the face.
    const ax = dz !== 0 ? 1 : 0, az = dx !== 0 ? 1 : 0;
    const half = rng.range(0.8, 1.9);
    const i = this.push(WEB.CANOPY, px - dx * out * 0.5, top, pz - dz * out * 0.5, bottom, half);
    if (i < 0) return;
    // Top edge on the wall, bottom edge hanging out in the room.
    this.panel(b, i,
      [px - ax * half, top, pz - az * half],
      [px + ax * half, top, pz + az * half],
      [px - ax * half - dx * out, bottom, pz - az * half - dz * out],
      [px + ax * half - dx * out, bottom, pz + az * half - dz * out],
      { su: 3, sv: 3, sag: rng.range(0.15, 0.55), uvScale: half * 1.1,
        shade: 0.84 + inf * 0.16,
        // Tied along the top and at both ends where it meets the wall; the
        // lower edge is free, which is where all the movement is.
        anchorV0: true, anchorU0: true, anchorU1: true });
  }

  /** A sheet slung under the ceiling, anchored at its rim and sagging in the middle. */
  canopy(b, wx, wz, y, span, inf) {
    const rng = this.rng;
    const rot = rng.angle();
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = span * 0.5, hz = span * rng.range(0.35, 0.62);
    const P = (lx, lz, dy) => [wx + lx * c - lz * s, y + dy, wz + lx * s + lz * c];
    const sag = rng.range(0.35, 1.15) * (0.6 + inf * 0.7);
    const i = this.push(WEB.CANOPY, wx, y, wz, y - sag, span * 0.5);
    if (i < 0) return;
    this.panel(b, i,
      P(-hx, -hz, 0), P(hx, -hz, rng.range(-0.2, 0.1)),
      P(-hx, hz, rng.range(-0.2, 0.1)), P(hx, hz, rng.range(-0.3, 0.0)),
      { su: 4, sv: 4, sag, uvScale: span * 0.55, shade: 0.86 + inf * 0.14,
        // Pinned all the way round: a canopy is tied to the roof structure, so
        // it bellies rather than swings, and all the movement is in the middle.
        anchorU0: true, anchorU1: true, anchorV0: true, anchorV1: true });
  }

  /**
   * A curtain: anchored along the top, free at the bottom, and crossed with a
   * second panel at right angles so it reads from any bearing. This is the piece
   * the wind is really for.
   */
  drape(b, wx, wz, ceil, rot, inf) {
    const rng = this.rng;
    const w = rng.range(1.0, 2.4) * (0.7 + inf * 0.5);
    const top = ceil - rng.range(0.1, 0.6);
    // Capped rather than "down to the deck": a curtain that reaches the floor in
    // an eight-metre bay is a wall, and the player needs to see the room.
    const len = Math.min(rng.range(1.2, 4.2), top - rng.range(0.1, 1.2));
    const i = this.push(WEB.DRAPE, wx, top, wz, top - len, w * 0.5);
    if (i < 0) return;
    for (let k = 0; k < 2; k++) {
      const a = rot + k * Math.PI * 0.5;
      const c = Math.cos(a) * w * 0.5, s = Math.sin(a) * w * 0.5;
      const scale = k === 0 ? 1 : rng.range(0.55, 0.85);
      this.panel(b, i,
        [wx - c, top, wz - s], [wx + c, top, wz + s],
        [wx - c, top - len * scale, wz - s], [wx + c, top - len * scale, wz + s],
        { su: 2, sv: 4, sag: rng.range(0.05, 0.25), uvScale: w * 0.8,
          shade: 0.80 + inf * 0.20, anchorV0: true });
    }
  }

  /**
   * A single line, drawn as two ribbons crossed in an X so it never disappears
   * edge-on. Sags in the middle, anchored at both ends.
   */
  strand(b, x0, y0, z0, x1, y1, z1, inf) {
    const rng = this.rng;
    const width = rng.range(0.045, 0.11);
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const i = this.push(WEB.STRAND, (x0 + x1) / 2, Math.max(y0, y1), (z0 + z1) / 2,
      Math.min(y0, y1), len * 0.5);
    if (i < 0) return;
    // Perpendiculars: one horizontal, one as close to vertical as the line allows.
    let ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    let ux = -az, uy = 0, uz = ax;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const sag = rng.range(0.08, 0.35) * Math.min(1, len / 3);
    for (const [px, py, pz] of [[ux, uy, uz], [vx, vy, vz]]) {
      this.panel(b, i,
        [x0 - px * width, y0 - py * width, z0 - pz * width],
        [x1 - px * width, y1 - py * width, z1 - pz * width],
        [x0 + px * width, y0 + py * width, z0 + pz * width],
        [x1 + px * width, y1 + py * width, z1 + pz * width],
        { su: 4, sv: 1, sag, uvScale: len * 0.5, shade: 0.9 + inf * 0.1,
          // Both ends tied, so it swings hardest in the middle.
          anchorU0: true, anchorU1: true, anchorV0: false });
    }
  }

  // ----------------------------------------------------------------- spread
  /**
   * The neighbour graph fire travels along.
   *
   * Built once, from proximity, and capped: an uncapped graph in a room with a
   * hundred elements turns one grenade into a sector-wide flash, which looks
   * like a bug even when it is arithmetic.
   */
  linkNeighbours() {
    const cellSize = SPREAD_DIST;
    const buckets = new Map();
    const key = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
    this.elements.forEach((e, i) => {
      const k = key(e.x, e.z);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    });
    this.elements.forEach((e, i) => {
      const bx = Math.floor(e.x / cellSize), bz = Math.floor(e.z / cellSize);
      const near = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = buckets.get(`${bx + dx},${bz + dz}`);
          if (!list) continue;
          for (const j of list) {
            if (j === i) continue;
            const o = this.elements[j];
            const d = Math.hypot(o.x - e.x, o.z - e.z, (o.y - e.y) * 0.6);
            if (d > SPREAD_DIST) continue;
            near.push([d, j]);
          }
        }
      }
      near.sort((a, c) => a[0] - c[0]);
      e.links = near.slice(0, MAX_NEIGHBOURS).map((n) => n[1]);
    });
  }

  /**
   * Set light to any silk within `radius` of a point. Called by GAME when
   * something burns — a tank, a fire on the deck, a queen going up.
   */
  igniteNear(x, z, radius, y = null) {
    let n = 0;
    for (let i = 0; i < this.elements.length; i++) {
      const e = this.elements[i];
      if (e.lit || e.dead) continue;
      if (Math.hypot(e.x - x, e.z - z) > radius + e.r) continue;
      // A fire on the deck does not light a canopy six metres overhead. It
      // reaches what a flame can reach, and the rest arrives along the strands.
      if (y !== null && e.low - y > 2.6) continue;
      this.ignite(i);
      n++;
    }
    return n;
  }

  ignite(i) {
    const e = this.elements[i];
    if (!e || e.lit || e.dead) return false;
    e.lit = true;
    this.burning.push(i);
    // WEBS does not decide what burning silk does to anything. It says that it
    // is burning, at a place, and GAME turns that into fire.
    this.events.emit('webIgnited', { x: e.x, y: e.low, z: e.z, kind: e.kind, r: e.r });
    return true;
  }

  // ----------------------------------------------------------------- update
  /**
   * Wind and dissolve. Presentation only — this runs on the RENDER clock and
   * must never touch anything a rule depends on.
   */
  present(time, px, py, pz) {
    this.time = time;
    const u = this.uniforms;
    u.uSilkTime.value = time;
    u.uPlayer.value.set(px, py, pz);

    // The station is not still. Extractors run, coolant vents, and pressure
    // differences move air through a hull with holes in it — so the wind gusts
    // on a long period rather than blowing steadily, and the direction wanders.
    const gust = 0.30 + 0.34 * Math.sin(time * 0.21) + 0.22 * Math.sin(time * 0.071 + 2.1);
    u.uWind.value = clamp01(gust);
    const dir = time * 0.043;
    u.uWindDir.value.set(Math.cos(dir), Math.sin(dir));
  }

  /**
   * Burning. This is SIMULATION — it emits events that become damage — so it
   * runs on the fixed step with everything else, never on the render clock.
   */
  step(dt) {
    if (!this.burning.length) return;
    let dirty = false;
    for (let k = this.burning.length - 1; k >= 0; k--) {
      const i = this.burning[k];
      const e = this.elements[i];
      e.burn += dt * BURN_RATE;
      const byte = Math.min(255, Math.round(e.burn * 255));
      if (this.burnData[i] !== byte) { this.burnData[i] = byte; dirty = true; }
      if (e.burn >= SPREAD_AT && !e.spread) {
        e.spread = true;
        for (const j of e.links) this.ignite(j);
      }
      if (e.burn >= 1) {
        e.dead = true; e.lit = false;
        this.burnData[i] = 255;
        this.burning.splice(k, 1);
        dirty = true;
      }
    }
    if (dirty) this.burnTex.needsUpdate = true;
  }

  get burningCount() { return this.burning.length; }
  get elementCount() { return this.elements.length; }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    this.material.dispose();
    this.burnTex.dispose();
  }
}
