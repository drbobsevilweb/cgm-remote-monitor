// RENDERER — owns the three.js renderer, the scene root, the post chain and the
// camera rig. Contains no gameplay logic (ARCHITECTURE §2).

import * as THREE from '../../vendor/three.module.js';
import { Post } from './Post.js';
import { CameraRig } from './CameraRig.js';

export class Renderer {
  /**
   * `capture` enables preserveDrawingBuffer so QA can read the framebuffer back
   * in-page. It costs performance, so it is never on during normal play.
   */
  constructor(canvas, quality, rng, capture = false) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // FXAA runs in post, after tonemapping
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: capture,
    });
    // The post chain owns tonemapping and encoding, so the renderer stays linear.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    // Fog is depth, not mood (DIRECTION §8) — tuned so a 25 m corridor still
    // resolves its far wall.
    this.scene.fog = new THREE.FogExp2(0x0a0f16, 0.0155);

    this.rig = new CameraRig(rng);
    this.post = new Post(this.renderer, quality);

    this.stats = { calls: 0, triangles: 0, programs: 0, lights: 0, textures: 0 };
    this._lastProgramCount = 0;
    this.compilationsSinceMark = 0;
  }

  get camera() { return this.rig.camera; }

  setSize(w, h) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(Math.round(w * pr), Math.round(h * pr));
    this.rig.resize(w, h);
  }

  /** Mark the end of loading: any shader compiled after this is a hitch (P7). */
  markPrewarmComplete() {
    this._lastProgramCount = this.renderer.info.programs ? this.renderer.info.programs.length : 0;
    this.compilationsSinceMark = 0;
    this.prewarmed = true;
  }

  render(time) {
    this.renderer.info.reset();
    this.post.u.uTime.value = time;
    this.post.render(this.scene, this.camera);
    const info = this.renderer.info;
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    const programs = info.programs ? info.programs.length : 0;
    this.stats.programs = programs;
    if (this.prewarmed && programs > this._lastProgramCount) {
      this.compilationsSinceMark += programs - this._lastProgramCount;
      this._lastProgramCount = programs;
    }
  }

  dispose() { this.renderer.dispose(); }
}
