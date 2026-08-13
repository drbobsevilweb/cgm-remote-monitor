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
    magazine: 32,
    reserve: 384,
    reloadTime: 1.85,
    spread: 0.014,          // radians, hip
    spreadPerShot: 0.011,
    spreadMax: 0.075,
    spreadRecover: 0.10,
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
