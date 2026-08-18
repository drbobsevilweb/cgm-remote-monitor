// ENVIRONMENT — builds the physical station from the LEVEL data.
//
// Merged per room per material: culling works (each room has a real bounding
// sphere) and the whole sector still costs well under the draw-call budget.
// ENVIRONMENT owns geometry and materials; it never owns gameplay state.

import * as THREE from '../../vendor/three.module.js';
import { MeshBuilder } from './MeshBuilder.js';
import { Webs } from './Webs.js';
import { buildTextures } from './Textures.js';
import { buildProp } from './Props.js';
import { PAL, TONES, toneOf } from './Palette.js';
import { CELL, C } from '../level/Grid.js';
import { section } from '../core/Overrides.js';

export class Environment {
  constructor(sector, quality, rng, events) {
    this.sector = sector;
    this.quality = quality;
    this.rng = rng.child('environment');
    this.events = events;
    this.root = new THREE.Group();
    this.root.name = 'station';
    this.time = 0;

    // Studio overrides, if any. Ignored in deterministic runs (Overrides.js).
    this.textures = buildTextures(rng, section('materials'));
    this.materials = this.makeMaterials();

    this.lamps = [];
    this.tanks = [];
    this.pickups = [];
    this.screens = [];
    this.emissives = [];
    this.steamVents = [];
    this.decalsStatic = [];
    this.doorMeshes = [];
    this.roomGroups = new Map();

    this.build();

    // Silk is authored from the same grid and hangs off the same architecture,
    // but it is its own engine: its own RNG stream, its own material, its own
    // simulation. ENVIRONMENT only owns where it lives in the scene graph.
    this.webs = new Webs(sector, quality, rng, events, this.textures);
    this.root.add(this.webs.root);
  }

  // -------------------------------------------------------------- materials
  makeMaterials() {
    const t = this.textures;
    const std = (tex, opts = {}) => new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normal,
      roughnessMap: tex.orm, metalnessMap: tex.orm, aoMap: tex.orm,
      roughness: 1, metalness: 1, vertexColors: true,
      normalScale: new THREE.Vector2(1, 1),
      ...opts,
    });
    const m = {
      steel: std(t.steel),
      deck: std(t.deck),
      painted: std(t.painted),
      ceramic: std(t.ceramic),
      hazard: std(t.hazard),
      // Chorusflesh reads much hotter now that the station around it is dark:
      // at 0.30 emissive against the old ambient it was violet, against this one
      // it was magenta, and magenta is not one of the six colours that mean
      // something (DIRECTION §5.5). Wet, dark, and lit by its own glow.
      flesh: std(t.flesh, {
        emissive: new THREE.Color(PAL.violet), emissiveMap: t.flesh.map,
        emissiveIntensity: 0.16, metalness: 0.0, roughness: 0.86,
        color: new THREE.Color(0x8f7f99),
      }),
      emissive: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }),
      screen: new THREE.MeshBasicMaterial({ map: t.screen, toneMapped: true }),
      pool: new THREE.MeshBasicMaterial({
        map: t.poolPlain, blending: THREE.AdditiveBlending,
        depthWrite: false, vertexColors: true, toneMapped: true,
      }),
      poolGrate: new THREE.MeshBasicMaterial({
        map: t.poolGrate, blending: THREE.AdditiveBlending,
        depthWrite: false, vertexColors: true, toneMapped: true,
      }),
    };
    for (const k of ['steel', 'deck', 'painted', 'ceramic', 'hazard']) {
      m[k].envMapIntensity = 0.55;
    }
    m.flesh.envMapIntensity = 0.2;
    return m;
  }

  /**
   * A tiny procedural environment so metal is not black. Without IBL, metalness
   * has no ambient response at all in a forward renderer — this is the cheapest
   * honest fix, not a bloom-shaped one.
   */
  static makeEnvironment(renderer) {
    const w = 32, h = 16;
    const data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      // cold ceiling, slightly warm deck bounce, dark band at the horizon
      const top = [0.045, 0.062, 0.095];
      const bottom = [0.055, 0.045, 0.035];
      const horizon = 1 - Math.abs(v - 0.5) * 2;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const k = v;
        data[i] = (top[0] * (1 - k) + bottom[0] * k) * (1 - horizon * 0.45);
        data[i + 1] = (top[1] * (1 - k) + bottom[1] * k) * (1 - horizon * 0.45);
        data[i + 2] = (top[2] * (1 - k) + bottom[2] * k) * (1 - horizon * 0.45);
        data[i + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    return rt.texture;
  }

  // ------------------------------------------------------------------ build
  build() {
    const s = this.sector, g = s.grid;

    for (const room of s.rooms) {
      const b = {
        steel: new MeshBuilder(), deck: new MeshBuilder(), painted: new MeshBuilder(),
        ceramic: new MeshBuilder(), flesh: new MeshBuilder(), hazard: new MeshBuilder(),
        // Overhead structure lives in its own mesh so it can be hidden for the
        // room the player occupies. Beams sit right under the high bays, so they
        // catch far more light than the deck and would otherwise slice the play
        // space into bright diagonal bars. Distant rooms keep theirs, which is
        // where the sense of enclosure actually comes from.
        overhead: new MeshBuilder(),
      };
      const ctx = {
        ...b, rng: this.rng, lamps: this.lamps, tanks: this.tanks,
        pickups: this.pickups, screens: this.screens, emissive: this.emissives,
        steamVents: this.steamVents, decalsStatic: this.decalsStatic,
      };
      const tone = toneOf(room);
      room.lampColor = tone.lamp;
      room.lampLight = tone.lampLight;
      room.lampI = tone.lampI;

      this.buildShell(room, b);
      this.buildStructure(room, b);
      this.buildRoomLighting(room, b, ctx);

      for (const p of s.spec.props) {
        if (p.x < room.x || p.x >= room.x + room.w || p.z < room.z || p.z >= room.z + room.h) continue;
        buildProp(p, ctx, room);
      }

      const group = new THREE.Group();
      group.name = room.id;
      const add = (builder, mat, cast, receive) => {
        if (builder.isEmpty) return;
        const mesh = new THREE.Mesh(builder.build(room.id), mat);
        mesh.castShadow = cast; mesh.receiveShadow = receive;
        group.add(mesh);
      };
      add(b.deck, this.materials.deck, false, true);
      add(b.steel, this.materials.steel, true, true);
      add(b.painted, this.materials.painted, true, true);
      add(b.ceramic, this.materials.ceramic, true, true);
      add(b.hazard, this.materials.hazard, true, true);
      add(b.flesh, this.materials.flesh, true, true);
      if (!b.overhead.isEmpty) {
        const oh = new THREE.Mesh(b.overhead.build(room.id + '_overhead'), this.materials.steel);
        oh.castShadow = false; oh.receiveShadow = true;
        oh.userData.overhead = true;
        group.add(oh);
        group.userData.overheadMesh = oh;
      }
      group.userData.room = room;
      this.root.add(group);
      this.roomGroups.set(room.id, group);
    }

    this.buildPits();
    this.buildBeacons();
    this.buildCatwalks();
    this.buildGrating();
    this.buildDoors();
    this.buildFlesh();
    this.buildInstanced();
  }

  /** Floors and the wall faces that border this room's floor. */
  buildShell(room, b) {
    const s = this.sector, g = s.grid;
    const ceil = room.ceil;
    const wallB = (room.kind === 'habitation' || room.kind === 'office') ? b.ceramic : b.steel;
    const grimeSeed = room.index * 17;

    for (let cz = room.z; cz < room.z + room.h; cz++) {
      for (let cx = room.x; cx < room.x + room.w; cx++) {
        if (!g.inBounds(cx, cz)) continue;
        const cell = g.cells[g.idx(cx, cz)];
        const x0 = cx * CELL, z0 = cz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;

        // Floor: deck plate. Grating cells get their floor from buildGrating.
        if (cell === C.FLOOR || cell === C.DOOR || cell === C.HAZARD || cell === C.PROP) {
          const v = 0.9 + this.rng.range(-0.06, 0.06);
          b.deck.setColor(v, v, v * 1.02);
          b.deck.addQuad(x0, 0, z0, x1, 0, z1, 0, 1, 0, 1);
          b.deck.setColor(1, 1, 1);
        }

        // Walls: emit a face for each solid neighbour of a walkable cell.
        if (!g.walkableCell(cx, cz) && cell !== C.DOOR) continue;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d], nz = cz + DZ[d];
          if (!g.inBounds(nx, nz)) continue;
          const nc = g.cells[g.idx(nx, nz)];
          if (nc !== C.WALL && nc !== C.VENT) continue;
          const shade = 0.94 + ((cx * 7 + cz * 13) % 5) * 0.022;
          wallB.setColor(shade, shade, shade);
          // Hull walls run to 12 m. The camera sits at 14.6 m, so a 3.2 m wall
          // at the edge of the station would show the player empty space.
          const hull = s.exterior && s.exterior[g.idx(nx, nz)];
          const top = hull ? Math.max(ceil, 12) : ceil;
          // face plane sits on the boundary, normal points into the room
          if (d === 0) wallB.addQuad(x1, 0, z0, x1, top, z1, -1, 0, 0, 1);
          if (d === 1) wallB.addQuad(x0, 0, z0, x0, top, z1, 1, 0, 0, 1);
          if (d === 2) wallB.addQuad(x0, 0, z1, x1, top, z1, 0, 0, -1, 1);
          if (d === 3) wallB.addQuad(x0, 0, z0, x1, top, z0, 0, 0, 1, 1);
          wallB.setColor(1, 1, 1);

          // kick plate: 350 mm of scuffed steel at the bottom of every wall
          const k = 0.35, o = 0.03;
          b.steel.setColor(0.72, 0.74, 0.78);
          if (d === 0) b.steel.addQuad(x1 - o, 0, z0, x1 - o, k, z1, -1, 0, 0, 2);
          if (d === 1) b.steel.addQuad(x0 + o, 0, z0, x0 + o, k, z1, 1, 0, 0, 2);
          if (d === 2) b.steel.addQuad(x0, 0, z1 - o, x1, k, z1 - o, 0, 0, -1, 2);
          if (d === 3) b.steel.addQuad(x0, 0, z0 + o, x1, k, z0 + o, 0, 0, 1, 2);
          b.steel.setColor(1, 1, 1);

          if (nc === C.VENT) this.buildVentFace(b, cx, cz, d, ceil);
        }
      }
    }
  }

  /**
   * Practical lighting, derived from the construction language rather than
   * scattered by hand: corridors get work lamps on the ribs at 5 m, large spans
   * get high bays on a 10 m grid, habitation gets 7.5 m strips. This is how the
   * facility would actually have been lit, and it is why the middle of a 65 m
   * cargo hall is not a black hole.
   *
   * Authored lamps in the sector data remain as accents and as the specific
   * failures the level design depends on (the dark coolant walk).
   */
  buildRoomLighting(room, b, ctx) {
    const g = this.sector.grid;
    const SPACING = {
      // Spacing is ~1.4x mounting height, which is what actually gives an
      // even floor. At 2x height the pools are hot and the gaps are black.
      corridor: 2, hall: 3, processing: 3, dock: 3, office: 3,
      habitation: 3, pump: 3, reactor: 3, coolant: 6,
    };
    const step = SPACING[room.kind] || 4;
    // Fraction of fixtures that failed. The deep station is not maintained.
    //
    // Raised across the board once the ambient came down. At 12% failure and
    // three-cell spacing every pool overlapped its neighbours and the bay was
    // evenly lit wall to wall — which is the one thing the direction says a bay
    // must never be (§5.2: pools of light with darkness between them, not a
    // wash). A third of the fixtures being dead is what makes the working ones
    // read as light sources rather than as an exposure setting.
    const failRate = room.tone === 'dark' ? 0.78 : room.tone === 'red' ? 0.46 : 0.34;
    const highBay = room.kind === 'hall' || room.kind === 'processing' || room.kind === 'reactor';
    const y = Math.min(room.ceil - 0.55, highBay ? 5.4 : 3.0);

    for (let cz = room.z + 1; cz < room.z + room.h - 1; cz += step) {
      for (let cx = room.x + 1; cx < room.x + room.w - 1; cx += step) {
        if (!g.walkableCell(cx, cz)) continue;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        let tooClose = false;
        for (const l of this.lamps) {
          if (Math.abs(l.x - x) < CELL * 1.6 && Math.abs(l.z - z) < CELL * 1.6) { tooClose = true; break; }
        }
        if (tooClose) continue;
        const broken = this.rng.bool(failRate);

        // fixture: a shallow reflector on a short drop
        b.steel.setColor(0.30, 0.32, 0.35);
        const w = highBay ? 0.55 : 0.42;
        b.steel.addBox(x - w, y, z - w * 0.5, x + w, y + 0.18, z + w * 0.5, 2);
        b.steel.addBox(x - 0.05, y + 0.18, z - 0.05, x + 0.05, room.ceil, z + 0.05, 3);
        b.steel.setColor(1, 1, 1);

        this.lamps.push({
          x, y: y - 0.03, z,
          color: room.lampColor, light: room.lampLight,
          intensity: (highBay ? 1.45 : 1.0) * room.lampI,
          broken, alive: !broken,
          radius: highBay ? 15 : 9.5,
          hp: 8,
        });
      }
    }
  }

  /**
   * WARNING BEACONS.
   *
   * Rotating hazard lights on brackets, over every bulkhead and every queen
   * chamber. They exist for two reasons and the second one is the real one:
   *
   *   1. They are the only moving light in the station, so a still frame of an
   *      empty corridor stops being a still frame.
   *   2. They CHANGE. Amber means the station is running its own emergency
   *      lighting the way it has for nineteen days. Red, sweeping faster, means
   *      the Chorus is up in this part of the sector. The player learns that
   *      pairing in about ninety seconds and thereafter reads the room they are
   *      walking into from the colour of the wall before they can see anything
   *      in it — which is DIRECTION §5.5 doing its actual job, rather than
   *      colour-coding an object that is already visible.
   *
   * Each beacon costs one draw call (its rotating sweep) plus a pooled emitter.
   * The housing is merged into the room mesh and costs nothing.
   */
  buildBeacons() {
    this.beacons = [];
    const sites = [];
    for (const d of this.sector.doors) {
      if (d.kind === 'bulkhead' || d.locked) sites.push({ x: d.wx, z: d.wz, kind: 'door' });
    }
    for (const q of this.sector.spec.queens) {
      sites.push({ x: (q.x + 0.5) * CELL, z: (q.z + 0.5) * CELL, kind: 'queen' });
    }

    const housing = new MeshBuilder();
    const sweepGeom = this.makeSweepGeometry();
    for (const site of sites) {
      // Mount it on the nearest wall face, looking into the room.
      const spot = this.wallMountNear(site.x, site.z, 9);
      if (!spot) continue;
      if (this.beacons.some((b) => Math.hypot(b.x - spot.x, b.z - spot.z) < 5)) continue;

      const y = 3.15;
      // bracket + hazard-striped collar, merged: static, so free
      housing.setColor(0.30, 0.32, 0.35);
      housing.addBox(spot.x - 0.14, y - 0.10, spot.z - 0.14, spot.x + 0.14, y + 0.10, spot.z + 0.14, 3);
      housing.addBox(spot.x - 0.05, y + 0.10, spot.z - 0.05, spot.x + 0.05, y + 0.42, spot.z + 0.05, 3);
      housing.setColor(1, 1, 1);

      const mat = new THREE.MeshBasicMaterial({
        map: this.textures.lightShaft,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        transparent: true, depthWrite: false, toneMapped: true,
      });
      mat.color.set(PAL.amber);
      const sweep = new THREE.Mesh(sweepGeom, mat);
      sweep.position.set(spot.x, y + 0.46, spot.z);
      sweep.frustumCulled = true;
      sweep.renderOrder = 6;
      this.root.add(sweep);

      this.beacons.push({
        x: spot.x, y: y + 0.46, z: spot.z, kind: site.kind,
        sweep, mat, phase: this.rng.next() * 6.28,
        alarm: 0, emitter: null,
      });
    }

    if (!housing.isEmpty) {
      const m = new THREE.Mesh(housing.build('beacon_housings'), this.materials.steel);
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m);
    }
  }

  /** The cone a rotating beacon throws: two crossed tapered blades. */
  makeSweepGeometry() {
    const b = new MeshBuilder();
    const rTop = 0.16, rBot = 1.5, drop = 2.4;
    b.setColor(1, 1, 1);
    for (let q = 0; q < 2; q++) {
      const a = (q / 2) * Math.PI;
      const dx = Math.cos(a), dz = Math.sin(a);
      b.addTaperedQuad(-dx * rTop, 0, -dz * rTop, dx * rTop, 0, dz * rTop,
        -dx * rBot, -drop, -dz * rBot, dx * rBot, -drop, dz * rBot);
    }
    // and a short one thrown forward, so the sweep is directional rather than
    // a symmetrical lamp that looks the same at every angle
    b.addTaperedQuad(-0.16, 0.02, 0, 0.16, 0.02, 0, -0.9, -0.5, 3.4, 0.9, -0.5, 3.4);
    return b.build('beacon_sweep');
  }

  /** Nearest solid wall cell with open floor beside it, for wall-mounted kit. */
  wallMountNear(x, z, maxCells) {
    const g = this.sector.grid;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let r = 1; r <= maxCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const wx = cx + dx, wz = cz + dz;
          if (!g.inBounds(wx, wz)) continue;
          const c = g.cells[g.idx(wx, wz)];
          if (c !== C.WALL) continue;
          for (let d = 0; d < 4; d++) {
            const fx = wx + DX[d], fz = wz + DZ[d];
            if (!g.walkableCell(fx, fz)) continue;
            return {
              x: (wx + 0.5) * CELL - DX[d] * (CELL / 2 - 0.22),
              z: (wz + 0.5) * CELL - DZ[d] * (CELL / 2 - 0.22),
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * CATWALKS — the DIRECTION §6 signature, seen from underneath.
   *
   * A high bay in a refinery has service walkways over it, and the reason they
   * matter here is not that you can see them: it is that the light has to come
   * through them. Every fixture in a bay with a catwalk over it throws a striped
   * shadow across the deck, and the shaft between the two is visibly sliced.
   *
   * Three pieces, built together because they are one fact about the room:
   *
   *   1. the catwalk itself, real geometry, in the OVERHEAD mesh so it is hidden
   *      for the room the player occupies (it would otherwise sit between the
   *      camera and the operator — that lesson is already paid for);
   *   2. the shadow it casts, as a MULTIPLY layer on the deck. It stays visible
   *      when the catwalk is hidden, which is the entire trick: the player sees
   *      the consequence of a structure they can also see, from the next room;
   *   3. the shaft of light between them, additive, striped by the same pattern.
   *
   * The shadow is baked at build time rather than shadow-mapped. There is one
   * shadow-casting light in the budget and it is the operator's (ARCHITECTURE
   * decision 5); a second one covering a 65 m bay would cost more than the whole
   * lighting system. What is lost is that the pattern does not shift as a lamp
   * swings. What is kept is that it is there at all, at 60 fps, on a laptop.
   */
  buildCatwalks() {
    const shadow = new MeshBuilder();
    const shafts = new MeshBuilder();
    this.catwalks = [];
    this.shaftRanges = [];

    for (const room of this.sector.rooms) {
      // Only bays tall enough to walk under. A 3 m corridor with a catwalk in it
      // is a crawlspace, and the shadow would land on the player's head.
      if (room.ceil < 5) continue;
      const group = this.roomGroups.get(room.id);
      if (!group) continue;
      const over = new MeshBuilder();

      const wide = room.w >= room.h;
      const y = Math.min(room.ceil - 1.9, 4.2);
      // One run down the long axis, offset off centre so it does not bisect the
      // room; a second on the far side if the bay is wide enough to need it.
      const lanes = (wide ? room.h : room.w) >= 14 ? [0.30, 0.72] : [0.38];

      for (const f of lanes) {
        const across = wide
          ? (room.z + room.h * f) * CELL
          : (room.x + room.w * f) * CELL;
        const a0 = wide ? room.x * CELL : room.z * CELL;
        const a1 = wide ? (room.x + room.w) * CELL : (room.z + room.h) * CELL;
        const halfW = 1.15;

        this.buildCatwalkRun(over, wide, across, a0, a1, y, halfW);
        this.buildCatwalkShadow(shadow, room, wide, across, a0, a1, y, halfW);
        this.catwalks.push({ room: room.id, wide, across, a0, a1, y, halfW });
      }

      if (!over.isEmpty) {
        const mesh = new THREE.Mesh(over.build(room.id + '_catwalk'), this.materials.steel);
        mesh.castShadow = false; mesh.receiveShadow = true;
        mesh.userData.overhead = true;
        group.add(mesh);
        // Hidden with the rest of the overhead structure for the occupied room.
        const prev = group.userData.overheadMesh;
        group.userData.overheadExtra = group.userData.overheadExtra || [];
        group.userData.overheadExtra.push(mesh);
        if (!prev) group.userData.overheadMesh = mesh;
      }

      this.buildShaftsForRoom(shafts, room, y);
    }

    if (!shadow.isEmpty) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.textures.catwalkShadow,
        blending: THREE.MultiplyBlending,
        // three requires this for MultiplyBlending and warns every frame without
        // it. The shadow carries no alpha of its own — the darkness is in RGB —
        // so premultiplied is exactly the right interpretation.
        premultipliedAlpha: true,
        transparent: true, depthWrite: false, vertexColors: true, toneMapped: false,
      });
      const mesh = new THREE.Mesh(shadow.build('catwalk_shadow'), mat);
      mesh.renderOrder = 2;      // after opaque deck, before additive shafts
      mesh.frustumCulled = false;
      this.catwalkShadowMesh = mesh;
      this.root.add(mesh);
    }
    if (!shafts.isEmpty) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.textures.lightShaft,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        transparent: true, depthWrite: false, vertexColors: true, toneMapped: true,
      });
      const mesh = new THREE.Mesh(shafts.build('light_shafts'), mat);
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      this.shaftMesh = mesh;
      this.root.add(mesh);
    }
  }

  /** Stringers, grating deck and a hazard-striped kick rail. */
  buildCatwalkRun(b, wide, across, a0, a1, y, halfW) {
    const PITCH = 0.28, BAR = 0.035;
    b.setColor(0.52, 0.54, 0.58);
    // stringers
    for (const sgn of [-1, 1]) {
      const c = across + sgn * halfW;
      if (wide) b.addBox(a0, y - 0.16, c - 0.06, a1, y + 0.02, c + 0.06, 1.5);
      else b.addBox(c - 0.06, y - 0.16, a0, c + 0.06, y + 0.02, a1, 1.5);
    }
    // the grating deck itself: real bars, real gaps, because the gaps are the
    // whole reason the thing is here
    b.setColor(0.62, 0.64, 0.68);
    for (let a = a0; a < a1; a += PITCH) {
      if (wide) b.addBox(a, y - 0.05, across - halfW, a + BAR, y, across + halfW, 1.5);
      else b.addBox(across - halfW, y - 0.05, a, across + halfW, y, a + BAR, 1.5);
    }
    // handrail uprights every 2 m, and the rail itself
    b.setColor(0.44, 0.46, 0.50);
    for (let a = a0 + 1; a < a1; a += 2.0) {
      for (const sgn of [-1, 1]) {
        const c = across + sgn * halfW;
        if (wide) b.addBox(a - 0.04, y, c - 0.04, a + 0.04, y + 0.95, c + 0.04, 3);
        else b.addBox(c - 0.04, y, a - 0.04, c + 0.04, y + 0.95, a + 0.04, 3);
      }
    }
    for (const sgn of [-1, 1]) {
      const c = across + sgn * halfW;
      if (wide) b.addBox(a0, y + 0.92, c - 0.05, a1, y + 1.0, c + 0.05, 1.5);
      else b.addBox(c - 0.05, y + 0.92, a0, c + 0.05, y + 1.0, a1, 1.5);
    }
    b.setColor(1, 1, 1);
  }

  /**
   * The shadow the run above throws, projected onto the deck.
   *
   * Two things make it read as light rather than as a sticker: the band is wider
   * than the catwalk (a lamp above a walkway magnifies it), and its darkness is
   * modulated per vertex by how close the nearest working fixture is. Where the
   * room is already black there is nothing to shadow, and a full-strength bar
   * there would look painted on.
   */
  buildCatwalkShadow(b, room, wide, across, a0, a1, y, halfW) {
    const g = this.sector.grid;
    const MAG = 1.55;                       // projection magnification
    const half = halfW * MAG;
    const STEP = 1.25;
    // Across the band, not one quad: a projected shadow has a penumbra at its
    // edges, and a single hard-edged rectangle reads as a sticker on the deck no
    // matter how good the texture inside it is. Three lanes, the outer two at a
    // fraction of the darkness, is enough to sell it at this camera distance.
    const LANES = [
      { t0: -1.00, t1: -0.62, k: 0.30 },
      { t0: -0.62, t1: 0.62, k: 1.00 },
      { t0: 0.62, t1: 1.00, k: 0.30 },
    ];
    const runLen = a1 - a0;
    for (let a = a0; a < a1; a += STEP) {
      const aEnd = Math.min(a + STEP, a1);
      const mid = (a + aEnd) / 2;
      // Fade out over the last 3 m at each end so the band does not stop dead.
      const endFade = Math.min(1, Math.min(mid - a0, a1 - mid) / 3.0);
      if (endFade <= 0.02) continue;
      for (const lane of LANES) {
        const c0 = across + half * lane.t0;
        const c1 = across + half * lane.t1;
        const cx0 = wide ? a : c0;
        const cx1 = wide ? aEnd : c1;
        const cz0 = wide ? c0 : a;
        const cz1 = wide ? c1 : aEnd;
        const mx = (cx0 + cx1) / 2, mz = (cz0 + cz1) / 2;
        if (!g.walkableCell(Math.floor(mx / CELL), Math.floor(mz / CELL))) continue;
        const lit = this.lampInfluence(mx, mz);
        const strength = lit * lane.k * endFade;
        if (strength < 0.04) continue;
        // 0.62 not 0.92: a shadow this dark stops being a shadow and becomes a
        // hole. It has to leave the deck texture legible inside it.
        const v = 1 - strength * 0.62;
        b.setColor(v, v, v * 1.04);
        // Bars run ACROSS the walkway, so the U axis has to follow the run.
        const T = 2.5;
        if (wide) b.addFloorQuadUV(cx0, cz0, cx1, cz1, 0.015, cx0 / T, cz0 / T, cx1 / T, cz1 / T);
        else b.addFloorQuadUV(cx0, cz0, cx1, cz1, 0.015, cz0 / T, cx0 / T, cz1 / T, cx1 / T);
      }
    }
    b.setColor(1, 1, 1);
  }

  /** 0..1: how strongly working fixtures light this point. */
  lampInfluence(x, z) {
    let best = 0;
    for (const l of this.lamps) {
      if (!l.alive) continue;
      const d = Math.hypot(l.x - x, l.z - z);
      const f = Math.max(0, 1 - d / (l.radius * 0.8)) * l.intensity;
      if (f > best) best = f;
    }
    return Math.min(1, best);
  }

  /**
   * A shaft per working fixture that has a catwalk under it. Built as a
   * four-quad cross rather than a cone: at a 62-degree camera a cross reads as
   * volume from every bearing the player can actually get to, and costs a third
   * of the fill rate.
   */
  buildShaftsForRoom(b, room, catY) {
    const tone = toneOf(room);
    const col = new THREE.Color(room.lampLight || tone.lampLight || 0xffffff);
    for (const l of this.lamps) {
      if (!l.alive) continue;
      if (l.x < room.x * CELL || l.x > (room.x + room.w) * CELL) continue;
      if (l.z < room.z * CELL || l.z > (room.z + room.h) * CELL) continue;
      if (l.y < catY + 0.6) continue;                 // fixture must be ABOVE it
      const near = this.nearestCatwalkDist(l.x, l.z);
      if (near > 3.4) continue;                       // and roughly over it

      const start = b.pos.length / 3;
      const top = l.y - 0.12;
      const bottom = 0.05;
      const rTop = 0.55, rBot = 3.1;
      // brightness: strong lamps in dark rooms, and never at full — a shaft that
      // competes with the fixture stops looking like air
      const k = 0.42 * l.intensity * (tone.level <= 0.14 ? 1.35 : 1.0);
      b.setColor(col.r * k, col.g * k, col.b * k);
      for (let q = 0; q < 4; q++) {
        const a = (q / 4) * Math.PI;
        const dx = Math.cos(a), dz = Math.sin(a);
        b.addTaperedQuad(
          l.x - dx * rTop, top, l.z - dz * rTop,
          l.x + dx * rTop, top, l.z + dz * rTop,
          l.x - dx * rBot, bottom, l.z - dz * rBot,
          l.x + dx * rBot, bottom, l.z + dz * rBot);
      }
      b.setColor(1, 1, 1);
      this.shaftRanges.push({ lamp: l, start, end: b.pos.length / 3 });
    }
  }

  nearestCatwalkDist(x, z) {
    let best = Infinity;
    for (const c of this.catwalks) {
      const along = c.wide ? x : z;
      if (along < c.a0 || along > c.a1) continue;
      const d = Math.abs((c.wide ? z : x) - c.across);
      if (d < best) best = d;
    }
    return best;
  }

  /** A wall vent: louvred grille the Chorus comes through. */
  buildVentFace(b, cx, cz, d, ceil) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    const ox = DX[d] * (CELL / 2 - 0.02), oz = DZ[d] * (CELL / 2 - 0.02);
    const along = d < 2 ? 'z' : 'x';
    b.steel.setColor(0.42, 0.44, 0.46);
    const w = 0.95, h = 1.25, y0 = 0.25;
    for (let i = 0; i < 7; i++) {
      const yy = y0 + (i / 7) * h;
      if (along === 'z') b.steel.addBox(x + ox - 0.06, yy, z - w, x + ox + 0.06, yy + 0.09, z + w, 3);
      else b.steel.addBox(x - w, yy, z + oz - 0.06, x + w, yy + 0.09, z + oz + 0.06, 3);
    }
    b.steel.setColor(0.25, 0.26, 0.28);
    if (along === 'z') b.steel.addBox(x + ox - 0.1, y0 - 0.12, z - w - 0.12, x + ox + 0.1, y0 + h + 0.14, z + w + 0.12, 2);
    else b.steel.addBox(x - w - 0.12, y0 - 0.12, z + oz - 0.1, x + w + 0.12, y0 + h + 0.14, z + oz + 0.1, 2);
    b.steel.setColor(1, 1, 1);
  }

  /** Ribs every 2.5 m, pipe trunks, cable trays and ceiling beams. */
  buildStructure(room, b) {
    const g = this.sector.grid;
    const ceil = room.ceil;
    const steel = b.steel;

    // Ribs on wall runs
    for (let cz = room.z; cz < room.z + room.h; cz++) {
      for (let cx = room.x; cx < room.x + room.w; cx++) {
        if (!g.walkableCell(cx, cz)) continue;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d], nz = cz + DZ[d];
          if (!g.inBounds(nx, nz)) continue;
          const nc = g.cells[g.idx(nx, nz)];
          if (nc !== C.WALL && nc !== C.VENT) continue;
          const x = cx * CELL, z = cz * CELL;
          steel.setColor(0.62, 0.64, 0.68);
          const t = 0.14, dpt = 0.30;
          if (d === 0) steel.addBox(x + CELL - dpt, 0, z, x + CELL, ceil, z + t, 2);
          if (d === 1) steel.addBox(x, 0, z, x + dpt, ceil, z + t, 2);
          if (d === 2) steel.addBox(x, 0, z + CELL - dpt, x + t, ceil, z + CELL, 2);
          if (d === 3) steel.addBox(x, 0, z, x + t, ceil, z + dpt, 2);
          steel.setColor(1, 1, 1);
        }
      }
    }

    // Roof trusses every 5 m — enclosure without a ceiling. Overhead mesh.
    const over = b.overhead;
    const wide = room.w >= room.h;
    const span = wide ? room.h : room.w;
    const runLen = (wide ? room.w : room.h);
    const bd = 0.36, bh = 0.5;
    over.setColor(0.42, 0.44, 0.47);
    for (let i = 2; i < runLen; i += 2) {
      if (wide) {
        const x = (room.x + i) * CELL;
        over.addBox(x - bd / 2, ceil - bh, room.z * CELL, x + bd / 2, ceil, (room.z + span) * CELL, 1.5);
      } else {
        const z = (room.z + i) * CELL;
        over.addBox(room.x * CELL, ceil - bh, z - bd / 2, (room.x + span) * CELL, ceil, z + bd / 2, 1.5);
      }
    }
    over.setColor(1, 1, 1);

    // Pipe trunk + cable tray hugging the wall. These run above head height, so
    // they belong to the overhead mesh too — but they hug the wall rather than
    // crossing the room, which is what keeps them from occluding play.
    if (room.kind === 'corridor' || room.kind === 'hall' || room.kind === 'processing' || room.kind === 'coolant') {
      const y = 2.62;
      over.setColor(0.5, 0.52, 0.54);
      if (wide) {
        const z = (room.z + 0.35) * CELL;
        over.addPipe(room.x * CELL, y, z, (room.x + room.w) * CELL, y, z, 0.16, 8, 1);
        over.addPipe(room.x * CELL, y - 0.36, z + 0.1, (room.x + room.w) * CELL, y - 0.36, z + 0.1, 0.10, 6, 1);
        over.setColor(0.3, 0.32, 0.34);
        over.addBox(room.x * CELL, 2.9, z + 0.3, (room.x + room.w) * CELL, 2.98, z + 0.7, 1.5);
      } else {
        const x = (room.x + 0.35) * CELL;
        over.addPipe(x, y, room.z * CELL, x, y, (room.z + room.h) * CELL, 0.16, 8, 1);
        over.addPipe(x + 0.1, y - 0.36, room.z * CELL, x + 0.1, y - 0.36, (room.z + room.h) * CELL, 0.10, 6, 1);
        over.setColor(0.3, 0.32, 0.34);
        over.addBox(x + 0.3, 2.9, room.z * CELL, x + 0.7, 2.98, (room.z + room.h) * CELL, 1.5);
      }
      over.setColor(1, 1, 1);
    }
  }

  /**
   * Hide overhead structure for the space the player is standing in, and for any
   * space close enough that its roof would cross the camera's view of the player.
   * Distant rooms keep theirs — that is where the enclosure reads from.
   */
  updateOverhead(px, pz) {
    for (const [id, group] of this.roomGroups) {
      const oh = group.userData.overheadMesh;
      if (!oh) continue;
      const r = group.userData.room;
      const x0 = r.x * CELL - 7, x1 = (r.x + r.w) * CELL + 7;
      const z0 = r.z * CELL - 7, z1 = (r.z + r.h) * CELL + 7;
      const inside = px > x0 && px < x1 && pz > z0 && pz < z1;
      oh.visible = !inside;
      // Catwalks hide with the trusses — they are the worst offender of the lot,
      // being both wide and low. Their SHADOW stays on the deck either way,
      // which is the point: the player reads the structure from the next room
      // and its consequence from underneath it.
      for (const m of group.userData.overheadExtra || []) m.visible = !inside;
    }
  }

  /** Pit interiors: the machinery you glimpse through the grating. */
  buildPits() {
    const b = new MeshBuilder();
    const deck = new MeshBuilder();
    for (const p of this.sector.pits) {
      const x0 = p.x * CELL, z0 = p.z * CELL;
      const x1 = (p.x + p.w) * CELL, z1 = (p.z + p.h) * CELL;
      const y = -p.depth;
      deck.setColor(0.55, 0.57, 0.6);
      deck.addQuad(x0, y, z0, x1, y, z1, 0, 1, 0, 1);
      deck.setColor(1, 1, 1);
      b.setColor(0.6, 0.62, 0.65);
      b.addQuad(x0, y, z0, x0, 0, z1, 1, 0, 0, 1);
      b.addQuad(x1, y, z0, x1, 0, z1, -1, 0, 0, 1);
      b.addQuad(x0, y, z0, x1, 0, z0, 0, 0, 1, 1);
      b.addQuad(x0, y, z1, x1, 0, z1, 0, 0, -1, 1);
      // kerb around the rim so the edge reads from above
      b.setColor(0.85, 0.72, 0.35);
      const k = 0.16;
      b.addBox(x0 - k, 0, z0 - k, x1 + k, 0.18, z0, 2);
      b.addBox(x0 - k, 0, z1, x1 + k, 0.18, z1 + k, 2);
      b.addBox(x0 - k, 0, z0, x0, 0.18, z1, 2);
      b.addBox(x1, 0, z0, x1 + k, 0.18, z1, 2);
      b.setColor(1, 1, 1);
      // machinery below: something worth revealing with a muzzle flash
      const rng = this.rng;
      for (let i = 0; i < 7; i++) {
        const mx = rng.range(x0 + 1.5, x1 - 1.5), mz = rng.range(z0 + 1.5, z1 - 1.5);
        const h = rng.range(0.8, p.depth * 0.8);
        b.setColor(0.4, 0.42, 0.45);
        b.addBox(mx - 0.9, y, mz - 0.9, mx + 0.9, y + h, mz + 0.9, 1.5);
        b.setColor(0.55, 0.57, 0.6);
        b.addPipe(mx, y + h * 0.6, mz, mx + rng.range(-3, 3), y + h * 0.6, mz + rng.range(-3, 3), 0.14, 6, 1);
        b.setColor(1, 1, 1);
      }
    }
    if (!deck.isEmpty) {
      const m = new THREE.Mesh(deck.build('pit_floor'), this.materials.deck);
      m.receiveShadow = true; this.root.add(m);
    }
    if (!b.isEmpty) {
      const m = new THREE.Mesh(b.build('pit_walls'), this.materials.steel);
      m.receiveShadow = true; m.castShadow = true; this.root.add(m);
    }
  }

  /**
   * GRATING — real bar geometry at 250 mm pitch (DIRECTION §6). This is the
   * signature: the flashlight throws a moving lattice through it, and a muzzle
   * flash briefly lights whatever is underneath.
   */
  buildGrating() {
    const b = new MeshBuilder();
    const PITCH = 0.25, BAR = 0.03, DEPTH = 0.05, CROSS = 1.0;
    for (const gr of this.sector.spec.grates) {
      const x0 = gr.x * CELL, z0 = gr.z * CELL;
      const x1 = (gr.x + gr.w) * CELL, z1 = (gr.z + gr.h) * CELL;
      const alongX = (x1 - x0) >= (z1 - z0);
      b.setColor(0.66, 0.68, 0.72);
      if (alongX) {
        for (let z = z0; z <= z1 - BAR; z += PITCH)
          b.addBox(x0, -DEPTH, z, x1, 0, z + BAR, 2);
        for (let x = x0; x <= x1 - BAR; x += CROSS)
          b.addBox(x, -DEPTH * 0.7, z0, x + BAR * 1.4, -DEPTH * 0.1, z1, 2);
      } else {
        for (let x = x0; x <= x1 - BAR; x += PITCH)
          b.addBox(x, -DEPTH, z0, x + BAR, 0, z1, 2);
        for (let z = z0; z <= z1 - BAR; z += CROSS)
          b.addBox(x0, -DEPTH * 0.7, z, x1, -DEPTH * 0.1, z + BAR * 1.4, 2);
      }
      // edge angle
      b.setColor(0.5, 0.52, 0.55);
      b.addBox(x0 - 0.06, -0.1, z0 - 0.06, x1 + 0.06, 0.02, z0, 2);
      b.addBox(x0 - 0.06, -0.1, z1, x1 + 0.06, 0.02, z1 + 0.06, 2);
      b.addBox(x0 - 0.06, -0.1, z0, x0, 0.02, z1, 2);
      b.addBox(x1, -0.1, z0, x1 + 0.06, 0.02, z1, 2);
      b.setColor(1, 1, 1);
    }
    const mesh = new THREE.Mesh(b.build('grating'), this.materials.steel);
    mesh.castShadow = true;      // this is the point of the whole feature
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.gratingMesh = mesh;
  }

  buildDoors() {
    for (const d of this.sector.doors) {
      const leaves = d.kind === 'bulkhead' ? 2 : 1;
      const group = new THREE.Group();
      const wide = d.w >= d.h;
      const width = (wide ? d.w : d.h) * CELL;
      const room = this.sector.roomById.get(d.room);
      const height = Math.min(3.0, room ? room.ceil - 0.2 : 3.0);
      for (let i = 0; i < leaves; i++) {
        const b = new MeshBuilder();
        const lw = width / leaves;
        b.setColor(0.55, 0.57, 0.6);
        b.addBox(-lw / 2, 0, -0.16, lw / 2, height, 0.16, 1.2);
        b.setColor(0.85, 0.7, 0.3);
        b.addBox(-lw / 2, height - 0.34, -0.19, lw / 2, height - 0.12, 0.19, 2);
        b.addBox(-lw / 2, 0.12, -0.19, lw / 2, 0.34, 0.19, 2);
        b.setColor(1, 1, 1);
        const mesh = new THREE.Mesh(b.build('door'), this.materials.steel);
        mesh.castShadow = true; mesh.receiveShadow = true;
        const sign = leaves === 1 ? 1 : (i === 0 ? -1 : 1);
        mesh.userData.slide = sign * (leaves === 1 ? width : width / 2);
        mesh.userData.home = (leaves === 1 ? 0 : sign * width / 4);
        group.add(mesh);
      }
      group.position.set(d.wx, 0, d.wz);
      group.rotation.y = wide ? 0 : Math.PI / 2;
      // frame
      const fb = new MeshBuilder();
      fb.setColor(0.45, 0.47, 0.5);
      const hw = width / 2 + 0.18;
      fb.addBox(-hw - 0.2, 0, -0.35, -hw, height + 0.3, 0.35, 1.5);
      fb.addBox(hw, 0, -0.35, hw + 0.2, height + 0.3, 0.35, 1.5);
      fb.addBox(-hw - 0.2, height, -0.35, hw + 0.2, height + 0.3, 0.35, 1.5);
      fb.setColor(1, 1, 1);
      const frame = new THREE.Mesh(fb.build('doorframe'), this.materials.steel);
      frame.castShadow = true; frame.receiveShadow = true;
      group.add(frame);

      // status light: red locked, amber cycling, cyan open
      const lightGeom = new THREE.PlaneGeometry(0.34, 0.10);
      const lightMat = new THREE.MeshBasicMaterial({ color: PAL.red, toneMapped: true });
      const light = new THREE.Mesh(lightGeom, lightMat);
      light.position.set(0, height + 0.14, 0.36);
      group.add(light);
      const light2 = light.clone();
      light2.material = lightMat;
      light2.position.set(0, height + 0.14, -0.36);
      light2.rotation.y = Math.PI;
      group.add(light2);

      this.root.add(group);
      this.doorMeshes.push({ door: d, group, statusMat: lightMat });
    }
  }

  /**
   * Chorusflesh growing out of the queens' chambers and along the routes the
   * Chorus uses. Reads as
   * inversion: violet organic climbing amber-lit structure.
   */
  buildFlesh() {
    const b = new MeshBuilder();
    const g = this.sector.grid;
    const rng = this.rng;
    for (const n of this.sector.spec.queens) {
      const cx = n.x, cz = n.z;
      const spread = n.type === 'matriarch' ? 7 : 6;
      for (let dz = -spread; dz <= spread; dz++) {
        for (let dx = -spread; dx <= spread; dx++) {
          const x = cx + dx, z = cz + dz;
          if (!g.inBounds(x, z)) continue;
          const d = Math.hypot(dx, dz);
          if (d > spread) continue;
          const density = 1 - d / spread;
          if (!rng.bool(density * density * 0.85)) continue;
          const wx = (x + 0.5) * CELL + rng.range(-1, 1);
          const wz = (z + 0.5) * CELL + rng.range(-1, 1);
          const cell = g.cells[g.idx(x, z)];
          if (cell === C.FLOOR || cell === C.GRATE) {
            // floor mat: flattened blobs
            const r = rng.range(0.5, 1.7) * (0.4 + density);
            b.setColor(0.8 + rng.range(-0.1, 0.1), 0.8, 0.9);
            b.addBoxRot(wx, 0.035, wz, r, 0.035, r * rng.range(0.6, 1.3), rng.angle(), 1);
            b.setColor(1, 1, 1);
            if (rng.bool(density * 0.35)) {
              // tendril climbing whatever is nearest
              const h = rng.range(0.6, 2.4) * density;
              b.addCylinder(wx, 0.0, wz, rng.range(0.06, 0.2), h, 6, true, false, 1);
            }
          } else if (cell === C.WALL || cell === C.VENT) {
            const h = rng.range(0.8, 2.8) * (0.5 + density);
            b.setColor(0.9, 0.85, 1.0);
            b.addBoxRot(wx, h / 2, wz, rng.range(0.5, 1.4), h / 2, rng.range(0.5, 1.4), rng.angle(), 1);
            b.setColor(1, 1, 1);
          }
        }
      }
    }
    if (!b.isEmpty) {
      const m = new THREE.Mesh(b.build('flesh'), this.materials.flesh);
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m);
      this.fleshMesh = m;
    }
  }

  // ------------------------------------------------------------- instanced
  buildInstanced() {
    // Lamp emissive panels
    const lampGeom = new THREE.BoxGeometry(0.76, 0.06, 0.24);
    this.lampMesh = new THREE.InstancedMesh(lampGeom, this.materials.emissive, Math.max(1, this.lamps.length));
    this.lampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lampMesh.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    this.lamps.forEach((l, i) => {
      m4.makeTranslation(l.x, l.y, l.z);
      this.lampMesh.setMatrixAt(i, m4);
      col.set(l.broken ? 0x000000 : l.color).multiplyScalar(l.broken ? 0 : 3.2 * l.intensity);
      this.lampMesh.setColorAt(i, col);
    });
    this.lampMesh.instanceMatrix.needsUpdate = true;
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
    this.root.add(this.lampMesh);

    // Light pools on the floor beneath each lamp
    const poolGeom = new THREE.PlaneGeometry(1, 1);
    poolGeom.rotateX(-Math.PI / 2);
    const grateLamps = [], plainLamps = [];
    for (const l of this.lamps) {
      (this.sector.grid.cellAtWorld(l.x, l.z) === C.GRATE ? grateLamps : plainLamps).push(l);
    }
    this.pools = [];
    for (const [list, mat, key] of [[plainLamps, this.materials.pool, 'plain'], [grateLamps, this.materials.poolGrate, 'grate']]) {
      const mesh = new THREE.InstancedMesh(poolGeom, mat, Math.max(1, list.length));
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      list.forEach((l, i) => {
        const s = l.radius * 1.5;
        m4.makeScale(s, 1, s);
        m4.setPosition(l.x, 0.03, l.z);
        mesh.setMatrixAt(i, m4);
        col.set(l.color).multiplyScalar(l.broken ? 0 : 0.14 * l.intensity);
        mesh.setColorAt(i, col);
        l.poolMesh = mesh; l.poolIndex = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.root.add(mesh);
      this.pools.push(mesh);
    }

    // Console screens
    const screenGeom = new THREE.PlaneGeometry(1, 1);
    this.screenMesh = new THREE.InstancedMesh(screenGeom, this.materials.screen, Math.max(1, this.screens.length));
    this.screenMesh.frustumCulled = false;
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    this.screens.forEach((s, i) => {
      pos.set(s.x, s.y, s.z);
      q.setFromEuler(new THREE.Euler(-0.85, s.rot, 0, 'YXZ'));
      sc.set(s.w, s.h, 1);
      m4.compose(pos, q, sc);
      this.screenMesh.setMatrixAt(i, m4);
    });
    this.screenMesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.screenMesh);

    // Emissive strips / signs / floor markers
    const stripB = new MeshBuilder();
    for (const e of this.emissives) {
      const c = new THREE.Color(e.color);
      stripB.setColor(c.r * 1.6, c.g * 1.6, c.b * 1.6);
      if (e.kind === 'floor') {
        stripB.addQuad(e.x - e.w / 2, e.y, e.z - e.h / 2, e.x + e.w / 2, e.y, e.z + e.h / 2, 0, 1, 0, 1);
      } else if (e.kind === 'strip') {
        if (e.axis === 'x') stripB.addQuad(e.x - 0.78, e.y - e.h / 2, e.z, e.x + 0.78, e.y + e.h / 2, e.z, 0, 0, 1, 1);
        else stripB.addQuad(e.x, e.y - e.h / 2, e.z - 0.78, e.x, e.y + e.h / 2, e.z + 0.78, 1, 0, 0, 1);
      } else {
        stripB.addQuad(e.x - e.w / 2, e.y - e.h / 2, e.z - 0.07, e.x + e.w / 2, e.y + e.h / 2, e.z - 0.07, 0, 0, -1, 1);
        stripB.addQuad(e.x - e.w / 2, e.y - e.h / 2, e.z + 0.07, e.x + e.w / 2, e.y + e.h / 2, e.z + 0.07, 0, 0, 1, 1);
      }
      stripB.setColor(1, 1, 1);
    }
    if (!stripB.isEmpty) {
      this.root.add(new THREE.Mesh(stripB.build('emissive'), this.materials.emissive));
    }

    // Pressure tanks — instanced so a detonation is a matrix write, not a rebuild
    const tb = new MeshBuilder();
    tb.setColor(0.62, 0.64, 0.66);
    tb.addCylinder(0, 0, 0, 0.5, 1.45, 12, true, true, 1.5);
    tb.setColor(0.95, 0.72, 0.22);
    tb.addCylinder(0, 0.55, 0, 0.53, 0.34, 12, false, false, 2);
    tb.setColor(0.85, 0.25, 0.18);
    tb.addCylinder(0, 1.45, 0, 0.26, 0.26, 8, true, false, 2);
    tb.setColor(1, 1, 1);
    const tankGeom = tb.build('tank');
    this.tankMesh = new THREE.InstancedMesh(tankGeom, this.materials.painted, Math.max(1, this.tanks.length));
    this.tankMesh.castShadow = true;
    this.tankMesh.frustumCulled = false;
    this.tanks.forEach((t, i) => {
      m4.makeRotationY(this.rng.angle());
      m4.setPosition(t.x, 0, t.z);
      this.tankMesh.setMatrixAt(i, m4);
      t.matrix = m4.clone();
    });
    this.tankMesh.instanceMatrix.needsUpdate = true;
    this.root.add(this.tankMesh);
  }

  /**
   * Seal plates for shot-out vents. One instanced mesh for the whole sector,
   * every instance parked at zero scale until its vent is actually sealed.
   */
  buildVentSeals() {
    const b = new MeshBuilder();
    b.setColor(0.34, 0.35, 0.37);
    b.addBox(-1.15, -0.86, -0.09, 1.15, 0.86, 0.09, 2);
    b.setColor(0.55, 0.44, 0.20);
    for (let i = -1; i <= 1; i += 2) {
      b.addBox(i * 1.0 - 0.07, -0.78, -0.13, i * 1.0 + 0.07, 0.78, 0.13, 3);
    }
    b.setColor(1, 1, 1);
    const geom = b.build('vent_seal');
    const mesh = new THREE.InstancedMesh(geom, this.materials.steel, Math.max(1, this.sector.vents.length));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const m4 = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, m4);
    mesh.instanceMatrix.needsUpdate = true;
    this.ventSealMesh = mesh;
    this.root.add(mesh);
    return mesh;
  }

  /** Drop a seal plate over a vent that has been shot out. */
  sealVent(vent, index) {
    if (!this.ventSealMesh) return;
    const yaw = Math.atan2(-FACE_DIR[vent.face][0], -FACE_DIR[vent.face][1]);
    const m4 = new THREE.Matrix4();
    m4.makeRotationY(yaw);
    m4.setPosition(
      vent.wx + FACE_DIR[vent.face][0] * -(CELL / 2 - 0.14),
      0.98,
      vent.wz + FACE_DIR[vent.face][1] * -(CELL / 2 - 0.14));
    this.ventSealMesh.setMatrixAt(index, m4);
    this.ventSealMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * LIGHTING adopts each beacon as a pooled emitter. They are low priority by
   * design — a warning light is meant to be seen, not to light the room.
   */
  registerBeacons(lighting) {
    for (const b of this.beacons || []) {
      b.emitter = lighting.addEmitter({
        x: b.x, y: b.y - 0.3, z: b.z, color: PAL.amber, intensity: 22, radius: 7.5,
      });
    }
    this.beaconLighting = lighting;
  }

  /**
   * Raise or clear the alarm in a radius. GAME calls this when a queen wakes and
   * when one dies, so the walls in a sector tell the truth about it.
   */
  setAlarm(x, z, radius, on) {
    for (const b of this.beacons || []) {
      if (Math.hypot(b.x - x, b.z - z) > radius) continue;
      b.alarmTarget = on ? 1 : 0;
    }
  }

  updateBeacons(dt, time) {
    const amber = new THREE.Color(PAL.amber);
    const red = new THREE.Color(PAL.red);
    for (const b of this.beacons || []) {
      const want = b.alarmTarget || 0;
      b.alarm += (want - b.alarm) * Math.min(1, dt * 1.6);
      // Faster sweep under alarm. The rate change is doing as much work as the
      // colour: it is legible in peripheral vision, and colour is not.
      const rate = 1.15 + b.alarm * 1.9;
      b.sweep.rotation.y = b.phase + time * rate;
      // Beacons flash rather than glow: a rotating reflector is dark for most of
      // its revolution from any one viewpoint.
      const pulse = 0.42 + 0.58 * Math.pow(Math.max(0, Math.sin(b.phase + time * rate)), 6);
      b.mat.color.copy(amber).lerp(red, b.alarm).multiplyScalar(0.55 + pulse * 0.75);
      if (b.emitter) {
        b.emitter.intensity = (9 + pulse * 26) * (1 + b.alarm * 0.7);
        b.emitter.color = b.alarm > 0.5 ? PAL.red : PAL.amber;
      }
    }
  }

  // ----------------------------------------------------------------- update
  update(dt, time, px, pz) {
    this.time = time;
    this.updateOverhead(px, pz);
    // Wind and the overhead dissolve only — silk's BURNING runs on the fixed
    // step from GAME, because it does damage and damage cannot live here.
    this.webs.present(time, px, 0, pz);
    this.updateBeacons(dt, time);

    // Doors slide. Bulkheads part in two, service doors slide aside.
    for (const dm of this.doorMeshes) {
      const d = dm.door;
      const t = d.open01;
      let i = 0;
      for (const child of dm.group.children) {
        if (child.userData.slide === undefined) continue;
        child.position.x = child.userData.home + child.userData.slide * t * 0.92;
        i++;
      }
      const locked = d.state === 'locked';
      const c = locked ? PAL.red : (t > 0.5 ? PAL.cyan : PAL.amber);
      dm.statusMat.color.set(c);
      const pulse = locked ? (0.6 + 0.4 * Math.sin(time * 5)) : 1;
      dm.statusMat.color.multiplyScalar(pulse * 2.2);
    }

    // The Chorus breathes. One shared phase: it is a single organism.
    const breathe = 0.30 + 0.22 * (0.5 + 0.5 * Math.sin(time * 1.15));
    this.materials.flesh.emissiveIntensity = breathe;

    // Lamp flicker: only lamps authored as failing, and only on the engine clock.
    if (this.lampMesh && this.lampMesh.instanceColor) {
      let dirty = false;
      const col = new THREE.Color();
      for (let i = 0; i < this.lamps.length; i++) {
        const l = this.lamps[i];
        if (!l.alive) continue;
        if (l.flickerUntil !== undefined && time < l.flickerUntil) {
          const f = Math.sin(time * 47 + i) > 0.1 ? 1 : 0.15;
          col.set(l.color).multiplyScalar(3.2 * l.intensity * f);
          this.lampMesh.setColorAt(i, col);
          dirty = true;
        }
      }
      if (dirty) this.lampMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Called by WEAPONS via the event bus when a lamp is destroyed. */
  breakLamp(index) {
    const l = this.lamps[index];
    if (!l || !l.alive) return false;
    l.alive = false;
    const col = new THREE.Color(0x000000);
    this.lampMesh.setColorAt(index, col);
    this.lampMesh.instanceColor.needsUpdate = true;
    if (l.poolMesh) {
      l.poolMesh.setColorAt(l.poolIndex, col);
      l.poolMesh.instanceColor.needsUpdate = true;
    }
    // The shaft under it goes out with it. Shooting the lights out has always
    // made the room darker; now it also takes the volume out of the air, which
    // is a much bigger change to how the space reads than the floor pool was.
    this.killShaft(l);
    return true;
  }

  /** Zero a lamp's shaft vertices in place — no rebuild, no extra draw call. */
  killShaft(lamp) {
    if (!this.shaftMesh || !this.shaftRanges) return;
    const range = this.shaftRanges.find((r) => r.lamp === lamp);
    if (!range) return;
    const attr = this.shaftMesh.geometry.getAttribute('color');
    for (let i = range.start; i < range.end; i++) attr.setXYZ(i, 0, 0, 0);
    attr.needsUpdate = true;
  }

  killTank(index) {
    const t = this.tanks[index];
    if (!t || !t.alive) return false;
    t.alive = false;
    const m4 = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
    m4.setPosition(t.x, 0, t.z);
    this.tankMesh.setMatrixAt(index, m4);
    this.tankMesh.instanceMatrix.needsUpdate = true;
    return true;
  }
}

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

// Which way a wall-mounted feature sits, keyed the same way the sector spec is.
const FACE_DIR = { 'x-': [-1, 0], 'x+': [1, 0], 'z-': [0, -1], 'z+': [0, 1] };
