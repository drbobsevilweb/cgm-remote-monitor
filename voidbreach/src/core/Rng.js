// CORE / Rng — seeded xorshift128+ with named child streams.
//
// ARCHITECTURE §3.2: subsystems take named child streams so that adding a
// particle call can never shift enemy behaviour. Never use Math.random().

import { hashString, TAU } from './Mathx.js';

export class Rng {
  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
    this.reset();
    this._children = new Map();
  }

  reset() {
    // SplitMix64-ish expansion of the 32-bit seed into 4 non-zero state words.
    let s = this.seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next() || 1; this.s1 = next() || 2;
    this.s2 = next() || 3; this.s3 = next() || 4;
    this.calls = 0;
  }

  /** uint32 */
  u32() {
    this.calls++;
    let t = this.s1 << 9;
    this.s2 ^= this.s0; this.s3 ^= this.s1;
    this.s1 ^= this.s2; this.s0 ^= this.s3; this.s2 ^= t;
    this.s3 = (this.s3 << 11) | (this.s3 >>> 21);
    return (Math.imul(this.s1, 5) >>> 0);
  }

  /** [0,1) */
  next() { return this.u32() / 4294967296; }
  /** [a,b) */
  range(a, b) { return a + (b - a) * this.next(); }
  /** integer [a,b] inclusive */
  int(a, b) { return a + (this.u32() % (b - a + 1)); }
  /** [-1,1] */
  signed() { return this.next() * 2 - 1; }
  bool(p = 0.5) { return this.next() < p; }
  angle() { return this.next() * TAU; }
  pick(arr) { return arr[this.u32() % arr.length]; }

  /** Gaussian-ish via sum of 3 uniforms; cheap and bounded. */
  gauss(sigma = 1) { return ((this.next() + this.next() + this.next()) / 1.5 - 1) * sigma; }

  /** Unit vector into {x,z} of `out`. */
  dir(out) {
    const a = this.angle();
    out.x = Math.cos(a); out.z = Math.sin(a);
    return out;
  }

  /**
   * Named child stream. Deterministic for (parent seed, name); cached so
   * repeated calls return the same stream object.
   */
  child(name) {
    let c = this._children.get(name);
    if (!c) {
      c = new Rng((this.seed ^ hashString(name)) >>> 0 || 1);
      this._children.set(name, c);
    }
    return c;
  }

  /** For end-state hashing in determinism tests. */
  stateHash() {
    return ((this.s0 ^ (this.s1 << 1) ^ (this.s2 << 2) ^ (this.s3 << 3)) >>> 0);
  }
}
