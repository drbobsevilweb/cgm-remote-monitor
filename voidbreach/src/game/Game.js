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
import { Broods } from '../enemies/Broods.js';
import { Director } from '../director/Director.js';
import { Profiler } from '../qa/Profiler.js';
import { PAL, applyPaletteOverrides } from '../environment/Palette.js';
import { section, overridesActive } from '../core/Overrides.js';
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
      queenDeaths: [], enemiesAtQueenDeath: [],
      eggsKilled: 0, ventsSealed: 0, forcedVents: 0,
    };
  }

  async boot() {
    const t0 = performance.now();
    // Studio overrides are applied before anything is built. They are ignored
    // entirely in deterministic runs, so the gates always measure what ships.
    applyPaletteOverrides(section('palette'));
    this.usingOverrides = overridesActive();
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

    this.broods = new Broods(this.sector, this.enemies, this.events, this.rng);
    this.broods.registerLights(this.lighting);
    this.renderer.scene.add(this.broods.root);
    this.env.buildVentSeals();

    this.pickups = this.buildPickups();
    this.director = new Director(this.sector, this.enemies, this.broods, this.events, this.rng);

    this.setLoading(0.72, 'PREWARMING');
    await frame();

    this.wireEvents();
    this.renderer.rig.snapTo(this.player.x, this.player.z);
    this.lighting.setRoom(this.sector.roomAtWorld(this.player.x, this.player.z));
    this.lighting.blend = 1; this.lighting.tone = this.lighting.targetTone;

    this.applyGradeOverrides(section('grade'));
    this.applyLightingOverrides(section('lighting'));

    this.prewarm();
    this.setLoading(1, 'READY');
    this.bootMs = performance.now() - t0;
    this.mode = 'play';
    this.renderer.markPrewarmComplete();
    return this;
  }

  setLoading(p, text) { this.loadProgress = p; this.loadingText = text; }

  /** Post-chain uniforms the Studio can drive (exposure, bloom, AgX look, grade). */
  applyGradeOverrides(o) {
    if (!o) return;
    const u = this.renderer.post.u;
    const num = (k, uni) => { if (typeof o[k] === 'number') u[uni].value = o[k]; };
    num('exposure', 'uExposure');
    num('bloomStrength', 'uBloomStrength');
    num('grain', 'uGrain');
    if (typeof o.vignette === 'number') this.baseVignette = o.vignette;
    num('aberration', 'uAberration');
    num('saturation', 'uSaturation');
    num('lookPower', 'uLookPower');
    num('lookSat', 'uLookSat');
    num('lookOffset', 'uLookOffset');
    num('lookSlope', 'uLookSlope');
    if (typeof o.bloomThreshold === 'number') {
      this.renderer.post.matBright.uniforms.uThreshold.value = o.bloomThreshold;
    }
    if (o.shadowTint) u.uShadowTint.value.set(o.shadowTint);
    if (o.highlightTint) u.uHighlightTint.value.set(o.highlightTint);
    if (typeof o.fogDensity === 'number') this.renderer.scene.fog.density = o.fogDensity;
    if (o.fogColour) this.renderer.scene.fog.color.set(o.fogColour);
  }

  /** Light levels the Studio can drive. */
  applyLightingOverrides(o) {
    if (!o) return;
    if (typeof o.ambientLevel === 'number') this.lighting.ambientLevel = o.ambientLevel;
    if (typeof o.flashIntensity === 'number') {
      this.lighting.flashIntensity = o.flashIntensity;
      this.lighting.flash.intensity = o.flashIntensity;
    }
    if (typeof o.lampIntensity === 'number') {
      for (const e of this.lighting.lampEmitters || []) {
        e.intensity = o.lampIntensity * (e.lamp ? e.lamp.intensity * e.lamp.intensity : 1);
      }
    }
    if (typeof o.envIntensity === 'number') this.renderer.scene.environmentIntensity = o.envIntensity;
  }

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
    for (const q of this.broods.list) q.group.visible = true;
    // Eggs are their own two materials and would otherwise compile the first
    // time a queen lays, which is exactly the moment that must not hitch.
    const probeEggs = [];
    for (const q of this.broods.list.slice(0, 1)) {
      const id = this.broods.layEgg(q, this.player.x + 5, this.player.z + 5, 0, 9, false);
      if (id >= 0) probeEggs.push(id);
    }
    this.broods.updateEggs(0.016, 0);
    if (this.env.ventSealMesh && this.sector.vents.length) {
      this.env.sealVent(this.sector.vents[0], 0);
    }

    r.compile(this.renderer.scene, this.renderer.camera);
    this.renderer.post.render(this.renderer.scene, this.renderer.camera);

    for (const id of probes) this.enemies.list.release(id);
    for (const id of probeEggs) this.broods.freeEgg(id);
    this.broods.updateEggs(0.016, 0);
    if (this.env.ventSealMesh && this.sector.vents.length) {
      const m4 = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
      this.env.ventSealMesh.setMatrixAt(0, m4);
      this.env.ventSealMesh.instanceMatrix.needsUpdate = true;
    }
    this.enemies.draw(1, 0);
    this.vfx.list.clear();
    this.vfx.tracerList.length = 0;
    this.vfx.screen.flash = 0; this.vfx.screen.shake = 0;
    // The prewarm frame is not part of the fiction: clear the scorch and fluid
    // it painted on the deck at the spawn point.
    for (const d of this.vfx.decals) { d.used = 0; d.cursor = 0; d.mesh.count = 0; }
  }

  // ------------------------------------------------------------- pickups
  /**
   * Pickups differ by SHAPE as well as by colour, because two of them are cyan
   * and a colourblind player still has to be able to tell an armour plate from a
   * coolant canister at eight metres under a red lamp. Each is still one
   * instanced draw call.
   */
  buildPickups() {
    const list = [];
    const meshes = {};
    const SPEC = {
      arc:     { colour: 0xffb45a, size: [0.50, 0.20, 0.26] },   // a flat cell
      coolant: { colour: 0xa8f0ff, size: [0.24, 0.52, 0.24] },   // a tall canister
      medkit:  { colour: 0xff5a5a, size: [0.40, 0.30, 0.40] },   // a case
      armour:  { colour: 0x5fd8ff, size: [0.52, 0.12, 0.44] },   // a plate
      flare:   { colour: 0xb8ff4a, size: [0.16, 0.44, 0.16] },   // a stick
    };
    for (const kind of Object.keys(SPEC)) {
      const sp = SPEC[kind];
      const mat = new THREE.MeshStandardMaterial({
        color: sp.colour, emissive: new THREE.Color(sp.colour), emissiveIntensity: 0.7,
        roughness: 0.5, metalness: 0.2,
      });
      const geom = new THREE.BoxGeometry(sp.size[0], sp.size[1], sp.size[2]);
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
      case 'arc':
        this.weapons.giveSpecial('arclance');
        this.weapons.addGrenades(1); break;
      case 'coolant':
        // Worth nothing when the barrel is already cold: leave it on the deck
        // so it is still there when it means something.
        if (this.weapons.heat < 0.25 && this.weapons.coolBoost > 0) return false;
        this.weapons.flushCoolant(12); break;
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
        for (const q of self.broods.list) {
          if (q.alive) check(q.x, q.z, q.type === 'matriarch' ? 2.0 : 1.7, q, 'queen');
        }
        const b = self.broods;
        for (let i = 0; i < b.eggCount; i++) {
          if (b.eggAlive[i]) check(b.eggX[i], b.eggZ[i], 0.44, i, 'egg');
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
        if (kind === 'queen') {
          self.broods.damageQueen(ref, amount, x, y, z, dirX, dirZ);
          self.vfx.fluid(x, y, z, -dirX, -dirZ, 4);
        } else if (kind === 'egg') {
          self.broods.damageEgg(ref, amount, x, y, z);
        } else if (kind === 'tank') {
          self.damageTank(ref, amount);
        }
      },
    };
  }

  /**
   * Blast damage against the brood. A frag in a clutch is meant to be the
   * strongest single answer in the game to a queen who has been laying for
   * twenty seconds, and a queen's hood does not stop a blast — explosions carry
   * no direction, so they are never reduced.
   */
  explodeBrood(e) {
    const b = this.broods;
    for (let i = b.eggCount - 1; i >= 0; i--) {
      if (!b.eggAlive[i]) continue;
      const d = Math.hypot(b.eggX[i] - e.x, b.eggZ[i] - e.z);
      if (d > e.radius) continue;
      b.damageEgg(i, e.power * (1 - clamp01(d / e.radius)), b.eggX[i], 0.4, b.eggZ[i]);
    }
    for (const q of b.list) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x - e.x, q.z - e.z);
      if (d > e.radius + 1.6) continue;
      b.damageQueen(q, e.power * 0.55 * (1 - clamp01(d / (e.radius + 1.6))), q.x, 1.6, q.z);
    }
    // Blasts strip grilles as well: a frag through a doorway can close a route.
    for (const v of this.sector.vents) {
      if (v.sealed) continue;
      if (Math.hypot(v.wx - e.x, v.wz - e.z) > e.radius) continue;
      this.sealVentAt(v.wx, v.wz, e.power * 0.5);
    }
  }

  /** Route damage into a wall grille, and put the plate up if that killed it. */
  damageVentCell(cx, cz, amount) {
    const v = this.sector.damageVent(cx, cz, amount);
    if (!v) return;
    this.env.sealVent(v, v.index);
    this.events.emit('ventSealed', { x: v.wx, z: v.wz, id: v.index });
  }

  sealVentAt(x, z, amount) {
    this.damageVentCell(Math.floor(x / CELL), Math.floor(z / CELL), amount);
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

    // --- thermal cycle -------------------------------------------------
    ev.on('vent', (e) => {
      audio.vent(e.stage, e.forced);
      if (e.stage === 'release') {
        const p = this.player;
        // A forced vent is a much bigger event than one you chose: the barrel
        // dumps in one go, and it should look like it hurt.
        vfx.smoke(p.x, 1.15, p.z, e.forced ? 16 : 7, e.forced ? 2.6 : 1.6, 0.55,
          [0.72, 0.78, 0.84]);
        light.pulse(p.x, 1.2, p.z, 0xbfe6ff, e.forced ? 220 : 90, 7, 0.22);
        if (e.forced) {
          cam.addShake(0.10);
          this.stats.forcedVents++;
          this.events.emit('message', { text: 'BARREL OVERHEAT — VENTING', tone: 'warn', ttl: 1.8 });
        }
      }
    });
    ev.on('heatWarning', (e) => audio.ui('heat'));
    ev.on('coolant', () => { vfx.screen.heal = 0.5; audio.ui('coolant'); });
    ev.on('specialArmed', (e) => {
      this.events.emit('message', { text: e.name + ' ARMED', tone: 'good', ttl: 2.4 });
    });
    ev.on('specialSpent', () => audio.ui('dry'));

    ev.on('impact', (e) => {
      vfx.impact(e); audio.impact(e);
      // A grille is a destructible, not a wall. Seal it and the Chorus has one
      // fewer bearing to come from — permanently, and because the player did it.
      if (e.surface === 'vent' && e.team === 0 && e.damage && e.cx >= 0) {
        this.damageVentCell(e.cx, e.cz, e.damage);
      }
    });

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
      this.explodeBrood(e);
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

    // --- queens and eggs -----------------------------------------------
    ev.on('queenDamaged', (e) => {
      if (e.blocked) {
        // Sparks off the hood, not fluid. The feedback has to be different or
        // the player never learns that the front of her does not count.
        vfx.sparks(e.x, e.y, e.z, 0, 0, 6, 0.9, [2.4, 2.0, 1.5]);
      } else {
        vfx.fluid(e.x, e.y, e.z, 0, 0, 5, [0.62, 0.14, 0.68]);
      }
      light.pulse(e.x, e.y, e.z, PAL.violet, 120, 8, 0.16);
    });

    ev.on('queenConvulsed', (e) => {
      light.pulse(e.x, 1.6, e.z, PAL.violet, 900, 18, 0.4);
      audio.chorus(KIND.BULWARK, e.x, e.z, 'windup');
    });

    ev.on('queenKilled', (e) => {
      vfx.nestRupture(e.x, e.y, e.z);
      light.pulse(e.x, 1.4, e.z, PAL.violet, 5200, 34, 0.8);
      cam.addShake(0.33);
      audio.nestRupture(e);
      this.stats.queenDeaths.push(this.clock.simTime);
      this.stats.enemiesAtQueenDeath.push(this.enemies.aliveNow || 0);
      if (this.stats.queenDeaths.length === 1) {
        this._reliefProbe = { t: this.clock.simTime, before: this.enemies.aliveNow || 0 };
      }
    });

    ev.on('eggLaid', (e) => {
      vfx.fluid(e.x, 0.35, e.z, 0, 0, 4, [0.6, 0.18, 0.66]);
    });

    ev.on('eggHatched', (e) => {
      vfx.fluid(e.x, 0.4, e.z, 0, 0, 7, [0.6, 0.18, 0.66]);
      light.pulse(e.x, 0.8, e.z, PAL.violet, 140, 9, 0.24);
    });

    ev.on('eggHit', (e) => vfx.fluid(e.x, e.y, e.z, 0, 0, 3, [0.62, 0.14, 0.68]));

    ev.on('eggDestroyed', (e) => {
      // A ripe egg bursts; a fresh one just splits. The difference is the
      // feedback for having got there in time.
      vfx.fluid(e.x, e.y, e.z, 0, 0, 8 + Math.round(e.ripe * 14), [0.62, 0.14, 0.68]);
      vfx.bloodDecal(e.x, e.z, 1.1 + e.ripe * 0.8, [0.42, 0.10, 0.46]);
      light.pulse(e.x, 0.6, e.z, PAL.violet, 180 + e.ripe * 320, 8, 0.2);
      audio.impact({ x: e.x, z: e.z, surface: 'flesh' });
      this.stats.eggsKilled++;
    });

    ev.on('eggCollapsed', (e) => {
      vfx.fluid(e.x, e.y, e.z, 0, 0, 4, [0.42, 0.12, 0.46]);
    });

    ev.on('ventSealed', (e) => {
      vfx.sparks(e.x, 1.0, e.z, 0, 0, 22, 1.5, [3.0, 2.2, 1.1]);
      light.pulse(e.x, 1.2, e.z, 0xffb45a, 420, 9, 0.34);
      audio.impact({ x: e.x, z: e.z, surface: 'grate' });
      this.stats.ventsSealed++;
      this.events.emit('message', { text: 'VENT SEALED', tone: 'good', ttl: 2 });
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
    this.broods.update(dt, time, this.player.x, this.player.z);
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
    post.uVignette.value = (this.baseVignette ?? 0.42) + (1 - p.health01) * 0.22;

    this.renderer.render(time);

    this.hud.update(realDelta);
    this.hud.draw(this.hudState(time));

    this.audio.update(realDelta, p.x, p.z, this.director ? this.director.intensity : 0,
      (this.enemies.aliveNow || 0) > 2 && this.broods.remaining > 0);

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
    if (!this.player || !this.broods) {
      return { mode: 'loading', loadProgress: this.loadProgress, loadingText: this.loadingText };
    }
    const p = this.player;
    const near = this.broods.nearest(p.x, p.z);
    let queenDir = null;
    if (near && near.dist > 12 && near.dist < 70) {
      queenDir = { x: (near.queen.x - p.x) / near.dist, z: (near.queen.z - p.z) / near.dist };
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
      heat01: this.weapons.heat01,
      venting: this.weapons.venting, overheated: this.weapons.overheated,
      ventProgress: this.weapons.ventProgress,
      hot: this.weapons.heat01 >= this.weapons.carbine.spec.warnHeat,
      coolBoost: this.weapons.coolBoost > 0,
      weaponName: this.weapons.weaponName,
      charges: this.weapons.special ? this.weapons.charges : null,
      grenades: this.weapons.grenades, dashReady: p.dashReady,
      spread: this.weapons.carbine.spread,
      queensRemaining: this.broods.remaining, queensTotal: this.broods.list.length,
      eggsAlive: this.broods.eggsAlive,
      queenDir, kills: this.stats.kills, time,
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
