// ENEMIES / Broods — the brood queens and their egg clutches.
//
// The queens ARE the level (DIRECTION §2): they are the visible source of the
// pressure, they are destructible, and killing one produces a measurable drop in
// enemy count (gate X6). Everything about their presentation exists to make the
// player able to find one, read what it is doing, and understand why it has to
// die, without being told any of it.
//
// The pressure runs through a two-stage pipeline rather than appearing from
// nowhere:
//
//   QUEEN --lays--> EGG --incubates--> CHORUS
//
// That middle stage is the whole point of the change. It gives the player a
// second, cheaper answer than "kill the queen": eggs are soft, they are visible
// before they hatch, and a frag clears a clutch. It means the room tells you
// what is about to happen to you, and it makes the frag a tool for the level
// instead of only a tool for a crowd.

import * as THREE from '../../vendor/three.module.js';
import { KIND, buildQueenGeometry, buildEggGeometry } from './Archetypes.js';
import { clamp01 } from '../core/Mathx.js';
import { CELL } from '../level/Grid.js';
import { PAL } from '../environment/Palette.js';

const KIND_OF = {
  runner: KIND.RUNNER, stalker: KIND.STALKER, spitter: KIND.SPITTER,
  bulwark: KIND.BULWARK, hunter: KIND.HUNTER, larva: KIND.LARVA,
};

const EGG_CAP = 96;

// Which way a queen faces, keyed the same way the sector spec is. `face` names
// the wall she is against, so her forward is the opposite of it.
const FACE_DIR = { 'x-': [-1, 0], 'x+': [1, 0], 'z-': [0, -1], 'z+': [0, 1] };

export class Broods {
  constructor(sector, enemies, events, rng) {
    this.sector = sector;
    this.grid = sector.grid;
    this.enemies = enemies;
    this.events = events;
    this.rng = rng.child('broods');

    this.root = new THREE.Group();
    this.root.name = 'broods';
    this.list = [];           // the queens
    this.remaining = 0;
    this.active = false;      // director gates laying
    this.globalCap = 26;      // living Chorus ceiling across the whole sector

    // She is lit BY the violet, she is not made of it. At emissiveIntensity 0.55
    // — inherited from the old static nest prop, which had no light of its own
    // sitting inside it — her own emitter blew her surface out to pale pink and
    // every form cue on her went with it. The light says "something is here";
    // her surface has to say what.
    this.fleshMat = new THREE.MeshStandardMaterial({
      color: 0x4a2652, roughness: 0.46, metalness: 0.0,
      emissive: new THREE.Color(PAL.violet), emissiveIntensity: 0.22,
    });
    // The hood is mineral, not meat. Reading as a different material is the
    // entire job: it is what makes "shoot her somewhere else" legible.
    this.chitinMat = new THREE.MeshStandardMaterial({
      color: 0x39323f, roughness: 0.62, metalness: 0.14,
      emissive: new THREE.Color(PAL.violet), emissiveIntensity: 0.06,
    });

    for (const spec of sector.spec.queens) this.create(spec);
    this.remaining = this.list.length;

    this.buildEggs();
  }

  // ------------------------------------------------------------------ queens
  create(spec) {
    const x = (spec.x + 0.5) * CELL;
    const z = (spec.z + 0.5) * CELL;
    const parts = buildQueenGeometry(spec.type, this.rng);

    const group = new THREE.Group();
    const body = new THREE.Mesh(parts.body, this.fleshMat);
    const hood = new THREE.Mesh(parts.hood, this.chitinMat);
    const abdomen = new THREE.Mesh(parts.abdomen, this.fleshMat);
    abdomen.position.set(0, parts.abdomenY, parts.abdomenZ);
    for (const m of [body, hood, abdomen]) { m.castShadow = true; m.receiveShadow = true; }
    group.add(body, hood, abdomen);
    group.position.set(x, 0, z);

    const dir = FACE_DIR[spec.face] || [0, -1];
    const fx = -dir[0], fz = -dir[1];
    group.rotation.y = Math.atan2(fx, fz);
    this.root.add(group);

    // Nearby vents give the queen flanking ingress: some of her clutch is laid
    // at a side route rather than all of it at her feet.
    const vents = this.sector.vents.filter((v) =>
      v.valid && Math.hypot(v.sx - x, v.sz - z) < 34);

    const queen = {
      id: spec.id, spec, x, z, type: spec.type,
      group, body, hood, abdomen,
      abdomenHome: { y: parts.abdomenY, z: parts.abdomenZ },
      scale: parts.scale,
      facingX: fx, facingZ: fz,
      hp: spec.hp, maxHp: spec.hp,
      alive: true,
      layTimer: this.rng.range(0.4, 1.4),
      layPhase: 0,           // 0..1 through the current laying cycle
      stirring: false,       // heard and seen, but not yet producing
      stirT: 0,
      heralded: false,
      convulseLeft: 0,       // eggs still owed by a convulsion
      convulsesDone: 0,
      clutchLost: 0,         // eggs culled recently, decays
      cullCooldown: 0,
      dormant: !!spec.dormant,
      woken: false,
      hurt: 0,
      spawned: 0,
      eggsLaid: 0,
      vents,
      index: this.list.length,
      emitter: null,
    };
    this.list.push(queen);
    return queen;
  }

  /** LIGHTING registers each queen as a persistent violet emitter. */
  registerLights(lighting) {
    for (const q of this.list) {
      // Under her, not inside her: an emitter at body height lights her own
      // surface at point-blank range and clips before it reaches the floor.
      q.emitter = lighting.addEmitter({
        x: q.x, y: 0.55, z: q.z, color: PAL.violet,
        intensity: 28, radius: 17,
      });
    }
    this.lighting = lighting;
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const q of this.list) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < bd) { bd = d; best = q; }
    }
    return best ? { queen: best, dist: bd } : null;
  }

  /**
   * Damage from projectiles/explosions is routed here by GAME.
   *
   * `dirX/dirZ` is the direction of travel of whatever hit her. A round coming
   * in against her facing lands on the hood and mostly does not count. An
   * explosion arrives with no direction and is never reduced, which is what
   * makes the frag worth carrying into a queen chamber.
   */
  damageQueen(queen, amount, hx, hy, hz, dirX, dirZ) {
    if (!queen.alive) return 0;
    // Dormant is invulnerable, on every path — rounds, splash, fire. hitTest
    // stops anything aiming at her; this stops a frag going off nearby from
    // killing a phase that has not started yet.
    if (queen.dormant) return 0;
    let blocked = false;
    if (dirX !== undefined && dirZ !== undefined) {
      // dot < 0 means the round is travelling INTO her face
      const facing = dirX * queen.facingX + dirZ * queen.facingZ;
      if (facing < -0.28) { amount *= 0.34; blocked = true; }
    }
    queen.hp -= amount;
    queen.hurt = Math.min(1, queen.hurt + 0.55);
    this.events.emit('queenDamaged', {
      id: queen.id, x: hx ?? queen.x, y: hy ?? 1.6, z: hz ?? queen.z,
      hp01: clamp01(queen.hp / queen.maxHp), blocked,
    });

    // Convulsions at two thirds and one third: being hurt makes her produce
    // faster, so the fight has a rhythm rather than a slope.
    const frac = queen.hp / queen.maxHp;
    const want = frac <= 0.34 ? 2 : frac <= 0.67 ? 1 : 0;
    if (want > queen.convulsesDone && queen.hp > 0) {
      queen.convulsesDone = want;
      queen.convulseLeft = queen.spec.budget.clutch || 4;
      queen.layTimer = 0;
      this.events.emit('queenConvulsed', { id: queen.id, x: queen.x, z: queen.z });
    }

    if (queen.hp <= 0) this.killQueen(queen);
    return amount;
  }

  killQueen(queen) {
    if (!queen.alive) return;
    queen.alive = false;
    queen.group.visible = false;
    this.remaining--;
    if (queen.emitter && this.lighting) this.lighting.removeEmitter(queen.emitter);

    // Her unhatched clutch dies with her. This is the difference between a
    // relief beat and a reprieve: nothing is still in the pipe.
    let eggsLost = 0;
    for (let i = 0; i < this.eggCount; i++) {
      if (this.eggAlive[i] && this.eggQueen[i] === queen.index) {
        this.collapseEgg(i);
        eggsLost++;
      }
    }

    // The relief beat: everything this queen made loses its nerve.
    const panicked = this.enemies.panic(queen.index, 4.0);

    this.events.emit('queenKilled', {
      id: queen.id, x: queen.x, y: 1.6, z: queen.z,
      kind: queen.type, remaining: this.remaining, panicked, eggsLost,
    });
    this.sector.onQueenKilled(queen.id, this.remaining);
  }

  /** Projectile broadphase: is anything of ours at this point? */
  hitTest(x, z, radius) {
    for (const q of this.list) {
      if (!q.alive) continue;
      // A dormant queen cannot be shot. She is inert scenery until the level
      // wakes her, and letting the player kill her early does not skip a fight,
      // it strands the run: the section she belongs to is then entered with
      // nothing left to kill, and everything gated behind that section stays
      // gated. Two-phase rooms only work if phase two cannot be pre-empted.
      if (q.dormant) continue;
      // Deliberately a little larger than she looks. Tightening these to hug
      // the silhouette was tried and measured: it cost 25% of the radius, the
      // autopilot's time-on-target against every queen went up, and the run died
      // at 89 s instead of reaching the exit at 194 s. A target the player is
      // meant to circle *while* a room fills up should be forgiving to hit; the
      // difficulty in this fight is the movement, not the aim.
      const r = (q.type === 'matriarch' ? 2.4 : 2.0) + radius;
      if ((q.x - x) ** 2 + (q.z - z) ** 2 <= r * r) return q;
    }
    return null;
  }

  // -------------------------------------------------------------------- eggs
  buildEggs() {
    const g = buildEggGeometry();
    this.eggAlive = new Uint8Array(EGG_CAP);
    this.eggX = new Float32Array(EGG_CAP);
    this.eggZ = new Float32Array(EGG_CAP);
    this.eggT = new Float32Array(EGG_CAP);      // seconds of incubation left
    this.eggDur = new Float32Array(EGG_CAP);
    this.eggHp = new Float32Array(EGG_CAP);
    this.eggKind = new Uint8Array(EGG_CAP);
    this.eggQueen = new Int16Array(EGG_CAP);
    this.eggSeed = new Float32Array(EGG_CAP);
    this.eggVent = new Uint8Array(EGG_CAP);
    this.eggCount = 0;                          // high-water mark of used slots
    this.eggsAlive = 0;

    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x5b3f63, roughness: 0.38, metalness: 0.0,
      emissive: new THREE.Color(PAL.violet), emissiveIntensity: 0.10,
    });
    // The core carries the incubation ramp. It must stay VIOLET while doing it:
    // at 3.2x it went straight through the AgX shoulder to white-pink, which
    // reads as plastic and, worse, stops meaning "Chorus" — violet is a
    // meaning-colour (DIRECTION §5.5) and a light that desaturates to white is
    // no longer carrying it. 1.35x sits inside the shoulder and still blooms.
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.violet), toneMapped: true });
    coreMat.color.multiplyScalar(1.35);

    this.eggShellMesh = new THREE.InstancedMesh(g.shell, shellMat, EGG_CAP);
    this.eggCoreMesh = new THREE.InstancedMesh(g.core, coreMat, EGG_CAP);
    for (const m of [this.eggShellMesh, this.eggCoreMesh]) {
      m.frustumCulled = false;
      m.count = 0;
      this.root.add(m);
    }
    this.eggShellMesh.castShadow = true;
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  allocEgg() {
    for (let i = 0; i < EGG_CAP; i++) {
      if (!this.eggAlive[i]) {
        if (i >= this.eggCount) this.eggCount = i + 1;
        return i;
      }
    }
    return -1;
  }

  layEgg(queen, x, z, kindId, incubate, viaVent) {
    const i = this.allocEgg();
    if (i < 0) return -1;
    this.eggAlive[i] = 1;
    this.eggX[i] = x; this.eggZ[i] = z;
    this.eggT[i] = incubate;
    this.eggDur[i] = incubate;
    this.eggHp[i] = 22;
    this.eggKind[i] = kindId;
    this.eggQueen[i] = queen.index;
    this.eggSeed[i] = this.rng.next();
    this.eggVent[i] = viaVent ? 1 : 0;
    this.eggsAlive++;
    queen.eggsLaid++;
    this.events.emit('eggLaid', { x, y: 0.3, z, queen: queen.id, viaVent });
    return i;
  }

  damageEgg(i, amount, hx, hy, hz) {
    if (!this.eggAlive[i]) return;
    this.eggHp[i] -= amount;
    this.events.emit('eggHit', { x: hx ?? this.eggX[i], y: hy ?? 0.4, z: hz ?? this.eggZ[i] });
    if (this.eggHp[i] <= 0) {
      this.events.emit('eggDestroyed', {
        x: this.eggX[i], y: 0.4, z: this.eggZ[i],
        ripe: 1 - clamp01(this.eggT[i] / Math.max(0.01, this.eggDur[i])),
      });
      const queen = this.list[this.eggQueen[i]];
      if (queen && queen.alive) queen.clutchLost++;
      this.freeEgg(i);
    }
  }

  /** Killed with its queen: no burst, it just goes out. */
  collapseEgg(i) {
    this.events.emit('eggCollapsed', { x: this.eggX[i], y: 0.4, z: this.eggZ[i] });
    this.freeEgg(i);
  }

  freeEgg(i) {
    this.eggAlive[i] = 0;
    this.eggsAlive--;
    if (i === this.eggCount - 1) {
      while (this.eggCount > 0 && !this.eggAlive[this.eggCount - 1]) this.eggCount--;
    }
  }

  hatch(i) {
    const queen = this.list[this.eggQueen[i]];
    const id = this.enemies.spawn(this.eggKind[i], this.eggX[i], this.eggZ[i], {
      broodId: this.eggQueen[i],
      alerted: true,
      emergeTime: 0.34,
    });
    if (id < 0) return false;          // pool full: leave it in the shell
    if (queen) queen.spawned++;
    this.events.emit('eggHatched', {
      x: this.eggX[i], y: 0.5, z: this.eggZ[i],
      kind: this.eggKind[i], viaVent: !!this.eggVent[i],
    });
    this.freeEgg(i);
    return true;
  }

  countEggs(queen) {
    let n = 0;
    for (let i = 0; i < this.eggCount; i++) {
      if (this.eggAlive[i] && this.eggQueen[i] === queen.index) n++;
    }
    return n;
  }

  /** Nearest live egg to a point, for the autopilot and for the HUD. */
  nearestEgg(x, z, maxDist = 999) {
    let best = -1, bd = maxDist;
    for (let i = 0; i < this.eggCount; i++) {
      if (!this.eggAlive[i]) continue;
      const d = Math.hypot(this.eggX[i] - x, this.eggZ[i] - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 ? { index: best, dist: bd } : null;
  }

  // ------------------------------------------------------------------ update
  update(dt, time, px, pz) {
    this.updateQueens(dt, time, px, pz);
    this.updateEggs(dt, time);
  }

  updateQueens(dt, time, px, pz) {
    for (const q of this.list) {
      q.hurt = Math.max(0, q.hurt - dt * 1.6);
      if (!q.alive) continue;

      // A queen whose clutch is being culled produces harder.
      //
      // Gate E3 caught the reason this has to exist: on seed 4242 the operator
      // shot 31 eggs and never faced a swarm at all — peak population 13 against
      // a beat that wants 14. Egg-culling is supposed to be a real answer to
      // pressure, and it is; what it must not be is an answer that removes the
      // fight. So the counter-play has a counter, and the player is told about
      // it, loudly, by a queen convulsing in front of them.
      q.cullCooldown = Math.max(0, q.cullCooldown - dt);
      q.clutchLost = Math.max(0, q.clutchLost - dt * 0.28);   // ~14 s memory
      if (q.clutchLost >= 4 && q.cullCooldown <= 0 && q.woken && this.active) {
        q.clutchLost = 0;
        q.cullCooldown = 12;
        q.convulseLeft = Math.max(q.convulseLeft, q.spec.budget.clutch || 4);
        q.layTimer = 0;
        this.events.emit('queenConvulsed', { id: q.id, x: q.x, z: q.z, cause: 'culled' });
      }

      const rate = q.spec.budget.rate;
      // The lay cycle is visible on her body: the sac fills, then empties. The
      // player is meant to be able to time an approach off it.
      const phase = 1 - clamp01(q.layTimer / Math.max(0.2, rate));
      q.layPhase = phase;
      const swell = 1 + Math.pow(phase, 2.2) * 0.42 + q.hurt * 0.10;
      q.abdomen.scale.set(swell, swell, swell);
      q.abdomen.position.y = q.abdomenHome.y - (swell - 1) * 0.55 * q.scale;
      // she rocks forward as she pushes, and flinches when hit
      q.group.rotation.x = Math.pow(phase, 6) * 0.09 - q.hurt * 0.05;
      q.body.rotation.y = Math.sin(time * 0.4 + q.index) * 0.05;
      if (q.emitter) q.emitter.intensity = 18 + 34 * Math.pow(phase, 4) + q.hurt * 34;

      if (!this.active) continue;
      // A dormant queen is inert: she does not stir, lay, or light the room.
      // She is scenery until the level decides otherwise.
      if (q.dormant) continue;

      const dist = Math.hypot(px - q.x, pz - q.z);
      // A queen wakes with her own part of the station. Two queens in one hall
      // both live from 60 m away is double pressure the player never chose.
      if (dist > 32) continue;

      // --- the warning window ----------------------------------------------
      //
      // She used to wake the instant the player crossed the 32 m radius, and a
      // recorded timeline of the opening showed what that actually delivered:
      // room entry at 10.1 s, queen awake at 10.7 s, first enemy alive at
      // 11.6 s, seven of them by 12.5 s. The player walked through a door and
      // was in a fight 1.4 seconds later, having never had the chance to look
      // at the room. Every measured gate passed. The experience had no
      // confidence, no uncertainty, no warning and no investigation — it went
      // straight to contact, and contrast is the whole engine of the thing
      // (DIRECTION §2).
      //
      // So waking is now two stages. STIRRING is the warning: she is audible
      // across the hall, her light changes, the beacons go red ahead of the
      // player — and she produces nothing at all. Only after the window does
      // she wake and drop her clutch.
      //
      // The window shortens as the player closes, because a player who walks
      // straight at a noise has chosen to skip the anticipation and should be
      // allowed to.
      if (!q.woken) {
        if (!q.stirring) {
          q.stirring = true;
          q.stirT = 0;
          this.events.emit('queenStirred', { id: q.id, x: q.x, z: q.z });
        }
        q.stirT += dt;
        const window = dist < 17 ? 3.0 : 6.5;

        // One scout, once, at the far end of the space. This is the "silhouette
        // crossing a lit doorway 25 m ahead" the 60-second contract has always
        // asked for and never actually delivered: a threat SEEN at distance,
        // before a threat that is on top of you. It is spawned unalerted so it
        // patrols and flanks rather than charging, and it is a stalker because
        // the question a stalker asks — do you know what is behind you? — is
        // the right one to be asking during an investigation.
        if (!q.heralded && q.stirT > 1.1) {
          q.heralded = true;
          this.spawnHerald(q, px, pz);
        }

        if (q.stirT < window) continue;

        q.woken = true;
        q.layTimer = 0;
        // REVERTED: this briefly scaled the clutch with how long she had been
        // left alone. It was added to recover a swarm beat that seed 4242 had
        // lost — and that beat turned out to be measuring a single-frame peak
        // against a threshold inside its own variance (§6f). Once the gate was
        // corrected the justification for the extra pressure evaporated, and the
        // pressure itself put seed 1337 under: three balance changes in a row and
        // the failure simply relocated between seeds each time, which is what
        // tuning past the point of information looks like.
        //
        // The idea is a good one and is worth revisiting deliberately, with a
        // metric that can actually see it. It is not worth carrying as the
        // residue of a fix for a non-problem.
        q.convulseLeft = q.spec.budget.wake || 0;
        this.events.emit('queenWoke', { id: q.id, x: q.x, z: q.z });
      }

      q.layTimer -= dt;
      if (q.layTimer > 0) continue;

      const budget = q.spec.budget;
      const convulsing = q.convulseLeft > 0;
      if (convulsing) q.convulseLeft--;
      q.layTimer = convulsing ? 0.14 : rate * this.rng.range(0.82, 1.22);

      // Ceilings, cheapest test first.
      if (this.eggsAlive >= EGG_CAP - 2) continue;
      if (this.countEggs(q) >= (budget.eggs || 8)) continue;
      if (this.enemies.aliveNow + this.eggsAlive >= this.globalCap) continue;
      if (this.countChildren(q) >= budget.max) continue;

      const pick = this.rng.pick(budget.mix);
      const kindId = KIND_OF[pick];
      if (kindId === undefined) continue;

      const site = this.chooseLaySite(q, px, pz);
      if (!site) continue;

      // A clutch laid in a convulsion is nearly ripe already: it is the panic
      // response, and it has to land as one.
      const incubate = convulsing
        ? (budget.incubate || 2.2) * 0.42
        : (budget.incubate || 2.2) * this.rng.range(0.86, 1.18);
      this.layEgg(q, site.x, site.z, kindId, incubate, site.viaVent);
    }
  }

  /**
   * The scout that announces her. Placed as far from the player as her vents
   * allow, so it reads as something at the other end of the room rather than
   * something that has already arrived.
   */
  spawnHerald(q, px, pz) {
    let best = null, bd = -1;
    for (const v of q.vents) {
      if (v.sealed) continue;
      const d = Math.hypot(v.sx - px, v.sz - pz);
      if (d > 34 || d < 14) continue;          // visible distance, not a surprise
      if (d > bd) { bd = d; best = v; }
    }
    const sx = best ? best.sx : q.x, sz = best ? best.sz : q.z;
    if (!best && Math.hypot(q.x - px, q.z - pz) < 12) return;   // too close to be a herald
    const id = this.enemies.spawn(KIND.STALKER, sx, sz, {
      broodId: q.index, alerted: false, emergeTime: 0.9,
    });
    if (id >= 0) this.events.emit('herald', { x: sx, z: sz, queen: q.id });
  }

  /**
   * Where the next egg goes. Roughly a third of a clutch is placed at a vent
   * mouth, so pressure does not all arrive from one bearing — and a sealed vent
   * is genuinely one fewer place she can put them.
   */
  chooseLaySite(q, px, pz) {
    const open = q.vents.filter((v) => !v.sealed);
    if (open.length && this.rng.bool(0.34)) {
      let best = null, bestScore = -1;
      for (const v of open) {
        const dp = Math.hypot(v.sx - px, v.sz - pz);
        if (dp < 7) continue;                     // never in the player's lap
        const score = 1 / (1 + Math.abs(dp - 16)) + this.rng.next() * 0.4;
        if (score > bestScore) { bestScore = score; best = v; }
      }
      if (best) return { x: best.sx, z: best.sz, viaVent: true };
    }
    // otherwise on the deck around her, on a cell she can actually reach
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rng.angle();
      const r = this.rng.range(2.0, 5.2);
      const tx = q.x + Math.cos(a) * r, tz = q.z + Math.sin(a) * r;
      if (!this.grid.walkableCell(Math.floor(tx / CELL), Math.floor(tz / CELL))) continue;
      if (Math.hypot(tx - px, tz - pz) < 3.5) continue;
      if (!this.grid.lineOfSight(q.x, q.z, tx, tz)) continue;
      return { x: tx, z: tz, viaVent: false };
    }
    return null;
  }

  updateEggs(dt, time) {
    const m4 = this._m4, q = this._q, v = this._v, s = this._s;
    let shell = 0, core = 0;
    q.identity();
    for (let i = 0; i < this.eggCount; i++) {
      if (!this.eggAlive[i]) continue;

      if (this.active) this.eggT[i] -= dt;
      if (this.eggT[i] <= 0) {
        if (this.enemies.aliveNow >= this.globalCap) {
          this.eggT[i] = 0.5;              // hold at term until there is room
        } else if (this.hatch(i)) {
          continue;
        } else {
          this.eggT[i] = 0.5;
        }
      }

      const ripe = 1 - clamp01(this.eggT[i] / Math.max(0.01, this.eggDur[i]));
      const wobble = Math.sin(time * (2.4 + this.eggSeed[i] * 3) + this.eggSeed[i] * 6.28);
      // The shell twitches harder the closer it is to term.
      const tip = wobble * 0.06 * ripe * ripe;
      const sc = 0.86 + ripe * 0.20;

      v.set(this.eggX[i], 0, this.eggZ[i]);
      q.setFromAxisAngle(AXIS_X, tip);
      s.set(sc, sc + Math.pow(ripe, 3) * 0.14, sc);
      m4.compose(v, q, s);
      this.eggShellMesh.setMatrixAt(shell++, m4);

      // The core is the incubation clock made visible: a dim seed at laying,
      // a hot mass filling the shell at term.
      const cs = 0.30 + Math.pow(ripe, 1.6) * 1.05;
      s.set(cs * sc, cs * sc, cs * sc);
      m4.compose(v, q, s);
      this.eggCoreMesh.setMatrixAt(core++, m4);
    }
    this.eggShellMesh.count = shell;
    this.eggCoreMesh.count = core;
    if (shell > 0) {
      this.eggShellMesh.instanceMatrix.needsUpdate = true;
      this.eggCoreMesh.instanceMatrix.needsUpdate = true;
    }
  }

  countChildren(queen) {
    const e = this.enemies;
    let c = 0;
    for (let k = 0; k < e.list.count; k++) {
      const i = e.list.active[k];
      if (e.broodId[i] === queen.index && e.state[i] !== 7 /* DYING */) c++;
    }
    return c;
  }

  get aliveQueens() { return this.list.filter((q) => q.alive); }
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
