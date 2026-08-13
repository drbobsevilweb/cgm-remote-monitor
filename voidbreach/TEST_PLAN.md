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

The scripted operator drives the game through the normal input path. All fifteen beats must
complete, in order, within their time windows:

| # | Beat | Assertion | Deadline (sim s) |
|---|------|-----------|------------------|
| 1 | Spawn Assault operator | operator alive, controllable | 1 |
| 2 | Move through opening corridor | displacement ≥ 18 m | 20 |
| 3 | Destroy an egg before it hatches | `eggDestroyed` event | 60 |
| 4 | Overheat the barrel | a *forced* vent occurs | 75 |
| 5 | Kill the first brood queen | `queenKilled` event, count 1 | 90 |
| 6 | Fight a swarm | ≥ 14 enemies alive simultaneously, ≥ 20 killed | 130 |
| 7 | Trigger an explosive object | `tankDetonated` event | 160 |
| 8 | Cross a grated industrial floor | ≥ 6 m travelled on grating | 180 |
| 9 | Fight one Stalker | stalker damaged then killed | 210 |
| 10 | Switch weapon / ability | secondary (frag) fired | 220 |
| 11 | Weld a vent shut | `ventSealed` event | 250 |
| 12 | Enter a dark room | authored ambient level ≤ 0.12 for ≥ 3 s | 260 |
| 13 | Illuminate enemies with the operator light | ≥ 2 enemies inside the light cone while dark | 270 |
| 14 | Kill the final queen | all sector queens dead | 350 |
| 15 | Reach level exit | exit trigger entered | 400 |

Beats 3, 4 and 11 are new and were added with the mechanics they test. Beat 4 in particular
is deliberately a beat about *failing well*: the autopilot fires greedily for its first 70 s
and lets the barrel take the decision away from it, because that is what a player does before
they have learned the bar, and both halves of the thermal design have to be exercised.

**Gate E1:** 15/15 beats pass. Blocking.
**Gate E2:** identical seed → identical beat times (±0 frames) and identical end-state hash
across two runs. Blocking.
**Gate E3:** different seeds (1337, 4242, 777) all complete 15/15 — the level is not solvable
by luck alone. Blocking.

### 4.2 The 60-second contract (DIRECTION §2)

Measured on the replay's first 60 s of sim time:

| ID | Gate | Threshold |
|----|------|-----------|
| X1 | First enemy *seen* (in frustum, lit or silhouetted) | ≤ 12 s |
| X2 | First damage taken by player | ≥ 14 s and ≤ 40 s (not instant, not absent) |
| X3 | Peak simultaneous enemies before the first queen dies | ≥ 10 |
| X4 | Hatch rate exceeds player kill rate for ≥ 6 s before the queen dies | true |
| X5 | First queen killed | ≤ 90 s |
| X6 | Enemy count 3 s after the queen dies vs. 3 s before | ≤ 40% (the relief must be measurable) |
| X7 | Player survives the first 60 s at ≥ 25% health | true |
| X8 | Next route revealed (bulkhead cycle event) within 10 s of the queen dying | true |

**Gate E4:** X1–X8 all pass. Blocking. *This is the single most important gate in the file.*

### 4.3 Combat feel invariants

| ID | Gate | Threshold |
|----|------|-----------|
| F1 | Player input → projectile spawn latency | ≤ 1 sim step (16.7 ms) |
| F2 | Time-to-kill, Runner, carbine centre mass | 1–2 hits |
| F3 | Time-to-kill, Bulwark frontally | > 4× its flank TTK (flanking must be *the* answer) |
| F7 | Damage to a queen's frontal arc | ≈ 34% of the same round to her flank or rear |
| F8 | Explosive damage to a queen | never reduced by the hood, at any angle |
| F9 | Cold barrel to forced vent, trigger held | 28–30 rounds (3.1–3.3 s) |
| F10 | Manual vent duration | strictly increasing in heat; ≥ 0.5 s and < the forced 2.15 s at every heat below 1.0 |
| F11 | Killing a queen destroys her unhatched clutch | 100% |
| F4 | Player top speed reached from standstill | ≤ 0.16 s (weighty, not sluggish) |
| F5 | Dash i-frame window | 0.22 s ± 1 frame |
| F6 | Every hit produces impact VFX + audio + enemy flinch | 100% of sampled hits |

## 5. VISUAL GATES

Captured from **fresh page loads** at canonical states (`?shot=`), 1600×900:
`OPENING, FIRST_COMBAT, GRATING, DARK_CORRIDOR, SWARM, QUEEN, CLUTCH, EXPLOSION, ELITE, BOSS_REVEAL`.

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
| Replay harness | **Every wall vent in the sector was authored onto a floor cell**, so no grille geometry was ever emitted and there was nothing there to shoot — the Chorus flanked out of thin air | The spawn points worked, so the encounters played correctly. Nobody looks at a wall and notices a grille that was never there. Found only when the vents were made destructible and the test asked one to break. |
| Replay harness | The stall watchdog counted kills as progress, so an operator pinned against a locked bulkhead farming an endless vent wave looked busy for 350 s | Every number on the report was rising. The run was, by every metric it had, going well. |
| Autopilot goal logic | Chasing weapon pickups pulled the run off a queen whose death was the only thing that unlocked the door it then stood against | A supply detour is individually reasonable at every step |
| Replay harness | Tightening the queens' hitboxes to hug their silhouette — a tidiness change, made because the model had been rescaled and the radii had not — cost 25% of the radius and killed the run at 89 s where it had been reaching the exit at 194 s. Reverted, with the measurement recorded next to the number. | Nothing about a hitbox one metre larger than a model is visible on screen. It was load-bearing for the whole difficulty curve. |
| Replay harness | The stall key bucketed the *current* distance to the objective, so an operator oscillating across a bucket boundary minted a fresh "progress" mark every two seconds. Now keyed on the closest it has ever been. | Oscillation is indistinguishable from movement in any single sample |
| Replay harness | A supply crate sitting behind a machine is routed to by the flow field — which snaps to the nearest OPEN cell — and then sits two metres outside pickup range forever | The operator is walking, arriving, and standing next to the thing it wants |
| `seal_vent` beat | Line of sight to a vent was always false: a vent cell is *solid*, so a ray aimed at its centre is stopped by the vent itself | The vents are visible on screen. The test was asking the wrong question of the grid. |
| Capture tool | **Playwright silently ignored the per-call `timeout` option** and applied the 30 s context default to every `waitForFunction`. Under a software rasteriser 30 s is about 1.5 s of simulation, so `OPENING` was the only canonical state physically reachable and everything else "timed out". | The report said TIMEOUT, which reads as "the game did not get there" rather than "the harness never waited". §6c blamed the workload for two weeks. |

## 6c. KNOWN OPEN FAILURES

Recorded rather than hidden. A gate that is failing and documented is worth more
than a gate quietly relaxed until it passes.

| Gate | State | Detail |
|------|-------|--------|
| **P7 shader compilations after prewarm** | **FAILING — 15** | `prewarm()` renders one off-screen frame containing every archetype, both queen types, an egg (shell and core) and the VFX batches, but three.js still compiles ~15 programs during the first seconds of play. The likely remainder is shadow-pass program variants and material permutations that only appear once a light count changes. The instrument is correct and is doing its job; the prewarm is incomplete. Fix is to render the prewarm frame under the worst-case light count with the shadow pass enabled, and to re-run `renderer.compile` after the first light-pool allocation. |
| E2 determinism (same seed → identical end state) | **UNVERIFIED** | The end-state hash is computed and emitted (`endStateHash`), and the RNG's own determinism is proven in `validate-validators.mjs`, but a same-seed A/B replay pair has not been run end to end. Two ~4-minute headless runs are required. |
| E3 multi-seed (1337 / 4242 / 777) | **UNVERIFIED** | Only seed 1337 has been run to completion. |
| Visual gates on the full state set | **PARTIAL** | The reason this entry existed at all turned out to be the capture-tool timeout bug above, not the workload. With that fixed, `QUEEN`, `CLUTCH`, `FIRST_COMBAT`, `GRATING` and `SWARM` capture; `DARK_CORRIDOR`, `EXPLOSION`, `ELITE` and `BOSS_REVEAL` have not been re-run since. Measuring the captured set against `validate.mjs` is the next gauntlet round, not a completed one. |
| Queen silhouette and read | **IMPROVED, NOT FINISHED** | Two rounds of the gauntlet were run against the `CLUTCH` capture. Round 1 found her built at over four metres across and lit to blowout by her own violet emitter sitting *inside* her body — she read as scenery, not an animal. Round 2 rescaled her to roughly car-sized, moved the emitter under her, dropped her emissive from 0.55 to 0.22, and pulled the egg cores back inside the AgX shoulder so they stay violet instead of desaturating to white-pink. She now reads as the largest thing in the room and is obviously worth walking toward. What is still not right: at the 62° camera the abdomen dominates and the hood — which is the entire tell for her frontal armour — is hard to pick out from above. That is the next round, and it is a modelling problem, not a lighting one. |
| F7–F11 combat invariants | **VERIFIED BY PROBE, NOT GATED** | Queen frontal reduction (34% of a flank round), explosive immunity to the hood, cold-to-forced-vent round count, and clutch-dies-with-queen were each measured directly against the running game. They are not yet wired into an automated gate, so they are checks that were performed rather than checks that are enforced. |
| Boss / THE DEEP FORM | **NOT BUILT** | The Reactor Antechamber exists, is reachable and is the exit; the large final organism described in DIRECTION is not implemented. The slice currently ends on the fourth queen plus the reactor arena. |
| Four-player co-op | **NOT STARTED** | Planned and costed in MULTIPLAYER.md. Nothing in the shipped code is netcode, and the singleton `player` reference appears 64 times outside `src/player/`. The blocking piece is enemy target selection for a squad, not the transport. |

## 7. DEFINITION OF DONE (vertical slice)

- V0, S1–S4, E1–E4, F1–F11 pass.
- All V/C/P gates pass at 1600×900.
- One operator, one large sector, ≥ 3 enemy types + 1 elite + boss encounter, 2 nest types,
  4 weapons/abilities, 1 locked bulkhead objective, 1 large final encounter.
- Human playthrough of 8–12 minutes with no soft-locks and no unreadable moments.
