// LEVEL / Sector data — HELIX DEEP, DECK 7: "ARRIVAL AND PROCESSING"
//
// Authored, not generated. Every space has a job it did before the Chorus arrived
// (DIRECTION §3). Coordinates are grid cells (2.5 m). Grid is 50 x 72 = 125 x 180 m.
//
// LINEAR BY CONSTRUCTION. The old map was a ring with loops and alternates, and
// loops are why a player asks "where am I supposed to go". This one is a chain:
//
//   ARRIVAL -> corridor -> BAY A (1) -> corridor -> BAY B (2) -> corridor ->
//   [ CELL C (1)  ||  STORES D (0, supplies) ] -> corridor -> REACTOR FLOOR (4 + matriarch) -> LIFT
//
// One direction, escalating. The only branch is C-or-D, and both sides rejoin
// immediately: C is the fight, D is the quiet route with the supplies on it. You
// can take both, in either order, and you always end up at the same door.
//
// Sections seal behind you (see `sections` at the bottom). That is a deliberate
// loss of freedom: it means the player never has to wonder whether the thing
// they want is behind them, and it means pressure is always in front.
//
// Difficulty is carried by HOW MANY SOURCES ARE LIVE AT ONCE, not by tougher
// individuals. Bay A is one. Bay B is two. The reactor floor is four and the
// matriarch. Nothing is crowded on the first level; the escalation is legible
// because it is countable.

export const HELIX_DEEP = {
  id: 'helix_deep_7',
  name: 'HELIX DEEP // DECK 7',
  cols: 50,
  rows: 72,

  // --- SPACES ------------------------------------------------------------
  // kind drives geometry, materials, props and lighting in ENVIRONMENT.
  // Rooms that touch are connected; no explicit carve pass is needed.
  rooms: [
    // S1 — arrival
    { id: 'dock',   name: 'ARRIVAL DECK 7-A',    kind: 'dock',       x: 3,  z: 3,  w: 9,  h: 7,  ceil: 5.5, tone: 'amber' },
    { id: 'c_a',    name: 'DOCK SPINE',          kind: 'corridor',   x: 12, z: 5,  w: 11, h: 3,  ceil: 3.2, tone: 'amber' },

    // S2 — first chamber
    { id: 'bay_a',  name: 'CARGO BAY A',         kind: 'hall',       x: 23, z: 2,  w: 13, h: 11, ceil: 6.5, tone: 'amber' },

    // S3 — descent
    { id: 'c_b',    name: 'TRANSFER 7-N',        kind: 'corridor',   x: 28, z: 13, w: 3,  h: 8,  ceil: 3.0, tone: 'dim'   },
    { id: 'c_c',    name: 'CONVEYOR RUN',        kind: 'corridor',   x: 28, z: 21, w: 13, h: 3,  ceil: 3.2, tone: 'dim'   },

    // S4 — second chamber
    { id: 'bay_b',  name: 'ORE PROCESSING',      kind: 'processing', x: 33, z: 24, w: 14, h: 14, ceil: 8.0, tone: 'amber' },

    // S5 — the split
    { id: 'c_d',    name: 'SLURRY DOWNCOMER',    kind: 'corridor',   x: 37, z: 38, w: 3,  h: 6,  ceil: 3.2, tone: 'dim'   },
    { id: 'c_e',    name: 'COOLANT WALK 7-D',    kind: 'coolant',    x: 22, z: 44, w: 18, h: 3,  ceil: 3.4, tone: 'dark'  },
    { id: 'c_f',    name: 'STORES ACCESS',       kind: 'corridor',   x: 40, z: 44, w: 3,  h: 3,  ceil: 3.0, tone: 'cyan'  },
    { id: 'bay_c',  name: 'PUMP CELL 7-D',       kind: 'pump',       x: 18, z: 47, w: 10, h: 9,  ceil: 5.0, tone: 'dark'  },
    { id: 'bay_d',  name: 'STORES 7-D',          kind: 'office',     x: 36, z: 47, w: 10, h: 9,  ceil: 3.4, tone: 'cyan'  },

    // S6 — converge and finish
    { id: 'c_g',    name: 'PUMP OUTFALL',        kind: 'corridor',   x: 21, z: 56, w: 3,  h: 5,  ceil: 3.0, tone: 'dark'  },
    { id: 'c_h',    name: 'STORES OUTFALL',      kind: 'corridor',   x: 39, z: 56, w: 3,  h: 5,  ceil: 3.0, tone: 'dim'   },
    { id: 'bay_e',  name: 'REACTOR FLOOR 7-C',   kind: 'reactor',    x: 14, z: 61, w: 29, h: 8,  ceil: 7.5, tone: 'sodium'},
    { id: 'c_lift', name: 'EXTRACTION LOCK',     kind: 'corridor',   x: 43, z: 63, w: 5,  h: 4,  ceil: 4.0, tone: 'cyan'  },
  ],

  // --- STRUCTURAL FEATURES ----------------------------------------------
  // Open voids with real grating over them (DIRECTION §6). `pit` is the hole,
  // `grate` are the catwalks that cross it.
  pits: [
    { room: 'bay_b', x: 37, z: 27, w: 8, h: 9, depth: 4.2 },
    { room: 'bay_c', x: 20, z: 49, w: 6, h: 5, depth: 3.4 },
    { room: 'bay_e', x: 20, z: 63, w: 8, h: 4, depth: 3.8 },
  ],
  grates: [
    // Processing: catwalks over the ore void — the signature space.
    { x: 37, z: 30, w: 8,  h: 3 },
    { x: 40, z: 27, w: 3,  h: 9 },
    // Coolant walk runs entirely on grating; it is also the dark stretch.
    { x: 22, z: 44, w: 18, h: 3 },
    // Pump cell sump.
    { x: 20, z: 50, w: 6,  h: 3 },
    // Reactor floor drainage.
    { x: 20, z: 64, w: 8,  h: 3 },
  ],

  // --- DOORS -------------------------------------------------------------
  // kind: 'bulkhead' (two-leaf, pressure), 'service' (single slide)
  //
  // `sealOn` welds the door permanently shut when that section becomes active.
  // That is what makes the level linear rather than merely linear-shaped.
  doors: [
    { id: 'd_a',  kind: 'service',  x: 22, z: 5,  w: 1, h: 3, axis: 'x', room: 'c_a',
      sealOn: 's3', label: 'DOCK SPINE' },
    { id: 'd_b',  kind: 'service',  x: 28, z: 12, w: 3, h: 1, axis: 'z', room: 'bay_a',
      locked: true, unlockOn: 'section:s2', label: 'TRANSFER 7-N' },
    { id: 'd_c',  kind: 'bulkhead', x: 36, z: 23, w: 3, h: 1, axis: 'z', room: 'c_c',
      sealOn: 's5', label: 'PROCESSING' },
    { id: 'd_d',  kind: 'service',  x: 37, z: 37, w: 3, h: 1, axis: 'z', room: 'bay_b',
      locked: true, unlockOn: 'section:s4', label: 'DOWNCOMER' },
    { id: 'd_e',  kind: 'service',  x: 21, z: 46, w: 3, h: 1, axis: 'z', room: 'c_e',
      label: 'PUMP CELL 7-D' },
    { id: 'd_f',  kind: 'service',  x: 40, z: 46, w: 3, h: 1, axis: 'z', room: 'c_f',
      label: 'STORES 7-D' },
    { id: 'd_g',  kind: 'bulkhead', x: 21, z: 55, w: 3, h: 1, axis: 'z', room: 'bay_c',
      locked: true, unlockOn: 'section:s5', label: 'PRESSURE LOCK 7-C' },
    { id: 'd_h',  kind: 'bulkhead', x: 39, z: 55, w: 3, h: 1, axis: 'z', room: 'bay_d',
      locked: true, unlockOn: 'section:s5', label: 'PRESSURE LOCK 7-C' },
    // The lift does not accept you until the floor is purged. Without this the
    // exit sits in the open at the far end of the final fight, and walking onto
    // it ends the run with the matriarch still alive — which is exactly what
    // three seeds did.
    { id: 'd_lift', kind: 'bulkhead', x: 43, z: 63, w: 1, h: 4, axis: 'x', room: 'c_lift',
      locked: true, unlockOn: 'section:s6b', label: 'EXTRACTION LOCK' },
  ],

  // --- INFESTATION -------------------------------------------------------
  // A brood queen is anchored where her chamber was breached. She does not
  // spawn the Chorus directly: she lays eggs, and the eggs hatch. Budget keys:
  //   rate     seconds between eggs
  //   incubate seconds an egg takes to come to term
  //   eggs     unhatched eggs she will keep on the deck at once
  //   max      living children she will keep in the world
  //   clutch   eggs owed by a convulsion (at 2/3 and 1/3 health)
  //   wake     eggs owed on waking
  //   mix      what hatches, sampled per egg
  //
  // type: 'matriarch' (larger, hooded, slower cycle) | 'brooder'
  //
  // ONE in Bay A. TWO in Bay B. FOUR plus the matriarch on the reactor floor.
  // Per-queen budgets shrink as the count rises, so four sources is a busier
  // room rather than four times the pressure — the escalation the player should
  // feel is "there are more of them", not "each one got harder".
  queens: [
    // S2 — the teaching fight. One source, generous budget, nothing else live.
    { id: 'q_a1', type: 'brooder', x: 30, z: 5, room: 'bay_a', hp: 340, face: 'z-',
      budget: { rate: 0.95, incubate: 2.3, eggs: 6, max: 12, clutch: 4, wake: 5,
        mix: ['runner', 'runner', 'runner', 'spitter'] } },

    // S4 — two sources, opposite ends of the ore void. Crossing the catwalk is
    // the decision: whichever one you leave alive is behind you while you work.
    { id: 'q_b1', type: 'brooder', x: 35, z: 29, room: 'bay_b', hp: 320, face: 'z-',
      budget: { rate: 1.15, incubate: 2.4, eggs: 5, max: 9, clutch: 4, wake: 4,
        mix: ['runner', 'runner', 'stalker'] } },
    { id: 'q_b2', type: 'brooder', x: 45, z: 33, room: 'bay_b', hp: 320, face: 'x+',
      budget: { rate: 1.15, incubate: 2.4, eggs: 5, max: 9, clutch: 4, wake: 4,
        mix: ['runner', 'spitter', 'stalker'] } },

    // S5 — one in the pump cell, in the dark. Stores is deliberately empty.
    { id: 'q_c1', type: 'brooder', x: 24, z: 52, room: 'bay_c', hp: 340, face: 'z+',
      budget: { rate: 1.05, incubate: 2.2, eggs: 5, max: 10, clutch: 5, wake: 5,
        mix: ['stalker', 'runner', 'stalker', 'runner'] } },

    // S6 — the reactor floor. Four brooders in the corners and the matriarch in
    // the middle of them. Individually the weakest in the sector; together they
    // are the level.
    { id: 'q_e1', type: 'brooder', x: 17, z: 63, room: 'bay_e', hp: 260, face: 'x-',
      budget: { rate: 2.1, incubate: 2.8, eggs: 2, max: 3, clutch: 2, wake: 2,
        mix: ['runner', 'runner', 'spitter'] } },
    { id: 'q_e2', type: 'brooder', x: 40, z: 63, room: 'bay_e', hp: 260, face: 'x+',
      budget: { rate: 2.1, incubate: 2.8, eggs: 2, max: 3, clutch: 2, wake: 2,
        mix: ['runner', 'runner', 'stalker'] } },
    { id: 'q_e3', type: 'brooder', x: 17, z: 67, room: 'bay_e', hp: 260, face: 'x-',
      budget: { rate: 2.1, incubate: 2.8, eggs: 2, max: 3, clutch: 2, wake: 2,
        mix: ['runner', 'spitter', 'runner'] } },
    { id: 'q_e4', type: 'brooder', x: 40, z: 67, room: 'bay_e', hp: 260, face: 'x+',
      budget: { rate: 2.1, incubate: 2.8, eggs: 2, max: 3, clutch: 2, wake: 2,
        mix: ['runner', 'runner', 'stalker'] } },
    // Dormant until the four are dead. Five live sources at once was measured
    // and it killed every seed: the reactor floor is two fights, not one.
    { id: 'q_e0', type: 'matriarch', x: 29, z: 65, room: 'bay_e', hp: 460, face: 'z+', dormant: true,
      budget: { rate: 1.0, incubate: 2.3, eggs: 6, max: 11, clutch: 5, wake: 5,
        mix: ['runner', 'runner', 'stalker', 'bulwark'] } },
  ],

  // Wall vents: Chorus ingress the player cannot use. Placed to enable flanking
  // from outside the firing arc, never directly on top of the player. Each is a
  // grille with its own health — shoot one out and it is welded shut for good.
  vents: [
    { x: 24, z: 2,  room: 'bay_a', face: 'z-' },
    { x: 34, z: 9,  room: 'bay_a', face: 'x+' },
    { x: 43, z: 24, room: 'bay_b', face: 'z-' },
    { x: 45, z: 30, room: 'bay_b', face: 'x+' },
    { x: 34, z: 36, room: 'bay_b', face: 'x-' },
    { x: 23, z: 45, room: 'c_e',   face: 'z-' },
    { x: 19, z: 48, room: 'bay_c', face: 'x-' },
    { x: 26, z: 54, room: 'bay_c', face: 'z+' },
    { x: 15, z: 62, room: 'bay_e', face: 'x-' },
    { x: 41, z: 62, room: 'bay_e', face: 'z-' },
    { x: 24, z: 68, room: 'bay_e', face: 'z+' },
    { x: 36, z: 68, room: 'bay_e', face: 'z+' },
  ],

  // --- DRESSING ----------------------------------------------------------
  props: [
    // dock: you arrived here, and it is the only place that still looks used
    { t: 'container', x: 4,  z: 4, len: 3 }, { t: 'crate', x: 8, z: 8 },
    { t: 'locker',    x: 10, z: 4 }, { t: 'console', x: 5, z: 8 },
    { t: 'medkit',    x: 9,  z: 6 },

    // c_a
    { t: 'crate', x: 14, z: 6 }, { t: 'barricade', x: 19, z: 5 },

    // bay_a — cargo. Containers give cover and break the queen's sightlines.
    { t: 'container', x: 24, z: 8, len: 4 }, { t: 'container', x: 31, z: 10, len: 3, rot: 1 },
    { t: 'crane', x: 27, z: 3 }, { t: 'crate', x: 33, z: 4 }, { t: 'crate', x: 25, z: 11 },
    { t: 'tank', x: 28, z: 10 }, { t: 'tank', x: 32, z: 3 },
    { t: 'arc', x: 33, z: 7 }, { t: 'coolant', x: 26, z: 4 }, { t: 'medkit', x: 34, z: 11 },
    { t: 'pylon', x: 30, z: 9 },

    // c_b / c_c
    { t: 'crate', x: 29, z: 16 }, { t: 'pylon', x: 29, z: 19 },
    { t: 'coolant', x: 33, z: 22 }, { t: 'barricade', x: 38, z: 21 },

    // bay_b — processing. Mills and silos around the void.
    { t: 'mill', x: 34, z: 25 }, { t: 'silo', x: 44, z: 25 }, { t: 'mill', x: 34, z: 34 },
    { t: 'loader', x: 44, z: 35 }, { t: 'pylon', x: 36, z: 31 }, { t: 'pylon', x: 45, z: 31 },
    { t: 'arc', x: 35, z: 36 }, { t: 'medkit', x: 45, z: 27 }, { t: 'armour', x: 34, z: 30 },
    { t: 'tank', x: 36, z: 25 }, { t: 'tank', x: 45, z: 36 }, { t: 'tank', x: 34, z: 33 },
    { t: 'crate', x: 46, z: 33 },

    // c_d / c_e — the dark walk
    { t: 'pylon', x: 38, z: 40 }, { t: 'crate', x: 38, z: 42 },
    { t: 'coolant', x: 27, z: 45 }, { t: 'flare', x: 32, z: 45 }, { t: 'flare', x: 36, z: 45 },

    // bay_c — pump cell, the dark fight
    { t: 'pump', x: 19, z: 48 }, { t: 'pump', x: 25, z: 48 },
    { t: 'medkit', x: 19, z: 54 }, { t: 'arc', x: 26, z: 48 }, { t: 'crate', x: 22, z: 54 },
    { t: 'tank', x: 27, z: 51 },

    // bay_d — STORES. No queen, and it is where the supplies are. This is the
    // reward for exploring the branch rather than sprinting the critical path.
    { t: 'locker', x: 37, z: 48 }, { t: 'locker', x: 38, z: 48 }, { t: 'locker', x: 39, z: 48 },
    { t: 'medkit', x: 37, z: 51 }, { t: 'armour', x: 40, z: 51 }, { t: 'arc', x: 43, z: 51 },
    { t: 'coolant', x: 44, z: 48 }, { t: 'coolant', x: 37, z: 54 }, { t: 'flare', x: 43, z: 54 },
    { t: 'table', x: 41, z: 49 }, { t: 'crate', x: 44, z: 54 },

    // c_g / c_h
    { t: 'crate', x: 22, z: 58 }, { t: 'crate', x: 40, z: 58 },

    // bay_e — reactor floor
    { t: 'pylon', x: 16, z: 61 }, { t: 'pylon', x: 41, z: 61 },
    { t: 'pylon', x: 16, z: 68 }, { t: 'pylon', x: 41, z: 68 },
    { t: 'silo', x: 30, z: 61 }, { t: 'loader', x: 34, z: 67 },
    { t: 'tank', x: 22, z: 61 }, { t: 'tank', x: 37, z: 61 }, { t: 'tank', x: 26, z: 67 },
    { t: 'medkit', x: 15, z: 65 }, { t: 'medkit', x: 41, z: 65 },
    { t: 'armour', x: 29, z: 61 }, { t: 'coolant', x: 33, z: 62 }, { t: 'arc', x: 26, z: 68 },
    { t: 'lift', x: 45, z: 64 },
  ],

  spawn: { x: 5.5, z: 6.5, facing: 0 },        // cells; facing +x, into the sector
  exit:  { x: 45, z: 64, w: 3, h: 2 },

  // --- PROGRESSION -------------------------------------------------------
  // The level is a chain of sections. Each one states its goal the moment the
  // player enters it, and the way out opens when that goal is met.
  //
  //   clear: 'enter'   the goal is arriving somewhere; cleared on entry
  //          'queens'  every queen in these rooms is dead
  //          'exit'    reach the lift
  //   opens:           doors unlocked when this section clears
  //   sealOn (on the door) welds it behind the player when a section starts
  sections: [
    { id: 's1', name: 'ARRIVAL DECK', rooms: ['dock', 'c_a'],
      objective: 'MOVE INTO CARGO BAY A', clear: 'enter', next: 's2' },

    { id: 's2', name: 'CARGO BAY A', rooms: ['bay_a'],
      objective: 'KILL THE BROOD NODE', clear: 'queens', opens: ['d_b'], next: 's3',
      brief: 'ONE SOURCE. FIND IT.' },

    { id: 's3', name: 'TRANSFER', rooms: ['c_b', 'c_c'],
      objective: 'ADVANCE TO ORE PROCESSING', clear: 'enter', next: 's4' },

    { id: 's4', name: 'ORE PROCESSING', rooms: ['bay_b'],
      objective: 'KILL BOTH BROOD NODES', clear: 'queens', opens: ['d_d'], next: 's5',
      brief: 'TWO SOURCES. ONE IS ALWAYS BEHIND YOU.' },

    { id: 's5', name: 'COOLANT LEVEL', rooms: ['c_d', 'c_e', 'c_f', 'bay_c', 'bay_d'],
      objective: 'CLEAR THE PUMP CELL — STORES 7-D IS OPTIONAL',
      clear: 'queens', opens: ['d_g', 'd_h'], next: 's6',
      brief: 'STORES IS QUIET AND STOCKED. THE PUMP CELL IS NOT.' },

    { id: 's6', name: 'REACTOR FLOOR', rooms: ['c_g', 'c_h', 'bay_e'],
      objective: 'DESTROY THE BROOD NODES — {n} REMAINING', clear: 'queens',
      wakes: ['q_e0'], next: 's6b',
      brief: 'FOUR NODES. SOMETHING LARGER IS NOT MOVING YET.' },

    { id: 's6b', name: 'THE MATRIARCH', rooms: ['bay_e'],
      objective: 'KILL THE MATRIARCH', clear: 'queens', next: 's7',
      brief: 'IT IS AWAKE.' },

    { id: 's7', name: 'EXTRACTION', rooms: ['bay_e', 'c_lift'],
      objective: 'REACH THE LIFT', clear: 'exit' },
  ],

  triggers: [
    { room: 'c_a',   once: true, message: 'CHARTER LOG — 19 DAYS SINCE LAST TRANSMISSION', tone: 'log' },
    { room: 'bay_a', once: true, beat: 'cargo_enter' },
    { room: 'c_e',   once: true, message: 'LIGHTING CIRCUIT 7-D — FAILED', tone: 'warn' },
    { room: 'bay_d', once: true, message: 'STORES 7-D — SEALED SINCE THE BREACH', tone: 'good' },
    { room: 'bay_e', once: true, message: 'REACTOR FLOOR — MULTIPLE MASSES', tone: 'bad' },
  ],
};
