import * as THREE from './vendor/three.module.js';

// Reused primitive geometry keeps even a large wave inexpensive to draw.
const cube = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
const cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const sphere = new THREE.IcosahedronGeometry(1, 1);
const sphereLo = new THREE.IcosahedronGeometry(1, 0);
const cone = new THREE.ConeGeometry(1, 1, 8);
const UP = new THREE.Vector3(0, 1, 0);
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .84, ...extra });
const M = {
  skin: material(0x89977a), skinDark: material(0x5c6a54), skinRunner: material(0x9c9c80),
  skinBrute: material(0x76846e), shirt: material(0x3b4e48), shirtDark: material(0x263c38),
  runner: material(0x855338), pants: material(0x29302d), pantsLight: material(0x414642),
  boots: material(0x171e1c), black: material(0x111815), glove: material(0x29352e),
  strap: material(0x3f4034), metal: material(0x35423f, { metalness: .65, roughness: .36 }),
  darkMetal: material(0x18221f, { metalness: .65, roughness: .4 }),
  bolt: material(0x89938b, { metalness: .75, roughness: .28 }),
  wood: material(0x98552e), woodDark: material(0x673b24),
  olive: material(0x5f6740, { metalness: .22 }), oliveDark: material(0x3d482f),
  gold: material(0xbf9c58, { metalness: .55 }), cloth: material(0x4b5342),
  wound: material(0x493b30), mouth: material(0x1d2921), teeth: material(0xa5a68d),
  eye: material(0xffb84c, { emissive: 0xff8f21, emissiveIntensity: 2.7 }),
  patch: material(0xb7ab79),
  polymer: material(0x1d2220, { roughness: .7 }),
  lens: material(0x6cc4ff, { emissive: 0x1d74ff, emissiveIntensity: .9, metalness: .3, roughness: .15 }),
};
function mesh(geometry, mat, parent, x, y, z, sx, sy, sz) {
  const part = new THREE.Mesh(geometry, mat);
  part.position.set(x, y, z);
  part.scale.set(sx, sy, sz);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}
const box = (parent, mat, x, y, z, sx, sy, sz) => mesh(cube, mat, parent, x, y, z, sx, sy, sz);
function tube(parent, mat, x, y, z, radius, length) {
  const result = mesh(cylinder, mat, parent, x, y, z, radius, length, radius);
  result.rotation.x = Math.PI / 2;
  return result;
}
const rbox = (parent, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { const b = box(parent, mat, x, y, z, sx, sy, sz); b.rotation.set(rx, ry, rz); return b; };
const ball = (parent, mat, x, y, z, sx, sy = sx, sz = sx) => mesh(sphere, mat, parent, x, y, z, sx, sy, sz);
const lump = (parent, mat, x, y, z, sx, sy = sx, sz = sx) => mesh(sphereLo, mat, parent, x, y, z, sx, sy, sz);
// A primitive stretched between two points: limbs, ribs, claws, chains, rebar.
// For boxes w/d are full widths; for round geometry they are radii.
function seg(parent, mat, a, b, w, d = w, geometry = cube) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), length = dir.length();
  const part = mesh(geometry, mat, parent, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, w, length, d);
  part.quaternion.setFromUnitVectors(UP, dir.normalize());
  return part;
}
const spike = (parent, mat, a, b, r) => seg(parent, mat, a, b, r, r, cone);
const limb = (parent, mat, a, b, r) => seg(parent, mat, a, b, r, r, cyl6);
function joint(parent, x, y, z, rx = 0, ry = 0, rz = 0) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  j.rotation.set(rx, ry, rz);
  parent.add(j);
  return j;
}

const zombieSurface = material(0xffffff, { vertexColors: true, roughness: .9 });
const glowMaterials = new Map();
function glowMaterial(source) {
  const key = source.emissive.getHex() + ':' + source.emissiveIntensity;
  if (!glowMaterials.has(key)) glowMaterials.set(key, material(0xffffff, { vertexColors: true, emissive: source.emissive.getHex(), emissiveIntensity: source.emissiveIntensity }));
  return glowMaterials.get(key);
}
const zombieTemplates = new Map();
const tones = new Map();
const tone = hex => { if (!tones.has(hex)) tones.set(hex, material(hex)); return tones.get(hex); };
const glows = new Map();
const glowTone = (hex, intensity = 1.8) => { const key = hex + ':' + intensity; if (!glows.has(key)) glows.set(key, material(hex, { emissive: hex, emissiveIntensity: intensity })); return glows.get(key); };
// Gore and gear palette. Every color is baked into vertex colors per joint.
const G = {
  blood: material(0x5a0b09), bloodBright: material(0x8c1510), bone: material(0xd8d0b4), flesh: material(0x7a2a22),
  dark: material(0x101010), hair: material(0x211d18), shoe: material(0x1a1a17), vest: material(0x39412f),
  plate: material(0x2b3127), helmet: material(0x353e2f), rock: material(0x4d4842), rockDark: material(0x2d2a26),
  spike: material(0xcfc4a4), chain: material(0x55595a),
  eyeRed: material(0xff4a3a, { emissive: 0xff1c08, emissiveIntensity: 3.2 }),
  pus: material(0xb6ff5c, { emissive: 0x6dff1a, emissiveIntensity: 1.9 }),
  core: material(0xffa040, { emissive: 0xff3c08, emissiveIntensity: 3.4 }),
  // v4 additions
  acid: material(0x9dff3a, { emissive: 0x5cff10, emissiveIntensity: 2.4 }),
  acidStain: material(0x4d6a1c), mouthGlow: material(0xff5a2a, { emissive: 0xff2a0a, emissiveIntensity: 2.2 }),
  magma: material(0xff8a30, { emissive: 0xff4a0c, emissiveIntensity: 2.6 }),
  hot: material(0xff7a2a, { emissive: 0xff4a10, emissiveIntensity: 2.2 }),
  police: material(0x4a7dff, { emissive: 0x2f62ff, emissiveIntensity: 2.2 }), policeRed: material(0xff3a30, { emissive: 0xff1410, emissiveIntensity: 2.2 }),
  riot: material(0x22282e), riotPlate: material(0x30373d), visor: material(0x1e2c36), shield: material(0x3e4d58), shieldWin: material(0x86a0b2), stripe: material(0xd2c98f),
  leather: material(0x4a3020), apron: material(0x6a4a32), burlap: material(0x8b7a56), rope: material(0x9a8455), steel: material(0x8d9592), rebar: material(0x463a30),
  gown: material(0x8a978f), gownDark: material(0x5d6a63),
};
const SKIN = [0x8fa07f, 0x9ba5a9, 0xaaa274], SKIN_DARK = [0x5d6b53, 0x666f76, 0x76704d];
const SHIRT = [0x3c5465, 0xb4ae9b, 0x7a2f2a, 0x2b3233], PANTS = [0x2f4157, 0x6a6148, 0x1e2223];

// Bake the rigid details into colored triangles while retaining each animated
// joint. Glowing parts (eyes, pustules, cores) keep a separate emissive mesh.
function mergeRigid(node) {
  node.updateWorldMatrix(true, true);
  const inverse = node.matrixWorld.clone().invert();
  const buckets = new Map();
  node.traverse(part => {
    if (!part.isMesh) return;
    const transformed = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    transformed.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, part.matrixWorld));
    const glow = part.material.emissive && part.material.emissive.getHex() !== 0;
    const target = glow ? glowMaterial(part.material) : zombieSurface;
    if (!buckets.has(target)) buckets.set(target, []);
    buckets.get(target).push({ geometry: transformed, color: part.material.color });
  });
  node.clear();
  for (const [mat, pieces] of buckets) {
    const count = pieces.reduce((sum, part) => sum + part.geometry.attributes.position.count, 0);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    let offset = 0;
    for (const { geometry, color } of pieces) {
      const length = geometry.attributes.position.count * 3;
      positions.set(geometry.attributes.position.array, offset);
      normals.set(geometry.attributes.normal.array, offset);
      for (let i = offset; i < offset + length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
      offset += length;
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, mat);
    merged.castShadow = true;
    merged.receiveShadow = true;
    node.add(merged);
  }
}

// Name and bake every animated node. Sub-joints (jaw, throat, sacs, hook, rifle)
// are hoisted onto their nearest animated ancestor, detached while that ancestor
// merges, then re-attached so they stay independently animatable.
function finishRig(g, joints, subs = {}) {
  const rig = Object.entries({ ...joints, ...subs }), nodes = new Set(rig.map(([, node]) => node)), links = [];
  g.updateMatrixWorld(true);
  for (const [name, node] of rig) {
    node.name = name;
    let owner = node.parent;
    while (owner && owner !== g && !nodes.has(owner)) owner = owner.parent;
    if (owner !== node.parent) owner.attach(node);
    links.push([node, owner]);
  }
  for (const [node, owner] of links) owner.remove(node);
  for (const [node] of links) mergeRigid(node);
  for (const [node, owner] of links) owner.add(node);
  return g;
}
// Re-parent a prop built in model space onto a joint, keeping its placement.
function attachTo(g, jointNode, prop) { g.updateMatrixWorld(true); jointNode.attach(prop); return prop; }

const JOINTS = ['leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'head', 'torso'];
const EXTRAS = ['jaw', 'throat', 'sacs', 'hook', 'rifle', 'muzzle'];
// Clones share geometry and materials with the template. userData exposes every
// joint plus `rest` (the template rotation of each joint, [x,y,z]) so animation
// can add offsets on top of the authored pose instead of overwriting it.
function cloneRig(template, data) {
  const group = template.clone(true), rest = {};
  for (const name of [...JOINTS, ...EXTRAS]) {
    const node = group.getObjectByName(name);
    if (!node && EXTRAS.includes(name)) continue;
    data[name] = node;
    if (node) rest[name] = [node.rotation.x, node.rotation.y, node.rotation.z];
  }
  data.rest = rest;
  group.userData = data;
  return group;
}
// World height of the head's own geometry centre (excludes jaw/throat sub-joints).
function measureHeadY(template) {
  template.updateMatrixWorld(true);
  const head = template.getObjectByName('head'), bounds = new THREE.Box3();
  for (const part of head.children) if (part.isMesh) bounds.expandByObject(part);
  return +((bounds.min.y + bounds.max.y) / 2).toFixed(3);
}

// Legacy types keep their exact height/headY values; new types measure their head.
const HEIGHTS = { walker: 1.95, runner: 1.86, brute: 2.25, exploder: 2.0, boss: 3.45, titan: 3.45, crawler: .7, spitter: 1.95, screamer: 2.3, armored: 2.0, brood: 3.3, butcher: 2.8, father: 5.0 };
const LEGACY = new Set(['walker', 'runner', 'brute', 'exploder', 'boss', 'titan']);
const BOSSES = new Set(['boss', 'titan', 'brood', 'butcher', 'father']);
const headCache = new Map();
function cloneZombie(template, type, key) {
  const height = HEIGHTS[type] || 1.95;
  let headY;
  if (LEGACY.has(type) || !HEIGHTS[type]) headY = type === 'boss' || type === 'titan' ? 2.75 : height * .79;
  else { if (!headCache.has(key)) headCache.set(key, measureHeadY(template)); headY = headCache.get(key); }
  return cloneRig(template, { type, height, headY });
}

// The standard rotting face shared by the humanoid zombie types.
function zombieFace(head, skin, skinD, v, eyes = M.eye, hair = true) {
  box(head, skin, 0, -.1, -.02, .12, .1, .12);
  mesh(sphere, skin, head, 0, .06, 0, .15, .17, .155);
  box(head, skin, 0, -.04, .03, .2, .12, .2);
  box(head, skinD, 0, .11, .07, .24, .045, .14);
  box(head, G.dark, -.06, .045, .128, .075, .055, .02);
  box(head, G.dark, .06, .045, .128, .075, .055, .02);
  if (eyes) {
    box(head, eyes, -.06, .045, .14, .052, .028, .02);
    if (v !== 1) box(head, eyes, .06, .045, .14, .052, .028, .02);
  }
  box(head, skinD, 0, -.005, .15, .045, .06, .05);
  const jaw = box(head, skinD, 0, -.15, .06, .15, .05, .15); jaw.rotation.x = .38;
  box(head, G.flesh, 0, -.1, .125, .12, .055, .02);
  box(head, M.teeth, 0, -.075, .134, .1, .016, .016);
  box(head, M.teeth, 0, -.135, .145, .09, .016, .016);
  box(head, G.bloodBright, .02, -.18, .13, .05, .09, .02);
  if (hair) {
    if (v === 2) { box(head, G.flesh, .07, .17, .04, .09, .04, .1); box(head, G.bone, .07, .195, .04, .065, .02, .075); }
    else for (let i = 0; i < 5; i++) box(head, G.hair, -.1 + i * .05, .19 + (i % 2) * .015, -.02 + (i % 3) * .02, .055, .05, .18);
  }
  box(head, skin, -.16, .03, 0, .03, .07, .05);
  box(head, skin, .16, .03, 0, .03, .06, .05);
}

function buildZombie(type, v) {
  const g = new THREE.Group();
  const runner = type === 'runner', brute = type === 'brute', bloat = type === 'exploder';
  const skin = tone(SKIN[v]), skinD = tone(SKIN_DARK[v]);
  const shirt = tone(SHIRT[(v + (runner ? 1 : 0) + (bloat ? 2 : 0)) % 4]), pants = tone(PANTS[v]);
  const W = brute ? 1.28 : runner ? .86 : bloat ? 1.12 : 1;

  function leg(side) {
    const p = new THREE.Group(); p.position.set(side * .12 * W, .9, 0); g.add(p);
    box(p, pants, 0, -.21, 0, .19 * W, .43, .21 * W);
    const torn = runner || (v === 1 && side < 0);
    box(p, torn ? skin : pants, 0, -.52, .01, .16 * W, .3, .18 * W);
    if (torn) { box(p, G.blood, 0, -.43, .1 * W, .12, .07, .02); box(p, pants, 0, -.38, 0, .2 * W, .06, .22 * W); }
    const bare = v === 2 && side > 0;
    box(p, bare ? skinD : G.shoe, 0, -.8, .05, .19 * W, .12, .32);
    if (bare) for (let t = -1; t <= 1; t++) box(p, skinD, t * .05, -.82, .22, .035, .05, .05);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);

  const torso = new THREE.Group(); torso.position.set(0, .95, 0); torso.rotation.x = runner ? .34 : .2; g.add(torso);
  box(torso, pants, 0, -.02, 0, .4 * W, .17, .25 * W);
  box(torso, G.shoe, 0, .07, 0, .42 * W, .05, .27 * W);
  box(torso, G.chain, .1, .07, .14 * W, .06, .04, .02);
  if (bloat) {
    mesh(sphere, skin, torso, 0, .36, .07, .37, .39, .34);
    mesh(sphere, skinD, torso, 0, .3, .03, .3, .3, .3);
    for (const [x, y, z, r] of [[.18, .42, .3, .07], [-.15, .27, .33, .06], [.05, .57, .31, .05], [-.24, .5, .19, .06], [.27, .24, .19, .05], [-.05, .15, .33, .045], [.16, .5, -.24, .06], [-.12, .3, -.27, .05]]) mesh(sphere, G.pus, torso, x, y, z, r, r, r * .85);
    box(torso, shirt, 0, .66, 0, .5, .16, .3);
    box(torso, G.blood, .2, .5, .25, .08, .16, .03);
  } else if (runner) {
    box(torso, skin, 0, .33, 0, .36, .5, .22);
    box(torso, G.flesh, .08, .3, .107, .17, .3, .01);
    for (let i = 0; i < 4; i++) box(torso, G.bone, .08, .19 + i * .075, .113, .15, .022, .02);
    box(torso, G.blood, -.1, .16, .112, .08, .16, .01);
    box(torso, skinD, 0, .55, -.11, .3, .06, .02);
    // Exposed spine knobs break up the back silhouette.
    for (let i = 0; i < 5; i++) box(torso, G.bone, 0, .14 + i * .09, -.118, .045, .035, .03);
    rbox(torso, shirt, -.12, .5, .02, .16, .14, .24, 0, 0, .5);
  } else {
    box(torso, shirt, 0, .34, 0, .48 * W, .52, .27 * W);
    box(torso, G.flesh, .12 * W, .28, .137 * W, .14, .2, .012);
    for (let i = 0; i < 3; i++) box(torso, G.bone, .12 * W, .21 + i * .07, .142 * W, .13, .02, .012);
    const flapA = box(torso, shirt, -.15 * W, .03, .11 * W, .12, .17, .02); flapA.rotation.z = .16;
    box(torso, shirt, .1 * W, .01, .12 * W, .1, .12, .02);
    box(torso, G.blood, -.08, .46, .139 * W, .12, .11, .01);
    box(torso, G.bloodBright, .05, .12, .138 * W, .2, .05, .01);
    box(torso, G.blood, -.12, .3, -.137 * W, .14, .2, .01);
    // Ragged hem strips at the back.
    for (let i = 0; i < 3; i++) rbox(torso, shirt, (i - 1) * .14 * W, .02, -.12 * W, .1, .14, .02, .15, 0, (i - 1) * .25);
    if (brute) {
      box(torso, G.vest, 0, .35, 0, .56, .47, .35);
      box(torso, G.plate, 0, .39, .178, .4, .3, .03);
      for (let i = 0; i < 3; i++) box(torso, G.vest, -.15 + i * .15, .17, .19, .11, .12, .06);
      box(torso, G.plate, -.33, .56, 0, .2, .1, .37);
      box(torso, G.plate, .33, .56, 0, .2, .1, .37);
      box(torso, G.bloodBright, .14, .45, .195, .1, .14, .01);
      // Rebar driven through the back: a strong, readable silhouette break.
      seg(torso, G.rebar, [-.08, .15, -.05], [-.32, .82, -.42], .035);
      seg(torso, G.rebar, [.12, .3, -.1], [.36, .68, -.4], .03);
    }
  }

  const head = new THREE.Group();
  head.position.set(0, (bloat ? 1.74 : 1.62) + (brute ? .08 : 0), runner ? .22 : .13);
  head.rotation.z = (v - 1) * .13; head.rotation.x = runner ? .18 : .05; g.add(head);
  zombieFace(head, skin, skinD, v);
  if (brute) { mesh(sphere, G.helmet, head, 0, .13, -.01, .19, .12, .19); box(head, G.helmet, 0, .08, .15, .3, .03, .06); box(head, G.chain, .17, .02, .02, .02, .1, .02); }

  function arm(side) {
    const p = new THREE.Group(); p.position.set(side * .29 * W, 1.43 + (brute ? .06 : 0), .06); p.rotation.x = -1.1; p.rotation.z = side * -.12; g.add(p);
    const sleeve = !runner && !(v === 2 && side > 0);
    box(p, sleeve ? shirt : skin, 0, -.15, 0, .15 * W, .3, .16 * W);
    if (!sleeve) box(p, G.blood, 0, -.08, .085 * W, .1, .1, .01);
    const fore = new THREE.Group(); fore.position.set(0, -.3, 0); fore.rotation.x = -.25; p.add(fore);
    box(fore, skin, 0, -.15, 0, .11 * W, .3, .12 * W);
    if (v === 1 && side < 0) { box(fore, G.flesh, 0, -.29, 0, .1, .05, .1); box(fore, G.bone, 0, -.36, 0, .04, .12, .04); }
    else {
      box(fore, skinD, 0, -.33, .01, .13 * W, .08, .12 * W);
      for (let f = -1; f <= 1; f++) box(fore, skinD, f * .035 * W, -.41, .03, .022, .1, .025).rotation.x = .35;
    }
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  g.scale.setScalar(brute ? 1.1 : runner ? .95 : 1);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso });
}

function buildBoss() {
  const g = new THREE.Group();
  const SK = tone(0x77604f), SKD = tone(0x4a3a30), R = G.rock, RD = G.rockDark;
  function leg(side) {
    const p = new THREE.Group(); p.position.set(side * .42, 1.32, 0); g.add(p);
    box(p, SK, 0, -.32, 0, .44, .7, .48);
    box(p, R, side * .05, -.28, .25, .38, .42, .08);
    box(p, G.magma, side * .05, -.3, .292, .05, .3, .012);
    box(p, SKD, 0, -.85, .02, .38, .5, .42);
    box(p, R, 0, -.82, .22, .3, .3, .06);
    box(p, RD, 0, -1.22, .1, .5, .2, .72);
    for (let t = -1; t <= 1; t++) mesh(cone, G.spike, p, t * .14, -1.24, .5, .045, .14, .045).rotation.x = Math.PI / 2;
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = new THREE.Group(); torso.position.set(0, 1.32, 0); torso.rotation.x = .38; g.add(torso);
  box(torso, SKD, 0, .05, 0, .92, .32, .62);
  box(torso, G.chain, 0, .18, .32, .8, .05, .03);
  box(torso, SK, 0, .52, .02, 1.05, .74, .76);
  box(torso, SK, 0, 1.07, -.02, 1.38, .72, .88);
  box(torso, R, 0, 1.12, .44, 1.02, .46, .1);
  // Magma seams in the chest plate read as a glowing outline in the dark.
  rbox(torso, G.magma, -.22, 1.14, .497, .32, .025, .012, 0, 0, .35);
  rbox(torso, G.magma, .25, 1.08, .497, .28, .025, .012, 0, 0, -.5);
  box(torso, G.magma, .02, 1.25, .497, .025, .2, .012);
  box(torso, RD, -.3, .62, .4, .3, .3, .06);
  box(torso, RD, .32, .5, .39, .26, .26, .06);
  box(torso, G.dark, 0, .82, .44, .42, .42, .04);
  mesh(sphere, G.core, torso, 0, .82, .48, .17, .17, .1);
  for (let i = 0; i < 4; i++) box(torso, G.bone, 0, .66 + i * .1, .455, .5, .03, .03);
  box(torso, R, -.8, 1.36, 0, .56, .42, .74);
  box(torso, R, .8, 1.36, 0, .56, .42, .74);
  for (let i = 0; i < 5; i++) {
    const s = mesh(cone, G.spike, torso, (i - 2) * .22, 1.25 + Math.abs(i - 2) * -.08, -.5, .09, .48 - Math.abs(i - 2) * .08, .09);
    s.rotation.x = -.95;
    if (i < 4) box(torso, G.magma, (i - 1.5) * .22, 1.16, -.47, .05, .1, .03);
  }
  for (const x of [-.85, .85]) for (let i = 0; i < 2; i++) mesh(cone, G.spike, torso, x + (i - .5) * .2, 1.62, -.05 + i * .15, .07, .3, .07);
  box(torso, G.bloodBright, .4, .9, .45, .14, .3, .02);
  box(torso, G.blood, -.45, .35, .39, .2, .16, .02);

  const head = new THREE.Group(); head.position.set(0, 2.82, .62); g.add(head);
  mesh(sphere, SK, head, 0, .04, 0, .33, .3, .33);
  box(head, R, 0, .2, .12, .64, .13, .42);
  box(head, G.dark, -.13, .07, .29, .14, .08, .04);
  box(head, G.dark, .13, .07, .29, .14, .08, .04);
  box(head, G.eyeRed, -.13, .07, .31, .11, .05, .03);
  box(head, G.eyeRed, .13, .07, .31, .11, .05, .03);
  box(head, G.flesh, 0, -.13, .27, .36, .1, .04);
  for (let i = 0; i < 5; i++) mesh(cone, G.spike, head, -.16 + i * .08, -.08, .3, .025, .09, .025).rotation.x = Math.PI;
  for (const side of [-1, 1]) { const horn = mesh(cone, G.spike, head, side * .27, .33, -.02, .08, .42, .08); horn.rotation.z = -side * .55; horn.rotation.x = -.35; }
  // The jaw is its own joint so roars and slams can open it.
  const jaw = joint(head, 0, -.14, .02, .32);
  box(jaw, SKD, 0, -.08, .12, .46, .14, .38);
  box(jaw, G.mouthGlow, 0, .0, .14, .3, .03, .24);
  for (let i = 0; i < 4; i++) mesh(cone, G.spike, jaw, -.12 + i * .08, .04, .28, .022, .08, .022);

  function arm(side) {
    const p = new THREE.Group(); p.position.set(side * .92, 2.4, .2); p.rotation.x = -.55; p.rotation.z = side * -.18; g.add(p);
    box(p, SK, 0, -.38, 0, .44, .84, .48);
    box(p, R, side * .2, -.28, 0, .12, .62, .5);
    const fore = new THREE.Group(); fore.position.set(0, -.8, 0); fore.rotation.x = -.3; p.add(fore);
    box(fore, SKD, 0, -.38, 0, .5, .8, .52);
    box(fore, G.chain, 0, -.15, 0, .54, .06, .56);
    box(fore, RD, 0, -.95, .02, .66, .56, .66);
    box(fore, G.magma, 0, -.9, .356, .5, .03, .012);
    box(fore, G.magma, side * .12, -1.0, .356, .03, .3, .012);
    for (let k = -1; k <= 1; k++) mesh(cone, G.spike, fore, k * .18, -1.0, .36, .055, .2, .055).rotation.x = Math.PI / 2;
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { jaw });
}

// «Ползун»: a legless torso dragging itself on its arms. Low, wide, quick.
function buildCrawler(v) {
  const g = new THREE.Group();
  const skin = tone(SKIN[v]), skinD = tone(SKIN_DARK[v]), shirt = tone(SHIRT[(v + 3) % 4]), pants = tone(PANTS[v]);
  const torso = joint(g, 0, .3, 0);
  rbox(torso, skin, 0, .12, .15, .42, .26, .4, -.22);
  rbox(torso, shirt, 0, .24, .1, .47, .1, .36, -.22);
  for (const side of [-1, 1]) rbox(torso, shirt, side * .22, .08, .1, .04, .2, .3, -.2, 0, side * .15);
  for (let i = 0; i < 3; i++) box(torso, G.bone, .14, .02 + i * .06, .31 - i * .015, .12, .02, .02);
  rbox(torso, skinD, 0, -.02, -.2, .34, .18, .36, .12);
  box(torso, G.blood, 0, -.11, -.15, .3, .02, .4);
  box(torso, G.flesh, 0, -.06, -.4, .3, .15, .06);
  box(torso, G.bloodBright, .05, -.04, -.435, .2, .08, .02);
  limb(torso, G.flesh, [-.05, -.08, -.4], [-.14, -.27, -.74], .035);
  limb(torso, G.flesh, [.06, -.1, -.42], [.16, -.28, -.62], .03);
  limb(torso, G.blood, [0, -.1, -.42], [.02, -.29, -.86], .022);
  for (let i = 0; i < 6; i++) box(torso, G.bone, 0, .27 - i * .045, .24 - i * .11, .05, .035, .06);
  lump(torso, G.pus, .13, .23, .02, .055);
  lump(torso, G.pus, -.11, .18, -.14, .045);
  const head = joint(g, 0, .47, .5, -.28);
  zombieFace(head, skin, skinD, v);

  function stump(side) {
    const p = joint(g, side * .11, .24, -.44);
    rbox(p, pants, 0, -.06, -.18, .15, .14, .34, .1);
    box(p, G.flesh, 0, -.08, -.35, .12, .11, .03);
    limb(p, G.bone, [0, -.08, -.34], [0, -.1, -.42], .025);
    if (v === 2 && side > 0) {
      rbox(p, pants, 0, -.15, -.52, .13, .12, .34, .15);
      box(p, G.shoe, 0, -.2, -.74, .14, .1, .22);
    }
    return p;
  }
  const leftLeg = stump(-1), rightLeg = stump(1);

  function arm(side) {
    const p = joint(g, side * .25, .56, .3, -.5, 0, side * -.15);
    const sleeve = v !== 1 || side > 0;
    box(p, sleeve ? shirt : skin, 0, -.15, 0, .14, .3, .15);
    const fore = joint(p, 0, -.3, 0, .45);
    box(fore, skin, 0, -.09, 0, .11, .18, .12);
    box(fore, skinD, 0, -.2, .03, .15, .06, .16);
    for (let f = -1; f <= 1; f++) spike(fore, G.bone, [f * .045, -.21, .1], [f * .055, -.23, .19], .016);
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso });
}

// «Плевун»: emaciated, hunched, with a swollen glowing acid throat.
function buildSpitter(v) {
  const g = new THREE.Group();
  const skin = tone([0x8f9c78, 0x8c9a8f, 0xa09c70][v]), skinD = tone(SKIN_DARK[v]), rag = tone(SHIRT[(v + 1) % 4]), pants = tone(PANTS[(v + 2) % 3]);
  function leg(side) {
    const p = joint(g, side * .1, .92, 0);
    box(p, pants, 0, -.2, 0, .15, .42, .17);
    rbox(p, pants, 0, -.43, .03, .16, .06, .18, .2);
    box(p, skin, 0, -.6, .02, .1, .34, .11);
    box(p, skinD, 0, -.86, .07, .12, .08, .26);
    for (let t = -1; t <= 1; t++) box(p, skinD, t * .035, -.87, .21, .025, .04, .05);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, .95, 0, .34);
  box(torso, pants, 0, -.02, 0, .32, .16, .2);
  box(torso, skin, 0, .3, 0, .34, .5, .2);
  box(torso, skinD, 0, .12, .07, .26, .14, .08);
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) box(torso, G.bone, side * .09, .24 + i * .065, .104, .11, .018, .016);
  for (let i = 0; i < 5; i++) box(torso, G.bone, 0, .1 + i * .1, -.108, .04, .03, .03);
  for (const side of [-1, 1]) box(torso, skinD, side * .09, .45, -.105, .1, .12, .02);
  rbox(torso, rag, .08, .4, 0, .2, .32, .23, 0, 0, -.35);
  box(torso, G.acidStain, -.06, .3, .106, .08, .22, .01);
  box(torso, G.acidStain, .05, .5, .106, .06, .1, .01);
  lump(torso, G.acid, .1, .44, -.1, .05);
  lump(torso, G.acid, -.09, .3, -.11, .04);
  lump(torso, G.acid, -.02, .55, -.1, .035);
  const head = joint(g, 0, 1.6, .28, .1);
  zombieFace(head, skin, skinD, v, G.acid, v !== 1);
  box(head, G.acid, 0, -.19, .15, .03, .08, .02);
  // The throat sac pulses and rears back before every spit.
  const throat = joint(head, 0, -.21, .07);
  ball(throat, G.acid, 0, 0, .02, .15, .12, .14);
  for (let i = 0; i < 3; i++) rbox(throat, skinD, (i - 1) * .07, .0, .03, .02, .2, .27, 0, 0, (i - 1) * .4);
  box(throat, skin, 0, .07, 0, .2, .05, .18);
  box(throat, G.acid, .04, -.13, .09, .025, .07, .025);
  function arm(side) {
    const p = joint(g, side * .23, 1.4, .14, -.95, 0, side * -.14);
    box(p, side > 0 ? skin : rag, 0, -.15, 0, .09, .3, .1);
    const fore = joint(p, 0, -.3, 0, -.3);
    box(fore, skin, 0, -.15, 0, .075, .3, .08);
    box(fore, skinD, 0, -.32, .01, .09, .06, .08);
    for (let f = -1; f <= 1; f++) spike(fore, G.bone, [f * .025, -.34, .02], [f * .03, -.44, .05], .012);
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { throat });
}

// «Крикун»: tall, gaunt, in a torn hospital gown, with an enormous hinged jaw.
function buildScreamer(v) {
  const g = new THREE.Group();
  const skin = tone([0xa7ab98, 0x9aa39f, 0xb1a98a][v]), skinD = tone([0x6c7263, 0x646d6c, 0x7a7258][v]), gown = v === 2 ? tone(0x6e5a52) : G.gown;
  function leg(side) {
    const p = joint(g, side * .11, 1.1, 0);
    box(p, skin, 0, -.28, 0, .13, .56, .14);
    box(p, G.bone, 0, -.56, .07, .07, .06, .03);
    box(p, skinD, 0, -.78, .02, .1, .44, .11);
    box(p, skinD, 0, -1.06, .08, .11, .08, .28);
    for (let t = -1; t <= 1; t++) spike(p, G.bone, [t * .035, -1.07, .2], [t * .045, -1.08, .29], .014);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, 1.12, 0, .22);
  box(torso, skinD, 0, 0, 0, .3, .16, .18);
  box(torso, skin, 0, .4, 0, .32, .66, .19);
  for (let i = 0; i < 5; i++) for (const side of [-1, 1]) rbox(torso, G.bone, side * .09, .3 + i * .075, .1, .13, .02, .018, 0, 0, side * .18);
  box(torso, G.dark, 0, .2, .098, .12, .14, .01);
  for (let i = 0; i < 6; i++) box(torso, G.bone, 0, .1 + i * .1, -.1, .04, .035, .03);
  for (const side of [-1, 1]) box(torso, G.bone, side * .19, .74, 0, .1, .07, .12);
  // Gown tatters: long strips hanging front and back give a ragged outline.
  box(torso, gown, 0, .05, .1, .34, .3, .02);
  for (let i = 0; i < 4; i++) rbox(torso, i % 2 ? G.gownDark : gown, -.13 + i * .087, -.22 - (i % 2) * .06, .1, .08, .26 + (i % 2) * .1, .015, .08, 0, (i - 1.5) * .08);
  for (let i = 0; i < 3; i++) rbox(torso, gown, (i - 1) * .13, .3, -.12, .12, .9 - Math.abs(i - 1) * .2, .015, -.18, 0, (i - 1) * .14);
  box(torso, G.blood, .08, .02, .112, .1, .14, .01);
  const head = joint(g, 0, 1.98, .2, .05);
  box(head, skinD, 0, -.12, -.05, .09, .14, .09);
  ball(head, skin, 0, .09, -.02, .13, .19, .15);
  box(head, skinD, 0, .1, .1, .22, .04, .1);
  box(head, G.dark, -.055, .05, .125, .07, .06, .02);
  box(head, G.dark, .055, .05, .125, .07, .06, .02);
  box(head, G.eyeRed, -.055, .05, .136, .05, .03, .02);
  box(head, G.eyeRed, .055, .05, .136, .05, .03, .02);
  box(head, G.dark, 0, -.01, .14, .04, .04, .02);
  box(head, G.mouthGlow, 0, -.07, .06, .12, .05, .12);
  for (let i = 0; i < 5; i++) spike(head, M.teeth, [-.06 + i * .03, -.045, .12], [-.06 + i * .03, -.085, .125], .01);
  for (const side of [-1, 1]) rbox(head, G.flesh, side * .1, -.08, .07, .02, .12, .06, 0, 0, side * -.2);
  // A long lower jaw on its own hinge: rest slightly open, swings to ~1 rad when screaming.
  const jaw = joint(head, 0, -.05, -.02, .18);
  rbox(jaw, skinD, 0, -.09, .11, .2, .06, .3, -.1);
  box(jaw, G.mouthGlow, 0, -.055, .1, .13, .015, .2);
  for (let i = 0; i < 5; i++) spike(jaw, M.teeth, [-.07 + i * .035, -.07, .23], [-.07 + i * .035, -.01, .23], .012);
  box(jaw, G.bloodBright, .02, -.12, .2, .05, .04, .03);
  function arm(side) {
    const p = joint(g, side * .22, 1.84, .04, -.35, 0, side * -.2);
    box(p, skin, 0, -.24, 0, .08, .48, .09);
    box(p, G.bone, 0, -.48, -.03, .06, .06, .05);
    rbox(p, gown, 0, -.08, -.04, .12, .18, .1, .1);
    const fore = joint(p, 0, -.48, 0, -.2);
    box(fore, skinD, 0, -.22, 0, .07, .44, .08);
    box(fore, skinD, 0, -.47, .01, .1, .08, .06);
    for (let f = 0; f < 4; f++) spike(fore, G.bone, [(f - 1.5) * .024, -.5, .01], [(f - 1.5) * .032, -.68, .07], .012);
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { jaw });
}

// «Штурмовик»: a turned riot cop. Plates, helmet and a riot shield on the left arm.
function buildArmored(v) {
  const g = new THREE.Group(), W = 1.12;
  const skin = tone(SKIN[v]), skinD = tone(SKIN_DARK[v]), suit = tone([0x252b33, 0x2a2f2a, 0x1f2328][v]);
  function leg(side) {
    const p = joint(g, side * .13 * W, .9, 0);
    box(p, suit, 0, -.21, 0, .2 * W, .43, .22 * W);
    box(p, G.riotPlate, side * .06, -.2, .07, .08, .3, .12);
    box(p, suit, 0, -.55, .01, .17 * W, .3, .19 * W);
    box(p, G.riotPlate, 0, -.44, .11, .17, .15, .07);
    box(p, G.riot, 0, -.6, .1, .15, .26, .05);
    box(p, G.shoe, 0, -.82, .05, .21 * W, .14, .34);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, .95, 0, .15);
  box(torso, suit, 0, -.02, 0, .44 * W, .17, .27 * W);
  box(torso, G.shoe, 0, .07, 0, .46 * W, .06, .29 * W);
  for (let i = -1; i <= 1; i++) box(torso, G.riot, i * .14, .08, .17, .09, .1, .05);
  box(torso, suit, 0, .34, 0, .5 * W, .52, .28 * W);
  box(torso, G.riot, 0, .37, 0, .54 * W, .46, .36);
  box(torso, G.riotPlate, 0, .4, .19, .42, .32, .03);
  box(torso, G.riotPlate, 0, .4, -.19, .44, .34, .03);
  box(torso, G.stripe, 0, .46, -.207, .4, .05, .008);
  box(torso, G.riot, 0, .62, 0, .38, .1, .32);
  for (const side of [-1, 1]) {
    rbox(torso, G.riotPlate, side * .36, .58, 0, .22, .1, .36, 0, 0, side * -.35);
    rbox(torso, G.riot, side * .4, .5, 0, .16, .08, .32, 0, 0, side * -.6);
  }
  box(torso, G.bloodBright, -.12, .32, .206, .12, .16, .01);
  box(torso, G.blood, .1, .18, .2, .16, .06, .01);
  const head = joint(g, 0, 1.68, .12, .05);
  zombieFace(head, skin, skinD, v, null, false);
  ball(head, G.riot, 0, .1, -.01, .195, .15, .2);
  box(head, G.riot, 0, .0, -.13, .3, .12, .1);
  box(head, G.riotPlate, 0, .17, .1, .28, .04, .14);
  // The cracked visor leaves the glowing eyes readable through it.
  rbox(head, G.visor, 0, .04, .175, .3, .13, .02, -.12);
  box(head, M.eye, -.06, .045, .19, .055, .028, .01);
  if (v !== 1) box(head, M.eye, .06, .045, .19, .055, .028, .01);
  rbox(head, G.shieldWin, .08, .06, .188, .012, .1, .006, 0, 0, .5);
  for (const side of [-1, 1]) box(head, G.riot, side * .16, -.05, .06, .03, .12, .03);
  function arm(side) {
    const p = joint(g, side * .31 * W, 1.47, .06, -1.05, 0, side * -.12);
    box(p, suit, 0, -.15, 0, .16 * W, .3, .17 * W);
    box(p, G.riotPlate, side * .06, -.12, 0, .06, .22, .16);
    const fore = joint(p, 0, -.3, 0, -.25);
    box(fore, suit, 0, -.15, 0, .13 * W, .3, .14 * W);
    box(fore, G.riotPlate, 0, -.15, .05, .14, .26, .08);
    box(fore, G.shoe, 0, -.33, .01, .14 * W, .09, .13 * W);
    if (side > 0) limb(fore, G.shoe, [0, -.36, .02], [0, -.49, -.44], .022);
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  // Riot shield authored in model space, then bolted onto the left arm.
  const shield = new THREE.Group(); shield.position.set(-.12, 1.03, .6); g.add(shield);
  box(shield, G.shield, 0, 0, 0, .36, 1.0, .035);
  for (const side of [-1, 1]) {
    rbox(shield, G.shield, side * .27, 0, -.045, .2, 1.0, .035, 0, side * .35);
    rbox(shield, G.stripe, side * .27, -.22, -.024, .18, .05, .01, 0, side * .35);
  }
  box(shield, G.shieldWin, 0, .27, .02, .3, .18, .01);
  box(shield, G.stripe, 0, -.22, .02, .34, .05, .01);
  box(shield, G.riot, 0, .505, -.01, .72, .03, .05);
  box(shield, G.riot, 0, -.505, -.01, .72, .03, .05);
  box(shield, G.police, -.09, .53, 0, .1, .025, .04);
  box(shield, G.policeRed, .09, .53, 0, .1, .025, .04);
  box(shield, G.blood, .08, .02, .02, .14, .2, .006);
  rbox(shield, G.dark, -.06, .12, .02, .2, .012, .006, 0, 0, .6);
  attachTo(g, leftArm, shield);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso });
}

// «Матка»: a bloated brood mother. The glowing sacs (userData.sacs) are weak points.
function buildBrood() {
  const g = new THREE.Group();
  const SK = tone(0xa39a7c), SKD = tone(0x6e6650), VEIN = tone(0x5a3a3a);
  function leg(side) {
    const p = joint(g, side * .58, .85, -.05);
    box(p, SK, 0, -.2, 0, .46, .45, .5);
    box(p, SKD, 0, -.58, .04, .38, .4, .42);
    box(p, SKD, 0, -.79, .14, .48, .12, .62);
    for (let t = -1; t <= 1; t++) spike(p, G.bone, [t * .14, -.8, .42], [t * .17, -.82, .58], .04);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, .85, 0);
  const C = [0, .7, .32], R = [.95, .88, 1.0];
  const onBelly = (dx, dy, dz, out = 0) => { const n = Math.hypot(dx, dy, dz); return [C[0] + R[0] * dx / n * (1 + out), C[1] + R[1] * dy / n * (1 + out), C[2] + R[2] * dz / n * (1 + out)]; };
  ball(torso, SK, ...C, ...R);
  ball(torso, SKD, 0, .2, .6, .7, .45, .62);
  for (const [a, b] of [[[-.4, .9, .9], [-.1, .3, 1.25]], [[.5, 1.0, .85], [.25, .4, 1.22]], [[.05, 1.3, .95], [-.15, .9, 1.25]], [[.75, .6, .7], [.6, .1, .85]]]) {
    const pa = onBelly(a[0], a[1] - C[1], a[2] - C[2], .01), pb = onBelly(b[0], b[1] - C[1], b[2] - C[2], .01);
    seg(torso, VEIN, pa, pb, .035, .02);
  }
  rbox(torso, SK, 0, 1.78, -.12, 1.0, .72, .7, -.2);
  rbox(torso, SKD, 0, 2.0, -.32, .74, .42, .42, -.45);
  for (const [x, y, z, r] of [[-.35, 2.05, -.42, .2], [.3, 1.9, -.5, .17], [.05, 1.6, -.6, .22]]) lump(torso, SKD, x, y, z, r);
  for (let i = 0; i < 4; i++) spike(torso, G.bone, [(i - 1.5) * .2, 2.1, -.38], [(i - 1.5) * .3, 2.5 - Math.abs(i - 1.5) * .1, -.75], .06);
  for (const side of [-1, 1]) {
    limb(torso, SKD, [side * .3, 1.6, .3], [side * .4, 1.35, .7], .05);
    spike(torso, G.bone, [side * .4, 1.35, .7], [side * .36, 1.25, .88], .03);
  }
  for (const side of [-1, 1]) limb(torso, G.flesh, [side * .25, .05, .8], [side * .45, -.82, 1.05], .05);
  limb(torso, G.flesh, [0, 0, .9], [.05, -.82, 1.35], .04);
  box(torso, G.blood, 0, .05, .95, .3, .1, .08);
  const sacs = joint(torso, 0, 0, 0);
  for (const [dx, dy, dz, r] of [[.45, .3, .85, .24], [-.5, -.05, .85, .22], [.05, -.35, 1, .2], [-.25, .55, .8, .17], [.75, -.2, .5, .18], [-.75, .25, .45, .17], [.4, .7, -.4, .16]]) ball(sacs, G.pus, ...onBelly(dx, dy, dz, .05), r, r, r * .85);
  const head = joint(g, 0, 2.86, .42, .25);
  ball(head, SK, 0, .02, 0, .2, .22, .26);
  box(head, SKD, 0, .14, .05, .3, .06, .3);
  for (const [x, y] of [[-.08, .07], [.08, .07], [-.15, .02], [.15, .02]]) box(head, G.acid, x, y, .23, .055, .03, .03);
  for (let i = 0; i < 3; i++) spike(head, G.bone, [(i - 1) * .1, .18, -.05], [(i - 1) * .18, .48, -.3], .045);
  const jaw = joint(head, 0, -.1, .05, .25);
  box(jaw, SKD, 0, -.05, .1, .26, .08, .26);
  box(jaw, G.mouthGlow, 0, .0, .12, .18, .02, .18);
  for (const side of [-1, 1]) spike(jaw, G.bone, [side * .1, -.04, .2], [side * .05, -.2, .38], .03);
  function arm(side) {
    const p = joint(g, side * .66, 2.38, .05, -.6, 0, side * -.35);
    box(p, SK, 0, -.35, 0, .2, .7, .22);
    const fore = joint(p, 0, -.7, 0, -.35);
    box(fore, SKD, 0, -.35, 0, .17, .7, .18);
    box(fore, SKD, 0, -.74, .02, .2, .1, .16);
    for (let k = -1; k <= 1; k++) spike(fore, G.bone, [k * .06, -.78, .03], [k * .09, -1.05, .15], .025);
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { jaw, sacs });
}

// «Мясник»: tall sack-hooded butcher. Cleaver in the right hand, hook and chain on the left.
function buildButcher() {
  const g = new THREE.Group();
  const SK = tone(0xa08d78), SKD = tone(0x6f5e50), pants = tone(0x2b2724);
  function leg(side) {
    const p = joint(g, side * .21, 1.25, 0);
    box(p, pants, 0, -.3, 0, .3, .62, .32);
    box(p, G.leather, 0, -.85, .02, .27, .5, .3);
    box(p, G.leather, 0, -.6, .02, .3, .06, .33);
    box(p, G.shoe, 0, -1.17, .1, .29, .16, .44);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, 1.28, 0, .14);
  box(torso, pants, 0, .02, 0, .66, .22, .42);
  ball(torso, SK, 0, .36, .1, .42, .4, .36);
  box(torso, SK, 0, .76, 0, .9, .52, .5);
  box(torso, SKD, 0, .82, -.2, .8, .4, .2);
  for (const side of [-1, 1]) box(torso, SK, side * .48, .92, 0, .34, .3, .44);
  for (let i = 0; i < 4; i++) box(torso, G.dark, -.2, .55 + i * .08, -.255, .03, .02, .01);
  rbox(torso, G.dark, -.2, .66, -.256, .015, .3, .008);
  // Bloody leather apron: the strongest shape on the model, front and centre.
  box(torso, G.apron, 0, .45, .38, .66, .92, .04);
  rbox(torso, G.apron, 0, -.32, .4, .62, .62, .035, .12);
  box(torso, G.bloodBright, .12, .3, .405, .26, .3, .01);
  box(torso, G.blood, -.18, .55, .405, .2, .22, .01);
  rbox(torso, G.blood, -.05, -.3, .425, .3, .2, .01, .12);
  for (const side of [-1, 1]) rbox(torso, G.leather, side * .2, .78, .02, .07, .7, .54, .0, 0, side * -.1);
  box(torso, G.leather, 0, .05, 0, .7, .08, .45);
  for (const x of [-.25, .28]) { box(torso, G.steel, x, -.06, .24, .02, .14, .02); spike(torso, G.steel, [x, -.13, .24], [x, -.08, .3], .015); }
  const head = joint(g, 0, 2.43, .12, .08);
  box(head, SK, 0, -.17, -.02, .22, .14, .22);
  ball(head, G.burlap, 0, .06, 0, .21, .24, .21);
  box(head, G.burlap, 0, -.1, -.01, .34, .1, .34);
  box(head, G.rope, 0, -.15, 0, .3, .04, .3);
  lump(head, G.burlap, 0, .3, -.05, .07, .09, .07);
  box(head, G.dark, -.08, .08, .195, .08, .05, .02);
  box(head, G.dark, .08, .08, .195, .08, .05, .02);
  box(head, G.eyeRed, -.08, .08, .207, .07, .04, .01);
  box(head, G.eyeRed, .08, .08, .207, .06, .035, .01);
  box(head, G.dark, 0, -.04, .205, .14, .012, .01);
  for (let i = 0; i < 5; i++) box(head, G.rope, -.06 + i * .03, -.04, .21, .006, .04, .006);
  box(head, G.blood, .1, -.06, .2, .07, .1, .01);
  function arm(side) {
    const p = joint(g, side * .66, 2.06, .05, -.5, 0, side * -.12);
    box(p, SK, 0, -.3, 0, .26, .6, .28);
    box(p, G.leather, 0, -.04, 0, .3, .1, .32);
    const fore = joint(p, 0, -.6, 0, -.35);
    box(fore, SK, 0, -.27, 0, .22, .54, .24);
    box(fore, G.leather, 0, -.4, 0, .25, .2, .27);
    box(fore, SKD, 0, -.62, .02, .24, .18, .24);
    return [p, fore];
  }
  const [leftArm, leftFore] = arm(-1), [rightArm, rightFore] = arm(1);
  // Cleaver: wooden grip out of the fist, a broad blade with a hot edge.
  box(rightFore, G.leather, 0, -.64, .16, .05, .06, .2);
  box(rightFore, G.steel, 0, -.73, .48, .03, .36, .5);
  box(rightFore, G.dark, 0, -.56, .48, .036, .03, .5);
  box(rightFore, G.hot, 0, -.915, .48, .034, .025, .5);
  box(rightFore, G.blood, 0, -.8, .58, .036, .14, .2);
  // Hook on a chain hanging straight down from the left fist.
  const grip = new THREE.Object3D(); grip.position.set(0, -.68, .04); leftFore.add(grip);
  g.updateMatrixWorld(true);
  const hand = grip.getWorldPosition(new THREE.Vector3());
  const hook = joint(g, hand.x, hand.y, hand.z);
  for (let i = 0; i < 8; i++) box(hook, G.chain, 0, -.04 - i * .065, 0, i % 2 ? .016 : .06, .08, i % 2 ? .06 : .016);
  box(hook, G.steel, 0, -.6, 0, .05, .14, .05);
  seg(hook, G.steel, [0, -.66, 0], [0, -.8, .1], .05);
  seg(hook, G.steel, [0, -.8, .1], [0, -.74, .22], .045);
  spike(hook, G.steel, [0, -.74, .22], [0, -.6, .24], .025);
  box(hook, G.blood, 0, -.68, .2, .04, .06, .04);
  attachTo(g, leftArm, hook);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { hook });
}

// «Отец Орды»: the colossal final boss. Bone crown, many eyes, a burning rift in
// the chest, brood sacs on the shoulders and a screamer's jaw. Built at Titan
// scale and enlarged to ~5 m.
function buildFather() {
  const g = new THREE.Group();
  const SK = tone(0x6a5548), SKD = tone(0x3e302a), R = G.rock, RD = G.rockDark;
  function leg(side) {
    const p = joint(g, side * .56, 1.25, -.05);
    rbox(p, SK, 0, -.3, 0, .5, .66, .56, 0, 0, side * .08);
    box(p, R, side * .06, -.25, .27, .4, .4, .08);
    spike(p, G.bone, [0, -.55, .25], [0, -.5, .55], .08);
    rbox(p, SKD, 0, -.82, -.1, .4, .55, .44, -.25);
    box(p, RD, 0, -1.17, .12, .52, .16, .72);
    for (let t = -1; t <= 1; t++) spike(p, G.bone, [t * .16, -1.18, .45], [t * .2, -1.22, .72], .05);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, 1.25, 0, .42);
  box(torso, SKD, 0, .05, 0, 1.0, .34, .66);
  box(torso, SK, 0, .52, .02, 1.12, .74, .78);
  box(torso, SK, 0, 1.08, -.04, 1.55, .8, .96);
  rbox(torso, SKD, 0, 1.38, -.42, 1.1, .6, .6, -.3);
  // Burning rift behind a cage of ribs.
  box(torso, G.dark, 0, .82, .5, .46, .78, .04);
  box(torso, G.core, 0, .82, .51, .16, .62, .03);
  ball(torso, G.core, 0, .95, .5, .14, .14, .08);
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) rbox(torso, G.bone, side * .17, .5 + i * .12, .53, .3, .035, .04, 0, 0, side * -.25);
  box(torso, R, 0, 1.25, .5, 1.1, .32, .1);
  rbox(torso, G.magma, -.25, 1.25, .556, .4, .025, .012, 0, 0, .3);
  rbox(torso, G.magma, .28, 1.22, .556, .35, .025, .012, 0, 0, -.4);
  for (const side of [-1, 1]) {
    box(torso, R, side * .88, 1.42, 0, .62, .46, .82);
    for (let i = 0; i < 3; i++) spike(torso, G.spike, [side * (.72 + i * .14), 1.6, -.1 + i * .1], [side * (.85 + i * .22), 2.05 - i * .1, -.2 + i * .05], .07);
  }
  // Spine ridge of long bone blades with glowing vents between them.
  for (let i = 0; i < 6; i++) {
    const y = .55 + i * .2, z = -.5 - i * .03;
    spike(torso, G.spike, [0, y, z], [0, y + .45, z - .7 + i * .05], .09 - i * .006);
    if (i < 5) box(torso, G.magma, 0, y + .1, z + .02, .18, .05, .04);
  }
  // Rebar and girders impaled through the back: unmistakable at range.
  seg(torso, G.rebar, [-.3, .5, .2], [-.75, 2.1, -1.0], .06);
  seg(torso, G.rebar, [.35, .7, .2], [.95, 1.9, -.85], .05);
  seg(torso, G.rebar, [.1, .9, .3], [.25, 2.3, -.7], .045);
  box(torso, G.chain, 0, .3, .4, 1.15, .06, .04);
  rbox(torso, G.chain, 0, .9, 0, .06, .06, 1.0, 0, 0, .6);
  const sacs = joint(torso, 0, 0, 0);
  for (const [x, y, z, r] of [[-.55, 1.62, -.25, .22], [.6, 1.58, -.3, .2], [-.3, 1.15, -.62, .18], [.35, 1.0, -.6, .17]]) ball(sacs, G.pus, x, y, z, r, r * .9, r);
  const head = joint(g, 0, 2.72, .9, .1);
  ball(head, SK, 0, 0, 0, .36, .3, .38);
  box(head, R, 0, .18, .12, .66, .14, .46);
  for (const [x, y, z, s] of [[-.12, .07, .33, 1], [.12, .07, .33, 1], [-.22, .03, .27, .8], [.22, .03, .27, .8], [-.07, .16, .33, .6], [.07, .16, .33, .6]]) {
    box(head, G.dark, x, y, z - .01, .1 * s + .03, .06 * s + .02, .03);
    box(head, G.eyeRed, x, y, z, .1 * s, .045 * s, .03);
  }
  // Crown of antler-like bone spikes.
  for (const [x, y, z, tx, ty, tz] of [[-.2, .22, .05, -.55, .85, -.25], [.2, .22, .05, .55, .85, -.25], [-.3, .15, -.05, -.8, .5, -.3], [.3, .15, -.05, .8, .5, -.3], [-.08, .25, -.05, -.18, .75, -.55], [.08, .25, -.05, .18, .75, -.55]]) spike(head, G.spike, [x, y, z], [tx, ty, tz], .07);
  box(head, G.mouthGlow, 0, -.12, .2, .36, .06, .3);
  const jaw = joint(head, 0, -.16, .0, .3);
  box(jaw, SKD, 0, -.1, .16, .54, .16, .5);
  for (let i = 0; i < 6; i++) spike(jaw, G.spike, [-.2 + i * .08, -.02, .38], [-.2 + i * .08, .1, .38], .025);
  for (const side of [-1, 1]) spike(jaw, G.bone, [side * .26, -.1, .3], [side * .34, -.35, .55], .05);
  function arm(side) {
    const p = joint(g, side * 1.02, 2.35, .15, -.4, 0, side * -.22);
    box(p, SK, 0, -.45, 0, .48, .95, .5);
    box(p, R, side * .2, -.35, 0, .12, .7, .52);
    const fore = joint(p, 0, -.9, 0, -.25);
    box(fore, SKD, 0, -.45, 0, .5, .9, .52);
    box(fore, G.chain, 0, -.2, 0, .54, .06, .56);
    if (side < 0) {
      box(fore, RD, 0, -.95, .02, .5, .3, .5);
      for (let k = -1; k <= 1; k++) spike(fore, G.bone, [k * .14, -1.0, .1], [k * .24, -1.68, .45], .08);
    } else {
      box(fore, RD, 0, -1.08, .02, .78, .62, .74);
      box(fore, G.magma, 0, -1.0, .385, .6, .03, .012);
      rbox(fore, G.magma, .15, -1.15, .385, .03, .35, .012, 0, 0, .4);
      for (let k = -1; k <= 1; k++) spike(fore, G.spike, [k * .22, -1.1, .38], [k * .24, -1.1, .65], .07);
    }
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  g.scale.setScalar(1.45);
  return finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { jaw, sacs });
}

const BUILDERS = { boss: buildBoss, titan: buildBoss, crawler: buildCrawler, spitter: buildSpitter, screamer: buildScreamer, armored: buildArmored, brood: buildBrood, butcher: buildButcher, father: buildFather };
// userData: type, height, headY, rest, the six joints, plus jaw (boss/titan,
// screamer, brood, father), throat (spitter), sacs (brood, father: weak points),
// hook (butcher, hide it while the hook projectile flies).
export function createZombie(type = 'walker', variant = 0) {
  const boss = BOSSES.has(type), v = Math.abs(Math.floor(variant)) % 3, key = (type === 'titan' ? 'boss' : type) + ':' + (boss ? 0 : v);
  if (!zombieTemplates.has(key)) zombieTemplates.set(key, BUILDERS[type] ? BUILDERS[type](v) : buildZombie(type, v));
  return cloneZombie(zombieTemplates.get(key), type, key);
}

// Teammate soldier. Joints match the zombies; head, arms and rifle are children
// of the torso so pitching torso.rotation.x aims the whole upper body. The arms
// are posed around the rifle: animate them only with small offsets.
const S = {
  skin: material(0xc09a7c), camo: material(0x5b6147), camoDark: material(0x454a36), vest: material(0x3a3f30),
  pouch: material(0x2e3327), helmet: material(0x4e5442), glove: material(0x1c1f1b), boot: material(0x2a251f),
  pack: material(0x4b4c39), strap: material(0x262920), gun: material(0x1b1e1c), wood: material(0x7a4a2a),
  goggle: material(0x111417), knee: material(0x2b2f27), lamp: material(0xfff0c8, { emissive: 0xffe2a8, emissiveIntensity: 2.4 }),
};
const soldierTemplates = new Map();
function buildSoldier(hex) {
  const g = new THREE.Group(), team = tone(hex), glow = glowTone(hex, 1.8);
  function leg(side) {
    const p = joint(g, side * .11, .92, 0);
    box(p, S.camo, 0, -.22, 0, .17, .46, .2);
    box(p, S.camoDark, side * .09, -.25, .02, .03, .14, .12);
    box(p, S.knee, 0, -.46, .1, .15, .12, .06);
    box(p, S.camo, 0, -.66, .01, .15, .4, .17);
    box(p, S.boot, 0, -.86, .04, .17, .12, .3);
    box(p, S.boot, 0, -.77, .0, .16, .08, .19);
    return p;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  const torso = joint(g, 0, .95, 0);
  box(torso, S.camo, 0, -.02, 0, .36, .14, .22);
  box(torso, S.strap, 0, .05, 0, .38, .07, .24);
  box(torso, S.camo, 0, .3, 0, .4, .5, .24);
  box(torso, S.vest, 0, .33, 0, .44, .4, .3);
  for (let i = -1; i <= 1; i++) box(torso, S.pouch, i * .12, .2, .16, .1, .13, .06);
  box(torso, S.pouch, .13, .42, .16, .08, .1, .05);
  box(torso, glow, -.12, .44, .152, .07, .04, .01);
  box(torso, team, 0, .58, .01, .3, .07, .27);
  for (const side of [-1, 1]) box(torso, S.strap, side * .14, .48, .0, .06, .14, .32);
  box(torso, S.pack, 0, .33, -.25, .34, .42, .18);
  box(torso, S.camoDark, 0, .25, -.345, .26, .18, .03);
  for (const side of [-1, 1]) box(torso, S.pouch, side * .2, .26, -.24, .06, .22, .14);
  const roll = mesh(cylinder, S.camoDark, torso, 0, .6, -.25, .07, .38, .07); roll.rotation.z = Math.PI / 2;
  box(torso, glow, 0, .48, -.347, .12, .03, .01);
  seg(torso, S.strap, [.12, .55, -.3], [.16, .98, -.36], .012);
  const head = joint(torso, 0, .7, .02);
  box(head, S.skin, 0, -.1, 0, .1, .08, .1);
  ball(head, S.skin, 0, 0, .02, .105, .125, .115);
  box(head, team, 0, -.07, .03, .2, .06, .2);
  box(head, S.goggle, -.04, .03, .125, .05, .02, .01);
  box(head, S.goggle, .04, .03, .125, .05, .02, .01);
  ball(head, S.helmet, 0, .08, -.005, .155, .12, .165);
  box(head, S.helmet, 0, .04, -.01, .3, .035, .32);
  box(head, S.goggle, 0, .1, .135, .17, .05, .05);
  box(head, S.gun, 0, .17, .14, .05, .04, .04);
  for (const side of [-1, 1]) { box(head, S.strap, side * .13, .0, .0, .04, .09, .09); box(head, glow, side * .152, .1, -.03, .01, .03, .13); }
  box(head, glow, 0, .1, -.167, .13, .03, .01);
  // Arms: segments from shoulder to elbow to the hand on the rifle.
  function arm(side, elbow, hand) {
    const p = joint(torso, side * .25, .55, 0);
    limb(p, S.camo, [0, 0, 0], elbow, .07);
    box(p, glow, side * .075, -.08, 0, .01, .06, .06);
    box(p, S.camoDark, side * .02, -.05, 0, .15, .12, .15);
    limb(p, S.camo, elbow, hand, .058);
    box(p, S.glove, hand[0], hand[1], hand[2], .08, .08, .1);
    return p;
  }
  const rightArm = arm(1, [.03, -.28, .02], [-.15, -.13, .2]);
  const leftArm = arm(-1, [.02, -.25, .16], [.32, -.1, .4]);
  // Rifle origin is the pistol grip; it points along +z.
  const rifle = joint(torso, .1, .42, .2);
  box(rifle, S.wood, 0, .05, -.12, .05, .08, .22);
  box(rifle, S.gun, 0, .06, .08, .06, .08, .26);
  box(rifle, S.gun, 0, -.03, .0, .04, .1, .05);
  rbox(rifle, S.gun, 0, -.03, .14, .04, .13, .07, .3);
  box(rifle, S.wood, 0, .06, .29, .06, .065, .16);
  tube(rifle, S.gun, 0, .07, .5, .014, .3);
  box(rifle, S.gun, 0, .1, .58, .015, .04, .02);
  tube(rifle, S.gun, .04, .045, .35, .02, .08);
  tube(rifle, S.lamp, .04, .045, .392, .017, .008);
  finishRig(g, { leftLeg, rightLeg, leftArm, rightArm, head, torso }, { rifle });
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, .07, .66); rifle.add(muzzle);
  return g;
}
// userData: type 'soldier', color, height, headY, rest, six joints, rifle (group),
// muzzle (Object3D at the barrel tip: muzzle.getWorldPosition(v) for flashes).
export function createSoldier(colorHex = 0x4fa8ff) {
  const hex = new THREE.Color(colorHex).getHex();
  if (!soldierTemplates.has(hex)) soldierTemplates.set(hex, buildSoldier(hex));
  const template = soldierTemplates.get(hex);
  if (template.userData.headY === undefined) template.userData.headY = measureHeadY(template);
  return cloneRig(template, { type: 'soldier', color: hex, height: 1.85, headY: template.userData.headY });
}

// Weapons share the camera mount used by the AK. userData: type, muzzle (Vector3
// in weapon space), mag (group, rest y = -.065 like the AK), magRest, sightY
// (height of the sight line, for ADS offsets), bolt (smg/svd), scope (svd).
function weaponHands(group, gripZ, supportZ, supportY = -.055) {
  box(group, M.glove, 0, -.115, gripZ, .115, .135, .14).rotation.x = -.25;
  box(group, M.cloth, .04, -.205, gripZ + .11, .14, .19, .22).rotation.x = -.3;
  box(group, M.glove, -.06, supportY, supportZ, .13, .105, .18).rotation.z = -.32;
  box(group, M.cloth, -.12, supportY - .085, supportZ + .15, .135, .15, .3).rotation.x = .65;
}
export function createWeapon(type = 'ak') {
  const group = new THREE.Group();
  if (type === 'rpg') {
    // A graphic, readable silhouette: long olive tube, conical game warhead.
    tube(group, M.oliveDark, 0, 0, -.08, .091, .97);
    tube(group, M.olive, 0, 0, -.14, .095, .53);
    tube(group, M.darkMetal, 0, 0, .34, .112, .11);
    tube(group, M.woodDark, 0, 0, -.01, .103, .25);
    for (let i = 0; i < 5; i++) tube(group, M.wood, 0, 0, -.1 + i * .045, .105, .014);
    tube(group, M.darkMetal, 0, 0, -.59, .072, .2);
    mesh(cone, M.olive, group, 0, 0, -.79, .116, .3, .116).rotation.x = -Math.PI / 2;
    tube(group, M.gold, 0, 0, -.65, .108, .035);
    box(group, M.darkMetal, .055, .12, -.12, .04, .13, .12);
    box(group, M.darkMetal, .055, .2, -.13, .085, .06, .14);
    box(group, M.bolt, .055, .21, -.06, .045, .026, .015);
    box(group, M.darkMetal, 0, -.13, .13, .07, .2, .09).rotation.x = -.18;
    box(group, M.glove, 0, -.14, .135, .12, .13, .13);
    box(group, M.cloth, .045, -.23, .22, .14, .17, .25).rotation.x = -.3;
    box(group, M.glove, -.08, -.065, -.24, .14, .1, .18).rotation.z = -.4;
    box(group, M.cloth, -.13, -.15, -.13, .13, .15, .26).rotation.x = .7;
    group.userData.muzzle = new THREE.Vector3(0, 0, -.96);
  } else if (type === 'shotgun') {
    // Pump-action: twin tubes (barrel over magazine), wooden pump and stock.
    tube(group, M.darkMetal, 0, .045, -.5, .03, .62);
    tube(group, M.metal, 0, -.02, -.44, .026, .5);
    tube(group, M.darkMetal, 0, .045, -.82, .036, .04);
    box(group, M.bolt, 0, .085, -.79, .014, .03, .02);
    box(group, M.darkMetal, 0, .01, -.08, .11, .15, .34);
    box(group, M.metal, .057, .03, -.1, .006, .06, .16);
    box(group, M.bolt, 0, .09, -.02, .02, .018, .1);
    const pump = new THREE.Group();
    pump.position.set(0, -.02, -.42);
    group.add(pump);
    box(pump, M.woodDark, 0, 0, 0, .085, .075, .22);
    for (let i = 0; i < 4; i++) box(pump, M.wood, 0, -.04, -.08 + i * .055, .09, .012, .025);
    box(group, M.wood, 0, -.03, .2, .085, .14, .26).rotation.x = -.08;
    box(group, M.woodDark, 0, -.05, .34, .1, .19, .04);
    box(group, M.darkMetal, 0, -.12, .02, .07, .17, .09).rotation.x = -.3;
    box(group, M.glove, 0, -.115, .04, .115, .135, .14).rotation.x = -.25;
    box(group, M.cloth, .04, -.205, .15, .14, .19, .22).rotation.x = -.3;
    box(group, M.glove, -.05, -.07, -.42, .13, .1, .17).rotation.z = -.32;
    box(group, M.cloth, -.12, -.15, -.27, .135, .15, .3).rotation.x = .65;
    group.userData.pump = pump;
    group.userData.muzzle = new THREE.Vector3(0, .045, -.86);
  } else if (type === 'smg') {
    // ПП «Бизон»: short AK-style receiver, skeleton stock and the long helical
    // magazine under the barrel, which doubles as the foregrip.
    box(group, M.darkMetal, 0, 0, -.08, .1, .12, .36);
    box(group, M.metal, 0, .068, -.08, .095, .035, .34);
    box(group, M.darkMetal, 0, .095, .03, .045, .03, .05);
    box(group, M.darkMetal, 0, .082, -.24, .05, .02, .05);
    tube(group, M.darkMetal, 0, .035, .2, .012, .24);
    tube(group, M.darkMetal, 0, -.045, .19, .012, .22);
    box(group, M.darkMetal, 0, -.005, .32, .03, .15, .035);
    box(group, M.polymer, 0, -.12, .04, .07, .17, .09).rotation.x = -.26;
    box(group, M.darkMetal, 0, -.075, -.03, .02, .02, .09);
    tube(group, M.darkMetal, 0, .02, -.4, .02, .3);
    tube(group, M.metal, 0, .02, -.57, .029, .08);
    for (let i = 0; i < 3; i++) box(group, M.black, .03, .02, -.55 - i * .02, .004, .012, .008);
    box(group, M.darkMetal, 0, .065, -.5, .02, .05, .025);
    const bolt = new THREE.Group(); bolt.position.set(.058, .02, -.05); group.add(bolt);
    box(bolt, M.bolt, 0, 0, 0, .04, .022, .04);
    const mag = new THREE.Group(); mag.position.set(0, -.065, -.24); group.add(mag);
    tube(mag, M.polymer, 0, -.012, -.06, .046, .36);
    for (let i = 0; i < 6; i++) tube(mag, M.darkMetal, 0, -.012, .09 - i * .05, .049, .01);
    tube(mag, M.darkMetal, 0, -.012, -.245, .043, .02);
    weaponHands(group, .04, -.34, -.1);
    Object.assign(group.userData, { mag, bolt, sightY: .11, muzzle: new THREE.Vector3(0, .02, -.62) });
  } else if (type === 'svd') {
    // СВД: long slim receiver, slotted wooden handguard, skeleton stock, PSO scope.
    box(group, M.darkMetal, 0, 0, -.1, .085, .11, .42);
    box(group, M.metal, 0, .058, -.1, .08, .03, .4);
    box(group, M.wood, 0, .01, -.45, .1, .1, .28);
    box(group, M.woodDark, 0, .062, -.45, .07, .02, .28);
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) box(group, M.darkMetal, side * .051, .015, -.37 - i * .07, .004, .05, .035);
    tube(group, M.darkMetal, 0, .02, -.84, .016, .52);
    tube(group, M.metal, 0, .06, -.52, .013, .3);
    tube(group, M.darkMetal, 0, .02, -1.12, .022, .1);
    for (let i = 0; i < 3; i++) box(group, M.black, 0, .043, -1.1 - i * .025, .012, .004, .012);
    box(group, M.darkMetal, 0, .055, -1.04, .016, .05, .02);
    // Skeleton stock with a thumbhole grip.
    box(group, M.wood, 0, .04, .24, .06, .05, .3);
    box(group, M.woodDark, 0, .075, .2, .065, .03, .16);
    box(group, M.woodDark, 0, -.03, .375, .075, .2, .035);
    box(group, M.wood, 0, -.11, .3, .05, .045, .14).rotation.x = .2;
    box(group, M.wood, 0, -.06, .13, .055, .16, .055).rotation.x = -.25;
    box(group, M.darkMetal, 0, -.075, .02, .02, .02, .1);
    const bolt = new THREE.Group(); bolt.position.set(.05, .02, -.04); group.add(bolt);
    box(bolt, M.bolt, 0, 0, 0, .045, .02, .035);
    const mag = new THREE.Group(); mag.position.set(0, -.065, -.16); group.add(mag);
    box(mag, M.darkMetal, 0, -.065, -.01, .06, .13, .11).rotation.x = .12;
    box(mag, M.metal, 0, -.135, -.02, .065, .02, .12);
    // PSO-1 style scope on a side mount.
    const scope = new THREE.Group(); scope.position.set(0, .15, -.08); group.add(scope);
    box(scope, M.darkMetal, 0, -.065, 0, .03, .05, .14);
    tube(scope, M.darkMetal, 0, 0, 0, .022, .3);
    tube(scope, M.darkMetal, 0, 0, -.19, .033, .09);
    tube(scope, M.black, 0, 0, .17, .03, .06);
    box(scope, M.darkMetal, 0, .03, -.02, .025, .025, .03);
    box(scope, M.darkMetal, .028, 0, -.02, .025, .025, .03);
    tube(scope, M.lens, 0, 0, -.236, .029, .004);
    weaponHands(group, .13, -.45);
    Object.assign(group.userData, { mag, bolt, scope, sightY: .15, muzzle: new THREE.Vector3(0, .02, -1.18) });
  } else {
    // Wood furniture and the curved segmented magazine establish the AK shape.
    box(group, M.darkMetal, 0, 0, -.1, .12, .13, .43);
    box(group, M.metal, 0, .075, -.11, .11, .045, .4);
    box(group, M.darkMetal, 0, .096, -.22, .056, .024, .21);
    box(group, M.wood, 0, -.005, .22, .09, .135, .29).rotation.x = -.05;
    box(group, M.woodDark, 0, -.017, .37, .108, .16, .025);
    box(group, M.woodDark, 0, -.13, .015, .075, .19, .11).rotation.x = -.26;
    box(group, M.wood, 0, -.005, -.41, .13, .13, .22);
    box(group, M.woodDark, 0, .055, -.39, .1, .045, .21);
    for (let i = 0; i < 3; i++) box(group, M.darkMetal, .066, .015, -.35 - i * .05, .008, .018, .023);
    tube(group, M.darkMetal, 0, .025, -.64, .023, .31);
    tube(group, M.metal, 0, .075, -.57, .021, .19);
    tube(group, M.darkMetal, 0, .025, -.81, .032, .06);
    box(group, M.darkMetal, 0, .085, -.75, .027, .13, .04);
    box(group, M.darkMetal, -.025, .145, -.75, .018, .035, .035);
    box(group, M.darkMetal, .025, .145, -.75, .018, .035, .035);
    box(group, M.bolt, 0, .147, -.75, .009, .027, .022);
    box(group, M.darkMetal, 0, .104, .045, .05, .035, .05);
    box(group, M.bolt, .07, .014, -.07, .045, .023, .045);
    const mag = new THREE.Group();
    mag.position.set(0, -.065, -.19);
    group.add(mag);
    for (let i = 0; i < 4; i++) {
      const part = box(mag, i % 2 ? M.darkMetal : M.metal, 0, -.05 - i * .067, -.014 - i * i * .008, .087, .087, .13);
      part.rotation.x = i * .14;
    }
    // A support hand and a trigger hand stay with the weapon during recoil.
    box(group, M.glove, 0, -.115, .04, .115, .135, .14).rotation.x = -.25;
    box(group, M.cloth, .04, -.205, .15, .14, .19, .22).rotation.x = -.3;
    box(group, M.glove, -.06, -.055, -.4, .13, .105, .18).rotation.z = -.32;
    box(group, M.cloth, -.12, -.14, -.25, .135, .15, .3).rotation.x = .65;
    group.userData.mag = mag;
    group.userData.sightY = .147;
    group.userData.muzzle = new THREE.Vector3(0, .025, -.85);
  }
  group.userData.type = type;
  if (group.userData.mag) group.userData.magRest = group.userData.mag.position.clone();
  group.traverse(part => { if (part.isMesh) { part.castShadow = false; part.receiveShadow = false; part.frustumCulled = false; } });
  return group;
}

export function createRocket() {
  const group = new THREE.Group();
  tube(group, M.oliveDark, 0, 0, .04, .045, .31);
  mesh(cone, M.olive, group, 0, 0, -.19, .082, .23, .082).rotation.x = -Math.PI / 2;
  tube(group, M.gold, 0, 0, -.06, .071, .025);
  box(group, M.metal, 0, 0, .15, .19, .018, .13);
  box(group, M.metal, 0, 0, .15, .018, .19, .13);
  return group;
}

// A game prop, built to read clearly from the same camera mount as the AK.
// Only the barrel assembly spins; hands and receiver stay still.
export function createMinigun() {
  const group=new THREE.Group(),barrels=new THREE.Group();
  tube(group,M.darkMetal,0,-.015,.025,.142,.43);
  tube(group,M.metal,0,-.015,-.17,.157,.13);
  tube(group,M.darkMetal,0,-.015,.25,.17,.055);
  box(group,M.oliveDark,.17,-.015,.015,.15,.24,.27);
  box(group,M.gold,.251,.025,.015,.012,.055,.18);
  // Six parallel barrels, each with a dark recessed muzzle.
  barrels.position.set(0,-.015,-.19);group.add(barrels);
  for(let i=0;i<6;i++) {
    const angle=i*Math.PI/3,x=Math.cos(angle)*.093,y=Math.sin(angle)*.093;
    tube(barrels,M.metal,x,y,-.28,.031,.57);
    tube(barrels,M.darkMetal,x,y,-.58,.037,.045);
    tube(barrels,M.black,x,y,-.605,.022,.009);
  }
  tube(barrels,M.darkMetal,0,0,-.09,.138,.055);
  tube(barrels,M.darkMetal,0,0,-.49,.14,.045);
  tube(barrels,M.bolt,0,0,-.51,.144,.012);
  tube(barrels,M.darkMetal,0,0,-.3,.028,.6);
  // Top carry grip and a visible ammunition belt suggest weight.
  box(group,M.darkMetal,-.12,.19,.02,.055,.15,.08);
  box(group,M.darkMetal,.12,.19,.02,.055,.15,.08);
  box(group,M.metal,0,.25,.02,.29,.05,.08);
  for(let i=0;i<5;i++){
    const link=box(group,M.gold,.19+i*.014,-.15-i*.037,.04,.12,.025,.05);
    link.rotation.z=-.22;
  }
  box(group,M.darkMetal,0,-.18,.18,.07,.2,.095);
  box(group,M.glove,.015,-.19,.19,.125,.15,.14);
  box(group,M.cloth,.065,-.28,.26,.15,.17,.21).rotation.x=-.25;
  box(group,M.glove,-.13,.215,.015,.145,.1,.14);
  box(group,M.cloth,-.19,.12,.13,.14,.18,.25).rotation.x=.55;
  group.userData={type:'minigun',barrels,muzzle:new THREE.Vector3(0,-.015,-.81)};
  group.traverse(part=>{if(part.isMesh){part.castShadow=false;part.receiveShadow=false;part.frustumCulled=false;}});
  return group;
}
