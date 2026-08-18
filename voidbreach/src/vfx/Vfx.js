// VFX — particles, decals, tracers and screen state.
//
// Every reaction in DIRECTION §"COMBAT" lands here: sparks off steel, chips off
// ceramic, wet rupture on Chorusflesh, smoke that falls after a nest dies, dust
// that is only visible inside a light beam, and decals that stay so the station
// remembers the fight.

import * as THREE from '../../vendor/three.module.js';
import { FreeList } from '../core/Pool.js';
import { clamp01 } from '../core/Mathx.js';
import { PAL } from '../environment/Palette.js';

const PT_VERT = /* glsl */`
attribute float aSize;
attribute float aSprite;
attribute vec3 aColor;
attribute float aFade;
varying vec3 vColor;
varying float vFade;
varying float vSprite;
uniform float uScale;
void main() {
  vColor = aColor; vFade = aFade; vSprite = aSprite;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.4, -mv.z);
}`;

const PT_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec3 vColor;
varying float vFade;
varying float vSprite;
void main() {
  vec2 uv = gl_PointCoord;
  uv.y = 1.0 - uv.y;
  vec2 cell = vec2(mod(vSprite, 2.0), floor(vSprite / 2.0));
  vec2 auv = (uv * 0.5) + cell * 0.5;
  float a = texture2D(uAtlas, auv).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a * vFade);
}`;

const CAP = 4096;
const DECALS = 256;

export class Vfx {
  constructor(scene, textures, quality, rng, events) {
    this.scene = scene;
    this.quality = quality;
    this.rng = rng.child('vfx');
    this.events = events;
    this.cap = Math.min(CAP, quality.particles);

    // ---- particles (two batches: additive for light, alpha for matter)
    this.batches = {};
    for (const [name, blending] of [['add', THREE.AdditiveBlending], ['alpha', THREE.NormalBlending]]) {
      const geom = new THREE.BufferGeometry();
      const pos = new Float32Array(this.cap * 3);
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.cap), 1));
      geom.setAttribute('aSprite', new THREE.BufferAttribute(new Float32Array(this.cap), 1));
      geom.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3));
      geom.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(this.cap), 1));
      geom.setDrawRange(0, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: textures.particles }, uScale: { value: 420 } },
        vertexShader: PT_VERT, fragmentShader: PT_FRAG,
        transparent: true, depthWrite: false, blending,
      });
      const points = new THREE.Points(geom, mat);
      points.frustumCulled = false;
      points.renderOrder = 6;
      scene.add(points);
      this.batches[name] = { geom, points, mat };
    }

    this.list = new FreeList(this.cap);
    this.px = new Float32Array(this.cap); this.py = new Float32Array(this.cap); this.pz = new Float32Array(this.cap);
    this.vx = new Float32Array(this.cap); this.vy = new Float32Array(this.cap); this.vz = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap); this.maxLife = new Float32Array(this.cap);
    this.size = new Float32Array(this.cap); this.grow = new Float32Array(this.cap);
    this.drag = new Float32Array(this.cap); this.grav = new Float32Array(this.cap);
    this.r = new Float32Array(this.cap); this.g = new Float32Array(this.cap); this.b = new Float32Array(this.cap);
    this.sprite = new Float32Array(this.cap);
    this.additive = new Uint8Array(this.cap);
    this.glow = new Float32Array(this.cap);

    // ---- decals: the station remembers combat
    this.decals = [];
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    for (let s = 0; s < 4; s++) {
      const g = plane.clone();
      const uv = g.getAttribute('uv');
      const cx = s % 2, cy = 1 - Math.floor(s / 2);
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (uv.getX(i) * 0.5) + cx * 0.5, (uv.getY(i) * 0.5) + cy * 0.5);
      }
      const mat = new THREE.MeshBasicMaterial({
        map: textures.decals, transparent: true, depthWrite: false,
        vertexColors: true, opacity: 1, toneMapped: true,
        blending: s === 0 || s === 2 ? THREE.NormalBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.InstancedMesh(g, mat, quality.decals);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.decals.push({ mesh, used: 0, cursor: 0, cap: quality.decals });
    }
    this._m4 = new THREE.Matrix4();
    this._col = new THREE.Color();

    // ---- tracers
    const tg = new THREE.PlaneGeometry(1, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({
      map: textures.particles, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: true,
    });
    // use the streak cell of the atlas
    {
      const uv = tg.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + 0.5, uv.getY(i) * 0.5);
    }
    this.tracers = new THREE.InstancedMesh(tg, this.tracerMat, 192);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.tracers.renderOrder = 5;
    scene.add(this.tracers);
    this.tracerList = [];

    // ---- screen state (read by RENDERER post uniforms)
    this.screen = { damage: 0, heal: 0, flash: 0, shake: 0 };
    this.dustTimer = 0;
  }

  // ------------------------------------------------------------- spawning
  emit(x, y, z, vx, vy, vz, opts) {
    const i = this.list.alloc();
    if (i < 0) return -1;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = opts.life; this.maxLife[i] = opts.life;
    this.size[i] = opts.size; this.grow[i] = opts.grow || 0;
    this.drag[i] = opts.drag ?? 2.0; this.grav[i] = opts.grav ?? 0;
    const c = opts.color;
    this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
    this.sprite[i] = opts.sprite ?? 0;
    this.additive[i] = opts.additive ? 1 : 0;
    this.glow[i] = opts.glow ?? 1;
    return i;
  }

  sparks(x, y, z, nx, nz, count, power = 1, colour = [3.2, 1.9, 0.7]) {
    for (let i = 0; i < count; i++) {
      const a = this.rng.angle();
      const spd = this.rng.range(3, 11) * power;
      const ux = nx || Math.cos(a), uz = nz || Math.sin(a);
      this.emit(x, y, z,
        (ux + this.rng.gauss(0.8)) * spd,
        this.rng.range(1.2, 6.5) * power,
        (uz + this.rng.gauss(0.8)) * spd,
        {
          life: this.rng.range(0.18, 0.52), size: this.rng.range(0.7, 1.9),
          grow: -1.4, drag: 3.2, grav: -19, color: colour, sprite: 1, additive: true,
        });
    }
  }

  chips(x, y, z, nx, nz, count) {
    for (let i = 0; i < count; i++) {
      this.emit(x, y, z,
        (nx + this.rng.gauss(0.9)) * this.rng.range(1.5, 5),
        this.rng.range(0.8, 3.4),
        (nz + this.rng.gauss(0.9)) * this.rng.range(1.5, 5),
        {
          life: this.rng.range(0.4, 0.9), size: this.rng.range(1.2, 2.6),
          grow: 0.4, drag: 2.6, grav: -12, color: [0.42, 0.44, 0.46], sprite: 0,
        });
    }
  }

  fluid(x, y, z, dx, dz, count, colour = [0.55, 0.12, 0.62]) {
    for (let i = 0; i < count; i++) {
      this.emit(x, y, z,
        (dx + this.rng.gauss(0.7)) * this.rng.range(1.5, 6.5),
        this.rng.range(1.0, 5.0),
        (dz + this.rng.gauss(0.7)) * this.rng.range(1.5, 6.5),
        {
          life: this.rng.range(0.3, 0.85), size: this.rng.range(1.6, 3.6),
          grow: 0.5, drag: 2.2, grav: -16, color: colour, sprite: 2,
        });
    }
  }

  smoke(x, y, z, count, size = 5, rise = 1.2, colour = [0.16, 0.17, 0.19]) {
    for (let i = 0; i < count; i++) {
      this.emit(x + this.rng.gauss(0.5), y + this.rng.range(0, 0.6), z + this.rng.gauss(0.5),
        this.rng.gauss(1.1), this.rng.range(0.2, 1.4) * rise, this.rng.gauss(1.1),
        {
          life: this.rng.range(1.4, 3.2), size: this.rng.range(size * 0.6, size * 1.5),
          grow: 3.5, drag: 1.1, grav: rise < 0 ? -1.2 : 0.25,
          color: colour, sprite: 0, glow: 0.55,
        });
    }
  }

  muzzle(x, y, z, dx, dz) {
    this.emit(x + dx * 0.2, y, z + dz * 0.2, dx * 3, 0.6, dz * 3, {
      life: 0.055, size: 8.5, grow: -14, drag: 6, color: [7.0, 5.2, 2.6], sprite: 0, additive: true,
    });
    for (let i = 0; i < 4; i++) {
      this.emit(x, y, z, dx * this.rng.range(4, 13) + this.rng.gauss(2), this.rng.range(0, 2),
        dz * this.rng.range(4, 13) + this.rng.gauss(2), {
          life: this.rng.range(0.05, 0.14), size: this.rng.range(1.0, 2.2),
          grow: -3, drag: 5, color: [6.0, 3.4, 1.2], sprite: 1, additive: true,
        });
    }
    // smoke lingering at the muzzle keeps automatic fire feeling physical
    if (this.rng.bool(0.35)) {
      this.emit(x + dx * 0.5, y, z + dz * 0.5, dx * 1.6, 0.5, dz * 1.6, {
        life: this.rng.range(0.35, 0.7), size: 2.2, grow: 4.5, drag: 2.4,
        color: [0.30, 0.30, 0.32], sprite: 0, glow: 0.4,
      });
    }
  }

  shell(x, y, z, dx, dz) {
    // ejects to the right of the barrel, bounces off the deck
    const sx = -dz, sz = dx;
    this.emit(x, y, z, sx * this.rng.range(2.2, 3.8) + this.rng.gauss(0.6), this.rng.range(1.4, 2.6),
      sz * this.rng.range(2.2, 3.8) + this.rng.gauss(0.6), {
        life: 1.1, size: 0.85, grow: 0, drag: 0.6, grav: -17,
        color: [1.5, 1.05, 0.42], sprite: 1, additive: true, glow: 0.8,
      });
  }

  explosion(x, y, z, radius, power) {
    // Fewer, shorter, smaller. The blast is the event; the burning that follows
    // is a separate, quieter thing with its own geometry (see drawFires), and
    // the old version tried to be both at once by throwing thirty sprites.
    for (let i = 0; i < 14; i++) {
      const a = this.rng.angle();
      const spd = this.rng.range(3, 13);
      this.emit(x, y, z, Math.cos(a) * spd, this.rng.range(1, 6), Math.sin(a) * spd, {
        life: this.rng.range(0.14, 0.30), size: this.rng.range(1.5, 3.6), grow: -3,
        drag: 4.0, grav: -8, color: [7, 3.8, 1.2], sprite: 1, additive: true,
      });
    }
    this.emit(x, y + 0.4, z, 0, 0.5, 0, {
      life: 0.11, size: 15, grow: 26, drag: 9, color: [6, 4.2, 2.4], sprite: 0, additive: true,
    });
    this.smoke(x, y + 0.5, z, 16, 7, 1.5);
    this.chips(x, y, z, 0, 0, 12);
    this.screen.flash = Math.max(this.screen.flash, 0.55);
    this.screen.shake = Math.max(this.screen.shake, 0.26);
    this.addDecal(2, x, z, radius * 1.4, this.rng.angle(), [0.5, 0.5, 0.5], 1);
  }

  /** The payload moment: a nest rupturing (DIRECTION §"SPAWNERS"). */
  nestRupture(x, y, z) {
    for (let i = 0; i < 46; i++) {
      const a = this.rng.angle();
      const spd = this.rng.range(3, 17);
      this.emit(x, y, z, Math.cos(a) * spd, this.rng.range(2, 13), Math.sin(a) * spd, {
        life: this.rng.range(0.4, 1.3), size: this.rng.range(2.5, 6.5), grow: 1.2,
        drag: 2.2, grav: -14, color: [0.75, 0.18, 0.85], sprite: 2,
      });
    }
    for (let i = 0; i < 22; i++) {
      const a = this.rng.angle();
      this.emit(x, y, z, Math.cos(a) * this.rng.range(2, 12), this.rng.range(1, 8),
        Math.sin(a) * this.rng.range(2, 12), {
          life: this.rng.range(0.2, 0.5), size: this.rng.range(2, 5), grow: -2,
          drag: 3, color: [5.5, 1.6, 6.5], sprite: 1, additive: true,
        });
    }
    this.emit(x, y, z, 0, 1.2, 0, {
      life: 0.3, size: 30, grow: 55, drag: 6, color: [4.5, 1.2, 5.5], sprite: 0, additive: true,
    });
    // Heavy smoke that FALLS — the rupture is wet, not incendiary.
    this.smoke(x, y + 1.2, z, 20, 8, -0.5, [0.20, 0.10, 0.22]);
    this.addDecal(3, x, z, 7.5, this.rng.angle(), [0.55, 0.16, 0.62], 1);
    this.screen.flash = Math.max(this.screen.flash, 0.85);
    this.screen.shake = Math.max(this.screen.shake, 0.32);
  }

  impact(e) {
    const { x, y, z, nx, nz, surface, power } = e;
    switch (surface) {
      case 'flesh':
        this.fluid(x, y, z, nx, nz, 5 + (power * 6) | 0);
        break;
      case 'grate':
        this.sparks(x, y, z, nx, nz, 4, 0.8);
        break;
      case 'machine':
        this.sparks(x, y, z, nx, nz, 7, 1.1, [3.4, 2.6, 1.2]);
        this.chips(x, y, z, nx, nz, 2);
        break;
      case 'ceramic':
        this.chips(x, y, z, nx, nz, 6);
        this.addDecal(1, x, z, 0.55, this.rng.angle(), [0.7, 0.7, 0.7], 0.85, y, nx, nz);
        break;
      default:
        this.sparks(x, y, z, nx, nz, 6, 1.0);
        this.addDecal(0, x, z, 0.5, this.rng.angle(), [0.6, 0.6, 0.6], 0.9, y, nx, nz);
    }
  }

  bloodDecal(x, z, size, colour) {
    this.addDecal(3, x, z, size, this.rng.angle(), colour, 0.9);
  }

  /**
   * Decals live in a ring buffer; the oldest is overwritten. Within that budget
   * they are permanent, which is what makes a cleared room look fought over.
   */
  addDecal(kind, x, z, size, rot, colour, alpha = 1, y = 0.02, nx = 0, nz = 0) {
    const d = this.decals[kind];
    if (!d) return;
    const i = d.cursor;
    d.cursor = (d.cursor + 1) % d.cap;
    d.used = Math.min(d.cap, d.used + 1);
    d.mesh.count = d.used;
    const m = this._m4;
    if (nx || nz) {
      // wall decal: stand it up against the surface
      const e = new THREE.Euler(Math.PI / 2, Math.atan2(nx, nz), 0, 'YXZ');
      m.compose(new THREE.Vector3(x + nx * 0.03, Math.max(0.1, y), z + nz * 0.03),
        new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(size, 1, size));
    } else {
      m.makeRotationY(rot);
      m.scale(new THREE.Vector3(size, 1, size));
      m.setPosition(x, 0.018 + (i % 8) * 0.0016, z);   // stagger to avoid z-fight
    }
    d.mesh.setMatrixAt(i, m);
    this._col.setRGB(colour[0], colour[1], colour[2]);
    d.mesh.setColorAt(i, this._col);
    d.mesh.instanceMatrix.needsUpdate = true;
    if (d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true;
  }

  addTracer(x, y, z, dx, dz, len, colour) {
    if (this.tracerList.length >= 190) this.tracerList.shift();
    this.tracerList.push({ x, y, z, dx, dz, len, life: 0.075, max: 0.075, colour });
  }

  /** Dust motes: invisible until a light beam finds them (DIRECTION §8). */
  spawnDust(dt, px, pz, aimX, aimZ, lightOn) {
    if (!this.quality.dust || !lightOn) return;
    this.dustTimer -= dt;
    if (this.dustTimer > 0) return;
    this.dustTimer = 0.045;
    for (let i = 0; i < 3; i++) {
      const t = this.rng.range(1.5, 13);
      const spread = t * 0.22;
      const x = px + aimX * t + this.rng.gauss(spread);
      const z = pz + aimZ * t + this.rng.gauss(spread);
      this.emit(x, this.rng.range(0.25, 2.6), z,
        this.rng.gauss(0.16), this.rng.range(-0.10, 0.16), this.rng.gauss(0.16), {
          life: this.rng.range(1.1, 2.6), size: this.rng.range(0.28, 0.62),
          grow: 0, drag: 0.35, grav: -0.05,
          color: [0.34, 0.33, 0.30], sprite: 0, additive: true, glow: 0.25,
        });
    }
  }

  update(dt, time) {
    const ids = this.list.active;
    for (let k = this.list.count - 1; k >= 0; k--) {
      const i = ids[k];
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.list.release(i); continue; }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.03) {
        this.py[i] = 0.03;
        this.vy[i] = Math.abs(this.vy[i]) * 0.22;
        this.vx[i] *= 0.55; this.vz[i] *= 0.55;
      }
      this.size[i] = Math.max(0.05, this.size[i] + this.grow[i] * dt);
    }

    for (let i = this.tracerList.length - 1; i >= 0; i--) {
      this.tracerList[i].life -= dt;
      if (this.tracerList[i].life <= 0) this.tracerList.splice(i, 1);
    }

    this.screen.damage = Math.max(0, this.screen.damage - dt * 2.4);
    this.screen.heal = Math.max(0, this.screen.heal - dt * 1.6);
    this.screen.flash = Math.max(0, this.screen.flash - dt * 4.5);
    this.screen.shake = Math.max(0, this.screen.shake - dt * 2.2);
  }

  /**
   * FLAMES — cones, not billboards.
   *
   * Fire was previously nothing but a burst of round additive sprites, which is
   * why it read as a puff of orange rather than as burning. A flame has a
   * SHAPE: wide and bright at the base, narrow and unstable at the tip, and the
   * tip is the part that moves. So each fire is a small stack of tapered cones
   * whose tips wander on their own phase — the base stays put and the top
   * licks, which is the motion the eye actually reads as fire.
   *
   * Three cones per fire, not thirty. The instruction was "less rampant and
   * smaller", and a fire that fills a room is scenery; a fire you can step
   * around is a hazard.
   */
  buildFlames() {
    const CONES = 3;
    this.flameCap = 24 * CONES;
    const geom = new THREE.ConeGeometry(0.42, 1.0, 6, 1, true);
    geom.translate(0, 0.5, 0);          // pivot at the base, so tilt swings the tip
    // Every other geometry in this project comes from MeshBuilder, which always
    // writes a vertex colour — so the shared emissive materials are all
    // `vertexColors: true`. A stock three geometry carries none, which meant
    // vColor was undefined, the additive result was black, and fifteen flame
    // instances rendered perfectly and invisibly. Give it white vertices.
    const vcount = geom.attributes.position.count;
    geom.setAttribute('color',
      new THREE.BufferAttribute(new Float32Array(vcount * 3).fill(1), 3));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, toneMapped: true,
    });
    this.flameMesh = new THREE.InstancedMesh(geom, mat, this.flameCap);
    this.flameMesh.frustumCulled = false;
    this.flameMesh.count = 0;
    this.flameMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.flameCap * 3), 3);
    this.flameMesh.renderOrder = 7;
    this.scene.add(this.flameMesh);
    this._flameM4 = new THREE.Matrix4();
    this._flameQ = new THREE.Quaternion();
    this._flameE = new THREE.Euler();
    this._flameV = new THREE.Vector3();
    this._flameS = new THREE.Vector3();
    this.flameCones = CONES;
  }

  /**
   * Draw the fires GAME owns. VFX renders them; it does not decide who burns.
   */
  drawFires(fires, time) {
    if (!this.flameMesh) this.buildFlames();
    const m4 = this._flameM4, q = this._flameQ, e = this._flameE;
    const v = this._flameV, sc = this._flameS;
    const col = this.flameMesh.instanceColor;
    let n = 0;
    for (const f of fires) {
      const fade = Math.min(1, f.life / 1.2) * Math.min(1, f.age / 0.35);
      for (let k = 0; k < this.flameCones && n < this.flameCap; k++) {
        const t = k / this.flameCones;
        const ph = f.seed * 6.28 + k * 2.1;
        // The tip wanders; the base does not. Two frequencies so it never
        // settles into an obvious loop.
        const tilt = 0.20 * Math.sin(time * (3.1 + k) + ph)
                   + 0.10 * Math.sin(time * (7.7 - k) + ph * 1.7);
        const roll = 0.18 * Math.cos(time * (2.6 + k * 0.7) + ph);
        const flick = 0.78 + 0.22 * Math.sin(time * (9 + k * 3) + ph * 2.3);
        const r = f.r * (1 - t * 0.45) * fade;
        const hgt = f.r * (1.5 - t * 0.35) * flick * fade;
        e.set(tilt, ph, roll);
        q.setFromEuler(e);
        v.set(f.x, 0.02 + t * f.r * 0.35, f.z);
        sc.set(r, hgt, r);
        m4.compose(v, q, sc);
        this.flameMesh.setMatrixAt(n, m4);
        // It has to stay ORANGE. Pushed any brighter it goes through the AgX
        // shoulder and comes out white, which is the same mistake the egg cores
        // made: a fire that desaturates to white stops reading as fire and
        // starts reading as a light bulb. Bright enough to bloom, dark enough
        // to keep its hue.
        const heat = (1 - t) * flick * fade;
        col.setXYZ(n, 1.55 * heat + 0.22, 0.52 * heat + 0.05, 0.09 * heat);
        n++;
      }
    }
    this.flameMesh.count = n;
    if (n > 0) {
      this.flameMesh.instanceMatrix.needsUpdate = true;
      col.needsUpdate = true;
    }
  }

  /** Write GPU buffers. Called once per rendered frame. */
  draw(camera) {
    let addN = 0, alphaN = 0;
    const A = this.batches.add.geom, B = this.batches.alpha.geom;
    const ap = A.attributes.position.array, as = A.attributes.aSize.array,
      asp = A.attributes.aSprite.array, ac = A.attributes.aColor.array, af = A.attributes.aFade.array;
    const bp = B.attributes.position.array, bs = B.attributes.aSize.array,
      bsp = B.attributes.aSprite.array, bc = B.attributes.aColor.array, bf = B.attributes.aFade.array;

    const ids = this.list.active;
    for (let k = 0; k < this.list.count; k++) {
      const i = ids[k];
      const t = clamp01(this.life[i] / this.maxLife[i]);
      const fade = Math.min(1, t * 2.2) * this.glow[i];
      if (this.additive[i]) {
        if (addN >= this.cap) continue;
        ap[addN * 3] = this.px[i]; ap[addN * 3 + 1] = this.py[i]; ap[addN * 3 + 2] = this.pz[i];
        as[addN] = this.size[i]; asp[addN] = this.sprite[i];
        ac[addN * 3] = this.r[i]; ac[addN * 3 + 1] = this.g[i]; ac[addN * 3 + 2] = this.b[i];
        af[addN] = fade; addN++;
      } else {
        if (alphaN >= this.cap) continue;
        bp[alphaN * 3] = this.px[i]; bp[alphaN * 3 + 1] = this.py[i]; bp[alphaN * 3 + 2] = this.pz[i];
        bs[alphaN] = this.size[i]; bsp[alphaN] = this.sprite[i];
        bc[alphaN * 3] = this.r[i]; bc[alphaN * 3 + 1] = this.g[i]; bc[alphaN * 3 + 2] = this.b[i];
        bf[alphaN] = fade; alphaN++;
      }
    }
    for (const [batch, n] of [[this.batches.add, addN], [this.batches.alpha, alphaN]]) {
      batch.geom.setDrawRange(0, n);
      for (const k of ['position', 'aSize', 'aSprite', 'aColor', 'aFade']) {
        batch.geom.attributes[k].needsUpdate = true;
      }
    }
    this.particleCount = addN + alphaN;

    // tracers
    const m = this._m4;
    this.tracers.count = this.tracerList.length;
    for (let i = 0; i < this.tracerList.length; i++) {
      const t = this.tracerList[i];
      const yaw = Math.atan2(t.dx, t.dz);
      const e = new THREE.Euler(-Math.PI / 2, yaw, 0, 'YXZ');
      m.compose(new THREE.Vector3(t.x, t.y, t.z),
        new THREE.Quaternion().setFromEuler(e),
        new THREE.Vector3(0.30, 1, t.len * (t.life / t.max)));
      this.tracers.setMatrixAt(i, m);
      this._col.setRGB(t.colour[0], t.colour[1], t.colour[2]);
      this.tracers.setColorAt(i, this._col);
    }
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }
}
