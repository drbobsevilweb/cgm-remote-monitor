// GAME — the composition root. The only file allowed to know every subsystem.
//
// Frame order (ARCHITECTURE §2):
//   INPUT.sample -> [fixed steps: PLAYER, WEAPONS, ENEMIES, NESTS, DIRECTOR,
//                    LEVEL doors, VFX sim] -> LIGHTING -> ENVIRONMENT ->
//   RENDERER.render -> HUD -> AUDIO -> PROFILER

import * as THREE from '../../vendor/three.module.js';
import { Clock, DeterministicClock, STEP } from '../core/Clock.js';
import { Events } from '../core/Events.js';
import { Rng } from '../core/Rng.js';
import { Renderer } from '../renderer/Renderer.js';
import { pickQuality } from '../renderer/Quality.js';
import { Input } from '../input/Input.js';
import { Sector } from '../level/Sector.js';
import { HELIX_DEEP } from '../level/sectors/helix_deep.js';
import { Environment } from '../environment/Build.js';
import { Lighting } from '../lighting/Lighting.js';
import { Vfx } from '../vfx/Vfx.js';
import { Audio } from '../audio/Audio.js';
import { Hud } from '../hud/Hud.js';
import { Player } from '../player/Player.js';
import { Weapons } from '../weapons/Weapons.js';
import { P_SPIT } from '../weapons/Projectiles.js';
import { Enemies, ARCHETYPES, KIND } from '../enemies/Enemies.js';
import { Nests } from '../enemies/Nests.js';
import { Director } from '../director/Director.js';
import { Profiler } from '../qa/Profiler.js';
import { PAL } from '../environment/Palette.js';
import { CELL, C } from '../level/Grid.js';
import { clamp, clamp01 } from '../core/Mathx.js';

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.hudCanvas = opts.hudCanvas;
    this.deterministic = !!opts.deterministic;
    this.seed = opts.seed || 1337;
    this.mode = 'loading';
    this.loadProgress = 0;
    this.loadingText = 'BUILDING SECTOR';

    this.rng = new Rng(this.seed);
    this.events = new Events();
    this.clock = this.deterministic ? new DeterministicClock() : new Clock();
    this.quality = pickQuality(opts.quality);
    this.profiler = new Profiler();

    this.renderer = new Renderer(this.canvas, this.quality, this.rng, !!opts.capture);
    this.input = new Input(this.canvas);
    this.hud = new Hud(this.hudCanvas, this.events);
    this.audio = new Audio(this.events, this.rng);

    this._ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._pick = new THREE.Vector3();
    this._pickResult = { x: 0, z: 0 };
    this.cursorScreen = { x: 0, y: 0 };

    this.stats = {
      kills: 0, shotsFired: 0, damageTaken: 0,
      firstEnemySeen: -1, firstDamage: -1, peakEnemies: 0,
      nestDeaths: [], enemiesAtNestDeath: [],
    };
  }

  async boot() {
    const t0 = performance.now();
    this.sector = new Sector(HELIX_DEEP, this.events);
    const v = this.sector.validate();
    if (!v.ok) console.warn('[sector]', v.problems);
    this.setLoading(0.15, 'ASSEMBLING STRUCTURE');
    await frame();

    this.env = new Environment(this.sector, this.quality, this.rng, this.events);
    this.renderer.scene.add(this.env.root);
    this.renderer.scene.environment = Environment.makeEnvironment(this.renderer.renderer);
    this.renderer.scene.environmentIntensity = 0.45;
    this.setLoading(0.45, 'RESTORING POWER');
    await frame();

    this.lighting = new Lighting(this.renderer.scene, this.quality, this.sector, this.rng);
    this.lighting.registerLamps(this.env.lamps);
    this.vfx = new Vfx(this.renderer.scene, this.env.textures, this.quality, this.rng, this.events);

    this.weapons = new Weapons(this.sector, this.events, this.rng);
    this.player = new Player('assault', this.sector, this.weapons, this.events, this.rng);
    this.renderer.scene.add(this.player.rig);

    this.enemies = new Enemies(this.sector, this.events, this.rng, this.quality);
    this.enemies.player = this.player;
    this.renderer.scene.add(this.enemies.root);
    this.weapons.projectiles.targets = this.enemies.targetInterface(this.player);
    this.weapons.projectiles.obstacles = this.makeObstacleInterface();

    this.nests = new Nests(this.sector, this.enemies, this.events, this.rng, this.env);
    this.nests.registerLights(this.lighting);
    this.renderer.scene.add(this.nests.root);

    this.pickups = this.buildPickups();
    this.director = new Director(this.sector, this.enemies, this.nests, this.events, this.rng);

    this.setLoading(0.72, 'PREWARMING');
    await frame();

    this.wireEvents();
    this.renderer.rig.snapTo(this.player.x, this.player.z);
    this.lighting.setRoom(this.sector.roomAtWorld(this.player.x, this.player.z));
    this.lighting.blend = 1; this.lighting.tone = this.lighting.targetTone;

    this.prewarm();
    this.setLoading(1, 'READY');
    this.bootMs = performance.now() - t0;
    this.mode = 'play';
    this.renderer.markPrewarmComplete();
    return this;
  }

  setLoading(p, text) { this.loadProgress = p; this.loadingText = text; }

  /**
   * Compile every shader permutation the sector uses before play starts, so no
   * reveal costs a compilation hitch (gate P7). Rendering one off-screen frame
   * with everything visible is the only reliable way to do this in three.js.
   */
  prewarm() {
    const r = this.renderer.renderer;
    // force one instance of every enemy archetype and both nest types to exist
    const probes = [];
    for (let k = 0; k < ARCHETYPES.length; k++) {
      const id = this.enemies.spawn(k, this.player.x + 2 + k, this.player.z + 2);
      if (id >= 0) probes.push(id);
    }
    this.enemies.draw(1, 0);
    this.vfx.explosion(this.player.x + 3, 1, this.player.z + 3, 4, 40);
    this.vfx.nestRupture(this.player.x + 4, 1, this.player.z + 4);
    this.vfx.muzzle(this.player.x, 1.2, this.player.z, 1, 0);
    this.vfx.addTracer(this.player.x, 1.2, this.player.z, 1, 0, 4, [1, 1, 1]);
    this.vfx.update(0.016, 0);
    this.vfx.draw(this.renderer.camera);
    for (const n of this.nests.list) n.mesh.visible = true;

    r.compile(this.renderer.scene, this.renderer.camera);
    this.renderer.post.render(this.renderer.scene, this.renderer.camera);

    for (const id of probes) this.enemies.list.release(id);
    this.enemies.draw(1, 0);
    this.vfx.list.clear();
    this.vfx.tracerList.length = 0;
    this.vfx.screen.flash = 0; this.vfx.screen.shake = 0;
    // The prewarm frame is not part of the fiction: clear the scorch and fluid
    // it painted on the deck at the spawn point.
    for (const d of this.vfx.decals) { d.used = 0; d.cursor = 0; d.mesh.count = 0; }
  }

  // ------------------------------------------------------------- pickups
  buildPickups() {
    const geom = new THREE.BoxGeometry(0.44, 0.30, 0.44);
    const list = [];
    const meshes = {};
    const COL = { ammo: 0xffb45a, medkit: 0xff5a5a, armour: 0x5fd8ff, flare: 0xb8ff4a };
    for (const kind of Object.keys(COL)) {
      const mat = new THREE.MeshStandardMaterial({
        color: COL[kind], emissive: new THREE.Color(COL[kind]), emissiveIntensity: 0.7,
        roughness: 0.5, metalness: 0.2,
      });
      const items = this.env.pickups.filter((p) => p.kind === kind);
      const m = new THREE.InstancedMesh(geom, mat, Math.max(1, items.length));
      m.frustumCulled = false;
      m.count = items.length;
      m.castShadow = true;
      this.renderer.scene.add(m);
      meshes[kind] = { mesh: m, items };
      items.forEach((p, i) => list.push({ ...p, index: i, taken: false, mesh: m }));
    }
    this.pickupMeshes = meshes;
    return list;
  }

  /**
   * Collection is SIMULATION, not presentation. It used to live in present(),
   * which meant the test was only sampled once per rendered frame: at 60 steps
   * per frame the operator walked straight through a medkit without touching
   * it, and at a low frame rate a real player would too.
   */
  collectPickups() {
    if (!this.player.alive) return;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const dx = p.x - this.player.x, dz = p.z - this.player.z;
      if (dx * dx + dz * dz > 2.25) continue;      // 1.5 m
      if (!this.tryPickup(p)) continue;
      p.taken = true;
      p.dirty = true;
    }
  }

  /** Presentation only: bob, spin, and retire collected items. */
  updatePickups(dt, time) {
    const m4 = this._pickupM4 || (this._pickupM4 = new THREE.Matrix4());
    for (const p of this.pickups) {
      if (p.taken) {
        if (!p.dirty) continue;
        p.dirty = false;
        m4.makeScale(0.001, 0.001, 0.001);
        m4.setPosition(p.x, -5, p.z);
        p.mesh.setMatrixAt(p.index, m4);
        p.mesh.instanceMatrix.needsUpdate = true;
        continue;
      }
      m4.makeRotationY(time * 1.1 + p.index);
      m4.setPosition(p.x, 0.42 + Math.sin(time * 2 + p.index) * 0.07, p.z);
      p.mesh.setMatrixAt(p.index, m4);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  tryPickup(p) {
    switch (p.kind) {
      case 'ammo':
        if (this.weapons.reserve >= this.weapons.carbine.spec.reserve) return false;
        this.weapons.addAmmo(128); this.weapons.addGrenades(1); break;
      case 'medkit':
        if (this.player.health >= this.player.maxHealth) return false;
        this.player.heal(58); this.vfx.screen.heal = 1; break;
      case 'armour':
        if (this.player.armour >= this.player.maxArmour) return false;
        this.player.addArmour(40); break;
      case 'flare':
        this.player.flares++; break;
      default: return false;
    }
    this.events.emit('pickup', { kind: p.kind, x: p.x, z: p.z });
    return true;
  }

  // ------------------------------------------------------- obstacle testing
  /**
   * Nests, tanks and other free-standing destructibles are not in the collision
   * grid (they are not walls), so projectiles test them explicitly.
   */
  makeObstacleInterface() {
    const self = this;
    return {
      test(x0, z0, x1, z1, out) {
        let bestT = Infinity, hit = null;
        const dx = x1 - x0, dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const check = (cx, cz, r, ref, kind) => {
          const ox = cx - x0, oz = cz - z0;
          const proj = ox * ux + oz * uz;
          if (proj < -r || proj > len + r) return;
          const perp2 = (ox * ox + oz * oz) - proj * proj;
          if (perp2 > r * r) return;
          const t = proj - Math.sqrt(Math.max(0, r * r - perp2));
          if (t < bestT) { bestT = t; hit = { ref, kind, t: Math.max(0, t) }; }
        };
        for (const n of self.nests.list) {
          if (n.alive) check(n.x, n.z, n.type === 'brood' ? 1.7 : 2.1, n, 'nest');
        }
        for (let i = 0; i < self.env.tanks.length; i++) {
          const t = self.env.tanks[i];
          if (t.alive) check(t.x, t.z, 0.62, i, 'tank');
        }
        if (!hit) return false;
        out.x = x0 + ux * hit.t; out.z = z0 + uz * hit.t;
        out.kind = hit.kind; out.ref = hit.ref; out.t = hit.t;
        return true;
      },
      damage(kind, ref, amount, x, y, z, dirX, dirZ) {
        if (kind === 'nest') {
          self.nests.damage(ref, amount, x, y, z);
          self.vfx.fluid(x, y, z, -dirX, -dirZ, 4);
        } else if (kind === 'tank') {
          self.damageTank(ref, amount);
        }
      },
    };
  }

  damageTank(i, amount) {
    const t = this.env.tanks[i];
    if (!t || !t.alive) return;
    t.hp -= amount;
    t.leaking = 1;
    if (t.hp <= 0) {
      this.env.killTank(i);
      this.events.emit('tankDetonated', { x: t.x, z: t.z });
      this.events.emit('explosion', { x: t.x, y: 0.9, z: t.z, radius: 6.4, power: 130, kind: 'tank' });
    }
  }

  // ------------------------------------------------------------ event wiring
  wireEvents() {
    const ev = this.events;
    const vfx = this.vfx, light = this.lighting, audio = this.audio, cam = this.renderer.rig;

    ev.on('shot', (e) => {
      if (e.weapon === 'carbine') {
        vfx.muzzle(e.x, e.y, e.z, e.dirX, e.dirZ);
        vfx.shell(e.x, e.y, e.z, e.dirX, e.dirZ);
        light.pulse(e.x, e.y, e.z, 0xffd9a0, 260, 12, 0.055);
        cam.addKick(e.dirX, e.dirZ, e.kick);
        audio.shot(e);
        this.stats.shotsFired++;
      } else {
        light.pulse(e.x, e.y, e.z, 0xffd9a0, 90, 8, 0.05);
        cam.addKick(e.dirX, e.dirZ, e.kick);
        audio.shot(e);
      }
    });
    ev.on('dryFire', () => audio.ui('dry'));
    ev.on('reload', (e) => audio.reload(e.stage));

    ev.on('impact', (e) => { vfx.impact(e); audio.impact(e); });

    ev.on('enemyHit', (e) => {
      const a = ARCHETYPES[e.kind];
      vfx.fluid(e.x, e.y, e.z, -e.dirX, -e.dirZ, e.blocked ? 2 : 5,
        e.blocked ? [0.5, 0.5, 0.55] : [0.6, 0.14, 0.66]);
      if (e.blocked) vfx.sparks(e.x, e.y, e.z, -e.dirX, -e.dirZ, 5, 0.8, [2.6, 2.2, 1.6]);
    });

    ev.on('enemyDied', (e) => {
      const a = ARCHETYPES[e.kind];
      vfx.fluid(e.x, 0.5, e.z, e.dirX, e.dirZ, 14, [0.62, 0.14, 0.68]);
      vfx.bloodDecal(e.x, e.z, 1.6 + a.radius * 2, [0.42, 0.10, 0.46]);
      audio.chorus(e.kind, e.x, e.z, 'die');
      this.stats.kills++;
      if (e.elite) { cam.addShake(0.14); light.pulse(e.x, 1, e.z, PAL.violet, 200, 12, 0.5); }
    });

    ev.on('enemyWindup', (e) => audio.chorus(e.kind, e.x, e.z, 'windup'));
    ev.on('enemyLunge', (e) => audio.chorus(e.kind, e.x, e.z, 'lunge'));

    ev.on('spit', (e) => {
      this.weapons.projectiles.spawn(P_SPIT, e.x, e.y, e.z, e.vx, e.vy, e.vz,
        { damage: e.damage, team: 1, radius: 0.22, life: 4 });
      light.pulse(e.x, e.y, e.z, PAL.bile, 60, 7, 0.12);
    });

    ev.on('acidPool', (e) => {
      vfx.addDecal(3, e.x, e.z, e.radius * 2.2, this.rng.next() * 6.28, [0.55, 0.85, 0.16], 1);
      this.acidPools.push({ x: e.x, z: e.z, r: e.radius, life: e.ttl });
    });

    ev.on('explosion', (e) => {
      vfx.explosion(e.x, e.y, e.z, e.radius, e.power);
      light.pulse(e.x, e.y + 0.5, e.z, 0xffb060, 2400, 24, 0.42);
      cam.addShake(e.kind === 'tank' ? 0.30 : 0.20);
      audio.explosion(e);
      this.enemies.explode(e.x, e.z, e.radius, e.power);
      // chain: tanks detonate each other
      for (let i = 0; i < this.env.tanks.length; i++) {
        const t = this.env.tanks[i];
        if (!t.alive) continue;
        const d = Math.hypot(t.x - e.x, t.z - e.z);
        if (d < e.radius && this.sector.grid.lineOfSight(e.x, e.z, t.x, t.z)) {
          // Deterministic delay: scheduled on the sim clock, never on wall time.
          this.pendingDetonations.push({ tank: i, at: this.clock.simTime + this.rng.range(0.09, 0.22) });
        }
      }
      // break lamps in blast radius: the room gets darker where you fight
      this.env.lamps.forEach((l, i) => {
        if (!l.alive) return;
        if (Math.hypot(l.x - e.x, l.z - e.z) < e.radius * 0.9) {
          if (this.env.breakLamp(i)) light.killLampEmitter(l);
        }
      });
      // player takes blast damage too
      const pd = Math.hypot(this.player.x - e.x, this.player.z - e.z);
      if (pd < e.radius && this.player.alive) {
        const f = 1 - clamp01(pd / e.radius);
        const dx = pd > 0.01 ? (this.player.x - e.x) / pd : 0;
        const dz = pd > 0.01 ? (this.player.z - e.z) / pd : 1;
        this.player.damage(e.power * 0.34 * f * f, -dx, -dz);
      }
    });

    ev.on('nestDamaged', (e) => {
      vfx.fluid(e.x, e.y, e.z, 0, 0, 5, [0.62, 0.14, 0.68]);
      light.pulse(e.x, e.y, e.z, PAL.violet, 120, 8, 0.16);
    });

    ev.on('nestDestroyed', (e) => {
      vfx.nestRupture(e.x, e.y, e.z);
      light.pulse(e.x, 1.4, e.z, PAL.violet, 5200, 34, 0.8);
      cam.addShake(0.33);
      audio.nestRupture(e);
      this.stats.nestDeaths.push(this.clock.simTime);
      this.stats.enemiesAtNestDeath.push(this.enemies.aliveNow || 0);
      if (this.stats.nestDeaths.length === 1) {
        this._reliefProbe = { t: this.clock.simTime, before: this.enemies.aliveNow || 0 };
      }
    });

    ev.on('nestSpawn', (e) => {
      vfx.fluid(e.x, 0.4, e.z, 0, 0, 5, [0.6, 0.18, 0.66]);
      light.pulse(e.x, 0.8, e.z, PAL.violet, 90, 8, 0.22);
    });

    ev.on('playerHit', (e) => {
      vfx.screen.damage = Math.min(1, vfx.screen.damage + 0.55);
      cam.addShake(Math.min(0.16, e.dmg * 0.004));
      audio.hurt();
      this.stats.damageTaken += e.dmg;
      if (this.stats.firstDamage < 0) this.stats.firstDamage = this.clock.simTime;
    });

    ev.on('playerDied', () => { this.mode = 'dead'; this.deathTime = this.clock.simTime; });
    ev.on('exitReached', () => { if (this.mode === 'play') this.mode = 'won'; });

    ev.on('doorState', (e) => { if (e.state === 'cycling') audio.ui('door'); });
    ev.on('pickup', () => audio.ui('pickup'));
    ev.on('objective', () => audio.ui('objective'));
    ev.on('dash', (e) => {
      vfx.smoke(e.x, 0.25, e.z, 5, 2.2, 0.4, [0.28, 0.30, 0.34]);
    });

    this.acidPools = [];
    this.pendingDetonations = [];
  }

  // ---------------------------------------------------------------- picking
  groundPick(ndcX, ndcY) {
    this._ndc.set(ndcX, ndcY);
    this._ray.setFromCamera(this._ndc, this.renderer.camera);
    const hit = this._ray.ray.intersectPlane(this._ground, this._pick);
    if (hit) { this._pickResult.x = hit.x; this._pickResult.z = hit.z; }
    return this._pickResult;
  }

  // ------------------------------------------------------------------ frame
  frame(realDelta) {
    this.profiler.beginFrame();
    const steps = this.clock.begin(realDelta);
    const inputFrame = this.input.sample(this.player.x, this.player.z, (x, y) => this.groundPick(x, y));
    this.tickFrame(steps, inputFrame);
    this.profiler.endFrame(this.clock.realDelta);
  }

  /** Split out so the replay harness can inject its own InputFrame. */
  tickFrame(steps, inputFrame) {
    this.profiler.mark('sim');
    for (let s = 0; s < steps; s++) { this.step(STEP, inputFrame); this.clock.advance(); }
    this.profiler.measure('sim');

    const time = this.clock.simTime;
    this.profiler.mark('present');
    this.present(time, this.clock.realDelta);
    this.profiler.measure('present');
    this.clock.endFrame();
  }

  step(dt, input) {
    const time = this.clock.simTime;
    const playing = this.mode === 'play';

    if (playing) {
      this.player.update(dt, input, time);
      this.weapons.update(dt, this.player.x, this.player.z, this.player.aimX, this.player.aimZ,
        input, this.player.alive);
    } else {
      this.weapons.projectiles.update(dt);
    }

    this.sector.nav.update(dt, this.player.x, this.player.z, this.player.aimX, this.player.aimZ);
    this.enemies.update(dt, time);
    this.nests.update(dt, time, this.player.x, this.player.z);
    if (playing) this.director.update(dt, this.player, time);

    this.sector.update(dt, this.player.x, this.player.z,
      (x, z, r) => this.enemyNear(x, z, r));

    for (let i = this.pendingDetonations.length - 1; i >= 0; i--) {
      if (time >= this.pendingDetonations[i].at) {
        const d = this.pendingDetonations.splice(i, 1)[0];
        this.damageTank(d.tank, 999);
      }
    }

    // acid pools damage over time
    for (let i = this.acidPools.length - 1; i >= 0; i--) {
      const p = this.acidPools[i];
      p.life -= dt;
      if (p.life <= 0) { this.acidPools.splice(i, 1); continue; }
      if (this.player.alive && Math.hypot(this.player.x - p.x, this.player.z - p.z) < p.r) {
        this.player.damage(9 * dt, 0, 0);
      }
    }

    this.collectPickups();

    this.vfx.update(dt, time);
    this.vfx.spawnDust(dt, this.player.x, this.player.z, this.player.aimX, this.player.aimZ,
      this.player.lightOn);

    // QA stat: when was a threat first visible?
    if (this.stats.firstEnemySeen < 0 && this.enemies.aliveNow > 0) {
      const i = this.enemies.nearest(this.player.x, this.player.z, 30);
      if (i >= 0 && this.sector.grid.lineOfSight(this.player.x, this.player.z,
        this.enemies.x[i], this.enemies.z[i])) {
        this.stats.firstEnemySeen = time;
      }
    }
    if ((this.enemies.aliveNow || 0) > this.stats.peakEnemies) {
      this.stats.peakEnemies = this.enemies.aliveNow;
    }
    if (this._reliefProbe && time - this._reliefProbe.t >= 3) {
      this._reliefProbe.after = this.enemies.aliveNow || 0;
      this.stats.reliefRatio = this._reliefProbe.before > 0
        ? this._reliefProbe.after / this._reliefProbe.before : 0;
      this._reliefProbe = null;
    }

    if (input.interactPressed) this.interact();
  }

  enemyNear(x, z, r) {
    const n = this.enemies.hash.query(x, z, r);
    return n > 0;
  }

  interact() {
    // Everything interactive in the slice is proximity-driven; E is reserved for
    // the lift and for future console work.
    if (this.sector.exitReached) return;
  }

  present(time, realDelta) {
    const p = this.player;
    const room = this.sector.roomAtWorld(p.x, p.z);
    if (room) {
      this.lighting.setRoom(room);
      // Contextual distance: tight spaces pull in, big rooms open out.
      const wide = Math.min(room.w, room.h);
      this.renderer.rig.setZoomHint(wide <= 5 ? 15.2 : wide >= 18 ? 18.5 : 16.5);
    }

    this.renderer.rig.update(realDelta, p.x, p.z, p.aimX, p.aimZ,
      this.input.frame ? this.input.frame.aimDist : 6);
    if (this.vfx.screen.shake > 0) this.renderer.rig.addShake(this.vfx.screen.shake * 0.12);

    this.lighting.flashOn = p.lightOn && p.alive;
    this.lighting.update(realDelta, time, p.x, 1.2, p.z, p.aimX, p.aimZ, this.renderer.camera);

    this.env.update(realDelta, time, p.x, p.z);
    this.enemies.draw(this.clock.alpha, time);
    this.vfx.draw(this.renderer.camera);
    this.updatePickups(realDelta, time);
    this.drawTracers();

    const post = this.renderer.post.u;
    post.uDamage.value = Math.max(this.vfx.screen.damage, (1 - p.health01) * 0.28);
    post.uHeal.value = this.vfx.screen.heal;
    post.uFlash.value = this.vfx.screen.flash;
    post.uVignette.value = 0.42 + (1 - p.health01) * 0.22;

    this.renderer.render(time);

    this.hud.update(realDelta);
    this.hud.draw(this.hudState(time));

    this.audio.update(realDelta, p.x, p.z, this.director ? this.director.intensity : 0,
      (this.enemies.aliveNow || 0) > 2 && this.nests.remaining > 0);

    this.profiler.sample({
      calls: this.renderer.stats.calls,
      triangles: this.renderer.stats.triangles,
      enemies: this.enemies.aliveNow || 0,
      projectiles: this.weapons.projectiles.count,
      particles: this.vfx.particleCount || 0,
      lights: this.lighting.activeLights || 0,
      compilations: this.renderer.compilationsSinceMark,
    });
  }

  drawTracers() {
    const pr = this.weapons.projectiles;
    for (let k = 0; k < pr.list.count; k++) {
      const i = pr.list.active[k];
      if (!pr.tracer[i]) continue;
      const vx = pr.vx[i], vz = pr.vz[i];
      const len = Math.hypot(vx, vz) * 0.026;
      const l = Math.hypot(vx, vz) || 1;
      this.vfx.addTracer(pr.x[i], pr.y[i], pr.z[i], vx / l, vz / l, Math.max(1.2, len),
        pr.team[i] === 0 ? [2.4, 2.0, 1.1] : [1.4, 2.6, 0.5]);
    }
  }

  hudState(time) {
    if (!this.player || !this.nests) {
      return { mode: 'loading', loadProgress: this.loadProgress, loadingText: this.loadingText };
    }
    const p = this.player;
    const near = this.nests.nearest(p.x, p.z);
    let nestDir = null;
    if (near && near.dist > 12 && near.dist < 70) {
      nestDir = { x: (near.nest.x - p.x) / near.dist, z: (near.nest.z - p.z) / near.dist };
    }
    const screen = this.worldToScreen(
      p.x + p.aimX * (this.input.frame ? this.input.frame.aimDist : 6),
      1.0,
      p.z + p.aimZ * (this.input.frame ? this.input.frame.aimDist : 6));
    return {
      mode: this.mode,
      loadProgress: this.loadProgress, loadingText: this.loadingText,
      health: p.health, health01: p.health01,
      armour01: p.maxArmour ? p.armour / p.maxArmour : 0,
      ammo: this.weapons.ammo, reserve: this.weapons.reserve,
      weaponName: 'MK4 PULSE CARBINE',
      reloading: this.weapons.reloading, reloadProgress: this.weapons.reloadProgress,
      grenades: this.weapons.grenades, dashReady: p.dashReady,
      spread: this.weapons.carbine.spread,
      nestsRemaining: this.nests.remaining, nestsTotal: this.nests.list.length,
      nestDir, kills: this.stats.kills, time,
      cursorX: screen.x, cursorY: screen.y,
    };
  }

  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.renderer.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.hud.w,
      y: (-v.y * 0.5 + 0.5) * this.hud.h,
    };
  }

  resize(w, h, dpr) {
    this.renderer.setSize(w, h);
    this.hud.resize(w, h, dpr);
  }
}

function frame() {
  return new Promise((r) => (typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
}
