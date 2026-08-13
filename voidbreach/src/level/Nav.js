// LEVEL / Nav — flow fields.
//
// ARCHITECTURE decision #3: one BFS per field per rebuild (O(cells)), O(1) per
// agent lookup. 300 agents cannot afford per-agent A*; they can all afford a
// texture lookup into a shared field.
//
// Two fields are maintained:
//   PLAYER — multi-source from the player cell. The horde's default.
//   FLANK  — multi-source from cells *behind* the player, so stalkers naturally
//            route through side corridors and arrive outside the firing arc.

import { CELL } from './Grid.js';

const UNREACHED = 32000;

export class Field {
  constructor(grid) {
    this.grid = grid;
    this.dist = new Int16Array(grid.n).fill(UNREACHED);
    this.dirX = new Float32Array(grid.n);
    this.dirZ = new Float32Array(grid.n);
    this.queue = new Int32Array(grid.n);
    this.cost = new Uint8Array(grid.n);   // extra cost: wall proximity, hazards
    this.built = false;
  }

  /** Precompute static per-cell extra cost so agents avoid scraping walls. */
  bakeCost(hazardCost = 12) {
    const g = this.grid;
    for (let cz = 0; cz < g.rows; cz++) {
      for (let cx = 0; cx < g.cols; cx++) {
        const i = cz * g.cols + cx;
        if (!g.walkableCell(cx, cz)) { this.cost[i] = 0; continue; }
        let near = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++)
            if (!g.walkableCell(cx + dx, cz + dz)) near++;
        let c = near > 0 ? 2 : 0;
        if (g.cells[i] === 7 /* HAZARD */) c += hazardCost;
        this.cost[i] = c;
      }
    }
  }

  /**
   * Multi-source Dijkstra with small integer costs (bucket queue degenerates to
   * a simple FIFO because costs are tiny; we use a two-pass relaxation instead,
   * which is faster than a heap at this grid size).
   */
  build(sources, sourceCount) {
    const g = this.grid, dist = this.dist, q = this.queue;
    dist.fill(UNREACHED);
    let head = 0, tail = 0;
    for (let k = 0; k < sourceCount; k++) {
      const i = sources[k];
      if (i < 0 || i >= g.n) continue;
      if (dist[i] === 0) continue;
      dist[i] = 0; q[tail++] = i;
    }
    const cols = g.cols;
    while (head < tail) {
      const i = q[head++];
      const d = dist[i];
      const cx = i % cols, cz = (i / cols) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = NX[k], dz = NZ[k];
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= g.rows) continue;
        const j = nz * cols + nx;
        if (!g.walkableCell(nx, nz)) continue;
        if (dx && dz) { // no corner cutting
          if (!g.walkableCell(cx + dx, cz) || !g.walkableCell(cx, cz + dz)) continue;
        }
        const nd = d + (dx && dz ? 14 : 10) + this.cost[j];
        if (nd < dist[j]) {
          dist[j] = nd;
          if (tail < q.length) q[tail++] = j;
          else { head = 0; tail = 0; } // overflow guard: should never happen
        }
      }
    }
    this.computeDirections();
    this.built = true;
  }

  computeDirections() {
    const g = this.grid, dist = this.dist, cols = g.cols;
    for (let cz = 0; cz < g.rows; cz++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cz * cols + cx;
        if (dist[i] >= UNREACHED) { this.dirX[i] = 0; this.dirZ[i] = 0; continue; }
        let best = dist[i], bx = 0, bz = 0;
        for (let k = 0; k < 8; k++) {
          const nx = cx + NX[k], nz = cz + NZ[k];
          if (nx < 0 || nz < 0 || nx >= cols || nz >= g.rows) continue;
          const j = nz * cols + nx;
          if (!g.walkableCell(nx, nz)) continue;
          if (NX[k] && NZ[k]) {
            if (!g.walkableCell(cx + NX[k], cz) || !g.walkableCell(cx, cz + NZ[k])) continue;
          }
          if (dist[j] < best) { best = dist[j]; bx = NX[k]; bz = NZ[k]; }
        }
        const len = Math.hypot(bx, bz) || 1;
        this.dirX[i] = bx / len; this.dirZ[i] = bz / len;
      }
    }
  }

  /** Sample the flow direction at a world position into `out`. Returns false if unreachable. */
  sample(x, z, out) {
    const g = this.grid;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (!g.inBounds(cx, cz)) { out.x = 0; out.z = 0; return false; }
    const i = cz * g.cols + cx;
    if (this.dist[i] >= UNREACHED) { out.x = 0; out.z = 0; return false; }
    // Blend with the neighbour cell in the direction of travel for smoothness.
    let dx = this.dirX[i], dz = this.dirZ[i];
    const nx = cx + Math.round(dx), nz = cz + Math.round(dz);
    if (g.inBounds(nx, nz) && g.walkableCell(nx, nz)) {
      const j = nz * g.cols + nx;
      if (this.dist[j] < this.dist[i]) {
        const fx = (x / CELL) - cx, fz = (z / CELL) - cz;
        const w = Math.min(1, Math.abs(fx - 0.5) + Math.abs(fz - 0.5));
        dx = dx * (1 - w * 0.5) + this.dirX[j] * (w * 0.5);
        dz = dz * (1 - w * 0.5) + this.dirZ[j] * (w * 0.5);
      }
    }
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { out.x = 0; out.z = 0; return false; }
    out.x = dx / len; out.z = dz / len;
    return true;
  }

  distanceAt(x, z) {
    const g = this.grid;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (!g.inBounds(cx, cz)) return UNREACHED;
    return this.dist[cz * g.cols + cx];
  }
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class Nav {
  constructor(grid) {
    this.grid = grid;
    this.player = new Field(grid);
    this.flank = new Field(grid);
    this.player.bakeCost(20);
    this.flank.bakeCost(20);
    this._src = new Int32Array(64);
    this.rebuildInterval = 1 / 8;
    this._acc = 999;
    this.rebuilds = 0;
  }

  /** Called every step; rebuilds at 8 Hz or immediately when `force`. */
  update(dt, px, pz, aimX, aimZ, force = false) {
    this._acc += dt;
    if (!force && this._acc < this.rebuildInterval) return;
    this._acc = 0;
    const g = this.grid;
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    if (!g.inBounds(cx, cz)) return;

    this._src[0] = cz * g.cols + cx;
    this.player.build(this._src, 1);

    // Flank sources: walkable cells 7–13 m from the player in the hemisphere
    // opposite the aim vector. If none exist (dead end), fall back to the player.
    let n = 0;
    for (let k = 0; k < 12 && n < this._src.length; k++) {
      const a = (k / 12) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      if (dx * aimX + dz * aimZ > -0.2) continue;   // keep only "behind"
      for (let r = 7; r <= 13; r += 3) {
        const tx = Math.floor((px + dx * r) / CELL), tz = Math.floor((pz + dz * r) / CELL);
        if (!g.inBounds(tx, tz) || !g.walkableCell(tx, tz)) continue;
        this._src[n++] = tz * g.cols + tx;
        break;
      }
    }
    if (n === 0) { this._src[0] = cz * g.cols + cx; n = 1; }
    this.flank.build(this._src, n);
    this.rebuilds++;
  }

  /** Doors changing state invalidate both fields. */
  invalidate() { this._acc = 999; }
}
