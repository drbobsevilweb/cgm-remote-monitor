// LEVEL / Grid — the collision + navigation substrate.
//
// The world is a 2.5 m cell grid on XZ. World origin is the grid origin, so
// world = cell * CELL. Everything physical in the game is a circle that cannot
// enter a solid cell; that is the entire physics vocabulary (ARCHITECTURE §1).

export const CELL = 2.5;

export const C = {
  VOID: 0,     // nothing — outside the station, or an open pit below a catwalk
  FLOOR: 1,    // deck plate
  WALL: 2,     // structure
  GRATE: 3,    // walkable grating over a void (DIRECTION §6)
  DOOR: 4,     // dynamic; solid while closed
  PROP: 5,     // machinery footprint — solid, but visually a machine not a wall
  VENT: 6,     // wall vent: solid to the player, enemy spawn surface
  HAZARD: 7,   // walkable but harmful (exposed conduit, coolant scald)
};

const WALKABLE = new Uint8Array(8);
WALKABLE[C.FLOOR] = 1; WALKABLE[C.GRATE] = 1; WALKABLE[C.HAZARD] = 1; WALKABLE[C.DOOR] = 1;

export class Grid {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.n = cols * rows;
    this.cells = new Uint8Array(this.n);          // C.*
    this.zone = new Uint8Array(this.n).fill(255); // room id per cell
    this.doorId = new Int16Array(this.n).fill(-1);
    this.doorOpen = new Uint8Array(64);           // per door id
    this.doorLocked = new Uint8Array(64);         // per door id
    this.ignoreLocks = false;                     // validation only
    this.width = cols * CELL;
    this.depth = rows * CELL;
  }

  idx(cx, cz) { return cz * this.cols + cx; }
  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows; }
  cellAtWorld(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (!this.inBounds(cx, cz)) return C.VOID;
    return this.cells[cz * this.cols + cx];
  }
  zoneAtWorld(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (!this.inBounds(cx, cz)) return 255;
    return this.zone[cz * this.cols + cx];
  }

  set(cx, cz, v) { if (this.inBounds(cx, cz)) this.cells[cz * this.cols + cx] = v; }

  fill(cx, cz, w, h, v) {
    for (let z = cz; z < cz + h; z++) {
      if (z < 0 || z >= this.rows) continue;
      for (let x = cx; x < cx + w; x++) {
        if (x < 0 || x >= this.cols) continue;
        this.cells[z * this.cols + x] = v;
      }
    }
  }

  /** Solid for movement. Doors are solid until opened. */
  solid(cx, cz) {
    if (!this.inBounds(cx, cz)) return true;
    const i = cz * this.cols + cx;
    const c = this.cells[i];
    if (c === C.DOOR) {
      const d = this.doorId[i];
      return d < 0 ? false : !this.doorOpen[d];
    }
    return !WALKABLE[c];
  }

  /**
   * Walkable for *navigation*. Unlocked doors count as walkable even while
   * closed (they cycle open for anything that walks up to them); locked doors do
   * not, so the horde never paths into a door it cannot pass.
   */
  walkableCell(cx, cz) {
    if (!this.inBounds(cx, cz)) return false;
    const i = cz * this.cols + cx;
    const c = this.cells[i];
    if (c === C.DOOR && !this.ignoreLocks) {
      const d = this.doorId[i];
      return d < 0 || !this.doorLocked[d];
    }
    return WALKABLE[c] === 1;
  }

  solidAtWorld(x, z) { return this.solid(Math.floor(x / CELL), Math.floor(z / CELL)); }

  /**
   * Push a circle out of solid cells. Writes into `out` {x,z,hitX,hitZ}.
   * Axis-separated resolution against cell AABBs — stable at corners and cheap.
   */
  resolveCircle(x, z, r, out) {
    let nx = x, nz = z;
    let hitX = 0, hitZ = 0;
    const cx0 = Math.floor((nx - r) / CELL), cx1 = Math.floor((nx + r) / CELL);
    const cz0 = Math.floor((nz - r) / CELL), cz1 = Math.floor((nz + r) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.solid(cx, cz)) continue;
        const minX = cx * CELL, maxX = minX + CELL;
        const minZ = cz * CELL, maxZ = minZ + CELL;
        const qx = nx < minX ? minX : nx > maxX ? maxX : nx;
        const qz = nz < minZ ? minZ : nz > maxZ ? maxZ : nz;
        let dx = nx - qx, dz = nz - qz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const push = r - d;
          nx += (dx / d) * push; nz += (dz / d) * push;
          hitX += (dx / d) * push; hitZ += (dz / d) * push;
        } else {
          // centre inside the cell: push out along the shallowest axis
          const toL = nx - minX, toR = maxX - nx, toT = nz - minZ, toB = maxZ - nz;
          const m = Math.min(toL, toR, toT, toB);
          if (m === toL) nx = minX - r; else if (m === toR) nx = maxX + r;
          else if (m === toT) nz = minZ - r; else nz = maxZ + r;
        }
      }
    }
    out.x = nx; out.z = nz; out.hitX = hitX; out.hitZ = hitZ;
    out.hit = (hitX !== 0 || hitZ !== 0);
    return out;
  }

  /**
   * DDA ray against solid cells. Returns hit distance in world units or -1.
   * Fills `out` with {x,z,nx,nz,cell} at the hit point.
   */
  ray(ox, oz, dx, dz, maxDist, out) {
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const invDz = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL)) * invDx : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL)) * invDz : Infinity;
    const tDeltaX = CELL * invDx, tDeltaZ = CELL * invDz;
    let t = 0, axis = 0;
    for (let guard = 0; guard < 512; guard++) {
      if (this.solid(cx, cz)) {
        if (out) {
          out.x = ox + dx * t; out.z = oz + dz * t;
          out.nx = axis === 0 ? -stepX : 0; out.nz = axis === 1 ? -stepZ : 0;
          out.cell = this.inBounds(cx, cz) ? this.cells[cz * this.cols + cx] : C.WALL;
          out.cx = cx; out.cz = cz;
        }
        return t;
      }
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; axis = 0; }
      else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; axis = 1; }
      if (t > maxDist) return -1;
    }
    return -1;
  }

  lineOfSight(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return true;
    const t = this.ray(ax, az, dx / len, dz / len, len, null);
    return t < 0 || t >= len - 0.01;
  }

  /** Connectivity check used by the level self-test. */
  floodReachable(startCx, startCz) {
    const seen = new Uint8Array(this.n);
    const queue = new Int32Array(this.n);
    let head = 0, tail = 0, count = 0;
    const s = startCz * this.cols + startCx;
    queue[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const i = queue[head++]; count++;
      const cx = i % this.cols, cz = (i / this.cols) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!this.inBounds(nx, nz)) continue;
        const j = nz * this.cols + nx;
        if (seen[j]) continue;
        const c = this.cells[j];
        if (!WALKABLE[c]) continue;   // doors count as passable for reachability
        seen[j] = 1; queue[tail++] = j;
      }
    }
    return { seen, count };
  }
}
