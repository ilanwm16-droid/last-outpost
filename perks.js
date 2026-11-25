// Roguelite upgrades offered between waves. Each player owns their own set;
// the host reads guests' sets to apply health-related perks authoritatively.
export const PERKS = {
  caliber: { icon: '✦', title: 'Крупный калибр', desc: '+20% урона из всего оружия', max: 4 },
  hands: { icon: '⟳', title: 'Быстрые руки', desc: 'Перезарядка на 25% быстрее', max: 3 },
  steady: { icon: '⌖', title: 'Твёрдая рука', desc: 'Отдача и разброс −30%', max: 2 },
  pierce: { icon: '➶', title: 'Бронебойные', desc: 'Пули прошивают ещё одного зомби', max: 2 },
  head: { icon: '☠', title: 'Охотник за головами', desc: 'Урон в голову +35%', max: 3 },
  mag: { icon: '▥', title: 'Расширенный магазин', desc: 'Магазины АК и дробовика +40%', max: 2 },
  rate: { icon: '⚡', title: 'Лёгкий спуск', desc: 'АК стреляет на 13% быстрее', max: 2 },
  vamp: { icon: '♥', title: 'Вампиризм', desc: '+3 здоровья за каждое убийство', max: 3 },
  tough: { icon: '⛨', title: 'Железная кожа', desc: '+25 к максимуму здоровья', max: 3 },
  regen: { icon: '✚', title: 'Второе дыхание', desc: 'Регенерация 2 HP/с после 4 с без урона', max: 2 },
  legs: { icon: '»', title: 'Адреналин', desc: 'Скорость бега +12%', max: 2 },
  pack: { icon: '◎', title: 'Подрывник', desc: '+2 гранаты сейчас и +1 к запасу', max: 2 },
  second: { icon: '↺', title: 'Второй шанс', desc: 'Раз за волну сам встаёшь через 5 с после падения', max: 1 },
  medic: { icon: '⊕', title: 'Санитар', desc: 'Поднимаешь напарников на 40% быстрее, им +25 здоровья', max: 2 },
};

const level = (p, id) => Math.max(0, Math.min(PERKS[id].max, Math.floor(Number(p?.[id]) || 0)));

export function perkMods(p = {}) {
  return {
    damage: 1 + .2 * level(p, 'caliber'),
    reload: Math.pow(.75, level(p, 'hands')),
    recoil: Math.pow(.7, level(p, 'steady')),
    spread: Math.pow(.7, level(p, 'steady')),
    pen: level(p, 'pierce'),
    head: 1 + .35 * level(p, 'head'),
    mag: 1 + .4 * level(p, 'mag'),
    fireRate: Math.pow(.87, level(p, 'rate')),
    vamp: 3 * level(p, 'vamp'),
    maxHp: 25 * level(p, 'tough'),
    regen: 2 * level(p, 'regen'),
    speed: 1 + .12 * level(p, 'legs'),
    grenades: level(p, 'pack'),
    // Downed state: self-revive once per wave, selfReviveDelay s after going down.
    selfRevive: level(p, 'second') > 0,
    selfReviveDelay: 5,
    // Revive progress speed multiplier when THIS player revives a teammate
    // (base 3 s hold -> 2.14 s at level 1, 1.67 s at level 2).
    reviveSpeed: 1 + .4 * level(p, 'medic'),
    // Extra HP the revived teammate gets on top of the base 50.
    reviveBonus: 25 * level(p, 'medic'),
  };
}

export function sanitizePerks(p) {
  const out = {};
  if (p && typeof p === 'object') for (const id of Object.keys(PERKS)) { const n = level(p, id); if (n > 0) out[id] = n; }
  return out;
}

export function rollPerks(owned = {}, count = 3, random = Math.random) {
  const pool = Object.keys(PERKS).filter(id => level(owned, id) < PERKS[id].max), out = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
}
