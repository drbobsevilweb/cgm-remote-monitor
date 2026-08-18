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
    this.section = null;
    this.sectionCleared = false;
    this.beats = new Set();
    this.bossActive = false;
    this.ventWaveCooldown = 0;
    this.stats = { waves: 0, ventSpawns: 0 };

    broods.active = true;

    events.on('queenKilled', (e) => this.onQueenKilled(e));
    events.on('beat', (e) => this.beats.add(e.name));
    this.section = null;
    this.sectionCleared = false;
    this.enterSection((sector.spec.sections || [{}])[0].id);
  }

  // ------------------------------------------------------------- sections
  /**
   * The level is a chain of sections, and this drives it.
   *
   * Every section states its goal the moment the player walks into it, opens
   * the way on when that goal is met, and welds the way back behind them. The
   * old model was a flat list of objectives advanced by whatever happened to
   * happen; the player could be three rooms past an objective that was still
   * describing where they had been.
   *
   * `clear`:
   *   'enter'   the goal was arriving; cleared on entry
   *   'queens'  every queen in this section's rooms is dead
   *   'exit'    reach the lift
   */
  enterSection(id) {
    const list = this.sector.spec.sections || [];
    const sec = list.find((s) => s.id === id);
    if (!sec || this.section === sec) return;
    this.section = sec;
    this.sectionCleared = false;

    // Weld shut anything that names this section. The player is committed now.
    for (const d of this.sector.doors) {
      if (d.sealOn === id) this.sector.sealDoor(d.id);
    }

    this.events.emit('sectionEnter', {
      id: sec.id, name: sec.name, brief: sec.brief || '', objective: sec.objective,
    });
    if (sec.brief) {
      this.events.emit('message', { text: sec.brief, tone: 'log', ttl: 4.5 });
    }
    this.emitObjective();
    // An 'enter' section is complete the moment you are in it; its job was to
    // point at the next one.
    if (sec.clear === 'enter') this.clearSection();
  }

  /** Which section owns the room the player is standing in? */
  sectionOfRoom(roomId) {
    for (const s of this.sector.spec.sections || []) {
      if (s.rooms.includes(roomId)) return s;
    }
    return null;
  }

  /** Queens belonging to this section's rooms, alive or not. */
  sectionQueens(sec) {
    const rooms = new Set(sec.rooms);
    // Dormant queens belong to a later section by definition — counting them
    // here would mean a section that can never clear.
    return this.broods.list.filter((q) => rooms.has(q.spec.room) && !q.dormant);
  }

  sectionQueensLeft(sec) {
    return this.sectionQueens(sec).filter((q) => q.alive).length;
  }

  clearSection() {
    const sec = this.section;
    if (!sec || this.sectionCleared) return;
    this.sectionCleared = true;
    for (const id of sec.opens || []) this.sector.unlock(id);
    // Anything this section was keeping asleep now wakes up.
    for (const qid of sec.wakes || []) {
      const q = this.broods.list.find((x) => x.id === qid);
      if (q) { q.dormant = false; this.events.emit('queenRoused', { id: q.id, x: q.x, z: q.z }); }
    }
    // Doors may also name the section rather than be named by it.
    for (const d of this.sector.doors) {
      if (d.unlockOn === 'section:' + sec.id) this.sector.unlock(d.id);
    }
    this.events.emit('sectionClear', { id: sec.id, name: sec.name, opens: sec.opens || [] });
    if (sec.clear === 'queens') {
      this.events.emit('message', { text: sec.name + ' CLEAR', tone: 'good', ttl: 4 });
    }
  }

  emitObjective() {
    const sec = this.section;
    if (!sec) return;
    const left = sec.clear === 'queens' ? this.sectionQueensLeft(sec) : 0;
    const text = sec.objective.replace('{n}', String(left));
    this.events.emit('objective', {
      text, kind: sec.clear, id: sec.id, section: sec.name,
      remaining: left, total: sec.clear === 'queens' ? this.sectionQueens(sec).length : 0,
    });
  }

  onQueenKilled(e) {
    // Total relief. The drone stops, the laying stops, and the room empties.
    this.relief = 7.0;
    this.intensity = 0;
    this.waveTimer = Math.max(this.waveTimer, 16);
    const sec = this.section;
    if (!sec || sec.clear !== 'queens') return;
    if (this.sectionQueensLeft(sec) === 0) this.clearSection();
    else this.emitObjective();     // "{n} REMAINING" counts down as you work
  }

  update(dt, player, time) {
    this.time += dt;
    this.relief = Math.max(0, this.relief - dt);
    this.ventWaveCooldown = Math.max(0, this.ventWaveCooldown - dt);

    // --- section progress. Walking into a room that belongs to a later section
    // advances the chain; the doors are what stop this happening out of order.
    const room = this.sector.roomAtWorld(player.x, player.z);
    if (room && this.sectionCleared) {
      // The declared `next` wins over a room lookup, because the last two
      // sections deliberately share a room: the reactor floor is both the fight
      // and the extraction, and "purge this" has to become "reach the lift"
      // without the player walking anywhere to earn it.
      const list = this.sector.spec.sections || [];
      const next = this.section && this.section.next
        ? list.find((s) => s.id === this.section.next) : null;
      if (next && next.rooms.includes(room.id)) this.enterSection(next.id);
      else {
        const owner = this.sectionOfRoom(room.id);
        if (owner && owner !== this.section) this.enterSection(owner.id);
      }
    }
    if (this.section && this.section.clear === 'exit' && this.sector.exitReached) {
      this.clearSection();
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
    // A wave BELONGS to the nearest living queen.
    //
    // These used to spawn unowned, which meant they could never panic when a
    // queen died — and gate X6 caught the consequence on seed 777: the player
    // killed the source of the pressure and 8 of 10 enemies carried on as if
    // nothing had happened, because most of them had no source to lose. Relief
    // is the payload of the whole game (DIRECTION §2) and a third of the room
    // was exempt from it.
    //
    // It is also the better fiction: something called them through that vent.
    const owner = this.broods.nearest(vent.sx, vent.sz);
    const broodId = owner && owner.dist < 55 ? owner.queen.index : -1;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const kind = this.rng.bool(0.78) ? KIND.RUNNER : KIND.STALKER;
      const id = this.enemies.spawn(kind,
        vent.sx + this.rng.gauss(0.6), vent.sz + this.rng.gauss(0.6),
        { alerted: true, emergeTime: 0.3 + i * 0.12, broodId });
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
