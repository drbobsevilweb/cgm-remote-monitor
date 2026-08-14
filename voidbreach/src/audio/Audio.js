// AUDIO — everything is synthesised at runtime. No asset downloads.
//
// DIRECTION §10: room tone always, music sparse and reactive, the Chorus heard
// before it is seen, weapons with a mechanical tail. Spatialisation is a hand
// written equal-power pan plus distance and occlusion attenuation in camera
// space — cheaper and far more controllable than PannerNode for this many
// one-shots.

const MAX_VOICES = 24;

export class Audio {
  constructor(events, rng) {
    this.events = events;
    this.rng = rng.child('audio');
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.voices = 0;
    this.listener = { x: 0, z: 0, aimX: 1, aimZ: 0 };
    this.musicLevel = 0;
    this.musicTarget = 0;
    this.lastShot = 0;
  }

  /** Must be called from a user gesture. Silent failure is fine (QA runs muted). */
  start() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }

    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.7;

    // A gentle limiter so a swarm of impacts cannot clip the bus.
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.wet = c.createGain(); this.wet.gain.value = 0.30;
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4, 3.2);

    this.master.connect(this.limiter);
    this.limiter.connect(c.destination);
    this.wet.connect(this.reverb);
    this.reverb.connect(this.limiter);

    this.noise = this.makeNoise(2.0);
    this.buildAmbience();
    this.buildMusic();
    this.ready = true;
    return true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  makeNoise(seconds) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rng.signed();
    return buf;
  }

  /** Big, cold, industrial room. Long tail, dark. */
  makeImpulse(seconds, decay) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // a couple of discrete early reflections make it read as "corridor"
        let s = this.rng.signed() * Math.pow(1 - t, decay);
        if (i === (c.sampleRate * 0.021) | 0) s += 0.6;
        if (i === (c.sampleRate * 0.037) | 0) s += 0.4;
        d[i] = s * 0.5;
      }
    }
    return buf;
  }

  // ------------------------------------------------------------- ambience
  buildAmbience() {
    const c = this.ctx;
    this.ambience = c.createGain();
    this.ambience.gain.value = 0.0;
    this.ambience.connect(this.master);

    // ventilation: filtered noise with a slow breathing LFO
    const vent = c.createBufferSource();
    vent.buffer = this.noise; vent.loop = true;
    const vf = c.createBiquadFilter();
    vf.type = 'bandpass'; vf.frequency.value = 380; vf.Q.value = 0.55;
    const vg = c.createGain(); vg.gain.value = 0.10;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 0.035;
    lfo.connect(lfoG); lfoG.connect(vg.gain);
    vent.connect(vf); vf.connect(vg); vg.connect(this.ambience);
    vent.start(); lfo.start();

    // electrical hum: mains-ish fundamental plus a harmonic
    for (const [f, g] of [[52, 0.020], [104, 0.010], [156, 0.004]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      const og = c.createGain(); og.gain.value = g;
      o.connect(lp); lp.connect(og); og.connect(this.ambience);
      o.start();
    }

    // distant machinery: a low pulse every few seconds
    this.machineTimer = 0;
    this.groanTimer = 4;
    this.dripTimer = 2;
  }

  buildMusic() {
    const c = this.ctx;
    this.music = c.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.music.connect(this.wet);
    // Two detuned low drones. Sparse by design: it appears with pressure and
    // is gone within 400 ms of the last nest dying (gate A3).
    for (const [f, type, g] of [[41.2, 'sawtooth', 0.10], [61.7, 'triangle', 0.07], [82.4, 'sine', 0.05]]) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = f;
      o.detune.value = this.rng.range(-9, 9);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 1.2;
      const og = c.createGain(); og.gain.value = g;
      o.connect(lp); lp.connect(og); og.connect(this.music);
      o.start();
    }
  }

  // -------------------------------------------------------------- helpers
  /** Equal-power pan + distance attenuation, in listener space. */
  place(x, z, refDist = 9, maxDist = 55) {
    const dx = x - this.listener.x, dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    if (d > maxDist) return null;
    const gain = refDist / (refDist + d * d * 0.055);
    // right vector is perpendicular to the aim; the camera is fixed, so use world X
    const pan = Math.max(-1, Math.min(1, dx / 22));
    return { gain, pan, dist: d };
  }

  voice(gain, pan, wetAmount = 0.25) {
    if (!this.ready || this.voices >= MAX_VOICES) return null;
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = gain;
    const p = c.createStereoPanner(); p.pan.value = pan;
    g.connect(p);
    p.connect(this.master);
    const w = c.createGain(); w.gain.value = wetAmount;
    p.connect(w); w.connect(this.wet);
    this.voices++;
    return g;
  }

  release(node, when) {
    const c = this.ctx;
    const t = when - c.currentTime;
    setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
      try { node.disconnect(); } catch (e) { /* already gone */ }
    }, Math.max(0, t * 1000) + 60);
  }

  noiseBurst(dest, t0, dur, freq, q, type = 'bandpass', gain = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + this.rng.next() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, this.rng.next() * 1.2, dur + 0.05);
    src.stop(t0 + dur + 0.06);
    return g;
  }

  tone(dest, t0, dur, f0, f1, type, gain) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.04);
    return g;
  }

  // ---------------------------------------------------------------- events
  shot(e) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.place(e.x, e.z, 14);
    if (!p) return;
    const out = this.voice(p.gain * 0.75, p.pan, 0.22);
    if (!out) return;
    // transient -> body -> mechanical tail: three components, not one bang
    this.noiseBurst(out, t, 0.035, 2600, 0.8, 'bandpass', 1.0);
    this.tone(out, t, 0.085, 220, 62, 'square', 0.42);
    this.noiseBurst(out, t + 0.012, 0.11, 700, 1.6, 'lowpass', 0.30);
    // bolt cycling
    this.noiseBurst(out, t + 0.045, 0.05, 4200, 3.0, 'bandpass', e.lowAmmo ? 0.30 : 0.18);
    this.release(out, t + 0.25);
  }

  /**
   * The thermal cycle. Three distinct mechanical events, not one "vent" blob,
   * and a forced vent is audibly a bigger, longer, wetter release than one the
   * operator chose — the sound is the feedback for having got it wrong.
   */
  vent(stage, forced) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.voice(forced ? 0.6 : 0.42, 0, forced ? 0.35 : 0.2);
    if (!out) return;
    if (stage === 'release') {
      // the crack of the breech, then the gas
      this.noiseBurst(out, t, 0.06, 1800, 2.2, 'bandpass', 0.8);
      this.tone(out, t, 0.05, 400, 180, 'square', 0.2);
      this.noiseBurst(out, t + 0.04, forced ? 0.85 : 0.42, forced ? 5200 : 3600,
        forced ? 0.30 : 0.5, 'highpass', forced ? 0.85 : 0.5);
      if (forced) this.tone(out, t + 0.02, 0.5, 220, 70, 'sawtooth', 0.16);
    }
    if (stage === 'purge') {
      this.noiseBurst(out, t, forced ? 0.6 : 0.28, 2400, 0.6, 'bandpass', forced ? 0.7 : 0.45);
      this.tone(out, t, 0.07, 150, 90, 'square', 0.30);
    }
    if (stage === 'seat') {
      this.noiseBurst(out, t, 0.05, 900, 1.4, 'bandpass', 0.9);
      this.tone(out, t, 0.06, 260, 140, 'square', 0.28);
    }
    if (stage === 'ready') {
      // the charge: the one cue that says the trigger is live again
      this.noiseBurst(out, t, 0.09, 3200, 1.8, 'bandpass', 0.85);
      this.tone(out, t + 0.03, 0.08, 700, 980, 'square', 0.26);
    }
    this.release(out, t + (forced ? 1.2 : 0.6));
  }

  impact(e) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.place(e.x, e.z, 8, 42);
    if (!p) return;
    const out = this.voice(p.gain * 0.5, p.pan, 0.3);
    if (!out) return;
    switch (e.surface) {
      case 'flesh': this.noiseBurst(out, t, 0.10, 420, 1.1, 'lowpass', 0.9); break;
      case 'grate': this.noiseBurst(out, t, 0.13, 5200, 6.0, 'bandpass', 0.7); break;
      case 'ceramic': this.noiseBurst(out, t, 0.06, 2400, 2.4, 'bandpass', 0.8); break;
      default:
        this.noiseBurst(out, t, 0.05, 3400, 2.0, 'bandpass', 0.8);
        if (this.rng.bool(0.3)) this.tone(out, t + 0.01, 0.22, 3200, 900, 'sine', 0.10); // ricochet
    }
    this.release(out, t + 0.35);
  }

  explosion(e) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.place(e.x, e.z, 26, 90);
    if (!p) return;
    const out = this.voice(Math.min(1.0, p.gain * 1.5), p.pan, 0.55);
    if (!out) return;
    this.tone(out, t, 0.55, 110, 26, 'sine', 0.9);
    this.noiseBurst(out, t, 0.28, 900, 0.5, 'lowpass', 0.95);
    this.noiseBurst(out, t + 0.02, 0.9, 260, 0.4, 'lowpass', 0.5);
    this.release(out, t + 1.2);
  }

  nestRupture(e) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.place(e.x, e.z, 30, 120);
    const out = this.voice(Math.min(1.0, (p ? p.gain : 0.6) * 1.6), p ? p.pan : 0, 0.7);
    if (!out) return;
    // wet tear, then a cavity collapse, then a long organic sigh
    this.noiseBurst(out, t, 0.35, 700, 0.7, 'lowpass', 1.0);
    this.tone(out, t, 0.9, 190, 34, 'sawtooth', 0.55);
    this.tone(out, t + 0.1, 1.6, 70, 28, 'sine', 0.35);
    this.noiseBurst(out, t + 0.25, 1.5, 300, 0.5, 'lowpass', 0.35);
    this.release(out, t + 2.2);
  }

  /** Chorus vocalisations: positional warning before the thing is on screen. */
  chorus(kind, x, z, type) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const p = this.place(x, z, 12, 48);
    if (!p) return;
    const out = this.voice(p.gain * 0.55, p.pan, 0.4);
    if (!out) return;
    if (type === 'windup') {
      if (kind === 2) { // spitter charge — the only warning to move
        this.tone(out, t, 0.85, 220, 900, 'sawtooth', 0.28);
        this.noiseBurst(out, t, 0.85, 1400, 1.2, 'bandpass', 0.22);
      } else {
        this.tone(out, t, 0.22, 340, 120, 'square', 0.22);
      }
    } else if (type === 'lunge') {
      this.tone(out, t, 0.3, 520, 90, 'sawtooth', 0.35);
    } else if (type === 'die') {
      this.tone(out, t, 0.42, 260 + this.rng.range(-40, 40), 48, 'sawtooth', 0.4);
      this.noiseBurst(out, t, 0.25, 500, 0.9, 'lowpass', 0.5);
    } else if (type === 'stir') {
      // Heard across a hall, through structure, before anything is visible.
      // Low, wet and unhurried — it is not a threat display, it is the sound of
      // something large deciding to pay attention. It has to survive being
      // played at 30 m, so it lives almost entirely under 200 Hz where the
      // machinery ambience is thin.
      this.tone(out, t, 1.5, 74, 46, 'sawtooth', 0.42);
      this.tone(out, t + 0.18, 1.1, 112, 62, 'triangle', 0.24);
      this.noiseBurst(out, t + 0.30, 0.75, 260, 0.8, 'lowpass', 0.30);
      this.noiseBurst(out, t + 1.05, 0.45, 180, 0.7, 'lowpass', 0.22);
    } else if (type === 'idle') {
      // runners chitter high and fast; stalkers click low and stop before striking
      if (kind === 1) {
        for (let i = 0; i < 4; i++) this.noiseBurst(out, t + i * 0.11, 0.02, 900, 8, 'bandpass', 0.4);
      } else {
        for (let i = 0; i < 5; i++) this.noiseBurst(out, t + i * 0.045, 0.02, 3200 + this.rng.range(-600, 600), 9, 'bandpass', 0.3);
      }
    }
    this.release(out, t + 1.0);
  }

  hurt() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.voice(0.6, 0, 0.2);
    if (!out) return;
    this.noiseBurst(out, t, 0.16, 300, 0.7, 'lowpass', 0.9);
    this.tone(out, t, 0.20, 150, 60, 'square', 0.3);
    this.release(out, t + 0.4);
  }

  ui(kind) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.voice(0.4, 0, 0.15);
    if (!out) return;
    if (kind === 'pickup') { this.tone(out, t, 0.10, 880, 1320, 'square', 0.2); }
    if (kind === 'objective') { this.tone(out, t, 0.16, 520, 780, 'triangle', 0.25); this.tone(out, t + 0.12, 0.2, 780, 900, 'triangle', 0.2); }
    if (kind === 'door') { this.noiseBurst(out, t, 0.5, 260, 0.8, 'lowpass', 0.55); this.tone(out, t, 0.6, 90, 60, 'sine', 0.25); }
    if (kind === 'locked') { this.tone(out, t, 0.12, 180, 120, 'square', 0.3); }
    if (kind === 'dry') { this.noiseBurst(out, t, 0.04, 2600, 5, 'bandpass', 0.5); }
    // The redline warning is a thin rising ping under the gunfire, not a klaxon:
    // it has to be audible while the trigger is down without owning the mix.
    if (kind === 'heat') { this.tone(out, t, 0.10, 1400, 2100, 'triangle', 0.14); }
    if (kind === 'coolant') {
      this.noiseBurst(out, t, 0.36, 5600, 0.5, 'highpass', 0.5);
      this.tone(out, t, 0.22, 1320, 660, 'sine', 0.18);
    }
    this.release(out, t + 0.8);
  }

  update(dt, listenerX, listenerZ, intensity, inCombat) {
    if (!this.ready) return;
    this.listener.x = listenerX; this.listener.z = listenerZ;
    const c = this.ctx;

    this.ambience.gain.setTargetAtTime(0.55, c.currentTime, 0.6);

    // Music appears with pressure and leaves fast. Silence is the reward.
    this.musicTarget = inCombat ? Math.min(0.55, 0.16 + intensity * 0.5) : 0;
    const tau = this.musicTarget > this.musicLevel ? 1.2 : 0.12;   // ~400 ms fall
    this.music.gain.setTargetAtTime(this.musicTarget, c.currentTime, tau);
    this.musicLevel += (this.musicTarget - this.musicLevel) * Math.min(1, dt / tau);

    // Occasional structural events: the station is alive at idle.
    this.machineTimer -= dt;
    if (this.machineTimer <= 0) {
      this.machineTimer = this.rng.range(6, 14);
      const out = this.voice(0.30, this.rng.range(-0.8, 0.8), 0.6);
      if (out) {
        const t = c.currentTime;
        this.tone(out, t, this.rng.range(0.6, 1.4), this.rng.range(40, 70), 30, 'sine', 0.4);
        this.release(out, t + 1.8);
      }
    }
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = this.rng.range(11, 26);
      const out = this.voice(0.26, this.rng.range(-0.9, 0.9), 0.8);
      if (out) {
        const t = c.currentTime;
        this.tone(out, t, 2.4, this.rng.range(58, 96), this.rng.range(30, 48), 'sawtooth', 0.16);
        this.noiseBurst(out, t + 0.2, 1.6, 180, 0.6, 'lowpass', 0.12);
        this.release(out, t + 3.0);
      }
    }
    this.dripTimer -= dt;
    if (this.dripTimer <= 0) {
      this.dripTimer = this.rng.range(2.5, 7);
      const out = this.voice(0.22, this.rng.range(-1, 1), 0.7);
      if (out) {
        const t = c.currentTime;
        this.tone(out, t, 0.09, this.rng.range(900, 1600), 300, 'sine', 0.3);
        this.release(out, t + 0.4);
      }
    }
  }
}
