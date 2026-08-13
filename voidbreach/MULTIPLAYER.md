# VOIDBREACH — FOUR-PLAYER CO-OP

**Status: planned, not started.** Nothing in the shipped code is netcode. This document
exists so that the decision is made deliberately when it is made, and so that the work
between here and there is *counted* rather than guessed at.

The four operator archetypes (Assault / Heavy / Tech / Medic) were always designed as a
roster. Co-op is what they are for. It is the right long-term shape for this game.

---

## 1. Why this is not being pre-built

The temptation is to "make it multiplayer-ready" now — replace `player` with `players[]`,
add a `localPlayerId`, and call it prepared. That is speculative abstraction, and it is the
expensive kind: the netcode model dictates what the right generalisation *is*, and choosing
the model later would very likely contradict whatever was guessed at first.

Concretely, lockstep and authoritative-host want *opposite* things from the same code:

| | Deterministic lockstep | Authoritative host |
|---|---|---|
| What crosses the wire | `InputFrame` per player per tick | World state deltas |
| What must be identical | Everything, bit for bit | Nothing; the host is truth |
| Cost of a float discrepancy | Total desync | Nothing |
| Latency handling | Input delay or rollback | Client prediction + reconciliation |
| Where `players[]` lives | In the simulation, symmetric | Split: authoritative copy + local prediction |

An abstraction that suits one is wrong for the other. So the position is: build nothing until
the model is chosen, but *protect the substrate that makes either model reachable*.

## 2. What is already right

These were built for determinism and testability, and they happen to be exactly the
foundations co-op needs. They are not accidental and they should not be given up:

- **Fixed 1/60 timestep**, with rendering interpolated separately. Simulation advances in
  discrete, countable ticks — the unit both models are built on.
- **`InputFrame` is the only path into the simulation.** Nothing moves the operator except a
  frame of intent. The self-play harness proves this daily: it drives the whole game through
  the same struct a keyboard produces. That is one third of a lockstep implementation already
  written and continuously tested.
- **Seeded RNG with named child streams.** `rng.child('broods')` cannot be perturbed by
  `rng.child('vfx')` consuming differently. Under lockstep this is the difference between a
  workable system and an undebuggable one.
- **The determinism scan** (`tools/check-determinism.mjs`) already fails the build for
  `Date.now()`, `Math.random()` and iteration-order dependencies on the simulation path.
- **Event bus for cross-cutting effects.** Presentation subscribes; it never drives. Under a
  host model, presentation events are what you replicate cheaply.

## 3. What actually blocks it — measured, not estimated

```
64  references to a singular `player` outside src/player/
 4  files carrying them: Game.js, Enemies.js, Nav.js, Replay.js
```

By subsystem, and what each one actually needs:

| Subsystem | Coupling | Work |
|---|---|---|
| **GAME** | Constructs one `Player`, one `Weapons`; `step()` threads `this.player` into every subsystem | Roster + per-player weapons. The bulk of the change, but mechanical. |
| **ENEMIES** | `this.player` for steering, target selection, attack, LOS | **The real design work.** Not "which player is nearest" — target selection is what makes a horde feel like it has intent, and four targets changes the answer. See §4. |
| **LEVEL/Nav** | Two flow fields, both anchored to *the* player: PLAYER and FLANK | Multi-source BFS already supports many sources — `build(sources, count)` takes an array. Feeding it four player cells is nearly free. The FLANK field is the harder one: "behind the player" is ill-defined for four. |
| **BROODS** | `chooseLaySite` avoids the player; queens wake within 32 m of the player | Trivially generalises to "any player". |
| **DIRECTOR** | Pressure read from one player's surroundings and health | Needs a real answer, not a mean: pressure should track the *worst-off* operator, or the loop rewards splitting up. |
| **RENDERER** | One camera rig following one operator | Split-screen is out of scope; each client renders its own. Under a host model this is free. |
| **HUD/AUDIO** | One health bar, one listener | Squad status panel; listener is per-client. |
| **QA** | Harness drives one operator | Either drive N, or drive one and let the others idle. Beat definitions need re-reading either way. |

## 4. The design question that matters more than the netcode

**Enemy target selection.** Today a runner goes at the player because there is one. With four,
"nearest" produces the worst possible behaviour: the whole Chorus converges on whoever is
marginally closest, everyone else becomes a spectator, and the pressure→agency→relief loop —
the entire point of the game, DIRECTION §2 — collapses into "one person is fighting".

Some form of threat weighting is required. Candidates, in rough order of preference:

1. **Weighted by recent damage dealt plus proximity plus a per-enemy commitment timer.** An
   enemy that has picked a target keeps it for a few seconds. Produces natural fan-out and
   readable individual behaviour.
2. **Per-brood assignment.** Each queen's children prefer a different operator. Cheap, and it
   makes the queens feel like distinct intelligences, which suits the fiction.
3. **Soft cap on attackers per operator.** Blunt, but guarantees nobody is idle.

This has to be prototyped and *measured against the same self-play gates*, not chosen by
taste. It is the reason co-op is a real project rather than a networking task.

## 5. Recommended model

**Authoritative host with client prediction**, not lockstep. Reasons, in order:

1. A missed tick in lockstep desyncs the whole session. This game spawns hundreds of agents
   and thousands of particles; the surface area for a discrepancy is large, and the failure
   mode is catastrophic and hard to reproduce.
2. Players joining mid-session is natural under a host and painful under lockstep.
3. The determinism work is not wasted under a host model — it is what makes the host's
   simulation reproducible and its bugs debuggable.

The presentation layer is already fully decoupled through the event bus, which is what makes
the host model cheap here: replicate entity transforms plus the event stream, and every
client's VFX, audio, and lighting react exactly as they do in single-player.

## 6. Order of work, if it is greenlit

1. Enemy target selection prototype, single-player, with 3 dummy operators — measured against
   the existing beats. **Do this first**; it is the part that can fail.
2. Roster: `players[]` in GAME, per-player WEAPONS, multi-source nav fields.
3. Director pressure model for a squad.
4. Squad HUD, downed/revive state (this is where the Medic archetype earns its existence).
5. Only then: transport, host authority, prediction, reconciliation.

Steps 1–4 are worth doing on their own merits even if the networking never happens, because
they are what makes the roster real. Step 5 is the only part that is purely networking.
