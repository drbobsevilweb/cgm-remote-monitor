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
/**
 * Levels were roughly halved once the catwalk shadows and the shafts went in.
 *
 * Those two features are the composition — a striped floor and a visible volume
 * of air only exist as *contrast*, and at the old ambient there was nothing for
 * them to be a contrast against: the bays were evenly lit, so a shadow read as a
 * dark decal and a shaft read as a smear. The rule in §5.2 has not changed, only
 * the number: ambient exists to keep shadow detail off the floor of the noise,
 * and the practicals do the shaping. There is simply much less of it now, and
 * what is left is bluer, which is what leaves room for an amber fixture to mean
 * something.
 */
export const TONES = {
  amber:  { ambient: 0x2d4160, fill: 0x1a160e, level: 0.21, lamp: PAL.amber,  lampLight: 0xffd9b4, lampI: 1.25 },
  cyan:   { ambient: 0x24425f, fill: 0x0d1f28, level: 0.20, lamp: PAL.cyan,   lampLight: 0xcfe9ff, lampI: 1.05 },
  red:    { ambient: 0x33232c, fill: 0x1c0a0a, level: 0.16, lamp: PAL.red,    lampLight: 0xff7a63, lampI: 0.95 },
  dim:    { ambient: 0x1f2d43, fill: 0x0e1013, level: 0.13, lamp: PAL.amber,  lampLight: 0xffd2a8, lampI: 0.9 },
  dark:   { ambient: 0x162435, fill: 0x070a0e, level: 0.055, lamp: PAL.amber, lampLight: 0xffcc9c, lampI: 0.7 },
  sodium: { ambient: 0x342f24, fill: 0x241408, level: 0.19, lamp: PAL.sodium, lampLight: 0xffb277, lampI: 1.25 },
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
