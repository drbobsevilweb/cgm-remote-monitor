# VOIDBREACH

A top-down sci-fi horde shooter. Four salvage operators descend into a deep-space
ore refinery that has stopped being architecture and started being an organism.

Runs in the browser. **Zero binary assets** — every texture is drawn to a canvas
at boot, every mesh is built from primitives, every sound is synthesised. The
only runtime dependency is three.js, and it is vendored in `vendor/`.

---

## Play it

```bash
cd voidbreach
node tools/serve.mjs          # any static server works; this one just disables caching
```

Then open **http://127.0.0.1:8099/**

There is no build step and nothing to install. `npm install` is only needed for
the automated tests.

| Key | Action |
|-----|--------|
| **WASD** | Move |
| **Mouse** | Aim (the operator always faces the cursor) |
| **LMB** | Pulse carbine — no ammunition, but it overheats |
| **RMB** | Underslung frag — lobbed at the cursor |
| **SPACE** | Combat dash (0.22 s of i-frames) |
| **R** | Vent the barrel |
| **F** | Operator light |

The objective is on the top left, and the violet pips under it are the **brood
queens** remaining. A queen is the source of the pressure: find the violet light,
push through, kill her, and the room empties.

### The three things that are not obvious

**The carbine never runs out, and that is not the same as free.** Every round
heats the barrel. About three seconds of held trigger takes it from cold to the
redline, and at 100% it vents *itself* — a flat two-second lockout you did not
choose, with a gas release and a shake. **R** vents it manually, and it costs
less the earlier you do it: half a second from nearly cold, most of two seconds
from the redline. The bar is bottom-right. Letting go before you have to is the
whole skill.

**Shoot the eggs.** A queen does not spawn enemies — she lays clutches, and the
eggs hatch. Each egg has a bright core that grows as it comes to term, so a room
tells you what is about to happen to it. An egg takes two rounds. What hatches
out of it takes considerably more. A frag into a fresh clutch is the strongest
single action in the game.

**She is armoured at the front.** The mineral hood eats two thirds of anything
that hits her frontal arc — sparks instead of fluid, and you can hear it. Get
behind her. Explosives ignore the hood completely, at any angle.

Also: **wall grilles can be shot out.** Five rounds welds one shut, and the
Chorus has permanently lost a bearing it can flank you from. It is the only
permanent change you can make to the station.

Useful URLs:

| URL | What it does |
|-----|--------------|
| `/` | Play |
| `/?stats=1` | Live profiler: frame p50/p95/p99, sim time, draw calls, entity counts, hitches |
| `/?seed=4242` | Different seed |
| `/?q=low` \| `medium` \| `high` | Force a quality tier |
| `/studio.html` | The material / light / grade / model editor (see STUDIO.md) |

---

## Test it

### 1. Static checks — instant, no browser

```bash
npm run check
```

Runs four things: the subsystem dependency rules, the determinism scan of the
simulation path, the geometry winding invariants, and sector connectivity.
All four should print `PASS`.

### 2. Prove the instruments work — instant, no browser

```bash
npm run validators
```

Feeds every image detector a deliberately broken input and requires it to
**fail**, plus a known-good input and requires it to **pass**. 31 self-tests.
This runs first in the gauntlet and blocks everything else, because a
measurement taken with an unproven instrument is not evidence.

### 3. Everything else — needs a browser

```bash
npm install --no-save playwright
npx playwright install chromium
```

Then, with the server running in another terminal:

```bash
npm run replay      # the 12-beat self-play run (~4 min headless, faster with a real GPU)
npm run capture     # canonical camera states into captures/current/
npm run validate    # measure those captures against the visual gates
npm run gauntlet    # all of the above, in the order that makes them mean something
```

`npm run replay` prints a JSON report. The line that matters is
`"pass": true` and `"beatsPassed": 12`. It drives the game through the ordinary
input path — the same `InputFrame` a keyboard produces — so it is a test of the
game, not of a parallel code path.

`npm run replay` prints a JSON report. The line that matters is `"pass": true`
and `"beatsPassed": 15`. Fifteen beats, not twelve: three were added with the
queens, the eggs and the thermal cycle, and one of them (`overheat_barrel`)
deliberately tests the game *failing well* — the autopilot fires greedily for its
first seventy seconds and lets the barrel take the decision away from it, because
that is what a player does before they have learned the bar.

### What "passing" currently looks like

```
beats            15/15, exit reached at 194 s with 84/140 health
first threat     11.6 s   (gate: <= 12 s)
first damage     14.5 s   (gate: 14-40 s)
peak enemies     18       (gate: >= 10)
first queen dead 31.5 s   (gate: <= 90 s)
relief ratio     0.25     (gate: <= 0.40)
eggs killed      25       — the second answer, being used
vents sealed     4        — permanent, player-caused
forced vents     7        vs 39 manual: the thermal decision is live
draw calls       139      (gate: <= 220)
triangles        55.3 k   (gate: <= 900 k)
```

Known failures are listed honestly in **TEST_PLAN §6c** — the shader-prewarm
gate (P7), the determinism A/B pair, the visual gates on the full state set, the
final boss organism, and four-player co-op (planned and costed in
**MULTIPLAYER.md**, not started).

### A note on headless numbers

Headless Chromium renders through SwiftShader, a software rasteriser. Frame
rate measured that way is meaningless, so the performance gates are expressed as
**CPU simulation time plus structural budgets** (draw calls, triangles, lights,
allocations), which *are* valid there. Wall-clock FPS is reported by `?stats=1`
on real hardware and is deliberately not a headless gate. This is a documented
limitation rather than a fabricated number.

---

## Read it

| Document | What it is |
|----------|-----------|
| **DIRECTION.md** | The experiential goal, the 60-second contract, the light rules, the six meaning-colours, the construction language. Authoritative for *what it should feel and look like*. |
| **ARCHITECTURE.md** | Subsystem ownership, the dependency table, the determinism contract, the decision log. Authoritative for *how it is put together*. |
| **TEST_PLAN.md** | Numbered, measurable gates — including §6b (what the instruments have actually caught) and §6c (what is still failing). |
| **STUDIO.md** | The live authoring tool. |
| **MULTIPLAYER.md** | Four-player co-op: why it is not pre-built, what is already right for it, and the 64 couplings that block it. |

## Layout

```
index.html          play
studio.html         author
vendor/             pinned three.js r185 (the only runtime dependency)
src/core/           clock, seeded RNG, events, pools, spatial hash
src/level/          collision grid, flow-field navigation, the authored sector
src/environment/    procedural textures, merged geometry, props, grating
src/renderer/       HDR pipeline, hand-written bloom, AgX tonemap, camera rig
src/{player,weapons,enemies,director}/   gameplay (queens and eggs: enemies/Broods.js)
src/{lighting,vfx,audio,hud}/            presentation
src/qa/             profiler, self-play harness, canonical camera states
tools/              dev server and the whole gauntlet
```
