// ENEMIES — Struct-of-Arrays horde simulation and rendering.
//
// No per-enemy objects in the hot loop (ARCHITECTURE §5). Steering is a flow
// field lookup plus separation plus wall avoidance; animation is procedural and
// written straight into instance matrices.

import * as THREE from '../../vendor/three.module.js';
import { FreeList, SpatialHash } from '../core/Pool.js';
import { ARCHETYPES, KIND, KIND_NAMES, buildArchetypeGeometry } from './Archetypes.js';
import { clamp, clamp01, angleApproach, angleDelta, dist2 } from '../core/Mathx.js';
import { CELL, C } from '../level/Grid.js';

export const ST = {
  APPROACH: 0, FLANK: 1, WINDUP: 2, RECOVER: 3, LUNGE: 4,
  FLEE: 5, EMERGE: 6, DYING: 7, RANGED: 8,
};

const CAP = 384;

export class Enemies {
  constructor(sector, events, rng, quality) {
    this.sector = sector;
    this.grid = sector.grid;
    this.nav = sector.nav;
    this.events = events;
    this.rng = rng.child('enemies');
    this.quality = quality;

    this.list = new FreeList(CAP);
    this.x = new Float32Array(CAP); this.z = new Float32Array(CAP);
    this.vx = new Float32Array(CAP); this.vz = new Float32Array(CAP);
    this.hp = new Float32Array(CAP); this.maxHp = new Float32Array(CAP);
    this.kind = new Uint8Array(CAP);
    this.state = new Uint8Array(CAP);
    this.timer = new Float32Array(CAP);
    this.facing = new Float32Array(CAP);
    this.gait = new Float32Array(CAP);
    this.flinch = new Float32Array(CAP);
    this.cooldown = new Float32Array(CAP);
    this.lungeCd = new Float32Array(CAP);
    this.emerge = new Float32Array(CAP);
    this.dying = new Float32Array(CAP);
    this.seed = new Float32Array(CAP);
    this.nestId = new Int16Array(CAP);
    this.alerted = new Uint8Array(CAP);
    this.orphaned = new Uint8Array(CAP);
    this.strand = new Float32Array(CAP);

    this.hash = new SpatialHash(0, 0, sector.grid.width, sector.grid.depth, 2.5, CAP);
    this.killCount = 0;
    this.killsByKind = new Int32Array(ARCHETYPES.length);
    this.peakAlive = 0;
    this.damageMultiplier = 1;

    this.player = null;              // injected
    this.root = new THREE.Group();
    this.root.name = 'chorus';
    this.buildRendering();

    this._scratch = { x: 0, z: 0 };
    this._res = { x: 0, z: 0, hit: false, hitX: 0, hitZ: 0 };
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  // --------------------------------------------------------------- rendering
  buildRendering() {
    this.render = ARCHETYPES.map((a) => {
      const parts = buildArchetypeGeometry(a);
      const body = new THREE.MeshStandardMaterial({
        color: a.colour, roughness: 0.62, metalness: 0.05,
        emissive: new THREE.Color(a.accent), emissiveIntensity: 0.12,
      });
      const limb = new THREE.MeshStandardMaterial({
        color: darken(a.colour, 0.65), roughness: 0.75, metalness: 0.05,
      });
      const meshes = parts.map((p) => {
        const isLimb = p.role.startsWith('leg') || p.role === 'tail' || p.role.startsWith('blade');
        const m = new THREE.InstancedMesh(p.geometry, isLimb ? limb : body, CAP);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        this.root.add(m);
        return { role: p.role, mesh: m };
      });
      return { archetype: a, meshes, bodyMat: body, limbMat: limb, indices: [] };
    });
  }

  // ------------------------------------------------------------------ spawn
  spawn(kindId, x, z, opts = {}) {
    const i = this.list.alloc();
    if (i < 0) return -1;
    const a = ARCHETYPES[kindId];
    this.x[i] = x; this.z[i] = z;
    this.vx[i] = 0; this.vz[i] = 0;
    this.hp[i] = a.hp * (opts.hpScale || 1);
    this.maxHp[i] = this.hp[i];
    this.kind[i] = kindId;
    this.state[i] = ST.EMERGE;
    this.timer[i] = 0;
    this.facing[i] = opts.facing !== undefined ? opts.facing : this.rng.angle();
    this.gait[i] = this.rng.next() * 10;
    this.flinch[i] = 0;
    this.cooldown[i] = this.rng.range(0, 0.4);
    this.lungeCd[i] = this.rng.range(1, 3);
    this.emerge[i] = opts.emergeTime ?? 0.45;
    this.dying[i] = 0;
    this.seed[i] = this.rng.next();
    this.nestId[i] = opts.nestId ?? -1;
    this.alerted[i] = opts.alerted ? 1 : 0;
    this.orphaned[i] = 0;
    this.strand[i] = 0;
    this.events.emit('enemySpawned', { id: i, kind: kindId, x, z });
    return i;
  }

  get aliveCount() {
    let n = 0;
    for (let k = 0; k < this.list.count; k++) if (this.state[this.list.active[k]] !== ST.DYING) n++;
    return n;
  }

  countOfKind(kindId) {
    let n = 0;
    for (let k = 0; k < this.list.count; k++) {
      const i = this.list.active[k];
      if (this.kind[i] === kindId && this.state[i] !== ST.DYING) n++;
    }
    return n;
  }

  // ----------------------------------------------------------------- damage
  hit(i, dmg, dirX, dirZ, hx, hy, hz, source) {
    if (!this.list.isActive(i) || this.state[i] === ST.DYING) return 0;
    const a = ARCHETYPES[this.kind[i]];
    let applied = dmg * this.damageMultiplier;
    let blocked = false;

    if (a.frontArmour !== undefined) {
      // Incoming direction vs the plate. dirX/dirZ is the travel direction of
      // the shot, so the shot came from -dir.
      const fx = Math.cos(this.facing[i]), fz = Math.sin(this.facing[i]);
      const facingDot = -(dirX * fx + dirZ * fz);
      if (facingDot > a.frontArc) { applied *= a.frontArmour; blocked = true; }
    }

    this.hp[i] -= applied;
    this.flinch[i] = Math.min(1, this.flinch[i] + (blocked ? 0.25 : 0.7));
    this.alerted[i] = 1;

    // Knockback scaled by mass — a runner is thrown, a bulwark is not.
    const knock = clamp(applied / (a.mass * 26), 0, 2.6);
    this.vx[i] += dirX * knock; this.vz[i] += dirZ * knock;

    this.events.emit('enemyHit', {
      id: i, kind: this.kind[i], x: hx, y: hy, z: hz,
      dmg: applied, dirX, dirZ, blocked, source,
      hp01: clamp01(this.hp[i] / this.maxHp[i]),
    });

    if (this.hp[i] <= 0) this.kill(i, dirX, dirZ);
    return applied;
  }

  /** Radial damage with falloff and line-of-sight — explosions do not go through walls. */
  explode(x, z, radius, power, sourceTeam = 0) {
    let hits = 0;
    for (let k = this.list.count - 1; k >= 0; k--) {
      const i = this.list.active[k];
      if (this.state[i] === ST.DYING) continue;
      const d = Math.hypot(this.x[i] - x, this.z[i] - z);
      if (d > radius) continue;
      if (!this.grid.lineOfSight(x, z, this.x[i], this.z[i])) continue;
      const falloff = 1 - clamp01(d / radius);
      const dmg = power * (0.35 + 0.65 * falloff * falloff);
      const dx = d > 0.01 ? (this.x[i] - x) / d : 0;
      const dz = d > 0.01 ? (this.z[i] - z) / d : 1;
      // Explosions ignore frontal plating: that is why the frag is the answer
      // to a bulwark you cannot get around.
      const a = ARCHETYPES[this.kind[i]];
      const saved = a.frontArmour; delete a.frontArmour;
      this.hit(i, dmg, dx, dz, this.x[i], 0.6, this.z[i], 'explosion');
      if (saved !== undefined) a.frontArmour = saved;
      hits++;
    }
    return hits;
  }

  kill(i, dirX = 0, dirZ = 0) {
    if (this.state[i] === ST.DYING) return;
    const a = ARCHETYPES[this.kind[i]];
    this.state[i] = ST.DYING;
    this.dying[i] = 0;
    this.killCount++;
    this.killsByKind[this.kind[i]]++;
    this.events.emit('enemyDied', {
      id: i, kind: this.kind[i], x: this.x[i], y: 0.4, z: this.z[i],
      dirX, dirZ, elite: !!a.elite, nestId: this.nestId[i], score: a.score,
    });
  }

  /** Panic reaction when the source of the pressure dies (DIRECTION §2 relief). */
  panic(nestId, duration = 3.5) {
    let n = 0;
    for (let k = 0; k < this.list.count; k++) {
      const i = this.list.active[k];
      if (this.state[i] === ST.DYING) continue;
      if (nestId >= 0 && this.nestId[i] !== nestId) continue;
      const a = ARCHETYPES[this.kind[i]];
      if (a.elite) continue;
      this.state[i] = ST.FLEE;
      this.timer[i] = duration * (0.7 + this.rng.next() * 0.6);
      if (nestId >= 0) this.orphaned[i] = 1;
      n++;
    }
    return n;
  }

  // ----------------------------------------------------------------- update
  update(dt, time) {
    const p = this.player;
    const px = p ? p.x : 0, pz = p ? p.z : 0;
    const playerAlive = p ? p.alive : false;

    this.hash.build(this.list.active, this.list.count, this.x, this.z);

    const flow = this.nav.player, flank = this.nav.flank;
    const out = this._scratch;
    let alive = 0;

    for (let k = this.list.count - 1; k >= 0; k--) {
      const i = this.list.active[k];
      const a = ARCHETYPES[this.kind[i]];
      const st = this.state[i];

      this.flinch[i] = Math.max(0, this.flinch[i] - dt * 3.4);
      this.cooldown[i] = Math.max(0, this.cooldown[i] - dt);
      this.lungeCd[i] = Math.max(0, this.lungeCd[i] - dt);

      if (st === ST.DYING) {
        this.dying[i] += dt;
        // slide to a stop, then release
        this.vx[i] *= 0.86; this.vz[i] *= 0.86;
        this.x[i] += this.vx[i] * dt; this.z[i] += this.vz[i] * dt;
        if (this.dying[i] > 1.5) this.list.release(i);
        continue;
      }
      alive++;

      if (st === ST.EMERGE) {
        this.emerge[i] -= dt;
        if (this.emerge[i] <= 0) this.state[i] = ST.APPROACH;
        continue;
      }

      const dx = px - this.x[i], dz = pz - this.z[i];
      const distToPlayer = Math.hypot(dx, dz);
      const dirX = distToPlayer > 0.001 ? dx / distToPlayer : 0;
      const dirZ = distToPlayer > 0.001 ? dz / distToPlayer : 0;

      if (!this.alerted[i] && distToPlayer < a.senseRange) this.alerted[i] = 1;

      let desiredX = 0, desiredY = 0;
      let speed = a.speed;

      switch (this.state[i]) {
        case ST.WINDUP: {
          this.timer[i] -= dt;
          speed = 0;
          if (this.timer[i] <= 0) {
            if (a.kind === KIND.SPITTER) this.fireSpit(i, px, pz);
            else if (distToPlayer <= a.attackRange + 0.45 && playerAlive) {
              p.damage(a.damage, dirX, dirZ);
              this.events.emit('enemyStrike', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i], hit: true });
            } else {
              this.events.emit('enemyStrike', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i], hit: false });
            }
            this.state[i] = ST.RECOVER;
            this.timer[i] = a.attackRecover;
          }
          break;
        }
        case ST.RECOVER: {
          this.timer[i] -= dt;
          speed = a.speed * 0.25;
          if (this.timer[i] <= 0) this.state[i] = ST.APPROACH;
          break;
        }
        case ST.LUNGE: {
          this.timer[i] -= dt;
          speed = a.lungeSpeed;
          desiredX = Math.cos(this.facing[i]); desiredY = Math.sin(this.facing[i]);
          if (this.timer[i] <= 0) { this.state[i] = ST.RECOVER; this.timer[i] = a.attackRecover; }
          if (distToPlayer < a.attackRange && playerAlive) {
            p.damage(a.damage, dirX, dirZ);
            this.events.emit('enemyStrike', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i], hit: true });
            this.state[i] = ST.RECOVER; this.timer[i] = a.attackRecover;
          }
          break;
        }
        case ST.FLEE: {
          this.timer[i] -= dt;
          speed = a.speed * 1.05;
          desiredX = -dirX; desiredY = -dirZ;
          if (a.fleeHeal) this.hp[i] = Math.min(this.maxHp[i], this.hp[i] + a.fleeHeal * dt);
          if (this.orphaned[i] && distToPlayer > 17 && this.timer[i] < 2.0) {
            // Its node is gone. It withdraws into the structure and does not
            // come back — this is the drop in pressure the player must feel.
            this.events.emit('enemyWithdrew', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i] });
            this.list.release(i);
            alive--;
            continue;
          }
          if (this.timer[i] <= 0) {
            if (this.orphaned[i]) { this.timer[i] = 3.0; }
            else { this.state[i] = ST.APPROACH; this.alerted[i] = 1; }
          }
          break;
        }
        default: {
          // APPROACH / FLANK / RANGED
          const useFlank = (this.state[i] === ST.FLANK);
          const field = useFlank ? flank : flow;
          if (field.sample(this.x[i], this.z[i], out)) {
            desiredX = out.x; desiredY = out.z;
            this.strand[i] = 0;
          } else {
            desiredX = dirX; desiredY = dirZ;
            // No route to the player at all. Give it a while — doors cycle, the
            // player moves — then let it withdraw. A single unreachable
            // straggler must never stop a room from feeling cleared.
            this.strand[i] += dt;
            if (this.strand[i] > 14 && distToPlayer > 12) {
              this.events.emit('enemyWithdrew', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i] });
              this.list.release(i);
              alive--;
              continue;
            }
          }

          if (a.kind === KIND.SPITTER) {
            // Hold at preferred range and shoot; back off if crowded.
            if (distToPlayer < a.preferredRange * 0.72) { desiredX = -dirX; desiredY = -dirZ; speed = a.speed * 1.2; }
            else if (distToPlayer < a.preferredRange * 1.15) { desiredX *= 0.15; desiredY *= 0.15; }
            if (this.cooldown[i] <= 0 && distToPlayer < a.attackRange && playerAlive &&
                this.grid.lineOfSight(this.x[i], this.z[i], px, pz)) {
              this.state[i] = ST.WINDUP;
              this.timer[i] = a.attackWindup;
              this.events.emit('enemyWindup', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i] });
            }
          } else {
            if (distToPlayer <= a.attackRange && this.cooldown[i] <= 0 && playerAlive) {
              this.state[i] = ST.WINDUP;
              this.timer[i] = a.attackWindup;
              this.cooldown[i] = a.attackWindup + a.attackRecover;
              this.events.emit('enemyWindup', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i] });
            } else if (a.lungeSpeed && this.lungeCd[i] <= 0 && distToPlayer < a.lungeRange &&
                       distToPlayer > a.attackRange * 1.4 &&
                       this.grid.lineOfSight(this.x[i], this.z[i], px, pz)) {
              this.state[i] = ST.LUNGE;
              this.timer[i] = 0.42;
              this.lungeCd[i] = a.lungeCooldown;
              this.facing[i] = Math.atan2(dirZ, dirX);
              this.events.emit('enemyLunge', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i] });
            }
          }

          // Hunters break off when hurt and come back another way.
          if (a.fleeBelow && this.hp[i] / this.maxHp[i] < a.fleeBelow && this.state[i] !== ST.FLEE) {
            this.state[i] = ST.FLEE;
            this.timer[i] = a.fleeTime;
            this.events.emit('enemyFlee', { id: i, kind: this.kind[i], x: this.x[i], z: this.z[i] });
          }
          // Stalkers prefer the flank route until they are close.
          if (a.flankBias > 0.5 && distToPlayer > 9 && this.state[i] === ST.APPROACH &&
              this.seed[i] < a.flankBias) {
            this.state[i] = ST.FLANK;
          } else if (this.state[i] === ST.FLANK && distToPlayer < 7.5) {
            this.state[i] = ST.APPROACH;
          }
        }
      }

      if (!this.alerted[i]) speed *= 0.25;
      speed *= (1 - this.flinch[i] * 0.55);

      // --- separation: the horde must not merge into one organism
      let sepX = 0, sepZ = 0;
      const n = this.hash.query(this.x[i], this.z[i], a.radius * 2 + 0.9);
      const res = this.hash.result;
      for (let q = 0; q < n; q++) {
        const j = res[q];
        if (j === i) continue;
        const ox = this.x[i] - this.x[j], oz = this.z[i] - this.z[j];
        const d2 = ox * ox + oz * oz;
        const rr = a.radius + ARCHETYPES[this.kind[j]].radius;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) / rr;
        const massRatio = ARCHETYPES[this.kind[j]].mass / (a.mass + ARCHETYPES[this.kind[j]].mass);
        sepX += (ox / d) * push * massRatio;
        sepZ += (oz / d) * push * massRatio;
      }

      const dl = Math.hypot(desiredX, desiredY);
      if (dl > 1e-4) { desiredX /= dl; desiredY /= dl; }
      let tvx = desiredX * speed + sepX * speed * 1.5;
      let tvz = desiredY * speed + sepZ * speed * 1.5;

      const accel = a.accel * dt;
      this.vx[i] += clamp(tvx - this.vx[i], -accel, accel);
      this.vz[i] += clamp(tvz - this.vz[i], -accel, accel);

      const nx = this.x[i] + this.vx[i] * dt;
      const nz = this.z[i] + this.vz[i] * dt;
      this.grid.resolveCircle(nx, nz, a.radius, this._res);
      const moved = Math.hypot(this._res.x - this.x[i], this._res.z - this.z[i]);
      this.x[i] = this._res.x; this.z[i] = this._res.z;
      if (this._res.hit) {
        const hl = Math.hypot(this._res.hitX, this._res.hitZ);
        if (hl > 1e-5) {
          const wx = this._res.hitX / hl, wz = this._res.hitZ / hl;
          const into = this.vx[i] * wx + this.vz[i] * wz;
          if (into < 0) { this.vx[i] -= wx * into; this.vz[i] -= wz * into; }
        }
      }

      // Face travel direction, except when winding up: then face the player, so
      // the telegraph is legible.
      const target = (this.state[i] === ST.WINDUP || this.state[i] === ST.RECOVER)
        ? Math.atan2(dirZ, dirX)
        : (Math.hypot(this.vx[i], this.vz[i]) > 0.4 ? Math.atan2(this.vz[i], this.vx[i]) : this.facing[i]);
      this.facing[i] = angleApproach(this.facing[i], target, 9 * dt);
      this.gait[i] += (moved / dt) * dt * a.gaitRate * 0.16;
    }

    if (alive > this.peakAlive) this.peakAlive = alive;
    this.aliveNow = alive;
  }

  fireSpit(i, px, pz) {
    const a = ARCHETYPES[this.kind[i]];
    const dx = px - this.x[i], dz = pz - this.z[i];
    const d = Math.hypot(dx, dz) || 1;
    const t = d / a.projectileSpeed;
    this.events.emit('spit', {
      x: this.x[i], y: 0.85, z: this.z[i],
      vx: (dx / d) * a.projectileSpeed,
      vy: 0.5 * 6 * t + 0.6,
      vz: (dz / d) * a.projectileSpeed,
      damage: a.damage, id: i,
    });
  }

  // ------------------------------------------------------------ presentation
  /** Write instance matrices. Called once per rendered frame, not per step. */
  draw(alpha, time) {
    for (const r of this.render) r.indices.length = 0;
    for (let k = 0; k < this.list.count; k++) {
      const i = this.list.active[k];
      this.render[this.kind[i]].indices.push(i);
    }

    const m4 = this._m4, q = this._q, v = this._v, sc = this._sc, e = this._e;
    for (const r of this.render) {
      const a = r.archetype;
      const ids = r.indices;
      for (const part of r.meshes) part.mesh.count = ids.length;
      for (let n = 0; n < ids.length; n++) {
        const i = ids[n];
        const yaw = -this.facing[i] + Math.PI / 2;
        const gait = this.gait[i];
        const dyingT = this.state[i] === ST.DYING ? clamp01(this.dying[i] / 0.7) : 0;
        const emergeT = this.state[i] === ST.EMERGE ? clamp01(1 - this.emerge[i] / 0.45) : 1;
        const flinch = this.flinch[i];
        const windup = this.state[i] === ST.WINDUP
          ? 1 - clamp01(this.timer[i] / Math.max(0.01, a.attackWindup)) : 0;

        // A dying enemy collapses and sinks; an emerging one pushes up out of
        // the deck. Both read instantly at a glance, which is the requirement.
        const baseY = a.height * (0.35 + 0.65 * emergeT) - dyingT * a.height * 0.55;
        const bodyScale = (1 - dyingT * 0.35) * (0.6 + 0.4 * emergeT);
        const lean = windup * 0.42 - dyingT * 0.9 + flinch * 0.16;

        for (const part of r.meshes) {
          let ox = 0, oy = 0, oz = 0, rx = lean, ry = yaw, rz = 0, s = bodyScale;
          const role = part.role;
          if (role === 'head') {
            oz = a.radius * 0.85; oy = a.height * 0.16;
            rx = lean + windup * 0.5;
          } else if (role === 'sac') {
            oz = -a.radius * 0.5; oy = a.height * 0.30;
            s = bodyScale * (1 + windup * 0.42);      // the swelling warning
          } else if (role === 'plate') {
            oz = a.radius * 0.92; oy = a.height * 0.18;
          } else if (role === 'tail') {
            oz = -a.radius * 1.1; oy = a.height * 0.22;
            rx = lean + Math.sin(gait * 0.7) * 0.25;
          } else if (role.startsWith('blade')) {
            const side = role === 'blade0' ? 1 : -1;
            ox = side * a.radius * 0.78; oy = a.height * 0.12; oz = a.radius * 0.3;
            rz = side * (0.25 - windup * 0.9);
          } else if (role.startsWith('leg')) {
            const li = +role.slice(3);
            const side = (li % 2) ? 1 : -1;
            const front = li < 2 ? 1 : -1;
            const phase = gait + (li * Math.PI * 0.5);
            const lift = Math.sin(phase);
            ox = side * a.radius * 0.92;
            oz = front * a.radius * 0.55;
            oy = -a.height * 0.30 + Math.max(0, lift) * a.height * 0.22;
            rx = lift * 0.75;
            rz = side * (0.5 + Math.cos(phase) * 0.2);
            s = bodyScale;
          }

          // rotate the local offset into world space around Y
          const cy = Math.cos(yaw), sy = Math.sin(yaw);
          const wx = ox * cy + oz * sy;
          const wz = -ox * sy + oz * cy;

          e.set(rx, ry, rz, 'YXZ');
          q.setFromEuler(e);
          v.set(this.x[i] + wx, baseY + oy, this.z[i] + wz);
          sc.set(s, s, s);
          m4.compose(v, q, sc);
          part.mesh.setMatrixAt(n, m4);
        }
      }
      for (const part of r.meshes) {
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** Interface handed to WEAPONS so it can damage without importing ENEMIES. */
  targetInterface(player) {
    const self = this;
    return {
      result: self.hash.result,
      queryRadius: (x, z, r) => self.hash.query(x, z, r),
      radiusOf: (i) => ARCHETYPES[self.kind[i]].radius,
      xOf: (i) => self.x[i],
      zOf: (i) => self.z[i],
      alive: (i) => self.list.isActive(i) && self.state[i] !== ST.DYING,
      hit: (i, dmg, dx, dz, hx, hy, hz, src) => self.hit(i, dmg, dx, dz, hx, hy, hz, src),
      playerPos: player,
      playerAlive: () => player.alive,
      playerHit: (dmg, dx, dz) => player.damage(dmg, dx, dz),
    };
  }

  /** Nearest living enemy to a point, for HUD threat indication and QA. */
  nearest(x, z, maxDist = 999) {
    let best = -1, bestD = maxDist * maxDist;
    for (let k = 0; k < this.list.count; k++) {
      const i = this.list.active[k];
      if (this.state[i] === ST.DYING) continue;
      const d = dist2(x, z, this.x[i], this.z[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  clear() {
    this.list.clear();
    for (const r of this.render) for (const p of r.meshes) p.mesh.count = 0;
  }
}

function darken(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}

export { ARCHETYPES, KIND, KIND_NAMES };
