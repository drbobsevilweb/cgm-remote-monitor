// PLAYER / Operators — the four archetypes.
//
// The vertical slice ships ASSAULT (ARCHITECTURE decision #8). The other three
// are specified here because their numbers are part of the design, not because
// the code branches on them yet: they are the contract for the next slice.

export const OPERATORS = {
  assault: {
    id: 'assault',
    name: 'ASSAULT',
    callsign: 'VEHLE',
    blurb: 'Charter rifle operator. Mobile, reliable, unremarkable — which is why she is still alive.',
    // movement — "a person wearing equipment", not a frictionless game piece
    speed: 5.6,
    accel: 46,          // m/s^2  -> reaches top speed in ~0.12 s
    brake: 58,
    turnGrip: 0.86,     // how much of a direction change is kept per step
    health: 140,
    armour: 50,
    radius: 0.42,
    // silhouette
    build: { shoulders: 0.52, height: 1.82, pack: 'compact', helmet: 'visor' },
    primary: 'carbine',
    secondary: 'frag',
    emergency: 'dash',
    utility: 'flare',
  },

  heavy: {
    id: 'heavy', name: 'HEAVY', callsign: 'ORRIN',
    blurb: 'Suppression gunner. Cannot outrun anything, and does not need to.',
    speed: 4.0, accel: 26, brake: 30, turnGrip: 0.62,
    health: 190, armour: 80, radius: 0.52,
    build: { shoulders: 0.78, height: 1.94, pack: 'ammo', helmet: 'full' },
    primary: 'repeater',      // spin-up, high sustained fire, heavy recoil
    secondary: 'anchor',      // plant: +accuracy, +fire rate, cannot move
    emergency: 'brace',       // frontal damage reduction, pushes contact enemies back
    utility: 'flare',
  },

  tech: {
    id: 'tech', name: 'TECH', callsign: 'SABEK',
    blurb: 'Reclamation engineer. Talks to the station; the station mostly answers.',
    speed: 5.2, accel: 40, brake: 50, turnGrip: 0.82,
    health: 100, armour: 30, radius: 0.40,
    build: { shoulders: 0.50, height: 1.78, pack: 'toolrack', helmet: 'open' },
    primary: 'arcThrower',    // chaining energy, excellent vs armoured
    secondary: 'overload',    // overload machinery / doors / defensive systems
    emergency: 'pylon',       // deployable shock post
    utility: 'flare',
  },

  medic: {
    id: 'medic', name: 'BIOLOGIST', callsign: 'IRENNE',
    blurb: 'Charter biologist. Knows what the Chorus is doing, which is not comforting.',
    speed: 5.4, accel: 44, brake: 54, turnGrip: 0.84,
    health: 105, armour: 35, radius: 0.40,
    build: { shoulders: 0.48, height: 1.74, pack: 'medical', helmet: 'visor' },
    primary: 'compactor',     // short-range burst
    secondary: 'stim',        // heal + speed for self or an ally
    emergency: 'pulse',       // short-range concussive ring
    utility: 'analyse',       // marks biological weak points: +damage for everyone
  },
};

export const WEAPON_SPECS = {
  carbine: {
    name: 'MK4 PULSE CARBINE',
    short: 'CARBINE',
    damage: 17,
    rpm: 545,
    // --- thermal cycle. The carbine draws from the suit's cell, so rounds are
    // not the constraint; the barrel is. Continuous fire is ALWAYS available and
    // ALWAYS punished, which is a different decision from "do I have ammo": it
    // is asked every second of every fight rather than once per magazine.
    heatPerShot: 0.0345,    // ~29 rounds, ~3.2 s, from cold to a forced vent
    coolRate: 0.46,         // fraction per second once it starts cooling
    coolDelay: 0.42,        // seconds after the last round before cooling starts
    forcedVent: 2.15,       // lockout when the barrel takes the decision from you
    ventBase: 0.50,         // manual vent: this, plus...
    ventPerHeat: 1.45,      // ...this much per unit of heat you let build
    ventFloor: 0.10,        // below this there is nothing worth venting
    warnHeat: 0.78,         // where the HUD and the audio start telling you
    reloadTime: 1.85,       // legacy: vent stage timings are derived from this
    spread: 0.014,          // radians, hip
    spreadPerShot: 0.011,
    spreadMax: 0.075,
    spreadRecover: 0.10,
    // The barrel loses accuracy as it heats, on top of sustained-fire bloom.
    spreadPerHeat: 0.030,
    projectileSpeed: 118,
    recoil: 0.055,
    kick: 0.10,
    tracerEvery: 2,
    pierce: 0,
    muzzleFlash: 1.0,
    shell: true,
  },
  frag: {
    name: 'UNDERSLUNG FRAG',
    short: 'FRAG',
    damage: 95,
    radius: 4.6,
    magazine: 1,
    reserve: 5,
    reloadTime: 1.1,
    cooldown: 0.9,
    projectileSpeed: 26,
    arc: 0.42,
    fuse: 1.35,
  },
};

/**
 * Special weapons are the one place ammunition still exists.
 *
 * The carbine is unlimited because "am I out" is a bad question to ask a player
 * sixty times a run. A special is limited because it is the opposite kind of
 * object: it is a resource you found, and the interesting question about a
 * resource you found is when to spend it. Charges are finite, do not regenerate,
 * and produce no heat — so picking one up is also a moment of thermal relief.
 *
 * When the charges run out the operator falls back to the carbine automatically.
 * There is no stow control: a special is a temporary state, not a loadout slot.
 */
export const SPECIAL_SPECS = {
  arclance: {
    id: 'arclance',
    name: 'AL-9 ARC LANCE',
    short: 'ARC LANCE',
    damage: 82,
    rpm: 148,
    charges: 22,
    pierce: 3,            // it goes through a queue of runners, not into one
    projectileSpeed: 165,
    spread: 0.004,
    recoil: 0.16,
    kick: 0.26,
    colour: 0x5fd8ff,
  },
};

