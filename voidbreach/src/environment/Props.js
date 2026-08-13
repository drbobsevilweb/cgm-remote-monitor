// ENVIRONMENT / Props — every object in the station, built from the shared
// construction language (DIRECTION §7). Each prop writes into one of the merged
// MeshBuilders, so adding props costs triangles but not draw calls.
//
// Props are deliberately blocky and legible from above: this camera reads
// silhouette and top surface, so detail goes on the top and the upper third.

import { CELL } from '../level/Grid.js';

const H = CELL / 2;

/** ctx = { steel, deck, painted, ceramic, flesh, hazard, emissive, rng, lamps, tanks, pickups, screens } */
export function buildProp(p, ctx, room) {
  const x = (p.x + 0.5) * CELL;
  const z = (p.z + 0.5) * CELL;
  const fn = PROPS[p.t];
  if (fn) fn(x, z, p, ctx, room);
}

const PROPS = {
  // ---------------------------------------------------------------- cargo
  container(x, z, p, c) {
    const rot = p.rot || 0;
    const len = (p.len || 3) * CELL;
    const wid = 2 * CELL * 0.86;
    const h = 2.6;
    const stack = p.stack || 0;
    const b = c.painted;
    const tint = c.rng.pick(CONTAINER_TINTS);
    for (let s = 0; s <= stack; s++) {
      const y = s * (h + 0.06);
      b.setColor(tint[0], tint[1], tint[2]);
      b.addBoxRot(x + len / 2 - CELL / 2, y + h / 2, z + wid / 2 - CELL * 0.07,
        len / 2, h / 2, wid / 2, rot, 1);
      // corner castings and top rails read the silhouette from above
      b.setColor(0.35, 0.37, 0.4);
      const cs = 0.22;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = sx * (len / 2 - cs), lz = sz * (wid / 2 - cs);
        const cx = x + len / 2 - CELL / 2 + lx * Math.cos(rot) - lz * Math.sin(rot);
        const cz = z + wid / 2 - CELL * 0.07 + lx * Math.sin(rot) + lz * Math.cos(rot);
        c.steel.setColor(0.35, 0.37, 0.4);
        c.steel.addBoxRot(cx, y + h - 0.12, cz, cs, 0.12, cs, rot, 2);
        c.steel.addBoxRot(cx, y + 0.12, cz, cs, 0.12, cs, rot, 2);
      }
      b.setColor(1, 1, 1);
    }
    c.steel.setColor(1, 1, 1);
  },

  crate(x, z, p, c) {
    const s = CELL * 0.38;
    const h = c.rng.range(0.7, 1.15);
    c.painted.setColor(0.42, 0.44, 0.40);
    c.painted.addBoxRot(x, h / 2, z, s, h / 2, s, c.rng.range(-0.25, 0.25), 2);
    c.painted.setColor(1, 1, 1);
  },

  pallet(x, z, p, c) {
    c.steel.setColor(0.30, 0.28, 0.24);
    c.steel.addBox(x - 1.0, 0.02, z - 0.7, x + 1.0, 0.16, z + 0.7, 2);
    c.steel.setColor(1, 1, 1);
  },

  crane(x, z, p, c) {
    // gantry crane: two legs, a beam, a hoist — explains what the hall was for
    const b = c.steel;
    b.setColor(0.5, 0.5, 0.52);
    for (const dz of [-3.4, 3.4]) {
      b.addBox(x - 0.22, 0, z + dz - 0.22, x + 0.22, 5.4, z + dz + 0.22, 2);
    }
    b.addBox(x - 0.5, 5.4, z - 4.0, x + 0.5, 5.9, z + 4.0, 2);
    b.setColor(0.9, 0.62, 0.22);
    b.addBox(x - 0.42, 4.4, z - 0.7, x + 0.42, 5.4, z + 0.7, 2);
    b.setColor(0.5, 0.5, 0.52);
    b.addBox(x - 0.06, 2.6, z - 0.06, x + 0.06, 4.4, z + 0.06, 4);
    b.addBox(x - 0.35, 2.2, z - 0.35, x + 0.35, 2.6, z + 0.35, 3);
    b.setColor(1, 1, 1);
  },

  loader(x, z, p, c) {
    const rot = p.rot || 0;
    c.painted.setColor(0.85, 0.55, 0.15);
    c.painted.addBoxRot(x, 0.85, z, 1.5, 0.7, 1.05, rot, 2);
    c.painted.setColor(1, 1, 1);
    c.steel.setColor(0.25, 0.26, 0.28);
    c.steel.addBoxRot(x, 0.3, z, 1.6, 0.3, 1.2, rot, 2);
    c.steel.addBoxRot(x + Math.cos(rot) * 1.9, 0.12, z + Math.sin(rot) * 1.9, 0.9, 0.10, 0.9, rot, 2);
    c.steel.setColor(1, 1, 1);
  },

  // ---------------------------------------------------------------- fixtures
  lamp(x, z, p, c, room) {
    const ceil = room ? room.ceil : 3.2;
    const y = Math.min(ceil - 0.35, 3.9);
    const b = c.steel;
    b.setColor(0.28, 0.30, 0.33);
    b.addBox(x - 0.42, y, z - 0.16, x + 0.42, y + 0.16, z + 0.16, 2);   // housing
    b.addBox(x - 0.05, y + 0.16, z - 0.05, x + 0.05, ceil, z + 0.05, 3); // stem
    b.setColor(1, 1, 1);
    c.lamps.push({
      x, y: y - 0.02, z,
      color: (room && room.lampColor) || 0xffb45a,
      light: (room && room.lampLight) || 0xffd9b4,
      intensity: (room && room.lampI) || 1.0,
      broken: !!p.broken,
      alive: !p.broken,
      radius: 7.5,
      hp: 8,
    });
  },

  sign(x, z, p, c, room) {
    c.emissive.push({ x, y: 2.55, z, w: 1.5, h: 0.4, color: 0xffb45a, kind: 'sign', text: p.text });
    c.steel.setColor(0.2, 0.22, 0.25);
    c.steel.addBox(x - 0.8, 2.35, z - 0.06, x + 0.8, 2.85, z + 0.06, 2);
    c.steel.setColor(1, 1, 1);
  },

  console(x, z, p, c) {
    const rot = p.rot || 0;
    const b = c.steel;
    b.setColor(0.26, 0.28, 0.31);
    b.addBoxRot(x, 0.45, z, 0.75, 0.45, 0.42, rot, 2);
    b.addBoxRot(x - Math.sin(rot) * 0.18, 1.0, z + Math.cos(rot) * 0.18, 0.72, 0.30, 0.10, rot, 2);
    b.setColor(1, 1, 1);
    c.screens.push({ x: x - Math.sin(rot) * 0.28, y: 1.0, z: z + Math.cos(rot) * 0.28, rot, w: 1.3, h: 0.5 });
  },

  tray(x, z, p, c, room) {
    // cable tray run at 2.9 m — the station's nervous system
    const w = (p.w || 1) * CELL, h = (p.h || 0) * CELL;
    const b = c.steel;
    b.setColor(0.22, 0.24, 0.27);
    if (h > 0) b.addBox(x - 0.28, 2.86, z - CELL / 2, x + 0.28, 2.98, z + h, 2);
    else b.addBox(x - CELL / 2, 2.86, z - 0.28, x + w, 2.98, z + 0.28, 2);
    b.setColor(1, 1, 1);
  },

  pipe(x, z, p, c) {
    const w = (p.w || 1) * CELL;
    c.steel.setColor(0.34, 0.36, 0.38);
    c.steel.addPipe(x - CELL / 2, 2.55, z - 0.5, x + w, 2.55, z - 0.5, 0.16, 8, 1);
    c.steel.addPipe(x - CELL / 2, 2.55, z - 0.1, x + w, 2.55, z - 0.1, 0.10, 6, 1);
    c.steel.setColor(1, 1, 1);
  },

  // ---------------------------------------------------------------- hazards
  tank(x, z, p, c) {
    // pressure vessel: yellow band, red cap — the game's only "shoot this" promise
    c.tanks.push({ x, y: 0, z, alive: true, hp: 26, leaking: 0, radius: 0.55 });
  },

  steam(x, z, p, c) {
    c.steamVents.push({ x, y: 0.5, z, dir: c.rng.angle() });
    c.steel.setColor(0.3, 0.32, 0.34);
    c.steel.addCylinder(x, 0.0, z, 0.28, 0.5, 8, true, false, 2);
    c.steel.setColor(1, 1, 1);
  },

  // ---------------------------------------------------------------- machinery
  mill(x, z, p, c) {
    const b = c.painted;
    b.setColor(0.38, 0.40, 0.42);
    b.addBox(x - 3.0, 0, z - 3.0, x + 3.0, 3.4, z + 3.0, 1.5);
    b.setColor(1, 1, 1);
    c.steel.setColor(0.3, 0.31, 0.33);
    c.steel.addCylinder(x, 3.4, z, 1.5, 1.6, 12, true, false, 1.5);
    c.steel.addPipe(x, 2.2, z - 3.0, x, 2.2, z - 4.6, 0.28, 8, 1);
    c.steel.setColor(0.5, 0.42, 0.2);
    c.steel.addBox(x - 3.2, 0.9, z - 3.2, x - 2.9, 1.5, z + 3.2, 2);
    c.steel.setColor(1, 1, 1);
  },

  silo(x, z, p, c) {
    c.painted.setColor(0.34, 0.36, 0.38);
    c.painted.addCylinder(x, 0, z, 3.0, 6.2, 14, true, false, 1.2);
    c.painted.setColor(1, 1, 1);
    c.steel.setColor(0.26, 0.27, 0.29);
    c.steel.addCylinder(x, 6.2, z, 1.2, 0.9, 10, true, false, 2);
    c.steel.setColor(1, 1, 1);
  },

  conveyor(x, z, p, c) {
    const w = (p.w || 8) * CELL;
    const b = c.steel;
    b.setColor(0.24, 0.25, 0.27);
    b.addBox(x - CELL / 2, 0.75, z - 0.85, x + w, 0.95, z + 0.85, 1.5);
    for (let lx = x - CELL / 2; lx < x + w; lx += 2.4) {
      b.addBox(lx - 0.09, 0, z - 0.75, lx + 0.09, 0.75, z - 0.57, 3);
      b.addBox(lx - 0.09, 0, z + 0.57, lx + 0.09, 0.75, z + 0.75, 3);
    }
    b.setColor(0.12, 0.13, 0.14);
    b.addBox(x - CELL / 2, 0.95, z - 0.78, x + w, 1.0, z + 0.78, 1.5);
    b.setColor(1, 1, 1);
  },

  pump(x, z, p, c) {
    const b = c.painted;
    b.setColor(0.30, 0.34, 0.36);
    b.addBox(x - 2.4, 0, z - 2.4, x + 2.4, 2.0, z + 2.4, 1.5);
    b.setColor(1, 1, 1);
    c.steel.setColor(0.26, 0.28, 0.3);
    c.steel.addCylinder(x, 2.0, z, 1.35, 2.2, 12, true, false, 1.5);
    c.steel.addPipe(x - 2.4, 1.2, z, x - 4.6, 1.2, z, 0.42, 10, 1);
    c.steel.addPipe(x + 2.4, 1.2, z, x + 4.4, 1.2, z, 0.42, 10, 1);
    c.steel.setColor(1, 1, 1);
  },

  pylon(x, z, p, c) {
    // reactor bus pylon: tall, hums, breaks line of sight in the arena
    const b = c.steel;
    b.setColor(0.24, 0.25, 0.28);
    b.addBox(x - 1.1, 0, z - 1.1, x + 1.1, 0.5, z + 1.1, 2);
    b.addBox(x - 0.75, 0.5, z - 0.75, x + 0.75, 5.4, z + 0.75, 1.5);
    b.setColor(0.3, 0.32, 0.35);
    b.addBox(x - 1.0, 5.4, z - 1.0, x + 1.0, 5.9, z + 1.0, 2);
    b.setColor(1, 1, 1);
    c.emissive.push({ x, y: 3.0, z, w: 0.3, h: 2.4, color: 0xff8a3d, kind: 'strip', axis: 'z' });
    c.emissive.push({ x, y: 3.0, z, w: 0.3, h: 2.4, color: 0xff8a3d, kind: 'strip', axis: 'x' });
  },

  // ---------------------------------------------------------------- habitation
  bunk(x, z, p, c) {
    const rot = p.rot || 0;
    c.ceramic.setColor(0.55, 0.57, 0.58);
    c.ceramic.addBoxRot(x, 0.28, z, 1.9, 0.28, 0.85, rot, 1.5);
    c.ceramic.addBoxRot(x, 1.32, z, 1.9, 0.16, 0.85, rot, 1.5);
    c.ceramic.setColor(1, 1, 1);
    c.steel.setColor(0.22, 0.24, 0.26);
    c.steel.addBoxRot(x - Math.cos(rot) * 1.85, 0.9, z - Math.sin(rot) * 1.85, 0.06, 0.9, 0.8, rot, 3);
    c.steel.setColor(1, 1, 1);
  },

  locker(x, z, p, c) {
    c.ceramic.setColor(0.45, 0.48, 0.5);
    c.ceramic.addBoxRot(x, 1.0, z, 0.45, 1.0, 0.9, p.rot || 0, 1.5);
    c.ceramic.setColor(1, 1, 1);
  },

  table(x, z, p, c) {
    c.ceramic.setColor(0.5, 0.52, 0.5);
    c.ceramic.addBoxRot(x, 0.78, z, 1.0, 0.06, 0.65, p.rot || 0, 1.5);
    c.ceramic.setColor(1, 1, 1);
    c.steel.setColor(0.2, 0.22, 0.24);
    c.steel.addBoxRot(x, 0.39, z, 0.1, 0.39, 0.1, p.rot || 0, 3);
    c.steel.setColor(1, 1, 1);
  },

  barricade(x, z, p, c) {
    // welded from deck plate and whatever was to hand. Evidence of a failed defence.
    const rot = p.rot || 0;
    const b = c.steel;
    b.setColor(0.3, 0.31, 0.33);
    b.addBoxRot(x, 0.6, z, 1.9, 0.6, 0.18, rot, 1.5);
    b.setColor(0.34, 0.3, 0.24);
    for (let i = -1; i <= 1; i++) {
      b.addBoxRot(x + Math.cos(rot) * i * 1.2, 0.75, z + Math.sin(rot) * i * 1.2,
        0.14, 0.75, 0.34, rot + 0.12 * i, 2);
    }
    b.setColor(1, 1, 1);
  },

  corpse(x, z, p, c) {
    // a charter operator who did not get out. Read from above as a dark shape
    // with a dead helmet lamp.
    const rot = p.rot || 0;
    const b = c.painted;
    b.setColor(0.16, 0.17, 0.19);
    b.addBoxRot(x, 0.16, z, 0.85, 0.16, 0.34, rot, 2);
    b.addBoxRot(x + Math.cos(rot) * 0.95, 0.14, z + Math.sin(rot) * 0.95, 0.22, 0.14, 0.22, rot, 3);
    b.setColor(1, 1, 1);
    c.decalsStatic.push({ x, z, r: 1.4, kind: 3, rot, color: 0x3a1010 });
  },

  lift(x, z, p, c) {
    const b = c.steel;
    b.setColor(0.32, 0.34, 0.37);
    b.addBox(x - 2.4, 0.04, z - 2.4, x + 2.4, 0.16, z + 2.4, 1.2);
    b.setColor(0.22, 0.24, 0.26);
    for (const [dx, dz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) {
      b.addBox(x + dx - 0.14, 0.16, z + dz - 0.14, x + dx + 0.14, 4.2, z + dz + 0.14, 3);
    }
    b.setColor(1, 1, 1);
    c.emissive.push({ x, y: 0.2, z, w: 4.6, h: 4.6, color: 0x5fd8ff, kind: 'floor' });
  },

  // ---------------------------------------------------------------- pickups
  ammo(x, z, p, c) { c.pickups.push({ kind: 'ammo', x, z }); },
  medkit(x, z, p, c) { c.pickups.push({ kind: 'medkit', x, z }); },
  armour(x, z, p, c) { c.pickups.push({ kind: 'armour', x, z }); },
  flare(x, z, p, c) { c.pickups.push({ kind: 'flare', x, z }); },
};

const CONTAINER_TINTS = [
  [0.42, 0.30, 0.22], [0.24, 0.32, 0.38], [0.38, 0.38, 0.34],
  [0.30, 0.36, 0.30], [0.46, 0.40, 0.24],
];

export { PROPS };
