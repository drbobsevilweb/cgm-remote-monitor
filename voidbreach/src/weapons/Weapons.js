// WEAPONS — fire timing, recoil, spread, reload, ammo. Owns the projectile pool.
//
// Every shot has consequence (DIRECTION §"COMBAT"): a muzzle flash event, a
// light pulse, camera kick, a case ejection, spread growth and an audible
// mechanical tail. WEAPONS emits those; VFX/AUDIO/LIGHTING listen.

import { WEAPON_SPECS } from '../player/Operators.js';
import { Projectiles, P_BULLET, P_GRENADE } from './Projectiles.js';
import { clamp, clamp01 } from '../core/Mathx.js';

export class Weapons {
  constructor(sector, events, rng) {
    this.events = events;
    this.rng = rng.child('weapons');
    this.projectiles = new Projectiles(sector, events, rng);

    const c = WEAPON_SPECS.carbine;
    this.carbine = {
      spec: c,
      ammo: c.magazine,
      reserve: c.reserve,
      cooldown: 0,
      interval: 60 / c.rpm,
      reloading: 0,
      reloadStage: 0,
      spread: c.spread,
      shotsFired: 0,
    };
    const f = WEAPON_SPECS.frag;
    this.frag = { spec: f, ammo: f.reserve, cooldown: 0 };
    this.recoil = 0;
  }

  get ammo() { return this.carbine.ammo; }
  get reserve() { return this.carbine.reserve; }
  get magazine() { return this.carbine.spec.magazine; }
  get grenades() { return this.frag.ammo; }
  get reloading() { return this.carbine.reloading > 0; }
  get reloadProgress() {
    return this.carbine.reloading > 0
      ? 1 - this.carbine.reloading / this.carbine.spec.reloadTime : 1;
  }

  addAmmo(n) {
    const c = this.carbine;
    c.reserve = Math.min(c.spec.reserve, c.reserve + n);
  }
  addGrenades(n) { this.frag.ammo = Math.min(this.frag.spec.reserve, this.frag.ammo + n); }

  startReload() {
    const c = this.carbine;
    if (c.reloading > 0 || c.reserve <= 0 || c.ammo >= c.spec.magazine) return false;
    c.reloading = c.spec.reloadTime;
    c.reloadStage = 0;
    this.events.emit('reload', { stage: 'release' });
    return true;
  }

  update(dt, px, pz, aimX, aimZ, input, canFire) {
    const c = this.carbine;
    c.cooldown = Math.max(0, c.cooldown - dt);
    this.frag.cooldown = Math.max(0, this.frag.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 5.5);

    // spread recovers toward the base value
    c.spread += (c.spec.spread - c.spread) * clamp01(dt / c.spec.spreadRecover);

    if (c.reloading > 0) {
      const before = c.reloading;
      c.reloading -= dt;
      const t = 1 - c.reloading / c.spec.reloadTime;
      // three distinct mechanical sounds, not one "reload" blob
      if (c.reloadStage === 0 && t > 0.38) { c.reloadStage = 1; this.events.emit('reload', { stage: 'seat' }); }
      if (c.reloadStage === 1 && t > 0.78) { c.reloadStage = 2; this.events.emit('reload', { stage: 'charge' }); }
      if (c.reloading <= 0) {
        const want = c.spec.magazine - c.ammo;
        const take = Math.min(want, c.reserve);
        c.ammo += take; c.reserve -= take;
        c.reloading = 0;
      }
    }

    if (input.reloadPressed) this.startReload();

    if (canFire) {
      if (input.fire && c.cooldown <= 0 && c.reloading <= 0) {
        if (c.ammo > 0) this.fireCarbine(px, pz, aimX, aimZ);
        else if (input.firePressed) {
          this.events.emit('dryFire', {});
          if (c.reserve > 0) this.startReload();
        }
      }
      if (input.secondaryPressed && this.frag.cooldown <= 0 && this.frag.ammo > 0) {
        this.fireFrag(px, pz, aimX, aimZ, input.aimDist);
      }
    }

    // Auto-reload when empty: the operator would, and it removes a dead input.
    if (c.ammo === 0 && c.reloading <= 0 && c.reserve > 0) this.startReload();

    this.projectiles.update(dt);
  }

  fireCarbine(px, pz, aimX, aimZ) {
    const c = this.carbine;
    c.ammo--;
    c.cooldown = c.interval;
    c.shotsFired++;

    const spread = c.spread;
    const a = Math.atan2(aimZ, aimX) + this.rng.gauss(spread);
    const dx = Math.cos(a), dz = Math.sin(a);
    const muzzle = 0.75;
    const y = 1.18;
    this.projectiles.spawn(P_BULLET,
      px + dx * muzzle, y, pz + dz * muzzle,
      dx * c.spec.projectileSpeed, 0, dz * c.spec.projectileSpeed,
      {
        damage: c.spec.damage, team: 0, radius: 0.09,
        tracer: (c.shotsFired % c.spec.tracerEvery) === 0,
        life: 1.4,
      });

    c.spread = Math.min(c.spec.spreadMax, c.spread + c.spec.spreadPerShot);
    this.recoil = Math.min(1, this.recoil + c.spec.recoil * 6);

    this.events.emit('shot', {
      x: px + dx * muzzle, y, z: pz + dz * muzzle,
      dirX: dx, dirZ: dz, weapon: 'carbine',
      kick: c.spec.kick,
      lowAmmo: c.ammo <= 6,
      ammo: c.ammo,
    });
  }

  fireFrag(px, pz, aimX, aimZ, aimDist) {
    const f = this.frag;
    f.ammo--;
    f.cooldown = f.spec.cooldown;
    // Lob toward the cursor: the throw is aimed at a place, not a direction.
    const dist = clamp(aimDist, 4, 17);
    const speed = f.spec.projectileSpeed;
    const t = dist / speed;
    const vy = 0.5 * 22 * t + 1.2;    // solve for a landing near the cursor
    this.projectiles.spawn(P_GRENADE,
      px + aimX * 0.7, 1.1, pz + aimZ * 0.7,
      aimX * speed, vy, aimZ * speed,
      { damage: f.spec.damage, team: 0, radius: 0.2, life: f.spec.fuse, fuse: f.spec.fuse });
    this.events.emit('shot', {
      x: px, y: 1.1, z: pz, dirX: aimX, dirZ: aimZ, weapon: 'frag', kick: 0.22,
    });
  }
}
