// LIGHTING — one owner for exposure-adjacent state (DIRECTION §5).
//
// Budget: one shadow-casting spot (the operator light, which is what makes the
// grating matter) plus a small pool of transient point lights allocated by
// priority. Everything else is emissive geometry and baked light pools.

import * as THREE from '../../vendor/three.module.js';
import { PAL, TONES, toneOf } from '../environment/Palette.js';
import { damp, clamp01 } from '../core/Mathx.js';

export class Lighting {
  constructor(scene, quality, sector, rng) {
    this.scene = scene;
    this.quality = quality;
    this.sector = sector;
    this.rng = rng.child('lighting');

    this.ambient = new THREE.AmbientLight(0x1c2028, 0.9);
    this.hemi = new THREE.HemisphereLight(0x2a3648, 0x120e0a, 0.55);
    scene.add(this.ambient, this.hemi);

    // The operator light. Narrow, bright, and the only shadow caster.
    this.flash = new THREE.SpotLight(0xfff0dc, 380, 32, 0.46, 0.55, 1.7);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    this.flash.shadow.camera.near = 0.4;
    this.flash.shadow.camera.far = 32;
    this.flash.shadow.bias = -0.0016;
    this.flash.shadow.normalBias = 0.035;
    this.flashTarget = new THREE.Object3D();
    scene.add(this.flash, this.flashTarget);
    this.flash.target = this.flashTarget;
    this.flashOn = true;
    this.flashIntensity = 380;

    // A soft key light that keeps the player readable even in the dark, so the
    // dark room is atmospheric rather than unplayable (DIRECTION §5.3).
    this.key = new THREE.PointLight(0x9fb6d8, 12, 11, 2);
    scene.add(this.key);

    this.pool = [];
    for (let i = 0; i < quality.lights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.visible = false;
      scene.add(l);
      this.pool.push(l);
    }

    this.emitters = [];      // persistent: nests, flares, fires
    this.transients = [];    // muzzle flashes, impacts, explosions
    this.freeTransients = [];
    for (let i = 0; i < 48; i++) this.freeTransients.push({ active: false });

    this.tone = TONES.amber;
    this.targetTone = TONES.amber;
    this.blend = 1;
    this.ambientLevel = 1;
  }

  /**
   * Register the station's practical lamps as light emitters. Only the highest
   * priority handful become real lights each frame; the rest are carried by
   * their emissive housing and their baked floor pool. This is what makes "every
   * light source is a visible object" (DIRECTION §5.1) affordable.
   */
  registerLamps(lamps) {
    this.lampEmitters = [];
    for (const l of lamps) {
      if (!l.alive) continue;
      const e = this.addEmitter({
        x: l.x, y: l.y - 0.15, z: l.z, color: l.light || l.color,
        intensity: 105 * l.intensity * l.intensity, radius: l.radius * 2.4, lamp: l,
      });
      l.emitter = e;
      this.lampEmitters.push(e);
    }
  }

  killLampEmitter(lamp) {
    if (lamp.emitter) { this.removeEmitter(lamp.emitter); lamp.emitter = null; }
  }

  setRoom(room) {
    const t = toneOf(room);
    if (t !== this.targetTone) { this.targetTone = t; this.blend = 0; }
  }

  addEmitter(e) { this.emitters.push(e); return e; }
  removeEmitter(e) {
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  /** Transient flash: muzzle, impact spark, explosion, rupture. */
  pulse(x, y, z, color, intensity, radius, ttl) {
    let t = this.freeTransients.pop();
    if (!t) {
      // steal the weakest
      let worst = 0, wi = 0;
      for (let i = 0; i < this.transients.length; i++) {
        const s = this.transients[i].intensity * this.transients[i].life;
        if (i === 0 || s < worst) { worst = s; wi = i; }
      }
      t = this.transients.splice(wi, 1)[0];
      if (!t) return;
    }
    t.x = x; t.y = y; t.z = z; t.color = color;
    t.intensity = intensity; t.radius = radius;
    t.life = 1; t.decay = 1 / Math.max(0.016, ttl);
    this.transients.push(t);
  }

  update(dt, time, px, py, pz, aimX, aimZ, camera) {
    // Ambient blends toward the room the player is standing in.
    this.blend = Math.min(1, this.blend + dt * 2.0);
    const a = this.tone, b = this.targetTone;
    const k = this.blend;
    const mix = (ca, cb) => new THREE.Color(ca).lerp(new THREE.Color(cb), k);
    this.ambient.color.copy(mix(a.ambient, b.ambient));
    // Ambient exists only to keep shadow detail off the floor of the noise; the
    // practical lamps do the shaping. If ambient is doing the work, the image
    // goes flat and the composition dies.
    this.ambient.intensity = (a.level * (1 - k) + b.level * k) * 1.4 * this.ambientLevel;
    this.hemi.color.copy(mix(a.ambient, b.ambient));
    this.hemi.groundColor.copy(mix(a.fill, b.fill));
    this.hemi.intensity = (a.level * (1 - k) + b.level * k) * 0.9 * this.ambientLevel;
    if (k >= 1) this.tone = this.targetTone;

    // Operator light: from the shoulder, slightly ahead, aimed where the player aims.
    const sx = px + aimX * 0.35, sz = pz + aimZ * 0.35;
    this.flash.position.set(sx, 1.55, sz);
    this.flashTarget.position.set(px + aimX * 14, 0.55, pz + aimZ * 14);
    this.flashTarget.updateMatrixWorld();
    this.flash.intensity = this.flashOn ? this.flashIntensity : 0;
    this.flash.visible = this.flashOn;

    this.key.position.set(px, 2.2, pz);

    // Allocate the point-light pool by priority.
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const cands = this._cands || (this._cands = []);
    cands.length = 0;
    for (const e of this.emitters) {
      if (e.intensity <= 0) continue;
      cands.push(e);
    }
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.life -= dt * t.decay;
      if (t.life <= 0) {
        this.transients.splice(i, 1);
        this.freeTransients.push(t);
        continue;
      }
      cands.push(t);
    }
    for (const c of cands) {
      const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const life = c.life === undefined ? 1 : c.life;
      c._prio = (c.intensity * life * life) / (1 + d2 * 0.02);
    }
    cands.sort(byPriority);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      const c = cands[i];
      if (!c) { l.visible = false; l.intensity = 0; continue; }
      const life = c.life === undefined ? 1 : c.life;
      l.visible = true;
      l.position.set(c.x, c.y, c.z);
      l.color.set(c.color);
      l.intensity = c.intensity * life * life;
      l.distance = c.radius;
    }
    this.activeLights = Math.min(cands.length, this.pool.length) + (this.flashOn ? 1 : 0) + 1;
  }
}

function byPriority(a, b) { return b._prio - a._prio; }
