// Balance rules: per-wave configuration, enemy stats, difficulty and events.
// Pure module (no DOM / three.js) so it can be unit-tested in Node.
import { getWave, CAMPAIGN_LENGTH, BOSS_NAMES } from './campaign.js';

// Difficulty multipliers, chosen by the host and synced to clients.
export const DIFFICULTY = {
  recruit: { id: 'recruit', title: 'Новобранец', desc: 'Меньше зомби, слабее укусы. Для знакомства с игрой.', hp: .75, dmg: .6, count: .85 },
  veteran: { id: 'veteran', title: 'Ветеран', desc: 'Задуманный баланс: напряжённо, но честно.', hp: 1, dmg: 1, count: 1 },
  nightmare: { id: 'nightmare', title: 'Кошмар', desc: 'Больше, крепче, больнее. Только для слаженной команды.', hp: 1.3, dmg: 1.35, count: 1.2 },
};
export const DEFAULT_DIFFICULTY = 'veteran';
export function difficultyOf(id) { return DIFFICULTY[id] || DIFFICULTY[DEFAULT_DIFFICULTY]; }

export const ENEMY_TYPES = ['walker', 'runner', 'brute', 'exploder', 'crawler', 'spitter', 'screamer', 'armored'];
export const BOSS_TYPES = ['boss', 'brood', 'butcher', 'father'];
export const MAX_ALIVE = 80;
// Extra room above maxAlive for spawns that happen on top of the wave stream (brood births, boss
// minion calls). game.js applies maxAlive + ALIVE_EXTRA as a hard cap to every non-boss spawn.
export const ALIVE_EXTRA = 12;

// ── Base curves (veteran, 1 player). a = wave - 1. ─────────────────────────
// Every curve is smooth on 1..30 and continues linearly (value and slope
// matched at wave 30) for endless mode, so there are no jumps at the seam.
const SEAM = CAMPAIGN_LENGTH - 1; // a at wave 30
// Walker health: 60 + 10a - 0.06a² → 60 (2 AK body shots) at 1, 96 at 5,
// 188 at 15, 300 at 30; then +6.52 per wave.
const hpQuad = a => 60 + 10 * a - .06 * a * a;
const baseHealth = a => a <= SEAM ? hpQuad(a) : hpQuad(SEAM) + (10 - .12 * SEAM) * (a - SEAM);
// Regular zombie count: 3 + 7w → 10 at 1, 38 at 5, 45..108 for 6..15,
// 115..178 for 16..25, 185..213 for 26..30 (campaign countScale shapes it).
const baseCount = w => 3 + 7 * w;
// Walker speed (m/s) saturates: 1.7 + 1.9(1 - e^(-a/14)) → 1.7 at 1, 2.9 at 15,
// 3.36 at 30 (player walks 4.8, sprints 8). Linear beyond 30, hard cap 4.3.
const spQ = a => 1.7 + 1.9 * (1 - Math.exp(-a / 14));
const baseSpeed = a => Math.min(4.3, a <= SEAM ? spQ(a) : spQ(SEAM) + 1.9 / 14 * Math.exp(-SEAM / 14) * (a - SEAM));
// Walker melee hit: 8 + 0.76a → 8 at 1, 30 at 30; one hit per ~1 s per zombie
// (game.js attack cooldown .85–1.15 s). Capped at 55 deep in endless mode.
const baseDamage = a => Math.min(55, 8 + .76 * a);
// Spit impact: 8 → 22 over the campaign, linear afterwards (cap 40).
const baseAcid = a => Math.min(40, 8 + 14 * a / SEAM);
// Time over which a wave's regular zombies are released (s): the 1-player
// veteran interval decays smoothly 1.6 s → 0.48 s (w15) → 0.32 s (w30) → 0.3 s,
// i.e. 16 s at wave 1, 52 s at 15, 68 s at 30. spawnInterval = duration / count,
// so bigger teams, harder difficulties and countScale get denser streams of the
// same length.
const spawnDuration = w => (.3 + 1.3 * Math.pow(.88, w - 1)) * baseCount(w);
// Expected player damage growth from perks (sustained AK fire vs a boss), used
// only to keep boss time-to-kill flat across the campaign. Fitted to a perk
// simulation (one pick per wave from 3 random cards, half the picks favouring
// damage perks): x1.31 at w5, x1.78 at w10, x2.33 at w15, x2.98 at w20,
// x3.72 at w25, x4.54 at w30; linear beyond (value and slope matched).
const pwQ = a => 1 + .07 * a + .0018 * a * a;
export const bossPower = a => a <= SEAM ? pwQ(a) : pwQ(SEAM) + (.07 + .0036 * SEAM) * (a - SEAM);
// Every boss wave airdrops a minigun to each player (1200 rounds). Against
// bosses it deals only this share of its damage (game.js hitscan): a horde
// weapon, not a boss shredder.
export const MINIGUN_BOSS_MULT = .2;
// Boss HP unit (veteran, 1 player, wave 1). Tuned with the TTK model in the
// balance test: 2 players, 60% accuracy, 25% headshots, 60% of fire on the
// boss, AK x bossPower plus the airdropped minigun (x MINIGUN_BOSS_MULT,
// caliber/head perks only) until its 1200 rounds run out → Titan ≈ 51 s (w5),
// Матка 53 s, Мясник 55 s, two Titans 82 s, Матка+Мясник 75 s, Отец Орды 162 s.
const BOSS_HP = 5750;
// Bosses scale harder with team size than regular zombies (×(1+.65(p−1)) vs
// ×(1+.12(p−1))) so solo stays doable and 4 players do not melt them.
const bossTeam = p => 1 + .65 * (p - 1);
// Several bosses in one wave split the HP budget (2 → 62% each, 3 → 42%).
const bossShare = n => n <= 1 ? 1 : n === 2 ? .62 : .42;

const clampInt = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || d)));
const r2 = v => Math.round(v * 100) / 100;

// Mix weights are shares of the wave's zombies. A crawler pick spawns a whole
// pack (ENEMY_INFO.crawler.pack, mean 4), so its per-pick weight is divided by
// the mean pack size; config.mix holds per-pick probabilities.
const CRAWLER_PACK_MEAN = 4;
function normalizeMix(mix) {
  const out = {};
  let sum = 0;
  for (const t of ENEMY_TYPES) { const v = Math.max(0, Number(mix?.[t]) || 0) / (t === 'crawler' ? CRAWLER_PACK_MEAN : 1); out[t] = v; sum += v; }
  if (sum <= 0) { out.walker = 1; sum = 1; }
  for (const t of ENEMY_TYPES) out[t] = out[t] / sum;
  return out;
}

// waveConfig(wave, players, difficulty, waveDef) → everything the host needs
// for a wave. waveDef defaults to campaign.getWave(wave) (endless included).
// The wave event (waveDef.event) is ALREADY applied to the returned numbers
// (config.eventApplied === true): do not apply WAVE_EVENTS multipliers again.
// `count` includes the bosses (waveKills >= count ends the wave).
export function waveConfig(wave, players = 1, difficulty = DEFAULT_DIFFICULTY, waveDef = null) {
  const w = clampInt(wave, 1, 9999, 1);
  const team = clampInt(players, 1, 4, 1);
  const diff = difficultyOf(difficulty);
  const def = waveDef || getWave(w);
  const a = w - 1;
  const bosses = Array.isArray(def.boss) ? def.boss.filter(t => BOSS_TYPES.includes(t === 'titan' ? 'boss' : t)).map(t => t === 'titan' ? 'boss' : t) : [];
  const scale = Math.max(.3, Math.min(2, Number(def.countScale) || 1));
  const regular = Math.min(1999, Math.max(1, Math.round(baseCount(w) * scale * diff.count * (1 + .55 * (team - 1)))));
  const config = {
    wave: w, players: team, difficulty: diff.id, act: def.act, title: def.title,
    regularCount: regular,
    count: regular + bosses.length,
    health: Math.round(baseHealth(a) * diff.hp * (1 + .12 * (team - 1))),
    speed: r2(baseSpeed(a)),
    damage: r2(baseDamage(a) * diff.dmg),
    acidDamage: r2(baseAcid(a) * diff.dmg),
    acidPoolDps: r2(10 * diff.dmg),
    spawnInterval: r2(Math.max(.12, Math.min(2.6, spawnDuration(w) / regular))),
    maxAlive: Math.min(MAX_ALIVE, Math.round(14 + 3 * w + 8 * (team - 1))),
    mix: normalizeMix(def.mix),
    bosses,
    boss: bosses.length > 0,
    bossHealth: Math.round(BOSS_HP * bossPower(a) * diff.hp * bossTeam(team) * bossShare(bosses.length)),
    event: def.event && WAVE_EVENTS[def.event] ? def.event : null,
    weather: def.weather || 'clear',
    tod: Number.isFinite(def.tod) ? def.tod : 0,
    unlock: def.unlock || null,
    endless: w > CAMPAIGN_LENGTH,
    eventApplied: false,
  };
  applyWaveEvent(config, config.event);
  // Legacy fields read by the v3 picker in game.js.
  config.runnerChance = config.mix.runner;
  config.bruteChance = config.mix.brute;
  config.exploderChance = config.mix.exploder;
  return config;
}

// Applies a WAVE_EVENTS entry to a config once (idempotent via eventApplied).
export function applyWaveEvent(config, key) {
  const ev = key && WAVE_EVENTS[key];
  if (!config || config.eventApplied) return config;
  config.eventApplied = true;
  if (!ev) return config;
  if (ev.speed) config.speed = r2(config.speed * ev.speed);
  if (ev.damage) config.damage = r2(config.damage * ev.damage);
  if (ev.health) config.health = Math.round(config.health * ev.health);
  if (ev.count) {
    const extra = Math.round(config.regularCount * ev.count) - config.regularCount;
    config.regularCount += extra; config.count += extra;
    // Same wave length, denser stream.
    config.spawnInterval = r2(Math.max(.12, Math.min(2.6, spawnDuration(config.wave || 1) / config.regularCount)));
  }
  if (ev.runner) {
    // Swarm: runners take ev.runner of the mix, the rest keep their proportions.
    const rest = 1 - config.mix.runner;
    for (const t of ENEMY_TYPES) if (t !== 'runner') config.mix[t] = rest > 0 ? config.mix[t] / rest * (1 - ev.runner) : 0;
    config.mix.runner = rest > 0 ? ev.runner : 1;
  }
  return config;
}

// Picks a regular enemy type from config.mix (bosses are spawned separately
// from config.bosses). Crawlers should be spawned as packs (ENEMY_INFO.pack).
export function pickEnemyType(config, random = Math.random) {
  const mix = config?.mix;
  if (!mix) return 'walker';
  let roll = random(), acc = 0;
  for (const t of ENEMY_TYPES) { acc += mix[t] || 0; if (roll < acc) return t; }
  return 'walker';
}

// Per-type multipliers on the wave's walker stats. Boss health comes from
// config.bossHealth (team/difficulty/share already included) × health.
// bodyMult: damage factor for non-head hits (weak points count as heads).
const TYPES = {
  walker: { health: 1, speed: 1, damage: 1 },
  runner: { health: .7, speed: 1.6, damage: .9 },
  brute: { health: 2.6, speed: .75, damage: 1.7 },
  exploder: { health: .55, speed: 1.35, damage: 0 },
  crawler: { health: .55, speed: 1.3, damage: .8 },
  spitter: { health: .8, speed: .9, damage: .7 },
  screamer: { health: 1.1, speed: .85, damage: .8 },
  armored: { health: 1.8, speed: .8, damage: 1.3 },
  boss: { health: 1, speed: .85, damage: 2.6, bodyMult: .6, boss: true },
  brood: { health: 1, speed: .5, damage: 2, bodyMult: .75, boss: true },
  butcher: { health: 1, speed: 1.35, damage: 1.6, bodyMult: .85, boss: true },
  father: { health: 2.5, speed: .7, damage: 2.3, bodyMult: .6, boss: true },
};
TYPES.titan = TYPES.boss;
const SPEED_CAP = { runner: 6.2, butcher: 6 };

// Static per-type info for UI (bestiary) and AI tuning.
export const ENEMY_INFO = {
  walker: { name: 'Ходок', desc: 'Медленный и упрямый. Опасен толпой.' },
  runner: { name: 'Бегун', desc: 'Быстрый и хрупкий. Заходит с флангов.' },
  brute: { name: 'Громила', desc: 'Огромный запас здоровья и тяжёлый удар.' },
  exploder: { name: 'Бомбер', desc: 'Взрывается рядом с целью. Стреляй издалека.' },
  crawler: { name: 'Ползун', desc: 'Низкий и шустрый, ходит стаями по 3–5.', pack: [3, 5] },
  spitter: { name: 'Плевун', desc: 'Держит дистанцию и плюётся кислотой. Не стой в лужах.', range: [9, 16], retreat: 7 },
  screamer: { name: 'Крикун', desc: 'Криком ускоряет орду вокруг. Убивай первым.', range: [12, 20] },
  armored: { name: 'Штурмовик', desc: 'Щит гасит урон спереди. Бей в голову, спину или фланг.' },
  boss: { name: BOSS_NAMES.boss, desc: 'Бьёт по земле, бросает валуны, таранит. Слабое место — голова.' },
  brood: { name: BOSS_NAMES.brood, desc: 'Рожает ползунов и плюётся веером кислоты. Бей по светящимся мешкам.' },
  butcher: { name: BOSS_NAMES.butcher, desc: 'Бросает крюк и подтягивает к себе. Рубит тесаком вблизи.' },
  father: { name: BOSS_NAMES.father, desc: 'Тот, кто звал орду. Три фазы. Его смерть — конец ночи.' },
};

export function enemyStats(config, type) {
  const k = TYPES[type] || TYPES.walker;
  const cfg = config || waveConfig(1);
  // Flat damage terms are scaled by the difficulty too (cfg.damage already is).
  const dm = difficultyOf(cfg.difficulty).dmg;
  const health = k.boss
    ? (cfg.bossHealth || cfg.health * 60) * k.health
    : cfg.health * k.health;
  const out = {
    health: Math.round(health),
    speed: r2(Math.min(SPEED_CAP[type] || 5, cfg.speed * k.speed)),
    damage: r2(cfg.damage * k.damage),
  };
  if (k.bodyMult) out.bodyMult = k.bodyMult;
  if (k.boss) out.name = BOSS_NAMES[type] || 'Босс';
  if (type === 'exploder') Object.assign(out, { blastPower: 200, blastRadius: 6, blastPlayerDamage: r2(16 * dm + .8 * cfg.damage), blastPlayerRadius: 4.2 });
  if (type === 'spitter' || type === 'brood' || type === 'father') {
    const acid = cfg.acidDamage || cfg.damage * .75;
    Object.assign(out, { acid, acidRadius: 2.4, poolRadius: type === 'spitter' ? 1.8 : 2.2, poolTime: 4, poolDps: cfg.acidPoolDps || 10, spitEvery: type === 'spitter' ? 3.5 : 4 });
  }
  if (type === 'screamer' || type === 'father') Object.assign(out, { screamEvery: 8, screamRadius: 14, screamBuff: .35, screamTime: 5, screamShakeRadius: 18 });
  if (type === 'armored') out.frontMult = .35;
  // Titan / Father abilities (game.js): slam = slamBase + .75 dmg (falloff), charge = chargeBase + .6 dmg,
  // boulder = rockDamage[0] + rockDamage[1] x (1 - d / 3.6).
  if (type === 'boss' || type === 'titan' || type === 'father') Object.assign(out, { slamBase: r2(10 * dm), chargeBase: r2(30 * dm), rockDamage: [r2(12 * dm), r2(30 * dm)] });
  if (type === 'brood') Object.assign(out, { birthEvery: 6, birthCount: 3 });
  if (type === 'butcher') Object.assign(out, { hookEvery: 6, hookRange: [6, 20], hookPull: 6, hookSlow: 1.5, enrageSpeed: 1.25 });
  return out;
}

export function blastDamage(distance, radius = 8.5, power = 240) { return distance >= radius ? 0 : power * (1 - distance / radius) * .85 + power * .15; }
export function bestWave(previous, current) { return Math.max(Number(previous) || 0, current); }

// Wave modifiers. In the campaign every wave's event is fixed in campaign.js;
// rollWaveEvent is kept for compatibility (endless mode uses its own seeded roll).
export const WAVE_EVENTS = {
  blood: { title: 'Кровавая луна', hint: 'Зомби быстрее и злее. Очки ×2.', speed: 1.22, damage: 1.15, score: 2, fog: 0x3a1014, bg: 0x1d0a0d, density: .024, light: 0xff6a5a },
  fog: { title: 'Мёртвый туман', hint: 'Видимость почти ноль. Слушай шаги. Очки ×1.5.', score: 1.5, fog: 0x5d6a66, bg: 0x434d4b, density: .075, light: 0xb8c8c4 },
  gold: { title: 'Золотая лихорадка', hint: 'Из зомби сыплются припасы.', score: 1, drops: 2.6, fog: 0x3a3018, bg: 0x1c1a10, density: .02, light: 0xffd27a },
  swarm: { title: 'Орда бегунов', hint: 'Почти все — бегуны. Хрупкие, но быстрые.', score: 1.3, runner: .8, health: .75, count: 1.3, fog: 0x1b2d2a, bg: 0x0f1c1f, density: .022, light: 0x9ce0c8 },
  scarce: { title: 'Пустые ящики', hint: 'Снабжения нет: припасы падают втрое реже. Очки ×1.5.', score: 1.5, drops: .35, noAirdrop: true, fog: 0x1e2226, bg: 0x101316, density: .026, light: 0x8a96a4 },
};
export function rollWaveEvent(wave, random = Math.random) {
  if (wave < 3 || wave % 5 === 0 || random() > .42) return null;
  const keys = Object.keys(WAVE_EVENTS);
  return keys[Math.floor(random() * keys.length)];
}
