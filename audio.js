// Original procedural effects. No external audio assets or network requests.
// Samples are baked once, then reused so sustained fire costs one voice per shot.
// Music is a lookahead step sequencer (timer, not per-frame) over baked drum/bass
// samples plus three persistent drone oscillators; it has its own gain bus.

// Sample lengths in seconds. `m_*` kinds are internal music instruments.
const LENGTHS = {
  shot: .54, minigun: .27, rocket: .95, blast: 2.25, hurt: .24, wave: .82, pickup: .36, reload: .53, switch: .17, hit: .08,
  airdrop: 3.3, quack: .42, pop: .23, downbeat: .30, offbeat: .23, groan: 1.1, casing: .16, roar: 1.6,
  smg: .3, svd: 1.7, spit: .5, acid: 1.1, scream: 1.5, hook: .75, crawl: .7, brood: 1.4, thunder: 4.5, rain: 3,
  heartbeat: .95, ui: .07, unlock: 1.4, heli: 2, victory: 3.4, ping: .6,
  m_kick: .45, m_snare: .4, m_hat: .09, m_tom: .5, m_bass: 1, m_bell: 2.6,
};
// Seamless loops: seconds of extra signal rendered and crossfaded into the start.
const LOOPS = { rain: { xf: .35, power: true }, heli: { xf: .25, power: false } };
const CHANNELS = { rain: 2 };
// Band-limited kinds bake at half the context rate (Web Audio resamples on playback): halves bake time.
const RATE_DIV = { thunder: 2, victory: 2, unlock: 2, heli: 2, rain: 2, m_bell: 2, brood: 2, scream: 2 };
const VARIANTS = { shot: 4, minigun: 4, groan: 4, casing: 3, smg: 4, svd: 2, spit: 2, acid: 2, scream: 2, crawl: 2, thunder: 2 };
// Base playback level per kind (before volume/distance).
const LEVELS = {
  minigun: .58, blast: .95, roar: .95, shot: .86, groan: .5, smg: .7, svd: 1, spit: .7, acid: .55, scream: .85, hook: .75,
  crawl: .55, brood: .85, thunder: 1, rain: .6, heartbeat: .8, ui: .5, unlock: .7, heli: .8, victory: .8, ping: .6,
};
const REVERB_KINDS = new Set(['shot', 'minigun', 'rocket', 'blast', 'smg', 'svd', 'scream']);
const JITTER_KINDS = new Set(['shot', 'minigun', 'smg']);
const PRIORITY_KINDS = new Set(['scream']); // bypass duck() so the cause of a duck stays loud
export const SOUND_KINDS = Object.keys(LENGTHS).filter(k => !k.startsWith('m_'));
export const MUSIC_KINDS = Object.keys(LENGTHS).filter(k => k.startsWith('m_'));
export const ALL_KINDS = Object.keys(LENGTHS);
export const variantCount = kind => VARIANTS[kind] || 1;

const TAU = 2 * Math.PI;
const decay = (t, start, duration) => t < start ? 0 : Math.exp(-(t - start) / duration);
// Envelope with a short linear attack: avoids clicks on delayed events (echoes, notes).
const burst = (t, start, attack, duration) => t < start ? 0 : Math.min(1, (t - start) / attack) * Math.exp(-(t - start) / duration);
function makeRng(seed) {
  seed = (seed >>> 0) || 0x914739;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
function hashKind(kind) { let h = 2166136261; for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619); return h >>> 0; }

// Per-bake random event lists (chain links, bubbles, thunder swells).
function prepareEvents(kind, rng, variant) {
  if (kind === 'hook') return Array.from({ length: 18 }, (_, k) => ({ t: .06 + k * .029 + rng() * .018, f: 2500 + rng() * 2700, a: .08 + rng() * .14 }));
  if (kind === 'brood') return Array.from({ length: 26 }, () => ({ t: rng() * 1.05, f: 140 + rng() * 360, k: 300 + rng() * 900, a: .1 + rng() * .22 }));
  if (kind === 'thunder') return Array.from({ length: 7 }, (_, k) => ({ t: (variant ? .35 : .05) + k * .32 + rng() * .3, d: .3 + rng() * .9, a: .4 + rng() * .6 }));
  return null;
}

// Renders one sample into an AudioBuffer created by `ctx`. Pure apart from ctx.createBuffer.
export function bakeSample(ctx, kind, variant = 0) {
  const duration = LENGTHS[kind];
  if (!duration || !ctx) return null;
  const rate = Math.max(8000, Math.round((ctx.sampleRate || 48000) / (RATE_DIV[kind] || 1))), loop = LOOPS[kind], channels = CHANNELS[kind] || 1;
  const length = Math.ceil(duration * rate), xf = loop ? Math.ceil(loop.xf * rate) : 0, total = length + xf;
  const buffer = ctx.createBuffer(channels, length, rate);
  const kLow = 1 - Math.exp(-TAU * 180 / rate), kMid = 1 - Math.exp(-TAU * 1700 / rate), kRumble = 1 - Math.exp(-TAU * 65 / rate);
  const raw = new Float32Array(total);
  const variance = .94 + variant * .035;
  for (let ch = 0; ch < channels; ch++) {
    const rng = makeRng(hashKind(kind) + variant * 7919 + ch * 104729);
    const ev = prepareEvents(kind, rng, variant);
    let low = 0, mid = 0, rumble = 0, rotor = 0, sw = 0, lp1 = 0, lp2 = 0, ph = 0, crackle = 0, slow = 0, kc = 0;
    const drops = [{ age: 9, f: 0, a: 0 }, { age: 9, f: 0, a: 0 }, { age: 9, f: 0, a: 0 }];
    let dropSlot = 0;
    for (let i = 0; i < total; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      // Broad noise bands give a short pressure wave, not a pitched laser tone.
      low += (n - low) * kLow;
      mid += (n - mid) * kMid;
      rumble += (n - rumble) * kRumble;
      let value = 0;
      if (kind === 'shot' || kind === 'minigun') {
        const rapid = kind === 'minigun', body = rapid ? .032 : .06;
        const crack = (n - mid) * decay(t, 0, .0032 * variance) * 2.2;
        const report = mid * decay(t, .001, .027 * variance) * 2.5;
        const pressure = low * decay(t, .002, body) * 5.4;
        const thump = Math.sin(TAU * (85 * t - 85 * t * t)) * decay(t, 0, .018) * .29;
        const bolt = (n - low) * (decay(t, .033, .005) + decay(t, .071, .009)) * .24;
        const tail = mid * decay(t, .038, rapid ? .026 : .105) * .35;
        value = crack + report + pressure + thump + bolt + tail;
      } else if (kind === 'smg') {
        // Lighter, snappier report with a quick blowback clack.
        const crack = (n - mid) * decay(t, 0, .0025 * variance) * 1.9;
        const report = mid * decay(t, .0008, .018 * variance) * 2.3;
        const pressure = low * decay(t, .0015, .035) * 4.2;
        const thump = Math.sin(TAU * (120 * t - 150 * t * t)) * decay(t, 0, .012) * .22;
        const clack = (n - low) * burst(t, .028, .0005, .004) * .2;
        value = crack + report + pressure + thump + clack + mid * decay(t, .025, .06) * .3;
      } else if (kind === 'svd') {
        // Heavy supersonic crack, deep body, then slapback echoes from the city blocks.
        const crack = (n - mid) * decay(t, 0, .004) * 2.6 + n * decay(t, 0, .0012);
        const report = mid * decay(t, .001, .04 * variance) * 2.8;
        const pressure = low * decay(t, .002, .11) * 7;
        const thump = Math.sin(TAU * (60 * t - 40 * t * t)) * decay(t, 0, .035) * .42;
        const dl = variant ? [.19, .41, .7, 1.05] : [.16, .37, .63, .98], gl = [.42, .28, .17, .09];
        let echo = 0;
        for (let k = 0; k < 4; k++) echo += (mid * .7 + low * 3.2) * burst(t, dl[k], .004, .06 + .03 * k) * gl[k];
        value = crack + report + pressure + thump + echo;
      } else if (kind === 'spit') {
        // Wet gurgle, a pitched plop and a spray hiss.
        const gurgle = (mid - low) * (.5 + .5 * Math.sin(TAU * (31 + variant * 6) * t)) * burst(t, 0, .01, .12) * 3;
        const plopF = Math.max(60, 330 - 1500 * t);
        ph += TAU * plopF / rate;
        const plop = Math.sin(ph) * burst(t, 0, .003, .055) * .55;
        value = gurgle + plop + (n - mid) * burst(t, .05, .012, .09) * .35 + low * burst(t, 0, .004, .05) * 2.5;
      } else if (kind === 'acid') {
        // Sizzle: high band noise with random fizzing pops.
        const env = Math.sin(Math.PI * Math.min(1, t / duration)) ** .5;
        if (rng() < .004) crackle = (rng() * 2 - 1) * (.4 + rng() * .6);
        crackle *= .985;
        value = env * ((n - mid) * .24 * (.6 + .4 * Math.sin(TAU * (6 + variant * 3) * t)) + crackle * .55 + (mid - low) * .2);
      } else if (kind === 'scream') {
        // Shrill rising shriek with vibrato, rasp and breath.
        const f0 = (520 + 880 * (1 - Math.exp(-t / .45))) * (1 + .08 * variant) * (1 + .025 * Math.sin(TAU * 7.5 * t));
        ph += TAU * f0 / rate;
        const env = Math.min(1, t / .08) * Math.max(0, Math.min(1, (duration - t) / .4));
        const voice = Math.sin(ph) + .5 * Math.sin(2 * ph) + .3 * Math.sin(3 * ph) + .15 * Math.sin(5 * ph);
        value = env * (voice * (.7 + mid * 1.6) * .42 + (n - low) * .16);
      } else if (kind === 'hook') {
        // Chain whoosh (sweeping low-pass) plus rattling links and a final clank.
        const fc = 300 + 2600 * Math.sin(Math.PI * Math.min(1, t / .5));
        sw += (n - sw) * (1 - Math.exp(-TAU * fc / rate));
        const whoosh = (sw - low) * Math.sin(Math.PI * Math.min(1, t / .55)) ** 2 * 1.3;
        let chain = 0;
        for (const e of ev) { const a = t - e.t; if (a >= 0 && a < .04) chain += Math.sin(TAU * e.f * a) * Math.exp(-a / .006) * e.a; }
        const clank = (Math.sin(TAU * 1900 * t) + .7 * Math.sin(TAU * 3170 * t)) * burst(t, .62, .001, .05) * .3;
        value = whoosh + chain + clank;
      } else if (kind === 'crawl') {
        // Body dragged over asphalt with two knuckle thuds.
        const scrape = (mid - low) * (.4 + .6 * Math.abs(Math.sin(TAU * (2.6 + variant * .7) * t))) * Math.sin(Math.PI * t / duration) * 1.6;
        const tA = variant ? .09 : .05, tB = variant ? .44 : .38;
        const thud = low * (burst(t, tA, .001, .03) + burst(t, tB, .001, .03)) * 4
          + (Math.sin(TAU * 70 * (t - tA)) * burst(t, tA, .001, .04) + Math.sin(TAU * 64 * (t - tB)) * burst(t, tB, .001, .04)) * .25;
        value = scrape + thud + (n - mid) * (burst(t, tA, .0005, .002) + burst(t, tB, .0005, .002)) * .25;
      } else if (kind === 'brood') {
        // Wet birth: squelching body, bubbles, a low groan and two splashes.
        let bubbles = 0;
        for (const e of ev) { const a = t - e.t; if (a >= 0 && a < .12) bubbles += Math.sin(TAU * (e.f * a + e.k * a * a)) * Math.exp(-a / .03) * e.a; }
        const gf = 90 - 25 * Math.min(1, t / 1.2);
        ph += TAU * gf / rate;
        const groan = (Math.sign(Math.sin(ph)) * .35 + Math.sin(2 * ph) * .3) * burst(t, .1, .1, .4) * .3;
        const splash = (n - low) * (burst(t, 0, .005, .08) * .5 + burst(t, .45, .01, .12) * .32);
        value = low * burst(t, 0, .05, .35) * 3.5 + bubbles + groan + splash;
      } else if (kind === 'thunder') {
        // Variant 0: close strike with a crack. Variant 1: distant rolling rumble.
        const crack = (n - low) * burst(t, 0, .003, .05) * (variant ? .15 : .85);
        // Slow envelope: refreshed every 32 samples.
        if ((i & 31) === 0) { slow = 0; for (const e of ev) slow += burst(t, e.t, .08, e.d) * e.a; }
        const swell = slow;
        const fade = Math.exp(-t / 1.7) * Math.min(1, (duration - t) / .6);
        value = crack + (rumble * 14 + low * (variant ? 2 : 4)) * swell * fade + low * burst(t, 0, .01, .25) * (variant ? 1.5 : 4);
      } else if (kind === 'rain') {
        // Steady hiss bed plus sparse droplets; stereo channels use different seeds.
        if (rng() < .0011) { const d = drops[dropSlot]; dropSlot = (dropSlot + 1) % 3; d.age = 0; d.f = 1800 + rng() * 3200; d.a = .08 + rng() * .25; }
        let drip = 0;
        for (const d of drops) { if (d.age < .03) drip += Math.sin(TAU * d.f * d.age) * Math.exp(-d.age / .0035) * d.a; d.age += 1 / rate; }
        value = (n - mid) * .1 + (mid - low) * .32 * (.8 + .2 * Math.sin(TAU * .5 * t)) + low * .6 + drip;
      } else if (kind === 'heli') {
        // Rotor loop: 11 blade passes/s (22 per 2 s loop) so periodic parts line up.
        const phase = (t * 11) % 1, pulse = Math.exp(-phase / .07);
        value = low * 3.5 * (.35 + .65 * pulse) + Math.sin(TAU * 38 * t) * pulse * .35
          + Math.sin(TAU * 1150 * t) * .03 + Math.sin(TAU * 2300 * t) * .012 + (mid - low) * .3 * (.6 + .4 * pulse);
      } else if (kind === 'heartbeat') {
        // Lub-dub; loops cleanly at ~63 bpm when played with {loop:true}.
        const lub = Math.sin(TAU * (55 * t - 30 * t * t)) * burst(t, 0, .008, .07) * .9;
        const tb = t - .3, dub = Math.sin(TAU * (48 * tb - 30 * tb * tb)) * burst(t, .3, .008, .06) * .7;
        value = lub + dub + low * (burst(t, 0, .005, .05) + burst(t, .3, .005, .04) * .8) * 2;
      } else if (kind === 'ui') {
        value = Math.sin(TAU * 2400 * t) * decay(t, 0, .008) * .25 + (n - mid) * decay(t, 0, .0015) * .3 + Math.sin(TAU * 1200 * t) * decay(t, 0, .015) * .1;
      } else if (kind === 'unlock') {
        // Rising bell arpeggio D5 F5 A5 D6.
        const notes = [587.33, 698.46, 880, 1174.66];
        for (let k = 0; k < 4; k++) {
          const s = k * .085, a = t - s;
          if (a >= 0) value += (Math.sin(TAU * notes[k] * a) + .35 * Math.sin(TAU * 2.01 * notes[k] * a) + .12 * Math.sin(TAU * 3.98 * notes[k] * a)) * burst(t, s, .003, k === 3 ? .7 : .4) * .18;
        }
        value += (n - mid) * burst(t, .255, .05, .4) * .04;
      } else if (kind === 'victory') {
        // Brass-like D major swell (detuned saws through a two-pole low-pass), timpani and a chime.
        const chord = [146.83, 220, 293.66, 369.99, 440];
        let saw = 0;
        for (const f of chord) saw += ((f * t) % 1) + ((f * 1.004 * t) % 1) - 1;
        if ((i & 31) === 0) kc = 1 - Math.exp(-TAU * (700 + 2600 * Math.min(1, t / .6) * Math.exp(-t / 2.5)) / rate);
        lp1 += (saw * .2 - lp1) * kc; lp2 += (lp1 - lp2) * kc;
        const env = Math.min(1, t / .18) * (t < 2.3 ? 1 : Math.max(0, 1 - (t - 2.3) / 1.05));
        const timp = Math.sin(TAU * (70 * t - 8 * t * t)) * burst(t, 0, .005, .4) * .5 + low * burst(t, 0, .003, .12) * 3;
        const a = t - 1.2, chime = a >= 0 ? (Math.sin(TAU * 1174.66 * a) + .3 * Math.sin(TAU * 2349.3 * a)) * burst(t, 1.2, .004, .6) * .14 : 0;
        value = lp2 * env * .9 + timp + chime;
      } else if (kind === 'ping') {
        value = Math.sin(TAU * 1318.5 * t) * burst(t, 0, .002, .12) * .3 + Math.sin(TAU * 1975.5 * t) * burst(t, .09, .002, .18) * .25;
      } else if (kind === 'm_kick') {
        ph += TAU * (45 + 110 * Math.exp(-t / .03)) / rate;
        value = Math.sin(ph) * burst(t, 0, .001, .16) * .95 + (n - mid) * decay(t, 0, .002) * .3;
      } else if (kind === 'm_snare') {
        value = Math.sin(TAU * 180 * t) * decay(t, 0, .05) * .4 + (n - low) * decay(t, 0, .09) * .45 + low * decay(t, 0, .05) * 2;
      } else if (kind === 'm_hat') {
        value = (n - mid) * decay(t, 0, .018) * .35 + Math.sin(TAU * 7040 * t) * decay(t, 0, .01) * .05;
      } else if (kind === 'm_tom') {
        ph += TAU * (85 + 60 * Math.exp(-t / .05)) / rate;
        value = Math.sin(ph) * burst(t, 0, .002, .25) * .7 + low * decay(t, 0, .04) * 2;
      } else if (kind === 'm_bass') {
        // D2 saw with a plucked filter; pitched by playbackRate in the sequencer.
        const saw = 2 * ((73.42 * t) % 1) - 1, cutoff = 180 + 1500 * Math.exp(-t / .09), kc = 1 - Math.exp(-TAU * cutoff / rate);
        lp1 += (saw - lp1) * kc; lp2 += (lp1 - lp2) * kc;
        value = (lp2 * .75 + Math.sin(TAU * 73.42 * t) * .35) * burst(t, 0, .004, .4) * .8;
      } else if (kind === 'm_bell') {
        value = (Math.sin(TAU * 587.33 * t) + .4 * Math.sin(TAU * 2.76 * 587.33 * t) + .15 * Math.sin(TAU * 5.4 * 587.33 * t)) * burst(t, 0, .002, .8) * .25;
      } else if (kind === 'groan' || kind === 'roar') {
        // Pitched, throaty noise through a wobbling formant: a hungry undead moan.
        const big = kind === 'roar', len = big ? 1.5 : 1, env = Math.sin(Math.PI * Math.min(1, t / len)) ** (big ? .6 : 1.2);
        const f0 = (big ? 52 : 88 + variant * 9) * (1 + .18 * Math.sin(TAU * (big ? 3.5 : 2.2) * t) + (big ? 0 : -.25 * t));
        const phase = TAU * f0 * t, buzz = Math.sign(Math.sin(phase)) * .35 + Math.sin(phase * 2) * .25 + Math.sin(phase * 3) * .15;
        value = env * (buzz * (.55 + .45 * Math.sin(TAU * (big ? 5 : 7) * t)) * (.7 + .3 * low * 4) + mid * .25) * (big ? .75 : .42);
      } else if (kind === 'casing') {
        value = Math.sin(TAU * (4200 + variant * 300) * t) * decay(t, 0, .03) * .12 + Math.sin(TAU * 6100 * t) * decay(t, .06, .02) * .06;
      } else if (kind === 'quack') {
        const a = t < .19 ? t : t - .21, envelope = a < 0 ? 0 : Math.sin(Math.PI * Math.min(1, a / .155)) ** 1.3;
        const f = TAU * (520 * a - 600 * a * a); value = envelope * (Math.sin(f) + .68 * Math.sin(3 * f) + .22 * Math.sin(5 * f)) * .32;
      } else if (kind === 'pop') {
        value = n * decay(t, 0, .024) * .8 + Math.sin(TAU * (460 * t - 570 * t * t)) * decay(t, 0, .08) * .32;
      } else if (kind === 'downbeat' || kind === 'offbeat') {
        const kick = kind === 'downbeat', f = kick ? 68 : 196;
        value = (Math.sin(TAU * (f * t + .8 * (1 - Math.exp(-t * 32)))) + .13 * Math.sin(2 * TAU * f * t)) * decay(t, 0, kick ? .075 : .044) * .52 + (n - low) * decay(t, 0, .018) * .15;
      } else if (kind === 'rocket') {
        const ignition = (n - mid) * decay(t, 0, .009) * 1.6 + low * decay(t, .002, .058) * 6;
        const jet = (mid - low) * Math.min(1, t / .025) * Math.exp(-t / .18) * 1.5;
        const punch = Math.sin(TAU * 64 * t) * decay(t, 0, .033) * .31;
        value = ignition + jet + punch;
      } else if (kind === 'blast') {
        const attack = n * decay(t, 0, .013) * 1.7;
        const body = low * Math.exp(-t / .3) * 5.7 + rumble * Math.exp(-t / .65) * 4.4;
        const debris = (n - mid) * (decay(t, .09, .014) + decay(t, .23, .02) + decay(t, .42, .03)) * .22;
        value = attack + body + debris;
      } else if (kind === 'reload') {
        const magazine = (mid - low) * (decay(t, .003, .012) * 1.1 + decay(t, .14, .013) * 1.5);
        const slide = (n - low) * (decay(t, .31, .018) * .46 + decay(t, .37, .006) * .75);
        value = magazine + slide + low * decay(t, .14, .02) * 1.8;
      } else if (kind === 'switch') {
        value = (mid - low) * decay(t, 0, .024) * .7 + (n - mid) * decay(t, .07, .004) * .28;
      } else if (kind === 'hurt') {
        value = low * decay(t, 0, .038) * 3 + Math.sin(TAU * 56 * t) * decay(t, 0, .027) * .18;
      } else if (kind === 'hit') {
        value = (n - mid) * decay(t, 0, .006) * .2 + low * decay(t, .001, .012) * .4;
      } else if (kind === 'wave') {
        // Low radio warning, distinct from weapon reports.
        const pulse = t < .23 ? 1 : t > .35 && t < .62 ? .7 : 0;
        value = (Math.sin(TAU * 180 * t) + Math.sin(TAU * 270 * t) * .35) * pulse * .12;
      } else if (kind === 'pickup') {
        value = Math.sin(TAU * 660 * t) * decay(t, 0, .055) * .12 + Math.sin(TAU * 880 * t) * decay(t, .1, .075) * .1;
      } else if (kind === 'airdrop') {
        const flight = Math.sin(Math.PI * t / duration) ** 1.5;
        const bladePulse = .3 + .7 * Math.max(0, Math.sin(TAU * 22 * t)) ** 5;
        rotor += (n - rotor) * .018;
        value = (low * 2.4 * bladePulse + rotor * 2 + (mid - low) * .23) * flight;
      }
      // Gentle transient saturation resembles recorded reports and contains peaks.
      const edge = loop ? 1 : Math.min(1, i / 12, (length - 1 - i) / 96);
      raw[i] = Math.tanh(value * 1.15) * .91 * edge;
    }
    const data = buffer.getChannelData(ch);
    if (xf) {
      // Blend the continuation past the loop end into the start: playback wraps continuously.
      for (let i = 0; i < xf; i++) {
        const w = i / xf;
        data[i] = loop.power ? raw[length + i] * Math.cos(w * Math.PI / 2) + raw[i] * Math.sin(w * Math.PI / 2) : raw[length + i] * (1 - w) + raw[i] * w;
      }
      for (let i = xf; i < length; i++) data[i] = raw[i];
    } else data.set(raw.subarray(0, length));
  }
  return buffer;
}

// ---- Music definitions (16 steps per bar, semitone offsets from D) ----
const MUSIC = { calm: { bpm: 64 }, wave: { bpm: 108 }, boss: { bpm: 126 } };
const PROG = { calm: [0, 0, -4, -5], wave: [0, -4, -2, -5], boss: [0, 0, 1, -1] };
const PENTA = [0, 3, 5, 7, 10, 12];
const semi = s => Math.pow(2, s / 12);
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
// Settings sliders may report 0..100; values above 1 are treated as percent.
const normVol = v => { v = Number(v); if (!Number.isFinite(v)) return null; return clamp01(v > 1 ? v / 100 : v); };

export function createAudio() {
  let ctx, master, limiter, saturator, reverb, reverbGain, duckGain, sfxBus, sfxPriority, musicBus, musicMix, ambGain, enabled = true;
  const samples = new Map(), voices = new Set(), loops = new Set();
  const vol = { master: 1, sfx: 1, music: 1 };
  const random = makeRng(0x5eed1234);
  let warmTimer = 0, warmQueue = [];
  // Music state.
  let musicWanted = 'off', musicMode = 'off', intensity = .5, musicTimer = 0, offTimer = 0, nextTime = 0, step = 0, bar = 0, drone = null;
  // Ambience state.
  let ambWanted = 'none', ambLevel = 1, ambSource = null, ambStopTimer = 0;
  const LOOKAHEAD = .3, TICK_MS = 60;

  const ready = () => ctx && ctx.state !== 'closed';
  const masterLevel = () => enabled ? .66 * vol.master : 0;
  function ramp(param, value, tc = .05) {
    try { param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(value, ctx.currentTime, tc); } catch { try { param.value = value; } catch {} }
  }
  // Bakes one variant (warm-up slice) or, via bank(), every missing variant of a kind on demand.
  function bakeVariant(kind, v) {
    let b = samples.get(kind);
    if (!b) { b = []; samples.set(kind, b); }
    if (!b[v]) b[v] = bakeSample(ctx, kind, v);
    return b;
  }
  function bank(kind) {
    if (!LENGTHS[kind] || !ctx) return samples.get(kind);
    let b = samples.get(kind);
    const count = variantCount(kind);
    if (!b || b.length < count || b.some(x => !x)) for (let v = 0; v < count; v++) b = bakeVariant(kind, v);
    return b;
  }

  function makeImpulse() {
    const rng = makeRng(0x1234567), length = Math.ceil(ctx.sampleRate * .72), impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        // Early reflections from concrete buildings, followed by a short outdoor tail.
        const reflection = Math.exp(-(((t - .061 - channel * .008) / .003) ** 2))
          + .65 * Math.exp(-(((t - .127 + channel * .01) / .008) ** 2));
        data[i] = (rng() * 2 - 1) * (.27 * reflection + (t > .16 ? .035 * Math.exp(-(t - .16) / .12) : 0));
      }
    }
    return impulse;
  }

  // Bakes the remaining kinds one per timer slice so init never stalls a frame for long.
  function warmUp() {
    warmTimer = 0;
    if (!ready()) return;
    const job = warmQueue.shift();
    if (!job) return;
    try { bakeVariant(job[0], job[1]); } catch {}
    if (warmQueue.length) warmTimer = setTimeout(warmUp, 20);
  }

  function init() {
    try {
      if (!ctx) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        ctx = new AudioContextClass({ latencyHint: 'interactive' });
        master = ctx.createGain(); master.gain.value = masterLevel();
        limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -7; limiter.knee.value = 7; limiter.ratio.value = 16;
        limiter.attack.value = .002; limiter.release.value = .095;
        saturator = ctx.createWaveShaper();
        const curve = new Float32Array(4096);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.tanh(x * 1.14) * .96;
        }
        saturator.curve = curve; saturator.oversample = '2x';
        limiter.connect(saturator); saturator.connect(master); master.connect(ctx.destination);
        // Buses: sfx and music pass through duckGain; priority sfx skip the duck.
        duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(limiter);
        sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(duckGain);
        sfxPriority = ctx.createGain(); sfxPriority.gain.value = vol.sfx; sfxPriority.connect(limiter);
        musicBus = ctx.createGain(); musicBus.gain.value = .5 * vol.music; musicBus.connect(duckGain);
        musicMix = ctx.createGain(); musicMix.gain.value = 0; musicMix.connect(musicBus);
        ambGain = ctx.createGain(); ambGain.gain.value = 0; ambGain.connect(sfxBus);
        reverb = ctx.createConvolver(); reverb.buffer = makeImpulse();
        reverbGain = ctx.createGain(); reverbGain.gain.value = .17;
        reverb.connect(reverbGain); reverbGain.connect(sfxBus);
        // Core combat sounds now; everything else in the background.
        for (const kind of ['shot', 'minigun', 'hit', 'hurt', 'reload', 'switch', 'groan', 'casing', 'ui']) bank(kind);
        warmQueue = ALL_KINDS.filter(k => !samples.has(k)).flatMap(k => Array.from({ length: variantCount(k) }, (_, v) => [k, v]));
        warmTimer = setTimeout(warmUp, 30);
        applyMusic(); applyAmbience();
      }
      const pending = ctx.resume?.(); pending?.catch?.(() => {});
      return true;
    } catch { return false; }
  }

  // Returns a handle {stop(fade), setVolume(v), setRate(r)} or null. {loop:true} keeps playing until stopped.
  function play(kind, { distance = 0, pan = 0, volume = 1, rate = 1, loop = false } = {}) {
    try {
      if (!ready() || (!enabled && !loop)) return null;
      const b = bank(kind); if (!b || !b[0]) return null;
      distance = Math.max(0, Number(distance) || 0);
      if (distance > 140) return null;
      // Prevent an unbounded voice queue with four miniguns firing together.
      if (!loop && voices.size >= 40) {
        const oldest = voices.values().next().value;
        try { oldest.source.stop(); } catch {}
        oldest.cleanup();
      }
      const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      const panner = ctx.createStereoPanner?.();
      source.buffer = b[Math.floor(random() * b.length)];
      source.loop = Boolean(loop);
      const userRate = Math.max(.25, Math.min(4, Number(rate) || 1));
      source.playbackRate.value = (JITTER_KINDS.has(kind) ? .97 + random() * .06 : 1) * userRate;
      filter.type = 'lowpass'; filter.frequency.value = Math.max(650, 18000 / (1 + distance * .09));
      const level = (LEVELS[kind] ?? .74) / (1 + distance * .055);
      gain.gain.value = level * clamp01(volume);
      source.connect(filter);
      if (panner) { panner.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0)); filter.connect(panner); panner.connect(gain); }
      else filter.connect(gain);
      gain.connect(PRIORITY_KINDS.has(kind) ? sfxPriority : sfxBus);
      if (REVERB_KINDS.has(kind)) gain.connect(reverb);
      const set = loop ? loops : voices;
      const voice = {
        source,
        cleanup() {
          if (!set.delete(voice)) return;
          try { source.disconnect(); filter.disconnect(); panner?.disconnect(); gain.disconnect(); } catch {}
        },
      };
      set.add(voice); source.onended = voice.cleanup;
      source.start(ctx.currentTime + Math.min(.12, distance / 343));
      return {
        stop(fade = .05) {
          try {
            if (!set.has(voice)) return;
            const now = ctx.currentTime, f = Math.max(.005, Number(fade) || .05);
            gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0, now, f / 3); source.stop(now + f);
          } catch { voice.cleanup(); }
        },
        setVolume(v) { try { ramp(gain.gain, level * clamp01(v), .08); } catch {} },
        setRate(r) { try { source.playbackRate.setTargetAtTime(Math.max(.25, Math.min(4, Number(r) || 1)), ctx.currentTime, .1); } catch {} },
      };
    } catch { return null; }
  }

  function setEnabled(value) {
    try {
      const next = Boolean(value);
      if (next === enabled) return;
      enabled = next;
      if (master && ctx) ramp(master.gain, masterLevel(), .015);
      // One-shots stop; loops, ambience and music stay alive but are silenced by the master gain.
      if (!enabled) for (const voice of [...voices]) { try { voice.source.stop(); } catch {} voice.cleanup(); }
    } catch {}
  }

  // Volumes 0..1 (or 0..100). Only provided keys change. Works before init.
  function setVolumes({ master: m, sfx, music } = {}) {
    try {
      const vm = normVol(m), vs = normVol(sfx), vu = normVol(music);
      if (vm !== null && m !== undefined) vol.master = vm;
      if (vs !== null && sfx !== undefined) vol.sfx = vs;
      if (vu !== null && music !== undefined) vol.music = vu;
      if (!ctx) return;
      ramp(master.gain, masterLevel());
      ramp(sfxBus.gain, vol.sfx); ramp(sfxPriority.gain, vol.sfx);
      ramp(musicBus.gain, .5 * vol.music);
    } catch {}
  }
  const getVolumes = () => ({ ...vol });

  // Briefly lowers music, ambience and normal sfx (screamer). depth 0..1, duration seconds.
  function duck(depth = .55, duration = .8) {
    try {
      if (!ready()) return;
      const g = duckGain.gain, now = ctx.currentTime, d = Math.max(.1, Number(duration) || .8);
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1 - clamp01(depth), now + .05);
      g.setTargetAtTime(1, now + .05 + d * .4, d * .3);
    } catch {}
  }

  // ---- Ambience ----
  function setAmbience(kind = 'none', level = 1) {
    try {
      ambWanted = kind === 'rain' || kind === 'storm' ? kind : 'none';
      ambLevel = clamp01(level ?? 1);
      if (ctx) applyAmbience();
    } catch {}
  }
  function applyAmbience() {
    if (!ready()) return;
    clearTimeout(ambStopTimer); ambStopTimer = 0;
    if (ambWanted === 'none' || ambLevel <= 0) {
      ramp(ambGain.gain, 0, .9);
      ambStopTimer = setTimeout(() => {
        ambStopTimer = 0;
        if ((ambWanted === 'none' || ambLevel <= 0) && ambSource) { try { ambSource.stop(); ambSource.disconnect(); } catch {} ambSource = null; }
      }, 5000);
      return;
    }
    if (!ambSource) {
      const b = bank('rain'); if (!b || !b[0]) return;
      ambSource = ctx.createBufferSource(); ambSource.buffer = b[0]; ambSource.loop = true;
      ambSource.connect(ambGain); ambSource.start(ctx.currentTime + .02);
    }
    ramp(ambGain.gain, ambLevel * LEVELS.rain * (ambWanted === 'storm' ? 1.3 : 1), 1.2);
  }

  // ---- Music ----
  function setMusic(mode = 'off', level) {
    try {
      if (!(mode in MUSIC) && mode !== 'off') return;
      musicWanted = mode;
      if (level !== undefined) intensity = clamp01(level);
      if (ctx) applyMusic();
    } catch {}
  }
  function startDrone() {
    if (drone) return;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 260; if (filter.Q) filter.Q.value = 1.2;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator(), lfo = ctx.createOscillator();
    o1.type = o2.type = 'sawtooth'; o3.type = 'sine'; lfo.type = 'sine';
    o1.frequency.value = 36.71; o2.frequency.value = 36.71 * semi(.08); o3.frequency.value = 55; lfo.frequency.value = .06;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 70;
    const subGain = ctx.createGain(); subGain.gain.value = .5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
    o1.connect(filter); o2.connect(filter); filter.connect(gain);
    o3.connect(subGain); subGain.connect(gain); gain.connect(musicMix);
    const now = ctx.currentTime;
    for (const o of [o1, o2, o3, lfo]) o.start(now);
    drone = { filter, o1, o2, o3, lfo, lfoGain, subGain, gain };
  }
  function stopDrone() {
    if (!drone) return;
    for (const node of Object.values(drone)) { try { node.stop?.(); } catch {} try { node.disconnect(); } catch {} }
    drone = null;
  }
  function updateDrone() {
    if (!drone) return;
    const m = musicWanted === 'off' ? musicMode : musicWanted, I = intensity;
    const cutoff = m === 'boss' ? 520 + I * 700 : m === 'wave' ? 320 + I * 520 : 220 + I * 200;
    drone.filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, .8);
    drone.gain.gain.setTargetAtTime(m === 'boss' ? .16 : m === 'wave' ? .13 : .2, ctx.currentTime, .8);
    // Fifth (A1) normally; the tritone (G#1) under bosses.
    drone.o3.frequency.setTargetAtTime(m === 'boss' ? 51.91 : 55, ctx.currentTime, .8);
  }
  function applyMusic() {
    if (!ready()) return;
    clearTimeout(offTimer); offTimer = 0;
    if (musicWanted !== 'off') {
      startDrone();
      if (musicMode === 'off') { musicMode = musicWanted; step = 0; bar = 0; nextTime = ctx.currentTime + .08; }
      ramp(musicMix.gain, 1, .6);
      updateDrone();
      if (!musicTimer) musicTimer = setInterval(tick, TICK_MS);
    } else {
      ramp(musicMix.gain, 0, .7);
      offTimer = setTimeout(() => {
        offTimer = 0;
        if (musicWanted !== 'off') return;
        clearInterval(musicTimer); musicTimer = 0; stopDrone(); musicMode = 'off';
      }, 3500);
    }
  }
  function note(kind, time, v, rate = 1, len = 0) {
    const b = bank(kind); if (!b || !b[0]) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b[0]; src.playbackRate.value = rate; g.gain.value = v;
    src.connect(g); g.connect(musicMix);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch {} };
    src.start(time); // start() must precede stop()
    if (len > 0) { g.gain.setValueAtTime(v, time + len); g.gain.setTargetAtTime(0, time + len, .02); src.stop(time + len + .15); }
  }
  function scheduleStep(mode, s, b, time, stepDur) {
    const I = intensity, root = PROG[mode][b % 4];
    if (mode === 'calm') {
      if (s === 0) note('m_bass', time, .32, semi(root - 12), stepDur * 15);
      if (s === 0 && I > .3) note('m_kick', time, .22, .8);
      if (s === 8 && I > .6) note('m_kick', time, .14, .8);
      if (random() < .045 + .06 * I) note('m_bell', time, .1 + random() * .08, semi(PENTA[Math.floor(random() * PENTA.length)] + root - 12 * (random() < .5)));
      return;
    }
    if (mode === 'wave') {
      if (s === 0 || s === 8 || (I > .55 && (s === 6 || s === 14))) note('m_kick', time, .8);
      if (s === 4 || s === 12) note('m_snare', time, .55);
      if (I > .85 && s === 15) note('m_snare', time, .22);
      if (I > .7 || (I > .2 && s % 2 === 0)) note('m_hat', time, s % 4 === 2 ? .26 : .17);
      if (s % (I < .35 ? 4 : 2) === 0) note('m_bass', time, .42, semi(root + (s === 6 || s === 14 ? 12 : 0)), stepDur * 1.8);
      if (I > .5 && b % 4 === 3 && s >= 12) note('m_tom', time, .5, [1.25, 1.1, 1, .85][s - 12]);
      return;
    }
    // boss
    if ([0, 3, 6, 8, 10, 11, 14].includes(s)) note('m_kick', time, .9);
    if (s === 4 || s === 12) note('m_snare', time, .7);
    note('m_hat', time, s % 2 ? .26 : .15);
    if (s % 4 !== 1) note('m_bass', time, .5, semi(root), stepDur * .9);
    if (s === 0 && b % 2 === 0) note('m_tom', time, .7, .6);
    if (s === 0 && b % 4 === 0 && I > .4) note('m_bell', time, .14, semi(root + 1 - 12));
  }
  function tick() {
    try {
      if (!ready() || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (nextTime < now - .2) nextTime = now + .05; // tab was throttled: skip, don't burst
      while (nextTime < now + LOOKAHEAD) {
        // Mode changes land on a beat so the groove never breaks mid-step.
        if (step % 4 === 0 && musicWanted !== musicMode) {
          musicMode = musicWanted; step = 0; bar = 0;
          if (musicMode === 'off') return;
        }
        if (musicMode === 'off') return;
        const stepDur = 60 / MUSIC[musicMode].bpm / 4;
        if (enabled) scheduleStep(musicMode, step, bar, nextTime, stepDur);
        nextTime += stepDur;
        if (++step >= 16) { step = 0; bar++; }
      }
    } catch {}
  }

  function dispose() {
    try {
      setEnabled(false);
      clearTimeout(warmTimer); clearTimeout(offTimer); clearTimeout(ambStopTimer); clearInterval(musicTimer);
      warmTimer = offTimer = ambStopTimer = musicTimer = 0; warmQueue = [];
      stopDrone();
      for (const voice of [...loops]) { try { voice.source.stop(); } catch {} voice.cleanup(); }
      try { ambSource?.stop(); ambSource?.disconnect(); } catch {}
      ambSource = null; musicMode = 'off';
      for (const node of [master, limiter, saturator, reverb, reverbGain, duckGain, sfxBus, sfxPriority, musicBus, musicMix, ambGain]) { try { node?.disconnect(); } catch {} }
      const closing = ctx?.close?.(); closing?.catch?.(() => {});
    } catch {}
    ctx = master = limiter = saturator = reverb = reverbGain = duckGain = sfxBus = sfxPriority = musicBus = musicMix = ambGain = undefined;
    samples.clear();
  }
  return { init, play, setEnabled, dispose, setVolumes, getVolumes, setMusic, setAmbience, duck };
}
