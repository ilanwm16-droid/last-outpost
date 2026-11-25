import * as THREE from './vendor/three.module.js';

// Sector 07 checkpoint: a fortified outpost on a highway at the edge of the
// dead city. Static geometry is merged into one mesh per material (vertex
// colors carry the per-object tint), so the whole arena costs a few dozen
// draw calls. Textures are painted on canvases at load time, nothing is
// downloaded. Every solid prop is mirrored by an X/Z box in `colliders`
// that the player, the horde navigator, bullets and grenades share.

const QUALITY = {
  low: {rain: 600, embers: 36},
  medium: {rain: 1500, embers: 72},
  high: {rain: 2600, embers: 110},
};
const RAIN_MAX = 2600, EMBER_MAX = 110, RAIN_AREA = 36, RAIN_HEIGHT = 18;

// Weather targets; the live values ease toward them over a few seconds.
// fog multiplies the time-of-day density, mist pulls the fog color to grey.
const WEATHER = {
  clear: {rain: 0, cloud: .12, fog: 1, mist: 0, wind: .06, storm: 0},
  rain: {rain: .7, cloud: .8, fog: 1.35, mist: .3, wind: .14, storm: 0},
  fog: {rain: 0, cloud: .55, fog: 3.1, mist: .75, wind: .03, storm: 0},
  storm: {rain: 1, cloud: 1, fog: 1.6, mist: .35, wind: .32, storm: 1},
};
export const WEATHER_KINDS = Object.keys(WEATHER);

// Time of day: 0 = deep night (wave 1) ... 1 = sunrise (wave 30).
// Night values reproduce the original v3 look so early waves feel the same.
const COLOR_KEYS = ['top', 'band', 'fog', 'mist', 'glow', 'hemiSky', 'hemiGnd', 'moonC', 'sunC', 'skyline'];
const NUM_KEYS = ['hemi', 'moon', 'sun', 'dens', 'stars', 'lamps', 'windows', 'moonEl', 'sunEl'];
const TOD = [
  {t: 0, top: 0x03070e, band: 0x101e28, fog: 0x152b33, mist: 0x3a474b, glow: 0x4a2412, hemiSky: 0xa1d5da, hemiGnd: 0x34403b, moonC: 0x94c9cf, sunC: 0xe7a26f, skyline: 0xc8d0e0,
    hemi: 2.0, moon: 2.0, sun: .85, dens: .0185, stars: 1, lamps: 1, windows: 1, moonEl: .62, sunEl: -.32},
  {t: .45, top: 0x040915, band: 0x142233, fog: 0x172d3a, mist: 0x3c484f, glow: 0x50260f, hemiSky: 0x9fcbe0, hemiGnd: 0x333e3d, moonC: 0x9ac6dc, sunC: 0xd99070, skyline: 0xc8d0e0,
    hemi: 1.95, moon: 1.85, sun: .8, dens: .0185, stars: .95, lamps: 1, windows: .95, moonEl: .48, sunEl: -.25},
  {t: .72, top: 0x0c1730, band: 0x2a3046, fog: 0x26303e, mist: 0x4a5058, glow: 0x5a2a18, hemiSky: 0xa0b4d8, hemiGnd: 0x3a3c3c, moonC: 0xa8bcd8, sunC: 0xd8826a, skyline: 0xb8bccc,
    hemi: 1.9, moon: 1.3, sun: .95, dens: .0172, stars: .55, lamps: 1, windows: .85, moonEl: .3, sunEl: -.1},
  {t: .88, top: 0x2a4472, band: 0x9a6a62, fog: 0x5e5258, mist: 0x787274, glow: 0x6a3a22, hemiSky: 0xc4c8dc, hemiGnd: 0x4a4238, moonC: 0xc0c8d8, sunC: 0xff9658, skyline: 0xa09098,
    hemi: 2.0, moon: .55, sun: 1.6, dens: .0142, stars: .12, lamps: .8, windows: .6, moonEl: .16, sunEl: 0},
  {t: 1, top: 0x4f80b8, band: 0xe2a070, fog: 0x9a8478, mist: 0xa49c94, glow: 0x000000, hemiSky: 0xdce6f2, hemiGnd: 0x5c5244, moonC: 0xc8d0dc, sunC: 0xffc38a, skyline: 0x8a7a80,
    hemi: 2.25, moon: .12, sun: 2.6, dens: .0105, stars: 0, lamps: .45, windows: .3, moonEl: .05, sunEl: .24},
].map(k => {
  const o = {t: k.t};
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  for (const n of NUM_KEYS) o[n] = k[n];
  return o;
});
const MOON_AZ = -.72, SUN_AZ = .5; // radians from north (-z) toward east (+x)

function sampleTod(t, out) {
  t = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < TOD.length - 2 && t > TOD[i + 1].t) i++;
  const a = TOD[i], b = TOD[i + 1], f = (t - a.t) / (b.t - a.t);
  for (const k of COLOR_KEYS) out[k].lerpColors(a[k], b[k], f);
  for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * f;
}
function dirFromAzEl(az, el, out) {
  const c = Math.cos(el);
  return out.set(Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c);
}
function makeRng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// ---------------------------------------------------------------------------
// Procedural textures. Without a DOM (Node tests) every painter returns null
// and materials simply render untextured.
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTexture(c, repeat = true) {
  if (!c) return null;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// Tileable fractal value noise in 0..1 for a square texture.
function noiseField(size, r, period, octaves, gain = .5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const scale = p / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % p) * p, r1 = ((y0 + 1) % p) * p;
      for (let x = 0; x < size; x++) {
        const fx = x * scale, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % p, c1 = (x0 + 1) % p;
        const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx, b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp; amp *= gain; p *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
// Draws a shape nine times so it wraps across tile edges seamlessly.
function wrapped(ctx, S, draw) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { ctx.save(); ctx.translate(ox, oy); draw(); ctx.restore(); }
}
function crackPaths(r, S, count, segMin, segMax) {
  const out = [];
  const walk = (x, y, a, n, w, depth) => {
    const pts = [x, y];
    for (let k = 0; k < n; k++) {
      a += (r() - .5) * 1.1;
      const l = 5 + r() * 11;
      x += Math.cos(a) * l; y += Math.sin(a) * l;
      pts.push(x, y);
      if (depth < 2 && r() < .13) walk(x, y, a + (r() < .5 ? 1 : -1) * (.6 + r() * .6), 3 + Math.floor(r() * 5), w * .6, depth + 1);
    }
    out.push({pts, w});
  };
  for (let i = 0; i < count; i++) walk(r() * S, r() * S, r() * Math.PI * 2, segMin + Math.floor(r() * (segMax - segMin)), .9 + r() * 1.5, 0);
  return out;
}
function strokeCracks(ctx, cracks, dark, light) {
  for (const {pts, w} of cracks) {
    ctx.lineWidth = w; ctx.strokeStyle = dark; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
    ctx.stroke();
    ctx.lineWidth = Math.max(.6, w * .5); ctx.strokeStyle = light; ctx.beginPath(); ctx.moveTo(pts[0] + 1, pts[1] + 1);
    for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k] + 1, pts[k + 1] + 1);
    ctx.stroke();
  }
}
function fillNoise(ctx, S, fn) {
  const img = ctx.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) {
    const [R, G, B] = fn(i);
    const j = i * 4; d[j] = R; d[j + 1] = G; d[j + 2] = B; d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function paintAsphalt(r) {
  const S = 512, c = makeCanvas(S, S);
  if (!c) return null;
  const ctx = c.getContext('2d'), big = noiseField(S, r, 4, 4), fine = noiseField(S, r, 32, 2);
  fillNoise(ctx, S, i => {
    const g = r();
    let v = 34 + big[i] * 30 + fine[i] * 16 + (g - .5) * 18;
    if (g > .988) v += 30 + r() * 40; else if (g < .01) v -= 14;
    return [v * .97, v, v * 1.05];
  });
  const patches = [];
  for (let i = 0; i < 5; i++) patches.push([r() * S, r() * S, 40 + r() * 120, 30 + r() * 90, r() < .55]);
  wrapped(ctx, S, () => {
    for (const [x, y, w, h, dark] of patches) {
      ctx.fillStyle = dark ? 'rgba(8,10,12,0.26)' : 'rgba(130,130,135,0.07)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(5,6,8,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
    }
  });
  const stains = [];
  for (let i = 0; i < 6; i++) stains.push([r() * S, r() * S, 10 + r() * 38]);
  wrapped(ctx, S, () => {
    for (const [x, y, rad] of stains) {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
  });
  const cracks = crackPaths(r, S, 9, 8, 22);
  wrapped(ctx, S, () => strokeCracks(ctx, cracks, 'rgba(6,7,8,0.6)', 'rgba(95,95,100,0.16)'));
  return c;
}
function paintConcrete(r) {
  const S = 512, c = makeCanvas(S, S);
  if (!c) return null;
  const ctx = c.getContext('2d'), big = noiseField(S, r, 4, 4), mid = noiseField(S, r, 16, 3);
  fillNoise(ctx, S, i => {
    const g = r();
    let v = 98 + big[i] * 40 + mid[i] * 24 + (g - .5) * 14;
    if (g > .993) v -= 45;
    return [v, v * .99, v * .955];
  });
  const streaks = [];
  for (let i = 0; i < 26; i++) streaks.push([r() * S, r() * S * .5, 2 + r() * 7, 60 + r() * 200]);
  wrapped(ctx, S, () => {
    for (const [x, y, w, h] of streaks) {
      const gr = ctx.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, 'rgba(28,26,22,0.2)'); gr.addColorStop(1, 'rgba(28,26,22,0)');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
    }
  });
  // Formwork joints on the tile edge and tie holes give walls a cast look.
  ctx.fillStyle = 'rgba(26,26,26,0.45)'; ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, 0, 3, S);
  ctx.fillStyle = 'rgba(18,18,18,0.6)';
  for (const [x, y] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]]) { ctx.beginPath(); ctx.arc(x * S, y * S, 3.2, 0, Math.PI * 2); ctx.fill(); }
  const cracks = crackPaths(r, S, 4, 5, 12);
  wrapped(ctx, S, () => strokeCracks(ctx, cracks, 'rgba(30,30,30,0.7)', 'rgba(200,200,195,0.12)'));
  return c;
}
// Apartment facade (16 m x 16 m per tile, 5 floors x 6 windows) plus a matching
// emissive map where a few windows are still lit.
function paintFacade(r) {
  const S = 512, c = makeCanvas(S, S), e = makeCanvas(S, S);
  if (!c || !e) return [null, null];
  const ctx = c.getContext('2d'), ex = e.getContext('2d'), big = noiseField(S, r, 4, 3), mid = noiseField(S, r, 16, 2);
  fillNoise(ctx, S, i => { const v = 58 + big[i] * 30 + mid[i] * 14 + (r() - .5) * 10; return [v * .95, v, v * 1.04]; });
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
  const floors = 5, cols = 6, fh = S / floors, cw = S / cols;
  for (let f = 0; f < floors; f++) { ctx.fillStyle = 'rgba(18,20,22,0.55)'; ctx.fillRect(0, f * fh, S, 6); }
  for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
    const w = 46, h = 58, x = k * cw + (cw - w) / 2, y = f * fh + 22, kind = r();
    if (kind < .08) {
      ctx.fillStyle = '#3b3226'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      for (let p = 1; p < 5; p++) { ctx.beginPath(); ctx.moveTo(x, y + p * h / 5); ctx.lineTo(x + w, y + p * h / 5 + (r() - .5) * 6); ctx.stroke(); }
    } else if (kind < .2) {
      ctx.fillStyle = '#050607'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(120,135,145,0.35)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * r(), y); ctx.lineTo(x, y + h * r()); ctx.fill();
    } else {
      const gr = ctx.createLinearGradient(x, y, x, y + h);
      gr.addColorStop(0, '#2b3743'); gr.addColorStop(1, '#10161b');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(150,150,150,0.32)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
      if (r() < .26) {
        const warm = r() < .72, lv = .5 + r() * .5, [R, G, B] = warm ? [255, 172, 92] : [150, 188, 255];
        const lg = ex.createLinearGradient(x, y, x, y + h);
        lg.addColorStop(0, `rgba(${R * lv * .6 | 0},${G * lv * .6 | 0},${B * lv * .6 | 0},1)`);
        lg.addColorStop(1, `rgba(${R * lv | 0},${G * lv | 0},${B * lv | 0},1)`);
        ex.fillStyle = lg; ex.fillRect(x + 2, y + 2, w - 4, h - 4);
        if (r() < .45) { ex.fillStyle = 'rgba(0,0,0,0.6)'; ex.fillRect(x + 2, y + 2, (w - 4) * (.25 + r() * .25), h - 4); }
      }
    }
    ctx.fillStyle = 'rgba(150,150,145,0.32)'; ctx.fillRect(x - 3, y + h, w + 6, 3);
    const sg = ctx.createLinearGradient(0, y + h, 0, y + h + 30);
    sg.addColorStop(0, 'rgba(10,10,10,0.3)'); sg.addColorStop(1, 'rgba(10,10,10,0)');
    ctx.fillStyle = sg; ctx.fillRect(x + 4, y + h + 3, w - 8, 30);
  }
  return [c, e];
}
function paintCorrugated(r) {
  const S = 256, c = makeCanvas(S, S);
  if (!c) return null;
  const ctx = c.getContext('2d'), big = noiseField(S, r, 4, 3);
  fillNoise(ctx, S, i => {
    const x = i % S, y = (i / S) | 0, rib = Math.sin(x / S * Math.PI * 2 * 18);
    let v = 158 + rib * 34 + big[i] * 40 - 20 + (r() - .5) * 10;
    v *= .7 + .3 * Math.min(1, (S - y) / (S * .25) + .2);
    return [v, v, v];
  });
  for (let i = 0; i < 14; i++) {
    const x = r() * S, y = r() * S * .3, h = 40 + r() * 150, gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(120,62,28,0.45)'); gr.addColorStop(1, 'rgba(120,62,28,0)');
    ctx.fillStyle = gr; ctx.fillRect(x, y, 3 + r() * 6, h);
  }
  ctx.fillStyle = 'rgba(20,20,20,0.5)'; ctx.fillRect(0, 0, S, 5); ctx.fillRect(0, S - 5, S, 5);
  return c;
}
function paintBurlap(r) {
  const S = 128, c = makeCanvas(S, S);
  if (!c) return null;
  const ctx = c.getContext('2d'), big = noiseField(S, r, 4, 2);
  fillNoise(ctx, S, i => {
    const x = i % S, y = (i / S) | 0;
    const v = 150 + 24 * Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) + big[i] * 50 - 25 + (r() - .5) * 26;
    return [v, v * .96, v * .86];
  });
  return c;
}
function paintWood(r) {
  const S = 256, c = makeCanvas(S, S);
  if (!c) return null;
  const ctx = c.getContext('2d'), grain = noiseField(S, r, 8, 3), tone = [r(), r(), r(), r()];
  fillNoise(ctx, S, i => {
    const x = i % S, y = (i / S) | 0, plank = (y / (S / 4)) | 0;
    const g = grain[((y * 4) % S) * S + x];
    const v = 96 + tone[plank] * 26 + Math.sin(x * .045 + g * 9) * 14 + (r() - .5) * 10;
    return [v * 1.08, v * .94, v * .74];
  });
  ctx.fillStyle = 'rgba(10,8,6,0.75)';
  for (let p = 0; p < 4; p++) {
    ctx.fillRect(0, p * S / 4, S, 3);
    ctx.fillRect(10, p * S / 4 + 30, 4, 4); ctx.fillRect(S - 14, p * S / 4 + 30, 4, 4);
  }
  return c;
}
// White paint with worn holes, used as an alpha map for road markings.
function paintWear(r) {
  const S = 256, c = makeCanvas(S, S);
  if (!c) return null;
  const ctx = c.getContext('2d'), big = noiseField(S, r, 8, 3);
  fillNoise(ctx, S, i => { const v = big[i] < .36 || r() < .04 ? 0 : 255; return [v, v, v]; });
  return c;
}
// Far city silhouette band with lit windows and fires, wraps horizontally.
function paintSkyline(r) {
  const W = 2048, H = 256, c = makeCanvas(W, H);
  if (!c) return null;
  const ctx = c.getContext('2d'), blocks = [];
  ctx.clearRect(0, 0, W, H);
  let x = 0;
  while (x < W) {
    const w = 18 + r() * 70, h = 26 + r() * r() * 200, shade = 12 + r() * 12;
    const wins = [];
    for (let wy = H - h + 6; wy < H - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) if (r() < .07) wins.push(wx, wy, 140 + r() * 115);
    blocks.push({x, w, h, shade, wins, antenna: r() < .18 ? 8 + r() * 26 : 0});
    x += w * (.55 + r() * .5);
  }
  const fires = [];
  for (let i = 0; i < 5; i++) fires.push([r() * W, 18 + r() * 40]);
  for (const ox of [-W, 0, W]) {
    for (const b of blocks) {
      const s = b.shade | 0;
      ctx.fillStyle = `rgb(${s},${s + 3},${s + 8})`; ctx.fillRect(b.x + ox, H - b.h, b.w, b.h);
      if (b.antenna) { ctx.fillRect(b.x + ox + b.w * .5, H - b.h - b.antenna, 2, b.antenna); }
      for (let k = 0; k < b.wins.length; k += 3) { const v = b.wins[k + 2] | 0; ctx.fillStyle = `rgba(255,${v},${v * .55 | 0},0.9)`; ctx.fillRect(b.wins[k] + ox, b.wins[k + 1], 2, 3); }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fr] of fires) {
      const gr = ctx.createRadialGradient(fx + ox, H, 0, fx + ox, H, fr * 2);
      gr.addColorStop(0, 'rgba(255,120,40,0.55)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = gr; ctx.fillRect(fx + ox - fr * 2, H - fr * 2, fr * 4, fr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}
function paintSign(text) {
  const c = makeCanvas(1024, 128);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#202e30'; ctx.fillRect(0, 0, 1024, 128);
  ctx.strokeStyle = '#ab9a6d'; ctx.lineWidth = 5; ctx.strokeRect(6, 6, 1012, 116);
  ctx.font = 'bold 56px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ded0a6'; ctx.fillText(text, 512, 68);
  return c;
}
function makeTextures(seed) {
  const r = makeRng(seed), [facade, facadeLit] = paintFacade(r);
  return {
    asphalt: toTexture(paintAsphalt(r)), concrete: toTexture(paintConcrete(r)), facade: toTexture(facade), facadeLit: toTexture(facadeLit),
    corrugated: toTexture(paintCorrugated(r)), burlap: toTexture(paintBurlap(r)), wood: toTexture(paintWood(r)), wear: toTexture(paintWear(r)),
    skyline: toTexture(paintSkyline(r)),
  };
}

// ---------------------------------------------------------------------------
// Static geometry merger: every add() bakes a transformed template into the
// bucket of its material. A parent matrix stack lets compound props (cars,
// the tower) be authored in local space.
// ---------------------------------------------------------------------------
function createMerger() {
  const groups = new Map(), stack = [new THREE.Matrix4()];
  const out = new THREE.Matrix4(), local = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), eu = new THREE.Euler();
  const vp = new THREE.Vector3(), vs = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
  function bucket(key) {
    let g = groups.get(key);
    if (!g) { g = {p: [], n: [], u: [], c: [], i: []}; groups.set(key, g); }
    return g;
  }
  function matrix(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
    eu.set(rx, ry, rz, order); q.setFromEuler(eu); vp.set(x, y, z); vs.set(sx, sy, sz);
    local.compose(vp, q, vs);
    return out.multiplyMatrices(stack[stack.length - 1], local);
  }
  function push(x, y, z, rx = 0, ry = 0, rz = 0) {
    stack.push(matrix(x, y, z, 1, 1, 1, rx, ry, rz, 'YXZ').clone());
  }
  function pop() { if (stack.length > 1) stack.pop(); }
  // uv: null keeps template UVs; {box:[w,h,d], tile:[u,v], off} maps box faces in
  // meters; {scale:[u,v], off} scales template UVs.
  function add(key, geo, mat, color, uv) {
    const g = bucket(key), P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, base = g.p.length / 3;
    nm.getNormalMatrix(mat);
    if (color == null) col.setRGB(1, 1, 1); else if (color.isColor) col.copy(color); else col.setHex(color);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mat); g.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); g.n.push(v.x, v.y, v.z);
      let a = U ? U.getX(i) : 0, b = U ? U.getY(i) : 0;
      if (uv) {
        if (uv.box) {
          const f = (i / 4) | 0, [bw, bh, bd] = uv.box;
          a *= (f < 2 ? bd : bw) / uv.tile[0]; b *= (f < 2 ? bh : f < 4 ? bd : bh) / uv.tile[1];
        } else { a *= uv.scale[0]; b *= uv.scale[1]; }
        if (uv.off) { a += uv.off[0]; b += uv.off[1]; }
      }
      g.u.push(a, b); g.c.push(col.r, col.g, col.b);
    }
    if (geo.index) { const I = geo.index.array; for (let k = 0; k < I.length; k++) g.i.push(base + I[k]); }
    else for (let k = 0; k < P.count; k++) g.i.push(base + k);
  }
  function build(materials, scene) {
    const meshes = {};
    for (const [key, g] of groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      geo.setIndex(g.i);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.name = 'world-' + key; mesh.matrixAutoUpdate = false;
      scene.add(mesh); meshes[key] = mesh;
    }
    groups.clear();
    return meshes;
  }
  return {matrix, push, pop, add, build};
}

class Helix extends THREE.Curve {
  constructor(turns, radius) { super(); this.turns = turns; this.radius = radius; }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns, rad = this.radius * (1 + .1 * Math.sin(a * .5));
    return target.set(t * 2 - 1, Math.sin(a) * rad, Math.cos(a) * rad);
  }
}

// ---------------------------------------------------------------------------
// Shaders (sky, light beams, rain, embers). All handle fog themselves.
// ---------------------------------------------------------------------------
const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;
const SKY_FRAG = `
uniform vec3 uTop, uBand, uFog, uSunDir, uSunColor, uMoonDir, uMoonColor, uGlow, uCloudColor;
uniform float uSunAlpha, uMoonAlpha, uStars, uFlash, uCloud, uTime;
varying vec3 vDir;
float hash3(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
float hash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float e = d.y, eu = max(e, 0.0);
  vec3 col = mix(uBand, uTop, smoothstep(0.0, 0.55, pow(eu, 0.7)));
  vec2 hd = normalize(d.xz + vec2(1e-5));
  float az = max(dot(hd, vec2(-0.3489, -0.9372)), 0.0);
  col += uGlow * pow(az, 4.0) * exp(-eu * 10.0);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSunAlpha * (pow(sd, 1400.0) * 8.0 * step(0.0, e) + pow(sd, 16.0) * 0.45 + pow(sd, 3.0) * 0.18);
  float md = max(dot(d, uMoonDir), 0.0);
  col += uMoonColor * uMoonAlpha * (smoothstep(0.99945, 0.99965, md) * 1.8 + pow(md, 260.0) * 0.22 + pow(md, 18.0) * 0.05);
  vec3 sg = d * 170.0; float h = hash3(floor(sg));
  float star = step(0.9965, h) * smoothstep(0.42, 0.0, length(fract(sg) - 0.5));
  star *= 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 90.0);
  col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.02, 0.25, e);
  if(e > 0.0){
    vec2 uv = d.xz / (e + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.005);
    float n = fbm(uv);
    float cover = smoothstep(0.62 - uCloud * 0.42, 0.98 - uCloud * 0.3, n) * smoothstep(0.0, 0.18, e);
    vec3 cc = uCloudColor * (0.75 + 0.5 * n) + uFlash * vec3(0.7, 0.75, 0.95) * n;
    col = mix(col, cc, cover * (0.25 + 0.7 * uCloud));
  }
  col += uFlash * vec3(0.22, 0.25, 0.34) * (0.3 + 0.7 * eu);
  col = mix(uFog, col, smoothstep(-0.02, 0.1, e));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const BEAM_VERT = `
varying float vFade; varying vec3 vN; varying vec3 vView; varying vec3 vCol;
void main(){
  vFade = uv.y;
  #ifdef USE_COLOR
  vCol = color;
  #else
  vCol = vec3(1.0);
  #endif
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz; vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = `
uniform vec3 uColor; uniform float uIntensity, uFogDensity;
varying float vFade; varying vec3 vN; varying vec3 vView; varying vec3 vCol;
void main(){
  float dist = length(vView);
  float edge = abs(dot(normalize(vN), vView / dist));
  // Clamp: with MSAA the varying is extrapolated past the triangle and pow(<0) is NaN,
  // which the bloom blur would smear over the whole frame.
  float a = pow(clamp(vFade, 0.0, 1.0), 1.4) * edge * edge * uIntensity * exp(-pow(dist * uFogDensity * 0.5, 2.0));
  gl_FragColor = vec4(uColor * vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const RAIN_VERT = `
attribute vec4 aDrop;
uniform float uTime, uSpeed, uLen, uWidth, uFogDensity;
uniform vec2 uWind;
varying float vAlpha; varying float vY;
const float AREA = ${RAIN_AREA.toFixed(1)}; const float HEIGHT = ${RAIN_HEIGHT.toFixed(1)};
void main(){
  float fall = uTime * uSpeed * (0.8 + 0.4 * aDrop.w);
  vec3 vel = normalize(vec3(uWind.x, -1.0, uWind.y));
  float yMin = cameraPosition.y - HEIGHT * 0.3;
  vec3 p;
  p.y = yMin + mod(aDrop.y - fall - yMin, HEIGHT);
  p.x = cameraPosition.x + mod(aDrop.x + uWind.x * fall - cameraPosition.x + AREA * 0.5, AREA) - AREA * 0.5;
  p.z = cameraPosition.z + mod(aDrop.z + uWind.y * fall - cameraPosition.z + AREA * 0.5, AREA) - AREA * 0.5;
  vec3 toCam = cameraPosition - p; float dist = max(length(toCam), 0.001);
  vec3 side = normalize(cross(vel, toCam / dist) + vec3(1e-4, 0.0, 1e-4));
  vec3 wp = p + side * (position.x * uWidth) - vel * (position.y * uLen * (0.7 + 0.6 * aDrop.w));
  vY = wp.y;
  vAlpha = (1.0 - position.y) * smoothstep(0.4, 2.0, dist) * (1.0 - smoothstep(AREA * 0.32, AREA * 0.5, dist)) * exp(-pow(dist * uFogDensity, 2.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const RAIN_FRAG = `
uniform float uOpacity, uFlash; uniform vec3 uColor;
varying float vAlpha; varying float vY;
void main(){
  if(vY < 0.0) discard;
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 2.0), vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const EMBER_VERT = `
attribute float aSeed;
uniform float uTime, uFogDensity, uScale;
varying float vA;
void main(){
  float life = fract(uTime * (0.28 + 0.22 * fract(aSeed * 7.31)) + aSeed);
  float a = aSeed * 43.0 + uTime * (1.2 + fract(aSeed * 3.7));
  vec3 p = position;
  p.x += sin(a) * 0.18 * life + sin(aSeed * 91.0) * 0.45 * life;
  p.z += cos(a * 1.3) * 0.18 * life + cos(aSeed * 57.0) * 0.45 * life;
  p.y += life * life * 0.6 + life * 2.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = max(0.1, -mv.z);
  vA = (1.0 - life) * smoothstep(0.0, 0.06, life) * exp(-pow(d * uFogDensity, 2.0));
  gl_PointSize = clamp(uScale * 0.06 * (1.0 - 0.5 * life) / d, 1.0, 12.0);
  gl_Position = projectionMatrix * mv;
}`;
const EMBER_FRAG = `
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0;
  if(r > 1.0) discard;
  gl_FragColor = vec4(vec3(1.0, 0.5, 0.16) * (1.0 - r) * vA * 2.5, 1.0);
  #include <colorspace_fragment>
}`;
function beamMaterial(color, intensity, vertexColors) {
  return new THREE.ShaderMaterial({
    uniforms: {uColor: {value: new THREE.Color(color)}, uIntensity: {value: intensity}, uFogDensity: {value: .0185}},
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, vertexColors,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
const noRaycast = () => {};

// ---------------------------------------------------------------------------
export function buildWorld(scene, options = {}) {
  const r = makeRng(9147);        // layout: colliders and solid props
  const ru = makeRng(5521);       // cosmetics: tints, UV offsets, debris
  const T = makeTextures(4242);
  const colliders = [], props = [], M = createMerger();
  scene.background = new THREE.Color(0x101e28);
  scene.fog = new THREE.FogExp2(0x152b33, .0185);

  const TPL = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(.5, .5, 1, 10),
    cone: new THREE.ConeGeometry(.5, 1, 7),
    bag: new THREE.SphereGeometry(.5, 8, 5),
    tire: new THREE.TorusGeometry(.5, .2, 6, 12),
    plane: new THREE.PlaneGeometry(1, 1),
    beam: new THREE.CylinderGeometry(.03, 1, 1, 14, 1, true).translate(0, -.5, 0).rotateX(-Math.PI / 2),
    coil: new THREE.TubeGeometry(new Helix(8, .32), 72, .014, 3, false),
  };
  const TILE = {concrete: [3, 3], facade: [16, 16], container: [2.4, 3.4], wood: [1.7, 1.7], paint: [.6, 2.5]};
  const std = o => new THREE.MeshStandardMaterial(Object.assign({vertexColors: true}, o));
  const mats = {
    slab: std({map: T.concrete, bumpMap: T.concrete, bumpScale: .5, roughness: .93}),
    concrete: std({map: T.concrete, bumpMap: T.concrete, bumpScale: .8, roughness: .92}),
    facade: std({map: T.facade, emissiveMap: T.facadeLit, emissive: T.facadeLit ? 0xffffff : 0x000000, emissiveIntensity: 1, roughness: .9}),
    container: std({map: T.corrugated, bumpMap: T.corrugated, bumpScale: 1.2, roughness: .7, metalness: .25}),
    wood: std({map: T.wood, roughness: .9}),
    sandbag: std({map: T.burlap, bumpMap: T.burlap, bumpScale: 1, roughness: 1}),
    paint: std({alphaMap: T.wear, alphaTest: .45, roughness: .75}),
    misc: std({roughness: .88}),
    metal: std({roughness: .5, metalness: .55}),
    car: std({roughness: .55, metalness: .35}),
    glass: std({roughness: .12, metalness: .6, color: 0x9fb0b8}),
    glow: new THREE.MeshBasicMaterial({vertexColors: true}),
    beam: beamMaterial(0xffffff, .16, true),
  };

  const box = (key, x, y, z, w, h, d, ry = 0, rz = 0, color = null, rx = 0) => {
    const tile = TILE[key];
    M.add(key, TPL.box, M.matrix(x, y, z, w, h, d, rx, ry, rz), color, tile ? {box: [w, h, d], tile, off: [ru(), ru()]} : null);
  };
  const cylinder = (key, x, y, z, rad, h, rx = 0, rz = 0, color = null) => {
    const tile = TILE[key];
    M.add(key, TPL.cyl, M.matrix(x, y, z, rad * 2, h, rad * 2, rx, 0, rz), color, tile ? {scale: [Math.PI * rad * 2 / tile[0], h / tile[1]]} : null);
  };
  const shape = (key, tpl, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, color = null, uv = null) => M.add(key, tpl, M.matrix(x, y, z, sx, sy, sz, rx, ry, rz), color, uv);
  const collision = (x, z, hx, hz, height = 3.2) => { colliders.push({x, z, hx, hz, height}); };
  // A rotated rectangle (long axis along heading) becomes a few near-square
  // AABBs so diagonal props do not grow invisible corners.
  function rotatedCollider(x, z, halfW, halfL, heading, height) {
    const n = Math.max(1, Math.round(halfL / halfW)), s = Math.sin(heading), c = Math.cos(heading), seg = halfL / n;
    for (let k = 0; k < n; k++) {
      const t = -halfL + seg * (2 * k + 1);
      collision(x + s * t, z + c * t, Math.abs(c) * halfW + Math.abs(s) * seg, Math.abs(s) * halfW + Math.abs(c) * seg, height);
    }
  }
  const tone = (hex, spread = .08) => { const c = new THREE.Color(hex); const k = 1 + (ru() - .5) * spread * 2; return c.multiplyScalar(k); };

  // ---- Lights (fixed count: lights are never added or removed later, so
  // weather and time-of-day changes never trigger shader recompiles).
  const hemi = new THREE.HemisphereLight(0xa1d5da, 0x34403b, 2.0); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x94c9cf, 2.0); moon.position.set(-18, 35, 15); scene.add(moon);
  const sun = new THREE.DirectionalLight(0xe7a26f, .85); sun.position.set(25, 8, -50); scene.add(sun);
  const lightning = new THREE.DirectionalLight(0xcfdcff, 0); lightning.position.set(10, 60, -20); scene.add(lightning);

  // ---- Ground: asphalt everywhere, the highway runs north-south through the
  // outpost (|x| < 5.8); concrete yard slabs fill the rest of the arena.
  if (T.asphalt) T.asphalt.repeat.set(250 / 7, 250 / 7);
  const groundMat = new THREE.MeshStandardMaterial({map: T.asphalt, bumpMap: T.asphalt, bumpScale: .9, roughness: .92});
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; ground.name = 'world-ground'; scene.add(ground);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) for (let row = 0; row < 11; row++) {
    const x = side * (5.8 + 6.64 * (i + .5)), z = -39.6 + 7.2 * (row + .5), w = 6.58, d = 7.14;
    M.add('slab', TPL.box, M.matrix(x, -.03, z, w, .06, d), tone(0x7a807c, .07), {box: [w, .06, d], tile: [w, d], off: [ru(), ru()]});
  }
  const white = 0xd9d4c4, yellow = 0xc9a24a;
  for (let z = -110; z <= 110; z += 6) if (Math.abs(Math.abs(z) - 39.4) > 1.6) box('paint', 0, -.013, z, .16, .012, 3, 0, 0, white);
  for (const x of [-5.2, 5.2]) box('paint', x, -.013, 0, .14, .012, 220, 0, 0, yellow);
  for (let x = -4.5; x <= 4.51; x += 1) box('paint', x, -.012, -30.5, .5, .012, 3, 0, 0, white);
  box('paint', 0, -.012, -28.4, 10, .012, .35, 0, 0, white);

  // ---- Perimeter: low wall, wire fence and concertina coils on top.
  const fenceMetal = 0x4c5856, wireMetal = 0x7d8784;
  for (const sign of [-1, 1]) {
    box('concrete', sign * 39.4, .35, 0, .8, .7, 79, 0, 0, 0x6c7472);
    box('concrete', 0, .35, sign * 39.4, 79, .7, .8, 0, 0, 0x6c7472);
    for (let p = -39; p <= 39; p += 3) {
      box('metal', sign * 39.4, 2.1, p, .08, 3.7, .08, 0, 0, fenceMetal);
      box('metal', p, 2.1, sign * 39.4, .08, 3.7, .08, 0, 0, fenceMetal);
    }
    for (let h = 1; h <= 3.8; h += .55) {
      box('metal', sign * 39.4, h, 0, .025, .025, 78, 0, 0, wireMetal);
      box('metal', 0, h, sign * 39.4, 78, .025, .025, 0, 0, wireMetal);
    }
    for (let p = -38; p <= 38; p += 2) {
      shape('metal', TPL.coil, sign * 39.4, 4.15, p, 1, 1, 1, 0, Math.PI / 2, 0, wireMetal);
      shape('metal', TPL.coil, p, 4.15, sign * 39.4, 1, 1, 1, 0, 0, 0, wireMetal);
    }
  }

  // ---- Street lamps: one of them flickers badly.
  const lamps = [], lampHeadColor = new THREE.Color(0xffc47a).multiplyScalar(2.2);
  function lightPole(x, z, facing = 1, flicker = false) {
    cylinder('metal', x, 4.25, z, .12, 8.5, 0, 0, 0x34413f);
    collision(x, z, .14, .14, 8.5);
    box('metal', x + facing * .7, 8.4, z, 1.6, .12, .12, 0, 0, 0x34413f);
    box('misc', x + facing * 1.35, 8.3, z, .8, .15, .5, 0, 0, 0x151b1d);
    box('misc', x, 1.25, z, .25, .7, .25, 0, 0, 0xac9153);
    const hx = x + facing * 1.35;
    const light = new THREE.PointLight(0xffb66d, 23, 16, 1.7); light.position.set(hx, 7.9, z); scene.add(light);
    const lamp = {light, base: 23, flicker, seed: lamps.length * 3.7 + 1, head: null, cone: null};
    if (flicker) {
      const headMat = new THREE.MeshBasicMaterial({color: lampHeadColor.clone()});
      const head = new THREE.Mesh(TPL.box, headMat); head.scale.set(.65, .05, .4); head.position.set(hx, 8.2, z); scene.add(head);
      const coneMat = beamMaterial(0xffc890, .16, false);
      const cone = new THREE.Mesh(TPL.beam, coneMat); cone.position.set(hx, 8.18, z); cone.rotation.x = Math.PI / 2; cone.scale.set(3.1, 3.1, 8.2);
      cone.raycast = noRaycast; scene.add(cone);
      lamp.head = headMat; lamp.cone = coneMat;
    } else {
      box('glow', hx, 8.2, z, .65, .05, .4, 0, 0, lampHeadColor);
      shape('beam', TPL.beam, hx, 8.18, z, 3.1, 3.1, 8.2, Math.PI / 2, 0, 0, 0xffc890);
    }
    lamps.push(lamp);
  }
  lightPole(-29, -24); lightPole(29, -24, -1, true); lightPole(-29, 24); lightPole(29, 24, -1);

  // ---- Shipping containers (corrugated texture, tinted per container).
  function container(x, z, color, w = 9, d = 3.6, y = 0, ry = 0) {
    box('container', x, y + 1.7, z, w, 3.4, d, ry, 0, color);
    box('metal', x, y + 3.42, z, w + .1, .1, d + .1, ry, 0, 0x2c3a3c);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = x + Math.cos(ry) * sx * (w / 2 - .06) + Math.sin(ry) * sz * (d / 2 - .06), cz = z - Math.sin(ry) * sx * (w / 2 - .06) + Math.cos(ry) * sz * (d / 2 - .06);
      box('metal', cx, y + 1.7, cz, .16, 3.42, .16, ry, 0, 0x2a3436);
    }
    if (ry === 0) for (const side of [-1, 1]) {
      box('metal', x + w / 2 + .04, y + 1.7, z + side * d / 4, .09, 3.2, .06, 0, 0, 0x283b3d);
      box('metal', x + w / 2 + .09, y + 1.6, z + side * d / 4, .06, 1.8, .06, 0, 0, wireMetal);
    }
    box('misc', x - w / 2 + .4, y + 1.7, z + d / 2 + .07, .22, 1.2, .015, ry, 0, 0xac9153);
  }
  container(-22, -16, 0x4f9aa0, 10, 3.6); collision(-22, -16, 5.15, 1.93, 3.47);
  container(22, -25, 0xb0683e, 10, 3.6); container(22.3, -25.2, 0x5f7f9a, 9, 3.4, 3.47, .05); collision(22, -25, 5.15, 1.93, 6.95);
  container(29, 9, 0x4f9aa0, 7, 3.6); collision(29, 9, 3.65, 1.93, 3.47);

  // ---- Supply crates.
  function crate(x, z, size = 1.7, y = 0) {
    box('wood', x, y + size / 2, z, size, size, size, 0, 0, tone(0xe8e0cc, .06));
    if (y === 0) collision(x, z, size / 2 + .03, size / 2 + .03, size + .02);
    else {
      const base = colliders.find(c => c.x === x && c.z === z);
      if (base) base.height = Math.max(base.height, y + size + .02);
    }
    for (const side of [-1, 1]) {
      box('misc', x + side * size * .37, y + size / 2, z, size * .09, size + .04, size + .04, 0, 0, 0x59624b);
      box('misc', x, y + size / 2, z + side * size * .37, size + .04, size + .04, size * .08, 0, 0, 0x59624b);
    }
  }
  crate(-11, -5); crate(-12.6, -7, 1.45); crate(-11, -5, 1.25, 1.7);
  crate(12, 4, 1.6); crate(14, 4, 1.6); crate(14, 4, 1.3, 1.6);
  crate(-27, 17, 1.9); crate(-29, 17, 1.9); crate(23, 24, 1.6);
  crate(-6.8, 4.2, 1.0);

  // ---- Jersey barriers.
  function barrier(x, z, rotation = 0) {
    box('concrete', x, .55, z, 5, 1.1, .85, rotation, 0, 0x9ca29c);
    box('concrete', x, .12, z, 5.3, .24, 1.2, rotation, 0, 0x8c928c);
    for (let i = -2; i <= 2; i++) {
      const dx = i * .83, sx = x + Math.cos(rotation) * dx, sz = z - Math.sin(rotation) * dx;
      box('misc', sx + Math.sin(rotation) * .44, .72, sz + Math.cos(rotation) * .44, .42, .42, .025, rotation, -.25, i % 2 ? 0xac9153 : 0x151f22);
    }
    if (Math.abs(rotation) < .1) collision(x, z, 2.65, .6, 1.1); else collision(x, z, .6, 2.65, 1.1);
  }
  barrier(-15, 11); barrier(14, -9); barrier(-5, -24); barrier(8, 27); barrier(-30, -2, Math.PI / 2);

  // ---- Abandoned cargo truck.
  {
    const tx = -22, tz = 27, olive = 0x59624b;
    box('misc', tx, .8, tz, 2.65, .4, 7.6, 0, 0, 0x151f22);
    box('car', tx, 1.6, tz - 2.4, 2.8, 2.2, 2.2, 0, 0, olive);
    box('car', tx, 1.2, tz - 3.6, 2.7, 1.3, 1.0, 0, 0, olive);
    box('glass', tx, 2.09, tz - 3.52, 1.98, .58, .04);
    box('metal', tx, 2.1, tz - 3.57, .05, .66, .03, 0, 0, 0x283b3d);
    box('car', tx, 1.6, tz + 1.5, 2.8, 1.5, 4.6, 0, 0, olive);
    box('wood', tx, 2.2, tz + 1.5, 2.7, .2, 4.4);
    box('misc', tx, 2.9, tz + 1.4, 2.75, 1.3, 4.5, 0, 0, 0x3e4a44);
    for (const z of [-2.6, 1.5, 2.8]) for (const side of [-1, 1]) {
      cylinder('misc', tx + side * 1.4, .65, tz + z, .62, .3, 0, Math.PI / 2, 0x121416);
      cylinder('metal', tx + side * 1.56, .65, tz + z, .27, .04, 0, Math.PI / 2, 0x3a4644);
    }
    box('glow', tx - .88, 1.1, tz - 4.11, .42, .3, .05, 0, 0, 0x6a5a3a);
    box('glow', tx + .88, 1.1, tz - 4.11, .42, .3, .05, 0, 0, 0x6a5a3a);
    collision(tx, tz, 1.65, 4.2, 3.55);
  }

  // ---- Burning barrels: flame cones, a flickering light and rising embers.
  const flameMat = new THREE.MeshBasicMaterial({color: new THREE.Color(0xffa03f).multiplyScalar(1.6), transparent: true, opacity: .9, depthWrite: false});
  const flameCoreMat = new THREE.MeshBasicMaterial({color: new THREE.Color(0xffe2a3).multiplyScalar(2.2)});
  const flameGeo = new THREE.ConeGeometry(.32, .9, 6), coreGeo = new THREE.ConeGeometry(.19, .55, 5), barrels = [];
  function fireBarrel(x, z) {
    cylinder('misc', x, .65, z, .44, 1.3, 0, 0, 0x70543c); collision(x, z, .48, .48, 1.32);
    for (const y of [.22, 1.08]) cylinder('metal', x, y, z, .455, .08, 0, 0, 0x283b3d);
    cylinder('misc', x, 1.305, z, .35, .03, 0, 0, 0x0c0d0e);
    const flame = new THREE.Mesh(flameGeo, flameMat); flame.position.set(x, 1.68, z); flame.raycast = noRaycast; scene.add(flame);
    const core = new THREE.Mesh(coreGeo, flameCoreMat); core.position.set(x, 1.48, z); core.raycast = noRaycast; scene.add(core);
    const light = new THREE.PointLight(0xff7731, 10, 11, 1.6); light.position.set(x, 2, z); scene.add(light);
    props.push({type: 'fire', mesh: flame, core, light, phase: r() * 10});
    barrels.push([x, z]);
  }
  fireBarrel(-8, -15); fireBarrel(18, 17); fireBarrel(-5.5, 5.8);

  // ---- Guardhouse and sector signage beyond the north-west edge.
  box('concrete', -32, 2.4, -30, 6.2, 4.8, 6, 0, 0, 0xa0a6a0); collision(-32, -30, 3.1, 3, 5.02);
  box('misc', -32, 4.9, -30, 6.7, .24, 6.6, 0, 0, 0x151f22);
  box('misc', -32, 2.8, -26.96, 3.5, 1.4, .04, 0, 0, 0x28555a);
  box('metal', -32, 2.8, -26.91, .1, 1.5, .06, 0, 0, 0x283b3d);
  box('misc', -29.6, 1.5, -26.94, .9, 3, .04, 0, 0, 0x151f22);
  box('glow', -28.87, 2.7, -29.2, .04, .9, 1.5, 0, 0, 0x8a6a3c);
  function sign(text, x, y, z, w, h) {
    const tex = toTexture(paintSign(text), false);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({map: tex, color: tex ? 0xffffff : 0x202e30}));
    mesh.position.set(x, y, z); scene.add(mesh);
  }
  sign('КАРАНТИН  /  СЕКТОР 07', 0, 6.8, -39.1, 14, 1.75);
  box('metal', -7.7, 3.7, -39.1, .22, 7.4, .22, 0, 0, 0x283b3d); box('metal', 7.7, 3.7, -39.1, .22, 7.4, .22, 0, 0, 0x283b3d);
  sign('07', -32, 4.1, -26.85, 1.8, .62);

  // ---- The outpost: sandbag arcs around the compound centred on (0,7), with
  // gaps for the road (airdrop lands at (0,3)) and both flanks, plus
  // concertina wire in front of the northern line.
  const OX = 0, OZ = 7, deg = Math.PI / 180;
  const arcPoint = (R, a) => [OX + R * Math.sin(a), OZ - R * Math.cos(a)];
  function sandbags(R, a0, a1, courses = 4) {
    const len = R * Math.abs(a1 - a0), n = Math.max(2, Math.round(len / .6)), step = (a1 - a0) / n;
    for (let k = 0; k < courses; k++) {
      const y = .13 + k * .235, rows = k === courses - 1 ? [0] : [-1, 1];
      for (const row of rows) for (let i = 0; i < n; i++) {
        const t = i + .5 + (k % 2 ? .5 : 0);
        if (t > n) continue;
        const a = a0 + step * t, [x, z] = arcPoint(R + row * .19, a);
        M.add('sandbag', TPL.bag, M.matrix(x, y, z, .66 + ru() * .06, .27, .4, (ru() - .5) * .08, -a + (ru() - .5) * .14, (ru() - .5) * .08),
          tone([0x8f8466, 0x7a7656, 0x857d6a][(ru() * 3) | 0], .1), {scale: [2, 1.4]});
      }
    }
    const m = Math.max(1, Math.ceil(len / 1.0));
    for (let j = 0; j < m; j++) {
      const a = a0 + (a1 - a0) * (j + .5) / m, [x, z] = arcPoint(R, a);
      rotatedCollider(x, z, .42, len / m / 2, Math.PI / 2 - a, 1.0);
    }
  }
  function wireLine(R, a0, a1) {
    const len = R * Math.abs(a1 - a0), n = Math.max(1, Math.ceil(len / 2)), seg = len / n;
    for (let j = 0; j < n; j++) {
      const a = a0 + (a1 - a0) * (j + .5) / n, [x, z] = arcPoint(R, a);
      shape('metal', TPL.coil, x, .36, z, seg / 2, 1, 1, 0, -a, 0, wireMetal);
      const [px, pz] = arcPoint(R, a0 + (a1 - a0) * j / n);
      box('wood', px, .45, pz, .07, .9, .07);
      rotatedCollider(x, z, .35, seg / 2, Math.PI / 2 - a, .85);
    }
    const [px, pz] = arcPoint(R, a1); box('wood', px, .45, pz, .07, .9, .07);
  }
  for (const s of [-1, 1]) {
    sandbags(9, s * 18 * deg, s * 62 * deg);
    sandbags(11, s * 118 * deg, s * 160 * deg);
    wireLine(10.6, s * 16 * deg, s * 60 * deg);
  }
  // Ammo boxes on the front sandbags and a generator inside the compound.
  for (const [a, R] of [[-40, 9], [30, 9], [52, 9]]) {
    const [x, z] = arcPoint(R, a * deg);
    box('misc', x, 1.06, z, .5, .24, .28, -a * deg, 0, 0x4b5640);
  }
  box('misc', 3.2, .45, 15.6, 1.2, .9, .7, 0, 0, 0x5d6648); box('metal', 3.2, .93, 15.6, 1.25, .08, .75, 0, 0, 0x2c3436);
  box('metal', 2.75, 1.15, 15.45, .08, .45, .08, 0, 0, 0x2c3436); collision(3.2, 15.6, .65, .4, .95);

  // ---- Searchlight tower behind the compound.
  const TX = 12.5, TZ = 18.5, TH = 8, steel = 0x3a4644;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder('metal', TX + sx * .95, TH / 2, TZ + sz * .95, .08, TH, 0, 0, steel);
  for (let lv = 0; lv < 3; lv++) {
    const y0 = lv * TH / 3 + .2, y1 = (lv + 1) * TH / 3 - .1, dy = y1 - y0, len = Math.hypot(1.9, dy), ang = Math.atan2(dy, 1.9), ym = (y0 + y1) / 2;
    for (const s of [-1, 1]) {
      box('metal', TX, ym, TZ + s * .95, len, .06, .06, 0, ang, steel); box('metal', TX, ym, TZ + s * .95, len, .06, .06, 0, -ang, steel);
      box('metal', TX + s * .95, ym, TZ, len, .06, .06, Math.PI / 2, ang, steel); box('metal', TX + s * .95, ym, TZ, len, .06, .06, Math.PI / 2, -ang, steel);
      box('metal', TX, y1, TZ + s * .95, 1.95, .07, .07, 0, 0, steel); box('metal', TX + s * .95, y1, TZ, .07, .07, 1.95, 0, 0, steel);
    }
  }
  box('metal', TX, TH + .08, TZ, 2.8, .16, 2.8, 0, 0, 0x2c3436);
  for (const s of [-1, 1]) {
    box('metal', TX, TH + 1.0, TZ + s * 1.38, 2.8, .06, .06, 0, 0, steel); box('metal', TX + s * 1.38, TH + 1.0, TZ, .06, .06, 2.8, 0, 0, steel);
    box('metal', TX, TH + .55, TZ + s * 1.38, 2.8, .05, .05, 0, 0, steel); box('metal', TX + s * 1.38, TH + .55, TZ, .05, .05, 2.8, 0, 0, steel);
    for (const t of [-1, 1]) box('metal', TX + s * 1.38, TH + .55, TZ + t * 1.38, .06, 1.0, .06, 0, 0, steel);
  }
  for (const s of [-1, 1]) cylinder('metal', TX + s * .25, TH / 2, TZ + 1.08, .03, TH, 0, 0, steel);
  for (let y = .35; y < TH; y += .35) box('metal', TX, y, TZ + 1.08, .5, .03, .03, 0, 0, steel);
  box('metal', TX, TH + .45, TZ, .3, .6, .3, 0, 0, 0x2c3436);
  box('metal', TX + 1.2, TH + 1.6, TZ - 1.2, .05, 3.2, .05, 0, 0, steel);
  collision(TX, TZ, 1.12, 1.12, TH + .2);
  const searchHead = new THREE.Group(); searchHead.position.set(TX, TH + 1.05, TZ); scene.add(searchHead);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.42, .48, .8, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({color: 0x2c3436, roughness: .5, metalness: .6}));
  searchHead.add(drum);
  const lensMat = new THREE.MeshBasicMaterial({color: new THREE.Color(0xeef4ff).multiplyScalar(2.4)});
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.4, 16), lensMat); lens.position.z = .41; searchHead.add(lens);
  const searchTarget = new THREE.Object3D(); searchTarget.position.set(0, 0, 0); scene.add(searchTarget);
  const searchLight = new THREE.SpotLight(0xe8f0ff, 45, 70, .17, .45, 1); searchLight.position.copy(searchHead.position); searchLight.target = searchTarget; scene.add(searchLight);
  const searchBeamMat = beamMaterial(0xdfe8ff, .3, false);
  const searchBeam = new THREE.Mesh(TPL.beam, searchBeamMat); searchBeam.position.copy(searchHead.position); searchBeam.raycast = noRaycast; scene.add(searchBeam);
  const beaconMat = new THREE.MeshBasicMaterial({color: new THREE.Color(0xff2a1a).multiplyScalar(2)});
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), beaconMat); beacon.position.set(TX + 1.2, TH + 3.25, TZ - 1.2); scene.add(beacon);

  // ---- Wrecked cars, a few with dim headlights still burning.
  function car(x, z, heading, color, o = {}) {
    const burnt = !!o.burnt, body = burnt ? 0x2a221d : color, lights = o.lights || 0;
    M.push(x, o.flipped ? 1.56 : (o.sink || 0), z, o.pitch || 0, heading, (o.flipped ? Math.PI : 0) + (o.roll || 0));
    box('car', 0, .62, 0, 1.78, .62, 4.3, 0, 0, body);
    box('car', 0, .95, 1.45, 1.7, .1, 1.3, 0, 0, body);
    box(burnt ? 'misc' : 'glass', 0, 1.2, -.25, 1.6, .5, 2.1, 0, 0, burnt ? 0x101010 : null);
    box('car', 0, 1.5, -.3, 1.62, .1, 1.85, 0, 0, body);
    box('misc', 0, .45, 2.18, 1.82, .22, .12, 0, 0, 0x1b1d1f); box('misc', 0, .45, -2.18, 1.82, .22, .12, 0, 0, 0x1b1d1f);
    [[-.84, 1.35], [.84, 1.35], [-.84, -1.35], [.84, -1.35]].forEach(([sx, sz], i) => {
      if (i === o.missing) return;
      cylinder('misc', sx, .36, sz, .36, .26, 0, Math.PI / 2, 0x121314);
      cylinder('metal', sx * 1.08, .36, sz, .16, .06, 0, Math.PI / 2, 0x50595a);
    });
    for (const sx of [-.6, .6]) {
      box(lights ? 'glow' : 'misc', sx, .72, 2.16, .32, .16, .05, 0, 0, lights ? new THREE.Color(0xffe2a0).multiplyScalar(.5 + lights) : 0x55595a);
      box(lights ? 'glow' : 'misc', sx, .76, -2.16, .3, .12, .05, 0, 0, lights ? 0x5a0d08 : 0x2a1515);
      if (lights && !o.flipped) shape('beam', TPL.beam, sx, .72, 2.2, 1.7, 1.2, 9, .09, 0, 0, new THREE.Color(0xffd9a0).multiplyScalar(lights * .7), null);
    }
    M.pop();
    rotatedCollider(x, z, .95, 2.2, heading, 1.65);
  }
  car(-3.4, -16, .35, 0x7a2e24, {missing: 2, roll: -.06, pitch: .04, sink: -.08});
  car(2.6, 24, -2.7, 0x8c8f88, {lights: .8});
  car(24, -13, 1.2, 0, {burnt: true, flipped: true});
  car(-24, 5, -.4, 0x58718a, {lights: .55});
  car(17, 31, 1.6, 0, {burnt: true, missing: 1, roll: .07, sink: -.1});
  car(-15, -31, .9, 0x4f5a3a, {lights: .35, missing: 0, roll: .08, sink: -.06});

  // ---- Debris and trash: walk-through clutter outside the clear zones.
  const clearOf = (x, z, margin) => Math.abs(x) < 36.5 && Math.abs(z) < 36.5 && Math.hypot(x, z - 3) > 4.5 && Math.hypot(x, z - 12) > 3.2
    && !colliders.some(b => Math.abs(x - b.x) < b.hx + margin && Math.abs(z - b.z) < b.hz + margin);
  for (let i = 0; i < 110; i++) {
    const x = (ru() - .5) * 73, z = (ru() - .5) * 73;
    if (!clearOf(x, z, .45)) continue;
    const kind = ru(), ry = ru() * Math.PI * 2;
    if (kind < .14) shape('misc', TPL.tire, x, .12, z, .62, .62, .62, Math.PI / 2, 0, ry, 0x141517);
    else if (kind < .32) {
      for (let k = 0; k < 3 + ru() * 4; k++) box('misc', x + (ru() - .5) * 1.1, .035, z + (ru() - .5) * 1.1, .22, .07, .11, ru() * 3, (ru() - .5) * .3, tone(0x7a3b2a, .15));
    } else if (kind < .5) {
      for (let k = 0; k < 3; k++) shape('misc', TPL.plane, x + (ru() - .5) * 1.4, .006 + k * .001, z + (ru() - .5) * 1.4, .28 + ru() * .2, .36 + ru() * .2, 1, -Math.PI / 2, 0, ru() * 3, tone(0x55544e, .12));
    } else if (kind < .6) box('wood', x, .02, z, .12, .035, 1.2 + ru(), ry, 0, null);
    else if (kind < .72) {
      if (ru() < .6) {
        shape('misc', TPL.cone, x, .36, z, .36, .62, .36, 0, ry, 0, 0xc4501a);
        box('misc', x, .02, z, .42, .04, .42, ry, 0, 0x1a1a1a);
        cylinder('misc', x, .38, z, .105, .09, 0, 0, 0xd8d8d0);
      } else shape('misc', TPL.cone, x, .19, z, .36, .62, .36, 0, ry, Math.PI / 2, 0xc4501a);
    } else if (kind < .88) {
      for (let k = 0; k < 2 + ru() * 3; k++) { const s = .18 + ru() * .32; box('concrete', x + (ru() - .5), s * .3, z + (ru() - .5), s, s * .7, s * 1.2, ru() * 3, ru(), 0x8e948f, ru()); }
    } else shape('misc', TPL.bag, x, .18, z, .55, .4, .5, 0, ry, 0, 0x101315);
  }

  // ---- Puddles (only visible while the ground is wet).
  const puddleMat = new THREE.MeshStandardMaterial({color: 0x0b1014, roughness: .05, metalness: .85, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4});
  const puddleGeo = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2), puddleSpots = [], pd = new THREE.Object3D();
  for (let i = 0; i < 200 && puddleSpots.length < 26; i++) {
    const x = (ru() - .5) * 70, z = (ru() - .5) * 70, sx = .7 + ru() * 1.6, sz = .45 + ru() * 1.1;
    if (clearOf(x, z, Math.max(sx, sz))) puddleSpots.push([x, z, sx, sz, ru() * 3]);
  }
  const puddles = new THREE.InstancedMesh(puddleGeo, puddleMat, Math.max(1, puddleSpots.length));
  puddleSpots.forEach(([x, z, sx, sz, ry], i) => { pd.position.set(x, .006, z); pd.rotation.set(0, ry, 0); pd.scale.set(sx, 1, sz); pd.updateMatrix(); puddles.setMatrixAt(i, pd.matrix); });
  puddles.count = puddleSpots.length; puddles.visible = false; puddles.raycast = noRaycast; puddles.name = 'world-puddles'; scene.add(puddles);

  // ---- Distant apartment blocks with lit windows, water tanks, chimneys,
  // and pine belts on the sides. All outside the collidable space.
  function building(x, z, w, h, d, ruined = false) {
    M.add('facade', TPL.box, M.matrix(x, h / 2, z, w, h, d), tone(0xb8bcbc, .1), {box: [w, h, d], tile: TILE.facade, off: [Math.floor(ru() * 6) / 6, 0]});
    if (ruined) {
      const w2 = w * (.4 + ru() * .3), h2 = 2 + ru() * 4, ox = (ru() - .5) * (w - w2);
      M.add('facade', TPL.box, M.matrix(x + ox, h + h2 / 2, z, w2, h2, d * .9), tone(0x9aa0a0, .1), {box: [w2, h2, d], tile: TILE.facade, off: [ru(), .3]});
      box('misc', x + ox, h + h2 + .15, z, w2 + .2, .3, d * .9 + .2, 0, 0, 0x15191b);
      box('misc', x - ox * .5, h + .25, z, w * .6, .5, d + .3, 0, ru() * .2, 0x15191b);
    } else box('misc', x, h + .25, z, w + .5, .5, d + .5, 0, 0, 0x15191b);
    if (ru() < .28) {
      cylinder('metal', x + w * .3, h + 3, z, .05, 6, 0, 0, 0x2a3030);
      box('glow', x + w * .3, h + 6.05, z, .14, .14, .14, 0, 0, 0x8a1a10);
    }
    if (!ruined && ru() < .3) box('concrete', x - w * .2, h + 1.3, z + d * .2, w * .25, 2, d * .3, 0, 0, 0x7a807c);
  }
  for (let i = 0; i < 11; i++) {
    const x = (i - 5) * 13 + (r() - .5) * 2, z = -58 - r() * 19, w = 8 + r() * 7, h = 9 + r() * 21, d = 6 + r() * 6;
    building(x, z, w, h, d, i % 4 === 1);
    if (i % 3 === 0) {
      cylinder('concrete', x + 2, h + 5, z, 1.3, 10, 0, 0, 0x6a706c);
      cylinder('misc', x + 2, h + 9.3, z, 1.32, .7, 0, 0, 0x70543c);
      box('glow', x + 2, h + 10.2, z, .2, .2, .2, 0, 0, 0xb76535);
    }
  }
  for (const side of [-1, 1]) for (let i = 0; i < 7; i++) building(side * (80 + r() * 12), -58 + i * 19 + r() * 5, 9 + r() * 8, 8 + r() * 18, 9 + r() * 8, i % 3 === 2);
  for (let i = 0; i < 8; i++) building(-56 + i * 16 + r() * 3, 78 + r() * 12, 9 + r() * 6, 8 + r() * 16, 8 + r() * 5, i % 3 === 0);
  for (const side of [-1, 1]) for (let i = 0; i < 18; i++) {
    const x = side * (46 + r() * 17), z = -45 + i * 5.4, h = 7 + r() * 10;
    cylinder('misc', x, h * .23, z, .22, h * .46, 0, 0, 0x273331);
    for (let k = 0; k < 3; k++) shape('misc', TPL.cone, x, h * (.39 + k * .2), z, h * .43 * (1 - k * .17), h * .59, h * .43 * (1 - k * .17), 0, ru() * 3, 0, tone(0x173a38, .12));
  }
  for (let i = 0; i < 15; i++) {
    const x = -45 + i * 6.5, z = 49 + r() * 15, h = 9 + r() * 7;
    shape('misc', TPL.cone, x, h * .5, z, h * .4, h, h * .4, 0, ru() * 3, 0, tone(0x173a38, .12));
  }

  // ---- Bake the static meshes.
  const merged = M.build(mats, scene);
  if (merged.beam) { merged.beam.raycast = noRaycast; merged.beam.renderOrder = 2; }

  // ---- Sky dome and far skyline band (both follow the camera).
  const skyUniforms = {
    uTop: {value: new THREE.Color()}, uBand: {value: new THREE.Color()}, uFog: {value: new THREE.Color()},
    uSunDir: {value: new THREE.Vector3(0, -1, 0)}, uSunColor: {value: new THREE.Color()}, uSunAlpha: {value: 0},
    uMoonDir: {value: new THREE.Vector3(0, 1, 0)}, uMoonColor: {value: new THREE.Color(1, 1, 1)}, uMoonAlpha: {value: 1},
    uGlow: {value: new THREE.Color()}, uCloudColor: {value: new THREE.Color()}, uStars: {value: 1}, uFlash: {value: 0}, uCloud: {value: 0}, uTime: {value: 0},
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), new THREE.ShaderMaterial({uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false}));
  sky.renderOrder = -10; sky.frustumCulled = false; sky.raycast = noRaycast; sky.name = 'world-sky'; scene.add(sky);
  if (T.skyline) T.skyline.repeat.set(3, 1);
  const skylineMat = new THREE.MeshBasicMaterial({map: T.skyline, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, color: 0xc8d0e0, opacity: T.skyline ? 1 : 0});
  const skyline = new THREE.Mesh(new THREE.CylinderGeometry(175, 175, 34, 48, 1, true), skylineMat);
  skyline.position.y = 14; skyline.renderOrder = -5; skyline.frustumCulled = false; skyline.raycast = noRaycast; skyline.name = 'world-skyline'; scene.add(skyline);

  // ---- Rain: instanced camera-facing streaks wrapped around the viewer.
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
  rainGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const drops = new Float32Array(RAIN_MAX * 4);
  for (let i = 0; i < RAIN_MAX; i++) { drops[i * 4] = ru() * RAIN_AREA; drops[i * 4 + 1] = ru() * RAIN_HEIGHT; drops[i * 4 + 2] = ru() * RAIN_AREA; drops[i * 4 + 3] = ru(); }
  rainGeo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
  rainGeo.instanceCount = 0;
  const rainUniforms = {uTime: {value: 0}, uSpeed: {value: 14}, uLen: {value: .55}, uWidth: {value: .014}, uFogDensity: {value: .0185}, uWind: {value: new THREE.Vector2()},
    uOpacity: {value: .4}, uFlash: {value: 0}, uColor: {value: new THREE.Color(.55, .62, .7)}};
  const rain = new THREE.Mesh(rainGeo, new THREE.ShaderMaterial({uniforms: rainUniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide}));
  rain.frustumCulled = false; rain.visible = false; rain.raycast = noRaycast; rain.renderOrder = 3; rain.name = 'world-rain'; scene.add(rain);

  // ---- Embers rising from the burning barrels.
  const emberPos = new Float32Array(EMBER_MAX * 3), emberSeed = new Float32Array(EMBER_MAX);
  for (let i = 0; i < EMBER_MAX; i++) { const [x, z] = barrels[i % barrels.length]; emberPos.set([x + (ru() - .5) * .4, 1.5, z + (ru() - .5) * .4], i * 3); emberSeed[i] = ru(); }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3)); emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(emberSeed, 1));
  const emberUniforms = {uTime: {value: 0}, uFogDensity: {value: .0185}, uScale: {value: 600}};
  const embers = new THREE.Points(emberGeo, new THREE.ShaderMaterial({uniforms: emberUniforms, vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
  embers.frustumCulled = false; embers.raycast = noRaycast; embers.name = 'world-embers'; scene.add(embers);

  const spawnPoints = [
    {x: -33, z: -35}, {x: 0, z: -35}, {x: 32, z: -34}, {x: 35, z: -8},
    {x: 35, z: 29}, {x: 0, z: 35}, {x: -34, z: 32}, {x: -35, z: 4},
  ];

  // ---- Environment state.
  const env = {
    tod: 0, todTarget: 0, weather: 'clear', w: {...WEATHER.clear}, wTarget: WEATHER.clear,
    eventW: 0, eventTarget: 0, ev: {fog: new THREE.Color(), bg: new THREE.Color(), light: new THREE.Color(), density: .0185},
    wet: 0, flash: 0, pulses: [{at: -99, amp: 0}, {at: -99, amp: 0}, {at: -99, amp: 0}], nextStrike: 4, thunderAt: -1, thunderPower: 0,
    lastTime: null, time: 0, camPos: new THREE.Vector3(0, 1.72, 12), quality: 'high', lampLevel: 1,
  };
  const K = {};
  for (const c of COLOR_KEYS) K[c] = new THREE.Color();
  const fogC = new THREE.Color(), tmpC = new THREE.Color(), moonDir = new THREE.Vector3(), sunDir = new THREE.Vector3(), tmpV = new THREE.Vector3();
  const WHITE = new THREE.Color(1, 1, 1);

  function applyEnvironment(time) {
    sampleTod(env.tod, K);
    const w = env.w, cloud = w.cloud, mist = w.mist, ew = env.eventW, flash = env.flash, daylight = THREE.MathUtils.smoothstep(env.tod, .7, 1);
    fogC.copy(K.fog).lerp(K.mist, mist);
    if (ew > 0) fogC.lerp(env.ev.fog, ew * .85);
    let dens = K.dens * w.fog;
    if (ew > 0) dens += (Math.max(dens, env.ev.density) - dens) * ew;
    scene.fog.color.copy(fogC); scene.fog.density = dens;
    const U = skyUniforms;
    U.uTop.value.copy(K.top).lerp(K.mist, cloud * .45); if (ew > 0) U.uTop.value.lerp(env.ev.bg, ew * .7);
    U.uBand.value.copy(K.band).lerp(fogC, cloud * .6); if (ew > 0) U.uBand.value.lerp(env.ev.fog, ew * .7);
    if (scene.background && scene.background.isColor) scene.background.copy(U.uBand.value);
    U.uFog.value.copy(fogC);
    dirFromAzEl(SUN_AZ, K.sunEl, sunDir); dirFromAzEl(MOON_AZ, K.moonEl, moonDir);
    U.uSunDir.value.copy(sunDir); U.uSunColor.value.copy(K.sunC);
    U.uSunAlpha.value = (1 - .8 * cloud) * (1 - .6 * mist) * THREE.MathUtils.smoothstep(K.sunEl, -.3, .05);
    U.uMoonDir.value.copy(moonDir); U.uMoonColor.value.copy(WHITE); if (ew > 0) U.uMoonColor.value.lerp(env.ev.light, ew);
    U.uMoonAlpha.value = (1 - .85 * cloud) * (1 - .75 * mist) * THREE.MathUtils.smoothstep(K.moonEl, -.05, .05);
    U.uStars.value = K.stars * (1 - cloud);
    U.uGlow.value.copy(K.glow).multiplyScalar((1 - .5 * cloud) * (1 - .7 * mist));
    U.uCloudColor.value.copy(fogC).lerp(K.band, .5).multiplyScalar(1.1 * (1 - .35 * w.storm));
    U.uCloud.value = cloud; U.uFlash.value = flash; U.uTime.value = time;
    hemi.color.copy(K.hemiSky); if (ew > 0) hemi.color.lerp(env.ev.light, ew * .8);
    hemi.groundColor.copy(K.hemiGnd);
    hemi.intensity = K.hemi * (1 - .15 * cloud) + flash * 3;
    moon.position.copy(moonDir).multiplyScalar(60); moon.color.copy(K.moonC); moon.intensity = K.moon * (1 - .55 * cloud);
    if (K.sunEl < .08) dirFromAzEl(SUN_AZ, .08, tmpV); else tmpV.copy(sunDir);
    sun.position.copy(tmpV).multiplyScalar(60); sun.color.copy(K.sunC); sun.intensity = K.sun * (1 - .55 * cloud);
    lightning.intensity = flash * 6;
    mats.facade.emissiveIntensity = K.windows;
    env.lampLevel = K.lamps;
    skylineMat.color.copy(K.skyline).multiplyScalar(1 + flash * .6);
    if (T.skyline) skylineMat.opacity = Math.max(0, Math.min(1, 1.2 - (dens - .012) * 28)) * (1 - mist * .4);
    const beamBoost = 1 + mist * .9 + w.rain * .3;
    mats.beam.uniforms.uIntensity.value = .075 * K.lamps * (1 - .7 * daylight) * beamBoost; mats.beam.uniforms.uFogDensity.value = dens;
    searchBeamMat.uniforms.uIntensity.value = .11 * Math.min(1.4, beamBoost) * (1 - .75 * daylight); searchBeamMat.uniforms.uFogDensity.value = dens;
    searchLight.intensity = 45 * (.35 + .65 * K.lamps);
    const q = QUALITY[env.quality] || QUALITY.high, count = Math.round(q.rain * Math.min(1, w.rain));
    rainGeo.instanceCount = count; rain.visible = count > 8;
    rainUniforms.uTime.value = time; rainUniforms.uFogDensity.value = dens * .8; rainUniforms.uFlash.value = flash;
    rainUniforms.uWind.value.set(w.wind, w.wind * .35);
    rainUniforms.uSpeed.value = 13 + 7 * w.storm; rainUniforms.uLen.value = .5 + .35 * w.storm;
    rainUniforms.uOpacity.value = .28 + .2 * Math.min(1, w.rain);
    const wet = env.wet;
    groundMat.roughness = .92 - .45 * wet; groundMat.color.setScalar(1 - .28 * wet); groundMat.bumpScale = .9 * (1 - .5 * wet);
    mats.slab.roughness = .93 - .38 * wet; mats.slab.color.setScalar(1 - .22 * wet);
    mats.concrete.roughness = .92 - .3 * wet;
    puddleMat.opacity = .85 * wet; puddles.visible = wet > .02 && puddles.count > 0;
    emberUniforms.uTime.value = time; emberUniforms.uFogDensity.value = dens;
  }

  function strike(time) {
    const p = env.pulses, n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < p.length; i++) { p[i].at = i < n ? time + i * (.07 + Math.random() * .12) : -99; p[i].amp = i < n ? .55 + Math.random() * .45 : 0; }
    const a = Math.random() * Math.PI * 2;
    lightning.position.set(Math.cos(a) * 40, 55, Math.sin(a) * 40);
    const distance = 300 + Math.random() * 2200;
    env.thunderAt = time + distance / 1400 + .15;
    env.thunderPower = Math.max(.25, 1 - distance / 2800);
    env.thunderDistance = distance;
  }

  function update(time, dt, camera) {
    if (!(dt >= 0)) dt = env.lastTime == null ? 1 / 60 : time - env.lastTime;
    dt = Math.max(0, Math.min(.1, dt));
    env.lastTime = time; env.time = time;
    if (camera && camera.position) env.camPos.copy(camera.position);
    const ease = rate => 1 - Math.exp(-dt * rate);
    env.tod += (env.todTarget - env.tod) * ease(.6);
    const kw = ease(.35);
    for (const key in env.w) env.w[key] += (env.wTarget[key] - env.w[key]) * kw;
    env.eventW += (env.eventTarget - env.eventW) * ease(1.2);
    const wetGoal = env.w.rain > .25 ? 1 : 0;
    env.wet += (wetGoal - env.wet) * ease(wetGoal > env.wet ? .12 : .04);
    // Storm lightning: a few quick pulses, thunder follows after the light.
    if (env.w.storm > .5) { env.nextStrike -= dt; if (env.nextStrike <= 0) { strike(time); env.nextStrike = 6 + Math.random() * 10; } }
    let flash = 0;
    for (const p of env.pulses) if (time >= p.at) flash += p.amp * Math.exp(-(time - p.at) * 11);
    env.flash = flash > .003 ? Math.min(1.5, flash) : 0;
    if (env.thunderAt > 0 && time >= env.thunderAt) {
      env.thunderAt = -1;
      const cb = api.onThunder;
      if (typeof cb === 'function') { try { cb({intensity: env.thunderPower, distance: env.thunderDistance}); } catch (e) { console.error(e); } }
    }
    applyEnvironment(time);
    sky.position.copy(env.camPos);
    skyline.position.set(env.camPos.x, 14, env.camPos.z);
    // Fire barrels.
    for (const p of props) if (p.type === 'fire') {
      const flicker = .86 + Math.sin(time * 9 + p.phase) * .1 + Math.sin(time * 17 + p.phase) * .07 + (hash1(Math.floor(time * 20) + p.phase) - .5) * .06;
      p.mesh.scale.set(1 / flicker, flicker, 1 / flicker);
      p.mesh.rotation.y = time * .7 + p.phase;
      p.core.scale.y = 1 + Math.sin(time * 13 + p.phase) * .13;
      p.light.intensity = 10 * flicker;
    }
    // Street lamps.
    for (const l of lamps) {
      let k = env.lampLevel;
      if (l.flicker) {
        const burst = Math.sin(time * .7 + l.seed) + Math.sin(time * 1.9 + l.seed * 2.3);
        if (burst > 1.15) { const h = hash1(Math.floor(time * 14) + l.seed * 31); k *= h < .45 ? .06 : h < .6 ? .45 : 1; }
        l.head.color.copy(lampHeadColor).multiplyScalar(Math.max(.08, k));
        l.cone.uniforms.uIntensity.value = mats.beam.uniforms.uIntensity.value * k / Math.max(.01, env.lampLevel);
        l.cone.uniforms.uFogDensity.value = scene.fog.density;
      }
      l.light.intensity = l.base * k;
    }
    // Searchlight sweeps the arena in a slow loop with a breathing radius.
    const sa = time * .22, sr = 17 + 8 * Math.sin(time * .13);
    searchTarget.position.set(Math.cos(sa) * sr, 0, Math.sin(sa) * sr - 2);
    searchHead.lookAt(searchTarget.position);
    searchBeam.lookAt(searchTarget.position);
    const len = searchHead.position.distanceTo(searchTarget.position), spread = len * Math.tan(searchLight.angle) * .9;
    searchBeam.scale.set(spread, spread, len);
    beaconMat.color.setRGB(Math.sin(time * 3.1) > .2 ? 2 : .12, .05, .03);
  }

  function setTimeOfDay(t, instant = false) {
    const v = Math.max(0, Math.min(1, Number(t) || 0));
    env.todTarget = v; if (instant) env.tod = v;
  }
  function setWeather(kind, instant = false) {
    const key = WEATHER[kind] ? kind : 'clear';
    env.weather = key; env.wTarget = WEATHER[key];
    if (instant) { Object.assign(env.w, WEATHER[key]); env.wet = WEATHER[key].rain > .25 ? 1 : 0; }
    if (key === 'storm') env.nextStrike = Math.min(env.nextStrike, 2 + Math.random() * 3);
  }
  // Wave events (rules.js WAVE_EVENTS entries: {fog, bg, density, light}) tint
  // the environment on top of time of day and weather; null fades it out.
  function setEventTint(ev, instant = false) {
    if (ev && ev.fog != null) {
      env.ev.fog.set(ev.fog); env.ev.bg.set(ev.bg != null ? ev.bg : ev.fog); env.ev.light.set(ev.light != null ? ev.light : 0xffffff);
      env.ev.density = Number(ev.density) || .0185; env.eventTarget = 1;
    } else env.eventTarget = 0;
    if (instant) env.eventW = env.eventTarget;
  }
  function setQuality(q) {
    env.quality = QUALITY[q] ? q : 'high';
    emberGeo.setDrawRange(0, QUALITY[env.quality].embers);
  }
  function getEnvironment() {
    return {timeOfDay: env.tod, weather: env.weather, flash: env.flash, cloud: env.w.cloud, mist: env.w.mist, rain: env.w.rain, wet: env.wet,
      event: env.eventW, fogDensity: scene.fog.density, daylight: THREE.MathUtils.smoothstep(env.tod, .6, 1)};
  }

  const api = {
    colliders, spawnPoints, props,
    setTimeOfDay, setWeather, setEventTint, setQuality, getEnvironment,
    getFlash: () => env.flash,
    get timeOfDay() { return env.todTarget; },
    get weather() { return env.weather; },
    onThunder: typeof options.onThunder === 'function' ? options.onThunder : null,
    update: (time, dt, camera) => update(time, dt, camera),
    lights: {hemi, moon, sun, lightning, searchLight},
  };
  Object.defineProperty(props, 'world', {value: api, enumerable: false});
  setQuality(options.quality || 'high');
  setTimeOfDay(options.timeOfDay || 0, true);
  setWeather(options.weather || 'clear', true);
  update(0, 0, null);
  env.lastTime = null;
  return api;
}

// animateWorld(props, time) keeps working; pass dt and the camera to get
// rain and sky following the viewer and frame-rate independent easing.
export function animateWorld(props, time, dt, camera) {
  if (props && props.world) { props.world.update(time, dt, camera); return; }
  for (const p of props || []) if (p.type === 'fire') {
    const flicker = .86 + Math.sin(time * 9 + p.phase) * .1 + Math.sin(time * 17 + p.phase) * .07;
    p.mesh.scale.set(1 / flicker, flicker, 1 / flicker);
    p.mesh.rotation.y = time * .7 + p.phase;
    p.core.scale.y = 1 + Math.sin(time * 13 + p.phase) * .13;
    p.light.intensity = 10 * flicker;
  }
}
