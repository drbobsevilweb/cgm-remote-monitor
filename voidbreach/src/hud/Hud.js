// HUD — 2D canvas overlay. Reads gameplay, never mutates it.
//
// Everything here answers one of: how hurt am I, how much ammo, what am I
// supposed to do, and where did that come from.

import { PAL } from '../environment/Palette.js';
import { clamp01 } from '../core/Mathx.js';

const F = (px, w = 400) => `${w} ${px}px "Inter", "Helvetica Neue", Arial, sans-serif`;

export class Hud {
  constructor(canvas, events) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.events = events;
    this.messages = [];
    this.objective = '';
    this.damageMarks = [];
    this.hitMarker = 0;
    this.killFeed = [];
    this.pickupFlash = 0;
    this.dpr = 1;

    events.on('objective', (e) => {
      this.objective = e.text;
      this.push(e.text, 'objective', 4.5);
    });
    events.on('message', (e) => this.push(e.text, e.tone || 'log', e.ttl || 4));
    events.on('playerHit', (e) => {
      this.damageMarks.push({ dirX: e.dirX, dirZ: e.dirZ, life: 1.2 });
      if (this.damageMarks.length > 8) this.damageMarks.shift();
    });
    events.on('enemyDied', () => { this.hitMarker = Math.min(1, this.hitMarker + 0.35); });
    events.on('pickup', (e) => { this.pickupFlash = 1; this.push(PICKUP_TEXT[e.kind] || 'RECOVERED', 'pickup', 1.8); });
    events.on('queenKilled', (e) => {
      this.push(e.remaining > 0 ? `BROOD QUEEN DOWN — ${e.remaining} REMAINING` : 'SECTOR PURGED', 'good', 4);
    });
    events.on('doorState', (e) => {
      if (e.state === 'unlocked') this.push(`${e.label || 'BULKHEAD'} — RELEASED`, 'good', 3.5);
    });
  }

  push(text, tone, ttl) {
    this.messages.push({ text, tone, life: ttl, max: ttl });
    if (this.messages.length > 5) this.messages.shift();
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = w; this.h = h;
  }

  update(dt) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      this.messages[i].life -= dt;
      if (this.messages[i].life <= 0) this.messages.splice(i, 1);
    }
    for (let i = this.damageMarks.length - 1; i >= 0; i--) {
      this.damageMarks[i].life -= dt;
      if (this.damageMarks[i].life <= 0) this.damageMarks.splice(i, 1);
    }
    this.hitMarker = Math.max(0, this.hitMarker - dt * 2.4);
    this.pickupFlash = Math.max(0, this.pickupFlash - dt * 1.8);
  }

  draw(state) {
    const c = this.ctx;
    const w = this.w, h = this.h;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (state.mode === 'loading') return this.drawLoading(state);

    const pad = 28;

    // ---------------------------------------------------- vitals (bottom left)
    const barW = 246, barH = 11;
    const bx = pad, by = h - pad - 46;
    c.font = F(11, 600);
    c.fillStyle = 'rgba(210,222,235,0.55)';
    c.fillText('INTEGRITY', bx, by - 9);

    this.bar(bx, by, barW, barH, state.health01, '#ff3a2e', '#5a1a16');
    if (state.armour01 > 0) {
      this.bar(bx, by + barH + 4, barW * 0.72, 5, state.armour01, '#5fd8ff', '#123240');
    }
    c.font = F(20, 700);
    c.fillStyle = state.health01 < 0.3 ? '#ff6a5a' : '#dfe8f2';
    c.fillText(String(Math.ceil(state.health)), bx + barW + 14, by + barH);

    // ------------------------------------------------------ heat (bottom right)
    // There is no round count because there are no rounds. The question this
    // has to answer, sixty times a fight, is "can I keep holding this trigger",
    // so the bar is the readout and the numbers are secondary.
    const ax = w - pad;
    const hw = 190, hh = 12;
    const hx = ax - hw, hy = h - pad - 30;
    c.textAlign = 'right';

    const heat = clamp01(state.heat01 || 0);
    c.fillStyle = 'rgba(20,26,34,0.75)';
    c.fillRect(hx, hy, hw, hh);

    if (state.venting) {
      // Venting reads as a different colour and fills the OTHER way, so a vent
      // can never be mistaken for the barrel heating back up.
      c.fillStyle = 'rgba(95,216,255,0.20)';
      c.fillRect(hx, hy, hw, hh);
      c.fillStyle = state.overheated ? '#ff8a3d' : '#5fd8ff';
      c.fillRect(hx, hy, hw * clamp01(state.ventProgress || 0), hh);
    } else {
      const grad = c.createLinearGradient(hx, 0, hx + hw, 0);
      grad.addColorStop(0, '#5fd8ff');
      grad.addColorStop(0.55, '#ffb45a');
      grad.addColorStop(1, '#ff3a2e');
      c.fillStyle = grad;
      c.fillRect(hx, hy, hw * heat, hh);
      if (state.hot) {
        // the last stretch pulses: this is the "let go now" signal
        c.save();
        c.globalAlpha = 0.35 + 0.35 * Math.sin(state.time * 14);
        c.fillStyle = '#ff3a2e';
        c.fillRect(hx + hw * 0.78, hy - 2, hw * 0.22, hh + 4);
        c.restore();
      }
    }
    // the redline tick, so "how much is left" is a position not a guess
    c.fillStyle = 'rgba(255,58,46,0.85)';
    c.fillRect(hx + hw * 0.78, hy - 3, 2, hh + 6);
    c.strokeStyle = 'rgba(200,214,230,0.30)';
    c.lineWidth = 1;
    c.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);

    c.font = F(11, 600);
    c.fillStyle = state.venting
      ? (state.overheated ? '#ff8a3d' : '#5fd8ff')
      : (state.hot ? '#ff6a5a' : 'rgba(200,214,230,0.55)');
    c.fillText(state.venting
      ? (state.overheated ? 'OVERHEAT — VENTING' : 'VENTING')
      : `${Math.round(heat * 100)}% ${state.coolBoost ? '· COOLANT' : '· R TO VENT'}`,
      ax, hy - 8);

    c.font = F(state.charges !== null ? 20 : 13, 700);
    c.fillStyle = state.charges !== null ? '#5fd8ff' : 'rgba(200,214,230,0.5)';
    c.fillText(state.charges !== null
      ? `${state.weaponName}  ×${state.charges}`
      : state.weaponName, ax, h - pad - 2);

    // grenades + dash, as discrete pips: countable at a glance
    c.textAlign = 'right';
    const pipY = h - pad - 96;
    for (let i = 0; i < 5; i++) {
      c.fillStyle = i < state.grenades ? '#ffb45a' : 'rgba(255,180,90,0.16)';
      c.fillRect(ax - 12 - i * 15, pipY, 10, 10);
    }
    c.fillStyle = state.dashReady ? '#5fd8ff' : 'rgba(95,216,255,0.18)';
    c.fillRect(ax - 12 - 5 * 15 - 22, pipY, 14, 10);

    c.textAlign = 'left';

    // ------------------------------------------------------------- objective
    if (this.objective) {
      c.font = F(12, 700);
      c.fillStyle = 'rgba(255,180,90,0.85)';
      c.fillText('OBJECTIVE', pad, pad + 6);
      c.font = F(17, 600);
      c.fillStyle = '#eef4fb';
      c.fillText(this.objective, pad, pad + 28);
    }

    // queens remaining — the loop's scoreboard
    if (state.queensTotal > 0) {
      const nx = pad, ny = pad + 46;
      for (let i = 0; i < state.queensTotal; i++) {
        const dead = i >= state.queensRemaining;
        c.fillStyle = dead ? 'rgba(194,59,216,0.22)' : '#c23bd8';
        c.beginPath();
        c.arc(nx + 7 + i * 19, ny, 5.5, 0, Math.PI * 2);
        dead ? c.stroke() : c.fill();
        if (dead) { c.strokeStyle = 'rgba(194,59,216,0.35)'; c.stroke(); }
      }
      if (state.eggsAlive > 0) {
        c.font = F(11, 600);
        c.textAlign = 'left';
        c.fillStyle = 'rgba(194,59,216,0.8)';
        c.fillText(`${state.eggsAlive} EGG${state.eggsAlive === 1 ? '' : 'S'} INCUBATING`,
          nx + state.queensTotal * 19 + 10, ny + 4);
      }
    }

    // ------------------------------------------------ queen compass (the tell)
    if (state.queenDir) {
      const cx = w / 2, cy = h / 2;
      const a = Math.atan2(state.queenDir.z, state.queenDir.x);
      const r = Math.min(w, h) * 0.30;
      c.save();
      c.globalAlpha = 0.30 + 0.20 * Math.sin(state.time * 2.4);
      c.strokeStyle = '#c23bd8';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, r, a - 0.10, a + 0.10);
      c.stroke();
      c.restore();
    }

    // ------------------------------------------------------- damage direction
    for (const m of this.damageMarks) {
      const a = Math.atan2(m.dirZ, m.dirX);
      const r = Math.min(w, h) * 0.22;
      c.save();
      c.globalAlpha = clamp01(m.life / 1.2) * 0.8;
      c.strokeStyle = '#ff3a2e';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(w / 2, h / 2, r, a - 0.22, a + 0.22);
      c.stroke();
      c.restore();
    }

    // ------------------------------------------------------------- messages
    let my = h * 0.30;
    c.textAlign = 'center';
    for (const m of this.messages) {
      const a = Math.min(1, m.life / 0.6) * Math.min(1, (m.max - m.life) / 0.18);
      c.globalAlpha = a;
      c.font = F(m.tone === 'objective' ? 19 : 15, m.tone === 'objective' ? 700 : 500);
      c.fillStyle = TONE_COLOUR[m.tone] || '#cfe0ef';
      c.fillText(m.text, w / 2, my);
      my += 26;
      c.globalAlpha = 1;
    }
    c.textAlign = 'left';

    // ------------------------------------------------------------ crosshair
    this.crosshair(state);

    if (state.mode === 'dead') this.drawEnd(state, 'OPERATOR DOWN', '#ff3a2e');
    if (state.mode === 'won') this.drawEnd(state, 'SECTOR RECLAIMED', '#5fd8ff');
  }

  crosshair(state) {
    const c = this.ctx;
    const x = state.cursorX, y = state.cursorY;
    if (x === undefined) return;
    const spread = 7 + state.spread * 320;
    c.save();
    c.strokeStyle = this.hitMarker > 0 ? '#ffffff' : 'rgba(230,240,250,0.72)';
    c.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const dx = Math.cos(a), dy = Math.sin(a);
      c.beginPath();
      c.moveTo(x + dx * spread, y + dy * spread);
      c.lineTo(x + dx * (spread + 7), y + dy * (spread + 7));
      c.stroke();
    }
    if (this.hitMarker > 0) {
      c.globalAlpha = this.hitMarker;
      c.strokeStyle = '#ffffff';
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  bar(x, y, w, h, v, fg, bg) {
    const c = this.ctx;
    c.fillStyle = bg; c.fillRect(x, y, w, h);
    c.fillStyle = fg; c.fillRect(x, y, w * clamp01(v), h);
    c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  drawLoading(state) {
    const c = this.ctx, w = this.w, h = this.h;
    c.fillStyle = '#05070a'; c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.font = F(46, 800);
    c.fillStyle = '#eef4fb';
    c.fillText('VOIDBREACH', w / 2, h / 2 - 24);
    c.font = F(13, 500);
    c.fillStyle = 'rgba(255,180,90,0.8)';
    c.fillText('HELIX DEEP  //  DECK 7  //  ARRIVAL AND PROCESSING', w / 2, h / 2 + 4);
    c.fillStyle = 'rgba(200,214,230,0.5)';
    c.font = F(12, 500);
    c.fillText(state.loadingText || 'BUILDING SECTOR', w / 2, h / 2 + 40);
    const bw = 300;
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fillRect(w / 2 - bw / 2, h / 2 + 58, bw, 3);
    c.fillStyle = '#ffb45a';
    c.fillRect(w / 2 - bw / 2, h / 2 + 58, bw * clamp01(state.loadProgress || 0), 3);
    c.textAlign = 'left';
  }

  drawEnd(state, title, colour) {
    const c = this.ctx, w = this.w, h = this.h;
    c.fillStyle = 'rgba(4,6,9,0.72)';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.font = F(44, 800);
    c.fillStyle = colour;
    c.fillText(title, w / 2, h / 2 - 10);
    c.font = F(14, 500);
    c.fillStyle = 'rgba(220,232,244,0.75)';
    c.fillText(`CHORUS DESTROYED ${state.kills}   ·   QUEENS ${state.queensTotal - state.queensRemaining}/${state.queensTotal}   ·   ${fmtTime(state.time)}`,
      w / 2, h / 2 + 24);
    c.fillStyle = 'rgba(220,232,244,0.5)';
    c.fillText('PRESS R TO REDEPLOY', w / 2, h / 2 + 54);
    c.textAlign = 'left';
  }
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TONE_COLOUR = {
  objective: '#ffb45a', good: '#5fd8ff', warn: '#ff8a3d',
  log: 'rgba(200,214,230,0.8)', pickup: '#b8ff4a', bad: '#ff3a2e',
};

const PICKUP_TEXT = {
  arc: 'ARC LANCE CELL', coolant: 'COOLANT CANISTER',
  medkit: 'MEDICAL KIT', armour: 'ARMOUR PLATE', flare: 'FLARE',
};
