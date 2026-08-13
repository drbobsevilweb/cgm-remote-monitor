import { Sector } from '../src/level/Sector.js';
import { HELIX_DEEP } from '../src/level/sectors/helix_deep.js';
import { C, CELL } from '../src/level/Grid.js';
const s = new Sector(HELIX_DEEP, { emit(){} });
const v = s.validate();
console.log('valid:', v.ok, 'reachable cells:', v.reachableCells);
for (const p of v.problems) console.log('  PROBLEM:', p);
// ASCII dump
const ch = { [C.VOID]:' ', [C.FLOOR]:'.', [C.WALL]:'#', [C.GRATE]:'=', [C.DOOR]:'D', [C.PROP]:'O', [C.VENT]:'V', [C.HAZARD]:'!' };
const g = s.grid;
let out='';
for (let z=0;z<g.rows;z++){ let line='';
  for (let x=0;x<g.cols;x++) line += ch[g.cells[g.idx(x,z)]];
  out += line+'\n'; }
console.log(out);
