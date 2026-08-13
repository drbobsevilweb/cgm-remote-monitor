import { Sector } from '../src/level/Sector.js';
import { HELIX_DEEP } from '../src/level/sectors/helix_deep.js';
import { Field } from '../src/level/Nav.js';
import { CELL } from '../src/level/Grid.js';

const s = new Sector(HELIX_DEEP, { emit(){} });
const g = s.grid;
const f = new Field(g);
f.bakeCost(4);

function fieldFrom(cx, cz, label) {
  g.ignoreLocks = true;
  const src = new Int32Array(1); src[0] = cz * g.cols + cx;
  f.build(src, 1);
  g.ignoreLocks = false;
  const probe = (px, pz, name) => {
    const d = f.dist[pz * g.cols + px];
    console.log(`  from ${label} -> ${name} (${px},${pz}): ${d >= 32000 ? 'UNREACHABLE' : 'dist ' + d}`);
  };
  probe(64, 38, 'proc centre');
  probe(53, 46, 'proc south');
  probe(54, 51, 'procout');
  probe(40, 54, 'coolant mid');
  probe(12, 57, 'pump nest');
  probe(70, 57, 'reactor');
  probe(80, 57, 'exit lift');
}
console.log('walkable checks:');
for (const [x,z,n] of [[12,57,'pump nest'],[54,51,'procout'],[40,54,'coolant'],[64,38,'proc centre'],[80,57,'exit']])
  console.log(`  (${x},${z}) ${n}: walkable=${g.walkableCell(x,z)} cell=${g.cells[g.idx(x,z)]}`);
console.log('\nfield from pump nest:');
fieldFrom(12, 57, 'pumpnest');
console.log('\nfield from exit:');
fieldFrom(80, 57, 'exit');
