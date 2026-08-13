// WEAPONS / Projectiles — pooled SoA projectile simulation.
//
// Projectiles are real travelling objects, not hitscan: at 118 m/s a carbine
// round crosses a 20 m room in 170 ms, which is long enough to read as a tracer
// and short enough to feel instant. That readability is the point (DIRECTION §2).

import { FreeList } from '../core/Pool.js';
import { C } from '../level/Grid.js';
import { pointSegDist2 } from '../core/Mathx.js';

export const P_BULLET = 0;
export const P_GRENADE = 1;
export const P_SPIT = 2;      // enemy projectile

const CAP = 512;

export class Projectiles {
  constructor(sector, events, rng) {
    this.sector = sector;
    this.grid = sector.grid;
    this.events = events;
    this.rng = rng.child('projectiles');
    this.list = new FreeList(CAP);

    this.x = new Float32Array(CAP); this.y = new Float32Array(CAP); this.z = new Float32Array(CAP);
    this.px = new Float32Array(CAP); this.py = new Float32Array(CAP); this.pz = new Float32Array(CAP);
    this.vx = new Float32Array(CAP); this.vy = new Float32Array(CAP); this.vz = new Float32Array(CAP);
    this.life = new Float32Array(CAP);
    this.damage = new Float32Array(CAP);
    this.kind = new Uint8Array(CAP);
    this.team = new Uint8Array(CAP);     // 0 player, 1 chorus
    this.pierce = new Uint8Array(CAP);
    this.radius = new Float32Array(CAP);
    this.tracer = new Uint8Array(CAP);
    this.fuse = new Float32Array(CAP);

    this.targets = null;   // injected: { queryRadius, hit, playerHit, playerPos }
    this._hitScratch = new Set();
  }

  spawn(kind, x, y, z, vx, vy, vz, opts = {}) {
    const i = this.list.alloc();
    if (i < 0) return -1;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.kind[i] = kind;
    this.life[i] = opts.life ?? 2.5;
    this.damage[i] = opts.damage ?? 10;
    this.team[i] = opts.team ?? 0;
    this.pierce[i] = opts.pierce ?? 0;
    this.radius[i] = opts.radius ?? 0.10;
    this.tracer[i] = opts.tracer ? 1 : 0;
    this.fuse[i] = opts.fuse ?? 0;
    return i;
  }

  update(dt) {
    const ids = this.list.active;
    const hitOut = this._out || (this._out = {});
    for (let k = this.list.count - 1; k >= 0; k--) {
      const i = ids[k];
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];

      if (this.kind[i] === P_GRENADE) {
        this.vy[i] -= 22 * dt;                  // heavier than earth: it lands fast
      } else if (this.kind[i] === P_SPIT) {
        this.vy[i] -= 6 * dt;
      }

      let nx = this.x[i] + this.vx[i] * dt;
      let ny = this.y[i] + this.vy[i] * dt;
      let nz = this.z[i] + this.vz[i] * dt;

      // --- free-standing destructibles (queens, eggs, tanks): not in the collision
      // grid, so they are tested explicitly before the walls behind them.
      if (this.obstacles && this.kind[i] !== P_GRENADE) {
        const o = this._obs || (this._obs = {});
        if (this.obstacles.test(this.x[i], this.z[i], nx, nz, o)) {
          const dirLen = Math.hypot(this.vx[i], this.vz[i]) || 1;
          this.obstacles.damage(o.kind, o.ref, this.damage[i], o.x, this.y[i], o.z,
            this.vx[i] / dirLen, this.vz[i] / dirLen);
          this.kill(i);
          continue;
        }
      }

      // --- world collision
      const dx = nx - this.x[i], dz = nz - this.z[i];
      const segLen = Math.hypot(dx, dz);
      let killed = false;
      if (segLen > 1e-5) {
        const t = this.grid.ray(this.x[i], this.z[i], dx / segLen, dz / segLen, segLen, hitOut);
        if (t >= 0) {
          if (this.kind[i] === P_GRENADE) {
            // bounce, losing most of the energy
            if (hitOut.nx) this.vx[i] *= -0.42; else this.vz[i] *= -0.42;
            this.vy[i] *= 0.7;
            nx = this.x[i] + (dx / segLen) * Math.max(0, t - 0.05);
            nz = this.z[i] + (dz / segLen) * Math.max(0, t - 0.05);
            this.events.emit('impact', {
              x: nx, y: ny, z: nz, nx: hitOut.nx, ny: 0, nz: hitOut.nz,
              surface: surfaceOf(hitOut.cell), power: 0.25, weapon: 'grenade',
            });
          } else {
            this.impact(i, hitOut.x, ny, hitOut.z, hitOut.nx, hitOut.nz, hitOut.cell,
              hitOut.cx, hitOut.cz);
            killed = true;
          }
        }
      }
      if (!killed && ny <= 0.02) {
        if (this.kind[i] === P_GRENADE) {
          ny = 0.02;
          this.vy[i] = Math.abs(this.vy[i]) * 0.34;
          this.vx[i] *= 0.62; this.vz[i] *= 0.62;
          if (Math.abs(this.vy[i]) < 0.6) this.vy[i] = 0;
        } else if (this.kind[i] === P_SPIT) {
          this.impact(i, nx, 0.02, nz, 0, 0, C.FLOOR);
          killed = true;
        }
      }
      if (killed) continue;

      // --- actor collision
      if (this.targets) {
        if (this.team[i] === 0) {
          const n = this.targets.queryRadius(nx, nz, segLen * 0.5 + 1.4);
          const res = this.targets.result;
          let consumed = false;
          for (let q = 0; q < n && !consumed; q++) {
            const e = res[q];
            const er = this.targets.radiusOf(e);
            const ex = this.targets.xOf(e), ez = this.targets.zOf(e);
            const d2 = pointSegDist2(ex, ez, this.x[i], this.z[i], nx, nz);
            const rr = er + this.radius[i];
            if (d2 > rr * rr) continue;
            if (!this.targets.alive(e)) continue;
            const dirLen = Math.hypot(this.vx[i], this.vz[i]) || 1;
            this.targets.hit(e, this.damage[i], this.vx[i] / dirLen, this.vz[i] / dirLen, nx, ny, nz, 'bullet');
            if (this.pierce[i] > 0) { this.pierce[i]--; this.damage[i] *= 0.72; }
            else { this.kill(i); consumed = true; }
          }
          if (consumed) continue;
        } else {
          const p = this.targets.playerPos;
          if (p && this.targets.playerAlive()) {
            const d2 = pointSegDist2(p.x, p.z, this.x[i], this.z[i], nx, nz);
            const rr = 0.46 + this.radius[i];
            if (d2 <= rr * rr) {
              const dirLen = Math.hypot(this.vx[i], this.vz[i]) || 1;
              this.targets.playerHit(this.damage[i], this.vx[i] / dirLen, this.vz[i] / dirLen);
              this.impact(i, nx, ny, nz, 0, 0, C.FLOOR);
              continue;
            }
          }
        }
      }

      this.x[i] = nx; this.y[i] = ny; this.z[i] = nz;

      if (this.fuse[i] > 0) {
        this.fuse[i] -= dt;
        if (this.fuse[i] <= 0) { this.detonate(i); continue; }
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        if (this.kind[i] === P_GRENADE) this.detonate(i);
        else this.kill(i);
      }
    }
  }

  impact(i, x, y, z, nx, nz, cell, cx = -1, cz = -1) {
    this.events.emit('impact', {
      x, y: Math.max(0.05, y), z, nx, ny: 0, nz,
      surface: surfaceOf(cell),
      power: this.kind[i] === P_SPIT ? 0.5 : 0.35,
      weapon: this.kind[i] === P_SPIT ? 'spit' : 'bullet',
      team: this.team[i],
      // Carried so GAME can route it to whatever destructible occupies the cell
      // that stopped the round. Wall grilles are the only one today. The CELL is
      // carried, not just the point: an impact lands exactly on a cell boundary,
      // and flooring the world position there picks the cell in FRONT of the
      // wall rather than the wall itself.
      damage: this.damage[i], cx, cz,
    });
    if (this.kind[i] === P_SPIT) {
      this.events.emit('acidPool', { x, z, radius: 1.5, ttl: 5.5 });
    }
    this.kill(i);
  }

  detonate(i) {
    this.events.emit('explosion', {
      x: this.x[i], y: Math.max(0.4, this.y[i]), z: this.z[i],
      radius: 4.6, power: this.damage[i], kind: 'frag',
    });
    this.kill(i);
  }

  kill(i) { this.list.release(i); }

  clear() { this.list.clear(); }
  get count() { return this.list.count; }
}

export function surfaceOf(cell) {
  switch (cell) {
    case C.GRATE: return 'grate';
    case C.VENT: return 'vent';
    case C.PROP: return 'machine';
    case C.DOOR: return 'steel';
    default: return 'steel';
  }
}
