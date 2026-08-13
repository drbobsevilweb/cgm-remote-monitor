// RENDERER / CameraRig — DIRECTION §4.
//
// 62 degrees down, spring follow, cursor lead, contextual distance, and a
// screenshake budget that ordinary gunfire is not allowed to spend.

import * as THREE from '../../vendor/three.module.js';
import { clamp, damp, lerp, smoothstep } from '../core/Mathx.js';

const PITCH = 62 * Math.PI / 180;
const NOMINAL = 16.5;

export class CameraRig {
  constructor(rng) {
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.35, 260);
    this.rng = rng.child('camera');
    this.pos = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.focusVel = { x: 0, z: 0 };
    this.dist = NOMINAL;
    this.targetDist = NOMINAL;
    this.shake = 0;
    this.shakeFreq = 26;
    this.kick = { x: 0, z: 0 };
    this.leadX = 0; this.leadZ = 0;
    this.time = 0;
    this.frozen = false;
  }

  snapTo(x, z) {
    this.focus.set(x, 0, z);
    this.focusVel.x = 0; this.focusVel.z = 0;
    this.dist = this.targetDist;
    this.apply(0);
  }

  /** `zoomHint` in metres, from the room the player is in. */
  setZoomHint(d) { this.targetDist = d; }

  /** Screenshake is a budget. Ordinary gunfire gets `kickImpulse`, not this. */
  addShake(amount) { this.shake = Math.min(0.35, this.shake + amount); }
  addKick(dx, dz, power) { this.kick.x -= dx * power; this.kick.z -= dz * power; }

  update(dt, px, pz, aimX, aimZ, cursorDist) {
    this.time += dt;
    if (this.frozen) { this.apply(dt); return; }

    // Lead the camera toward where the player is looking — aiming reveals.
    const lead = Math.min(2.2, cursorDist * 0.30);
    this.leadX = damp(this.leadX, aimX * lead, 0.02, dt);
    this.leadZ = damp(this.leadZ, aimZ * lead, 0.02, dt);

    const tx = px + this.leadX + this.kick.x;
    const tz = pz + this.leadZ + this.kick.z;

    // critically damped spring, ~150 ms settle
    const k = 1 - Math.exp(-dt / 0.055);
    this.focus.x += (tx - this.focus.x) * k;
    this.focus.z += (tz - this.focus.z) * k;

    this.kick.x = damp(this.kick.x, 0, 0.0004, dt);
    this.kick.z = damp(this.kick.z, 0, 0.0004, dt);

    // contextual distance, rate limited so it is felt as space, not seen as zoom
    const maxRate = 1.5 * dt;
    this.dist += clamp(this.targetDist - this.dist, -maxRate, maxRate);

    this.shake = Math.max(0, this.shake - dt * 1.35);
    this.apply(dt);
  }

  apply(dt) {
    const s = this.shake * this.shake;   // decays fast and feels punchier
    let ox = 0, oy = 0;
    if (s > 0.0001) {
      const t = this.time * this.shakeFreq;
      ox = Math.sin(t * 1.7 + 0.6) * s * 1.1 + Math.sin(t * 3.1) * s * 0.4;
      oy = Math.cos(t * 2.3) * s * 0.9 + Math.sin(t * 4.7 + 1.2) * s * 0.3;
    }
    const h = Math.sin(PITCH) * this.dist;
    const back = Math.cos(PITCH) * this.dist;
    this.pos.set(this.focus.x + ox, h + oy * 0.6, this.focus.z + back);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.focus.x + ox * 0.4, 0.9, this.focus.z + oy * 0.2);
    this.camera.updateMatrixWorld();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // Keep the vertical field consistent on wide screens; widen on narrow ones so
    // the readable area ahead of the player never shrinks below the design intent.
    this.camera.fov = clamp(60 / Math.min(1, this.camera.aspect / (16 / 9)), 60, 74);
    this.camera.updateProjectionMatrix();
  }
}

export { NOMINAL as CAMERA_NOMINAL_DISTANCE, PITCH as CAMERA_PITCH };
