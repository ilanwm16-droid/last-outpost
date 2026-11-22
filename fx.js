import * as THREE from './vendor/three.module.js';

// World-space combat effects: visible bullets, ejected brass, blood pools and
// muzzle smoke. Pools are capped so long sessions keep a flat cost.
export function createFx(scene, sound) {
  const casings = [], decals = [], bullets = [], smokes = [];
  const casingGeo = { rifle: new THREE.CylinderGeometry(.007, .007, .039, 6), shell: new THREE.CylinderGeometry(.012, .012, .06, 8) };
  const casingMat = { rifle: new THREE.MeshStandardMaterial({ color: 0xd2a64e, metalness: .85, roughness: .3 }), shell: new THREE.MeshStandardMaterial({ color: 0xb02a20, roughness: .5 }) };
  const decalGeo = new THREE.CircleGeometry(1, 16);
  const decalMats = [0x4a0605, 0x5c0a08, 0x3a0504].map(color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const acidMat = new THREE.MeshBasicMaterial({ color: 0x5fae22, transparent: true, opacity: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const bulletGeo = new THREE.BoxGeometry(.022, .022, 1);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
  const smokeGeo = new THREE.IcosahedronGeometry(.09, 0);
  const forward = new THREE.Vector3(0, 0, 1);

  function casing(pos, right, up, kind = 'rifle') {
    if (casings.length > 70) { const old = casings.shift(); scene.remove(old.mesh); }
    const mesh = new THREE.Mesh(casingGeo[kind] || casingGeo.rifle, casingMat[kind] || casingMat.rifle);
    mesh.position.copy(pos);
    scene.add(mesh);
    const vel = right.clone().multiplyScalar(1.6 + Math.random() * 1.2).addScaledVector(up, 1.4 + Math.random() * .9);
    casings.push({ mesh, vel, spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20), life: 4, bounced: 0, kind });
  }

  function decal(pos, size = .8, acid = false) {
    if (decals.length > 90) { const old = decals.shift(); scene.remove(old.mesh); old.mesh.material.dispose(); }
    const base = acid ? acidMat : decalMats[Math.floor(Math.random() * decalMats.length)];
    const mesh = new THREE.Mesh(decalGeo, base.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * 6.28;
    mesh.position.set(pos.x + (Math.random() - .5) * .3, .012 + Math.random() * .006, pos.z + (Math.random() - .5) * .3);
    mesh.scale.set(size * (.8 + Math.random() * .4), size * (.6 + Math.random() * .5), 1);
    mesh.userData.grow = .35;
    scene.add(mesh);
    decals.push({ mesh, life: 28, max: 28, target: mesh.scale.clone() });
    mesh.scale.multiplyScalar(.35);
  }

  function bullet(from, to, small = false) {
    if (bullets.length > 80) { const old = bullets.shift(); scene.remove(old.mesh); }
    const dir = to.clone().sub(from), dist = dir.length();
    if (dist < .5) return;
    dir.divideScalar(dist);
    const mesh = new THREE.Mesh(bulletGeo, bulletMat);
    mesh.quaternion.setFromUnitVectors(forward, dir);
    const len = Math.min(small ? 1.2 : 2.2, dist * .5);
    mesh.scale.set(small ? .7 : 1, small ? .7 : 1, len);
    mesh.position.copy(from).addScaledVector(dir, len / 2);
    scene.add(mesh);
    bullets.push({ mesh, from: from.clone(), dir, dist, len, travelled: len / 2 });
  }

  function smoke(pos) {
    if (smokes.length > 30) { const old = smokes.shift(); scene.remove(old.mesh); old.mesh.material.dispose(); }
    const mesh = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({ color: 0xb8b8b0, transparent: true, opacity: .32, depthWrite: false }));
    mesh.position.copy(pos);
    scene.add(mesh);
    smokes.push({ mesh, life: .7, max: .7, vel: new THREE.Vector3((Math.random() - .5) * .3, .5 + Math.random() * .4, (Math.random() - .5) * .3) });
  }

  function update(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.travelled += 340 * dt;
      if (b.travelled - b.len / 2 >= b.dist) { scene.remove(b.mesh); bullets.splice(i, 1); continue; }
      b.mesh.position.copy(b.from).addScaledVector(b.dir, Math.min(b.travelled, b.dist - b.len / 2));
    }
    for (let i = casings.length - 1; i >= 0; i--) {
      const c = casings[i];
      c.life -= dt;
      if (c.life <= 0) { scene.remove(c.mesh); casings.splice(i, 1); continue; }
      if (c.bounced < 3) {
        c.vel.y -= 14 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
        if (c.mesh.position.y < .02) {
          c.mesh.position.y = .02; c.vel.y = Math.abs(c.vel.y) * .35; c.vel.x *= .5; c.vel.z *= .5; c.spin.multiplyScalar(.5); c.bounced++;
          if (c.bounced === 1 && Math.random() < .5) sound?.('casing', { volume: .5 });
          if (c.bounced >= 3) { c.mesh.rotation.x = Math.PI / 2; }
        }
      }
      if (c.life < .5) c.mesh.scale.setScalar(c.life * 2);
    }
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i];
      d.life -= dt;
      if (d.life <= 0) { scene.remove(d.mesh); d.mesh.material.dispose(); decals.splice(i, 1); continue; }
      if (d.mesh.scale.x < d.target.x) d.mesh.scale.lerp(d.target, Math.min(1, dt * 3));
      if (d.life < 5) d.mesh.material.opacity = .85 * d.life / 5;
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      s.life -= dt;
      if (s.life <= 0) { scene.remove(s.mesh); s.mesh.material.dispose(); smokes.splice(i, 1); continue; }
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(1 + (1 - s.life / s.max) * 4);
      s.mesh.material.opacity = .32 * s.life / s.max;
    }
  }

  function clear() {
    for (const list of [casings, bullets]) { for (const x of list) scene.remove(x.mesh); list.length = 0; }
    for (const list of [decals, smokes]) { for (const x of list) { scene.remove(x.mesh); x.mesh.material.dispose(); } list.length = 0; }
  }

  return { casing, decal, bullet, smoke, update, clear };
}
