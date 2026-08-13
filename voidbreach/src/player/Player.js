// PLAYER — the operator: movement, health, abilities, and the rig that shows it.
//
// Movement contract (DIRECTION §"PLAYER MOVEMENT"): immediate, weighty,
// predictable. Deliberate acceleration and braking, grip on direction change,
// no floaty exponential drift. Top speed from a standstill in ~0.12 s (gate F4).

import * as THREE from '../../vendor/three.module.js';
import { OPERATORS } from './Operators.js';
import { clamp, clamp01, angleApproach, angleDelta, TAU } from '../core/Mathx.js';
import { CELL, C } from '../level/Grid.js';

const DASH_TIME = 0.22;         // i-frame window (gate F5)
const DASH_SPEED = 15.5;
const DASH_COOLDOWN = 1.15;

export class Player {
  constructor(operatorId, sector, weapons, events, rng) {
    this.spec = OPERATORS[operatorId] || OPERATORS.assault;
    this.sector = sector;
    this.grid = sector.grid;
    this.weapons = weapons;
    this.events = events;
    this.rng = rng.child('player');

    this.x = sector.spawn.x; this.z = sector.spawn.z;
    this.vx = 0; this.vz = 0;
    this.facing = sector.spawn.facing;
    this.aimX = Math.cos(this.facing); this.aimZ = Math.sin(this.facing);
    this.radius = this.spec.radius;

    this.health = this.spec.health;
    this.maxHealth = this.spec.health;
    this.armour = this.spec.armour;
    this.maxArmour = this.spec.armour;
    this.alive = true;

    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.lastDamageDir = { x: 0, z: 0 };
    this.flares = 2;
    this.lightOn = true;

    this.gait = 0;
    this.speed01 = 0;
    this.distanceTravelled = 0;
    this.gratingDistance = 0;
    this.timeInDark = 0;

    this._res = { x: 0, z: 0, hit: false, hitX: 0, hitZ: 0 };
    this.rig = buildRig(this.spec);
    this.parts = this.rig.userData.parts;
    this.rig.position.set(this.x, 0, this.z);
  }

  get dashReady() { return this.dashCooldown <= 0; }
  get dashing() { return this.dashTimer > 0; }
  get health01() { return clamp01(this.health / this.maxHealth); }

  heal(n) {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + n);
    if (this.health > before) this.events.emit('heal', { amount: this.health - before });
    return this.health - before;
  }
  addArmour(n) { this.armour = Math.min(this.maxArmour, this.armour + n); }

  damage(amount, dirX = 0, dirZ = 0) {
    if (!this.alive || this.invuln > 0) return 0;
    let remaining = amount;
    if (this.armour > 0) {
      // Armour eats 60% of the hit until it is gone: it buys time, not immunity.
      const absorbed = Math.min(this.armour, amount * 0.6);
      this.armour -= absorbed;
      remaining -= absorbed;
    }
    this.health -= remaining;
    this.hurtFlash = 1;
    this.invuln = 0.18;                 // brief mercy window against swarm stacking
    this.lastDamageDir.x = dirX; this.lastDamageDir.z = dirZ;
    this.events.emit('playerHit', { dmg: amount, dirX, dirZ, armour: this.armour, health: this.health });
    if (this.health <= 0) {
      this.health = 0; this.alive = false;
      this.events.emit('playerDied', { x: this.x, z: this.z });
    }
    return amount;
  }

  update(dt, input, time) {
    if (!this.alive) { this.updateRig(dt, time); return; }

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);

    this.aimX = input.aimX; this.aimZ = input.aimZ;
    const aimAngle = Math.atan2(this.aimZ, this.aimX);
    // The operator turns fast but not instantly — equipment has inertia.
    this.facing = angleApproach(this.facing, aimAngle, 16 * dt);

    if (input.dashPressed && this.dashReady && (input.moveX || input.moveZ)) this.startDash(input);

    const s = this.spec;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) { this.dashTimer = 0; }
    } else {
      const wantX = input.moveX * s.speed;
      const wantZ = input.moveZ * s.speed;
      const moving = (input.moveX !== 0 || input.moveZ !== 0);
      const rate = moving ? s.accel : s.brake;

      // Direction-change grip: turning bleeds a little speed, which is what
      // makes the movement feel like a person rather than a cursor.
      if (moving) {
        const curLen = Math.hypot(this.vx, this.vz);
        if (curLen > 0.5) {
          const dot = (this.vx * input.moveX + this.vz * input.moveZ) / curLen;
          if (dot < 0.4) {
            const grip = s.turnGrip;
            this.vx *= grip; this.vz *= grip;
          }
        }
      }
      this.vx = approach(this.vx, wantX, rate * dt);
      this.vz = approach(this.vz, wantZ, rate * dt);
    }

    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const before = { x: this.x, z: this.z };
    this.grid.resolveCircle(nx, nz, this.radius, this._res);
    this.x = this._res.x; this.z = this._res.z;
    if (this._res.hit) {
      // Slide: kill only the component into the wall.
      const hx = this._res.hitX, hz = this._res.hitZ;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-5) {
        const nxn = hx / hl, nzn = hz / hl;
        const into = this.vx * nxn + this.vz * nzn;
        if (into < 0) { this.vx -= nxn * into; this.vz -= nzn * into; }
      }
    }

    const moved = Math.hypot(this.x - before.x, this.z - before.z);
    this.distanceTravelled += moved;
    if (this.grid.cellAtWorld(this.x, this.z) === C.GRATE) this.gratingDistance += moved;

    const spd = Math.hypot(this.vx, this.vz);
    this.speed01 = clamp01(spd / s.speed);
    this.gait += spd * dt * 1.55;

    if (input.lightPressed) {
      this.lightOn = !this.lightOn;
      this.events.emit('operatorLight', { on: this.lightOn });
    }

    this.updateRig(dt, time);
  }

  startDash(input) {
    const len = Math.hypot(input.moveX, input.moveZ) || 1;
    this.vx = (input.moveX / len) * DASH_SPEED;
    this.vz = (input.moveZ / len) * DASH_SPEED;
    this.dashTimer = DASH_TIME;
    this.dashCooldown = DASH_COOLDOWN;
    this.invuln = Math.max(this.invuln, DASH_TIME);
    this.events.emit('dash', { x: this.x, z: this.z, dirX: input.moveX / len, dirZ: input.moveZ / len });
  }

  updateRig(dt, time) {
    const r = this.rig;
    r.position.x = this.x; r.position.z = this.z;
    r.rotation.y = -this.facing + Math.PI / 2;

    const bob = Math.sin(this.gait * 2) * 0.035 * this.speed01;
    r.position.y = bob + (this.dashing ? -0.12 : 0);

    const swing = Math.sin(this.gait) * 0.55 * this.speed01;
    if (this.parts) {
      this.parts.legL.rotation.x = swing;
      this.parts.legR.rotation.x = -swing;
      this.parts.torso.rotation.z = Math.sin(this.gait) * 0.035 * this.speed01;
      const recoil = this.weapons ? this.weapons.recoil : 0;
      this.parts.arms.position.z = -recoil * 0.12;
      this.parts.arms.rotation.x = recoil * 0.22;
      if (!this.alive) {
        r.rotation.z = Math.min(Math.PI / 2, (r.rotation.z || 0) + dt * 3.2);
        r.position.y = -0.35;
      }
    }
  }
}

function approach(v, target, maxDelta) {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}

/**
 * The operator rig. Built from primitives, animated procedurally. Read from a
 * 62-degree camera the silhouette is: shoulders, helmet, pack, weapon — so those
 * four shapes carry the character and nothing else needs detail.
 */
function buildRig(spec) {
  const g = new THREE.Group();
  g.name = 'operator';
  const suit = new THREE.MeshStandardMaterial({ color: 0x39414c, roughness: 0.72, metalness: 0.15 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x5a6472, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2128, roughness: 0.85, metalness: 0.1 });
  const visor = new THREE.MeshBasicMaterial({ color: 0x5fd8ff });
  const trim = new THREE.MeshBasicMaterial({ color: 0xffb45a });

  const torso = new THREE.Group();
  const sh = spec.build.shoulders;

  const chest = new THREE.Mesh(new THREE.BoxGeometry(sh, 0.62, 0.34), plate);
  chest.position.y = 1.20; torso.add(chest);

  const abdomen = new THREE.Mesh(new THREE.BoxGeometry(sh * 0.78, 0.34, 0.28), suit);
  abdomen.position.y = 0.85; torso.add(abdomen);

  // pack: the most identifiable shape from above
  const pack = new THREE.Mesh(new THREE.BoxGeometry(sh * 0.82, 0.46, 0.24), dark);
  pack.position.set(0, 1.22, -0.26); torso.add(pack);
  const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 8), plate);
  canister.position.set(sh * 0.26, 1.26, -0.34); torso.add(canister);
  const canister2 = canister.clone(); canister2.position.x = -sh * 0.26; torso.add(canister2);

  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.20, 0.30), plate);
  shoulderL.position.set(sh * 0.5 + 0.06, 1.40, 0); torso.add(shoulderL);
  const shoulderR = shoulderL.clone(); shoulderR.position.x = -(sh * 0.5 + 0.06); torso.add(shoulderR);

  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.28, 0.34), plate);
  helmet.position.y = 1.66; torso.add(helmet);
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.10, 0.04), visor);
  visorMesh.position.set(0, 1.66, 0.18); torso.add(visorMesh);
  // shoulder lamp — the visible source of the operator light
  const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.06), trim);
  lampMesh.position.set(sh * 0.5, 1.47, 0.12); torso.add(lampMesh);

  const arms = new THREE.Group();
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.46), suit);
  armL.position.set(0.16, 1.22, 0.26); arms.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.40), suit);
  armR.position.set(-0.16, 1.22, 0.14); arms.add(armR);

  const gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, 0.62), dark);
  body.position.set(0.06, 1.20, 0.40); gun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.40, 6), plate);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.06, 1.22, 0.80); gun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.20, 0.10), dark);
  mag.position.set(0.06, 1.06, 0.42); gun.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.12), trim);
  sight.position.set(0.06, 1.30, 0.40); gun.add(sight);
  arms.add(gun);
  torso.add(arms);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.20), suit);
  legL.position.set(0.13, 0.36, 0);
  legL.geometry.translate(0, -0.36, 0); legL.position.y = 0.72;
  const legR = legL.clone(); legR.position.x = -0.13;

  g.add(torso, legL, legR);
  g.userData.parts = { torso, arms, gun, legL, legR, helmet, visorMesh, lampMesh, barrel };
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function rigParts(rig) { return rig.userData.parts; }
