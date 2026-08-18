# PLAYTEST

Everything in this build has been verified by an autopilot and by headless
captures through a software rasteriser. **No human has played it.** That is the
gap this document exists to close, and it is the reason a few of the questions
below are asked so bluntly — I genuinely do not know the answers.

---

## Run it — desktop

```bash
unzip voidbreach.zip
cd voidbreach
node tools/serve.mjs
```

Open **http://127.0.0.1:8099/**

Node 18+. No build step, no `npm install` needed to play. It must be served over
`http://` — the game is native ES modules, so opening `index.html` off the disk
will not work.

## Run it — phone or tablet

```bash
node tools/serve.mjs --lan
```

It prints your machine's network address. Open that on the phone, on the same
wifi. Plain `http` is fine.

If you skip `--lan` the server binds to loopback only and the phone will simply
time out — that is the most likely reason a first attempt at testing touch fails,
and it is not a bug in the game.

---

## The three schemes

Touch is auto-detected. The **CONTROLS** button in the bottom-right cycles all
three, and `?controls=keyboard|mouse|touch` forces one.

| | Keyboard | Mouse only | Touch |
|---|---|---|---|
| Move | WASD | Left click (hold to keep steering) | Tap |
| Turn | Cursor | Cursor | Direction of travel, or the held bearing |
| Fire | Left click | **Right** click | Press and hold |
| Frag | Right click | Middle click | Two fingers |
| Dash | Space | Double click | Double tap |
| Vent heat | R | R | R |
| Light | F | F | F |
| Station plan | M or Tab | M or Tab | — |

Touch has no vent or light gesture yet. If you find yourself wanting either on
the phone, that is a finding — say so and I will add them.

---

## The route

The sector is a chain now, not a ring. Corridor, chamber, corridor, chamber, and
the door behind you welds shut at two points on the way down — deliberately, so
you never have to wonder whether the thing you want is back the way you came.

| Section | Space | What it asks |
|---|---|---|
| s1 | Arrival deck, dock spine | Walk forward |
| s2 | Cargo Bay A | One brood node |
| s3 | Transfer corridors | Walk forward — *dock spine welds behind you* |
| s4 | Ore Processing | Two nodes, and one is always behind you |
| s5 | Coolant level | The pump cell has the node; **Stores 7-D has the supplies and no node** — the quiet route is allowed to be the right answer |
| s6 | Reactor floor | Four nodes, and something larger that is not moving yet |
| s6b | The matriarch | She wakes when the floor is purged |
| s7 | Extraction | The lift, which does not unlock until she is dead |

Each section states its goal in the corner the moment you cross into it, and the
node count ticks down as you work. **Press M** for the station plan: rooms you
have not entered are outlines only, sealed doors are red, the current objective
pulses, and the arrow is you.

The question I have about all of this: **is it ever unclear where forward is?**
That is the entire point of the rebuild, so a single moment of "which way now"
is worth reporting.

---

## What I need to know

Ranked. The first three are the ones I cannot answer from here.

### 1. Does the hold-to-fire assist feel like help, or like the game playing itself?

On touch, holding turns you to the bearing and pulls the trigger **only** while
something is on that bearing and in line of sight. It will shoot enemies, queens
and egg clutches, and it will not shoot through walls.

The intent is that a finger cannot aim like a mouse and the alternative is
emptying the barrel into a wall. The risk is that it reads as an aimbot. I cannot
tell which from here.

### 2. Is the tap-versus-hold threshold right?

A tap is under **240 ms** and travels under about 2.5% of the screen. Longer or
further is a hold.

Specifically: do you ever mean to tap and get a hold, or mean to hold and get a
scampering marine? That number is a guess.

### 3. Does the opening's warning window land?

Walk into Cargo Hall A. You should hear her before you see anything, the corridor
beacons should go red, one scout should cross at distance, and only then should
the room start producing. Roughly four seconds of "something is there" if you
walk in normally, more if you creep.

Does that read as dread, or as a pause where nothing happens?

### 4. Everything else

- **Click-to-move round corners.** The cyan ring is your destination. Does the
  operator take the route you meant, or wander?
- **Heat.** About three seconds of held trigger from cold to a forced vent. Does
  running hot feel like a decision or like an interruption?
- **The queen's hood.** Shooting her front gives sparks and does about a third
  damage; her flank gives fluid and full damage. Can you tell, in motion, without
  being told? I know this reads poorly in a still frame.
- **The dark.** Is it atmospheric or is it just hard to see? I know the bays are
  still flatter than intended.
- **Fire.** It cannot kill anything — it stops at 30% of a target's health — and
  it hurts the Chorus about seven times as fast as it hurts you. So walking
  through a burning doorway should feel fine and standing in one should not.
  Does it read that way, or does it just look like you are taking damage for no
  reason? The shape is cones with wandering tips rather than the old billboards;
  the previous version carpeted the room and I would rather it be sparse enough
  to step around.

---

## Known rough edges, so you do not report what I already know

- The bays are lit more evenly than the target look. The cause is lamp spacing
  and it is structural, not a brightness slider.
- The queen's hood — the entire tell for her frontal armour — is hard to read
  from the 62° camera. Modelling problem.
- There is no boss. The matriarch on the reactor floor is a larger queen with a
  bigger clutch, not a designed encounter, and the sector ends at a lift.
- Touch has no gesture for the station plan, so on a phone you cannot open it.
- There may be a brief hitch the first time something new appears on screen:
  about fifteen shader programs still compile after the prewarm.
- Touch has no on-screen buttons at all. Deliberate for now, possibly wrong.

---

## Useful URLs

| URL | What |
|---|---|
| `/?stats=1` | Live profiler: frame p50/p95/p99, draw calls, entity counts, hitches |
| `/?seed=4242` | A different run. 1337, 4242 and 777 are the three that are gate-tested |
| `/?controls=mouse` | Force a scheme |
| `/?q=low` | Force a quality tier if the phone struggles |
| `/studio.html` | Live material / lighting / grade / model editor |

If it crashes or does something inexplicable, `/?stats=1` plus what you were
doing is usually enough for me to find it.
