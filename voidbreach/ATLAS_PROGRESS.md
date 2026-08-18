# ATLAS_PROGRESS — inspection of the existing project

Written as the FIRST ACTION required by the Atlas master prompt (§1): inspect
before changing code, and record what exists rather than what was expected.

**Date of inspection:** this session, at commit `3d90e8b` on branch
`claude/voidbreach-game-8l3xiv`.

---

## 0. THE HEADLINE FINDING

**The project described by the Atlas prompt and the project in this repository
are not the same game.**

This is not a criticism of either. It is the single most important fact for
planning, so it goes first.

The Atlas prompt instructs me to *preserve and improve* an existing squad
architecture, and cites specific baselines — diamond and snake formations, squad
following and catch-up, ~3 tiles/sec movement, a Tech hack of ~3 seconds, welded
doors, a motion tracker, fog-of-war, occluders. I searched the codebase for every
one of those systems.

| Atlas prompt says exists | Present in this repo? |
|---|---|
| Four-marine squad, player-controlled leader | **No.** One operator. |
| Diamond / snake formations, squad following, catch-up | **No.** No squad code of any kind. |
| Movement quoted in tiles/sec | **No.** Metres/second, 2.5 m grid. |
| Tech hack ≈ 3 s, terminals, bypasses | **No.** No hacking, no terminals. |
| Welded doors, BROKEN state | **Partly.** See §2. |
| Motion tracker | **No.** |
| Fog-of-war, occluders | **No.** Real-time lighting and line-of-sight instead. |
| Leader / Tech / Medic / Heavy as playable classes | **Data only.** See §3. |

I also confirmed there is no second codebase: the only project on disk or on any
branch is this one. There is no separate ALIIENS or Atlas repository I have been
given access to.

So the Atlas prompt is either (a) a redirection of *this* project into a new
shape, (b) written for a codebase I have not been shown, or (c) a reusable master
prompt whose "current baseline" numbers are aspirational. Those lead to very
different work, which is why I have asked rather than guessed.

---

## 1. WHAT THIS PROJECT ACTUALLY IS

**VOIDBREACH** — a top-down sci-fi horde shooter, ~10,000 lines of hand-written
ES modules over a vendored three.js, zero binary assets. Every texture is drawn
to a canvas at boot, every mesh is built from primitives, every sound is
synthesised.

It is a **complete, instrumented vertical slice**: a fifteen-beat scripted
playthrough reaches the exit in about three minutes, and the whole thing is
gated by an automated QA apparatus.

### Systems that exist and work

| System | State | Notes |
|---|---|---|
| Fixed-timestep sim (1/60) with render interpolation | **Solid** | Frame-rate invariance is architectural, not audited after the fact — Atlas §22 is already satisfied by construction. |
| Seeded RNG with **named child streams** | **Solid** | Proven: changing which lamps are dead altered the visuals and left gameplay stats byte-identical. |
| Flow-field navigation over a 2.5 m collision grid | **Solid** | Multi-source BFS, PLAYER and FLANK fields. Already accepts N sources — squad-ready without modification. |
| Enemy AI (SoA, 6 archetypes, instanced rigid-part rendering) | **Solid** | Archetypes already carry an explicit Creature Question each (see §3). |
| Brood queens → egg clutches → hatching | **Solid** | The pressure pipeline. Two-stage, readable, counter-playable. |
| Weapons: thermal cycle, no ammunition | **Solid** | Heat, forced vs manual vent, one finite special. |
| Destructible vents, doors, tanks, lamps | **Works** | See §2 for the spatial-truth caveat. |
| HDR pipeline: bloom, AgX tonemap + look, FXAA | **Solid** | Hand-written. |
| Catwalks + projected grating shadows + light shafts | **Works** | Recently added. |
| Rotating warning beacons with an alarm state | **Works** | Amber → red when a queen wakes nearby. |
| Procedural audio (WebAudio synthesis, spatialised) | **Works** | No asset dependency. |
| Studio — live material/light/grade/model editor | **Works** | `studio.html`. Overrides ignored in deterministic runs. |
| QA: 15-beat autopilot, canonical captures, validated validators | **Strong** | 31 detector self-tests; every detector must prove it can fail. |

### Verified gate status

- **Static gates** (dependency rules, determinism scan, geometry winding, level connectivity): PASS
- **Validator self-tests**: PASS, 31/31
- **E1** 15/15 beats on seed 1337: PASS
- **E2** same seed twice, under deliberately different machine load: PASS, identical to the frame
- **X6** relief ratio: PASS (0.000 / 0.067 / 0.000 on samples of 12–15)
- **E3** multi-seed: **PASS** — 15/15 on 1337, 4242 and 777 (see §8)

---

## 2. WHAT IS PARTIAL OR BROKEN

### E3 — was red, now green

Seed 777 died in the Processing hall. **Resolved** by the opening-pacing work in
§8: giving every queen a warning stage before she begins producing spreads the
onset of Processing's two encounters apart in time. All three seeds now complete.

The structural observation stands and is worth carrying forward: Processing is
the only room with two live sources, and killing one of two cannot fully deliver
the relief the loop promises. That is future authoring work, not an open defect.

### Shared spatial truth — Atlas §6 is *mostly* satisfied, with one scar

The grid is genuinely authoritative: collision, navigation, projectiles and
line-of-sight all read the same `cells` array and the same `doorOpen` /
`doorLocked` arrays. There is no second opinion about whether a door is open.

But this session found a real instance of exactly the failure §6 warns about:
**every wall vent in the sector was authored onto a floor cell**, so no grille
geometry was ever emitted and there was nothing there to shoot — while the spawn
logic worked perfectly off a *separate* coordinate. Two systems disagreed about
where a vent was for the entire life of the project, and it was invisible because
the half that mattered for gameplay was the half that was right. Vents now snap
to a real wall and `validate()` reports any that cannot find one.

Worth stating plainly: §6 is a good rule and this project mostly follows it, but
it had a live counter-example until a few hours ago.

### Doors — closer to the Atlas model than expected

Existing states: `locked` → `closed` → cycling → open (as a continuous `open01`),
with two kinds (`bulkhead`, `service`), proximity sensors, and unlock conditions
tied to objectives. They participate in collision, navigation (locked doors are
impassable to flow fields), and projectile blocking.

Missing versus Atlas §5: **WELDED** and **BROKEN** as first-class states, and any
player verb for creating them. "Weld" exists in this codebase only as vent
sealing, which is a different mechanic.

### Known open failures (carried from TEST_PLAN §6c)

- **P7 shader prewarm**: ~15 compilations still happen after prewarm. Real hitch risk.
- **Visual gates**: only a subset of canonical states captured and none re-measured against `validate.mjs` since the last change.
- **Queen silhouette**: her hood — the entire tell for her frontal armour — is hard to read at the 62° camera. Modelling problem, not lighting.
- **Tonal target**: bays are still closer to evenly-lit mid-grey than to pools-and-blackness. The cause is lamp *spacing*, which is structural.
- **THE DEEP FORM** (final organism): designed, not built. The sector currently ends administratively.

---

## 3. WHAT THE ATLAS PROMPT ASKS FOR THAT PARTLY EXISTS ALREADY

Several Atlas requirements are already met, in some cases better than the prompt
assumes. This matters for §26 (do not destroy good work).

**The four classes exist as authored data.** `src/player/Operators.js` defines
ASSAULT, HEAVY (`ORRIN`), TECH (`SABEK`) and BIOLOGIST (`IRENNE`) with distinct
builds, weapons and silhouette parameters. Only ASSAULT is playable. The
non-playable three are deliberate, documented, and locked as ARCHITECTURE
decision #8 — with the reasoning that mediocre AI allies would dilute the core
loop. **Any move to a four-marine squad supersedes a locked decision**, which is
allowed, but should be a decision rather than a side effect.

**The Creature Question Contract (§10) is already the design method here.**
`src/enemies/Archetypes.js` opens with exactly this, per archetype:

```
runner  — "can you keep them off you?"      (volume)
stalker — "do you know what is behind you?" (arc)
spitter — "can you keep moving?"            (ground denial)
bulwark — "will you reposition?"            (geometry)
hunter  — "can you finish something?"       (commitment)
```

The bulwark and the queen both fail the "just walk at the player" test: both are
answered by *flanking*, enforced by frontal armour. The brood queen adds a
sixth: "can you deal with what is coming before it arrives?"

**The 60-second gate (§21) exists as a measured contract**, not a checklist —
eight numbered thresholds (X1–X8) measured by the autopilot every run.

**The visual review loop (§18/§19) is already the working practice.** Recent
example, in the required symptom-before-diagnosis form: *"the shadow band reads
as a hard black rectangle with a straight cut across the floor, and the stripes
run parallel to north-south catwalks rather than across them"* → root cause:
world-derived UVs cannot express a projection's orientation → fix: explicit UVs.

**Documentation structure already exists** under different names:
`ATLAS_DEMAND` ≈ DIRECTION §1–2, `ATLAS_DIRECTION` ≈ DIRECTION.md,
`ATLAS_CREATURES` ≈ Archetypes.js headers + DIRECTION §12,
`ATLAS_TESTS` ≈ TEST_PLAN.md, `ATLAS_DECISIONS` ≈ ARCHITECTURE §8 decision log.
Renaming them would be churn; mapping them is cheap.

---

## 4. WHAT DOES NOT EXIST AT ALL

Ranked by how much of the Atlas experience depends on them:

1. **Squad of four.** No squad, no formations, no follow, no catch-up, no orders. The singleton `player` reference appears **64 times outside `src/player/`**, across `Game.js`, `Enemies.js`, `Nav.js` and `Replay.js`. MULTIPLAYER.md costs this out in detail.
2. **Enemy target selection for multiple targets.** Identified in MULTIPLAYER.md as *the* blocking design problem, not the transport: with four targets, "nearest" makes one marine fight while three spectate, which collapses the pressure→agency→relief loop entirely.
3. **Motion tracker.** Nothing like it. Would work in solo play and is one of the strongest single additions available.
4. **Fog-of-war / occluders as a discrete system.** The game instead uses real lighting, a shadow-casting operator light, and grid line-of-sight. This is arguably a *better* fit for the visual direction, and replacing it would be a rewrite of working code.
5. **Tech interaction verbs** — hacking, terminals, timed vulnerability. The `interact()` hook exists and is empty.
6. **Welded / broken doors as player verbs.**

---

## 5. TECHNICAL DEBT DISCOVERED

- **The autopilot has been the most defect-prone component in the project.** Six harness bugs versus roughly four game bugs. Any new direction inherits it, and it is currently tuned around one operator.
- **`interact()` is an empty hook.** Everything interactive is proximity-driven. Any Tech verb needs this built properly first.
- **Capture tooling had a silent 30 s cap** (Playwright ignoring per-call timeouts) which meant the visual gates only ever measured one camera state and the workload was blamed for it. Fixed, but it is a reminder that the instruments need the same scrutiny as the game.
- **No human has played this.** Every claim in this document derives from an autopilot and from headless captures through a software rasteriser. Atlas §20 draws exactly this distinction, and by its standard **this project has not had a real player test.**

---

## 6. SYSTEMS THAT MUST NOT BE REWRITTEN

Per Atlas §26. Each of these is working, load-bearing, and expensive to replace:

- **The fixed-timestep clock and the named-child-stream RNG.** These are the foundation of every gate, and of any future co-op.
- **The flow-field navigation.** Already multi-source; a squad needs no change to it.
- **The grid as authoritative spatial truth.** This is Atlas §6, already implemented.
- **The QA apparatus** — validated validators, geometry invariants, dependency rules. It has caught defects the eye could not: every floor in the station back-face culled while the screenshot merely looked "too dark".
- **The zero-asset generation pipeline.** It is what makes the Studio possible.
- **The renderer and post chain.** Matches the intended direction already.

---

## 7. THE SINGLE HIGHEST-VALUE NEXT IMPROVEMENT

Atlas §1 demands one answer, so: **it depends on a direction decision that is not
mine to make**, and the two candidates are far apart.

**If this project stays solo:** the next target is the **aftermath beat** (Atlas
§13-I). The opening now has warning, investigation and contact; what it does not
have is the silence afterwards. Gunfire stops and the game moves straight on.
§29 says horror needs contrast, and the back half of the cycle is missing.

**If this project becomes ALIIENS with a four-marine squad:** the first thing to
build is **not** the squad. It is **enemy target selection for multiple targets**,
prototyped single-player with three dummy marines and measured against the
existing beats. It is the part that can fail, it invalidates the roster work if
it fails, and MULTIPLAYER.md already says so.

In both cases the honest zeroth step is the same and costs ten minutes: **somebody
should actually play the build.**

---

## 8. ITERATION 1 — THE OPENING HAD NO WARNING

**Objective (Atlas §32).** Make the first playable corridor encounter feel
substantially closer to a finished commercial game.

**Method.** Not a screenshot. I recorded every player-facing event in the first
42 seconds of a real run and read the timeline. That turned out to be the right
instrument, because the defect was in *time*, and no still frame could have shown
it.

**Symptom, before diagnosis (§19).** The recorded opening:

```
10.13s  enter CARGO HALL A     +  objective: "KILL THE BROOD QUEEN"
10.68s  queen wakes            +  eggs begin dropping
11.55s  first enemy alive
12.45s  seven enemies, plus a heat warning
```

The player crosses a threshold and is in a fight **1.4 seconds later**, having
had no opportunity to look at the room. Every measured gate passed while this was
true: first threat seen 11.6 s, first damage 14.5 s, both inside their windows.
The numbers were satisfied by putting the threat *on top of the player* rather
than at a distance.

**Three biggest experience-breaking weaknesses, ranked.**

1. **No warning before first contact.** The emotional cycle the direction is
   built on — confidence → uncertainty → warning → investigation → contact — was
   executing as confidence → contact. Beats B, C and E of the Atlas vertical
   slice were absent entirely.
2. **The objective named the answer before the player had the question.** "KILL
   THE BROOD QUEEN" printed at the instant of room entry, before she had moved,
   made a sound, or been seen.
3. **Everything arrived at once.** Wake, clutch, hatching, gunfire and a barrel
   overheat inside two seconds. No silence to contrast against (§29).

All three share one root cause: **the encounter had no pacing structure. The wake
was instantaneous and co-located with the reveal.**

**Fix (highest-impact only).** Waking is now two stages.

- **STIRRING** is the warning. She becomes audible across the hall (a new low,
  wet vocalisation that survives 30 m because it lives under 200 Hz), her light
  swells once, and the warning beacons in her part of the sector go red — all
  while she produces *nothing*. The window is 6.5 s, shortening to 3.0 s if the
  player walks straight at her, because a player who charges a noise has chosen
  to skip the anticipation and should be allowed to.
- A single **herald** — one stalker, spawned unalerted at the far end of the
  space — gives the "silhouette at distance" moment. This is what the 60-second
  contract had asked for since it was written and never actually delivered: a
  threat *seen* at range before a threat that is on top of you. It also keeps
  gate X1 honest rather than gaming it.
- **AWAKE** then drops the clutch as before.
- The objective gains an intermediate step, `LOCATE THE SOURCE — CARGO HALL A`,
  and only names her when she stirs.

**Result.** The recorded opening is now:

```
10.13s  enter CARGO HALL A     +  objective: "LOCATE THE SOURCE"
10.68s  MOVEMENT — BEARING UNCONFIRMED   (sound, light, beacons red)
        objective becomes "KILL THE BROOD QUEEN"
11.77s  one scout, at distance
13.68s  queen wakes, clutch drops
14.55s  first hatch
14.60s  first damage
```

Anticipation window: **zero → 3.9 seconds** on an autopilot that walks straight
at threats, and 6.5 s for a player who does not. A new stat, `warningLead`, is
carried in the run report so this cannot silently regress.

## 9. ITERATION 2 — LINEAR MAP, SECTIONS, MAP SCREEN, FIRE

**The sector is now a chain**, rebuilt from a supplied sketch: arrival →
corridor → Bay A (1 node) → corridor → Bay B (2 nodes) → corridor → [pump cell
(1) ‖ stores (0, supplies)] → corridor → reactor floor (4 nodes, then the
matriarch) → lift. The only branch rejoins at the same door. Sections seal
behind the player, each states its goal on entry, and the goal counts down as
they work.

**Difficulty is the number of live sources**, not tougher individuals, and
per-queen budgets shrink as the count rises. The reactor floor is deliberately
two phases — the matriarch is inert until her four brooders are dead — because
five simultaneous sources was measured and killed every seed.

**A station plan on M**, filling in as rooms are entered, with one marker for
the current objective and sealed doors drawn red.

**Fire** exists for the first time: small cone flames with wandering tips, a
nuisance to the operator and genuinely damaging to the Chorus, and incapable of
killing anything — it stops at 30% of a target's health.

Details, including everything the gates caught during the rebuild, are in
TEST_PLAN §6j and §6k.

## 10. A NOTE ON THE WORKING TITLE

The prompt sets the title *A L I I E N S*, styles the two central "I" characters
as an illuminated feature, and separately requires (§31, and the title section
itself) that nothing imitate an existing franchise's branding.

Those two instructions are in tension. The name is one transposed letter from a
specific 1986 film, and doubled illuminated glyphs in the middle of the word is
that film's most recognisable logo treatment. This project has been careful about
originality throughout — DIRECTION §14 lists the specific things avoided — and
the title is the most visible surface of all.

Flagging once, as a professional observation. It is the author's call.
