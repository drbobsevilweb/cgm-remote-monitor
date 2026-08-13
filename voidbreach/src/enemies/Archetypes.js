// ENEMIES / Archetypes — the Chorus.
//
// Built from arthropod + fungal + mineral references (DIRECTION §12). Each
// archetype exists to ask the player a different question:
//   runner  — "can you keep them off you?"      (volume)
//   stalker — "do you know what is behind you?" (arc)
//   spitter — "can you keep moving?"            (ground denial)
//   bulwark — "will you reposition?"            (geometry)
//   hunter  — "can you finish something?"       (commitment)

import * as THREE from '../../vendor/three.module.js';
import { MeshBuilder } from '../environment/MeshBuilder.js';

export const KIND = { RUNNER: 0, STALKER: 1, SPITTER: 2, BULWARK: 3, HUNTER: 4, LARVA: 5 };
export const KIND_NAMES = ['RUNNER', 'STALKER', 'SPITTER', 'BULWARK', 'HUNTER', 'LARVA'];

export const ARCHETYPES = [
  {
    id: 'runner', kind: KIND.RUNNER,
    hp: 34, speed: 6.15, accel: 30, radius: 0.34, mass: 0.7,
    damage: 6, attackRange: 1.15, attackWindup: 0.22, attackRecover: 0.58,
    scale: 1.0, height: 0.62, gaitRate: 15.0,
    aggression: 1.0, flankBias: 0.12, senseRange: 42,
    // Individually trivial. The threat is the number and the speed.
    colour: 0x8a4f9c, accent: 0xd07ce8, score: 10,
  },
  {
    id: 'stalker', kind: KIND.STALKER,
    hp: 78, speed: 5.5, accel: 26, radius: 0.44, mass: 1.3,
    damage: 15, attackRange: 1.5, attackWindup: 0.36, attackRecover: 0.80,
    scale: 1.32, height: 0.95, gaitRate: 9.5,
    aggression: 0.8, flankBias: 0.92, senseRange: 52,
    lungeSpeed: 13.0, lungeRange: 6.5, lungeCooldown: 3.4,
    colour: 0x5c3a6e, accent: 0xa050c8, score: 40,
  },
  {
    id: 'spitter', kind: KIND.SPITTER,
    hp: 56, speed: 3.35, accel: 16, radius: 0.46, mass: 1.1,
    damage: 11, attackRange: 15.0, attackWindup: 0.85, attackRecover: 1.6,
    preferredRange: 11.5, projectileSpeed: 19,
    scale: 1.18, height: 0.85, gaitRate: 7.0,
    aggression: 0.35, flankBias: 0.25, senseRange: 46,
    colour: 0x6b7a2c, accent: 0xb8ff4a, score: 35,
  },
  {
    id: 'bulwark', kind: KIND.BULWARK,
    hp: 260, speed: 2.35, accel: 9, radius: 0.78, mass: 4.0,
    damage: 24, attackRange: 2.1, attackWindup: 0.66, attackRecover: 1.25,
    scale: 1.85, height: 1.35, gaitRate: 4.6,
    aggression: 0.9, flankBias: 0.05, senseRange: 40,
    // Frontal plate: 82% reduction inside a 100-degree frontal arc. Flanking is
    // not a bonus, it is the only answer (gate F3).
    frontArmour: 0.18, frontArc: 0.64,
    colour: 0x4a4038, accent: 0xc23bd8, score: 90,
  },
  {
    id: 'hunter', kind: KIND.HUNTER,
    hp: 460, speed: 6.6, accel: 34, radius: 0.62, mass: 2.6,
    damage: 32, attackRange: 2.0, attackWindup: 0.32, attackRecover: 0.70,
    scale: 1.62, height: 1.2, gaitRate: 11.0,
    aggression: 1.0, flankBias: 0.7, senseRange: 60,
    lungeSpeed: 17.0, lungeRange: 9.0, lungeCooldown: 2.6,
    // Retreats when hurt, breaks line of sight, returns from another route.
    fleeBelow: 0.45, fleeTime: 4.2, fleeHeal: 26,
    colour: 0x2e2a3a, accent: 0xff5a2e, score: 400, elite: true,
  },
  {
    id: 'larva', kind: KIND.LARVA,
    hp: 12, speed: 4.9, accel: 24, radius: 0.24, mass: 0.35,
    damage: 4, attackRange: 0.9, attackWindup: 0.16, attackRecover: 0.45,
    scale: 0.62, height: 0.34, gaitRate: 19.0,
    aggression: 1.0, flankBias: 0.05, senseRange: 30,
    colour: 0x7a5a8c, accent: 0xc08ad8, score: 5,
  },
];

export const BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

/**
 * Rigid-part geometry per archetype. Each part becomes one InstancedMesh, so a
 * six-part runner at 200 instances is six draw calls (ARCHITECTURE §4).
 *
 * Parts carry a `role` that the animator understands: body, head, legN, blade,
 * sac, plate, tail.
 */
export function buildArchetypeGeometry(archetype) {
  const s = archetype.scale;
  const parts = [];
  const mk = (role, fn) => {
    const b = new MeshBuilder();
    fn(b);
    const g = b.build(archetype.id + '_' + role);
    parts.push({ role, geometry: g });
  };

  switch (archetype.kind) {
    case KIND.RUNNER:
    case KIND.LARVA: {
      mk('body', (b) => {
        // segmented carapace, tapering — reads as "fast" from above
        b.addBoxRot(0, 0, 0, 0.30 * s, 0.17 * s, 0.44 * s, 0, 1);
        b.addBoxRot(0, 0.10 * s, -0.30 * s, 0.22 * s, 0.13 * s, 0.22 * s, 0, 1);
        b.addBoxRot(0, 0.13 * s, 0.10 * s, 0.24 * s, 0.13 * s, 0.20 * s, 0, 1);
      });
      mk('head', (b) => {
        b.addBoxRot(0, 0, 0, 0.17 * s, 0.12 * s, 0.20 * s, 0, 1);
        // radial mandibles, not jaws
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          b.addBoxRot(Math.cos(a) * 0.11 * s, Math.sin(a) * 0.07 * s, 0.16 * s,
            0.035 * s, 0.035 * s, 0.12 * s, 0, 2);
        }
      });
      for (let i = 0; i < 4; i++) {
        mk('leg' + i, (b) => {
          b.addBoxRot(0, 0, 0, 0.035 * s, 0.035 * s, 0.26 * s, 0, 2);
        });
      }
      break;
    }
    case KIND.STALKER: {
      mk('body', (b) => {
        b.addBoxRot(0, 0, 0, 0.30 * s, 0.20 * s, 0.52 * s, 0, 1);
        b.addBoxRot(0, 0.17 * s, -0.12 * s, 0.20 * s, 0.14 * s, 0.30 * s, 0, 1);
      });
      mk('head', (b) => {
        b.addBoxRot(0, 0, 0, 0.15 * s, 0.13 * s, 0.24 * s, 0, 1);
        b.addBoxRot(0, -0.06 * s, 0.16 * s, 0.10 * s, 0.05 * s, 0.12 * s, 0, 2);
      });
      mk('tail', (b) => {
        b.addBoxRot(0, 0, 0, 0.06 * s, 0.06 * s, 0.34 * s, 0, 2);
        b.addBoxRot(0, 0.04 * s, -0.32 * s, 0.04 * s, 0.10 * s, 0.10 * s, 0, 2);
      });
      for (let i = 0; i < 4; i++) {
        mk('leg' + i, (b) => { b.addBoxRot(0, 0, 0, 0.05 * s, 0.05 * s, 0.34 * s, 0, 2); });
      }
      break;
    }
    case KIND.SPITTER: {
      mk('body', (b) => { b.addBoxRot(0, 0, 0, 0.30 * s, 0.22 * s, 0.40 * s, 0, 1); });
      mk('sac', (b) => {
        // the charge sac: it swells before it fires, which is the warning
        b.addCylinder(0, -0.20 * s, 0, 0.26 * s, 0.40 * s, 10, true, true, 1);
      });
      mk('head', (b) => {
        b.addBoxRot(0, 0, 0, 0.13 * s, 0.12 * s, 0.22 * s, 0, 1);
        b.addCylinder(0, -0.04 * s, 0.16 * s, 0.05 * s, 0.16 * s, 6, true, false, 2);
      });
      for (let i = 0; i < 4; i++) {
        mk('leg' + i, (b) => { b.addBoxRot(0, 0, 0, 0.05 * s, 0.05 * s, 0.28 * s, 0, 2); });
      }
      break;
    }
    case KIND.BULWARK: {
      mk('body', (b) => { b.addBoxRot(0, 0, 0, 0.42 * s, 0.30 * s, 0.52 * s, 0, 1); });
      mk('plate', (b) => {
        // mineral crust grown over the front — visibly different material
        b.addBoxRot(0, 0, 0, 0.50 * s, 0.42 * s, 0.14 * s, 0, 1);
        b.addBoxRot(0, 0.30 * s, 0.02 * s, 0.34 * s, 0.14 * s, 0.10 * s, 0, 1);
        b.addBoxRot(-0.40 * s, -0.10 * s, 0.02 * s, 0.12 * s, 0.24 * s, 0.10 * s, 0.3, 1);
        b.addBoxRot(0.40 * s, -0.10 * s, 0.02 * s, 0.12 * s, 0.24 * s, 0.10 * s, -0.3, 1);
      });
      mk('head', (b) => { b.addBoxRot(0, 0, 0, 0.16 * s, 0.14 * s, 0.20 * s, 0, 1); });
      for (let i = 0; i < 4; i++) {
        mk('leg' + i, (b) => { b.addBoxRot(0, 0, 0, 0.09 * s, 0.09 * s, 0.34 * s, 0, 2); });
      }
      break;
    }
    case KIND.HUNTER: {
      mk('body', (b) => {
        b.addBoxRot(0, 0, 0, 0.34 * s, 0.24 * s, 0.60 * s, 0, 1);
        b.addBoxRot(0, 0.22 * s, -0.16 * s, 0.22 * s, 0.16 * s, 0.34 * s, 0, 1);
      });
      mk('head', (b) => {
        b.addBoxRot(0, 0, 0, 0.16 * s, 0.15 * s, 0.28 * s, 0, 1);
        for (let i = 0; i < 3; i++) {
          b.addBoxRot((i - 1) * 0.08 * s, 0.14 * s, -0.04 * s, 0.02 * s, 0.10 * s, 0.02 * s, 0, 2);
        }
      });
      mk('blade0', (b) => { b.addBoxRot(0, 0, 0, 0.04 * s, 0.16 * s, 0.44 * s, 0, 2); });
      mk('blade1', (b) => { b.addBoxRot(0, 0, 0, 0.04 * s, 0.16 * s, 0.44 * s, 0, 2); });
      for (let i = 0; i < 4; i++) {
        mk('leg' + i, (b) => { b.addBoxRot(0, 0, 0, 0.06 * s, 0.06 * s, 0.40 * s, 0, 2); });
      }
      break;
    }
  }
  return parts;
}
