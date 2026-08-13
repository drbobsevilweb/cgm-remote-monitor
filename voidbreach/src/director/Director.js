// DIRECTOR — owns pressure, not behaviour.
//
// The 60-second contract (DIRECTION §2) is a pacing problem, so it is solved
// here: the director decides when the queens are laying, when to add a flanking
// wave, and when to get out of the way so the relief after a queen dies is total.

import { KIND } from '../enemies/Archetypes.js';
import { clamp, clamp01 } from '../core/Mathx.js';
import { CELL } from '../level/Grid.js';

export class Director {
  constructor(sector, enemies, broods, events, rng) {
    this.sector = sector;
    this.enemies = enemies;
    this.broods = broods;
    this.events = events;
    this.rng = rng.child('director');

    this.time = 0;
    this.intensity = 0;         // 0..1 smoothed pressure estimate
    this.relief = 0;            // seconds of enforced quiet after a queen dies
    this.waveTimer = 14;
    this.objective = null;
    this.objectiveIndex = -1;
    this.beats = new Set();
    this.bossActive = false;
    this.ventWaveCooldown = 0;
    this.stats = { waves: 0, ventSpawns: 0 };

    broods.active = true;

    events.on('queenKilled', (e) => this.onQueenKilled(e));
    events.on('beat', (e) => this.beats.add(e.name));
    this.advanceObjective();
  }

  advanceObjective() {
    const list = this.sector.spec.objectives;
    this.objectiveIndex = Math.min(list.length - 1, this.objectiveIndex + 1);
    this.objective = list[this.objectiveIndex];
    this.emitObjective();
  }

  emitObjective() {
    if (!this.objective) return;
    const text = this.objective.text.replace('{n}', String(this.broods.remaining));
    this.events.emit('objective', { text, kind: this.objective.kind, id: this.objective.id });
  }

  onQueenKilled(e) {
    // Total relief. The drone stops, the laying stops, and the room empties.
    this.relief = 7.0;
    this.intensity = 0;
    this.waveTimer = Math.max(this.waveTimer, 16);
    if (this.objective && (this.objective.kind === 'queen' || this.objective.kind === 'queens')) {
      if (this.broods.remaining === 0 || this.objective.kind === 'queen') this.advanceObjective();
      else this.emitObjective();
    }
  }

  update(dt, player, time) {
    this.time += dt;
    this.relief = Math.max(0, this.relief - dt);
    this.ventWaveCooldown = Math.max(0, this.ventWaveCooldown - dt);

    // --- objective progress
    if (this.objective && this.objective.kind === 'reach') {
      const room = this.sector.roomAtWorld(player.x, player.z);
      if (room && room.id === this.objective.room) this.advanceObjective();
    }

    // --- pressure estimate
    const near = this.countNear(player.x, player.z, 22);
    const target = clamp01(near / 14) * 0.7 + (1 - player.health01) * 0.3;
    this.intensity += (target - this.intensity) * clamp01(dt * 1.4);

    // Queens only lay while the player is in their part of the station, and
    // nothing in the pipe advances during a relief window either.
    this.broods.active = this.relief <= 0;

    // --- flanking wave: added only when the player is comfortable, never when
    // they are already losing. Pressure should escalate, not pile on.
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = 24 + this.rng.range(-4, 8);
      const liveNear = this.broods.list.filter((q) => q.alive && q.woken &&
        Math.hypot(q.x - player.x, q.z - player.z) < 40).length;
      if (this.relief <= 0 && player.health01 > 0.55 && near < 8 && liveNear <= 1 &&
          this.broods.remaining > 0) {
        this.ventWave(player);
      }
    }
  }

  /** A small wave from vents behind the player: the "they are in the walls" beat. */
  ventWave(player) {
    if (this.ventWaveCooldown > 0) return 0;
    const vents = this.sector.vents.filter((v) => {
      if (!v.valid || v.sealed) return false;
      const d = Math.hypot(v.sx - player.x, v.sz - player.z);
      return d > 9 && d < 30;
    });
    if (!vents.length) return 0;
    const vent = this.rng.pick(vents);
    const count = 3 + Math.floor(this.rng.next() * 3);
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const kind = this.rng.bool(0.78) ? KIND.RUNNER : KIND.STALKER;
      const id = this.enemies.spawn(kind,
        vent.sx + this.rng.gauss(0.6), vent.sz + this.rng.gauss(0.6),
        { alerted: true, emergeTime: 0.3 + i * 0.12 });
      if (id >= 0) spawned++;
    }
    if (spawned) {
      this.stats.waves++;
      this.stats.ventSpawns += spawned;
      this.ventWaveCooldown = 12;
      this.events.emit('ventWave', { x: vent.wx, z: vent.wz, count: spawned });
    }
    return spawned;
  }

  countNear(x, z, r) {
    const e = this.enemies;
    let n = 0;
    const r2 = r * r;
    for (let k = 0; k < e.list.count; k++) {
      const i = e.list.active[k];
      if (e.state[i] === 7) continue;
      const dx = e.x[i] - x, dz = e.z[i] - z;
      if (dx * dx + dz * dz <= r2) n++;
    }
    return n;
  }
}
