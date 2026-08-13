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
  { id: 3, name: 'kill_egg', deadline: 60 },
  { id: 4, name: 'overheat_barrel', deadline: 75 },
  { id: 5, name: 'kill_first_queen', deadline: 90 },
  { id: 6, name: 'fight_swarm', deadline: 130 },
  { id: 7, name: 'trigger_explosive', deadline: 160 },
  { id: 8, name: 'cross_grating', deadline: 180 },
  { id: 9, name: 'fight_stalker', deadline: 210 },
  { id: 10, name: 'switch_ability', deadline: 220 },
  { id: 11, name: 'seal_vent', deadline: 250 },
  { id: 12, name: 'enter_dark_room', deadline: 260 },
  { id: 13, name: 'illuminate_enemies', deadline: 270 },
  { id: 14, name: 'kill_final_queen', deadline: 350 },
  { id: 15, name: 'reach_exit', deadline: 400 },
];

/** Canonical camera states for visual review (TEST_PLAN §5). */
export const SHOTS = {
  OPENING:      { until: (h) => h.time > 1.2 },
  FIRST_COMBAT: { until: (h) => h.game.stats.kills >= 3 },
  GRATING:      { until: (h) => h.game.player.gratingDistance > 3 },
  DARK_CORRIDOR:{ until: (h) => h.roomId() === 'coolant' && h.time > 4 },
  SWARM:        { until: (h) => (h.game.enemies.aliveNow || 0) >= 12 },
  QUEEN:        { until: (h) => h.queenDist() < 13 && h.queenDist() > 5 },
  CLUTCH:       { until: (h) => h.game.broods.eggsAlive >= 5 && h.eggDist() < 9 },
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
    this.eggKilled = false;
    this.ventSealed = false;
    this.overheated = false;
    this.ventTarget = null;
    this.startX = game.player.x; this.startZ = game.player.z;
    this.stuckTimer = 0;
    this.escapeTimer = 0;
    this.lastPos = { x: game.player.x, z: game.player.z };
    this.wanderAngle = 0;
    this.unreachable = new Set();
    this.progressAt = 0;
    this.progressMark = '';
    this.bestObjDist = Infinity;
    this._lastQueens = game.broods.remaining;
    this.supplyKey = '';
    this.supplyNearFor = 0;
    this.forcedExit = false;

    const ev = game.events;
    ev.on('tankDetonated', () => { this.tankFired = true; });
    ev.on('explosion', () => { this.sinceExplosion = 0; });
    ev.on('enemyDied', (e) => { if (e.kind === KIND.STALKER) this.stalkerKilled = true; });
    ev.on('shot', (e) => { if (e.weapon === 'frag') this.fragFired = true; });
    ev.on('eggDestroyed', () => { this.eggKilled = true; });
    ev.on('ventSealed', () => { this.ventSealed = true; });
    ev.on('vent', (e) => { if (e.stage === 'release' && e.forced) this.overheated = true; });
  }

  roomId() {
    const r = this.game.sector.roomAtWorld(this.game.player.x, this.game.player.z);
    return r ? r.id : null;
  }
  queenDist() {
    const q = this.game.broods.nearest(this.game.player.x, this.game.player.z);
    return q ? q.dist : 9999;
  }
  eggDist() {
    const e = this.game.broods.nearestEgg(this.game.player.x, this.game.player.z);
    return e ? e.dist : 9999;
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
    if (this.forcedExit) return this.objectiveGoal();

    // A supply detour is a DETOUR. It has to be cheap, and it must never pull
    // the operator off a queen who is already in front of them — an earlier
    // version of this let a run chain-chase arc cells across two rooms and
    // park against a bulkhead that only opens when that queen is dead.
    const near = g.broods.nearest(p.x, p.z);
    const committed = near && near.dist < 22 && near.queen.woken;
    const wantHeal = p.health01 < 0.62;
    const wantArc = g.weapons.charges === 0;
    const wantCoolant = g.weapons.heat01 > 0.55 && g.weapons.coolBoost <= 0;

    if ((wantHeal && !committed) || ((wantArc || wantCoolant) && !committed)) {
      // Health is worth walking for; a weapon cell is only worth stepping for.
      let best = null, bd = wantHeal ? 26 : 13;
      for (const item of g.pickups) {
        if (item.taken) continue;
        if (item.kind === 'medkit' && !wantHeal) continue;
        if (item.kind === 'arc' && !wantArc) continue;
        if (item.kind === 'coolant' && !wantCoolant) continue;
        if (item.kind === 'armour' && !wantHeal) continue;
        if (item.kind === 'flare') continue;
        if (this.unreachable.has(item.kind + ':' + item.index)) continue;
        const d = Math.hypot(item.x - p.x, item.z - p.z);
        if (d < bd) { bd = d; best = item; }
      }
      if (best) return { x: best.x, z: best.z, kind: 'supply', key: best.kind + ':' + best.index };
    }
    return this.objectiveGoal();
  }

  /** The objective, with no detours: a live queen, or the exit. */
  objectiveGoal() {
    const g = this.game, p = g.player;
    const near = g.broods.nearest(p.x, p.z);
    if (near) return { x: near.queen.x, z: near.queen.z, kind: 'queen' };
    const e = g.sector.exitBox;
    return { x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2, kind: 'exit' };
  }

  ensureField(goal) {
    const grid = this.game.sector.grid;
    let cx = Math.floor(goal.x / CELL), cz = Math.floor(goal.z / CELL);
    if (!grid.walkableCell(cx, cz)) {
      // queens sit on prop/flesh cells; walk out to the nearest open cell
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

  /**
   * A grille worth welding shut: close enough to hit, quiet enough to spend the
   * heat on, and not already sealed. Only pursued while there is still a live
   * queen, because sealing a route after the sector is purged achieves nothing.
   */
  /** Straight-line distance to whatever the run is actually trying to reach. */
  objectiveDistance() {
    const g = this.game, p = g.player;
    const goal = this.objectiveGoal();
    return Math.hypot(goal.x - p.x, goal.z - p.z);
  }

  chooseVent(p) {
    const g = this.game;
    if (g.broods.remaining === 0) return null;
    if (!g.weapons.ready) return null;
    // A grille costs about five rounds. The first one is worth taking a slightly
    // worse moment for, the way a player who has just learned the mechanic would;
    // after that it is strictly opportunistic.
    const eager = !this.ventSealed && this.time > 20;
    if (g.weapons.heat01 > (eager ? 0.78 : 0.5)) return null;
    if (this.nearestEnemyDist() < (eager ? 5.5 : 9)) return null;
    let best = null, bd = eager ? 24 : 18;
    for (const v of g.sector.vents) {
      if (v.sealed || !v.valid) continue;
      const d = Math.hypot(v.wx - p.x, v.wz - p.z);
      if (d > bd || d < 3) continue;
      // Sight is tested to the OPEN CELL in front of the grille, not to the
      // grille. A vent cell is solid, so a ray aimed at its centre is stopped by
      // the vent itself and every vent in the sector reads as "not visible".
      if (!g.sector.grid.lineOfSight(p.x, p.z, v.sx, v.sz)) continue;
      bd = d; best = v;
    }
    return best;
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
    // A supply we have stood next to for four seconds without picking up is not
    // a supply we can reach: the field routes to the nearest OPEN cell, which for
    // an item sitting behind a machine can be two metres outside pickup range.
    // Without this the run ping-pongs beside a crate for the rest of the session.
    if (goal.kind === 'supply') {
      if (goal.key !== this.supplyKey) { this.supplyKey = goal.key; this.supplyNearFor = 0; }
      else if (Math.hypot(goal.x - p.x, goal.z - p.z) < 6) {
        this.supplyNearFor += dt;
        if (this.supplyNearFor > 4) {
          this.unreachable.add(goal.key);
          this.supplyNearFor = 0;
          this.goalCell = -1;
        }
      }
    } else {
      this.supplyKey = '';
    }
    this.ensureField(goal);
    // If the field does not reach us, this goal is unreachable from here (a
    // supply crate behind a route we have passed, say). Blacklist it and fall
    // through to the objective rather than wandering on the spot forever.
    if (this.field.distanceAt(p.x, p.z) >= 32000) {
      if (goal.key) this.unreachable.add(goal.key);
      goal = this.chooseGoal();
      this.ensureField(goal);
    }

    // --- movement: follow the flow field, but hold position while a queen is
    // in weapons range so the autopilot actually fights rather than orbiting.
    const out = { x: 0, z: 0 };
    const goalDist = Math.hypot(goal.x - p.x, goal.z - p.z);
    const engaging = goal.kind === 'queen' && goalDist < 11 &&
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
      // Strafe around the queen. This is not only anti-spitter movement any
      // more: her hood eats most of a frontal round, so circling is the actual
      // answer to her and the autopilot has to be capable of it.
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
      // The nudge itself counts as movement, which used to reset the timer and
      // let a run oscillate against a wall indefinitely. Track how long we have
      // been ESCAPING, not how long we have been still.
      this.escapeTimer += dt;
      if (this.escapeTimer > 2.5) {
        this.escapeTimer = 0; this.stuckTimer = 0; this.goalCell = -1;
        if (goal.key) this.unreachable.add(goal.key);
      }
    } else if (this.stuckTimer === 0) {
      this.escapeTimer = 0;
    }

    // --- aiming and firing
    const e = g.enemies;
    const ei = e.nearest(p.x, p.z, 26);
    let tx = null, tz = null, targetDist = 9999;
    let targetKind = 'none';
    const queenInReach = goal.kind === 'queen' && goalDist < 19 &&
      g.sector.grid.lineOfSight(p.x, p.z, goal.x, goal.z);
    const threatUrgent = ei >= 0 && this.nearestEnemyDist() < 4.5;

    // An egg is worth more dead than the thing that hatches out of it, so the
    // autopilot prefers a clutch over the queen when nothing is on top of it.
    // If the test never shot an egg it would not be testing the mechanic.
    const egg = g.broods.nearestEgg(p.x, p.z, 15);
    const eggWorthIt = egg && !threatUrgent && this.nearestEnemyDist() > 6 &&
      g.sector.grid.lineOfSight(p.x, p.z, g.broods.eggX[egg.index], g.broods.eggZ[egg.index]);

    // A vent that is quiet right now is a route that will not be used later.
    const vent = this.chooseVent(p);

    if (eggWorthIt) {
      tx = g.broods.eggX[egg.index]; tz = g.broods.eggZ[egg.index];
      targetDist = egg.dist; targetKind = 'egg';
    } else if (queenInReach && !threatUrgent) {
      tx = goal.x; tz = goal.z; targetDist = goalDist; targetKind = 'queen';
    } else if (ei >= 0 && g.sector.grid.lineOfSight(p.x, p.z, e.x[ei], e.z[ei])) {
      tx = e.x[ei]; tz = e.z[ei];
      targetDist = Math.hypot(tx - p.x, tz - p.z);
      targetKind = 'enemy';
    } else if (vent) {
      tx = vent.wx; tz = vent.wz;
      targetDist = Math.hypot(tx - p.x, tz - p.z);
      targetKind = 'vent';
    }

    // --- thermal discipline. Early on it fires greedily and lets the barrel
    // take the decision, which is what a player does before they have learned
    // the bar; from 70 s it vents on its own terms. Both behaviours have to be
    // exercised, because both are in the design.
    const heat = g.weapons.heat01;
    const disciplined = this.time > 70;
    const safeToVent = this.nearestEnemyDist() > 7 || targetKind === 'vent';
    if (!g.weapons.venting) {
      if (heat > 0.95 && safeToVent) f.reloadPressed = true;
      else if (disciplined && heat > 0.68 && safeToVent) f.reloadPressed = true;
      else if (disciplined && heat > 0.55 && tx === null) f.reloadPressed = true;
    }

    if (tx !== null) {
      const dx = tx - p.x, dz = tz - p.z;
      const d = Math.hypot(dx, dz) || 1;
      f.aimX = dx / d; f.aimZ = dz / d; f.aimDist = d;
      f.fire = g.weapons.ready && !f.reloadPressed;
      f.firePressed = f.fire && (this.frames % 4 === 0);
      // Use the frag on a cluster, and use it at least once early so the
      // secondary beat is exercised by play rather than by a scripted keypress.
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
          f.fire = g.weapons.ready;
          break;
        }
      }
    }

    // dash out of trouble
    if (p.dashReady && threatDist < 2.6 && p.health01 < 0.8) f.dashPressed = true;

    g.step(STEP, f);
    g.clock.advance();

    this.trackBeats(dt);
    this.checkShot();
    // Stall watchdog, keyed on PROGRESS only. Position is not progress: an
    // autopilot oscillating between two points looks busy and achieves nothing.
    const doneCount = [...this.beats.values()].filter((b) => b.done).length;
    // Kills are deliberately NOT in this key. An operator pinned at a locked
    // bulkhead, farming a vent wave that never stops, racks up kills forever and
    // looks busy; the only thing that counts as progress is beats, dead queens,
    // and actually closing on the objective.
    //
    // And it is the CLOSEST we have ever been, not the current distance. An
    // operator oscillating across a bucket boundary produces a new mark every
    // couple of seconds and looks like it is making progress forever — which is
    // exactly the failure this watchdog exists to catch.
    this.bestObjDist = Math.min(this.bestObjDist, this.objectiveDistance());
    const mark = `${doneCount}|${g.broods.remaining}|${Math.round(this.bestObjDist / 4)}`;
    if (mark !== this.progressMark) { this.progressMark = mark; this.progressAt = this.time; }
    const stalledFor = this.time - this.progressAt;
    if (stalledFor > 25 && !this.forcedExit) {
      // Recovery: drop every supply detour and commit to the objective.
      this.forcedExit = true;
      this.unreachable.clear();
      this.goalCell = -1;
    }
    if (stalledFor > 70) this.finish('stalled');

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
    if (g.broods.remaining !== this._lastQueens) {
      this._lastQueens = g.broods.remaining;
      this.bestObjDist = Infinity;   // new objective, new baseline
    }
    if (this.eggKilled) mark('kill_egg');
    if (this.overheated) mark('overheat_barrel');
    if (this.ventSealed) mark('seal_vent');
    if (g.broods.remaining < g.broods.list.length) mark('kill_first_queen');
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

    if (g.broods.remaining === 0) mark('kill_final_queen');
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
      queens: this.game.broods.remaining,
      eggs: this.game.broods.eggsAlive,
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
        queenDeaths: g.stats.queenDeaths.map((t) => +t.toFixed(2)),
        enemiesAtQueenDeath: g.stats.enemiesAtQueenDeath,
        eggsKilled: g.stats.eggsKilled,
        ventsSealed: g.stats.ventsSealed,
        forcedVents: g.weapons.forcedVents,
        manualVents: g.weapons.manualVents,
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
    mix(g.stats.kills); mix(g.stats.shotsFired); mix(g.broods.remaining);
    mix(g.broods.eggsAlive); mix(g.stats.eggsKilled); mix(g.stats.ventsSealed);
    mix(this.time); mix(g.enemies.killCount);
    for (const b of BEATS) { const r = this.beats.get(b.name); mix(r.done ? r.at : -1); }
    return h >>> 0;
  }
}
