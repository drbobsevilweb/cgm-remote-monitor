# VOIDBREACH — ARCHITECTURE

Authoritative document for **subsystem ownership**, **dependency rules** and the
**determinism contract**. Code that violates this document is a bug even if it works.

---

## 1. TECHNOLOGY DECISIONS (and why)

| Decision | Choice | Reason |
|----------|--------|--------|
| Renderer | **three.js r185, WebGLRenderer (WebGL2)** | Stable, universally available, mature shadow + instancing path. WebGPU offers no measured advantage for this workload (few hundred draw calls, CPU-bound simulation) and costs browser reach. Re-evaluate only with a measurement that shows a win. |
| Modules | Native ES modules, no bundler | Zero build step; open `index.html` and it runs. Vendored `three.module.js`. |
| Dependencies | **three.js only** (runtime) | Playwright is dev-only, for QA capture. |
| Assets | **Zero binary assets** | All textures procedurally generated to canvas at boot; all geometry procedurally built; all audio synthesised in WebAudio. Guarantees deterministic content and instant load. |
| Post-processing | **Hand-written composer** | 4 passes, full control over bloom/tonemap/grade coupling (DIRECTION §9). `EffectComposer` + `UnrealBloomPass` would add dependency surface for less control. |
| Physics | **Custom, grid-based** | Circle-vs-cell collision + spatial hash. A physics library is dead weight for a game whose entire physical vocabulary is "circles that cannot walk through walls". |
| Navigation | **Flow field over the collision grid** | O(cells) per rebuild, O(1) per agent. Supports 300+ agents with corridor-correct pathing, which A*-per-agent cannot at this count. |

## 2. SUBSYSTEM OWNERSHIP

Each subsystem owns its state exclusively. Others read through its public API; nobody
reaches into another subsystem's internals.

| Subsystem | Owns | Must not |
|-----------|------|----------|
| **CORE** | Clock, fixed-step loop, seeded RNG, event bus, pools, spatial hash, math | Know about gameplay |
| **INPUT** | Keyboard/mouse state → `InputFrame` (an intent struct) | Touch the world |
| **PLAYER** | Operator state, movement, health/armour, abilities, the operator light's *intent* | Own weapon internals, own the camera |
| **WEAPONS** | Weapon definitions, fire timing, recoil, reload, ammo, projectile pool, damage application | Know which operator holds it |
| **ENEMIES** | Enemy instances, AI states, steering, animation state, damage response, death | Decide *when* to spawn |
| **DIRECTOR** | Spawn budget, pressure curve, nest logic, encounter script, beats | Own enemy behaviour |
| **LEVEL** | Sector data, collision grid, nav grid + flow fields, rooms, doors, objectives, spawn points | Build meshes |
| **ENVIRONMENT** | All world geometry + materials + procedural textures, props, destructibles, grating | Own gameplay state (it *reads* LEVEL) |
| **LIGHTING** | Light budget & pooling, light events, flashlight, shadow config, light pools/decals | Be edited by any other subsystem directly |
| **VFX** | Particles, decals, tracers, impacts, ruptures, screen effects | Apply damage |
| **AUDIO** | WebAudio graph, synthesis, spatialisation, music state, room tone | Poll gameplay; it is *told* |
| **HUD** | 2D canvas overlay, objective/ammo/health readout, damage direction, messages | Mutate gameplay |
| **RENDERER** | three.js renderer, render targets, post chain, camera rig, quality tiers | Contain gameplay logic |
| **QA** | Profiler, deterministic replay, self-play scripts, canonical camera states, validators | Be required for the game to run |

### Dependency rule (enforced by `tools/check-deps.mjs`)

```
CORE  ← everything (leaf, depends on nothing)
LEVEL ← CORE
ENVIRONMENT ← CORE, LEVEL
LIGHTING, VFX, AUDIO, HUD, RENDERER ← CORE (+ LEVEL for LIGHTING/VFX placement)
WEAPONS ← CORE, LEVEL
PLAYER  ← CORE, LEVEL, WEAPONS
ENEMIES ← CORE, LEVEL
DIRECTOR ← CORE, LEVEL, ENEMIES
GAME (composition root) ← all of the above
```

**No cycles.** Cross-cutting communication goes *upward* through the event bus, never
through an import. E.g. WEAPONS does not import VFX; it emits `impact` and the composition
root's wiring lets VFX/AUDIO/LIGHTING react. `tools/check-deps.mjs` parses imports and fails
the build on any edge not in the table above.

### Composition root

`src/game/Game.js` is the only file allowed to know about every subsystem. It constructs
them in dependency order, wires events, and owns the frame order:

```
INPUT.sample → [fixed steps: PLAYER, WEAPONS, ENEMIES, DIRECTOR, LEVEL doors, VFX sim]
             → interpolate → LIGHTING.update → ENVIRONMENT.update → RENDERER.render
             → HUD.draw → AUDIO.flush → PROFILER.sample
```

## 3. DETERMINISM CONTRACT

Reproducibility is a feature, not a testing convenience. It is what makes visual review and
regression comparison possible at all.

1. **One clock.** `Clock.simTime` advances by exactly `1/60 s` per fixed step. Nothing in
   simulation, animation, VFX or shaders may read `Date.now()`, `performance.now()` or
   `Math.random()`. Enforced by `tools/check-determinism.mjs` (source scan + allowlist).
2. **One RNG tree.** `Rng` is xorshift128+, seeded from the URL (`?seed=`). Subsystems take
   **named child streams** (`rng.child('vfx')`) so that adding a particle call cannot shift
   enemy behaviour. Visual-only randomness uses the `vfx`/`audio` streams; gameplay uses
   `sim`.
3. **Fixed step, interpolated render.** Simulation is frame-rate independent and identical
   at 30 fps or 300 fps. Rendering interpolates transforms; it never advances state.
4. **Shader time** is `simTime`, passed as a uniform. Grain, flicker, pulse and flow are
   therefore reproducible frame-for-frame.
5. **Replay mode** (`?test=replay`) drives the game through the *real* `InputFrame` path from
   a scripted source, with a fixed step and rendering decoupled — so a headless run and a
   live run produce identical simulation.
6. **Golden captures always start from a fresh page load.** No reuse of a contaminated
   browser state; a capture run is `goto` → deterministic advance to beat → capture.

## 4. KEY DATA STRUCTURES

- **Collision grid** — `Uint8Array` per cell: `0` open, `1` solid, `2` door (dynamic),
  `3` hazard, `4` pit (grating over void, walkable), `5` prop-blocked.
- **Flow field** — two `Int16Array` (dist) + `Float32Array` (dir x/z), rebuilt by BFS from
  the player cell at 8 Hz, plus a second field toward "flank anchors" for stalkers, and a
  third toward the objective for retreating hunters. Rebuild is amortised over frames.
- **Enemy storage** — Struct-of-Arrays (`Float32Array` for pos/vel/hp, `Uint8Array` for
  state) with a free list. Capacity 512. No per-enemy object allocation in the hot loop.
- **Rendering of enemies** — each enemy archetype is a set of rigid parts, each an
  `InstancedMesh`. A 5-part runner at 200 instances is 5 draw calls. Animation is procedural
  (gait phase, lunge, flinch, death) computed into instance matrices.
- **Projectiles** — pooled SoA, capacity 512; rendered as one instanced tracer mesh.
- **Particles** — pooled SoA, capacity 4096, one `Points`-style instanced quad batch per
  blend mode (additive / alpha), sorted by mode not by depth.
- **Decals** — ring buffer of 256 instanced quads with a per-instance atlas index; oldest
  fades out. Decals are permanent within that budget: *the station remembers combat*.

## 5. PERFORMANCE ARCHITECTURE

- **Budgets** (see TEST_PLAN §5.3): ≤ 220 draw calls, ≤ 900 k triangles, ≤ 7 dynamic lights,
  ≤ 1 shadow-casting light, CPU sim ≤ 4.0 ms with 150 active enemies.
- **No allocation in the frame loop.** Vector scratch pools; SoA arrays; pre-sized typed
  arrays. The GC is the primary cause of hitches in a browser game, so the frame loop
  allocates zero objects in steady state (verified by `?test=alloc`).
- **Shader prewarm.** Every material/light-count permutation used by the sector is compiled
  during the loading screen by rendering one off-screen frame containing a representative
  instance of each, including the boss, the nest rupture shader and the dark-room state.
  A reveal may not compile a shader. Verified by the HITCH gate.
- **Amortisation.** Flow-field rebuild, spatial-hash rebuild, decal compaction and audio
  voice culling are spread across frames with explicit per-frame quotas.

## 6. QA ARCHITECTURE

- `?stats=1` — live profiler overlay: CPU frame, sim, render, draw calls, tris, entity
  counts, p50/p95/p99, worst frame, hitch count.
- `?test=replay&seed=N` — runs the 12-beat self-play script through the input path, asserts
  each beat, writes `window.__VOIDBREACH_RESULT__`.
- `?shot=NAME&seed=N` — deterministically advances to a canonical camera state, freezes, and
  signals readiness for capture.
- `tools/capture.mjs` — Playwright driver: fresh context per shot, writes PNGs + metrics.
- `tools/validate.mjs` — image/metric validators (luma, contrast, aliasing, framing, hitch).
- `tools/validate-validators.mjs` — **injects known-bad inputs and proves each validator
  fails.** A validator that has not been proven to fail is not evidence.

## 7. FILE LAYOUT

```
voidbreach/
  index.html               entry
  ARCHITECTURE.md  DIRECTION.md  TEST_PLAN.md
  vendor/three.module.js   pinned r185
  src/
    core/      Clock Rng Events Pool SpatialHash Mathx FixedLoop
    input/     Input.js            (→ InputFrame)
    level/     Sector.js Grid.js Nav.js sectors/helix_deep.js
    environment/ Build.js Textures.js Props.js Grating.js Destructibles.js
    renderer/  Renderer.js Post.js CameraRig.js Quality.js
    lighting/  Lighting.js LightPool.js Flashlight.js
    vfx/       Vfx.js Particles.js Decals.js Tracers.js Screen.js
    audio/     Audio.js Synth.js Music.js Ambience.js
    player/    Player.js Operators.js
    weapons/   Weapons.js Projectiles.js
    enemies/   Enemies.js Archetypes.js Ai.js Nests.js Boss.js
    director/  Director.js Beats.js
    hud/       Hud.js
    qa/        Profiler.js Replay.js Shots.js Validators.js SelfTest.js
    game/      Game.js Main.js
  tools/       capture.mjs validate.mjs validate-validators.mjs
               check-deps.mjs check-determinism.mjs serve.mjs run-gauntlet.mjs
  captures/    golden/ current/ reports/
```

## 8. DECISION LOG

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 1 | WebGL2 over WebGPU | Workload is CPU/draw-call bound, not shader bound; reach matters more | Locked |
| 2 | Hand-written post chain | Bloom/tonemap/grade are one coupled system with one owner (DIRECTION §9) | Locked |
| 3 | Flow field over per-agent A* | 300 agents; O(1) per agent lookup; corridor-correct | Locked |
| 4 | SoA enemies + instanced rigid parts | Avoids GC and per-enemy draw calls; procedural animation is cheaper and more reactive than skinned meshes at this count | Locked |
| 5 | Fake light pools + 1 real shadow spot | Real many-light forward rendering is unaffordable; the flashlight is where dynamic shadow *matters* (grating, DIRECTION §6) | Locked |
| 6 | No auto-exposure | Auto-exposure defeats authored darkness and makes captures non-comparable | Locked |
| 7 | Zero binary assets | Determinism, load time, and no asset-pipeline complexity | Locked |
| 8 | Solo play, no squad AI | Brief allows dropping squad AI if it harms quality. Four-operator squad AI with switching would consume the budget that makes the *slice* excellent, and mediocre allies would dilute the pressure→agency→relief loop that is the whole point. Operators 2–4 are designed and documented but the slice ships one. | Locked for slice |
