// RENDERER / Post — hand-written HDR post chain.
//
// One owner for bloom, exposure, tonemap, grade, vignette, aberration and grain,
// because those are one coupled system (DIRECTION §9 / ARCHITECTURE decision #2).
//
// Chain:  scene(HDR) -> bright -> down x N -> up x N (tent) -> composite -> FXAA -> canvas
//
// The AgX transform is the reference implementation from three.js r185
// (tonemapping_pars_fragment), inlined here because the composite shader must own
// tonemapping rather than inheriting the renderer's global state.

import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const AGX = /* glsl */`
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ));
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 ));
vec3 agxContrast( vec3 x ) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232;
}
// AgX without a look transform lifts near-black enormously: a scene at 0.01
// linear lands around 0.3 display, which is why an underlit room reads as flat
// mid-grey rather than dark. The look is applied in the normalised log domain,
// where AgX intends it, and is what gives the station its blacks.
uniform float uLookSlope;
uniform float uLookPower;
uniform float uLookSat;
uniform float uLookOffset;
vec3 agxLook( vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = pow( max( vec3( 0.0 ), c * uLookSlope + uLookOffset ), vec3( uLookPower ) );
  return max( vec3( 0.0 ), l + uLookSat * ( c - l ) );
}
vec3 agx( vec3 color ) {
  const mat3 inset = mat3(
    vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
    vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ));
  const mat3 outset = mat3(
    vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ),
    vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ),
    vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ));
  const float minEv = -12.47393; const float maxEv = 4.026069;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = inset * color;
  color = max( color, 1e-10 );
  color = log2( color );
  color = ( color - minEv ) / ( maxEv - minEv );
  color = clamp( color, 0.0, 1.0 );
  color = agxContrast( color );
  color = agxLook( color );
  color = outset * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp( color, 0.0, 1.0 );
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  // 4-tap box downsample first: cheaper and reduces firefly aliasing
  vec3 c = texture2D(tSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float w = max(soft, l - uThreshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const UP_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  // 3x3 tent upsample of the smaller mip, added to the larger one
  vec2 o = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( 0.0,  o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-o.x,  0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2( o.x,  0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( 0.0, -o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb;
  c /= 16.0;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + c, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform float uDamage;      // red pulse 0..1
uniform float uHeal;        // cyan pulse 0..1
uniform float uFlash;       // white flash 0..1 (nest rupture, detonation)
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uSaturation;
varying vec2 vUv;

${AGX}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// deterministic hash — driven by the engine clock, never wall time
float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCentre = uv - 0.5;
  float r2 = dot(fromCentre, fromCentre);

  // lateral chromatic aberration, strongest at the edges, plus damage kick
  float ab = uAberration * (0.35 + r2 * 2.2) + uDamage * 0.0022;
  vec2 dir = normalize(fromCentre + 1e-6);
  vec3 scene;
  scene.r = texture2D(tScene, uv + dir * ab).r;
  scene.g = texture2D(tScene, uv).g;
  scene.b = texture2D(tScene, uv - dir * ab).b;

  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec3 hdr = scene + bloom * uBloomStrength;

  hdr *= uExposure * (1.0 + uFlash * 3.0);

  vec3 col = agx(hdr);

  // Grade: cool the shadows, warm the highlights. The shadow term is applied as
  // a tint that scales WITH the pixel plus a very small lift, because a flat
  // additive lift in display space swamps a dark scene with a constant colour
  // and destroys every black in the image.
  float l = luma(col);
  float shadowMask = 1.0 - smoothstep(0.0, 0.40, l);
  col *= mix(vec3(1.0), uShadowTint, shadowMask * 0.85);
  col += uHighlightTint * smoothstep(0.55, 1.0, l) * 0.09;
  col += vec3(0.004, 0.007, 0.013) * shadowMask;   // just enough to keep noise off the floor
  col = mix(vec3(l), col, uSaturation);

  // damage / heal screen state
  col = mix(col, vec3(0.55, 0.05, 0.03), uDamage * (0.30 + 0.25 * r2 * 4.0));
  col = mix(col, vec3(0.15, 0.65, 0.75), uHeal * 0.22 * (0.4 + r2));

  // vignette
  float vig = 1.0 - uVignette * smoothstep(0.15, 0.85, r2 * 2.0);
  col *= vig;

  // film grain, scaled down in the highlights so light sources stay clean
  float g = hash21(uv * uResolution + vec2(uTime * 71.3, uTime * 39.7)) - 0.5;
  col += g * uGrain * (1.0 - smoothstep(0.4, 1.0, l));

  col = clamp(col, 0.0, 1.0);
  // manual sRGB encode: the renderer runs in linear output mode
  vec3 srgb = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  gl_FragColor = vec4(srgb, 1.0);
}`;

// Standard FXAA 3.11 console-quality variant, adapted for WebGL2 GLSL1.
const FXAA_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 rgbNW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(tSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(tSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  vec3 rgbM  = texture2D(tSrc, vUv).rgb;
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { gl_FragColor = vec4(rgbM, 1.0); return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
  vec3 rgbA = 0.5 * (texture2D(tSrc, vUv + dir * (1.0/3.0 - 0.5)).rgb +
                     texture2D(tSrc, vUv + dir * (2.0/3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb +
                                   texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lB = luma(rgbB);
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}`;

export class Post {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.enabled = true;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.triGeom = g;
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(g, null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.matBright = this.makeMat(BRIGHT_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1.15 }, uKnee: { value: 0.55 },
    });
    this.matDown = this.makeMat(DOWN_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });
    this.matUp = this.makeMat(UP_FRAG, {
      tSrc: { value: null }, tPrev: { value: null },
      uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 },
    });
    this.matComposite = this.makeMat(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uExposure: { value: 1.0 },
      uBloomStrength: { value: 0.42 },
      uTime: { value: 0 },
      uGrain: { value: 0.022 },
      uVignette: { value: 0.42 },
      uAberration: { value: 0.0011 },
      uDamage: { value: 0 }, uHeal: { value: 0 }, uFlash: { value: 0 },
      // uShadowTint is a MULTIPLIER on shadow pixels (cool them), not a lift.
      uShadowTint: { value: new THREE.Color(0.72, 0.86, 1.12) },
      uHighlightTint: { value: new THREE.Color(0.55, 0.32, 0.12) },
      uSaturation: { value: 1.06 },
      uLookSlope: { value: 1.0 },
      uLookPower: { value: 1.28 },
      uLookSat: { value: 1.22 },
      uLookOffset: { value: -0.018 },
    });
    this.matFxaa = this.makeMat(FXAA_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });

    this.u = this.matComposite.uniforms;
    this.bloomLevels = [];
    this.setSize(1, 1);
  }

  makeMat(frag, uniforms) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,     // three emits the #version directive itself
      vertexShader: toGLSL3Vert(VERT),
      fragmentShader: 'precision highp float;\nprecision highp int;\n' + toGLSL3Frag(frag),
      uniforms,
      depthTest: false, depthWrite: false,
    });
  }

  setSize(w, h) {
    this.width = Math.max(1, w | 0);
    this.height = Math.max(1, h | 0);
    const opts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: true, stencilBuffer: false,
      colorSpace: THREE.NoColorSpace,
    };
    dispose(this.rtScene); dispose(this.rtLdr);
    this.rtScene = new THREE.WebGLRenderTarget(this.width, this.height, opts);
    this.rtScene.texture.name = 'sceneHDR';
    this.rtLdr = new THREE.WebGLRenderTarget(this.width, this.height, {
      ...opts, type: THREE.UnsignedByteType, depthBuffer: false,
    });

    for (const l of this.bloomLevels) { dispose(l.rtA); dispose(l.rtB); }
    this.bloomLevels = [];
    const levels = this.quality.bloomLevels;
    let bw = this.width, bh = this.height;
    for (let i = 0; i < levels; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.bloomLevels.push({
        w: bw, h: bh,
        rtA: new THREE.WebGLRenderTarget(bw, bh, { ...opts, depthBuffer: false }),
        rtB: new THREE.WebGLRenderTarget(bw, bh, { ...opts, depthBuffer: false }),
      });
    }
    this.u.uResolution.value.set(this.width, this.height);
  }

  blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    if (!this.enabled || this.bloomLevels.length === 0) {
      this.u.tScene.value = this.rtScene.texture;
      this.u.tBloom.value = this.rtScene.texture;
      this.u.uBloomStrength.value = 0;
      this.blit(this.matComposite, null);
      r.setRenderTarget(null);
      return;
    }

    // bright pass into level 0
    const l0 = this.bloomLevels[0];
    this.matBright.uniforms.tSrc.value = this.rtScene.texture;
    this.matBright.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
    this.blit(this.matBright, l0.rtA);

    // downsample chain
    for (let i = 1; i < this.bloomLevels.length; i++) {
      const prev = this.bloomLevels[i - 1], cur = this.bloomLevels[i];
      this.matDown.uniforms.tSrc.value = prev.rtA.texture;
      this.matDown.uniforms.uTexel.value.set(1 / prev.w, 1 / prev.h);
      this.blit(this.matDown, cur.rtA);
    }

    // upsample + accumulate (tent)
    let src = this.bloomLevels[this.bloomLevels.length - 1].rtA;
    for (let i = this.bloomLevels.length - 2; i >= 0; i--) {
      const cur = this.bloomLevels[i];
      this.matUp.uniforms.tSrc.value = src.texture;
      this.matUp.uniforms.tPrev.value = cur.rtA.texture;
      this.matUp.uniforms.uTexel.value.set(1 / cur.w, 1 / cur.h);
      this.blit(this.matUp, cur.rtB);
      src = cur.rtB;
    }

    this.u.tScene.value = this.rtScene.texture;
    this.u.tBloom.value = src.texture;

    if (this.quality.fxaa) {
      this.blit(this.matComposite, this.rtLdr);
      this.matFxaa.uniforms.tSrc.value = this.rtLdr.texture;
      this.matFxaa.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.blit(this.matFxaa, null);
    } else {
      this.blit(this.matComposite, null);
    }
    r.setRenderTarget(null);
  }
}

function dispose(rt) { if (rt) rt.dispose(); }

// RawShaderMaterial needs explicit GLSL3 plumbing; these two helpers keep the
// shader sources above readable as ordinary GLSL1.
function toGLSL3Vert(src) {
  return `in vec3 position;\nin vec2 uv;\nout vec2 vUv;\n` +
    src.replace('varying vec2 vUv;', '').replace(/\bvarying\b/g, 'out');
}
function toGLSL3Frag(src) {
  return `out vec4 fragColor;\n` +
    src.replace(/\bvarying\b/g, 'in')
       .replace(/texture2D\(/g, 'texture(')
       .replace(/gl_FragColor/g, 'fragColor');
}
