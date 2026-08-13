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
/**
 * Room tone -> ambient character.
 *
 * `lamp` is the ACCENT colour (emissive housings, markings, HUD) — the meaning
 * colour of DIRECTION §5.5. `lampLight` is what the fixture actually emits: a
 * work lamp is warm WHITE, around 3000 K, not orange. Lighting the station with
 * the accent colour turned the entire palette amber and destroyed the cool
 * blue-black shadow the direction asks for; the two roles are now separate.
 */
export const TONES = {
  amber:  { ambient: 0x3d5c82, fill: 0x2a2418, level: 0.44, lamp: PAL.amber,  lampLight: 0xffd9b4, lampI: 1.0 },
  cyan:   { ambient: 0x33587a, fill: 0x16303c, level: 0.42, lamp: PAL.cyan,   lampLight: 0xcfe9ff, lampI: 0.85 },
  red:    { ambient: 0x46323f, fill: 0x2a1010, level: 0.32, lamp: PAL.red,    lampLight: 0xff7a63, lampI: 0.75 },
  dim:    { ambient: 0x2e4260, fill: 0x171a1f, level: 0.28, lamp: PAL.amber,  lampLight: 0xffd2a8, lampI: 0.7 },
  dark:   { ambient: 0x22364e, fill: 0x0e1218, level: 0.11, lamp: PAL.amber,  lampLight: 0xffcc9c, lampI: 0.55 },
  sodium: { ambient: 0x4a4436, fill: 0x38200e, level: 0.40, lamp: PAL.sodium, lampLight: 0xffb277, lampI: 1.0 },
};

/**
 * Studio overrides for the palette and room tones. Applied once, at module
 * load, so LIGHTING and ENVIRONMENT both see the same values.
 */
export function applyPaletteOverrides(o) {
  if (!o) return;
  if (o.PAL) Object.assign(PAL, o.PAL);
  if (o.TONES) {
    for (const k of Object.keys(o.TONES)) {
      if (TONES[k]) Object.assign(TONES[k], o.TONES[k]);
    }
  }
}

export function toneOf(room) { return TONES[room && room.tone] || TONES.dim; }
