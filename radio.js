import * as THREE from './vendor/three.module.js';

export const programs = {
  pinata: {title:'День рождения орды', hint:'Зомби в колпаках роняют ящики с патронами.'},
  heads: {title:'Раздутые эго', hint:'Огромные головы получают в полтора раза больше урона от попаданий в голову.'},
  statues: {title:'Музыкальные статуи', hint:'Когда музыка стихает, вся орда замирает на две секунды.'}
};
const danceRadius = 12;
const ball = new THREE.SphereGeometry(1, 16, 12);
const box = new THREE.BoxGeometry(1, 1, 1);
const disc = new THREE.CylinderGeometry(1, 1, 1, 28);
const hat = new THREE.ConeGeometry(.24,.48,9);
const ink = mat(0x16162a), yellow = mat(0xffdc25), orange = mat(0xff7535);
const mint = mat(0x52ffe1,true), pink = mat(0xff518c,true), cream = mat(0xffefad,true);
function mat(color, glow=false) {
  return new THREE.MeshStandardMaterial({color, roughness:.46, emissive:color, emissiveIntensity:glow?.74:.12});
}
function part(parent, geo, material, x,y,z, w=1,h=1,d=1) {
  const mesh = new THREE.Mesh(geo,material);
  mesh.position.set(x,y,z); mesh.scale.set(w,h,d); parent.add(mesh); return mesh;
}
export function dressZombie(mesh,program,prize) {
  const head = mesh.userData.head;
  if(program==='heads') {
    head.scale.setScalar(2.15);
    part(head,box,ink,0,.065,.174,.38,.08,.045);
  } else if(prize) {
    part(head,hat,pink,0,.43,0);
    part(head,ball,cream,0,.69,0,.064,.064,.064);
    part(head,disc,mint,0,.23,0,.25,.045,.25);
  }
}
export function createRadio(scene, sound) {
  const booth = new THREE.Group(), bird = new THREE.Group();
  scene.add(booth); booth.add(bird); booth.visible=false;
  part(booth,disc,ink,0,.16,0,.79,.32,.79);
  part(booth,disc,mint,0,.31,0,.8,.04,.8);
  part(booth,disc,pink,0,.075,0,.8,.035,.8);
  part(bird,ball,yellow,0,.76,0,.58,.4,.51);
  part(bird,ball,yellow,0,1.26,.19,.43,.42,.42);
  part(bird,ball,orange,0,1.19,.58,.30,.095,.25);
  part(bird,box,ink,0,1.36,.56,.66,.115,.085);
  part(bird,box,mint,-.14,1.39,.609,.13,.025,.01);
  for(const side of [-1,1]){
    part(bird,ball,yellow,side*.48,.81,-.05,.19,.24,.33);
    part(bird,ball,ink,side*.39,1.33,.14,.14,.21,.19);
    part(bird,ball,pink,side*.48,1.33,.14,.07,.15,.13);
  }
  const band = new THREE.TorusGeometry(.424,.045,6,20,Math.PI);
  part(bird,band,ink,0,1.35,.14);
  const ripple=part(booth,new THREE.RingGeometry(.96,1,56),new THREE.MeshBasicMaterial({color:0x5df6d7,transparent:true,opacity:.4,depthWrite:false,side:THREE.DoubleSide}),0,.035,0);
  ripple.rotation.x=-Math.PI/2;
  const colors=[0xff4f91,0x55ffe0,0xffda37,0xb297ff];
  const confettiMat=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
  const paper=new THREE.PlaneGeometry(.10,.22), transform=new THREE.Object3D(), bursts=[];
  let bag=[],lastBeat=-1,serial=0;
  const state={program:'pinata',elapsed:0,playing:0,cooldown:0,x:0,z:0,serial:0};
  function clear() {
    booth.scale.setScalar(1);ripple.visible=true;bag=[]; lastBeat=-1; serial=0;
    Object.assign(state,{program:'pinata',elapsed:0,playing:0,cooldown:0,x:0,z:0,serial:0});
    booth.visible=false;
    for(const burst of bursts)burst.mesh.visible=false;
  }
  function startWave(wave) {
    if(wave===1){bag=['statues','heads']; if(Math.random()<.5)bag.reverse();state.program='pinata';}
    else {
      if(!bag.length) {
        bag=Object.keys(programs);
        for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
        if(bag.at(-1)===state.program)[bag[0],bag[2]]=[bag[2],bag[0]];
      }
      state.program=bag.pop();
    }
    Object.assign(state,{elapsed:0,playing:0,cooldown:0}); booth.visible=false; lastBeat=-1;
  }
  function deploy(x,z) {
    if(state.cooldown>0)return false;
    Object.assign(state,{x,z,playing:6,cooldown:21,serial:++serial});sound('quack');return true;
  }
  function sync(remote) {
    if(!remote||!Object.hasOwn(programs,remote.program))return;
    if(remote.serial!==state.serial&&remote.playing>0)sound('quack');
    Object.assign(state,remote);
  }
  function partyPop(pos){
    let b=bursts.find(b=>!b.mesh.visible);
    if(!b&&bursts.length<6){
      const mesh=new THREE.InstancedMesh(paper,confettiMat,34);mesh.frustumCulled=false;
      for(let i=0;i<mesh.count;i++)mesh.setColorAt(i,new THREE.Color(colors[i%colors.length]));
      scene.add(mesh);b={mesh,vel:[]};bursts.push(b);
    }
    if(!b)return;
    b.mesh.visible=true;b.mesh.position.copy(pos);b.mesh.position.y+=1;b.age=0;
    b.vel=Array.from({length:b.mesh.count},()=>[(Math.random()-.5)*5,2+Math.random()*4,(Math.random()-.5)*5]);
    animateBurst(b,0);sound('pop',{volume:.65});
  }
  function animateBurst(b,dt){
    b.age+=dt;const t=b.age;
    if(t>1.1){b.mesh.visible=false;return;}
    b.vel.forEach(([x,y,z],i)=>{
      transform.position.set(x*t,y*t-4*t*t,z*t);transform.rotation.set(i+t*5,i*.7+t*3,t*5);
      transform.scale.setScalar(Math.min(1,(1.1-t)*5));transform.updateMatrix();b.mesh.setMatrixAt(i,transform.matrix);
    });
    b.mesh.instanceMatrix.needsUpdate=true;
  }
  function still(){return state.program==='statues'&&state.elapsed%6>=4;}
  function dancing(pos){return state.playing>0&&Math.hypot(pos.x-state.x,pos.z-state.z)<=danceRadius;}
  function tick(dt,active) {
    if(active)state.elapsed+=dt;
    state.playing=active?Math.max(0,state.playing-dt):0;state.cooldown=Math.max(0,state.cooldown-dt);
    booth.visible=state.playing>0;
    const beat=Math.floor(state.elapsed/.5);
    if(beat!==lastBeat){
      if(active&&(booth.visible||(state.program==='statues'&&!still())))sound(beat%2?'offbeat':'downbeat',{volume:booth.visible?.72:.32});
      lastBeat=beat;
    }
    if(booth.visible){
      booth.position.set(state.x,0,state.z); bird.rotation.y=state.elapsed*2.5;
      bird.rotation.z=Math.sin(state.elapsed*12)*.14;bird.position.y=Math.abs(Math.sin(state.elapsed*6))*.16;
      const pulse=(state.elapsed%1.5)/1.5;ripple.scale.setScalar(1+pulse*(danceRadius-1));ripple.material.opacity=.42*(1-pulse);
    }
    for(const b of bursts)if(b.mesh.visible)animateBurst(b,dt);
  }
  function preview(time){
    booth.visible=true;booth.position.set(5,0,4);booth.scale.setScalar(2.05);
    ripple.visible=false;bird.rotation.y=-.48+Math.sin(time*.6)*.28;
    bird.rotation.z=Math.sin(time*4)*.085;bird.position.y=Math.abs(Math.sin(time*2))*.10;
  }
  return {state,clear,startWave,deploy,sync,partyPop,tick,still,dancing,preview};
}

export function dancePose(mesh, time, id) {
  const u=mesh.userData, beat=time*Math.PI*4+id;
  u.leftArm.rotation.x=-1.8+.65*Math.sin(beat);u.rightArm.rotation.x=-1.8-.65*Math.sin(beat);
  u.leftLeg.rotation.x=.45*Math.sin(beat);u.rightLeg.rotation.x=-u.leftLeg.rotation.x;
  mesh.rotation.z=.13*Math.sin(beat);
}

