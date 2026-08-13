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
| **LMB** | Pulse carbine |
| **RMB** | Underslung frag — lobbed at the cursor |
| **SPACE** | Combat dash (0.22 s of i-frames) |
| **R** | Reload |
| **F** | Operator light |

The objective is on the top left, and the violet pips under it are the
breach-nodes remaining. Nodes are the source of the pressure: find the violet
light, push through, destroy it, and the room empties.

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

### What "passing" currently looks like

```
beats            12/12, exit reached at 201 s with 80/140 health
first threat     11.2 s   (gate: <= 12 s)
first damage     14.7 s   (gate: 14-40 s)
peak enemies     15       (gate: >= 10)
first node dead  23.3 s   (gate: <= 60 s)
relief ratio     0.00     (gate: <= 0.40)
draw calls       120      (gate: <= 220)
triangles        43.6 k   (gate: <= 900 k)
```

Known failures are listed honestly in **TEST_PLAN §6c** — the shader-prewarm
gate (P7) is failing at 13 compilations, the determinism A/B pair is unrun, and
the final boss organism is designed but not built.

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

## Layout

```
index.html          play
studio.html         author
vendor/             pinned three.js r185 (the only runtime dependency)
src/core/           clock, seeded RNG, events, pools, spatial hash
src/level/          collision grid, flow-field navigation, the authored sector
src/environment/    procedural textures, merged geometry, props, grating
src/renderer/       HDR pipeline, hand-written bloom, AgX tonemap, camera rig
src/{player,weapons,enemies,director}/   gameplay
src/{lighting,vfx,audio,hud}/            presentation
src/qa/             profiler, self-play harness, canonical camera states
tools/              dev server and the whole gauntlet
```
