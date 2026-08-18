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
import { Input, SCHEME } from '../input/Input.js';
import { Sector } from '../level/Sector.js';
import { HELIX_DEEP } from '../level/sectors/helix_deep.js';
import { Field } from '../level/Nav.js';
import { Environment } from '../environment/Build.js';
import { Lighting } from '../lighting/Lighting.js';
import { Vfx } from '../vfx/Vfx.js';
import { Audio } from '../audio/Audio.js';
import { Hud } from '../hud/Hud.js';
import { Player } from '../player/Player.js';
import { Weapons } from '../weapons/Weapons.js';
import { P_SPIT } from '../weapons/Projectiles.js';
import { Enemies, ARCHETYPES, KIND, ST } from '../enemies/Enemies.js';
import { Broods } from '../enemies/Broods.js';
import { Director } from '../director/Director.js';
import { Profiler } from '../qa/Profiler.js';
import { PAL, applyPaletteOverrides } from '../environment/Palette.js';
import { section, overridesActive } from '../core/Overrides.js';
import { CELL, C } from '../level/Grid.js';
import { clamp, clamp01 } from '../core/Mathx.js';

// Fire damage. The asymmetry is deliberate and documented in updateFires().
const FIRE_PLAYER_DPS = 3.5;     // a nuisance; acid, by comparison, is 9
const FIRE_CHORUS_DPS = 26;      // genuinely damaging
const FIRE_FLOOR = 0.30;         // never burns anything below 30% of its health

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
      // The anticipation window: how long the player had between the first
      // warning that something was there and the first thing reaching them.
      firstWarning: -1,
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
    // The IBL is a flat fill from every direction, so it is the one control that
    // can quietly undo an authored darkness: at 0.45 it was lifting every deck
    // plate in the sector to mid-grey and there was nothing for a light shaft or
    // a catwalk shadow to be a contrast against. It exists to stop metal being
    // black (see makeEnvironment), which it still does at less than half of that.
    this.renderer.scene.environmentIntensity = 0.20;
    this.setLoading(0.45, 'RESTORING POWER');
    await frame();

    this.lighting = new Lighting(this.renderer.scene, this.quality, this.sector, this.rng);
    this.lighting.registerLamps(this.env.lamps);
    this.env.registerBeacons(this.lighting);
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

    // Click-to-move pathing. Its own flow field, rebuilt only when the player
    // picks a new destination — the two fields LEVEL already owns are anchored
    // to the operator and rebuilt every tick, which is the wrong shape for a
    // goal that changes once a second at most.
    this.pointerField = new Field(this.sector.grid);
    this.pointerField.bakeCost(4);
    this.pointerGoalCell = -1;

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
    // A probe fire, so the flame material is compiled here rather than at the
    // moment a pressure tank goes up in the player's face (gate P7).
    this.fires.push({ x: this.player.x + 5, z: this.player.z + 5, r: 0.8, life: 1, age: 1, seed: 0.5 });
    this.vfx.drawFires(this.fires, 0);
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
    this.fires.length = 0;
    this.vfx.drawFires(this.fires, 0);
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
          // see Broods.hitTest: deliberately forgiving, and measured
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

  /**
   * Leave a few small fires where something burst.
   *
   * Deliberately sparse and deliberately small: two or three patches roughly a
   * metre across, not a carpet. A fire that fills the room is scenery and the
   * player learns to ignore it; a fire you have to step around is a hazard, and
   * a hazard is only interesting if there is floor next to it.
   */
  igniteAround(e) {
    const grid = this.sector.grid;
    const count = e.kind === 'tank' ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const a = this.rng.angle();
      const d = this.rng.range(0.4, e.radius * 0.55);
      const x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d;
      if (!grid.walkableCell(Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      if (this.fires.length >= 24) break;
      this.fires.push({
        x, z, r: this.rng.range(0.55, 0.95),
        life: this.rng.range(7, 12), age: 0, seed: this.rng.next(),
      });
    }
  }

  /**
   * Fire burns things. What it does NOT do is kill them.
   *
   *   PLAYER    a nuisance. It should make you move, not take the run off you,
   *             and stepping through a burning doorway must stay an option.
   *   CHORUS    genuinely damaging — far more than it is to the operator — but
   *             it will never take one below 30% of its health. Fire injures up
   *             to 70%, in proportion to how long something stood in it, and
   *             the last third has to be earned with the weapon.
   *
   * That asymmetry is the point. Fire is a tool for softening a room, not for
   * clearing it, so it can be generous without ever becoming the answer.
   */
  updateFires(dt) {
    const e = this.enemies;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      f.life -= dt;
      if (f.life <= 0) { this.fires.splice(i, 1); continue; }
      if (f.age < 0.25) continue;              // it has to catch before it burns

      if (this.player.alive &&
          Math.hypot(this.player.x - f.x, this.player.z - f.z) < f.r + 0.35) {
        this.player.damage(FIRE_PLAYER_DPS * dt, 0, 0);
      }

      e.hash.query(f.x, f.z, f.r + 0.8);
      const n = e.hash.resultCount;
      const res = e.hash.result;
      for (let k = 0; k < n; k++) {
        const idx = res[k];
        if (e.state[idx] === ST.DYING) continue;
        if (Math.hypot(e.x[idx] - f.x, e.z[idx] - f.z) > f.r + 0.45) continue;
        const floor = e.maxHp[idx] * FIRE_FLOOR;
        if (e.hp[idx] <= floor) continue;      // already burned as far as fire goes
        const take = Math.min(FIRE_CHORUS_DPS * dt, e.hp[idx] - floor);
        if (take <= 0) continue;
        e.hp[idx] -= take;
        e.flinch[idx] = Math.max(e.flinch[idx], 0.12);
      }
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

    // Withdrawal is an ACT, not a despawn. This event had no listener at all,
    // which is why the enemy had to be pushed off screen before it could be
    // honoured — a creature that simply stops existing in front of the player is
    // indistinguishable from a bug. It now goes down through the deck, and the
    // player gets to watch the room empty rather than find it emptied.
    ev.on('enemyWithdrew', (e) => {
      vfx.smoke(e.x, 0.35, e.z, 7, 1.5, 0.5, [0.30, 0.26, 0.34]);
      vfx.fluid(e.x, 0.3, e.z, 0, 0, 3, [0.5, 0.14, 0.55]);
      audio.impact({ x: e.x, z: e.z, surface: 'flesh' });
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
      this.igniteAround(e);
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

    // The walls know before the player does. The alarm goes up when she STIRS,
    // not when she wakes — so the corridor ahead is already red while she is
    // still only a sound, and the player gets to decide whether to walk into it.
    ev.on('queenStirred', (e) => {
      this.env.setAlarm(e.x, e.z, 34, true);
      // Sound before sight (the first thing that happens is that you hear her).
      audio.chorus(KIND.BULWARK, e.x, e.z, 'stir');
      // Her light swells once and settles: something in there moved.
      light.pulse(e.x, 1.2, e.z, PAL.violet, 700, 22, 0.9);
      this.events.emit('message', { text: 'MOVEMENT — BEARING UNCONFIRMED', tone: 'warn', ttl: 3.2 });
      // First, not latest: every queen stirs, and assigning unconditionally
      // left this holding the last one in the sector — a warning lead of minus
      // two minutes, which is the instrument reporting nonsense rather than the
      // game doing something strange.
      if (this.stats.firstWarning < 0) this.stats.firstWarning = this.clock.simTime;
    });
    ev.on('queenWoke', (e) => this.env.setAlarm(e.x, e.z, 34, true));
    ev.on('queenKilled', (e) => this.env.setAlarm(e.x, e.z, 34, false));

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
      const aliveNow = this.enemies.aliveNow || 0;
      this.stats.enemiesAtQueenDeath.push(aliveNow);
      // Arm the relief probe on the first queen death with enough of a room to
      // measure, not simply on the first one.
      //
      // It used to fire on death #1 unconditionally, and E3 showed what that was
      // worth: two of three seeds computed the ratio from a population of FOUR,
      // where the achievable values are 0, 0.25, 0.5, 0.75, 1 and the gate
      // threshold of 0.40 falls in a gap — one enemy either way decides pass or
      // fail. A gate that resolves to a coin toss is not measuring the game
      // (TEST_PLAN §2). Six is the smallest population where the resolution
      // (0.167) is finer than the distance from the threshold to the nearest
      // achievable value.
      if (this.stats.reliefRatio === undefined && !this._reliefProbe && aliveNow >= 6) {
        this._reliefProbe = { t: this.clock.simTime, before: aliveNow, nth: this.stats.queenDeaths.length };
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
    this.fires = [];
    this.pendingDetonations = [];
  }

  // ------------------------------------------------------- pointer navigation
  /**
   * Turn a clicked destination into a movement direction that respects walls.
   *
   * The field is rebuilt only when the destination cell changes. A goal on a
   * solid cell (the player clicked a wall, or a crate) snaps outward to the
   * nearest open cell rather than failing — clicking the wall beside a doorway
   * should walk you to the doorway, not refuse.
   */
  steerToward(goal, px, pz, out) {
    const grid = this.sector.grid;
    let cx = Math.floor(goal.x / CELL), cz = Math.floor(goal.z / CELL);
    if (!grid.inBounds(cx, cz)) return false;
    if (!grid.walkableCell(cx, cz)) {
      let found = false;
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (grid.walkableCell(cx + dx, cz + dz)) { cx += dx; cz += dz; found = true; }
          }
        }
      }
      if (!found) return false;
    }
    const cell = cz * grid.cols + cx;
    if (cell !== this.pointerGoalCell) {
      this.pointerGoalCell = cell;
      const src = this._pointerSrc || (this._pointerSrc = new Int32Array(1));
      src[0] = cell;
      this.pointerField.build(src, 1);
    }
    if (this.pointerField.sample(px, pz, out)) return true;
    // Inside the goal cell itself the field has no gradient; close the last
    // metre on the straight line.
    const dx = goal.x - px, dz = goal.z - pz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    out.x = dx / d; out.z = dz / d;
    return true;
  }

  /**
   * Is anything worth shooting on this bearing? Used by the touch scheme's
   * hold-to-fire assist.
   *
   * Deliberately generous on angle and strict on sight: a finger cannot aim to
   * a degree, but it should never be able to shoot something through a wall.
   */
  hostileInLine(px, pz, ax, az, maxDist = 26, cosTol = 0.90) {
    const grid = this.sector.grid;
    const e = this.enemies;
    const lined = (tx, tz) => {
      const dx = tx - px, dz = tz - pz;
      const d = Math.hypot(dx, dz);
      if (d > maxDist || d < 0.001) return false;
      if ((dx / d) * ax + (dz / d) * az < cosTol) return false;
      return grid.lineOfSight(px, pz, tx, tz);
    };
    for (let k = 0; k < e.list.count; k++) {
      const i = e.list.active[k];
      if (e.state[i] === 7 /* DYING */) continue;
      if (lined(e.x[i], e.z[i])) return true;
    }
    // Queens and clutches are targets too — a player holding on a clutch should
    // be shooting it, and it is the cheapest answer in the game.
    for (const q of this.broods.list) {
      if (q.alive && lined(q.x, q.z)) return true;
    }
    const b = this.broods;
    for (let i = 0; i < b.eggCount; i++) {
      if (b.eggAlive[i] && lined(b.eggX[i], b.eggZ[i])) return true;
    }
    return false;
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
    const inputFrame = this.input.sample(
      this.player.x, this.player.z,
      (x, y) => this.groundPick(x, y),
      (goal, px, pz, out) => this.steerToward(goal, px, pz, out),
      (px, pz, ax, az) => this.hostileInLine(px, pz, ax, az));
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

    this.updateFires(dt);

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
      const probe = this._reliefProbe;
      probe.after = this.enemies.aliveNow || 0;
      this.stats.reliefRatio = probe.after / probe.before;
      // Carried so the number is auditable: a ratio without its denominator is
      // not a measurement, it is a rumour.
      this.stats.reliefSample = { before: probe.before, after: probe.after, queen: probe.nth };
      this._reliefProbe = null;
    }

    if (input.interactPressed) this.interact();
    if (input.mapPressed) this.mapOpen = !this.mapOpen;
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
    this.vfx.drawFires(this.fires, time);
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
      // Where the operator has been told to walk. Without this, click-to-move
      // is a character wandering off for reasons the player has to remember.
      moveGoal: this.input.goal
        ? this.worldToScreen(this.input.goal.x, 0.05, this.input.goal.z) : null,
      scheme: this.input.scheme,
      assistFiring: !!this.input.assistFiring,
      map: this.mapOpen ? this.mapState() : null,
    };
  }

  /**
   * The schematic the player sees on M.
   *
   * Deliberately not a minimap: it is a station plan with the rooms as boxes,
   * and it exists to answer one question — where is the objective and how do I
   * get there. Rooms the player has not entered are drawn as outlines only, so
   * the plan fills in as they advance and the shape of the level is itself a
   * record of progress.
   */
  mapState() {
    const p = this.player;
    const sec = this.director ? this.director.section : null;
    const secRooms = new Set(sec ? sec.rooms : []);
    const rooms = this.sector.rooms.map((r) => ({
      id: r.id, name: r.name, x: r.x, z: r.z, w: r.w, h: r.h,
      kind: r.kind,
      seen: !!r.entered,
      active: secRooms.has(r.id),
    }));
    // Live sources, but only in rooms the player has already been in — the map
    // must not tell them what is waiting in a room they have not opened.
    const queens = this.broods.list
      .filter((q) => q.alive && this.sector.roomById.get(q.spec.room)?.entered)
      .map((q) => ({ x: q.x / CELL, z: q.z / CELL, type: q.type }));
    const doors = this.sector.doors.map((d) => ({
      x: d.wx / CELL, z: d.wz / CELL, state: d.state,
    }));
    // Where to go next: the nearest live source in the active section, or the
    // lift once they are all dead.
    let goal = null;
    if (sec && sec.clear === 'queens') {
      let best = null, bd = Infinity;
      for (const q of this.broods.list) {
        if (!q.alive || !secRooms.has(q.spec.room)) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd) { bd = d; best = q; }
      }
      if (best) goal = { x: best.x / CELL, z: best.z / CELL, label: 'SOURCE' };
    } else if (sec && sec.clear === 'exit') {
      const e = this.sector.spec.exit;
      goal = { x: e.x + e.w / 2, z: e.z + e.h / 2, label: 'LIFT' };
    } else if (sec && sec.next) {
      const list = this.sector.spec.sections || [];
      const nx = list.find((s) => s.id === sec.next);
      const room = nx && this.sector.roomById.get(nx.rooms[0]);
      if (room) goal = { x: room.x + room.w / 2, z: room.z + room.h / 2, label: room.name };
    }
    return {
      cols: this.sector.spec.cols, rows: this.sector.spec.rows,
      rooms, queens, doors, goal,
      player: { x: p.x / CELL, z: p.z / CELL, aimX: p.aimX, aimZ: p.aimZ },
      section: sec ? sec.name : '',
      objective: sec ? sec.objective.replace('{n}',
        String(this.director.sectionQueensLeft(sec))) : '',
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
