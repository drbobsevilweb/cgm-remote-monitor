# VOIDBREACH — TEST PLAN

Authoritative document for **acceptance gates**. A gate is a number or a boolean produced by
a tool, not an opinion. "It looks better" is not evidence; a gate delta is.

Run everything: `node tools/run-gauntlet.mjs`

---

## 1. TEST ENVIRONMENT — AND ITS LIMITS

Headless Chromium here renders through **SwiftShader (software rasterisation)**. This is
stated up front because it determines which gates are meaningful:

| Measurement | Valid headless? | Why |
|-------------|-----------------|-----|
| Simulation correctness, determinism, beats | **Yes** | Fixed-step sim is renderer-independent |
| Image composition, luminance, contrast, colour, framing | **Yes** | Software raster is spec-conformant; the image is the same image |
| Draw calls, triangles, light count, entity counts, allocation | **Yes** | Counted on the CPU |
| **CPU** frame/sim time | **Yes, with a caveat** | Sim time is real; total frame time includes software raster and is not representative |
| **GPU** time, wall-clock FPS | **No** | SwiftShader is 10–50× slower than any real GPU |

Therefore performance gates are expressed as **CPU simulation budgets + structural budgets**
(draw calls, triangles, lights, allocations), which *are* measurable here, plus a **hitch
gate** on sim time. Wall-clock FPS is reported by the in-browser profiler for a human on real
hardware (`?stats=1`) and is not a headless gate. This is a deliberate, documented
limitation rather than a fabricated number.

---

## 2. VALIDATING THE VALIDATORS (runs first)

`node tools/validate-validators.mjs` — each detector is fed a deliberately broken input and
**must fail**, and a known-good input and **must pass**. If any validator cannot detect its
own failure mode, the gauntlet aborts before any gameplay test runs.

| Validator | Injected failure that must be detected | Injected control that must pass |
|-----------|----------------------------------------|--------------------------------|
| `luma` (crushed black / blown white) | Frame with 92% of pixels below 2/255; frame with mean 250/255 | The reference lit-corridor frame |
| `contrast` (flat, foggy image) | Frame with luminance range compressed to ±6 levels | Reference frame |
| `aliasing` | Synthetic high-frequency chequerboard at 1 px pitch | Blurred version of the same |
| `framing` | Camera placed inside a wall / player outside the 60% safe box | The canonical OPENING camera |
| `hitch` | Injected 120 ms stall in the sim loop (`?test=injecthitch`) | Normal run |
| `palette` (colour-meaning drift) | Frame where nest-violet appears with zero nests present | Reference NEST frame |
| `determinism` | Two runs with different seeds must **differ**; same seed must **match** | — |
| `beats` | A run with a beat deliberately disabled must report failure | Normal replay |

**Gate V0:** all validator self-tests pass. Blocking.

---

## 3. STATIC GATES

| ID | Gate | Tool | Threshold |
|----|------|------|-----------|
| S1 | No cyclic / illegal subsystem dependency | `check-deps.mjs` | 0 violations |
| S2 | No wall-clock or unseeded randomness in sim path | `check-determinism.mjs` | 0 violations outside allowlist |
| S3 | No runtime dependency besides three.js | `check-deps.mjs` | 0 |
| S4 | Game boots with zero console errors | `capture.mjs` | 0 errors, 0 unhandled rejections |

## 4. EXPERIENCE GATES — the reason the game exists

### 4.1 Self-play replay (`?test=replay&seed=1337`)

The scripted operator drives the game through the normal input path. All twelve beats must
complete, in order, within their time windows:

| # | Beat | Assertion | Deadline (sim s) |
|---|------|-----------|------------------|
| 1 | Spawn Assault operator | operator alive, controllable | 1 |
| 2 | Move through opening corridor | displacement ≥ 18 m | 20 |
| 3 | Destroy first infestation node | `nest.destroyed` event, count 1 | 75 |
| 4 | Fight a swarm | ≥ 14 enemies alive simultaneously, ≥ 20 killed | 120 |
| 5 | Trigger an explosive object | `tank.detonated` event | 150 |
| 6 | Cross a grated industrial floor | ≥ 6 m travelled on `PIT` cells | 170 |
| 7 | Fight one Stalker | stalker damaged then killed | 200 |
| 8 | Switch weapon / ability | secondary (frag) fired | 210 |
| 9 | Enter a dark room | ambient luminance at player < 0.06 for ≥ 3 s | 235 |
| 10 | Illuminate enemies with the operator light | ≥ 2 enemies inside the light cone while dark | 245 |
| 11 | Destroy final nest | all sector nests destroyed | 330 |
| 12 | Reach level exit | exit trigger entered | 380 |

**Gate E1:** 12/12 beats pass. Blocking.
**Gate E2:** identical seed → identical beat times (±0 frames) and identical end-state hash
across two runs. Blocking.
**Gate E3:** different seeds (1337, 4242, 777) all complete 12/12 — the level is not solvable
by luck alone. Blocking.

### 4.2 The 60-second contract (DIRECTION §2)

Measured on the replay's first 60 s of sim time:

| ID | Gate | Threshold |
|----|------|-----------|
| X1 | First enemy *seen* (in frustum, lit or silhouetted) | ≤ 12 s |
| X2 | First damage taken by player | ≥ 14 s and ≤ 40 s (not instant, not absent) |
| X3 | Peak simultaneous enemies before first nest dies | ≥ 10 |
| X4 | Spawn rate exceeds player kill rate for ≥ 6 s before nest death | true |
| X5 | First nest destroyed | ≤ 60 s |
| X6 | Enemy count 3 s after nest death vs. 3 s before | ≤ 40% (the relief must be measurable) |
| X7 | Player survives the first 60 s at ≥ 25% health | true |
| X8 | Next route revealed (bulkhead cycle event) within 10 s of nest death | true |

**Gate E4:** X1–X8 all pass. Blocking. *This is the single most important gate in the file.*

### 4.3 Combat feel invariants

| ID | Gate | Threshold |
|----|------|-----------|
| F1 | Player input → projectile spawn latency | ≤ 1 sim step (16.7 ms) |
| F2 | Time-to-kill, Runner, carbine centre mass | 1–2 hits |
| F3 | Time-to-kill, Bulwark frontally | > 4× its flank TTK (flanking must be *the* answer) |
| F4 | Player top speed reached from standstill | ≤ 0.16 s (weighty, not sluggish) |
| F5 | Dash i-frame window | 0.22 s ± 1 frame |
| F6 | Every hit produces impact VFX + audio + enemy flinch | 100% of sampled hits |

## 5. VISUAL GATES

Captured from **fresh page loads** at canonical states (`?shot=`), 1600×900:
`OPENING, FIRST_COMBAT, GRATING, DARK_CORRIDOR, SWARM, NEST, EXPLOSION, ELITE, BOSS_REVEAL`.

### 5.1 Readability

| ID | Gate | Threshold |
|----|------|-----------|
| V1 | Crushed black: pixels below 2/255 | ≤ 35% of frame, and ≤ 12% inside the central 60% box |
| V2 | Blown highlights: pixels above 250/255 | ≤ 4% (≤ 9% for EXPLOSION / NEST rupture) |
| V3 | Mean luminance, lit states | 0.10–0.42 |
| V4 | Mean luminance, DARK_CORRIDOR | 0.02–0.13 — dark, but the floor plane still resolves |
| V5 | Luminance p95 − p5 (contrast range) | ≥ 0.28 for every state |
| V6 | Enemy/background separation: mean luminance or hue distance between enemy pixels and their local background | ≥ 0.18 |
| V7 | Aliasing energy (high-frequency crawl metric) | ≤ threshold calibrated in V0 |
| V8 | Colour meaning: nest-violet hue cluster present **iff** a nest is in frame | true |

### 5.2 Composition

| ID | Gate | Threshold |
|----|------|-----------|
| C1 | Player inside central 60% safe box in all gameplay states | true |
| C2 | Camera not inside solid geometry; look vector hits the player | true |
| C3 | Threat direction visible: ≥ 1 enemy or nest in frame for combat states | true |
| C4 | Horizon/architecture visible (not a flat floor plane) — vertical structure occupies ≥ 12% of frame | true |
| C5 | Grating pattern detectable in the GRATING state (periodic 250 mm signal in floor region) | true |

### 5.3 Structural performance

| ID | Gate | Threshold |
|----|------|-----------|
| P1 | Draw calls, worst state | ≤ 220 |
| P2 | Triangles, worst state | ≤ 900 k |
| P3 | Dynamic lights, worst state | ≤ 11 (≤ 1 shadow-casting) — 8 pooled practicals + flashlight + readability key |
| P4 | CPU sim time, 150 enemies + 200 projectiles + 2000 particles | ≤ 4.0 ms mean, ≤ 8.0 ms p99 |
| P5 | Steady-state heap growth over 120 s replay | ≤ 6 MB (no per-frame allocation) |
| P6 | Sim-step hitches > 3× median | 0 outside the first 2 s |
| P7 | Shader compilations after loading screen ends | **0** |

### 5.4 Audio

| ID | Gate | Threshold |
|----|------|-----------|
| A1 | Audio graph builds with 0 errors; voices released after use | active voices return to baseline ± 2 |
| A2 | Room tone present whenever gameplay is active | true |
| A3 | Music bed removed within 400 ms of last nest death | true |
| A4 | Concurrent voice cap respected | ≤ 24 |

## 6. THE GAUNTLET LOOP

1. **CAPTURE** — `capture.mjs` fresh-loads each canonical state, writes `captures/current/`.
2. **MEASURE** — `validate.mjs` produces `captures/reports/<rev>.json` with every gate.
3. **REVIEW** — human/independent critique of the images; record the single
   highest-impact problem.
4. **HYPOTHESISE** — write the expected measurable effect *before* changing code.
5. **CHANGE** — one coupled change, one owner.
6. **CAPTURE AGAIN** — same seeds, same states, fresh browser state.
7. **COMPARE** — gate deltas + side-by-side.
8. **ACCEPT OR REVERT** — accept only if the hypothesised metric moved and no gate regressed.

Iteration stops when two consecutive rounds produce no gate improvement and no reviewer
identifies a problem of higher impact than the cost of change.

## 6b. WHAT THE GAUNTLET HAS ACTUALLY CAUGHT

Kept as a record, because it is the argument for the whole apparatus. None of
these were found by looking at the game; all were found by an instrument.

| Found by | Defect | Why the eye missed it |
|----------|--------|----------------------|
| Winding invariant | `addQuad` +Y, `addBoxRot` caps, `addCylinder` caps and every `addPipe` ring were wound against their shading normal, so **every floor and box top in the station was back-face culled** | The screenshot read as "too dark". Three lighting rebalances were spent on a geometry bug. |
| Winding invariant | 16-bit indices chosen by index count instead of vertex count — merged rooms silently wrapped | Presented as one giant stray triangle, indistinguishable from a camera bug |
| Validator self-test | `periodicity` returned 1.0 on a blank floor (denormal variance reads as a perfect match) | It would have reported grating where there is none, forever |
| Validator self-test | `verticalStructure` measured only vertical gradients, so it scored ribs at zero | Would have failed every corridor and passed nothing |
| Validator self-test | Aliasing threshold sat between a chequerboard and its own blur | Would have failed clean frames |
| Replay harness | Pickup collection ran in `present()`, not `step()` — sampled once per rendered frame | Invisible at 60 fps; the operator walked through medkits in the harness, and a player at 20 fps would too |
| Replay harness | Unreachable stragglers survived forever | A room could never feel cleared |
| Replay harness | The harness itself could hang instead of reporting | A hang is not a failure report |

## 6c. KNOWN OPEN FAILURES

Recorded rather than hidden. A gate that is failing and documented is worth more
than a gate quietly relaxed until it passes.

| Gate | State | Detail |
|------|-------|--------|
| **P7 shader compilations after prewarm** | **FAILING — 13** | `prewarm()` renders one off-screen frame containing every archetype, both nest types and the VFX batches, but three.js still compiles ~13 programs during the first seconds of play. The likely remainder is shadow-pass program variants and material permutations that only appear once a light count changes. The instrument is correct and is doing its job; the prewarm is incomplete. Fix is to render the prewarm frame under the worst-case light count with the shadow pass enabled, and to re-run `renderer.compile` after the first light-pool allocation. |
| E2 determinism (same seed → identical end state) | **UNVERIFIED** | The end-state hash is computed and emitted (`endStateHash`), and the RNG's own determinism is proven in `validate-validators.mjs`, but a same-seed A/B replay pair has not been run end to end. Two ~4-minute headless runs are required. |
| E3 multi-seed (1337 / 4242 / 777) | **UNVERIFIED** | Only seed 1337 has been run to completion. |
| Visual gates on the full state set | **PARTIAL** | Only `OPENING` has been captured and measured since the light-colour correction (13/14). `NEST`, `GRATING`, `DARK_CORRIDOR`, `SWARM`, `EXPLOSION`, `ELITE` are implemented and capturable but not yet measured against the current build. |
| Boss / THE DEEP FORM | **NOT BUILT** | The Reactor Antechamber exists, is reachable and is the exit; the large final organism described in DIRECTION is not implemented. The slice currently ends on the fourth node plus the reactor arena. |

## 7. DEFINITION OF DONE (vertical slice)

- V0, S1–S4, E1–E4, F1–F6 pass.
- All V/C/P gates pass at 1600×900.
- One operator, one large sector, ≥ 3 enemy types + 1 elite + boss encounter, 2 nest types,
  4 weapons/abilities, 1 locked bulkhead objective, 1 large final encounter.
- Human playthrough of 8–12 minutes with no soft-locks and no unreadable moments.
