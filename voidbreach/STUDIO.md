# VOIDBREACH — STUDIO

A live authoring tool for the station's look, at `studio.html`.

```
node tools/serve.mjs
open http://127.0.0.1:8099/studio.html
```

There is also a `STUDIO` link in the bottom-right corner of the game.

---

## Why this works at all

VOIDBREACH ships **zero binary assets**. Every texture is drawn to a canvas at
boot, every mesh is built from primitives, and every sound is synthesised. That
was originally a load-time and determinism decision (ARCHITECTURE §1), but it
has a second consequence: *there is no art pipeline to edit around*. If the
parameters that drive generation are data, a live editor is a thin panel over
them.

Making that true required one refactor: the texture generators used to have
their numbers as literals buried in drawing code. They now take a parameter
object, and `TEXTURE_DEFAULTS` in `src/environment/Textures.js` is the single
source of truth for what the station is made of.

---

## What you can edit

| Tab | Controls |
|-----|----------|
| **MATERIALS** | Per surface family (steel, deck, painted, ceramic, Chorusflesh, hazard): base colour, roughness, metalness, panel/plate/tread dimensions in metres, rivet spacing and size, scratch and grime density, grime tint, normal strength. Dimensions are the construction language of DIRECTION §7 — change `panel` and every wall in the sector changes with it. |
| **LIGHT** | Lamp intensity (candela), operator-light intensity, ambient level, IBL intensity. Per room tone: ambient colour, fill colour, **lamp accent colour** and **emitted light colour** separately, level, lamp multiplier. Plus the six meaning-colours of DIRECTION §5.5. |
| **GRADE** | Exposure, bloom strength and threshold, the four AgX look parameters (slope / power / saturation / offset), grade saturation, vignette, film grain, chromatic aberration, shadow and highlight tint, fog density and colour. |
| **MODELS** | Creature archetype selection, uniform scale, accent emissive strength. The selected creature is laid out in rest pose in the diorama so model changes read against the real materials. |

The centre viewport is a diorama built with **the same `MeshBuilder`, the same
materials and the same post-processing chain as the game**, so it is genuinely
WYSIWYG rather than an approximation. Click a material's section header to
route its albedo / ORM / normal maps to the right-hand inspector.

Drag to orbit, wheel to zoom, right-drag to pan.

---

## Getting your edits into the game

| Button | Effect |
|--------|--------|
| **APPLY TO GAME & PLAY** | Saves and jumps straight into `index.html` |
| **SAVE OVERRIDES** | Saves to `localStorage`; the game picks them up on next load |
| **COPY JSON** | Exports the whole parameter set to the clipboard |
| **PASTE JSON…** | Loads an exported set back (click, paste, click again) |
| **RESET TO SHIPPED DEFAULTS** | Clears overrides entirely |

To promote an edit from "my browser" to "the game", paste the exported values
into `TEXTURE_DEFAULTS` (`src/environment/Textures.js`) or `TONES` / `PAL`
(`src/environment/Palette.js`). Overrides are a scratchpad; the source files
are the product.

---

## The one rule that matters

**Overrides are ignored in any deterministic run** — anything with `?test=` or
`?shot=` in the URL. This is enforced in `src/core/Overrides.js` and is not
optional.

The reason is that the whole QA apparatus depends on captures being a function
of the code and the seed alone (ARCHITECTURE §3.6). If a golden image could
depend on what somebody left in their browser's local storage, every visual gate
would silently become a measurement of local state instead of a measurement of
the game.

Verified end to end:

```
normal run  : usingOverrides=true   exposure=2.5  fog=#00ff00   <- overrides applied
determ. run : usingOverrides=false  exposure=1.0  fog=#0a0f16   <- shipped defaults
```

So you can leave a lurid experiment saved and `node tools/run-gauntlet.mjs`
still measures the real game.

---

## Known limits

- **Model editing is parametric, not free-form.** You can choose an archetype,
  scale it and change its glow; you cannot drag vertices. The creature meshes
  are code (`buildArchetypeGeometry`), so richer model editing means exposing
  more of their part dimensions as data — the same refactor that was done for
  textures, applied to `Archetypes.js`. That is the obvious next step and it is
  not difficult, just unstarted.
- **Props and level layout are not editable here.** The sector is authored data
  in `sectors/helix_deep.js`; a layout editor is a different tool.
- Texture regeneration takes roughly 200 ms, so slider drags are debounced.
  Colour and grade changes are instant because they do not rebuild textures.
- The diorama uses a fixed representative lighting rig, not the sector's full
  light budget, so absolute brightness in a real room will differ a little.
