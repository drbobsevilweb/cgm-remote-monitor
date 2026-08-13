// ENVIRONMENT / MeshBuilder — accumulates triangles into typed arrays and emits a
// single BufferGeometry. Static world geometry is merged by material so the whole
// sector costs a handful of draw calls (ARCHITECTURE §5).
//
// UVs are authored in WORLD METRES divided by the material's tile size, so one
// shared texture with repeat=1 tiles correctly across every merged surface and no
// mesh needs its own material instance.

import * as THREE from '../../vendor/three.module.js';

export class MeshBuilder {
  constructor(tile = 2.5) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.tile = tile;
    this.color = [1, 1, 1];
    this.uvOffset = [0, 0];
  }

  setColor(r, g, b) { this.color[0] = r; this.color[1] = g; this.color[2] = b; return this; }

  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(this.color[0], this.color[1], this.color[2]);
    return (this.pos.length / 3) - 1;
  }

  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * A floor quad with EXPLICIT UVs rather than world-derived ones.
   *
   * Every other surface in the station wants UVs from world position, so that
   * adjacent merged quads are seamless. A projected pattern is the exception:
   * its orientation is a property of the thing casting it, not of the world
   * axes. A catwalk running north-south throws bars that run east-west, and
   * world-derived UVs cannot express that — they gave every run the same bar
   * direction, which turned half the shadows into solid unbroken bands.
   */
  addFloorQuadUV(x0, z0, x1, z1, y, u0, v0, u1, v1) {
    const a = this.vert(x0, y, z1, 0, 1, 0, u0, v1);
    const b = this.vert(x1, y, z1, 0, 1, 0, u1, v1);
    const c = this.vert(x1, y, z0, 0, 1, 0, u1, v0);
    const d = this.vert(x0, y, z0, 0, 1, 0, u0, v0);
    this.quad(a, b, c, d);
  }

  /**
   * A free quad from four explicit corners, UV-mapped 0..1 rather than by world
   * position. Used for things whose texture is a shape rather than a surface —
   * a light shaft is narrow at the fixture and wide at the deck, and its
   * gradient has to run top-to-bottom regardless of how long the drop is.
   *
   * Corner order is (topLeft, topRight, bottomLeft, bottomRight); V=0 is the top
   * so the texture reads the way it was drawn.
   */
  addTaperedQuad(tlx, tly, tlz, trx, trY, trz, blx, bly, blz, brx, bry, brz) {
    // One shared normal: these are unlit surfaces, but a zero normal upsets
    // three's bounding/attribute handling, so give them something sane.
    const ux = trx - tlx, uz = trz - tlz;
    const len = Math.hypot(ux, uz) || 1;
    const nx = -uz / len, nz = ux / len;
    const a = this.vert(tlx, tly, tlz, nx, 0, nz, 0, 0);
    const b = this.vert(trx, trY, trz, nx, 0, nz, 1, 0);
    const c = this.vert(brx, bry, brz, nx, 0, nz, 1, 1);
    const d = this.vert(blx, bly, blz, nx, 0, nz, 0, 1);
    this.quad(a, b, c, d);
  }

  /**
   * Axis-aligned quad. `axis`: 'y' (floor/ceiling), 'x', 'z'.
   * UVs derive from world position so adjacent quads are seamless.
   */
  addQuad(x0, y0, z0, x1, y1, z1, nx, ny, nz, uvScale = 1) {
    const t = this.tile / uvScale;
    let a, b, c, d;
    if (ny !== 0) {
      const y = y0;
      const u0 = x0 / t, u1 = x1 / t, v0 = z0 / t, v1 = z1 / t;
      // Winding must match the shading normal or the face is back-face culled.
      // For an up-facing quad the vertices run x0z1 -> x1z1 -> x1z0 -> x0z0, which
      // gives (v1-v0) x (v2-v0) = +Y.
      if (ny > 0) {
        a = this.vert(x0, y, z1, 0, ny, 0, u0, v1);
        b = this.vert(x1, y, z1, 0, ny, 0, u1, v1);
        c = this.vert(x1, y, z0, 0, ny, 0, u1, v0);
        d = this.vert(x0, y, z0, 0, ny, 0, u0, v0);
      } else {
        a = this.vert(x0, y, z0, 0, ny, 0, u0, v0);
        b = this.vert(x1, y, z0, 0, ny, 0, u1, v0);
        c = this.vert(x1, y, z1, 0, ny, 0, u1, v1);
        d = this.vert(x0, y, z1, 0, ny, 0, u0, v1);
      }
    } else if (nx !== 0) {
      const x = x0;
      const u0 = z0 / t, u1 = z1 / t, v0 = y0 / t, v1 = y1 / t;
      if (nx > 0) {
        a = this.vert(x, y0, z1, nx, 0, 0, u1, v0);
        b = this.vert(x, y0, z0, nx, 0, 0, u0, v0);
        c = this.vert(x, y1, z0, nx, 0, 0, u0, v1);
        d = this.vert(x, y1, z1, nx, 0, 0, u1, v1);
      } else {
        a = this.vert(x, y0, z0, nx, 0, 0, u0, v0);
        b = this.vert(x, y0, z1, nx, 0, 0, u1, v0);
        c = this.vert(x, y1, z1, nx, 0, 0, u1, v1);
        d = this.vert(x, y1, z0, nx, 0, 0, u0, v1);
      }
    } else {
      const z = z0;
      const u0 = x0 / t, u1 = x1 / t, v0 = y0 / t, v1 = y1 / t;
      if (nz > 0) {
        a = this.vert(x0, y0, z, 0, 0, nz, u0, v0);
        b = this.vert(x1, y0, z, 0, 0, nz, u1, v0);
        c = this.vert(x1, y1, z, 0, 0, nz, u1, v1);
        d = this.vert(x0, y1, z, 0, 0, nz, u0, v1);
      } else {
        a = this.vert(x1, y0, z, 0, 0, nz, u1, v0);
        b = this.vert(x0, y0, z, 0, 0, nz, u0, v0);
        c = this.vert(x0, y1, z, 0, 0, nz, u0, v1);
        d = this.vert(x1, y1, z, 0, 0, nz, u1, v1);
      }
    }
    this.quad(a, b, c, d);
  }

  /** Axis-aligned box by min/max, optionally skipping faces via a mask string. */
  addBox(x0, y0, z0, x1, y1, z1, uvScale = 1, skip = '') {
    if (!skip.includes('+y')) this.addQuad(x0, y1, z0, x1, y1, z1, 0, 1, 0, uvScale);
    if (!skip.includes('-y')) this.addQuad(x0, y0, z0, x1, y0, z1, 0, -1, 0, uvScale);
    if (!skip.includes('+x')) this.addQuad(x1, y0, z0, x1, y1, z1, 1, 0, 0, uvScale);
    if (!skip.includes('-x')) this.addQuad(x0, y0, z0, x0, y1, z1, -1, 0, 0, uvScale);
    if (!skip.includes('+z')) this.addQuad(x0, y0, z1, x1, y1, z1, 0, 0, 1, uvScale);
    if (!skip.includes('-z')) this.addQuad(x0, y0, z0, x1, y1, z0, 0, 0, -1, uvScale);
  }

  /** Rotated box around Y, centred at (cx,cz). Used for props that are not grid aligned. */
  addBoxRot(cx, cy, cz, hx, hy, hz, rot, uvScale = 1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * hx, ly = sy * hy, lz = sz * hz;
      corners.push([cx + lx * c - lz * s, cy + ly, cz + lx * s + lz * c]);
    }
    // index: (sx,sy,sz) -> sx*4 + sy*2 + sz with -1 -> 0
    const P = (sx, sy, sz) => corners[((sx + 1) / 2) * 4 + ((sy + 1) / 2) * 2 + ((sz + 1) / 2)];
    const t = this.tile / uvScale;
    const face = (p0, p1, p2, p3, nx, ny, nz, w, h) => {
      const a = this.vert(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
      const b = this.vert(p1[0], p1[1], p1[2], nx, ny, nz, w / t, 0);
      const cc = this.vert(p2[0], p2[1], p2[2], nx, ny, nz, w / t, h / t);
      const d = this.vert(p3[0], p3[1], p3[2], nx, ny, nz, 0, h / t);
      this.quad(a, b, cc, d);
    };
    const nx = [c, 0, s], nz = [-s, 0, c];
    face(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), 0, 1, 0, hx * 2, hz * 2);
    face(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), 0, -1, 0, hx * 2, hz * 2);
    face(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), nx[0], 0, nx[2], hz * 2, hy * 2);
    face(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), -nx[0], 0, -nx[2], hz * 2, hy * 2);
    face(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), nz[0], 0, nz[2], hx * 2, hy * 2);
    face(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), -nz[0], 0, -nz[2], hx * 2, hy * 2);
  }

  /** Cylinder along Y (pipes, silos, tanks). */
  addCylinder(cx, cy, cz, r, h, segments = 12, capTop = true, capBottom = false, uvScale = 1) {
    const t = this.tile / uvScale;
    const base = this.pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      const u = (a * r) / t;
      this.vert(cx + nx * r, cy, cz + nz * r, nx, 0, nz, u, 0);
      this.vert(cx + nx * r, cy + h, cz + nz * r, nx, 0, nz, u, h / t);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2, b = base + i * 2 + 1;
      this.idx.push(a, b, b + 2, a, b + 2, a + 2);
    }
    if (capTop) {
      const cIdx = this.vert(cx, cy + h, cz, 0, 1, 0, 0.5, 0.5);
      const ring = this.pos.length / 3;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        this.vert(cx + Math.cos(a) * r, cy + h, cz + Math.sin(a) * r, 0, 1, 0,
          (cx + Math.cos(a) * r) / t, (cz + Math.sin(a) * r) / t);
      }
      for (let i = 0; i < segments; i++) this.idx.push(cIdx, ring + i + 1, ring + i);
    }
    if (capBottom) {
      const cIdx = this.vert(cx, cy, cz, 0, -1, 0, 0.5, 0.5);
      const ring = this.pos.length / 3;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        this.vert(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, 0, -1, 0,
          (cx + Math.cos(a) * r) / t, (cz + Math.sin(a) * r) / t);
      }
      for (let i = 0; i < segments; i++) this.idx.push(cIdx, ring + i, ring + i + 1);
    }
  }

  /** Horizontal cylinder along an arbitrary XZ direction (pipe runs, trunks). */
  addPipe(x0, y0, z0, x1, y1, z1, r, segments = 8, uvScale = 1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / len, ay = dy / len, az = dz / len;
    // build an orthonormal basis
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ay) > 0.9) { ux = 1; uy = 0; uz = 0; }
    let bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
    const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz2 = ax * by - ay * bx;
    const t = this.tile / uvScale;
    const base = this.pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const s = Math.sin(a), co = Math.cos(a);
      const nx = bx * co + cx * s, ny = by * co + cy * s, nz = bz * co + cz2 * s;
      const u = (a * r) / t;
      this.vert(x0 + nx * r, y0 + ny * r, z0 + nz * r, nx, ny, nz, u, 0);
      this.vert(x1 + nx * r, y1 + ny * r, z1 + nz * r, nx, ny, nz, u, len / t);
    }
    for (let i = 0; i < segments; i++) {
      // The (b, c) basis built above is left-handed with respect to the axis, so
      // this ring winds the opposite way to addCylinder's.
      const a = base + i * 2, b = base + i * 2 + 1;
      this.idx.push(a, b + 2, b, a, a + 2, b + 2);
    }
  }

  get triangleCount() { return this.idx.length / 3; }
  get isEmpty() { return this.idx.length === 0; }

  build(name = '') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    // Index width is decided by the VERTEX count, not the index count: a merged
    // room easily exceeds 65535 vertices and a 16-bit index silently wraps.
    const vertexCount = this.pos.length / 3;
    g.setIndex(vertexCount > 65535
      ? new THREE.Uint32BufferAttribute(this.idx, 1)
      : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.name = name;
    return g;
  }
}
