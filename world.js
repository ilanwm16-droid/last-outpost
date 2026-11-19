import * as THREE from './vendor/three.module.js';

// The arena is built from shared, instanced low-poly geometry. All cover is
// represented by simple X/Z bounds for both player and horde navigation.
export function buildWorld(scene) {
  scene.background = new THREE.Color(0x101e28);
  scene.fog = new THREE.FogExp2(0x152b33, 0.0185);
  const colliders = [], props = [], batches = new Map();
  const materials = {
    asphalt: new THREE.MeshStandardMaterial({color:0x26363a, roughness:0.95}),
    concrete: new THREE.MeshStandardMaterial({color:0x52615e, roughness:0.95}),
    darkConcrete: new THREE.MeshStandardMaterial({color:0x334247, roughness:0.95}),
    metal: new THREE.MeshStandardMaterial({color:0x283b3d, roughness:0.65, metalness:0.3}),
    wire: new THREE.MeshStandardMaterial({color:0x63716c, roughness:0.7, metalness:0.5}),
    rust: new THREE.MeshStandardMaterial({color:0x70543c, roughness:0.85}),
    olive: new THREE.MeshStandardMaterial({color:0x59624b, roughness:0.8}),
    teal: new THREE.MeshStandardMaterial({color:0x28555a, roughness:0.65, metalness:0.2}),
    wood: new THREE.MeshStandardMaterial({color:0x6b6250, roughness:0.95}),
    black: new THREE.MeshStandardMaterial({color:0x151f22, roughness:0.9}),
    yellow: new THREE.MeshStandardMaterial({color:0xac9153, roughness:0.9}),
    trunk: new THREE.MeshStandardMaterial({color:0x273331, roughness:1}),
    pine: new THREE.MeshStandardMaterial({color:0x173a38, roughness:1}),
    lamp: new THREE.MeshBasicMaterial({color:0xffc47a}),
    amber: new THREE.MeshBasicMaterial({color:0xb76535}),
    window: new THREE.MeshBasicMaterial({color:0x465849}),
    flame: new THREE.MeshBasicMaterial({color:0xffa03f, transparent:true, opacity:0.9}),
    flameCore: new THREE.MeshBasicMaterial({color:0xffe2a3}),
  };
  const geometries = {
    box:new THREE.BoxGeometry(1,1,1),
    cylinder:new THREE.CylinderGeometry(0.5,0.5,1,10),
    cone:new THREE.ConeGeometry(0.5,1,7),
  };
  const dummy = new THREE.Object3D();
  function instance(shape,mat,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0) {
    const key=shape+'/'+mat;
    if(!batches.has(key)) batches.set(key,[]);
    dummy.position.set(x,y,z); dummy.rotation.set(rx,ry,rz); dummy.scale.set(sx,sy,sz); dummy.updateMatrix();
    batches.get(key).push(dummy.matrix.clone());
  }
  function box(mat,x,y,z,w,h,d,ry=0,rz=0) { instance('box',mat,x,y,z,w,h,d,0,ry,rz); }
  function cylinder(mat,x,y,z,r,h,rx=0,rz=0) { instance('cylinder',mat,x,y,z,r*2,h,r*2,rx,0,rz); }
  function collision(x,z,hx,hz,height=3.2) { colliders.push({x,z,hx,hz,height}); }
  let seed=9147;
  function rand(){ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }

  scene.add(new THREE.HemisphereLight(0xa1d5da,0x34403b,2.0));
  const moonlight=new THREE.DirectionalLight(0x94c9cf,2.0);
  moonlight.position.set(-18,35,15); scene.add(moonlight);
  const sunset=new THREE.DirectionalLight(0xe7a26f,0.85);
  sunset.position.set(25,8,-50); scene.add(sunset);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(250,250),materials.asphalt);
  ground.rotation.x=-Math.PI/2; ground.position.y=-0.04; scene.add(ground);
  // Small changes in slab color break up the ground without a texture download.
  const slabGeo=new THREE.BoxGeometry(1,1,1);
  const slabs=new THREE.InstancedMesh(slabGeo,materials.concrete,121);
  for(let row=0;row<11;row++)for(let col=0;col<11;col++) {
    const i=row*11+col;
    dummy.position.set((col-5)*7.5,-0.035,(row-5)*7.5);
    dummy.rotation.set(0,0,0); dummy.scale.set(7.45,0.04,7.45); dummy.updateMatrix();
    slabs.setMatrixAt(i,dummy.matrix);
    slabs.setColorAt(i,new THREE.Color().setRGB(0.44+rand()*0.07,0.50+rand()*0.07,0.49+rand()*0.07));
  }
  scene.add(slabs);
  for(let z=-34;z<35;z+=6)box('yellow',0,0.013,z,0.14,0.015,2.8);
  for(const x of [-5.4,5.4])box('yellow',x,0.012,0,0.1,0.014,70);
  for(let i=0;i<24;i++){
    const x=-35+rand()*70,z=-35+rand()*70;
    box('black',x,0.016,z,0.025,0.012,0.5+rand()*2,rand()*3);
  }

  // Wide perimeter: the low wall and wires define the play area without hiding
  // incoming enemies. Lamps establish the four sides at a glance.
  for(const sign of [-1,1]) {
    box('darkConcrete',sign*39.4,0.35,0,0.8,0.7,79);
    box('darkConcrete',0,0.35,sign*39.4,79,0.7,0.8);
    for(let p=-39;p<=39;p+=3) {
      box('wire',sign*39.4,2.1,p,0.08,3.7,0.08);
      box('wire',p,2.1,sign*39.4,0.08,3.7,0.08);
    }
    for(let h=1;h<=3.8;h+=0.55) {
      box('wire',sign*39.4,h,0,0.025,0.025,78);
      box('wire',0,h,sign*39.4,78,0.025,0.025);
    }
  }

  function lightPole(x,z,facing=1) {
    cylinder('metal',x,4.25,z,0.12,8.5);
    collision(x,z,0.14,0.14,8.5);
    box('metal',x+facing*0.7,8.4,z,1.6,0.12,0.12);
    box('black',x+facing*1.35,8.3,z,0.8,0.15,0.5);
    box('lamp',x+facing*1.35,8.2,z,0.65,0.05,0.4);
    const light=new THREE.PointLight(0xffb66d,23,16,1.7);light.position.set(x+facing*1.35,7.9,z);scene.add(light);
    box('yellow',x,1.25,z,0.25,0.7,0.25);
  }
  lightPole(-29,-24);lightPole(29,-24,-1);lightPole(-29,24);lightPole(29,24,-1);

  function container(x,z,color='teal',w=9,d=3.6) {
    box(color,x,1.7,z,w,3.4,d); collision(x,z,w/2+0.15,d/2+0.13,3.47);
    box('metal',x,3.42,z,w+0.1,0.1,d+0.1);
    for(let dx=-w/2+0.5;dx<w/2;dx+=0.65){
      box(color,x+dx,1.7,z-d/2-0.05,0.12,3.15,0.12);
      box(color,x+dx,1.7,z+d/2+0.05,0.12,3.15,0.12);
    }
    for(let side of [-1,1]){
      box('metal',x+w/2+0.04,1.7,z+side*d/4,0.09,3.2,0.06);
      box('wire',x+w/2+0.09,1.6,z+side*d/4,0.06,1.8,0.06);
    }
    box('yellow',x-w/2+0.4,1.7,z+d/2+0.07,0.22,1.2,0.015);
  }
  container(-22,-16,'teal',10,3.6);
  container(22,-25,'rust',10,3.6);
  container(29,9,'teal',7,3.6);

  function crate(x,z,size=1.7,y=0) {
    box('wood',x,y+size/2,z,size,size,size);
    if(y===0)collision(x,z,size/2+0.03,size/2+0.03,size+0.02);
    else {
      const base=colliders.find(c=>c.x===x&&c.z===z);
      if(base)base.height=Math.max(base.height,y+size+0.02);
    }
    for(const side of [-1,1]) {
      box('olive',x+side*size*0.37,y+size/2,z,size*0.09,size+0.04,size+0.04);
      box('olive',x,y+size/2,z+side*size*0.37,size+0.04,size+0.04,size*0.08);
    }
  }
  crate(-11,-5);crate(-12.6,-7,1.45);crate(-11,-5,1.25,1.7);
  crate(12,4,1.6);crate(14,4,1.6);crate(14,4,1.3,1.6);
  crate(-27,17,1.9);crate(-29,17,1.9);crate(23,24,1.6);

  function barrier(x,z,rotation=0) {
    box('concrete',x,0.55,z,5,1.1,0.85,rotation);
    box('concrete',x,0.12,z,5.3,0.24,1.2,rotation);
    for(let i=-2;i<=2;i++) {
      const dx=i*0.83, sx=x+Math.cos(rotation)*dx,sz=z-Math.sin(rotation)*dx;
      box(i%2?'yellow':'black',sx+Math.sin(rotation)*0.44,0.72,sz+Math.cos(rotation)*0.44,0.42,0.42,0.025,rotation,-0.25);
    }
    if(Math.abs(rotation)<0.1)collision(x,z,2.65,0.6,1.1);else collision(x,z,0.6,2.65,1.1);
  }
  barrier(-15,11);barrier(14,-9);barrier(-5,-24);barrier(8,27);barrier(-30,-2,Math.PI/2);

  // An abandoned cargo truck gives the arena a memorable large silhouette.
  const tx=-22,tz=27;
  box('black',tx,0.8,tz,2.65,0.4,7.6);
  box('olive',tx,1.6,tz-2.4,2.8,2.2,2.2);
  box('olive',tx,1.2,tz-3.6,2.7,1.3,1.0);
  box('black',tx,2.05,tz-3.52,2.1,0.7,0.025);
  box('teal',tx,2.09,tz-3.55,1.98,0.58,0.03);
  box('metal',tx,2.1,tz-3.57,0.05,0.66,0.03);
  box('olive',tx,1.6,tz+1.5,2.8,1.5,4.6);
  box('wood',tx,2.2,tz+1.5,2.7,0.2,4.4);
  box('darkConcrete',tx,2.9,tz+1.4,2.75,1.3,4.5);
  for(let z of [-2.6,1.5,2.8])for(let side of [-1,1]){
    cylinder('black',tx+side*1.4,0.65,tz+z,0.62,0.3,0,Math.PI/2);
    cylinder('metal',tx+side*1.56,0.65,tz+z,0.27,0.04,0,Math.PI/2);
  }
  box('yellow',tx-0.88,1.1,tz-4.11,0.42,0.3,0.05);
  box('yellow',tx+0.88,1.1,tz-4.11,0.42,0.3,0.05);
  collision(tx,tz,1.65,4.2,3.55);

  function fireBarrel(x,z) {
    cylinder('rust',x,0.65,z,0.44,1.3);collision(x,z,0.48,0.48,1.32);
    for(let y of [0.22,1.08])cylinder('metal',x,y,z,0.455,0.08);
    cylinder('black',x,1.305,z,0.35,0.03);
    const flame=new THREE.Mesh(new THREE.ConeGeometry(0.32,0.9,6),materials.flame);
    flame.position.set(x,1.68,z);scene.add(flame);
    const core=new THREE.Mesh(new THREE.ConeGeometry(0.19,0.55,5),materials.flameCore);
    core.position.set(x,1.48,z);scene.add(core);
    const light=new THREE.PointLight(0xff7731,10,11,1.6);light.position.set(x,2,z);scene.add(light);
    props.push({type:'fire',mesh:flame,core,light,phase:rand()*10});
  }
  fireBarrel(-8,-15);fireBarrel(18,17);

  // Guardhouse and sector signage beyond the north-west edge.
  box('concrete',-32,2.4,-30,6.2,4.8,6); collision(-32,-30,3.1,3,5.02);
  box('black',-32,4.9,-30,6.7,0.24,6.6);
  box('teal',-32,2.8,-26.96,3.5,1.4,0.04);
  box('metal',-32,2.8,-26.91,0.1,1.5,0.06);
  box('black',-29.6,1.5,-26.94,0.9,3,0.04);
  function sign(text,x,y,z,w,h) {
    const c=document.createElement('canvas');c.width=1024;c.height=128;
    const ctx=c.getContext('2d');ctx.fillStyle='#202e30';ctx.fillRect(0,0,1024,128);
    ctx.strokeStyle='#ab9a6d';ctx.lineWidth=5;ctx.strokeRect(6,6,1012,116);
    ctx.font='bold 56px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ded0a6';ctx.fillText(text,512,68);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex}));mesh.position.set(x,y,z);scene.add(mesh);
  }
  sign('КАРАНТИН  /  СЕКТОР 07',0,6.8,-39.1,14,1.75);
  box('metal',-7.7,3.7,-39.1,0.22,7.4,0.22);box('metal',7.7,3.7,-39.1,0.22,7.4,0.22);
  sign('07',-32,4.1,-26.85,1.8,0.62);

  // Distant apartment blocks, water tanks and factory chimneys stay outside
  // the collidable space. Their windows are instanced, too.
  for(let i=0;i<11;i++) {
    const x=(i-5)*13,z=-58-rand()*19,w=8+rand()*7,h=9+rand()*21,d=6+rand()*6;
    box('darkConcrete',x,h/2,z,w,h,d);
    box('black',x,h+0.25,z,w+0.5,0.5,d+0.5);
    for(let yy=2;yy<h-1;yy+=2.6)for(let xx=-w/2+1.4;xx<w/2-0.4;xx+=2.1){
      box(rand()<0.16?'window':'black',x+xx,yy,z+d/2+0.02,0.7,1.15,0.04);
    }
    if(i%3===0){
      cylinder('darkConcrete',x+2,h+5,z,1.3,10);
      cylinder('rust',x+2,h+9.3,z,1.32,0.7);
      box('amber',x+2,h+10.2,z,0.2,0.2,0.2);
    }
  }
  for(let side of [-1,1])for(let i=0;i<18;i++){
    const x=side*(46+rand()*17),z=-45+i*5.4,h=7+rand()*10;
    cylinder('trunk',x,h*0.23,z,0.22,h*0.46);
    for(let k=0;k<3;k++)instance('cone','pine',x,h*(0.39+k*0.2),z,(h*0.43)*(1-k*0.17),h*0.59,(h*0.43)*(1-k*0.17));
  }
  for(let i=0;i<15;i++){
    const x=-45+i*6.5,z=49+rand()*15,h=9+rand()*7;
    instance('cone','pine',x,h*0.5,z,h*0.4,h,h*0.4);
  }

  const sun=new THREE.Mesh(new THREE.SphereGeometry(8.4,24,16),new THREE.MeshBasicMaterial({color:0xa9714c,fog:false}));
  sun.position.set(25,32,-140);scene.add(sun);
  const starPoints=[];
  for(let i=0;i<90;i++)starPoints.push((rand()-0.5)*250,35+rand()*95,-60-rand()*100);
  const starsGeo=new THREE.BufferGeometry();starsGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPoints,3));
  scene.add(new THREE.Points(starsGeo,new THREE.PointsMaterial({color:0x91b8bb,size:0.16,transparent:true,opacity:0.45,fog:false})));

  for(const [key,matrices] of batches) {
    const [shape,mat]=key.split('/');
    const mesh=new THREE.InstancedMesh(geometries[shape],materials[mat],matrices.length);
    matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
    mesh.computeBoundingSphere();scene.add(mesh);
  }
  const spawnPoints=[
    {x:-33,z:-35},{x:0,z:-35},{x:32,z:-34},{x:35,z:-8},
    {x:35,z:29},{x:0,z:35},{x:-34,z:32},{x:-35,z:4},
  ];
  return {colliders,spawnPoints,props};
}

export function animateWorld(props,time) {
  for(const p of props)if(p.type==='fire'){
    const flicker=0.86+Math.sin(time*9+p.phase)*0.1+Math.sin(time*17+p.phase)*0.07;
    p.mesh.scale.set(1/flicker,flicker,1/flicker);
    p.mesh.rotation.y=time*0.7+p.phase;
    p.core.scale.y=1+Math.sin(time*13+p.phase)*0.13;
    p.light.intensity=10*flicker;
  }
}
