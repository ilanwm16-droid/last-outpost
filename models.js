import * as THREE from './vendor/three.module.js';

// Reused primitive geometry keeps even a large wave inexpensive to draw.
const cube = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
const sphere = new THREE.IcosahedronGeometry(1, 1);
const cone = new THREE.ConeGeometry(1, 1, 8);
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
// Gore and gear palette. Every color is baked into vertex colors per joint.
const G = {
  blood: material(0x5a0b09), bloodBright: material(0x8c1510), bone: material(0xd8d0b4), flesh: material(0x7a2a22),
  dark: material(0x101010), hair: material(0x211d18), shoe: material(0x1a1a17), vest: material(0x39412f),
  plate: material(0x2b3127), helmet: material(0x353e2f), rock: material(0x4d4842), rockDark: material(0x2d2a26),
  spike: material(0xcfc4a4), chain: material(0x55595a),
  eyeRed: material(0xff4a3a, { emissive: 0xff1c08, emissiveIntensity: 3.2 }),
  pus: material(0xb6ff5c, { emissive: 0x6dff1a, emissiveIntensity: 1.9 }),
  core: material(0xffa040, { emissive: 0xff3c08, emissiveIntensity: 3.4 }),
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

const HEIGHTS = { walker: 1.95, runner: 1.86, brute: 2.25, exploder: 2.0, boss: 3.45 };
function cloneZombie(template, type) {
  const group = template.clone(true);
  const height = HEIGHTS[type] || 1.95;
  group.userData = { type, height, headY: type === 'boss' ? 2.75 : height * .79 };
  for (const joint of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'head', 'torso']) group.userData[joint] = group.getObjectByName(joint);
  return group;
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
    for (const [x, y, z, r] of [[.18, .42, .3, .07], [-.15, .27, .33, .06], [.05, .57, .31, .05], [-.24, .5, .19, .06], [.27, .24, .19, .05], [-.05, .15, .33, .045]]) mesh(sphere, G.pus, torso, x, y, z, r, r, r * .85);
    box(torso, shirt, 0, .66, 0, .5, .16, .3);
    box(torso, G.blood, .2, .5, .25, .08, .16, .03);
  } else if (runner) {
    box(torso, skin, 0, .33, 0, .36, .5, .22);
    box(torso, G.flesh, .08, .3, .107, .17, .3, .01);
    for (let i = 0; i < 4; i++) box(torso, G.bone, .08, .19 + i * .075, .113, .15, .022, .02);
    box(torso, G.blood, -.1, .16, .112, .08, .16, .01);
    box(torso, skinD, 0, .55, -.11, .3, .06, .02);
  } else {
    box(torso, shirt, 0, .34, 0, .48 * W, .52, .27 * W);
    box(torso, G.flesh, .12 * W, .28, .137 * W, .14, .2, .012);
    for (let i = 0; i < 3; i++) box(torso, G.bone, .12 * W, .21 + i * .07, .142 * W, .13, .02, .012);
    const flapA = box(torso, shirt, -.15 * W, .03, .11 * W, .12, .17, .02); flapA.rotation.z = .16;
    box(torso, shirt, .1 * W, .01, .12 * W, .1, .12, .02);
    box(torso, G.blood, -.08, .46, .139 * W, .12, .11, .01);
    box(torso, G.bloodBright, .05, .12, .138 * W, .2, .05, .01);
    box(torso, G.blood, -.12, .3, -.137 * W, .14, .2, .01);
    if (brute) {
      box(torso, G.vest, 0, .35, 0, .56, .47, .35);
      box(torso, G.plate, 0, .39, .178, .4, .3, .03);
      for (let i = 0; i < 3; i++) box(torso, G.vest, -.15 + i * .15, .17, .19, .11, .12, .06);
      box(torso, G.plate, -.33, .56, 0, .2, .1, .37);
      box(torso, G.plate, .33, .56, 0, .2, .1, .37);
      box(torso, G.bloodBright, .14, .45, .195, .1, .14, .01);
    }
  }

  const head = new THREE.Group();
  head.position.set(0, (bloat ? 1.74 : 1.62) + (brute ? .08 : 0), runner ? .22 : .13);
  head.rotation.z = (v - 1) * .13; head.rotation.x = runner ? .18 : .05; g.add(head);
  box(head, skin, 0, -.1, -.02, .12, .1, .12);
  mesh(sphere, skin, head, 0, .06, 0, .15, .17, .155);
  box(head, skin, 0, -.04, .03, .2, .12, .2);
  box(head, skinD, 0, .11, .07, .24, .045, .14);
  box(head, G.dark, -.06, .045, .128, .075, .055, .02);
  box(head, G.dark, .06, .045, .128, .075, .055, .02);
  box(head, M.eye, -.06, .045, .14, .045, .022, .02);
  if (v !== 1) box(head, M.eye, .06, .045, .14, .045, .022, .02);
  box(head, skinD, 0, -.005, .15, .045, .06, .05);
  const jaw = box(head, skinD, 0, -.15, .06, .15, .05, .15); jaw.rotation.x = .38;
  box(head, G.flesh, 0, -.1, .125, .12, .055, .02);
  box(head, M.teeth, 0, -.075, .134, .1, .016, .016);
  box(head, M.teeth, 0, -.135, .145, .09, .016, .016);
  box(head, G.bloodBright, .02, -.18, .13, .05, .09, .02);
  if (v === 2) { box(head, G.flesh, .07, .17, .04, .09, .04, .1); box(head, G.bone, .07, .195, .04, .065, .02, .075); }
  else for (let i = 0; i < 5; i++) box(head, G.hair, -.1 + i * .05, .19 + (i % 2) * .015, -.02 + (i % 3) * .02, .055, .05, .18);
  box(head, skin, -.16, .03, 0, .03, .07, .05);
  box(head, skin, .16, .03, 0, .03, .06, .05);
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
  for (const [name, joint] of Object.entries({ leftLeg, rightLeg, leftArm, rightArm, head, torso })) { joint.name = name; mergeRigid(joint); }
  return g;
}

function buildBoss() {
  const g = new THREE.Group();
  const SK = tone(0x77604f), SKD = tone(0x4a3a30), R = G.rock, RD = G.rockDark;
  function leg(side) {
    const p = new THREE.Group(); p.position.set(side * .42, 1.32, 0); g.add(p);
    box(p, SK, 0, -.32, 0, .44, .7, .48);
    box(p, R, side * .05, -.28, .25, .38, .42, .08);
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
  }
  for (const x of [-.85, .85]) for (let i = 0; i < 2; i++) mesh(cone, G.spike, torso, x + (i - .5) * .2, 1.62, -.05 + i * .15, .07, .3, .07);
  box(torso, G.bloodBright, .4, .9, .45, .14, .3, .02);
  box(torso, G.blood, -.45, .35, .39, .2, .16, .02);

  const head = new THREE.Group(); head.position.set(0, 2.82, .62); g.add(head);
  mesh(sphere, SK, head, 0, .04, 0, .33, .3, .33);
  box(head, R, 0, .2, .12, .64, .13, .42);
  box(head, G.dark, -.13, .07, .29, .14, .08, .04);
  box(head, G.dark, .13, .07, .29, .14, .08, .04);
  box(head, G.eyeRed, -.13, .07, .31, .1, .045, .03);
  box(head, G.eyeRed, .13, .07, .31, .1, .045, .03);
  const jaw = box(head, SKD, 0, -.22, .14, .46, .14, .38); jaw.rotation.x = .32;
  box(head, G.flesh, 0, -.13, .27, .36, .1, .04);
  for (let i = 0; i < 5; i++) mesh(cone, G.spike, head, -.16 + i * .08, -.08, .3, .025, .09, .025).rotation.x = Math.PI;
  for (const side of [-1, 1]) { const horn = mesh(cone, G.spike, head, side * .27, .33, -.02, .08, .42, .08); horn.rotation.z = -side * .55; horn.rotation.x = -.35; }

  function arm(side) {
    const p = new THREE.Group(); p.position.set(side * .92, 2.4, .2); p.rotation.x = -.55; p.rotation.z = side * -.18; g.add(p);
    box(p, SK, 0, -.38, 0, .44, .84, .48);
    box(p, R, side * .2, -.28, 0, .12, .62, .5);
    const fore = new THREE.Group(); fore.position.set(0, -.8, 0); fore.rotation.x = -.3; p.add(fore);
    box(fore, SKD, 0, -.38, 0, .5, .8, .52);
    box(fore, G.chain, 0, -.15, 0, .54, .06, .56);
    box(fore, RD, 0, -.95, .02, .66, .56, .66);
    for (let k = -1; k <= 1; k++) mesh(cone, G.spike, fore, k * .18, -1.0, .36, .055, .2, .055).rotation.x = Math.PI / 2;
    return p;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  for (const [name, joint] of Object.entries({ leftLeg, rightLeg, leftArm, rightArm, head, torso })) { joint.name = name; mergeRigid(joint); }
  return g;
}

export function createZombie(type = 'walker', variant = 0) {
  const v = Math.abs(Math.floor(variant)) % 3, key = type + ':' + (type === 'boss' ? 0 : v);
  if (!zombieTemplates.has(key)) zombieTemplates.set(key, type === 'boss' ? buildBoss() : buildZombie(type, v));
  return cloneZombie(zombieTemplates.get(key), type);
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
    group.userData.muzzle = new THREE.Vector3(0, .025, -.85);
  }
  group.userData.type = type;
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
