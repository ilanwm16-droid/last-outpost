// Campaign progress: each player keeps their own save in localStorage.
// The save holds the perk build a player had at the start of every wave they
// reached, so a run can restart from any of those waves. The host picks the
// start wave for the whole squad; every player then restores their own build
// for that wave (or gets random perks if they never got that far).
import {PERKS, sanitizePerks, rollPerks} from './perks.js';

const KEY = 'outpost.save';
const MAX_WAVE = 9999;

export function clampWave(n) {
  return Math.max(1, Math.min(MAX_WAVE, Math.floor(Number(n) || 1)));
}

export function emptySave() {
  return {v: 1, top: 1, perks: {}};
}

// Accepts anything (corrupt storage, an old format) and returns a valid save.
export function normalizeSave(raw) {
  const out = emptySave();
  if (!raw || typeof raw !== 'object') return out;
  out.top = clampWave(raw.top);
  if (raw.perks && typeof raw.perks === 'object') {
    for (const [k, p] of Object.entries(raw.perks)) {
      const w = Math.floor(Number(k));
      if (w >= 1 && w <= MAX_WAVE) out.perks[w] = sanitizePerks(p);
    }
  }
  return out;
}

export function loadSave(storage = globalThis.localStorage) {
  try { return normalizeSave(JSON.parse(storage?.getItem(KEY) || 'null')); } catch { return emptySave(); }
}

export function writeSave(save, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(save)); } catch {}
}

// Remembers the build a player has when wave `w` starts. Returns true when the save changed.
export function recordWave(save, w, perks) {
  w = clampWave(w);
  const p = sanitizePerks(perks), before = JSON.stringify(save.perks[w] || null), top = save.top;
  save.perks[w] = p;
  save.top = Math.max(save.top, w);
  return before !== JSON.stringify(p) || top !== save.top;
}

// Highest wave this player may start from. `best` is the legacy record (highest wave seen).
export function maxStart(save, best = 0) {
  return clampWave(Math.max(save.top, Math.floor(Number(best) || 0)));
}

export function perkCount(p) {
  return Object.values(p || {}).reduce((s, n) => s + n, 0);
}

// The build to start wave `w` with: the saved one for that wave, else the closest
// earlier saved one, topped up with random perks to one per completed wave
// (w - 1), as far as the perk pool allows.
export function startPerks(save, w, random = Math.random) {
  w = clampWave(w);
  let base = {};
  for (let k = w; k >= 1; k--) if (save.perks[k]) { base = save.perks[k]; break; }
  const p = sanitizePerks(base);
  while (perkCount(p) < w - 1) {
    const [id] = rollPerks(p, 1, random);
    if (!id) break;
    p[id] = (p[id] || 0) + 1;
  }
  return p;
}

// True when wave `w` restores a build the player actually picked (not random top-up).
export function hasBuild(save, w) {
  w = clampWave(w);
  for (let k = w; k >= 1; k--) if (save.perks[k]) return perkCount(save.perks[k]) >= Math.min(w - 1, maxPerkLevels());
  return w === 1;
}

function maxPerkLevels() {
  return Object.values(PERKS).reduce((s, p) => s + p.max, 0);
}
