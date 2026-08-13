// ENVIRONMENT / Palette — DIRECTION §5.5 single-sourced.
// Colour carries meaning. If a colour is not in this table it does not appear in
// the game, and each of these means exactly one thing.

export const PAL = {
  amber:   0xffb45a,   // safe / functional station power / progress / exits
  red:     0xff3a2e,   // alarm, hazard, locked, damaged
  cyan:    0x5fd8ff,   // interactive, information, player energy
  violet:  0xc23bd8,   // the Chorus — alive and spawning. Nothing else, ever.
  bile:    0xb8ff4a,   // corrosive / biological hazard
  sodium:  0xff8a3d,   // deep station / reactor heat

  steel:   0x2c333c,
  deck:    0x242a32,
  trim:    0x1b2027,
  ceramic: 0x575e63,
  paint:   0x8d8f8a,
  shadow:  0x0a0e14,
};

/** Room tone -> ambient lighting character. */
export const TONES = {
  amber:  { ambient: 0x4a6480, fill: 0x3a2e1e, level: 0.42, lamp: PAL.amber,  lampI: 1.0 },
  cyan:   { ambient: 0x40607a, fill: 0x1c3038, level: 0.40, lamp: PAL.cyan,   lampI: 0.85 },
  red:    { ambient: 0x503038, fill: 0x2a1010, level: 0.30, lamp: PAL.red,    lampI: 0.75 },
  dim:    { ambient: 0x38485c, fill: 0x1a1c20, level: 0.26, lamp: PAL.amber,  lampI: 0.7 },
  dark:   { ambient: 0x2a3a4c, fill: 0x101418, level: 0.10, lamp: PAL.amber,  lampI: 0.55 },
  sodium: { ambient: 0x604830, fill: 0x3a2410, level: 0.38, lamp: PAL.sodium, lampI: 1.0 },
};

export function toneOf(room) { return TONES[room && room.tone] || TONES.dim; }
