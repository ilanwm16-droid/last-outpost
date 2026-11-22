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
const zombieSurface = material(0xffffff, { vertexColors: true });
const zombieEyes = material(0xffffff, { vertexColors: true, emissive: 0xff8f21, emissiveIntensity: 2.7 });
const zombieTemplates = new Map();

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

// Bake the rigid details into colored triangles while retaining each animated
// joint. Eye surfaces stay separate so their light is genuinely emissive.
function mergeRigid(node) {
  node.updateWorldMatrix(true, true);
  const inverse = node.matrixWorld.clone().invert();
  const buckets = [[], []];
  node.traverse(part => {
    if (!part.isMesh) return;
    const transformed = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    transformed.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, part.matrixWorld));
    buckets[part.material === M.eye ? 1 : 0].push({ geometry: transformed, color: part.material.color });
  });
  node.clear();
  buckets.forEach((pieces, bucket) => {
    if (!pieces.length) return;
    const count = pieces.reduce((sum, part) => sum + part.geometry.attributes.position.count, 0);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let offset = 0;
    for (const { geometry, color } of pieces) {
      const length = geometry.attributes.position.count * 3;
      positions.set(geometry.attributes.position.array, offset);
      normals.set(geometry.attributes.normal.array, offset);
      for (let i = offset; i < offset + length; i += 3) {
        colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b;
      }
      offset += length;
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, bucket ? zombieEyes : zombieSurface);
    merged.castShadow = true;
    merged.receiveShadow = true;
    node.add(merged);
  });
}

function cloneZombie(template, type) {
  const group = template.clone(true);
  group.userData = { type, height: type === 'brute' ? 2.54 : type === 'runner' ? 1.93 : 1.98 };
  for (const joint of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'head', 'torso']) {
    group.userData[joint] = group.getObjectByName(joint);
  }
  return group;
}

export function createZombie(type = 'walker') {
  if (zombieTemplates.has(type)) return cloneZombie(zombieTemplates.get(type), type);
  const group = new THREE.Group();
  const brute = type === 'brute';
  const runner = type === 'runner';
  const skin = brute ? M.skinBrute : runner ? M.skinRunner : M.skin;
  const shirt = brute ? M.shirtDark : runner ? M.runner : M.shirt;

  // Legs pivot at the hip; animation can rotate these groups directly.
  function leg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * .135, .85, 0);
    group.add(pivot);
    box(pivot, M.pants, 0, -.18, 0, .205, .36, .23);
    box(pivot, runner ? skin : M.pantsLight, 0, -.44, .015, .16, .24, .19);
    box(pivot, M.boots, 0, -.71, .055, .22, .28, .34);
    box(pivot, M.strap, 0, -.49, .118, .17, .055, .025);
    return pivot;
  }
  const leftLeg = leg(-1), rightLeg = leg(1);
  box(group, M.pants, 0, .85, -.012, .43, .25, .25);
  box(group, M.strap, 0, .95, .015, .45, .055, .29);
  box(group, M.bolt, .035, .952, .17, .075, .06, .025);
  const torso = box(group, shirt, 0, 1.23, -.025, .51, .53, .3);
  torso.rotation.z = .025;
  box(group, M.shirtDark, -.13, 1.31, .14, .17, .15, .026);
  box(group, runner ? skin : M.wound, .16, 1.08, .138, .12, .18, .03).rotation.z = .2;
  box(group, M.strap, .12, 1.25, .15, .045, .5, .035).rotation.z = -.22;
  box(group, M.patch, -.13, 1.36, .16, .09, .022, .025);
  if (brute) {
    box(group, M.oliveDark, 0, 1.25, .17, .4, .38, .08);
    for (let i = 0; i < 3; i++) box(group, M.olive, -.12 + i * .12, 1.19, .235, .095, .19, .075);
    box(group, M.darkMetal, -.29, 1.47, 0, .19, .12, .34);
    box(group, M.darkMetal, .29, 1.47, 0, .19, .12, .34);
  }
  box(group, skin, 0, 1.53, .025, .17, .18, .17);

  const head = new THREE.Group();
  head.position.set(0, 1.71, .055);
  head.rotation.z = runner ? -.14 : .065;
  group.add(head);
  mesh(sphere, skin, head, 0, .035, 0, .195, .22, .18);
  box(head, skin, 0, -.085, .035, .29, .19, .25);
  box(head, M.skinDark, 0, .19, -.025, .3, .06, .26);
  box(head, M.skinDark, -.088, .04, .148, .105, .075, .055);
  box(head, M.skinDark, .088, .04, .148, .105, .075, .055);
  box(head, M.eye, -.087, .038, .182, .065, .027, .02);
  box(head, M.eye, .087, .038, .182, .065, .027, .02);
  box(head, skin, 0, -.018, .18, .057, .08, .064);
  box(head, M.mouth, 0, -.11, .166, .135, .06, .025);
  box(head, M.teeth, -.016, -.09, .183, .09, .014, .016);
  box(head, M.wound, .138, -.07, .138, .04, .1, .025).rotation.z = -.2;

  function arm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * .31, 1.43, 0);
    pivot.rotation.x = -.8;
    pivot.rotation.z = side * -.14;
    group.add(pivot);
    box(pivot, shirt, 0, -.13, 0, .195, .31, .22);
    box(pivot, skin, 0, -.36, .025, .14, .27, .15);
    const forearm = new THREE.Group();
    forearm.position.set(0, -.44, .025);
    forearm.rotation.x = -.38;
    pivot.add(forearm);
    box(forearm, skin, 0, -.11, 0, .125, .24, .14);
    box(forearm, M.skinDark, 0, -.275, .02, .15, .13, .12);
    box(forearm, skin, -.04, -.35, .045, .045, .095, .06);
    box(forearm, skin, .035, -.355, .045, .065, .105, .06);
    return pivot;
  }
  const leftArm = arm(-1), rightArm = arm(1);
  if (brute) group.scale.set(1.34, 1.28, 1.3);
  if (runner) group.scale.set(.88, .97, .93);
  const torsoRig = new THREE.Group();
  torsoRig.position.copy(torso.position);
  torsoRig.rotation.copy(torso.rotation);
  group.add(torsoRig);
  const bodyParts = group.children.filter(part => part.isMesh);
  for (const part of bodyParts) torsoRig.attach(part);
  for (const [name, joint] of Object.entries({ leftLeg, rightLeg, leftArm, rightArm, head, torso: torsoRig })) {
    joint.name = name;
    mergeRigid(joint);
  }
  // Cache only an unanimated rig; instances share the compact immutable assets.
  zombieTemplates.set(type, group);
  return cloneZombie(group, type);
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
