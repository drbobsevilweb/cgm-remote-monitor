// QA / geometry invariants.
//
// Guards the class of bug that cost the most time during the lighting stage: a
// quad whose winding disagreed with its shading normal, so every floor in the
// station was back-face culled and the scene looked "underlit" rather than
// "missing". This is the kind of failure a screenshot cannot diagnose, so it
// gets an invariant instead.
//
// Rule: for every triangle, the geometric normal from the winding
// (v1-v0) x (v2-v0) must point the same way as the interpolated shading normal.

import { MeshBuilder } from '../src/environment/MeshBuilder.js';

let failures = 0;
let checked = 0;

function checkGeometry(label, geom) {
  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  const idx = geom.getIndex();
  let bad = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    const len = Math.hypot(gx, gy, gz);
    if (len < 1e-9) continue;                   // degenerate, ignore
    const sx = nrm.getX(i0), sy = nrm.getY(i0), sz = nrm.getZ(i0);
    const dot = (gx / len) * sx + (gy / len) * sy + (gz / len) * sz;
    checked++;
    if (dot < 0.2) bad++;
  }
  if (bad > 0) {
    failures++;
    console.log(`  FAIL ${label}: ${bad} triangles wound against their normal`);
  } else {
    console.log(`  ok   ${label}: ${idx.count / 3} triangles`);
  }
}

console.log('geometry winding invariants');

// Every face direction of the primitive vocabulary.
const b = new MeshBuilder();
b.addQuad(0, 0, 0, 2, 0, 2, 0, 1, 0, 1);       // floor
b.addQuad(0, 3, 0, 2, 3, 2, 0, -1, 0, 1);      // ceiling
b.addQuad(2, 0, 0, 2, 3, 2, -1, 0, 0, 1);      // wall -x
b.addQuad(0, 0, 0, 0, 3, 2, 1, 0, 0, 1);       // wall +x
b.addQuad(0, 0, 2, 2, 3, 2, 0, 0, -1, 1);      // wall -z
b.addQuad(0, 0, 0, 2, 3, 0, 0, 0, 1, 1);       // wall +z
checkGeometry('addQuad (all 6 directions)', b.build());

const box = new MeshBuilder();
box.addBox(-1, 0, -1, 1, 2, 1, 1);
checkGeometry('addBox', box.build());

const rot = new MeshBuilder();
rot.addBoxRot(5, 1, 5, 1.5, 1, 0.8, 0.7, 1);
rot.addBoxRot(0, 1, 0, 1, 1, 1, 0, 1);
checkGeometry('addBoxRot', rot.build());

const cyl = new MeshBuilder();
cyl.addCylinder(0, 0, 0, 1, 3, 12, true, true, 1);
checkGeometry('addCylinder', cyl.build());

const pipe = new MeshBuilder();
pipe.addPipe(0, 2, 0, 6, 2, 3, 0.2, 8, 1);
checkGeometry('addPipe', pipe.build());

// Index width: a merged room routinely exceeds 65535 vertices, and a 16-bit
// index silently wraps into garbage geometry.
const big = new MeshBuilder();
for (let i = 0; i < 3000; i++) big.addBox(i, 0, 0, i + 0.5, 1, 1, 1);
const bigGeom = big.build();
const verts = bigGeom.getAttribute('position').count;
const is32 = bigGeom.getIndex().array.BYTES_PER_ELEMENT === 4;
if (verts > 65535 && !is32) { console.log(`  FAIL index width: ${verts} vertices with 16-bit indices`); failures++; }
else console.log(`  ok   index width: ${verts} vertices -> ${is32 ? 32 : 16}-bit indices`);

console.log(failures === 0
  ? `PASS (${checked} triangles checked)`
  : `FAIL (${failures} problems)`);
process.exit(failures === 0 ? 0 : 1);
