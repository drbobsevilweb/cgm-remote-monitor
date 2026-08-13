// QA / Replay — the scripted operator.
//
// It drives the game through the ordinary InputFrame path (ARCHITECTURE §3.5):
// nothing here reaches into PLAYER or ENEMIES to move anything. It is an
// autopilot rather than a recorded input tape, because a tape stops being a test
// the moment any number in the game changes, whereas an autopilot keeps playing.

import { InputFrame } from '../input/Input.js';
import { Field } from '../level/Nav.js';
import { CELL, C } from '../level/Grid.js';
import { KIND } from '../enemies/Archetypes.js';
import { toneOf } from '../environment/Palette.js';
import { STEP } from '../core/Clock.js';

export const BEATS = [
  { id: 1, name: 'spawn_assault', deadline: 1 },
  { id: 2, name: 'move_corridor', deadline: 20 },
  { id: 3, name: 'destroy_first_node', deadline: 75 },
  { id: 4, name: 'fight_swarm', deadline: 120 },
  { id: 5, name: 'trigger_explosive', deadline: 150 },
  { id: 6, name: 'cross_grating', deadline: 170 },
  { id: 7, name: 'fight_stalker', deadline: 200 },
  { id: 8, name: 'switch_ability', deadline: 210 },
  { id: 9, name: 'enter_dark_room', deadline: 235 },
  { id: 10, name: 'illuminate_enemies', deadline: 245 },
  { id: 11, name: 'destroy_final_node', deadline: 330 },
  { id: 12, name: 'reach_exit', deadline: 380 },
];

/** Canonical camera states for visual review (TEST_PLAN §5). */
export const SHOTS = {
  OPENING:      { until: (h) => h.time > 1.2 },
  FIRST_COMBAT: { until: (h) => h.game.stats.kills >= 3 },
  GRATING:      { until: (h) => h.game.player.gratingDistance > 3 },
  DARK_CORRIDOR:{ until: (h) => h.roomId() === 'coolant' && h.time > 4 },
  SWARM:        { until: (h) => (h.game.enemies.aliveNow || 0) >= 12 },
  NEST:         { until: (h) => h.nestDist() < 13 && h.nestDist() > 5 },
  EXPLOSION:    { until: (h) => h.sinceExplosion >= 0 && h.sinceExplosion < 0.20 },
  ELITE:        { until: (h) => h.game.enemies.countOfKind(KIND.STALKER) > 0 && h.nearestEnemyDist() < 12 },
  BOSS_REVEAL:  { until: (h) => h.roomId() === 'reactor' },
};

export class Harness {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.input = new InputFrame();
    this.time = 0;
    this.frames = 0;
    this.done = false;
    this.shot = opts.shot || null;
    this.frozen = false;
    // Headless runs render through SwiftShader at roughly a frame per second,
    // so a 380 s replay cannot render every step. Simulation stays at the fixed
    // step (identical results); only presentation is decimated. Camera-state
    // captures run a much lower ratio so lighting and camera damping settle.
    this.stepsPerFrame = opts.stepsPerFrame || (this.shot ? 6 : 60);
    this.sinceExplosion = -1;

    this.field = new Field(game.sector.grid);
    this.field.bakeCost(4);
    this.goalCell = -1;
    this.goalKind = '';

    this.beats = new Map(BEATS.map((b) => [b.name, { ...b, done: false, at: -1 }]));
    this.log = [];
    this.maxAlive = 0;
    this.darkTime = 0;
    this.litEnemiesWhileDark = 0;
    this.fragFired = false;
    this.tankFired = false;
    this.stalkerKilled = false;
    this.startX = game.player.x; this.startZ = game.player.z;
    this.stuckTimer = 0;
    this.lastPos = { x: game.player.x, z: game.player.z };
    this.wanderAngle = 0;
    this.unreachable = new Set();
    this.progressAt = 0;
    this.progressMark = '';

    const ev = game.events;
    ev.on('tankDetonated', () => { this.tankFired = true; });
    ev.on('explosion', () => { this.sinceExplosion = 0; });
    ev.on('enemyDied', (e) => { if (e.kind === KIND.STALKER) this.stalkerKilled = true; });
    ev.on('shot', (e) => { if (e.weapon === 'frag') this.fragFired = true; });
  }

  roomId() {
    const r = this.game.sector.roomAtWorld(this.game.player.x, this.game.player.z);
    return r ? r.id : null;
  }
  nestDist() {
    const n = this.game.nests.nearest(this.game.player.x, this.game.player.z);
    return n ? n.dist : 9999;
  }
  nearestEnemyDist() {
    const e = this.game.enemies, p = this.game.player;
    const i = e.nearest(p.x, p.z, 999);
    return i < 0 ? 9999 : Math.hypot(e.x[i] - p.x, e.z[i] - p.z);
  }

  // ------------------------------------------------------------------ goals
  /** The objective the autopilot is currently walking toward. */
  chooseGoal() {
    const g = this.game, p = g.player;
    // 1. hurt or dry: go and get the thing that fixes it. A player would.
    const wantHeal = p.health01 < 0.62;
    const wantAmmo = g.weapons.reserve < 170;
    if (wantHeal || wantAmmo) {
      let best = null, bd = 30;   // grab what you pass, do not cross the sector
      for (const item of g.pickups) {
        if (item.taken) continue;
        if (item.kind === 'medkit' && !wantHeal) continue;
        if (item.kind === 'ammo' && !wantAmmo) continue;
        if (item.kind === 'flare') continue;
        if (this.unreachable.has(item.kind + ':' + item.index)) continue;
        const d = Math.hypot(item.x - p.x, item.z - p.z);
        if (d < bd) { bd = d; best = item; }
      }
      if (best) return { x: best.x, z: best.z, kind: 'supply', key: best.kind + ':' + best.index };
    }
    // 2. a live nest is the objective — that is the game
    const near = g.nests.nearest(p.x, p.z);
    if (near) return { x: near.nest.x, z: near.nest.z, kind: 'nest' };
    // 3. otherwise the exit
    const e = g.sector.exitBox;
    return { x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2, kind: 'exit' };
  }

  ensureField(goal) {
    const grid = this.game.sector.grid;
    let cx = Math.floor(goal.x / CELL), cz = Math.floor(goal.z / CELL);
    if (!grid.walkableCell(cx, cz)) {
      // nests sit on prop/flesh cells; walk out to the nearest open cell
      let found = false;
      for (let r = 1; r <= 6 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (grid.walkableCell(cx + dx, cz + dz)) { cx += dx; cz += dz; found = true; }
          }
        }
      }
    }
    const cell = cz * grid.cols + cx;
    if (cell === this.goalCell) return;
    this.goalCell = cell;
    const src = new Int32Array(1); src[0] = cell;
    // Locked doors are opened by the objectives, so plan through them.
    grid.ignoreLocks = true;
    this.field.build(src, 1);
    grid.ignoreLocks = false;
  }

  // ------------------------------------------------------------------ drive
  /** One rendered frame = `stepsPerFrame` simulation steps. */
  frame() {
    if (this.done || this.frozen) { this.game.present(this.game.clock.simTime, STEP); return; }
    for (let k = 0; k < this.stepsPerFrame; k++) {
      this.simStep();
      if (this.done || this.frozen) break;
    }
    this.game.present(this.game.clock.simTime, STEP * this.stepsPerFrame);
    this.game.clock.endFrame();
  }

  simStep() {
    const g = this.game;
    const p = g.player;
    const dt = STEP;
    this.time += dt;
    this.frames++;
    if (this.sinceExplosion >= 0) this.sinceExplosion += dt;

    const f = this.input;
    f.reset();

    let goal = this.chooseGoal();
    this.ensureField(goal);
    // If the field does not reach us, this goal is unreachable from here (a
    // supply crate behind a route we have passed, say). Blacklist it and fall
    // through to the objective rather than wandering on the spot forever.
    if (this.field.distanceAt(p.x, p.z) >= 32000) {
      if (goal.key) this.unreachable.add(goal.key);
      goal = this.chooseGoal();
      this.ensureField(goal);
    }

    // --- movement: follow the flow field, but hold position while a nest is
    // in weapons range so the autopilot actually fights rather than orbiting.
    const out = { x: 0, z: 0 };
    const goalDist = Math.hypot(goal.x - p.x, goal.z - p.z);
    const engaging = goal.kind === 'nest' && goalDist < 11 &&
      g.sector.grid.lineOfSight(p.x, p.z, goal.x, goal.z);

    // Break contact when badly hurt: back away from the nearest threat rather
    // than standing in it. Kiting is a real skill and the test should use it.
    const threatDist = this.nearestEnemyDist();
    const retreating = p.health01 < 0.55 && threatDist < 10;

    if (retreating) {
      const ei = g.enemies.nearest(p.x, p.z, 26);
      if (ei >= 0) {
        const dx = p.x - g.enemies.x[ei], dz = p.z - g.enemies.z[ei];
        const d = Math.hypot(dx, dz) || 1;
        // bias away from the threat but keep following the field a little so we
        // do not reverse into a dead end
        const ok = this.field.sample(p.x, p.z, out);
        f.moveX = (dx / d) * 0.8 + (ok ? out.x * 0.35 : 0);
        f.moveZ = (dz / d) * 0.8 + (ok ? out.z * 0.35 : 0);
      }
    } else if (engaging) {
      // strafe around the nest so spitters and runners cannot settle on us
      this.wanderAngle += dt * 1.6;
      f.moveX = Math.cos(this.wanderAngle) * 0.7;
      f.moveZ = Math.sin(this.wanderAngle) * 0.7;
    } else if (this.field.sample(p.x, p.z, out)) {
      f.moveX = out.x; f.moveZ = out.z;
    } else {
      this.wanderAngle += dt * 2.2;
      f.moveX = Math.cos(this.wanderAngle);
      f.moveZ = Math.sin(this.wanderAngle);
    }

    // unstick: if we have not moved in a while, push perpendicular
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos.x = p.x; this.lastPos.z = p.z;
    this.stuckTimer = moved < 0.01 ? this.stuckTimer + dt : 0;
    if (this.stuckTimer > 0.6) {
      this.wanderAngle += 2.1;
      f.moveX = Math.cos(this.wanderAngle);
      f.moveZ = Math.sin(this.wanderAngle);
      if (this.stuckTimer > 2.5) { this.stuckTimer = 0; this.goalCell = -1; }
    }

    // --- aiming and firing
    const e = g.enemies;
    const ei = e.nearest(p.x, p.z, 26);
    let tx = null, tz = null, targetDist = 9999;
    const nestInReach = goal.kind === 'nest' && goalDist < 19 &&
      g.sector.grid.lineOfSight(p.x, p.z, goal.x, goal.z);
    const threatUrgent = ei >= 0 && this.nearestEnemyDist() < 4.5;
    if (nestInReach && !threatUrgent) {
      tx = goal.x; tz = goal.z; targetDist = goalDist;
    } else if (ei >= 0 && g.sector.grid.lineOfSight(p.x, p.z, e.x[ei], e.z[ei])) {
      tx = e.x[ei]; tz = e.z[ei];
      targetDist = Math.hypot(tx - p.x, tz - p.z);
    }

    if (tx !== null) {
      const dx = tx - p.x, dz = tz - p.z;
      const d = Math.hypot(dx, dz) || 1;
      f.aimX = dx / d; f.aimZ = dz / d; f.aimDist = d;
      f.fire = !g.weapons.reloading && g.weapons.ammo > 0;
      f.firePressed = f.fire && (this.frames % 4 === 0);
      // Use the frag on a cluster, and use it at least once early so beat 8
      // is exercised by play rather than by a scripted keypress.
      const cluster = g.director ? g.director.countNear(tx, tz, 4.5) : 0;
      if ((cluster >= 3 || (!this.fragFired && this.time > 26)) &&
          g.weapons.grenades > 0 && targetDist > 5 && targetDist < 16) {
        f.secondaryPressed = true;
      }
    } else {
      f.aimX = f.moveX || 1; f.aimZ = f.moveZ || 0; f.aimDist = 8;
    }

    // Shoot pressure tanks when something is standing next to one.
    if (!this.tankFired) {
      for (let i = 0; i < g.env.tanks.length; i++) {
        const t = g.env.tanks[i];
        if (!t.alive) continue;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d > 4 && d < 17 && g.sector.grid.lineOfSight(p.x, p.z, t.x, t.z) &&
            (g.director.countNear(t.x, t.z, 5) >= 1 || this.time > 60)) {
          const dx = t.x - p.x, dz = t.z - p.z, dd = Math.hypot(dx, dz) || 1;
          f.aimX = dx / dd; f.aimZ = dz / dd; f.aimDist = dd;
          f.fire = !g.weapons.reloading && g.weapons.ammo > 0;
          break;
        }
      }
    }

    if (g.weapons.ammo === 0 && !g.weapons.reloading) f.reloadPressed = true;
    // dash out of trouble
    if (p.dashReady && threatDist < 2.6 && p.health01 < 0.8) f.dashPressed = true;

    g.step(STEP, f);
    g.clock.advance();

    this.trackBeats(dt);
    this.checkShot();
    // Stall watchdog: if neither the beats nor the operator's position have
    // moved in 45 s of simulation, the run is wedged. Report it as a stall
    // rather than hanging the gauntlet with no result at all.
    const mark = `${this.beats.size}|${[...this.beats.values()].filter((b) => b.done).length}` +
      `|${Math.round(p.x / 4)}|${Math.round(p.z / 4)}|${g.nests.remaining}|${g.stats.kills}`;
    if (mark !== this.progressMark) { this.progressMark = mark; this.progressAt = this.time; }
    else if (this.time - this.progressAt > 45) this.finish('stalled');

    if (this.time > 420 && !this.done) this.finish('timeout');
    if (g.mode === 'won') this.finish('exit');
    if (g.mode === 'dead') this.finish('died');
  }

  trackBeats(dt) {
    const g = this.game, p = g.player, e = g.enemies;
    const alive = e.aliveNow || 0;
    if (alive > this.maxAlive) this.maxAlive = alive;

    const mark = (name) => {
      const b = this.beats.get(name);
      if (b && !b.done) {
        b.done = true; b.at = this.time;
        this.log.push({ beat: name, t: +this.time.toFixed(2) });
      }
    };

    if (p.alive) mark('spawn_assault');
    if (Math.hypot(p.x - this.startX, p.z - this.startZ) >= 18) mark('move_corridor');
    if (g.nests.remaining < g.nests.list.length) mark('destroy_first_node');
    if (this.maxAlive >= 14 && g.stats.kills >= 20) mark('fight_swarm');
    if (this.tankFired) mark('trigger_explosive');
    if (p.gratingDistance >= 6) mark('cross_grating');
    if (this.stalkerKilled) mark('fight_stalker');
    if (this.fragFired) mark('switch_ability');

    // dark room: the authored ambient level of the space the operator is in
    const room = g.sector.roomAtWorld(p.x, p.z);
    const level = room ? toneOf(room).level : 0.3;
    if (level <= 0.12 && p.alive) {
      this.darkTime += dt;
      if (this.darkTime >= 3) mark('enter_dark_room');
      // enemies inside the operator's light cone
      let lit = 0;
      for (let k = 0; k < e.list.count; k++) {
        const i = e.list.active[k];
        if (e.state[i] === 7) continue;
        const dx = e.x[i] - p.x, dz = e.z[i] - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 16 || d < 0.5) continue;
        if ((dx / d) * p.aimX + (dz / d) * p.aimZ > 0.86) lit++;
      }
      if (lit >= 2) { this.litEnemiesWhileDark++; if (this.litEnemiesWhileDark > 6) mark('illuminate_enemies'); }
    } else {
      this.darkTime = Math.max(0, this.darkTime - dt * 0.5);
    }

    if (g.nests.remaining === 0) mark('destroy_final_node');
    if (g.sector.exitReached) mark('reach_exit');
  }

  checkShot() {
    if (!this.shot) return;
    const s = SHOTS[this.shot];
    if (!s) { this.freeze('unknown shot'); return; }
    if (this.time > 300) { this.freeze('shot timeout'); return; }
    if (s.until(this)) this.freeze('reached');
  }

  freeze(reason) {
    this.frozen = true;
    this.game.clock.paused = true;
    window.__SHOT_READY = true;
    window.__SHOT_INFO = {
      shot: this.shot, reason, t: +this.time.toFixed(2),
      room: this.roomId(), enemies: this.game.enemies.aliveNow || 0,
      nests: this.game.nests.remaining,
      health: +this.game.player.health.toFixed(1),
    };
  }

  finish(reason) {
    if (this.done) return;
    this.done = true;
    const g = this.game;
    const beats = BEATS.map((b) => {
      const r = this.beats.get(b.name);
      return {
        id: b.id, name: b.name, done: r.done, at: r.done ? +r.at.toFixed(2) : null,
        deadline: b.deadline,
        pass: r.done && r.at <= b.deadline,
      };
    });
    const passed = beats.filter((b) => b.pass).length;
    window.__VOIDBREACH_RESULT__ = {
      seed: this.opts.seed,
      reason,
      simTime: +this.time.toFixed(2),
      frames: this.frames,
      beats,
      beatsPassed: passed,
      beatsTotal: BEATS.length,
      pass: passed === BEATS.length,
      stats: {
        kills: g.stats.kills,
        shotsFired: g.stats.shotsFired,
        damageTaken: +g.stats.damageTaken.toFixed(1),
        peakEnemies: g.stats.peakEnemies,
        firstEnemySeen: g.stats.firstEnemySeen,
        firstDamage: g.stats.firstDamage,
        nestDeaths: g.stats.nestDeaths.map((t) => +t.toFixed(2)),
        enemiesAtNestDeath: g.stats.enemiesAtNestDeath,
        reliefRatio: g.stats.reliefRatio,
        health: +g.player.health.toFixed(1),
        distance: +g.player.distanceTravelled.toFixed(1),
        grating: +g.player.gratingDistance.toFixed(1),
        waves: g.director.stats.waves,
      },
      profile: g.profiler.report(),
      endStateHash: this.stateHash(),
    };
  }

  /** Cheap end-state fingerprint for the determinism gate (E2). */
  stateHash() {
    const g = this.game;
    let h = 2166136261 >>> 0;
    const mix = (v) => {
      h ^= Math.round(v * 1000) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    mix(g.player.x); mix(g.player.z); mix(g.player.health);
    mix(g.stats.kills); mix(g.stats.shotsFired); mix(g.nests.remaining);
    mix(this.time); mix(g.enemies.killCount);
    for (const b of BEATS) { const r = this.beats.get(b.name); mix(r.done ? r.at : -1); }
    return h >>> 0;
  }
}
