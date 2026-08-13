// INPUT — produces an InputFrame (an intent struct). Nothing downstream knows
// whether the intent came from a keyboard, a replay script or a test.
//
// The self-play harness (QA) implements the same interface, which is what makes
// "the scripted player uses the normal input path" true rather than aspirational.

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
  reset() {
    this.firePressed = false; this.secondaryPressed = false;
    this.dashPressed = false; this.interactPressed = false;
    this.reloadPressed = false; this.lightPressed = false; this.pausePressed = false;
  }
}

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'dash', KeyE: 'interact', KeyR: 'reload', KeyF: 'light',
  Escape: 'pause', KeyP: 'pause',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.frame = new InputFrame();
    this.held = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { x: 0, y: 0, down: false, rightDown: false };
    this.mouseDownEdge = false;
    this.rightDownEdge = false;
    this.enabled = true;
    this.bind();
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

    this._onMove = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    this._onDown = (e) => {
      if (e.button === 0) { if (!this.mouse.down) this.mouseDownEdge = true; this.mouse.down = true; }
      if (e.button === 2) { if (!this.mouse.rightDown) this.rightDownEdge = true; this.mouse.rightDown = true; }
      e.preventDefault();
    };
    this._onUp = (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => { this.held.clear(); this.mouse.down = false; this.mouse.rightDown = false; };

    this.canvas.addEventListener('mousemove', this._onMove);
    this.canvas.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    this.canvas.addEventListener('contextmenu', this._onContext);
    window.addEventListener('blur', this._onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    window.removeEventListener('blur', this._onBlur);
  }

  /**
   * Build this step's InputFrame. `groundPick` maps NDC to a world point on the
   * operator's plane; RENDERER supplies it so INPUT never imports a camera.
   */
  sample(px, pz, groundPick) {
    const f = this.frame;
    f.reset();
    if (!this.enabled) { f.moveX = 0; f.moveZ = 0; return f; }

    let mx = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    let mz = (this.held.has('down') ? 1 : 0) - (this.held.has('up') ? 1 : 0);
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    f.moveX = mx; f.moveZ = mz;

    const p = groundPick(this.mouse.x, this.mouse.y);
    let ax = p.x - px, az = p.z - pz;
    const d = Math.hypot(ax, az);
    if (d > 0.001) { f.aimX = ax / d; f.aimZ = az / d; f.aimDist = d; }

    f.fire = this.mouse.down;
    f.firePressed = this.mouseDownEdge;
    f.secondary = this.mouse.rightDown;
    f.secondaryPressed = this.rightDownEdge;
    f.dashPressed = this.pressedThisFrame.has('dash');
    f.interactPressed = this.pressedThisFrame.has('interact');
    f.reloadPressed = this.pressedThisFrame.has('reload');
    f.lightPressed = this.pressedThisFrame.has('light');
    f.pausePressed = this.pressedThisFrame.has('pause');

    this.mouseDownEdge = false;
    this.rightDownEdge = false;
    this.pressedThisFrame.clear();
    return f;
  }
}
