// ENEMIES / Nests — the breach-nodes.
//
// The nests ARE the level (DIRECTION §2): they are the visible source of the
// pressure, they are destructible, and killing one produces a measurable drop in
// enemy count (gate X6). Everything about their presentation exists to make the
// player able to find them without being told.

import * as THREE from '../../vendor/three.module.js';
import { KIND } from './Archetypes.js';
import { clamp01 } from '../core/Mathx.js';
import { CELL, C } from '../level/Grid.js';
import { PAL } from '../environment/Palette.js';

const KIND_OF = {
  runner: KIND.RUNNER, stalker: KIND.STALKER, spitter: KIND.SPITTER,
  bulwark: KIND.BULWARK, hunter: KIND.HUNTER, larva: KIND.LARVA,
};

export class Nests {
  constructor(sector, enemies, events, rng, environment) {
    this.sector = sector;
    this.grid = sector.grid;
    this.enemies = enemies;
    this.events = events;
    this.rng = rng.child('nests');
    this.env = environment;

    this.root = new THREE.Group();
    this.root.name = 'nests';
    this.list = [];
    this.remaining = 0;
    this.active = false;      // director gates spawning
    this.globalCap = 26;      // living Chorus ceiling across the whole sector

    this.material = new THREE.MeshStandardMaterial({
      color: 0x5a2d63, roughness: 0.42, metalness: 0.0,
      emissive: new THREE.Color(PAL.violet), emissiveIntensity: 0.55,
    });

    for (const spec of sector.spec.nests) this.create(spec);
    this.remaining = this.list.length;
  }

  create(spec) {
    const x = (spec.x + 0.5) * CELL;
    const z = (spec.z + 0.5) * CELL;
    const geom = this.env.makeNestGeometry(spec.type);
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.position.set(x, spec.type === 'brood' ? 0.4 : 0.0, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);

    // Nearby vents give the nest flanking ingress: some of its brood arrives
    // from a side route rather than all from one point.
    const vents = this.sector.vents.filter((v) =>
      v.valid && Math.hypot(v.sx - x, v.sz - z) < 34);

    const nest = {
      id: spec.id, spec, x, z, mesh,
      type: spec.type,
      hp: spec.hp, maxHp: spec.hp,
      alive: true,
      spawnTimer: this.rng.range(0.4, 1.4),
      burstLeft: spec.budget.burst || 0,
      woken: false,
      pulse: this.rng.next() * 6.28,
      hurt: 0,
      children: 0,
      spawned: 0,
      vents,
      index: this.list.length,
      emitter: null,
    };
    this.list.push(nest);
    return nest;
  }

  /** LIGHTING registers each nest as a persistent violet emitter. */
  registerLights(lighting) {
    for (const n of this.list) {
      n.emitter = lighting.addEmitter({
        x: n.x, y: 1.5, z: n.z, color: PAL.violet,
        intensity: 40, radius: 16,
      });
    }
    this.lighting = lighting;
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.list) {
      if (!n.alive) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best ? { nest: best, dist: bd } : null;
  }

  /** Damage from projectiles/explosions is routed here by GAME. */
  damage(nest, amount, hx, hy, hz) {
    if (!nest.alive) return;
    nest.hp -= amount;
    nest.hurt = Math.min(1, nest.hurt + 0.55);
    this.events.emit('nestDamaged', {
      id: nest.id, x: hx ?? nest.x, y: hy ?? 1.2, z: hz ?? nest.z,
      hp01: clamp01(nest.hp / nest.maxHp),
    });
    if (nest.hp <= 0) this.destroy(nest);
  }

  destroy(nest) {
    if (!nest.alive) return;
    nest.alive = false;
    nest.mesh.visible = false;
    this.remaining--;
    if (nest.emitter && this.lighting) this.lighting.removeEmitter(nest.emitter);

    // The relief beat: everything this nest made loses its nerve.
    const panicked = this.enemies.panic(nest.index, 4.0);

    this.events.emit('nestDestroyed', {
      id: nest.id, x: nest.x, y: 1.2, z: nest.z,
      kind: nest.type, remaining: this.remaining, panicked,
    });
    this.sector.onNestDestroyed(nest.id, this.remaining);
  }

  hitTest(x, z, radius) {
    for (const n of this.list) {
      if (!n.alive) continue;
      const r = (n.type === 'brood' ? 1.9 : 2.3) + radius;
      if ((n.x - x) ** 2 + (n.z - z) ** 2 <= r * r) return n;
    }
    return null;
  }

  update(dt, time, px, pz) {
    for (const n of this.list) {
      n.hurt = Math.max(0, n.hurt - dt * 1.6);
      if (!n.alive) continue;

      // Breathing is synced to the spawn cadence: the nest visibly inhales
      // before it produces something. That is the "it is doing this" tell.
      const rate = n.spec.budget.rate;
      const phase = 1 - clamp01(n.spawnTimer / Math.max(0.2, rate));
      n.pulse = phase;
      const swell = 1 + Math.pow(phase, 3) * 0.16 + n.hurt * 0.08;
      n.mesh.scale.setScalar(swell);
      n.mesh.rotation.y = Math.sin(time * 0.3 + n.index) * 0.06;
      if (n.emitter) n.emitter.intensity = 30 + 46 * Math.pow(phase, 4) + n.hurt * 50;

      if (!this.active) continue;

      const dist = Math.hypot(px - n.x, pz - n.z);
      // A nest wakes with its own part of the station. Two nests in one hall
      // both live from 60 m away is double pressure the player never chose.
      if (dist > 32) continue;

      // Waking: the first sight of a node comes with a brood already on its
      // feet, so the player walks into pressure rather than into an empty room.
      if (!n.woken) {
        n.woken = true;
        n.spawnTimer = 0;
        this.events.emit('nestWoke', { id: n.id, x: n.x, z: n.z });
      }

      n.spawnTimer -= dt;
      if (n.spawnTimer > 0) continue;

      const budget = n.spec.budget;
      const bursting = n.burstLeft > 0;
      if (bursting) n.burstLeft--;
      n.spawnTimer = bursting ? 0.16 : rate * this.rng.range(0.82, 1.22);
      if (this.enemies.aliveNow >= this.globalCap) continue;
      if (this.countChildren(n) >= budget.max) continue;
      if (this.enemies.list.freeCount <= 8) continue;

      const pick = this.rng.pick(budget.mix);
      const kindId = KIND_OF[pick];
      if (kindId === undefined) continue;

      // Roughly a third of the brood arrives through a vent, so pressure does
      // not all come from one bearing.
      let sx = n.x, sz = n.z, viaVent = false;
      if (n.vents.length && this.rng.bool(0.34)) {
        // prefer a vent that is not on top of the player
        let best = null, bestScore = -1;
        for (const v of n.vents) {
          const dp = Math.hypot(v.sx - px, v.sz - pz);
          if (dp < 7) continue;
          const score = 1 / (1 + Math.abs(dp - 16)) + this.rng.next() * 0.4;
          if (score > bestScore) { bestScore = score; best = v; }
        }
        if (best) { sx = best.sx; sz = best.sz; viaVent = true; }
      }
      if (!viaVent) {
        const a = this.rng.angle();
        const r = this.rng.range(1.6, 3.0);
        const tx = n.x + Math.cos(a) * r, tz = n.z + Math.sin(a) * r;
        if (this.grid.walkableCell(Math.floor(tx / CELL), Math.floor(tz / CELL))) { sx = tx; sz = tz; }
      }

      const id = this.enemies.spawn(kindId, sx, sz, {
        nestId: n.index,
        alerted: dist < 30,
        emergeTime: viaVent ? 0.30 : 0.55,
      });
      if (id >= 0) {
        n.spawned++;
        this.events.emit('nestSpawn', { id: n.id, x: sx, y: 0.5, z: sz, kind: n.type, viaVent });
      }
    }
  }

  countChildren(nest) {
    const e = this.enemies;
    let c = 0;
    for (let k = 0; k < e.list.count; k++) {
      const i = e.list.active[k];
      if (e.nestId[i] === nest.index && e.state[i] !== 7 /* DYING */) c++;
    }
    return c;
  }

  get aliveNests() { return this.list.filter((n) => n.alive); }
}
