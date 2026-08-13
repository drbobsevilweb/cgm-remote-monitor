// LEVEL / Sector data — HELIX DEEP, DECK 7: "ARRIVAL AND PROCESSING"
//
// Authored, not generated. Every space has a job it did before the Chorus arrived
// (DIRECTION §3). Coordinates are grid cells (2.5 m). Grid is 88 x 64 = 220 x 160 m.
//
// Critical path:
//   DOCK -> SPINE -> CARGO HALL (node 1) -> HAB SPUR -> HABITATION -> LINK ->
//   PROCESSING (nodes 2,3, grating catwalks) -> COOLANT WALK (dark) ->
//   PUMP HOUSE (node 4) -> back east -> [locked bulkhead] -> REACTOR ANTECHAMBER (boss) -> LIFT
//
// Loops and alternates: cargo control + north service trunk (a second way into
// processing), the mess room, and the processing gantry ring. Loops exist so the
// player can retreat and so the Chorus can flank.

export const HELIX_DEEP = {
  id: 'helix_deep_7',
  name: 'HELIX DEEP // DECK 7',
  cols: 88,
  rows: 64,

  // --- SPACES ------------------------------------------------------------
  // kind drives geometry, materials, props and lighting in ENVIRONMENT.
  rooms: [
    { id: 'dock',      name: 'ARRIVAL DECK 7-A',      kind: 'dock',        x: 4,  z: 6,  w: 14, h: 11, ceil: 5.5,  tone: 'amber' },
    { id: 'spine',     name: 'DOCK SPINE',            kind: 'corridor',    x: 18, z: 10, w: 10, h: 4,  ceil: 3.2,  tone: 'amber' },
    { id: 'cargo',     name: 'CARGO HALL A',          kind: 'hall',        x: 28, z: 3,  w: 26, h: 21, ceil: 6.5,  tone: 'amber' },
    { id: 'ctl_link',  name: 'CONTROL ACCESS',        kind: 'corridor',    x: 54, z: 7,  w: 2,  h: 3,  ceil: 3.0,  tone: 'cyan'  },
    { id: 'cargoctl',  name: 'CARGO CONTROL',         kind: 'office',      x: 56, z: 5,  w: 8,  h: 7,  ceil: 3.2,  tone: 'cyan'  },
    { id: 'trunk',     name: 'SERVICE TRUNK 7-N',     kind: 'corridor',    x: 58, z: 12, w: 4,  h: 14, ceil: 3.0,  tone: 'dim'   },
    { id: 'habspur',   name: 'HAB SPUR 7-2',          kind: 'corridor',    x: 37, z: 24, w: 4,  h: 8,  ceil: 3.0,  tone: 'red'   },
    { id: 'hab',       name: 'HABITATION RING 7-2',   kind: 'habitation',  x: 22, z: 32, w: 22, h: 11, ceil: 3.0,  tone: 'red'   },
    { id: 'mess',      name: 'MESS 7-2',              kind: 'office',      x: 15, z: 34, w: 7,  h: 6,  ceil: 3.0,  tone: 'amber' },
    { id: 'link',      name: 'PROCESS ACCESS',        kind: 'corridor',    x: 44, z: 35, w: 6,  h: 4,  ceil: 3.2,  tone: 'dim'   },
    { id: 'proc',      name: 'ORE PROCESSING',        kind: 'processing',  x: 50, z: 26, w: 28, h: 24, ceil: 8.0,  tone: 'amber' },
    { id: 'procout',   name: 'SLURRY DOWNCOMER',      kind: 'corridor',    x: 52, z: 50, w: 4,  h: 2,  ceil: 3.2,  tone: 'dim'   },
    { id: 'coolant',   name: 'COOLANT WALK 7-D',      kind: 'coolant',     x: 20, z: 52, w: 34, h: 5,  ceil: 3.4,  tone: 'dark'  },
    { id: 'pump',      name: 'PUMP HOUSE 7-D',        kind: 'pump',        x: 8,  z: 47, w: 12, h: 13, ceil: 5.0,  tone: 'dark'  },
    { id: 'gate',      name: 'PRESSURE LOCK 7-C',     kind: 'corridor',    x: 54, z: 53, w: 4,  h: 3,  ceil: 3.2,  tone: 'red'   },
    { id: 'reactor',   name: 'REACTOR ANTECHAMBER',   kind: 'reactor',     x: 58, z: 52, w: 24, h: 10, ceil: 7.5,  tone: 'sodium'},
  ],

  // --- STRUCTURAL FEATURES ----------------------------------------------
  // Open voids with real grating over them (DIRECTION §6). `pit` is the hole,
  // `grate` are the catwalks that cross it.
  pits: [
    { room: 'proc', x: 56, z: 31, w: 16, h: 14, depth: 4.2 },
    { room: 'pump', x: 10, z: 50, w: 8,  h: 7,  depth: 3.4 },
  ],
  grates: [
    // Processing: a cross of catwalks over the ore void — the signature space.
    { x: 56, z: 36, w: 16, h: 3 },
    { x: 62, z: 31, w: 3,  h: 14 },
    // Pump house: a single walk over the coolant sump.
    { x: 10, z: 52, w: 8,  h: 3 },
    // Coolant walk runs entirely on grating.
    { x: 20, z: 53, w: 34, h: 3 },
  ],

  // --- DOORS -------------------------------------------------------------
  // kind: 'bulkhead' (two-leaf, pressure), 'service' (single slide)
  doors: [
    { id: 'd_spine',  kind: 'service',  x: 27, z: 10, w: 1, h: 4, axis: 'x', room: 'spine' },
    { id: 'd_ctl',    kind: 'service',  x: 55, z: 7,  w: 1, h: 3, axis: 'x', room: 'cargoctl' },
    // The trunk is the alternate way south. Locked with the hab bulkhead so the
    // first node cannot be skipped; afterwards the player has a real choice of
    // route into Processing (habitation: supplies and space / trunk: fast and blind).
    { id: 'd_trunk',  kind: 'service',  x: 58, z: 12, w: 4, h: 1, axis: 'z', room: 'trunk',
      locked: true, unlockOn: 'nest:n_cargo', label: 'SERVICE TRUNK 7-N' },
    // B1: opens when the cargo node dies — this is the "next route" of the 60 s contract.
    { id: 'd_hab',    kind: 'bulkhead', x: 37, z: 24, w: 4, h: 1, axis: 'z', room: 'habspur',
      locked: true, unlockOn: 'nest:n_cargo', label: 'BULKHEAD 7-2' },
    { id: 'd_mess',   kind: 'service',  x: 22, z: 35, w: 1, h: 3, axis: 'x', room: 'mess' },
    { id: 'd_link',   kind: 'bulkhead', x: 49, z: 35, w: 1, h: 4, axis: 'x', room: 'link', label: 'PROCESS ACCESS' },
    { id: 'd_out',    kind: 'service',  x: 52, z: 50, w: 4, h: 1, axis: 'z', room: 'procout' },
    // B2: the objective lock. Needs the sector purged.
    { id: 'd_gate',   kind: 'bulkhead', x: 57, z: 53, w: 1, h: 3, axis: 'x', room: 'gate',
      locked: true, unlockOn: 'allNests', label: 'PRESSURE LOCK 7-C' },
  ],

  // --- INFESTATION -------------------------------------------------------
  // type: 'brood' (wall-mounted sack) | 'colony' (floor/vent colony)
  nests: [
    // Deliberately tough and fast-breeding: the player must arrive INTO pressure,
    // not clear the room and then poke a sack. Tuned against gates X3/X4/X6.
    { id: 'n_cargo', type: 'brood',  x: 40, z: 4,  room: 'cargo', hp: 430, face: 'z-',
      budget: { rate: 0.8, max: 24, burst: 14, mix: ['runner', 'runner', 'runner', 'spitter'] } },
    { id: 'n_proc_a', type: 'colony', x: 53, z: 29, room: 'proc', hp: 340, face: 'z-',
      budget: { rate: 1.25, max: 16, burst: 4, mix: ['runner', 'runner', 'stalker', 'bulwark'] } },
    { id: 'n_proc_b', type: 'brood',  x: 76, z: 43, room: 'proc', hp: 380, face: 'x+',
      budget: { rate: 1.15, max: 16, burst: 4, mix: ['runner', 'spitter', 'spitter', 'stalker'] } },
    { id: 'n_pump',   type: 'colony', x: 12, z: 57, room: 'pump', hp: 340, face: 'z+',
      budget: { rate: 1.15, max: 11, burst: 5, mix: ['stalker', 'runner', 'stalker', 'runner'] } },
  ],

  // Wall vents: enemy ingress the player cannot use. Placed to enable flanking
  // from outside the firing arc, never directly on top of the player.
  vents: [
    { x: 28, z: 12, room: 'cargo', face: 'x-' },
    { x: 45, z: 23, room: 'cargo', face: 'z+' },
    { x: 53, z: 16, room: 'cargo', face: 'x+' },
    { x: 36, z: 31, room: 'habspur', face: 'x-' },
    { x: 23, z: 42, room: 'hab', face: 'z+' },
    { x: 43, z: 33, room: 'hab', face: 'x+' },
    { x: 51, z: 27, room: 'proc', face: 'x-' },
    { x: 77, z: 30, room: 'proc', face: 'x+' },
    { x: 64, z: 49, room: 'proc', face: 'z+' },
    { x: 33, z: 56, room: 'coolant', face: 'z+' },
    { x: 44, z: 52, room: 'coolant', face: 'z-' },
    { x: 9,  z: 48, room: 'pump', face: 'x-' },
    { x: 19, z: 58, room: 'pump', face: 'x+' },
    { x: 60, z: 61, room: 'reactor', face: 'z+' },
    { x: 81, z: 55, room: 'reactor', face: 'x+' },
  ],

  // --- AUTHORED PROPS ----------------------------------------------------
  // Cargo containers are placed as lanes and chokepoints, not scatter. The two
  // long rows create a firing lane down the middle of the hall and force the
  // swarm to arrive around the ends — the player's first tactical read.
  props: [
    // DOCK — the station explains its job before its catastrophe.
    { t: 'crate',    x: 6,  z: 8,  rot: 0 }, { t: 'crate', x: 6, z: 9, rot: 0 },
    { t: 'crate',    x: 7,  z: 8,  rot: 0 },
    { t: 'pallet',   x: 9,  z: 14 }, { t: 'pallet', x: 12, z: 15 },
    { t: 'console',  x: 15, z: 7,  rot: 3.14 },
    { t: 'sign',     x: 17, z: 12, text: 'CARGO HALL A ->' },
    { t: 'lamp',     x: 8,  z: 7 }, { t: 'lamp', x: 14, z: 13 },
    { t: 'loader',   x: 11, z: 10, rot: 0.5 },

    // SPINE — one shootable lamp, deliberately, as the first "consequence".
    { t: 'lamp',     x: 21, z: 11 }, { t: 'lamp', x: 25, z: 12 },
    { t: 'tray',     x: 18, z: 10, w: 10 },

    // CARGO HALL — container lanes.
    { t: 'container', x: 32, z: 8,  rot: 0, len: 3 },
    { t: 'container', x: 32, z: 12, rot: 0, len: 3 },
    { t: 'container', x: 32, z: 16, rot: 0, len: 3 },
    { t: 'container', x: 44, z: 8,  rot: 0, len: 3 },
    { t: 'container', x: 44, z: 12, rot: 0, len: 3 },
    { t: 'container', x: 44, z: 17, rot: 0, len: 3 },
    { t: 'container', x: 38, z: 20, rot: 1.5708, len: 2, stack: 1 },
    { t: 'crane',     x: 41, z: 10 },
    { t: 'tank',      x: 36, z: 6 },              // beat 5 candidate
    { t: 'tank',      x: 49, z: 21 },
    { t: 'lamp',      x: 31, z: 5 }, { t: 'lamp', x: 41, z: 5 },
    { t: 'lamp',      x: 51, z: 5 }, { t: 'lamp', x: 31, z: 21 },
    { t: 'lamp',      x: 41, z: 22 }, { t: 'lamp', x: 51, z: 21 },
    { t: 'barricade', x: 46, z: 23, rot: 0 },
    { t: 'ammo',      x: 34, z: 21 }, { t: 'medkit', x: 50, z: 8 }, { t: 'ammo', x: 45, z: 6 },
    { t: 'corpse',    x: 47, z: 19, rot: 2.2 },
    { t: 'sign',      x: 39, z: 23, text: 'HAB 7-2' },

    // CARGO CONTROL — the reward for looking sideways.
    { t: 'console',  x: 58, z: 6, rot: 0 }, { t: 'console', x: 60, z: 6, rot: 0 },
    { t: 'ammo',     x: 62, z: 9 }, { t: 'armour', x: 58, z: 10 },
    { t: 'lamp',     x: 60, z: 8 }, { t: 'corpse', x: 61, z: 10, rot: 0.4 },

    // SERVICE TRUNK — dim, narrow, a stalker route.
    { t: 'tray',     x: 58, z: 13, w: 1, h: 12 },
    { t: 'lamp',     x: 60, z: 16 }, { t: 'lamp', x: 59, z: 23 },

    // HAB SPUR — the tank on the critical path (replay beat 5).
    { t: 'tank',     x: 39, z: 29 },
    { t: 'barricade', x: 37, z: 27, rot: 0 },
    { t: 'lamp',     x: 38, z: 26 },
    { t: 'corpse',   x: 38, z: 30, rot: 1.1 },

    // HABITATION — welded barricades, evidence of a failed defence.
    { t: 'bunk',     x: 24, z: 34, rot: 0 }, { t: 'bunk', x: 24, z: 37, rot: 0 },
    { t: 'bunk',     x: 24, z: 40, rot: 0 }, { t: 'bunk', x: 41, z: 34, rot: 3.14 },
    { t: 'bunk',     x: 41, z: 38, rot: 3.14 },
    { t: 'barricade', x: 31, z: 36, rot: 1.5708 },
    { t: 'barricade', x: 31, z: 39, rot: 1.5708 },
    { t: 'locker',   x: 28, z: 33, rot: 0 }, { t: 'locker', x: 35, z: 42, rot: 3.14 },
    { t: 'medkit',   x: 27, z: 41 }, { t: 'ammo', x: 40, z: 41 }, { t: 'ammo', x: 24, z: 33 },
    { t: 'lamp',     x: 27, z: 35 }, { t: 'lamp', x: 36, z: 35 }, { t: 'lamp', x: 31, z: 41 },
    { t: 'corpse',   x: 33, z: 37, rot: 2.9 }, { t: 'corpse', x: 30, z: 40, rot: 0.2 },
    { t: 'tank',     x: 42, z: 40 },

    // MESS — a small human space, the strongest storytelling room in the sector.
    { t: 'table',    x: 17, z: 36, rot: 0 }, { t: 'table', x: 19, z: 38, rot: 0.3 },
    { t: 'lamp',     x: 18, z: 36 }, { t: 'medkit', x: 16, z: 38 },
    { t: 'corpse',   x: 20, z: 36, rot: 1.9 },

    // PROCESSING — machinery around a void, catwalks across it.
    { t: 'mill',     x: 52, z: 32, rot: 0 }, { t: 'mill', x: 52, z: 40, rot: 0 },
    { t: 'mill',     x: 74, z: 32, rot: 3.14 },
    { t: 'conveyor', x: 55, z: 47, w: 20, rot: 0 },
    { t: 'conveyor', x: 55, z: 28, w: 18, rot: 0 },
    { t: 'silo',     x: 68, z: 28 }, { t: 'silo', x: 72, z: 28 },
    { t: 'tank',     x: 58, z: 47 }, { t: 'tank', x: 70, z: 47 }, { t: 'tank', x: 51, z: 45 },
    { t: 'lamp',     x: 53, z: 27 }, { t: 'lamp', x: 63, z: 27 }, { t: 'lamp', x: 73, z: 27 },
    { t: 'lamp',     x: 53, z: 48 }, { t: 'lamp', x: 63, z: 48 }, { t: 'lamp', x: 75, z: 40 },
    { t: 'lamp',     x: 62, z: 37 },
    { t: 'ammo',     x: 75, z: 47 }, { t: 'ammo', x: 51, z: 30 }, { t: 'armour', x: 76, z: 34 },
    { t: 'medkit',   x: 62, z: 44 }, { t: 'medkit', x: 53, z: 46 },
    { t: 'console',  x: 51, z: 34, rot: -1.5708 },
    { t: 'corpse',   x: 66, z: 46, rot: 0.8 },
    { t: 'sign',     x: 53, z: 49, text: 'COOLANT 7-D' },

    // COOLANT WALK — the dark beat. Only two working lamps in 85 m.
    { t: 'pipe',     x: 20, z: 52, w: 34 },
    { t: 'steam',    x: 26, z: 54 }, { t: 'steam', x: 35, z: 53 }, { t: 'steam', x: 46, z: 55 },
    { t: 'lamp',     x: 24, z: 52, broken: true },
    { t: 'lamp',     x: 31, z: 52, broken: true },
    { t: 'lamp',     x: 39, z: 52 },
    { t: 'lamp',     x: 48, z: 56, broken: true },
    { t: 'corpse',   x: 37, z: 55, rot: 1.4 },
    { t: 'ammo',     x: 43, z: 54 }, { t: 'medkit', x: 30, z: 54 }, { t: 'armour', x: 51, z: 55 },
    { t: 'flare',    x: 22, z: 55 },

    // PUMP HOUSE — dark, tall, a sump below the grating.
    { t: 'pump',     x: 10, z: 48, rot: 0 }, { t: 'pump', x: 17, z: 48, rot: 0 },
    { t: 'pump',     x: 17, z: 57, rot: 3.14 },
    { t: 'lamp',     x: 14, z: 48, broken: true }, { t: 'lamp', x: 11, z: 58 },
    { t: 'tank',     x: 18, z: 52 },
    { t: 'medkit',   x: 9,  z: 58 }, { t: 'ammo', x: 18, z: 59 }, { t: 'ammo', x: 11, z: 48 }, { t: 'medkit', x: 17, z: 59 },
    { t: 'console',  x: 13, z: 47, rot: 0 },

    // REACTOR ANTECHAMBER — the arena. Sodium heat, structure to break line of sight.
    { t: 'pylon',    x: 63, z: 55 }, { t: 'pylon', x: 63, z: 59 },
    { t: 'pylon',    x: 72, z: 55 }, { t: 'pylon', x: 72, z: 59 },
    { t: 'tank',     x: 60, z: 53 }, { t: 'tank', x: 77, z: 61 }, { t: 'tank', x: 68, z: 61 },
    { t: 'lamp',     x: 60, z: 57 }, { t: 'lamp', x: 68, z: 53 }, { t: 'lamp', x: 76, z: 57 },
    { t: 'ammo',     x: 59, z: 61 }, { t: 'ammo', x: 79, z: 53 }, { t: 'medkit', x: 67, z: 57 },
    { t: 'armour',   x: 74, z: 61 },
    { t: 'lift',     x: 80, z: 57 },
  ],

  // --- FLOW --------------------------------------------------------------
  spawn: { x: 6.5, z: 11.5, facing: 0 },        // cells; facing +x, toward the sector
  exit:  { x: 80, z: 56, w: 2, h: 3 },

  objectives: [
    { id: 'o_start', text: 'REACH CARGO HALL A', kind: 'reach', room: 'cargo' },
    { id: 'o_node1', text: 'DESTROY THE BREACH-NODE', kind: 'nest', nest: 'n_cargo' },
    { id: 'o_purge', text: 'PURGE THE SECTOR — NODES REMAINING: {n}', kind: 'nests' },
    { id: 'o_exit',  text: 'REACH THE REACTOR LIFT', kind: 'reach', room: 'reactor' },
  ],

  // Ambient one-shot beats keyed to first entry into a space (AUDIO/HUD).
  triggers: [
    { room: 'spine',   once: true, message: 'CHARTER LOG — 19 DAYS SINCE LAST TRANSMISSION', tone: 'log' },
    { room: 'cargo',   once: true, beat: 'cargo_enter' },
    { room: 'hab',     once: true, message: 'THEY WELDED THE DOORS FROM THE INSIDE', tone: 'log' },
    { room: 'proc',    once: true, beat: 'proc_enter' },
    { room: 'coolant', once: true, message: 'LIGHTING CIRCUIT 7-D — FAILED', tone: 'warn' },
    { room: 'pump',    once: true, beat: 'pump_enter' },
    { room: 'reactor', once: true, beat: 'boss_reveal' },
  ],
};
