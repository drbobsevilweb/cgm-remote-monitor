// LEVEL / Sector — builds the collision grid from authored data and owns the
// runtime level state: doors, objectives, triggers, pickups-in-world.
//
// LEVEL never builds meshes. ENVIRONMENT reads this and does that.

import { Grid, CELL, C } from './Grid.js';
import { Nav } from './Nav.js';

export class Sector {
  constructor(spec, events) {
    this.spec = spec;
    this.events = events;
    this.grid = new Grid(spec.cols, spec.rows);
    this.rooms = spec.rooms.map((r, i) => ({ ...r, index: i, entered: false }));
    this.roomById = new Map(this.rooms.map((r) => [r.id, r]));
    this.doors = [];
    this.doorById = new Map();
    this.pits = spec.pits || [];
    this.triggers = (spec.triggers || []).map((t) => ({ ...t, fired: false }));
    this.build();
    this.nav = new Nav(this.grid);
    this.spawn = { x: spec.spawn.x * CELL, z: spec.spawn.z * CELL, facing: spec.spawn.facing || 0 };
    this.exitBox = {
      x0: spec.exit.x * CELL, z0: spec.exit.z * CELL,
      x1: (spec.exit.x + spec.exit.w) * CELL, z1: (spec.exit.z + spec.exit.h) * CELL,
    };
    this.objectiveText = '';
    this.exitReached = false;
  }

  // ---------------------------------------------------------------- build
  build() {
    const g = this.grid;
    g.cells.fill(C.VOID);

    // 1. Floors. Rooms and corridors are the same operation; adjacency connects
    //    them automatically, which is why no explicit "carve door" pass is needed.
    for (const r of this.rooms) {
      g.fill(r.x, r.z, r.w, r.h, C.FLOOR);
      for (let z = r.z; z < r.z + r.h; z++)
        for (let x = r.x; x < r.x + r.w; x++)
          if (g.inBounds(x, z)) g.zone[g.idx(x, z)] = r.index;
    }

    // 2. Seal: any VOID cell orthogonally or diagonally touching FLOOR is WALL.
    const cells = g.cells;
    const wallMask = new Uint8Array(g.n);
    for (let cz = 0; cz < g.rows; cz++) {
      for (let cx = 0; cx < g.cols; cx++) {
        const i = cz * g.cols + cx;
        if (cells[i] !== C.VOID) continue;
        let touch = false;
        for (let dz = -1; dz <= 1 && !touch; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, nz = cz + dz;
            if (!g.inBounds(nx, nz)) continue;
            if (cells[nz * g.cols + nx] === C.FLOOR) { touch = true; break; }
          }
        if (touch) wallMask[i] = 1;
      }
    }
    for (let i = 0; i < g.n; i++) if (wallMask[i]) cells[i] = C.WALL;

    // 3. Pits: holes in the deck. Grating is stamped back over them next.
    for (const p of this.pits) g.fill(p.x, p.z, p.w, p.h, C.VOID);

    // 4. Grating — walkable, over the void (DIRECTION §6).
    for (const gr of this.spec.grates || []) g.fill(gr.x, gr.z, gr.w, gr.h, C.GRATE);

    // 5. Re-seal any void exposed by pits so nothing can walk off the edge into
    //    a cell that has no floor and no wall — the pit rim itself is not solid,
    //    the VOID cell is (VOID is not walkable), so nothing further is needed.

    // 6. Doors.
    let did = 0;
    for (const d of this.spec.doors || []) {
      const door = {
        ...d, index: did, state: d.locked ? 'locked' : 'closed',
        open01: 0, cycling: false, cycleT: 0, proximity: 0,
        cx: d.x, cz: d.z,
        wx: (d.x + d.w / 2) * CELL, wz: (d.z + d.h / 2) * CELL,
      };
      for (let z = d.z; z < d.z + d.h; z++)
        for (let x = d.x; x < d.x + d.w; x++) {
          if (!g.inBounds(x, z)) continue;
          const i = g.idx(x, z);
          cells[i] = C.DOOR;
          g.doorId[i] = did;
        }
      g.doorOpen[did] = 0;
      g.doorLocked[did] = d.locked ? 1 : 0;
      this.doors.push(door);
      this.doorById.set(d.id, door);
      did++;
    }

    // 7. Vents — solid wall cells the Chorus uses as ingress.
    this.vents = [];
    for (const v of this.spec.vents || []) {
      if (!g.inBounds(v.x, v.z)) continue;
      const i = g.idx(v.x, v.z);
      if (cells[i] === C.WALL) cells[i] = C.VENT;
      // Spawn point is the walkable cell adjacent to the vent, in `face`.
      const off = FACE[v.face] || [0, 1];
      const sx = v.x - off[0], sz = v.z - off[1];
      this.vents.push({
        cx: v.x, cz: v.z, face: v.face, room: v.room,
        wx: (v.x + 0.5) * CELL, wz: (v.z + 0.5) * CELL,
        sx: (sx + 0.5) * CELL, sz: (sz + 0.5) * CELL,
        valid: g.walkableCell(sx, sz),
      });
    }

    // 8. Static prop footprints that block movement.
    this.blockers = [];
    for (const p of this.spec.props || []) {
      const fp = FOOTPRINT[p.t];
      if (!fp) continue;
      const w = p.t === 'container' ? (p.rot ? 2 : (p.len || 3)) : fp[0];
      const h = p.t === 'container' ? (p.rot ? (p.len || 3) : 2) : fp[1];
      for (let z = p.z; z < p.z + h; z++)
        for (let x = p.x; x < p.x + w; x++) {
          if (!g.inBounds(x, z)) continue;
          const i = g.idx(x, z);
          if (cells[i] === C.FLOOR || cells[i] === C.GRATE) cells[i] = C.PROP;
        }
      this.blockers.push(p);
    }
  }

  /** Self-test: everything the critical path needs must be reachable. */
  validate() {
    const g = this.grid;
    const s = this.spec.spawn;
    g.ignoreLocks = true;   // "reachable once the objectives are met"
    const { seen, count } = g.floodReachable(s.x, s.z);
    g.ignoreLocks = false;
    const problems = [];
    const check = (label, cx, cz) => {
      if (!g.inBounds(cx, cz) || !seen[g.idx(cx, cz)]) problems.push(`${label} unreachable at ${cx},${cz}`);
    };
    for (const r of this.rooms) {
      // check the room centre, nudging to a walkable cell if the centre is a prop
      let cx = Math.floor(r.x + r.w / 2), cz = Math.floor(r.z + r.h / 2);
      let ok = false;
      for (let radius = 0; radius < 6 && !ok; radius++) {
        for (let dz = -radius; dz <= radius && !ok; dz++)
          for (let dx = -radius; dx <= radius && !ok; dx++) {
            const x = cx + dx, z = cz + dz;
            if (g.inBounds(x, z) && seen[g.idx(x, z)]) ok = true;
          }
      }
      if (!ok) problems.push(`room ${r.id} unreachable`);
    }
    for (const n of this.spec.nests) check(`nest ${n.id}`, n.x, n.z);
    for (const v of this.vents) if (!v.valid) problems.push(`vent ${v.cx},${v.cz} has no adjacent floor`);
    check('exit', this.spec.exit.x, this.spec.exit.z);
    return { ok: problems.length === 0, problems, reachableCells: count };
  }

  // ---------------------------------------------------------------- runtime
  roomAtWorld(x, z) {
    const zi = this.grid.zoneAtWorld(x, z);
    return zi === 255 ? null : this.rooms[zi];
  }

  unlock(doorId) {
    const d = this.doorById.get(doorId);
    if (!d || d.state !== 'locked') return;
    d.state = 'closed';
    this.grid.doorLocked[d.index] = 0;
    this.nav.invalidate();
    this.events.emit('doorState', { id: d.id, state: 'unlocked', x: d.wx, z: d.wz, label: d.label });
  }

  onNestDestroyed(nestId, remaining) {
    for (const d of this.doors) {
      if (d.state !== 'locked') continue;
      if (d.unlockOn === `nest:${nestId}` || (d.unlockOn === 'allNests' && remaining === 0)) {
        this.unlock(d.id);
      }
    }
  }

  /**
   * @param actorNear (x,z,r) => bool — anything alive close enough to trip the
   * door sensor. The Chorus has been walking through these doors for nineteen
   * days; only the locked ones stop it.
   */
  update(dt, px, pz, actorNear = null) {
    for (const d of this.doors) {
      const r = d.kind === 'bulkhead' ? 5.0 : 4.0;
      const near = Math.hypot(px - d.wx, pz - d.wz) < r ||
                   (actorNear ? actorNear(d.wx, d.wz, r * 0.8) : false);
      const want = near && d.state !== 'locked';
      const prevOpen = d.open01;
      const speed = d.kind === 'bulkhead' ? 0.9 : 1.9;
      d.open01 += (want ? dt * speed : -dt * speed * 0.8);
      if (d.open01 > 1) d.open01 = 1; else if (d.open01 < 0) d.open01 = 0;
      const solidNow = d.open01 < 0.55;
      const wasSolid = !this.grid.doorOpen[d.index];
      this.grid.doorOpen[d.index] = solidNow ? 0 : 1;
      if (solidNow !== wasSolid) this.nav.invalidate();
      if (prevOpen === 0 && d.open01 > 0) {
        this.events.emit('doorState', { id: d.id, state: 'cycling', x: d.wx, z: d.wz, kind: d.kind });
      }
    }

    // Room entry triggers.
    const room = this.roomAtWorld(px, pz);
    if (room && !room.entered) {
      room.entered = true;
      this.events.emit('roomEnter', { id: room.id, name: room.name, kind: room.kind });
      for (const t of this.triggers) {
        if (t.room !== room.id || t.fired) continue;
        t.fired = true;
        if (t.message) this.events.emit('message', { text: t.message, tone: t.tone || 'log', ttl: 5 });
        if (t.beat) this.events.emit('beat', { name: t.beat });
      }
    }

    if (!this.exitReached && px >= this.exitBox.x0 && px <= this.exitBox.x1 &&
        pz >= this.exitBox.z0 && pz <= this.exitBox.z1) {
      this.exitReached = true;
      this.events.emit('exitReached', {});
    }
  }
}

const FACE = { 'x-': [-1, 0], 'x+': [1, 0], 'z-': [0, -1], 'z+': [0, 1] };

// Cell footprints for props that block movement. Props not listed are decorative.
const FOOTPRINT = {
  container: [3, 2], crate: [1, 1], crane: [3, 2], mill: [3, 3], silo: [3, 3],
  pump: [3, 3], pylon: [2, 2], locker: [1, 1], bunk: [2, 1], table: [1, 1],
  loader: [2, 2], barricade: [2, 1], console: [1, 1],
  // 'lift' is deliberately absent: the lift platform is walkable — it is the exit.
};

export { CELL, C };
