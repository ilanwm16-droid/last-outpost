// Post-processing stack for Last Outpost.
//
// Chain: RenderPass (linear HDR, MSAA) -> UnrealBloomPass (only bright emissives)
//        -> OutputPass (renderer tone mapping + sRGB) -> GradePass (display-referred
//        grading, vignette, grain, chromatic aberration, damage / low-health looks).
//
// The vendored addons import the bare specifier 'three'; index.html maps it to
// ./vendor/three.module.js with an import map, so they share this module instance.
import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';

// Per-quality settings. pixelRatio is a cap applied to devicePixelRatio.
// bloomScale: 1 = UnrealBloomPass default (mip chain starts at half of the frame),
// 0.5 = everything a further half (cheaper, softer). samples = MSAA of the scene target.
export const QUALITY = {
  low: { pixelRatio: 1, bloom: false, bloomScale: 0, grain: 0, samples: 0 },
  medium: { pixelRatio: 1.25, bloom: true, bloomScale: 0.5, grain: 0.8, samples: 2 },
  high: { pixelRatio: 1.5, bloom: true, bloomScale: 1, grain: 1, samples: 4 },
};

// Neutral grade. Scene values reaching the bloom pass are linear and not yet exposed
// (OutputPass applies renderer.toneMappingExposure), so the threshold is in that space:
// lit surfaces at night stay well below ~0.6, emissive eyes/core/pus and
// MeshBasicMaterial lamps/flashes sit above it.
export const NEUTRAL_GRADE = Object.freeze({
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], tint: [1, 1, 1],
  saturation: 1, contrast: 1, vignette: 0.32, bloomStrength: 0.7, bloomThreshold: 0.62,
});

// Slot layout of the smoothed grade state (current and target arrays).
const G = { lift: 0, gamma: 3, gain: 6, tint: 9, saturation: 12, contrast: 13, vignette: 14, bloomStrength: 15, bloomThreshold: 16 };
const G_SIZE = 17;
const VEC3_KEYS = ['lift', 'gamma', 'gain', 'tint'];
const SCALAR_KEYS = ['saturation', 'contrast', 'vignette', 'bloomStrength', 'bloomThreshold'];

const GradeShader = {
  name: 'OutpostGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    aspect: { value: 1 },
    time: { value: 0 },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gammaInv: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    saturation: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0.32 },
    vignetteStart: { value: 0.42 },
    grain: { value: 0.035 },
    aberration: { value: 0 },
    edgeRed: { value: 0 },
    lowHealth: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float aspect;
    uniform float time;
    uniform vec3 lift;
    uniform vec3 gammaInv;
    uniform vec3 gain;
    uniform vec3 tint;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    uniform float vignetteStart;
    uniform float grain;
    uniform float aberration;
    uniform float edgeRed;
    uniform float lowHealth;
    varying vec2 vUv;

    // Sine-free hash (Dave Hoskins), stable across GPUs.
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 fromCenter = vUv - 0.5;
      // Radius normalized so the screen corners are at 1.0 for any aspect.
      float r = length(fromCenter * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);

      vec3 col;
      if (aberration > 0.00005) {
        vec2 shift = fromCenter * aberration * (0.35 + r);
        col.r = texture2D(tDiffuse, vUv + shift).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - shift).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      col = clamp(col, 0.0, 1.0);

      // Lift / gamma / gain (display-referred, ASC-CDL style).
      col = gain * (col + lift * (1.0 - col));
      col = pow(max(col, vec3(0.0)), gammaInv);
      col *= tint;

      // Saturation and contrast (pivot below mid-grey so night scenes keep their shadows).
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, saturation);
      col = (col - 0.42) * contrast + 0.42;

      // Vignette.
      float vig = smoothstep(vignetteStart, vignetteStart + 0.62, r);
      col *= 1.0 - vignette * vig;

      // Damage flash / low-health heartbeat: blood-red rim.
      float rim = smoothstep(0.38, 1.05, r) * edgeRed;
      col = mix(col, vec3(0.30, 0.012, 0.008) + col * vec3(0.55, 0.12, 0.1), clamp(rim, 0.0, 0.85));

      // Film grain, stronger in the shadows, re-seeded at 24 fps; plus 1/255 dithering.
      vec2 px = vUv * resolution;
      float seed = floor(time * 24.0);
      float n = hash12(px + seed * vec2(17.13, 59.71)) - 0.5;
      luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += n * (grain * (1.0 - 0.6 * clamp(luma, 0.0, 1.0)) + 1.0 / 255.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

function readVec3(value, out, offset) {
  if (typeof value === 'number') { out[offset] = out[offset + 1] = out[offset + 2] = value; return; }
  if (value && value.length >= 3) { out[offset] = +value[0]; out[offset + 1] = +value[1]; out[offset + 2] = +value[2]; }
}

function writeGrade(grade, out) {
  if (!grade) return;
  for (const key of VEC3_KEYS) if (grade[key] !== undefined) readVec3(grade[key], out, G[key]);
  for (const key of SCALAR_KEYS) if (typeof grade[key] === 'number' && Number.isFinite(grade[key])) out[G[key]] = grade[key];
}

function clamp01(v) { return v > 0 ? (v < 1 ? v : 1) : 0; } // NaN -> 0

/**
 * Creates the post-processing stack.
 * @param {THREE.WebGLRenderer} renderer must have toneMapping / outputColorSpace set (OutputPass reads them).
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{quality?: 'low'|'medium'|'high', width?: number, height?: number}} [options]
 */
export function createPostFx(renderer, scene, camera, options = {}) {
  const initialSize = renderer.getSize(new THREE.Vector2());
  let width = options.width || initialSize.x || 1;
  let height = options.height || initialSize.y || 1;
  let quality = QUALITY[options.quality] ? options.quality : 'high';
  let preset = QUALITY[quality];
  let pixelRatio = 1;

  // MSAA on half-float targets needs EXT_color_buffer_float (universal on desktop WebGL2).
  const canMsaa = !!(renderer.extensions && renderer.extensions.has && renderer.extensions.has('EXT_color_buffer_float'));
  const maxSamples = (renderer.capabilities && renderer.capabilities.maxSamples) || 0;
  const samplesFor = (p) => (canMsaa ? Math.min(p.samples, maxSamples) : 0);

  const sceneTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: samplesFor(preset) });
  sceneTarget.texture.name = 'PostFx.scene';
  const composer = new EffectComposer(renderer, sceneTarget);

  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), NEUTRAL_GRADE.bloomStrength, 0.42, NEUTRAL_GRADE.bloomThreshold);
  // Soft knee instead of the default hard 0.01 edge, so glow fades in instead of popping.
  bloom.highPassUniforms.smoothWidth.value = 0.35;
  const outputPass = new OutputPass();
  const gradePass = new ShaderPass(GradeShader);
  const u = gradePass.uniforms;

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(outputPass);
  composer.addPass(gradePass);

  // Grade state: target is set by setGrade(), current eases towards it in render().
  const target = new Float32Array(G_SIZE);
  const current = new Float32Array(G_SIZE);
  writeGrade(NEUTRAL_GRADE, target);
  current.set(target);

  let time = 0;
  let damage = 0; // 0..1, decays
  let lowHealth = 0; // target 0..1
  let lowHealthBlend = 0;
  let heartPhase = 0;
  let scope = false;
  let scopeBlend = 0;

  function applySize() {
    const dpr = (typeof globalThis.devicePixelRatio === 'number' && globalThis.devicePixelRatio > 0) ? globalThis.devicePixelRatio : 1;
    const pr = Math.min(dpr, preset.pixelRatio);
    if (pr !== pixelRatio || renderer.getPixelRatio() !== pr) {
      pixelRatio = pr;
      renderer.setPixelRatio(pr);
    }
    renderer.setSize(width, height);
    if (composer._pixelRatio !== pr) composer.setPixelRatio(pr);
    composer.setSize(width, height);
    const w = Math.max(1, Math.round(width * pr));
    const h = Math.max(1, Math.round(height * pr));
    if (preset.bloom && preset.bloomScale !== 1) bloom.setSize(Math.max(2, Math.round(w * preset.bloomScale)), Math.max(2, Math.round(h * preset.bloomScale)));
    u.resolution.value.set(w, h);
    u.aspect.value = w / h;
  }

  function applyQuality() {
    preset = QUALITY[quality];
    bloom.enabled = preset.bloom;
    const samples = samplesFor(preset);
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    applySize();
  }

  applyQuality();

  const api = {
    composer,
    bloom,
    get quality() { return quality; },
    get pixelRatio() { return pixelRatio; },

    /** Renders the frame through the stack. dt in seconds. */
    render(dt = 1 / 60) {
      if (!(dt >= 0)) dt = 0;
      if (dt > 0.1) dt = 0.1;
      time += dt;

      const ease = 1 - Math.exp(-dt * 2.4);
      for (let i = 0; i < G_SIZE; i++) current[i] += (target[i] - current[i]) * ease;
      damage *= Math.exp(-dt * 3.2);
      if (damage < 0.001) damage = 0;
      lowHealthBlend += (lowHealth - lowHealthBlend) * (1 - Math.exp(-dt * 4));
      scopeBlend += ((scope ? 1 : 0) - scopeBlend) * (1 - Math.exp(-dt * 14));

      // Heartbeat: double pulse ("lub-dub"), faster as health drops (~62 -> ~110 bpm).
      const period = 0.97 - 0.42 * lowHealthBlend;
      heartPhase = (heartPhase + dt / period) % 1;
      const b1 = (heartPhase - 0.06) / 0.055, b2 = (heartPhase - 0.3) / 0.07;
      const beat = Math.exp(-b1 * b1) + 0.6 * Math.exp(-b2 * b2);

      const lh = lowHealthBlend;
      u.time.value = time;
      u.lift.value.set(current[G.lift], current[G.lift + 1], current[G.lift + 2]);
      u.gammaInv.value.set(1 / Math.max(0.05, current[G.gamma]), 1 / Math.max(0.05, current[G.gamma + 1]), 1 / Math.max(0.05, current[G.gamma + 2]));
      u.gain.value.set(current[G.gain], current[G.gain + 1], current[G.gain + 2]);
      u.tint.value.set(current[G.tint], current[G.tint + 1], current[G.tint + 2]);
      u.saturation.value = current[G.saturation] * (1 - 0.68 * lh);
      u.contrast.value = current[G.contrast] * (1 + 0.1 * lh + 0.06 * scopeBlend);
      u.vignette.value = Math.min(0.95, current[G.vignette] + 0.5 * scopeBlend + 0.12 * lh);
      u.vignetteStart.value = 0.42 - 0.2 * scopeBlend;
      u.grain.value = 0.034 * preset.grain * (1 + 0.6 * lh);
      u.aberration.value = 0.013 * damage + 0.0035 * lh * beat;
      u.edgeRed.value = Math.min(1, 0.75 * damage + lh * (0.22 + 0.3 * beat));

      bloom.strength = current[G.bloomStrength];
      bloom.threshold = current[G.bloomThreshold];

      composer.render(dt);
    },

    /** Resizes the canvas and every target (CSS pixels). Call instead of renderer.setSize. */
    setSize(w, h) {
      width = Math.max(1, w | 0);
      height = Math.max(1, h | 0);
      applySize();
    },

    /** 'low': no bloom/grain/MSAA, pixel ratio 1. 'medium': half-res bloom. 'high': full. */
    setQuality(q) {
      if (!QUALITY[q] || q === quality) return;
      quality = q;
      applyQuality();
    },

    /**
     * Sets the grade target; omitted keys keep their value. Changes ease in over ~1 s
     * unless instant is true. lift/gamma/gain/tint accept a number or [r,g,b].
     * Extra keys: vignette (0..1), bloomStrength, bloomThreshold.
     */
    setGrade(grade, instant = false) {
      writeGrade(grade, target);
      if (instant) current.set(target);
    },

    /** Damage pulse (chromatic aberration + red rim). amount = HP lost; 30 HP = full pulse. */
    pulseDamage(amount = 10) {
      const a = Number.isFinite(amount) ? amount : 10;
      damage = Math.min(1, damage + clamp01(a / 30) * 0.85 + 0.15);
    },

    /** 0 = healthy, 1 = about to die: desaturation, heartbeat rim, extra grain. */
    setLowHealth(v) { lowHealth = clamp01(Number.isFinite(v) ? v : 0); },

    /** Scope (SVD ADS): tighter, darker vignette and a little more contrast. */
    setScope(on) { scope = !!on; },

    /** Clears transient effects (damage pulse, low health, scope), e.g. on game restart. */
    reset() {
      damage = 0; lowHealth = 0; lowHealthBlend = 0; scope = false; scopeBlend = 0;
    },

    dispose() {
      bloom.dispose();
      outputPass.dispose();
      gradePass.dispose();
      composer.dispose();
    },
  };
  return api;
}

// Grade presets for time of day (0 = deep night, 1 = sunrise), wave events and weather.
// Pure helper: gradeFor(tod, event, weather) -> object for postfx.setGrade().
const NIGHT = { lift: [0.006, 0.012, 0.022], gamma: [1, 1, 1], gain: [0.98, 1, 1.04], tint: [0.93, 1, 1.07], saturation: 0.86, contrast: 1.06, vignette: 0.36, bloomStrength: 0.75, bloomThreshold: 0.62 };
const DAWN = { lift: [0.014, 0.008, 0.002], gamma: [1.04, 1.02, 1], gain: [1.05, 1.02, 0.96], tint: [1.06, 1, 0.92], saturation: 1.05, contrast: 1.04, vignette: 0.26, bloomStrength: 0.55, bloomThreshold: 0.9 };
const EVENT_GRADES = {
  blood: { tint: [1.12, 0.9, 0.87], saturation: 0.96, contrast: 1.1, vignette: 0.42, lift: [0.016, 0, 0] },
  fog: { saturation: 0.8, contrast: 0.94, lift: [0.03, 0.032, 0.034], vignette: 0.3 },
  gold: { tint: [1.08, 1.03, 0.9], saturation: 1.08, bloomStrength: 0.9 },
  swarm: { tint: [1.02, 0.98, 0.95], saturation: 0.9, contrast: 1.1, vignette: 0.4 },
};
const WEATHER_GRADES = {
  rain: { saturation: 0.9, tint: [0.96, 1, 1.04] },
  fog: { saturation: 0.84, contrast: 0.95, lift: [0.024, 0.026, 0.028] },
  storm: { saturation: 0.8, contrast: 1.08, tint: [0.93, 0.98, 1.05], vignette: 0.4 },
};

function mixInto(out, key, a, b, t) {
  const av = a[key], bv = b[key];
  if (Array.isArray(av)) {
    const arr = Array.isArray(out[key]) ? out[key] : (out[key] = [0, 0, 0]);
    for (let i = 0; i < 3; i++) arr[i] = av[i] + (bv[i] - av[i]) * t;
  } else out[key] = av + (bv - av) * t;
}

/**
 * Builds a grade for the given time of day / event / weather. Overlays are blended
 * at 70% over the time-of-day base (vec3 keys multiply for tint, add for lift).
 * Pass `out` to reuse an object (no allocation after the first call).
 */
export function gradeFor(tod = 0, event = null, weather = 'clear', out = {}) {
  const t = clamp01(tod);
  // Ease so the sky stays "night" for most of the campaign and brightens late.
  const k = t * t * (3 - 2 * t);
  for (const key of Object.keys(NIGHT)) mixInto(out, key, NIGHT, DAWN, k);
  for (const overlay of [WEATHER_GRADES[weather], EVENT_GRADES[event]]) {
    if (!overlay) continue;
    for (const key of Object.keys(overlay)) {
      const v = overlay[key];
      if (key === 'tint') for (let i = 0; i < 3; i++) out.tint[i] *= 1 + (v[i] - 1) * 0.7;
      else if (key === 'lift') for (let i = 0; i < 3; i++) out.lift[i] += v[i] * 0.7;
      else if (Array.isArray(v)) for (let i = 0; i < 3; i++) out[key][i] += (v[i] - out[key][i]) * 0.7;
      else out[key] += (v - out[key]) * 0.7;
    }
  }
  return out;
}
