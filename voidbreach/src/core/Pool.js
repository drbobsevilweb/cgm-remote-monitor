// CORE / FreeList + SpatialHash — allocation-free structures for the hot loop.

/**
 * FreeList — index allocator for Struct-of-Arrays storage.
 * alloc() returns an index or -1; free(i) returns it. `active` lists live indices
 * in an unspecified order and is stable during a single iteration if nothing is freed.
 */
export class FreeList {
  constructor(capacity) {
    this.capacity = capacity;
    this.free = new Int32Array(capacity);
    this.slot = new Int32Array(capacity).fill(-1); // index -> position in active
    this.active = new Int32Array(capacity);
    this.count = 0;
    this.freeCount = capacity;
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
  }

  alloc() {
    if (this.freeCount === 0) return -1;
    const i = this.free[--this.freeCount];
    this.slot[i] = this.count;
    this.active[this.count++] = i;
    return i;
  }

  release(i) {
    const pos = this.slot[i];
    if (pos < 0) return false;
    const last = this.active[--this.count];
    this.active[pos] = last;
    this.slot[last] = pos;
    this.slot[i] = -1;
    this.free[this.freeCount++] = i;
    return true;
  }

  isActive(i) { return this.slot[i] >= 0; }

  clear() {
    this.count = 0; this.freeCount = this.capacity;
    this.slot.fill(-1);
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
  }
}

/**
 * SpatialHash — uniform grid over the XZ plane, rebuilt per step with a counting
 * sort. Zero allocation after construction.
 */
export class SpatialHash {
  constructor(minX, minZ, maxX, maxZ, cellSize, capacity) {
    this.minX = minX; this.minZ = minZ;
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
    const n = this.cols * this.rows;
    this.start = new Int32Array(n + 1);
    this.counts = new Int32Array(n);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
    this.capacity = capacity;
    this.result = new Int32Array(256);
    this.resultCount = 0;
  }

  cellIndex(x, z) {
    let cx = ((x - this.minX) / this.cell) | 0;
    let cz = ((z - this.minZ) / this.cell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cz < 0) cz = 0; else if (cz >= this.rows) cz = this.rows - 1;
    return cz * this.cols + cx;
  }

  /** Rebuild from SoA positions. `ids` is the active index list of length `count`. */
  build(ids, count, px, pz) {
    this.counts.fill(0);
    for (let k = 0; k < count; k++) {
      const i = ids[k];
      const c = this.cellIndex(px[i], pz[i]);
      this.cellOf[i] = c;
      this.counts[c]++;
    }
    let acc = 0;
    for (let c = 0; c < this.counts.length; c++) {
      this.start[c] = acc; acc += this.counts[c];
    }
    this.start[this.counts.length] = acc;
    // reuse counts as write cursors
    for (let c = 0; c < this.counts.length; c++) this.counts[c] = this.start[c];
    for (let k = 0; k < count; k++) {
      const i = ids[k];
      this.items[this.counts[this.cellOf[i]]++] = i;
    }
    this.total = count;
  }

  /** Query a radius; fills this.result / this.resultCount (capped). */
  query(x, z, radius) {
    const r = Math.max(1, Math.ceil(radius / this.cell));
    let cx = ((x - this.minX) / this.cell) | 0;
    let cz = ((z - this.minZ) / this.cell) | 0;
    this.resultCount = 0;
    const cap = this.result.length;
    for (let dz = -r; dz <= r; dz++) {
      const zz = cz + dz;
      if (zz < 0 || zz >= this.rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= this.cols) continue;
        const c = zz * this.cols + xx;
        const s = this.start[c], e = this.start[c + 1];
        for (let k = s; k < e; k++) {
          if (this.resultCount >= cap) return this.resultCount;
          this.result[this.resultCount++] = this.items[k];
        }
      }
    }
    return this.resultCount;
  }
}

/** Ring buffer of numbers for percentile statistics (profiler). */
export class Ring {
  constructor(n) { this.buf = new Float32Array(n); this.n = n; this.i = 0; this.filled = 0; this._sorted = new Float32Array(n); }
  push(v) { this.buf[this.i] = v; this.i = (this.i + 1) % this.n; if (this.filled < this.n) this.filled++; }
  percentile(p) {
    if (!this.filled) return 0;
    const s = this._sorted.subarray(0, this.filled);
    s.set(this.buf.subarray(0, this.filled));
    Array.prototype.sort.call(s, (a, b) => a - b);
    return s[Math.min(this.filled - 1, Math.floor(p * this.filled))];
  }
  max() { let m = 0; for (let i = 0; i < this.filled; i++) if (this.buf[i] > m) m = this.buf[i]; return m; }
  mean() { let s = 0; for (let i = 0; i < this.filled; i++) s += this.buf[i]; return this.filled ? s / this.filled : 0; }
  clear() { this.i = 0; this.filled = 0; }
}
