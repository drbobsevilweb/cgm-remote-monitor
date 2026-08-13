// ENVIRONMENT — builds the physical station from the LEVEL data.
//
// Merged per room per material: culling works (each room has a real bounding
// sphere) and the whole sector still costs well under the draw-call budget.
// ENVIRONMENT owns geometry and materials; it never owns gameplay state.

import * as THREE from '../../vendor/three.module.js';
import { MeshBuilder } from './MeshBuilder.js';
import { buildTextures } from './Textures.js';
import { buildProp } from './Props.js';
import { PAL, TONES, toneOf } from './Palette.js';
import { CELL, C } from '../level/Grid.js';

export class Environment {
  constructor(sector, quality, rng, events) {
    this.sector = sector;
    this.quality = quality;
    this.rng = rng.child('environment');
    this.events = events;
    this.root = new THREE.Group();
    this.root.name = 'station';
    this.time = 0;

    this.textures = buildTextures(rng);
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
      flesh: std(t.flesh, {
        emissive: new THREE.Color(PAL.violet), emissiveMap: t.flesh.map,
        emissiveIntensity: 0.30, metalness: 0.0, roughness: 1,
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
    const failRate = room.tone === 'dark' ? 0.72 : room.tone === 'red' ? 0.34 : 0.12;
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
          color: room.lampColor, intensity: (highBay ? 1.45 : 1.0) * room.lampI,
          broken, alive: !broken,
          radius: highBay ? 15 : 9.5,
          hp: 8,
        });
      }
    }
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
   * Chorusflesh growing out of the nests and along the routes it uses. Reads as
   * inversion: violet organic climbing amber-lit structure.
   */
  buildFlesh() {
    const b = new MeshBuilder();
    const g = this.sector.grid;
    const rng = this.rng;
    for (const n of this.sector.spec.nests) {
      const cx = n.x, cz = n.z;
      const spread = n.type === 'brood' ? 6 : 7;
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

  /** Nest geometry, handed to the ENEMIES subsystem which owns nest state. */
  makeNestGeometry(type) {
    const b = new MeshBuilder();
    const rng = this.rng;
    if (type === 'brood') {
      // wall-mounted sack: a swollen mass with a puckered vent
      b.setColor(0.95, 0.9, 1.0);
      b.addCylinder(0, 0, 0, 1.45, 0.5, 12, true, false, 1);
      for (let i = 0; i < 9; i++) {
        const a = rng.angle(), r = rng.range(0.2, 1.15), h = rng.range(1.1, 2.6);
        b.addCylinder(Math.cos(a) * r, 0.3, Math.sin(a) * r, rng.range(0.45, 0.95), h, 8, true, false, 1);
      }
      b.setColor(1.0, 0.95, 1.0);
      b.addCylinder(0, 2.1, 0, 0.75, 0.9, 10, true, false, 1);
      b.addCylinder(0, 2.9, 0, 0.34, 0.5, 8, true, false, 1);
    } else {
      // vent colony: a low crown of chimneys over a burrow
      b.setColor(0.9, 0.85, 1.0);
      b.addCylinder(0, 0, 0, 2.1, 0.35, 14, true, false, 1);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const r = rng.range(0.6, 1.5);
        b.addCylinder(Math.cos(a) * r, 0.2, Math.sin(a) * r, rng.range(0.28, 0.55), rng.range(0.9, 2.2), 7, true, false, 1);
      }
      b.setColor(1.0, 0.92, 1.0);
      b.addCylinder(0, 0.3, 0, 0.9, 1.3, 10, true, false, 1);
    }
    b.setColor(1, 1, 1);
    return b.build('nest_' + type);
  }

  // ----------------------------------------------------------------- update
  update(dt, time, px, pz) {
    this.time = time;
    this.updateOverhead(px, pz);

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
    return true;
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
