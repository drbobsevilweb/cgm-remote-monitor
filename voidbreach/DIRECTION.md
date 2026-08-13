# VOIDBREACH — DIRECTION

Authoritative document for **experiential goal**, **visual language** and **audio language**.
Code may not contradict this document. If the game needs to contradict it, change this
document first, with a reason.

---

## 1. THE ONE SENTENCE

*Four operators descend into a deep-space refinery that has stopped being architecture and
started being an organism, and the only way out is downward.*

---

## 2. EXPERIENTIAL GOAL

The player should feel like a **competent professional in a situation that is deteriorating
faster than their competence can absorb.**

Not a hero. Not a victim. A worker with a very good rifle and a diminishing number of options.

Three feelings, in priority order:

1. **Pressure** — the sense that the room is filling up. Enemies arrive continuously from
   directions the player did not choose. Standing still is always wrong.
2. **Agency** — the pressure has a *source*, the source is *visible*, and the source can be
   *destroyed*. The player is never merely enduring; they are always able to identify the
   thing that would make this stop. Agency is layered, not binary: between "endure this" and
   "kill the queen" there are always cheaper interventions available — shoot the eggs before
   they come to term, weld the vent the flankers use — so the answer to a bad room is never
   only "be better at shooting".
3. **Relief** — when the source dies, the room audibly and visibly empties. This contrast is
   the payload of the entire game. Everything else exists to make this moment land.

If a design decision does not strengthen pressure, agency or relief, it is decoration.

### The 60-second contract

A new player, given no explanation, must experience this sequence:

| t | Beat | Delivered by |
|---|------|--------------|
| 0:00 | Understands movement and firing | Empty corridor, one shootable light, cursor-facing body |
| 0:08 | Sees a distant threat | Silhouette crossing a lit doorway 25 m ahead, audio first |
| 0:15 | Is attacked by a swarm | Runners from front arc, then a flank from a side vent |
| 0:25 | Realises they keep coming | Spawn rate exceeds kill rate; the corridor visibly fills |
| 0:30 | Identifies the source | Eggs on the deck lead back to the queen; her sac *swells* on the same rhythm the eggs appear |
| 0:38 | Pushes through | Kill-corridor toward the queen is deliberately survivable, and the eggs on the way are worth shooting |
| 0:48 | Kills the queen | Rupture, pressure wave, lighting event, fluid, and her unhatched clutch goes out with her |
| 0:50 | Feels the pressure drop | Living enemies panic/retreat, spawn stops, music drops to room tone |
| 0:55 | Finds the next route | Bulkhead cycles open, warm amber light from the next space |
| 0:60 | Wants to continue | — |

This table is a **test**, not a wish. See TEST_PLAN §4.

---

## 3. SETTING (original)

**THE HELIX DEEP.** A thorium-cycle ore refinery and transfer station, built by the
**Cassavant Reclamation Combine** in the outer belt of a system nobody named. It refines
"cold mass" — silicate ore hauled from a shepherd moon — and ships ingots inward. 400 crew.
Eleven decks. Built cheap, maintained cheaper.

Nineteen days ago a cargo cycle brought up something in the ore that was not ore.

The infestation is called the **VOID BREACH** by the salvage charter, and the organisms are
the **CHORUS** — because they are not individuals. They are a distributed organism that
*grows infrastructure*. It does not eat the station; it **re-uses** it. Ducts become
arteries. Conveyors become peristalsis. The Chorus is an engineer with bad taste.

The player squad are **SALVAGE OPERATORS** under a Reclamation Charter: not soldiers, not
scientists. Contractors with a legal right to whatever they can carry out, and a contractual
obligation to restore the reactor before the station's orbit decays into the shepherd moon.

**Terminology** (used in HUD, audio, labels — never generic sci-fi filler):

| Term | Meaning |
|------|---------|
| The Helix Deep | The station |
| The Chorus | The alien ecosystem, collectively |
| Breach-node / node | An infestation spawner |
| Chorusflesh | The organic material overgrowing the station |
| Bulkhead cycle | Opening a pressure door |
| Charter / Operator | Player faction and unit |
| Cassavant | The builder corporation (signage, stencils) |
| Cold mass | The ore |
| Deck-plate, rib, trunk, tray | Station construction vocabulary |
| Reclaim | To clear a sector |

Environmental storytelling rule: **the station must explain what it did for a living before
it explains what happened to it.** Ore first, catastrophe second.

---

## 4. CAMERA

- High three-quarter, **62° downward pitch** (within the 55–70° brief), 60° vertical FOV.
- Distance 16.5 m nominal, so the player sees ~19 m ahead — enough to read an incoming swarm
  before it is a problem.
- **Follow**: critically-damped spring, ~150 ms settle. Camera leads the cursor by up to
  2.2 m (30% of cursor offset, clamped) so aiming *reveals* rather than just points.
- **Contextual zoom**: 16.5 m nominal → 15.2 m in tight corridors (readability) → 18.5 m for
  the boss reveal and large rooms. Rate-limited to 1.5 m/s so it is never noticed as a zoom,
  only felt as space.
- **Screenshake budget**: only nest rupture, explosive tank, boss slam, player heavy damage.
  Never for ordinary gunfire. Ordinary gunfire gets *recoil kick on the camera lead*, not
  shake. Max shake amplitude 0.35 m, decays in < 400 ms.
- Camera never clips architecture: it is above the ceiling plane; ceilings are not rendered
  as solid over the player's room (open-roof convention, consistent across the station).

**Readability is the camera's only job.** The player must always know: where they are, where
enemies come from, where the exits are, what is interactive, what is dangerous.

---

## 5. LIGHT — THE PRIMARY AUTHORING TOOL

Light is how the level is composed. Geometry supports light, not the reverse.

**Rules:**

1. **Every light source is a visible object.** No light without a lamp, a screen, a flame, a
   fluid, or a muzzle. The player must be able to look at a pool of light and point at the
   thing making it. (Corollary: breaking the lamp removes the pool.)
2. **Darkness is a place, not a filter.** Dark areas are specific rooms with a reason to be
   dark (failed circuit, coolant fog, deck the Chorus has covered). The player's flashlight
   is the answer, and dark rooms are where the flashlight becomes the primary verb.
3. **Never fully black.** Floor luminance in playable space never falls below ~0.012 in
   linear terms — enough for silhouette and floor plane to read after eye adaptation.
   Enforced by the LUMA gate (TEST_PLAN §5.1).
4. **Threat announces itself in light before geometry.** Enemies are introduced as:
   silhouette against a lit door → eyeshine in the dark → moving shadow across a wall →
   partial form crossing a practical lamp. Once combat starts, threats are unambiguous.
5. **Colour carries meaning, consistently:**

| Colour | Hex (sRGB) | Meaning — never used for anything else |
|--------|-----------|---------------------------------------|
| Amber work lamp | `#ffb45a` | Safe/functional station power. Progress. Exits. |
| Emergency red | `#ff3a2e` | Alarm, hazard, locked, damaged |
| Cyan display | `#5fd8ff` | Interactive, information, Tech energy, player weapons |
| Chorus violet-magenta | `#c23bd8` | Alive, alien, and **spawning** — nests and their spawn flash |
| Bile green-yellow | `#b8ff4a` | Corrosive/biological hazard — spitter pools, acid |
| Sodium wash | `#ff8a3d` | Deep station / reactor heat |

The nest colour appears **nowhere else in the game**. When the player sees violet, they know
what it is before they know what it is.

6. **Practical lamps are motivated:** work lamps hang on ribs at 5 m spacing in corridors,
   over consoles, above doors. Emergency strips run at ankle height along escape routes —
   which means the emergency lighting *is* the wayfinding.

**Light budget** (performance contract): 1 shadow-casting spot (player light) + max 6 pooled
dynamic point lights, priority = intensity / distance². Everything else is emissive geometry
plus baked "pool" decals.

---

## 6. GRATING — THE SIGNATURE

The station stands on **real grating**: instanced bar geometry, 250 mm pitch, 30 mm bars,
50 mm deep, over open voids with machinery 3–4 m below.

- The player's flashlight casts **real shadows through it** — a moving lattice on the walls
  and on the machinery below.
- Muzzle flashes and explosions **flash the underside**, momentarily revealing the void.
- Enemies moving under the grating are visible as motion between bars before they climb up.
- Footsteps on grating have their own audio and a different impact material.

If a screenshot cannot be identified as VOIDBREACH by its grating shadows, the look has
failed.

---

## 7. MATERIAL / CONSTRUCTION LANGUAGE

One organisation built this station. The construction system is shared by every space.

| Element | Dimension | Notes |
|---------|-----------|-------|
| Base unit | 1 m = 1 world unit | Grid cell 2.5 m |
| Wall panel | 1.25 m × 2.4 m | Recessed 40 mm, 8 mm seam |
| Structural rib | every 2.5 m, 300 mm deep | Carries lamps, trays, signage |
| Corridor height | 3.2 m | Halls 4.6 m, Processing 7 m |
| Grating | 250 mm pitch, 30 mm bar | See §6 |
| Rivet | 40 mm dia., 300 mm spacing | Along seams and rib flanges |
| Pipe trunk | 160 / 320 mm dia. | Runs at 2.6 m, colour-coded collars |
| Cable tray | 400 mm wide | Runs at 2.9 m, under trunks |
| Junction box | 400 × 300 × 180 mm | On ribs, cyan or amber pilot LED |
| Door / bulkhead | 2.5 m wide × 3.0 m | Two-leaf iris for pressure, single slide for service |
| Console | 1.1 m work surface | Cyan screen, amber keys |
| Hazard stencil | 45°, 200 mm pitch | Amber/black; red/black for pressure |
| Deck plate | 1.25 m square, diamond tread | Worn to smooth at traffic lines |

**Surface families and their damage response** (this is a gameplay contract, not just art):

| Family | Look | Bullet response |
|--------|------|-----------------|
| Steel / structure | Dark blue-grey, 0.55 roughness, high metalness | **Sparks**, ricochet whine, bright hot pit decal |
| Ceramic / panel | Dirty neutral, matte | **Chips**, dust puff, pale crater decal |
| Grating | Dark, thin | Sparks + audible pass-through, occasional deflection |
| Screen / lamp | Emissive | **Shatters**, light dies permanently, sparks then dark |
| Chorusflesh | Wet, sub-scattering violet-brown | **Ruptures** — fluid spray, no sparks, soft wet impact |
| Pressure tank | Yellow band, red cap | Leaks jet → detonates |

**Wear language:** grime pools in corners and low panels; traffic wears deck plate along
walking lines; every space shows evidence of a fast, failed evacuation — dropped cargo,
welded barricades, hand-stencilled directions over official signage. Infestation reads as
**inversion**: violet flesh climbing *up* structures that are lit *amber*.

---

## 8. ATMOSPHERE & PARTICLES

- **Dust is nearly invisible until light hits it.** Motes are tiny, dark by default, and only
  become visible inside a light cone (flashlight, work lamp shaft, muzzle flash). No
  permanently glowing atmospheric sparkle — that is the signature of an unauthored scene.
- **Steam and smoke are volumes with direction.** Coolant vents jet horizontally, fire smoke
  rises and pools at the ceiling, nest rupture smoke is heavy and falls.
- **Fog is depth, not mood.** Exponential-squared height fog tuned so a 25 m corridor still
  resolves its far wall. Fog may never be used to hide a lighting failure.

## 9. COLOUR / TONEMAPPING

Rendering is linear HDR → bloom → **AgX** tonemap → sRGB. AgX for its hue stability at high
intensity: a muzzle flash must go white without turning the corridor magenta.

- Exposure nominal 1.0; slow auto-exposure is **not** used (it makes the dark rooms bright
  and destroys the point of them). Instead: fixed exposure, authored light levels.
- Bloom threshold 1.15, soft knee, 5 progressive mips, strength 0.42 — for emissive sources
  only. **Bloom may never be used to compensate for weak materials.**
- Grade: cool shadow lift toward blue-black `#0a0e14`, neutral mids, warm highlight roll.
  Slight desaturation of shadows, protected saturation in the six meaning-colours (§5.5).
- Grain: 0.022 amplitude, driven by the **engine clock** (deterministic), not wall time.

## 10. AUDIO DIRECTION

- **Room tone always.** Ventilation, distant machinery cycling, electrical hum, structural
  groan, condensation drip, unexplained distant impacts. The station is alive at idle.
- **Music is sparse and reactive.** A low drone bed that appears when pressure rises and gets
  *out of the way* when it does not. Silence after a nest dies is the loudest moment in the
  game — the drone must be gone within 400 ms of the rupture.
- **The Chorus is heard before it is seen.** Every enemy has an approach vocalisation with a
  distinct frequency band and it is spatialised: runners chitter high and fast, stalkers make
  a low intermittent clicking that stops when they are about to strike, spitters have a wet
  charge-up that is the player's only warning to move.
- **Weapons need mechanics, not just bang.** Transient → body → mechanical tail (bolt, case,
  spring). Reload is three distinct sounds (release, seat, charge). Low-ammo changes the
  weapon's sound before the HUD says anything.
- All audio is **synthesised at runtime** (WebAudio graph). No asset downloads. Positional
  via equal-power pan + distance/occlusion attenuation in camera space.

## 11. WHAT THIS GAME IS NOT

Not a bullet-hell (projectiles are readable and sparse). Not a cover shooter (there is no
cover, only geometry and distance). Not survival-horror with scarce ammo — **the primary
weapon has no ammunition at all**, see §13. Not an RPG (no trees, no crafting, no inventory).
Not a roguelite (the sector is authored, and it is authored well).

## 12. THE BROOD — WHY QUEENS AND EGGS

The source of the pressure is a **brood queen**: an anchored, hooded animal that lays eggs,
and the eggs hatch into the Chorus. It is not an abstract spawner, and the difference is not
cosmetic.

A spawner produces enemies from nothing. There is exactly one thing to do about it, and the
room gives no warning before the thing that is about to kill you exists. A queen produces a
**visible intermediate**: a clutch of eggs on the deck, each with a bright core that grows as
it comes to term. That single change buys four things the abstract version could not:

1. **The room forecasts itself.** Six eggs at half-ripeness is a legible statement about the
   next ten seconds. The player can read the room's future off the floor.
2. **A cheaper answer exists.** An egg has 22 health. Killing one costs two rounds and a
   little heat; killing what hatches out of it costs far more. Choosing to spend that heat
   *now* is a real decision, made under pressure, with a visible payoff.
3. **The frag becomes a level tool.** A grenade into a fresh clutch is the strongest single
   action in the game against a queen who has been laying for twenty seconds. Explosives
   ignore her hood entirely, so the secondary has a specific, learnable purpose beyond
   "crowd".
4. **The relief beat gets stronger.** When a queen dies, her unhatched clutch dies with her.
   Nothing is left in the pipe. The drop is total, which is what §2 asked for.

She has one more property: the **hood**. It is mineral, not meat, it is a visibly different
material, and it eats two thirds of anything that hits her frontal arc. The answer to a queen
is therefore to get behind her — which means moving, in a room she is actively filling. The
armour is not there to add health; it is there to make the fight a movement problem.

**Vents** are the other half of this. They were always where flanking pressure came from, and
they are now grilles with health. Weld one shut and the Chorus has permanently lost a bearing
it can arrive from. It is the only permanent, player-authored change to the level.

## 13. HEAT — WHY THE CARBINE HAS NO AMMUNITION

The MK4 draws from the suit cell. Rounds are not the constraint; the barrel is.

"Am I out of ammo" is a question with one answer, asked at the worst possible moment, and
answered by a number in the corner of the screen rather than by anything the player is doing.
It produces two bad states: a full magazine, where the resource is invisible and free, and an
empty one, where the player is a spectator. Neither is a decision.

"How long can I keep holding this trigger" is asked continuously, answered with a finger,
and weighed against what is actually in front of the player right now. Same tension, better
question. So:

- Heat builds per round. About 29 rounds — a little over three seconds — takes a cold barrel
  to the redline.
- Above the redline the bar pulses and a thin rising tone plays under the gunfire. This is
  the only warning, and it is enough.
- At 100% the barrel **vents itself**: a long, flat 2.15 s lockout the player did not choose,
  with a heavy gas release and a camera shake. It is meant to feel like a mistake.
- **R vents manually**, and it costs less the earlier it is done — half a second from nearly
  cold, most of two seconds from the redline. The skill is letting go before you have to.
- Heat also widens the group, so a hot barrel is a worse barrel before it is a stopped one.

**Special weapons are the exception**, and they are the only ammunition left in the game. The
ARC LANCE has 22 charges, does not regenerate, generates no heat, and pierces three bodies.
It is a resource you *found*, and the interesting question about a found resource is when to
spend it — which is a different question from the one heat asks, which is why both exist.
When it runs dry the operator falls back to the carbine automatically. There is no stow
control: a special is a temporary state, not a loadout slot.

**Coolant canisters** dump current heat and double the cooling rate for twelve seconds. They
are the pickup that means the most in a long fight and nothing at all in a corridor, which is
the correct shape for a consumable.

## 14. ORIGINALITY GUARDRAILS

The Chorus organisms are built from **arthropod + fungal + industrial** references:
segmented plating, radial mouths, sporing structures, mineral crusts. Explicitly avoided:
biomechanical ribbed heads, inner jaws, elongated smooth craniums, chest-bursting,
xenomorph silhouettes, acid-blood-through-decks, facehugger analogues, motion trackers with
the famous ping, "colonial marine" iconography, corporate-conspiracy plotting, or any name,
logo or prop from an existing property. The station is a *refinery*, not a colony. The
operators are *contractors*, not marines. The threat *builds*, it does not merely breed.
