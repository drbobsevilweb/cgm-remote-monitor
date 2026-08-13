// WEAPONS — fire timing, recoil, spread, heat, specials. Owns the projectile pool.
//
// Every shot has consequence (DIRECTION §"COMBAT"): a muzzle flash event, a
// light pulse, camera kick, a case ejection, spread growth and an audible
// mechanical tail. WEAPONS emits those; VFX/AUDIO/LIGHTING listen.
//
// The primary is thermally limited, not magazine limited. The reason is that
// "am I out of ammo" is a question with one answer and it is asked at the worst
// possible moment — mid-fight, by a number in the corner of the screen. "How
// long can I keep this trigger down" is a question the player answers
// continuously, with their finger, against what is in front of them. The gun is
// never empty and never free.
//
//   heat 0 -> 1     builds per round, decays after `coolDelay` of not firing
//   heat hits 1     FORCED vent: a long lockout you did not choose
//   R               MANUAL vent: costs less the earlier you do it
//
// Specials (ARC LANCE) are the exception and keep real charges — see
// SPECIAL_SPECS in Operators.js for why.

import { WEAPON_SPECS, SPECIAL_SPECS } from '../player/Operators.js';
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
      heat: 0,
      cooldown: 0,
      interval: 60 / c.rpm,
      venting: 0,          // seconds left in the current vent
      ventTotal: 0,        // how long this vent was going to take
      forced: false,       // did the barrel decide, or did you?
      ventStage: 0,
      sinceShot: 99,
      heatAtVent: 0,
      spread: c.spread,
      shotsFired: 0,
      warned: false,
    };
    const f = WEAPON_SPECS.frag;
    this.frag = { spec: f, ammo: f.reserve, cooldown: 0 };

    this.special = null;       // { spec, charges, cooldown } while one is held
    this.coolBoost = 0;        // seconds of doubled cooling from a coolant flush
    this.recoil = 0;
    this.forcedVents = 0;      // QA counter: how often the barrel took over
    this.manualVents = 0;
  }

  // ------------------------------------------------------------------ state
  get heat() { return this.carbine.heat; }
  get heat01() { return clamp01(this.carbine.heat); }
  get venting() { return this.carbine.venting > 0; }
  get overheated() { return this.carbine.venting > 0 && this.carbine.forced; }
  get ventProgress() {
    const c = this.carbine;
    return c.venting > 0 ? 1 - c.venting / Math.max(0.01, c.ventTotal) : 1;
  }
  get grenades() { return this.frag.ammo; }
  get charges() { return this.special ? this.special.charges : 0; }
  get weaponName() {
    return this.special ? this.special.spec.name : this.carbine.spec.name;
  }
  /** True while the trigger will do something. Used by the HUD and the harness. */
  get ready() { return this.carbine.venting <= 0; }

  addGrenades(n) { this.frag.ammo = Math.min(this.frag.spec.reserve, this.frag.ammo + n); }

  /** A coolant canister: dumps the heat you have and helps with the next minute. */
  flushCoolant(seconds = 12) {
    const c = this.carbine;
    c.heat = 0;
    c.venting = 0;
    c.forced = false;
    c.warned = false;
    this.coolBoost = Math.max(this.coolBoost, seconds);
    this.events.emit('coolant', {});
    return true;
  }

  /** An ARC LANCE cell. Picking a second one up tops the charges back up. */
  giveSpecial(id, charges) {
    const spec = SPECIAL_SPECS[id];
    if (!spec) return false;
    if (this.special && this.special.spec.id === id) {
      this.special.charges = Math.min(spec.charges, this.special.charges + (charges ?? spec.charges));
    } else {
      this.special = { spec, charges: charges ?? spec.charges, cooldown: 0 };
    }
    this.events.emit('specialArmed', { id, charges: this.special.charges, name: spec.name });
    return true;
  }

  // ----------------------------------------------------------------- venting
  /**
   * Start a vent. `forced` is the barrel doing it for you at heat 1.0, and it
   * costs a flat, long lockout. A manual vent costs less the earlier you commit,
   * so the skill being asked for is "let go before you have to".
   */
  startVent(forced) {
    const c = this.carbine;
    const s = c.spec;
    if (c.venting > 0) return false;
    if (!forced && c.heat < s.ventFloor) return false;
    c.forced = forced;
    c.heatAtVent = c.heat;
    c.ventTotal = forced ? s.forcedVent : s.ventBase + c.heat * s.ventPerHeat;
    c.venting = c.ventTotal;
    c.ventStage = 0;
    if (forced) this.forcedVents++; else this.manualVents++;
    this.events.emit('vent', {
      stage: 'release', forced, heat: c.heat, duration: c.ventTotal,
    });
    return true;
  }

  update(dt, px, pz, aimX, aimZ, input, canFire) {
    const c = this.carbine;
    const s = c.spec;
    c.cooldown = Math.max(0, c.cooldown - dt);
    this.frag.cooldown = Math.max(0, this.frag.cooldown - dt);
    if (this.special) this.special.cooldown = Math.max(0, this.special.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 5.5);
    this.coolBoost = Math.max(0, this.coolBoost - dt);

    // spread recovers toward the base value, which itself rises with heat
    const base = s.spread + c.heat * s.spreadPerHeat;
    c.spread += (base - c.spread) * clamp01(dt / s.spreadRecover);

    if (c.venting > 0) {
      c.venting -= dt;
      const t = 1 - c.venting / Math.max(0.01, c.ventTotal);
      // The heat leaves over the whole vent, so the bar is the progress bar.
      c.heat = c.heatAtVent * (1 - clamp01(t));
      // three distinct mechanical sounds, not one "vent" blob
      if (c.ventStage === 0 && t > 0.34) { c.ventStage = 1; this.events.emit('vent', { stage: 'purge', forced: c.forced }); }
      if (c.ventStage === 1 && t > 0.80) { c.ventStage = 2; this.events.emit('vent', { stage: 'seat', forced: c.forced }); }
      if (c.venting <= 0) {
        c.venting = 0; c.heat = 0; c.forced = false; c.warned = false;
        this.events.emit('vent', { stage: 'ready' });
      }
    } else {
      c.sinceShot += dt;
      if (c.sinceShot > s.coolDelay && c.heat > 0) {
        const rate = s.coolRate * (this.coolBoost > 0 ? 2.0 : 1.0);
        c.heat = Math.max(0, c.heat - rate * dt);
        if (c.heat < s.warnHeat * 0.7) c.warned = false;
      }
      if (input.reloadPressed) this.startVent(false);
    }

    if (canFire) {
      const sp = this.special;
      if (sp && sp.charges > 0) {
        if (input.fire && sp.cooldown <= 0) this.fireSpecial(px, pz, aimX, aimZ);
      } else if (c.venting <= 0 && c.cooldown <= 0 && input.fire) {
        this.fireCarbine(px, pz, aimX, aimZ);
      } else if (c.venting > 0 && input.firePressed) {
        this.events.emit('dryFire', { forced: c.forced });
      }
      if (input.secondaryPressed && this.frag.cooldown <= 0 && this.frag.ammo > 0) {
        this.fireFrag(px, pz, aimX, aimZ, input.aimDist);
      }
    }

    this.projectiles.update(dt);
  }

  fireCarbine(px, pz, aimX, aimZ) {
    const c = this.carbine;
    const s = c.spec;
    c.cooldown = c.interval;
    c.shotsFired++;
    c.sinceShot = 0;

    const spread = c.spread;
    const a = Math.atan2(aimZ, aimX) + this.rng.gauss(spread);
    const dx = Math.cos(a), dz = Math.sin(a);
    const muzzle = 0.75;
    const y = 1.18;
    this.projectiles.spawn(P_BULLET,
      px + dx * muzzle, y, pz + dz * muzzle,
      dx * s.projectileSpeed, 0, dz * s.projectileSpeed,
      {
        damage: s.damage, team: 0, radius: 0.09,
        tracer: (c.shotsFired % s.tracerEvery) === 0,
        life: 1.4,
      });

    c.spread = Math.min(s.spreadMax + c.heat * s.spreadPerHeat, c.spread + s.spreadPerShot);
    this.recoil = Math.min(1, this.recoil + s.recoil * 6);

    c.heat += s.heatPerShot;
    const hot = c.heat >= s.warnHeat;
    if (hot && !c.warned) { c.warned = true; this.events.emit('heatWarning', { x: px, z: pz }); }

    this.events.emit('shot', {
      x: px + dx * muzzle, y, z: pz + dz * muzzle,
      dirX: dx, dirZ: dz, weapon: 'carbine',
      kick: s.kick,
      heat: clamp01(c.heat),
      hot,
    });

    // The barrel takes the decision away from you.
    if (c.heat >= 1) { c.heat = 1; this.startVent(true); }
  }

  fireSpecial(px, pz, aimX, aimZ) {
    const sp = this.special;
    const s = sp.spec;
    sp.charges--;
    sp.cooldown = 60 / s.rpm;

    const a = Math.atan2(aimZ, aimX) + this.rng.gauss(s.spread);
    const dx = Math.cos(a), dz = Math.sin(a);
    const muzzle = 0.85;
    const y = 1.18;
    this.projectiles.spawn(P_BULLET,
      px + dx * muzzle, y, pz + dz * muzzle,
      dx * s.projectileSpeed, 0, dz * s.projectileSpeed,
      { damage: s.damage, team: 0, radius: 0.16, tracer: true, pierce: s.pierce, life: 1.6 });

    this.recoil = Math.min(1, this.recoil + s.recoil * 6);
    this.events.emit('shot', {
      x: px + dx * muzzle, y, z: pz + dz * muzzle,
      dirX: dx, dirZ: dz, weapon: 'special', special: s.id,
      kick: s.kick, charges: sp.charges,
    });

    if (sp.charges <= 0) {
      this.events.emit('specialSpent', { id: s.id });
      this.special = null;
    }
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
