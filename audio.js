// Original procedural effects. No external audio assets or network requests.
// Samples are baked once, then reused so sustained fire costs one voice per shot.
export function createAudio() {
  let ctx, master, limiter, saturator, reverb, reverbGain, enabled = true;
  const samples = new Map(), voices = new Set();
  let seed = 0x914739;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const noise = () => random() * 2 - 1;
  const decay = (t, start, duration) => t < start ? 0 : Math.exp(-(t - start) / duration);

  function bake(kind, variant = 0) {
    const lengths = { shot: .54, minigun: .27, rocket: .95, blast: 2.25, hurt: .24, wave: .82, pickup: .36, reload: .53, switch: .17, hit: .08, airdrop: 3.3, quack:.42, pop:.23, downbeat:.30, offbeat:.23 };
    const duration = lengths[kind], rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.ceil(duration * rate), rate), data = buffer.getChannelData(0);
    let low = 0, mid = 0, rumble = 0, rotor = 0;
    const variance = .94 + variant * .035;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = noise();
      // Broad noise bands give a short pressure wave, not a pitched laser tone.
      low += (n - low) * (1 - Math.exp(-2 * Math.PI * 180 / rate));
      mid += (n - mid) * (1 - Math.exp(-2 * Math.PI * 1700 / rate));
      rumble += (n - rumble) * (1 - Math.exp(-2 * Math.PI * 65 / rate));
      let value = 0;
      if (kind === 'shot' || kind === 'minigun') {
        const rapid = kind === 'minigun', body = rapid ? .032 : .06;
        const crack = (n - mid) * decay(t, 0, .0032 * variance) * 2.2;
        const report = mid * decay(t, .001, .027 * variance) * 2.5;
        const pressure = low * decay(t, .002, body) * 5.4;
        const thump = Math.sin(2 * Math.PI * (85 * t - 85 * t * t)) * decay(t, 0, .018) * .29;
        const bolt = (n - low) * (decay(t, .033, .005) + decay(t, .071, .009)) * .24;
        const tail = mid * decay(t, .038, rapid ? .026 : .105) * .35;
        value = crack + report + pressure + thump + bolt + tail;
      } else if(kind==='quack'){
        const a=t<.19?t:t-.21, envelope=a<0?0:Math.sin(Math.PI*Math.min(1,a/.155))**1.3;
        const f=2*Math.PI*(520*a-600*a*a);value=envelope*(Math.sin(f)+.68*Math.sin(3*f)+.22*Math.sin(5*f))*.32;
      } else if(kind==='pop'){
        value=n*decay(t,0,.024)*.8+Math.sin(2*Math.PI*(460*t-570*t*t))*decay(t,0,.08)*.32;
      } else if(kind==='downbeat'||kind==='offbeat'){
        const kick=kind==='downbeat'; const f=kick?68:196;
        value=(Math.sin(2*Math.PI*(f*t+.8*(1-Math.exp(-t*32))))+.13*Math.sin(4*Math.PI*f*t))*decay(t,0,kick?.075:.044)*.52+(n-low)*decay(t,0,.018)*.15;
      } else if (kind === 'rocket') {
        const ignition = (n - mid) * decay(t, 0, .009) * 1.6 + low * decay(t, .002, .058) * 6;
        const jet = (mid - low) * Math.min(1, t / .025) * Math.exp(-t / .18) * 1.5;
        const punch = Math.sin(2 * Math.PI * 64 * t) * decay(t, 0, .033) * .31;
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
        value = low * decay(t, 0, .038) * 3 + Math.sin(2 * Math.PI * 56 * t) * decay(t, 0, .027) * .18;
      } else if (kind === 'hit') {
        value = (n - mid) * decay(t, 0, .006) * .2 + low * decay(t, .001, .012) * .4;
      } else if (kind === 'wave') {
        // Low radio warning, distinct from weapon reports.
        const pulse = t < .23 ? 1 : t > .35 && t < .62 ? .7 : 0;
        value = (Math.sin(2 * Math.PI * 180 * t) + Math.sin(2 * Math.PI * 270 * t) * .35) * pulse * .12;
      } else if (kind === 'pickup') {
        value = Math.sin(2 * Math.PI * 660 * t) * decay(t, 0, .055) * .12 + Math.sin(2 * Math.PI * 880 * t) * decay(t, .1, .075) * .1;
      } else if (kind === 'airdrop') {
        const flight = Math.sin(Math.PI * t / duration) ** 1.5;
        const bladePulse = .3 + .7 * Math.max(0, Math.sin(2 * Math.PI * 22 * t)) ** 5;
        rotor += (n - rotor) * .018;
        value = (low * 2.4 * bladePulse + rotor * 2 + (mid - low) * .23) * flight;
      }
      // Gentle transient saturation resembles recorded reports and contains peaks.
      const edge = Math.min(1, i / 12, (data.length - 1 - i) / 96);
      data[i] = Math.tanh(value * 1.15) * .91 * edge;
    }
    return buffer;
  }

  function makeImpulse() {
    const length = Math.ceil(ctx.sampleRate * .72), impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        // Early reflections from concrete buildings, followed by a short outdoor tail.
        const reflection = Math.exp(-(((t - .061 - channel * .008) / .003) ** 2))
          + .65 * Math.exp(-(((t - .127 + channel * .01) / .008) ** 2));
        data[i] = noise() * (.27 * reflection + (t > .16 ? .035 * Math.exp(-(t - .16) / .12) : 0));
      }
    }
    return impulse;
  }

  function init() {
    try {
      if (!ctx) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        ctx = new AudioContextClass({ latencyHint: 'interactive' });
        master = ctx.createGain(); master.gain.value = enabled ? .66 : 0;
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
        reverb = ctx.createConvolver(); reverb.buffer = makeImpulse();
        reverbGain = ctx.createGain(); reverbGain.gain.value = .17;
        reverb.connect(reverbGain); reverbGain.connect(limiter);
        for (const kind of ['shot','minigun','rocket','blast','hurt','wave','pickup','reload','switch','hit','airdrop','quack','pop','downbeat','offbeat']) {
          samples.set(kind, Array.from({ length: kind === 'shot' || kind === 'minigun' ? 4 : 1 }, (_, i) => bake(kind, i)));
        }
      }
      const pending = ctx.resume(); pending?.catch?.(() => {});
      return true;
    } catch { return false; }
  }

  function play(kind, { distance = 0, pan = 0, volume = 1 } = {}) {
    if (!ctx || !enabled || ctx.state === 'closed') return;
    const bank = samples.get(kind); if (!bank) return;
    distance = Math.max(0, Number(distance) || 0);
    if (distance > 140) return;
    // Prevent an unbounded voice queue with four miniguns firing together.
    if (voices.size >= 40) {
      const oldest = voices.values().next().value;
      try { oldest.source.stop(); } catch {}
      oldest.cleanup();
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner?.();
    source.buffer = bank[Math.floor(random() * bank.length)];
    source.playbackRate.value = kind === 'shot' || kind === 'minigun' ? .97 + random() * .06 : 1;
    filter.type = 'lowpass'; filter.frequency.value = Math.max(650, 18000 / (1 + distance * .09));
    const level = kind === 'minigun' ? .58 : kind === 'blast' ? .95 : kind === 'shot' ? .86 : .74;
    gain.gain.value = level * Math.max(0, Math.min(1, Number(volume) || 0)) / (1 + distance * .055);
    source.connect(filter);
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0)); filter.connect(panner); panner.connect(gain); }
    else filter.connect(gain);
    gain.connect(limiter);
    if (['shot','minigun','rocket','blast'].includes(kind)) gain.connect(reverb);
    const voice = { source, cleanup() {
      if (!voices.delete(voice)) return;
      source.disconnect(); filter.disconnect(); panner?.disconnect(); gain.disconnect();
    } };
    voices.add(voice); source.onended = voice.cleanup;
    source.start(ctx.currentTime + Math.min(.12, distance / 343));
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(enabled ? .66 : 0, ctx.currentTime, .015);
    }
    if (!enabled) for (const voice of [...voices]) { try { voice.source.stop(); } catch {} voice.cleanup(); }
  }

  function dispose() {
    setEnabled(false);
    for (const node of [master,limiter,saturator,reverb,reverbGain]) node?.disconnect();
    const closing = ctx?.close(); closing?.catch?.(() => {});
    ctx = master = limiter = saturator = reverb = reverbGain = undefined;
    samples.clear();
  }
  return { init, play, setEnabled, dispose };
}
