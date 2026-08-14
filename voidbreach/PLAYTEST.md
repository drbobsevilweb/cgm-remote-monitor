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

Touch has no vent or light gesture yet. If you find yourself wanting either on
the phone, that is a finding — say so and I will add them.

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

---

## Known rough edges, so you do not report what I already know

- The bays are lit more evenly than the target look. The cause is lamp spacing
  and it is structural, not a brightness slider.
- The queen's hood — the entire tell for her frontal armour — is hard to read
  from the 62° camera. Modelling problem.
- There is no boss. The sector ends at a lift.
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
