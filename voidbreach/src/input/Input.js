// INPUT — produces an InputFrame (an intent struct). Nothing downstream knows
// whether the intent came from a keyboard, a mouse, a finger, a replay script or
// a test.
//
// The self-play harness (QA) implements the same interface, which is what makes
// "the scripted player uses the normal input path" true rather than aspirational.
// It is also why adding two entire control schemes here changes nothing about
// determinism: the harness injects its own InputFrame and never constructs this
// class at all.
//
// INPUT MUST NOT TOUCH THE WORLD (ARCHITECTURE §2). Pointer-driven movement
// obviously needs to know about walls, and target-assisted fire obviously needs
// to know about monsters — so both arrive as callbacks supplied by GAME, the
// same way `groundPick` already keeps the camera out of this file.

export class InputFrame {
  constructor() {
    this.moveX = 0; this.moveZ = 0;    // -1..1, already normalised
    this.aimX = 1; this.aimZ = 0;      // unit vector in world XZ
    this.aimDist = 6;                  // cursor distance from the operator, metres
    this.fire = false;                 // held
    this.firePressed = false;          // edge
    this.secondary = false;
    this.secondaryPressed = false;
    this.dashPressed = false;
    this.interactPressed = false;
    this.reloadPressed = false;
    this.lightPressed = false;
    this.pausePressed = false;
  }
  /**
   * Clears the EDGES. It deliberately does not clear `fire` / `secondary`,
   * because those are held states and the keyboard and mouse paths assign them
   * unconditionally every sample.
   *
   * That made them safe by accident rather than by design, and the touch path
   * proved it: it only assigns `fire` when it decides to shoot, so once the
   * assist pulled the trigger the flag latched and the operator kept firing
   * through walls and after the finger had left the glass. `sample()` now zeroes
   * both before dispatching to a scheme, so no scheme can inherit the last one's
   * trigger.
   */
  reset() {
    this.firePressed = false; this.secondaryPressed = false;
    this.dashPressed = false; this.interactPressed = false;
    this.reloadPressed = false; this.lightPressed = false; this.pausePressed = false;
  }
}

export const SCHEME = { KEYBOARD: 'keyboard', MOUSE: 'mouse', TOUCH: 'touch' };

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'dash', KeyE: 'interact', KeyR: 'reload', KeyF: 'light',
  Escape: 'pause', KeyP: 'pause',
};

// A tap is short and still. Anything longer, or that travels, is a hold or a drag.
const TAP_MS = 240;
const TAP_SLOP = 0.05;        // in NDC units, ~2.5% of the screen
const DOUBLE_MS = 320;
const ARRIVE = 0.55;          // metres: close enough to the goal to stop

export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.frame = new InputFrame();
    this.held = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, middleDown: false };
    this.mouseDownEdge = false;
    this.rightDownEdge = false;
    this.middleDownEdge = false;
    this.enabled = true;

    this.scheme = opts.scheme || Input.detectScheme();

    // --- pointer-driven movement state
    this.goal = null;             // { x, z } world destination, or null
    this.goalAge = 0;
    this.holding = false;         // pointer held past the tap threshold
    this.holdPoint = { x: 0, y: 0 };   // NDC of the held pointer
    this.lastTapAt = -1e9;
    this.pointerDownAt = -1e9;
    this.pointerDownNdc = { x: 0, y: 0 };
    this.twoFinger = false;
    this.assistFiring = false;    // touch: a target is lined up, so we are shooting

    // Injected by GAME. INPUT never reaches into the world itself.
    this.steer = null;            // (goal, px, pz, out) => bool
    this.hostileInLine = null;    // (px, pz, aimX, aimZ) => bool

    this.bind();
  }

  /**
   * Coarse pointer means a finger. This is the one detection that matters: a
   * laptop with a touchscreen still has a mouse, and should get the mouse
   * scheme unless the player says otherwise.
   */
  static detectScheme() {
    if (typeof window === 'undefined') return SCHEME.KEYBOARD;
    const q = new URLSearchParams(window.location.search).get('controls');
    if (q && Object.values(SCHEME).includes(q)) return q;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
    return (coarse && noHover) ? SCHEME.TOUCH : SCHEME.KEYBOARD;
  }

  setScheme(s) {
    this.scheme = s;
    this.goal = null;
    this.holding = false;
    this.assistFiring = false;
  }

  get usesPointerMovement() {
    return this.scheme === SCHEME.MOUSE || this.scheme === SCHEME.TOUCH;
  }

  bind() {
    const onKey = (e, down) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      if (e.code === 'Space') e.preventDefault();
      if (down) {
        if (!this.held.has(action)) this.pressedThisFrame.add(action);
        this.held.add(action);
      } else {
        this.held.delete(action);
      }
    };
    this._onKeyDown = (e) => onKey(e, true);
    this._onKeyUp = (e) => onKey(e, false);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    const ndc = (clientX, clientY) => {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: ((clientX - r.left) / r.width) * 2 - 1,
        y: -(((clientY - r.top) / r.height) * 2 - 1),
      };
    };
    this._ndc = ndc;

    this._onMove = (e) => {
      const p = ndc(e.clientX, e.clientY);
      this.mouse.x = p.x; this.mouse.y = p.y;
      if (this.holding) { this.holdPoint.x = p.x; this.holdPoint.y = p.y; }
    };
    this._onDown = (e) => {
      const p = ndc(e.clientX, e.clientY);
      this.mouse.x = p.x; this.mouse.y = p.y;
      if (e.button === 0) {
        if (!this.mouse.down) this.mouseDownEdge = true;
        this.mouse.down = true;
        this.beginPointer(p);
      }
      if (e.button === 1) { if (!this.mouse.middleDown) this.middleDownEdge = true; this.mouse.middleDown = true; }
      if (e.button === 2) { if (!this.mouse.rightDown) this.rightDownEdge = true; this.mouse.rightDown = true; }
      e.preventDefault();
    };
    this._onUp = (e) => {
      if (e.button === 0) { this.mouse.down = false; this.endPointer(); }
      if (e.button === 1) this.mouse.middleDown = false;
      if (e.button === 2) this.mouse.rightDown = false;
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => {
      this.held.clear();
      this.mouse.down = false; this.mouse.rightDown = false; this.mouse.middleDown = false;
      this.holding = false; this.assistFiring = false;
    };

    // --- touch. Separate handlers rather than Pointer Events, because we want
    // multi-touch (two fingers = frag) and because preventDefault on touchstart
    // is what stops the browser from scrolling and double-tap-zooming the page.
    this._onTouchStart = (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (!t) return;
      this.twoFinger = e.touches.length >= 2;
      const p = ndc(t.clientX, t.clientY);
      this.mouse.x = p.x; this.mouse.y = p.y;
      if (this.twoFinger) { this.secondaryTapPending = true; return; }
      this.beginPointer(p);
    };
    this._onTouchMove = (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (!t) return;
      const p = ndc(t.clientX, t.clientY);
      this.mouse.x = p.x; this.mouse.y = p.y;
      if (this.holding) { this.holdPoint.x = p.x; this.holdPoint.y = p.y; }
    };
    this._onTouchEnd = (e) => {
      e.preventDefault();
      if (e.touches.length === 0) { this.endPointer(); this.twoFinger = false; }
    };

    this.canvas.addEventListener('mousemove', this._onMove);
    this.canvas.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    this.canvas.addEventListener('contextmenu', this._onContext);
    window.addEventListener('blur', this._onBlur);
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  // ------------------------------------------------------------------ gestures
  beginPointer(p) {
    this.pointerDownAt = now();
    this.pointerDownNdc.x = p.x; this.pointerDownNdc.y = p.y;
    this.holdPoint.x = p.x; this.holdPoint.y = p.y;
    this.holding = false;
    this.pointerActive = true;
  }

  endPointer() {
    if (!this.pointerActive) return;
    this.pointerActive = false;
    const t = now();
    const dt = t - this.pointerDownAt;
    const travel = Math.hypot(this.mouse.x - this.pointerDownNdc.x,
      this.mouse.y - this.pointerDownNdc.y);
    if (!this.holding && dt <= TAP_MS && travel <= TAP_SLOP) {
      // A tap. A second tap in quick succession is a dash rather than a move,
      // which gives both schemes an evasive action without a second control.
      if (t - this.lastTapAt <= DOUBLE_MS) { this.dashTapPending = true; this.lastTapAt = -1e9; }
      else { this.moveTapPending = true; this.lastTapAt = t; }
    }
    this.holding = false;
    this.assistFiring = false;
    this.wasAssistFiring = false;
  }

  /**
   * Build this step's InputFrame.
   *
   * `groundPick` maps NDC to a world point on the operator's plane; RENDERER
   * supplies it so INPUT never imports a camera. `steer` turns a world
   * destination into a movement direction that respects walls, and
   * `hostileInLine` answers whether anything worth shooting is on a bearing —
   * GAME supplies both so INPUT never imports the level or the enemies.
   */
  sample(px, pz, groundPick, steer = null, hostileInLine = null) {
    const f = this.frame;
    f.reset();
    // Held states are the scheme's to assert, every frame, from scratch.
    f.fire = false; f.secondary = false;
    if (steer) this.steer = steer;
    if (hostileInLine) this.hostileInLine = hostileInLine;
    if (!this.enabled) { f.moveX = 0; f.moveZ = 0; return f; }

    // Promote a long press to a hold, here rather than on a timer, so the
    // transition is sampled on the same clock as everything else.
    if (this.pointerActive && !this.holding) {
      const travel = Math.hypot(this.mouse.x - this.pointerDownNdc.x,
        this.mouse.y - this.pointerDownNdc.y);
      if (now() - this.pointerDownAt > TAP_MS || travel > TAP_SLOP) {
        this.holding = true;
        this.holdPoint.x = this.mouse.x; this.holdPoint.y = this.mouse.y;
      }
    }

    const cursor = groundPick(this.mouse.x, this.mouse.y);
    const cursorX = cursor.x, cursorZ = cursor.z;

    if (this.scheme === SCHEME.KEYBOARD) this.sampleKeyboard(f, px, pz, cursorX, cursorZ);
    else if (this.scheme === SCHEME.MOUSE) this.sampleMouse(f, px, pz, cursorX, cursorZ);
    else this.sampleTouch(f, px, pz, cursorX, cursorZ, groundPick);

    // Keyboard verbs stay live in every scheme. They are conveniences, not the
    // scheme — a mouse-only player never has to press one.
    f.dashPressed = f.dashPressed || this.pressedThisFrame.has('dash');
    f.interactPressed = this.pressedThisFrame.has('interact');
    f.reloadPressed = f.reloadPressed || this.pressedThisFrame.has('reload');
    f.lightPressed = this.pressedThisFrame.has('light');
    f.pausePressed = this.pressedThisFrame.has('pause');

    this.mouseDownEdge = false;
    this.rightDownEdge = false;
    this.middleDownEdge = false;
    this.moveTapPending = false;
    this.dashTapPending = false;
    this.secondaryTapPending = false;
    this.pressedThisFrame.clear();
    return f;
  }

  // ----------------------------------------------------------------- keyboard
  sampleKeyboard(f, px, pz, cx, cz) {
    let mx = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    let mz = (this.held.has('down') ? 1 : 0) - (this.held.has('up') ? 1 : 0);
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    f.moveX = mx; f.moveZ = mz;
    this.aimAt(f, px, pz, cx, cz);
    f.fire = this.mouse.down;
    f.firePressed = this.mouseDownEdge;
    f.secondary = this.mouse.rightDown;
    f.secondaryPressed = this.rightDownEdge;
  }

  // -------------------------------------------------------------------- mouse
  /**
   * Left button moves, the cursor turns you, right button shoots.
   *
   * Holding left keeps re-targeting rather than latching one destination, so
   * steering round a corner is a drag rather than a series of clicks. Middle
   * button throws the frag and double-click dashes, which keeps the whole loop
   * on the mouse — the keyboard verbs remain available but are never required.
   */
  sampleMouse(f, px, pz, cx, cz) {
    if (this.moveTapPending || (this.pointerActive && this.holding)) {
      this.goal = { x: cx, z: cz };
    }
    if (this.dashTapPending) f.dashPressed = true;
    this.applyGoal(f, px, pz);
    this.aimAt(f, px, pz, cx, cz);

    f.fire = this.mouse.rightDown;
    f.firePressed = this.rightDownEdge;
    f.secondary = this.mouse.middleDown;
    f.secondaryPressed = this.middleDownEdge;
  }

  // -------------------------------------------------------------------- touch
  /**
   * Tap to move. Press and hold to turn and shoot.
   *
   * The hold does not fire blindly: it points the operator at the held bearing
   * and pulls the trigger only when something is actually in front of them and
   * in line of sight. A finger cannot aim with a mouse's precision, and the
   * alternative to this assist is not "harder", it is "the player empties the
   * barrel into a wall and overheats" — which teaches nothing and reads as the
   * game being broken.
   *
   * Two fingers throws the frag. Double tap dashes.
   */
  sampleTouch(f, px, pz, cx, cz, groundPick) {
    if (this.moveTapPending) this.goal = { x: cx, z: cz };
    if (this.dashTapPending) f.dashPressed = true;
    if (this.secondaryTapPending) { f.secondary = true; f.secondaryPressed = true; }

    if (this.holding) {
      // Holding overrides movement: you plant and engage.
      this.goal = null;
      f.moveX = 0; f.moveZ = 0;
      const hp = groundPick(this.holdPoint.x, this.holdPoint.y);
      this.aimAt(f, px, pz, hp.x, hp.z);
      const lined = this.hostileInLine
        ? this.hostileInLine(px, pz, f.aimX, f.aimZ)
        : true;
      this.assistFiring = lined;
      if (lined) { f.fire = true; f.firePressed = !this.wasAssistFiring; }
    } else {
      this.applyGoal(f, px, pz);
      this.assistFiring = false;
      // Not holding: face the way you are walking, so the operator is never
      // moonwalking and the flashlight leads.
      if (f.moveX || f.moveZ) {
        f.aimX = f.moveX; f.aimZ = f.moveZ; f.aimDist = 6;
      }
    }
    this.wasAssistFiring = this.assistFiring;
  }

  // ------------------------------------------------------------------ helpers
  aimAt(f, px, pz, tx, tz) {
    const ax = tx - px, az = tz - pz;
    const d = Math.hypot(ax, az);
    if (d > 0.001) { f.aimX = ax / d; f.aimZ = az / d; f.aimDist = d; }
  }

  /** Walk toward the current destination, if there is one and we are not there. */
  applyGoal(f, px, pz) {
    if (!this.goal) { f.moveX = 0; f.moveZ = 0; return; }
    const dx = this.goal.x - px, dz = this.goal.z - pz;
    if (Math.hypot(dx, dz) <= ARRIVE) { this.goal = null; f.moveX = 0; f.moveZ = 0; return; }
    const out = this._steerOut || (this._steerOut = { x: 0, z: 0 });
    if (this.steer && this.steer(this.goal, px, pz, out)) {
      f.moveX = out.x; f.moveZ = out.z;
      return;
    }
    // No route: give up rather than grind into a wall forever. A destination
    // that cannot be reached is a misclick, and the operator standing still is
    // a clearer answer than the operator vibrating against geometry.
    this.goal = null;
    f.moveX = 0; f.moveZ = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    window.removeEventListener('blur', this._onBlur);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.canvas.removeEventListener('touchmove', this._onTouchMove);
    this.canvas.removeEventListener('touchend', this._onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this._onTouchEnd);
  }
}

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}
