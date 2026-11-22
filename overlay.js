import * as THREE from './vendor/three.module.js';

// Screen-space combat feedback drawn in the DOM: floating damage numbers,
// a kill feed and directional damage indicators.
export function createOverlay(camera) {
  const layer = document.getElementById('fxLayer'), feed = document.getElementById('killFeed'), ring = document.getElementById('dirLayer');
  const numbers = [], v = new THREE.Vector3();

  function damageNumber(pos, amount, head = false) {
    if (numbers.length > 40) numbers.shift().el.remove();
    const el = document.createElement('div');
    el.className = 'dmg-num' + (head ? ' head' : '');
    el.textContent = Math.max(1, Math.round(amount));
    layer.appendChild(el);
    numbers.push({ el, pos: pos.clone(), life: .85, drift: (Math.random() - .5) * 60 });
  }

  function update(dt) {
    for (let i = numbers.length - 1; i >= 0; i--) {
      const n = numbers[i];
      n.life -= dt;
      if (n.life <= 0) { n.el.remove(); numbers.splice(i, 1); continue; }
      const age = .85 - n.life;
      v.copy(n.pos); v.y += age * .9; v.project(camera);
      if (v.z > 1) { n.el.style.opacity = 0; continue; }
      const x = (v.x * .5 + .5) * innerWidth + n.drift * age, y = (-v.y * .5 + .5) * innerHeight;
      n.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${1 + Math.max(0, .2 - age) * 3})`;
      n.el.style.opacity = Math.min(1, n.life * 3);
    }
  }

  function kill(by, victim, head = false) {
    const row = document.createElement('div');
    row.className = 'feed-row' + (head ? ' head' : '');
    const a = document.createElement('b'), mid = document.createElement('span'), c = document.createElement('i');
    a.textContent = by; mid.textContent = head ? '⌖' : '✕'; c.textContent = victim;
    row.append(a, mid, c);
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => { row.classList.add('out'); setTimeout(() => row.remove(), 450); }, 3800);
  }

  function hurtFrom(angle) {
    const el = document.createElement('i');
    el.className = 'dir-ind';
    el.style.setProperty('--a', angle + 'rad');
    ring.appendChild(el);
    while (ring.children.length > 6) ring.firstChild.remove();
    setTimeout(() => el.remove(), 1000);
  }

  function clear() { for (const n of numbers) n.el.remove(); numbers.length = 0; feed.replaceChildren(); ring.replaceChildren(); }

  return { damageNumber, update, kill, hurtFrom, clear };
}
