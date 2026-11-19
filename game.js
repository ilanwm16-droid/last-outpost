import * as THREE from './vendor/three.module.js';
import {buildWorld,animateWorld} from './world.js';
import {createZombie,createWeapon,createRocket,createMinigun} from './models.js';
import {waveConfig,enemyStats,blastDamage,bestWave} from './rules.js';
import {createAudio} from './audio.js';
import {createNetwork} from './network.js';
import {createAirdrop} from './airdrop.js';
import {createRadio, programs, dressZombie, dancePose} from './radio.js';
import {createGrenades} from './grenades.js';
import {createNavigator} from './navigation.js';

const $=id=>document.getElementById(id), canvas=$('game');
const coarse=matchMedia('(pointer:coarse)').matches;
let renderer;
try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});} catch(e) {$('loadingText').textContent='Для игры нужен WebGL. Открой ссылку в Chrome или Edge с включённым аппаратным ускорением.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,coarse?1.4:1.65));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.06,230);
camera.rotation.order='YXZ';scene.add(camera);
const world=buildWorld(scene),raycaster=new THREE.Raycaster(),v=new THREE.Vector3();
const navigator=createNavigator(world.colliders);
let navTime=0,emptyTime=0;
const weapons={minigun:{mesh:createMinigun(),mag:0,reserve:0,capacity:1200,reload:0,rate:.042},ak:{mesh:createWeapon('ak'),mag:30,reserve:180,capacity:30,reload:1.85,rate:.105},rpg:{mesh:createWeapon('rpg'),mag:1,reserve:6,capacity:1,reload:2.65,rate:.9}};
for(const w of Object.values(weapons)){camera.add(w.mesh);w.mesh.visible=false;w.mesh.traverse(o=>{if(o.isMesh){o.castShadow=false;o.frustumCulled=false;}});}
const weaponLight=new THREE.PointLight(0xffae59,0,5);weaponLight.position.set(.3,-.1,-1.1);camera.add(weaponLight);
const flash=new THREE.Mesh(new THREE.IcosahedronGeometry(.12,0),new THREE.MeshBasicMaterial({color:0xffd477,transparent:true,opacity:.95,depthWrite:false}));flash.visible=false;camera.add(flash);
const player={pos:new THREE.Vector3(0,1.72,12),yaw:0,pitch:0,health:100,stamina:100,vy:0,grounded:true,grenades:3,lastGrenade:-99};
let phase='menu',beforePause='active',wave=0,config=waveConfig(1),spawned=0,waveKills=0,kills=0,score=0,current='ak',shootCooldown=0,reloadTime=0,reloadingWeapon=null,breakTime=0,spawnTimer=0,shotKick=0,shake=0,damageTime=0,hitTime=0,bannerTime=0,toastTime=0,time=0,aim=false,shooting=false,dragLook=false,lockUnavailable=false;
let soundOn=true,sensitivity=1,best=0;
try {best=Number(localStorage.getItem('outpost.best'))||0;soundOn=localStorage.getItem('outpost.sound')!=='false';sensitivity=Number(localStorage.getItem('outpost.sensitivity'))||1;}catch{}
$('record').textContent=`ВОЛНА ${String(best).padStart(2,'0')}`;$('sound').checked=soundOn;$('sensitivity').value=sensitivity;$('sensitivityValue').value=sensitivity.toFixed(1);
const keys=new Set(),enemies=[],dead=[],rockets=[],effects=[],pickups=[],decor=[];
const grenades=createGrenades(scene,world.colliders,pos=>explode(pos));
let grenadeRequest=0;
const audioEngine=createAudio();
const radio=createRadio(scene,sound);
function initAudio(){audioEngine.setEnabled(soundOn);audioEngine.init();}
function sound(kind,options){audioEngine.setEnabled(soundOn);audioEngine.play(kind,options);}
function toast(message,duration=2.4){$('toast').textContent=message;toastTime=duration;$('toast').style.opacity=1;}
function banner(label,title,sub,duration=3){$('bannerLabel').textContent=label;$('bannerTitle').textContent=title;$('bannerSub').textContent=sub;bannerTime=duration;$('banner').style.opacity=1;}
function saveBest(){best=bestWave(best,wave);try{localStorage.setItem('outpost.best',best);}catch{}$('record').textContent=`ВОЛНА ${String(best).padStart(2,'0')}`;}
function setWeapon(name){if(current===name)return;if(name==='minigun'&&minigunUntil<wave||name==='minigun'&&!minigunUntil)return;current=name;reloadTime=0;reloadingWeapon=null;aim=false;shotKick=.12;sound('switch');updateHUD();}
function reload(){if(current==='minigun')return;const w=weapons[current];if(reloadTime>0||w.mag===w.capacity)return;if(w.reserve<=0){toast('Боезапас исчерпан. Ищи ящики или смени оружие.');return;}reloadTime=w.reload;reloadingWeapon=current;sound('reload');}
function updateHUD(){updateRadioHud();const w=weapons[current];$('grenadeCount').textContent=player.grenades;$('wave').textContent=String(wave).padStart(2,'0');$('enemies').textContent=Math.max(0,config.count-waveKills);$('waveProgress').style.width=`${(1-waveKills/config.count)*100}%`;$('kills').textContent=kills;$('score').textContent=String(score).padStart(6,'0')+' ОЧКОВ';$('health').textContent=Math.ceil(player.health);$('healthBar').style.width=player.health+'%';$('healthBar').style.background=player.health<30?'#ed714b':'#e5e9dc';$('ammo').textContent=String(w.mag).padStart(2,'0');$('ammo').style.color=w.mag===0?'#ed714b':'';$('reserve').textContent=w.reserve;$('weaponName').textContent=current==='ak'?'АК-47':current==='minigun'?'МИНИГАН':'РПГ-7';$('ammoStatus').textContent=reloadTime>0?'ПЕРЕЗАРЯДКА…':current==='ak'?'7.62 × 39 ММ · АВТО':current==='minigun'?`ДО КОНЦА ВОЛНЫ ${minigunUntil}`:'РЕАКТИВНАЯ ГРАНАТА';$('slotAk').classList.toggle('active',current==='ak');$('slotRpg').classList.toggle('active',current==='rpg');$('slotMini').hidden=!minigunUntil;$('slotMini').classList.toggle('active',current==='minigun');updateSquadHUD();}
function clearGame(){previousProgramWave=0;radio.clear();grenades.clear();grenadeRequest=0;drop?.dispose();drop=null;dropWave=0;minigunUntil=0;weapons.minigun.mag=0;coopPaused=false;for(const q of squad.values()){scene.remove(q.mesh);}squad.clear();takenPickups.clear();for(const list of [enemies,dead,rockets,effects,pickups]){for(const e of list){scene.remove(e.mesh);if(e.dispose){e.mesh.geometry?.dispose();e.mesh.material?.dispose();}}list.length=0;}keys.clear();shooting=false;aim=false;dragLook=false;joyX=joyY=0;navTime=0;emptyTime=0;reloadTime=0;shootCooldown=0;shotKick=0;shake=0;damageTime=0;hitTime=0;bannerTime=0;toastTime=0;flash.visible=false;weaponLight.intensity=0;$('damage').style.opacity=0;}
function startGame(){clearGame();gameSession++;$('coopModal').hidden=true;phase='active';wave=0;kills=0;score=0;current='ak';player.pos.set(0,1.72,12);player.yaw=0;player.pitch=0;player.health=100;player.stamina=100;player.vy=0;player.grounded=true;player.grenades=3;player.lastGrenade=-99;weapons.ak.mag=30;weapons.ak.reserve=180;weapons.rpg.mag=1;weapons.rpg.reserve=6;for(const d of decor)d.visible=false;for(const id of ['menu','pause','gameover','settingsModal'])$(id).hidden=true;$('hud').hidden=false;initAudio();if(net.role!=='client')nextWave();else updateHUD();if(net.role==='host'){for(const [id,q]of net.peers){const mate=ensureMate(id,q.name);net.send({t:'start',session:gameSession,spawn:mate.pos.toArray()},id);}}requestLock();}
function nextWave(){if(net.role==='client')return;expireMinigun();phase='active';wave++;radio.startWave(wave);config=waveConfig(wave,net.role==='solo'?1:1+net.peers.size);spawned=0;waveKills=0;spawnTimer=wave%5===0?9:.8;if(wave%5===0)beginDrop(wave);saveBest();$('waveState').textContent='УДЕРЖИВАЙ ПОЗИЦИЮ';announceProgram();sound('wave');updateHUD();}
function completeWave(){expireMinigun();phase='break';breakTime=10;player.grenades=Math.min(5,player.grenades+2);for(const q of squad.values()){q.grenades=Math.min(5,q.grenades+2);q.health=Math.min(100,Math.max(40,q.health)+30);}player.health=Math.min(100,Math.max(net.role==='solo'?0:40,player.health)+30);weapons.ak.reserve=Math.min(360,weapons.ak.reserve+110+wave*15);weapons.rpg.reserve=Math.min(14,weapons.rpg.reserve+3);score+=wave*250;$('waveState').textContent='ПЕРИМЕТР ЗАЧИЩЕН';banner('ВОЛНА ОТБИТА','ПЕРЕДЫШКА','+30 здоровья · боезапас пополнен',10);toast('E — начать следующую волну',9);sound('pickup');updateHUD();}
function pause(){if(net.role!=='solo'&&(phase==='active'||phase==='break')){if(coopPaused)return;coopPaused=true;shooting=false;aim=false;keys.clear();if(document.pointerLockElement)document.exitPointerLock?.();$('pause').hidden=false;return;}if(phase!=='active'&&phase!=='break')return;beforePause=phase;phase='paused';shooting=false;aim=false;keys.clear();if(document.pointerLockElement)document.exitPointerLock?.();$('pause').hidden=false;}
function resume(){if(coopPaused){coopPaused=false;$('pause').hidden=true;requestLock();return;}if(phase!=='paused')return;phase=beforePause;$('pause').hidden=true;requestLock();initAudio();}
function returnMenu(){net.leave();phase='menu';document.exitPointerLock?.();clearGame();for(const id of ['hud','pause','gameover'])$(id).hidden=true;$('menu').hidden=false;for(const d of decor)d.visible=true;}
function die(){if(net.role==='host'&&[...squad.values()].some(q=>q.health>0)){shooting=false;banner('НУЖНА ПОМОЩЬ','ТЫ РАНЕН','Напарник может поднять тебя: удерживать F рядом.',999);return;}if(net.role==='host')net.broadcast({t:'over'});if(phase==='gameover')return;phase='gameover';shooting=false;keys.clear();saveBest();document.exitPointerLock?.();$('finalWave').textContent=String(wave).padStart(2,'0');$('finalKills').textContent=kills;$('finalScore').textContent=score;$('deathMessage').textContent=wave>=best?'Каждая попытка делает тебя сильнее. Ещё раз?':'Ты держался до последнего.';$('gameover').hidden=false;sound('blast');}
function requestLock(){if(coarse)return;const fallback=()=>{lockUnavailable=true;$('lockHint').textContent='Обзор: ЛКМ + движение мыши или стрелки';$('lockHint').hidden=false;toast('Полный обзор мышью доступен в отдельном окне Chrome или Edge.',6);};try{const p=canvas.requestPointerLock();p?.catch(fallback);}catch{fallback();}}
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===canvas){lockUnavailable=false;$('lockHint').hidden=true;}else if(phase==='active'||phase==='break')pause();});
document.addEventListener('pointerlockerror',()=>{lockUnavailable=true;});
$('start').onclick=()=>{net.leave();startGame();};$('resume').onclick=resume;$('restart').onclick=()=>{if(net.role!=='client')startGame();else toast('Перезапуск доступен ведущему.');};$('restartPause').onclick=$('restart').onclick;$('quit').onclick=returnMenu;$('menuReturn').onclick=returnMenu;
$('settings').onclick=()=>{$('settingsModal').hidden=false;};$('closeSettings').onclick=()=>{$('settingsModal').hidden=true;};
$('sound').onchange=e=>{soundOn=e.target.checked;try{localStorage.setItem('outpost.sound',soundOn);}catch{}initAudio();};$('sensitivity').oninput=e=>{sensitivity=Number(e.target.value);$('sensitivityValue').value=sensitivity.toFixed(1);try{localStorage.setItem('outpost.sensitivity',sensitivity);}catch{}};
document.addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&phase!=='menu')e.preventDefault();if(e.code==='Escape'){pause();return;}if(coopPaused||phase!=='active'&&phase!=='break')return;keys.add(e.code);if(e.code==='Digit1')setWeapon('ak');if(e.code==='Digit2')setWeapon('rpg');if(e.code==='Digit3')setWeapon('minigun');if(e.code==='KeyR')reload();if(e.code==='KeyG'&&!e.repeat)throwGrenade();if(e.code==='KeyQ'&&!e.repeat)requestDj();if(e.code==='KeyE'&&phase==='break')nextWave();if(e.code==='Space'&&player.grounded&&player.health>0){player.vy=6;player.grounded=false;}});
document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousedown',e=>{if(coopPaused||player.health<=0||phase!=='active'&&phase!=='break')return;if(e.button===0){shooting=true;dragLook=true;if(!document.pointerLockElement&&!lockUnavailable)requestLock();}if(e.button===2)aim=true;initAudio();});
document.addEventListener('mouseup',e=>{if(e.button===0){shooting=false;dragLook=false;}if(e.button===2)aim=false;});
document.addEventListener('mousemove',e=>{if((phase==='active'||phase==='break')&&(document.pointerLockElement===canvas||dragLook)){player.yaw-=e.movementX*.0022*sensitivity*(aim?.62:1);player.pitch=THREE.MathUtils.clamp(player.pitch-e.movementY*.0022*sensitivity*(aim?.62:1),-1.35,1.35);}});
canvas.addEventListener('wheel',e=>{if(phase==='active'||phase==='break'){e.preventDefault();setWeapon(current==='ak'?'rpg':'ak');}},{passive:false});
// Touch input is an alternative for tablets; keyboard and pointer lock remain the primary controls.
let joyX=0,joyY=0,joyId=null,lookId=null,lastTouch=null;
$('joystick').addEventListener('pointerdown',e=>{joyId=e.pointerId;$('joystick').setPointerCapture(joyId);moveJoy(e);});
function moveJoy(e){if(e.pointerId!==joyId)return;const r=$('joystick').getBoundingClientRect();let x=(e.clientX-r.left-r.width/2)/40,y=(e.clientY-r.top-r.height/2)/40;const d=Math.max(1,Math.hypot(x,y));joyX=x/d;joyY=y/d;$('joystick').firstElementChild.style.transform=`translate(${joyX*30}px,${joyY*30}px)`;}
$('joystick').addEventListener('pointermove',moveJoy);for(const type of ['pointerup','pointercancel'])$('joystick').addEventListener(type,()=>{joyId=null;joyX=joyY=0;$('joystick').firstElementChild.style.transform='';});
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&(phase==='active'||phase==='break')){lookId=e.pointerId;lastTouch={x:e.clientX,y:e.clientY};canvas.setPointerCapture(lookId);}});
canvas.addEventListener('pointermove',e=>{if(e.pointerId===lookId&&lastTouch){player.yaw-=(e.clientX-lastTouch.x)*.005*sensitivity;player.pitch=THREE.MathUtils.clamp(player.pitch-(e.clientY-lastTouch.y)*.005*sensitivity,-1.35,1.35);lastTouch={x:e.clientX,y:e.clientY};}});
for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,()=>{lookId=null;lastTouch=null;});
$('touchFire').addEventListener('pointerdown',e=>{shooting=true;e.target.setPointerCapture(e.pointerId);});for(const type of ['pointerup','pointercancel'])$('touchFire').addEventListener(type,()=>shooting=false);$('djAbility').onclick=requestDj;$('touchGrenade').onclick=throwGrenade;$('touchReload').onclick=reload;$('touchSwitch').onclick=()=>setWeapon(current==='ak'?'rpg':'ak');

function blocked(x,z,r=.4){if(Math.abs(x)>37.5-r||Math.abs(z)>37.5-r)return true;return world.colliders.some(b=>Math.abs(x-b.x)<b.hx+r&&Math.abs(z-b.z)<b.hz+r);}
function moveActor(pos,dx,dz,r){let moved=false;if(!blocked(pos.x+dx,pos.z,r)){pos.x+=dx;moved=true;}if(!blocked(pos.x,pos.z+dz,r)){pos.z+=dz;moved=true;}return moved;}
function obstacleDistance(origin,dir,max=200){let nearest=max;for(const b of world.colliders){const box=new THREE.Box3(new THREE.Vector3(b.x-b.hx,0,b.z-b.hz),new THREE.Vector3(b.x+b.hx,b.height||3.2,b.z+b.hz));const hit=raycaster.ray.intersectBox(box,new THREE.Vector3());if(hit)nearest=Math.min(nearest,hit.distanceTo(origin));}return nearest;}
function chooseSpawnPoint(){
  const targets=[player,...squad.values()],safe=[];
  for(const spawn of world.spawnPoints)for(let attempt=0;attempt<4;attempt++){
    const point={x:spawn.x+(attempt?(Math.random()-.5)*3:0),z:spawn.z+(attempt?(Math.random()-.5)*3:0)};
    if(!blocked(point.x,point.z,.75)&&targets.every(q=>Math.hypot(point.x-q.pos.x,point.z-q.pos.z)>=18))safe.push(point);
  }
  return safe.length?safe[Math.floor(Math.random()*safe.length)]:null;
}
function announceProgram() {
  const program = programs[radio.state.program];
  banner('КРЯК FM  /  ВОЛНА '+wave, program.title, program.hint, 4.2);
}
function updateRadioHud() {
  const s = radio.state;
  $('djAbility').disabled = s.cooldown>0 || phase!=='active' || player.health<=0 || coopPaused;
  $('djStatus').textContent = s.playing>0 ? 'В эфире · '+Math.ceil(s.playing)+' с' : s.cooldown>0 ? 'Через '+Math.ceil(s.cooldown)+' с' : 'Включить';
  if(phase==='active' && wave>0)$('waveState').textContent = radio.still() ? 'СТОП-МУЗЫКА' : programs[s.program].title.toUpperCase();
}
function requestDj() {
  if(phase!=='active'||coopPaused||player.health<=0||radio.state.cooldown>0)return;
  if(net.role==='client')net.send({t:'dj'});else startDj(player);
}
function startDj(who) {
  if(phase!=='active'||who.health<=0||radio.state.cooldown>0)return;
  let x=who.pos.x,z=who.pos.z;
  for(let step=.5;step<=3.5;step+=.5){
    const nx=who.pos.x-Math.sin(who.yaw)*step,nz=who.pos.z-Math.cos(who.yaw)*step;
    if(blocked(nx,nz,.65))break;
    x=nx;z=nz;
  }
  radio.deploy(x,z);updateRadioHud();
}
function spawnEnemy(){const point=chooseSpawnPoint();if(!point)return false;const roll=Math.random(),type=roll<config.bruteChance?'brute':roll<config.bruteChance+config.runnerChance?'runner':'walker',stats=enemyStats(config,type),mesh=createZombie(type),e={id:++enemyId,mesh,type,hp:stats.health,maxHp:stats.health,speed:stats.speed,damage:stats.damage,attack:Math.random()*.7,step:Math.random()*10,radius:type==='brute'?.65:.4,stuck:0,turn:Math.random()<.5?-1:1};e.prize=radio.state.program==='pinata' && spawned%5===0;
  dressZombie(mesh,radio.state.program,e.prize);
  mesh.position.set(point.x,0,point.z);mesh.traverse(o=>{if(o.isMesh)o.userData.enemy=e;});enemies.push(e);scene.add(mesh);spawned++;return true;}
function killEnemy(e,headshot=false){const i=enemies.indexOf(e);if(i<0)return;enemies.splice(i,1);kills++;waveKills++;score+=(e.type==='brute'?180:e.type==='runner'?120:100)+(headshot?40:0);dead.push({mesh:e.mesh,life:1.4,max:1.4});if(e.prize){radio.partyPop(e.mesh.position);dropPickup(e.mesh.position,'ammo');if(net.role==='host')net.broadcast({t:'pop',p:e.mesh.position.toArray()});}else if(Math.random()<.23||kills%7===0)dropPickup(e.mesh.position,player.health<45&&Math.random()<.65?'health':Math.random()<.4?'health':'ammo');if(headshot)toast('В ГОЛОВУ +40',.8);updateHUD();if(waveKills>=config.count&&phase==='active')completeWave();}
function hurtEnemy(e,amount,headshot=false){e.hp-=headshot&&radio.state.program==='heads'?amount*1.5:amount;if(e.hp<=0)killEnemy(e,headshot);}
function hurtPlayer(amount){if(net.role==='client'||player.health<=0)return;player.health=Math.max(0,player.health-amount);damageTime=.35;shake=.14;sound('hurt');updateHUD();if(player.health<=0)die();}
const particleGeo=new THREE.BoxGeometry(.1,.1,.1),particleMat=new THREE.MeshBasicMaterial({color:0xffb24e}),impactMat=new THREE.MeshBasicMaterial({color:0xa8b790});
function particles(pos,count=7,explosive=false){for(let i=0;i<count;i++){const mesh=new THREE.Mesh(particleGeo,explosive?particleMat:impactMat);mesh.position.copy(pos);mesh.scale.setScalar(explosive?1+Math.random()*3:.5+Math.random());scene.add(mesh);effects.push({mesh,life:explosive?.65:.23,max:explosive?.65:.23,vel:new THREE.Vector3((Math.random()-.5)*11,Math.random()*10-1,(Math.random()-.5)*11),type:'particle'});}}
function tracer(start,end){const geo=new THREE.BufferGeometry().setFromPoints([start,end]),mat=new THREE.LineBasicMaterial({color:0xffd48a,transparent:true,opacity:.7});const mesh=new THREE.Line(geo,mat);scene.add(mesh);effects.push({mesh,life:.055,max:.055,dispose:true,type:'line'});}
function isHeadHit(hit, enemy) {
  for(let node=hit.object;node&&node!==enemy.mesh;node=node.parent){
    if(node===enemy.mesh.userData.head)return true;
  }
  return enemy.mesh.worldToLocal(hit.point.clone()).y>1.48;
}
function fire(){if(coopPaused||player.health<=0)return;const w=weapons[current];if(shootCooldown>0||reloadTime>0)return;if(w.mag<=0){reload();shootCooldown=.25;return;}w.mag--;shootCooldown=w.rate;shotKick=current==='rpg'?.24:current==='minigun'?.035:.07;camera.updateMatrixWorld();const origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
  if(current!=='rpg'){
    const spread=aim?.002:.007;direction.x+=(Math.random()-.5)*spread;direction.y+=(Math.random()-.5)*spread;direction.normalize();raycaster.set(origin,direction);const wall=obstacleDistance(origin,direction);const hits=raycaster.intersectObjects(enemies.map(e=>e.mesh),true);let end=origin.clone().addScaledVector(direction,Math.min(wall,85));
    if(hits.length&&hits[0].distance<wall){const hit=hits[0],e=hit.object.userData.enemy;end=hit.point;const headshot=isHeadHit(hit,e);if(net.role!=='client')hurtEnemy(e,current==='minigun'?(headshot?140:60):(headshot?72:29),headshot);hitTime=.13;particles(end,5);sound('hit');}else if(wall<85)particles(end,4);
    const muzzle=w.mesh.localToWorld(w.mesh.userData.muzzle.clone());tracer(muzzle,end);flash.position.copy(camera.worldToLocal(muzzle.clone()));flash.scale.set(.7+Math.random(),.7+Math.random(),2);flash.rotation.z=Math.random()*6;flash.visible=true;weaponLight.intensity=8;sound(current==='minigun'?'minigun':'shot');player.pitch=Math.min(1.35,player.pitch+(aim?.002:.004));
  }else {const mesh=createRocket();mesh.position.copy(origin).addScaledVector(direction,.9);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);scene.add(mesh);rockets.push({mesh,dir:direction,life:4,visualOnly:net.role==='client'});sound('rocket');shake=.15;}
  const shot={t:'shot',weapon:current,o:origin.toArray(),d:direction.toArray()};if(net.role==='client')net.send(shot);else if(net.role==='host')net.broadcast({...shot,who:net.id});updateHUD();}
function throwGrenade(){
  if(!['active','break'].includes(phase)||coopPaused||player.health<=0||time-player.lastGrenade<.8)return;
  if(player.grenades<=0){toast('ГРАНАТ НЕТ · ПОПОЛНЕНИЕ МЕЖДУ ВОЛНАМИ');return;}
  camera.updateMatrixWorld();const origin=player.pos.clone(),direction=camera.getWorldDirection(new THREE.Vector3());
  if(net.role==='client'&&!net.send({t:'grenade',request:++grenadeRequest,o:origin.toArray(),d:direction.toArray()}))return;
  player.lastGrenade=time;player.grenades--;if(net.role!=='client')grenades.spawn({id:++enemyId,origin,direction});
  sound('switch');shotKick=.12;toast('ГРАНАТА!',.9);updateHUD();
}
function remoteGrenade(m,q){
  if(!['active','break'].includes(phase)||q.health<=0||q.grenades<=0||time-q.lastGrenade<.8||!Number.isSafeInteger(m.request)||m.request<=q.grenadeRequest||!validVector(m.o)||!validVector(m.d))return;
  const origin=new THREE.Vector3(...m.o),direction=new THREE.Vector3(...m.d);
  if(origin.distanceTo(q.pos)>3||direction.length()<.8||direction.length()>1.2)return;
  q.grenadeRequest=m.request;q.lastGrenade=time;q.grenades--;grenades.spawn({id:++enemyId,origin:q.pos.clone(),direction:direction.normalize()});
}
function explode(pos,visualOnly=false){if(net.role==='host'&&!visualOnly)net.broadcast({t:'blast',p:pos.toArray()});sound('blast');particles(pos,30,true);shake=.4;const mat=new THREE.MeshBasicMaterial({color:0xffa543,transparent:true,opacity:.62,depthWrite:false}),mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),mat);mesh.position.copy(pos);scene.add(mesh);effects.push({mesh,life:.42,max:.42,type:'explosion',dispose:true});if(!visualOnly&&net.role!=='client')for(const e of [...enemies]){const center=e.mesh.position.clone();center.y=1;const d=pos.distanceTo(center);if(d<8.5){hurtEnemy(e,blastDamage(d));hitTime=.2;}}const pd=pos.distanceTo(player.pos);if(!visualOnly&&pd<3.8)hurtPlayer(14*(1-pd/3.8));if(!visualOnly&&net.role==='host'){for(const q of squad.values()){const d=pos.distanceTo(q.pos);if(d<3.8)q.health=Math.max(0,q.health-14*(1-d/3.8));}if(player.health<=0&&!aliveTargets().length)die();}}
const pickupMats={health:new THREE.MeshStandardMaterial({color:0x97ba8b,emissive:0x395735,emissiveIntensity:.6}),ammo:new THREE.MeshStandardMaterial({color:0xc79a48,emissive:0x69471b,emissiveIntensity:.7})},pickupGeo=new THREE.BoxGeometry(.48,.38,.38);
function dropPickup(pos,type,id=++enemyId){const mesh=new THREE.Group(),box=new THREE.Mesh(pickupGeo,pickupMats[type]);mesh.add(box);const barMat=new THREE.MeshBasicMaterial({color:type==='health'?0xe8f3d7:0xffdc93});for(let i=0;i<2;i++){const bar=new THREE.Mesh(new THREE.BoxGeometry(i?.06:.22,i?.22:.06,.015),barMat);bar.position.z=.198;mesh.add(bar);}mesh.position.copy(pos);mesh.position.y=.6;scene.add(mesh);pickups.push({id,mesh,type,life:35});}
function updatePlayer(dt){let x=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joyX,z=(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0)+joyY;if(coopPaused||player.health<=0){x=0;z=0;}const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}const sprint=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&len>.1&&player.stamina>2&&!aim;const speed=sprint?8:aim?3:4.8;if(sprint)player.stamina=Math.max(0,player.stamina-dt*23);else player.stamina=Math.min(100,player.stamina+dt*16);$('staminaBar').style.width=player.stamina+'%';const sin=Math.sin(player.yaw),cos=Math.cos(player.yaw);moveActor(player.pos,(x*cos+z*sin)*speed*dt,(-x*sin+z*cos)*speed*dt,.38);
  if(keys.has('ArrowLeft'))player.yaw+=1.8*dt;if(keys.has('ArrowRight'))player.yaw-=1.8*dt;if(keys.has('ArrowUp'))player.pitch=Math.min(1.35,player.pitch+dt);if(keys.has('ArrowDown'))player.pitch=Math.max(-1.35,player.pitch-dt);
  player.vy-=16*dt;player.pos.y+=player.vy*dt;if(player.pos.y<=1.72){player.pos.y=1.72;player.vy=0;player.grounded=true;}
  camera.position.copy(player.pos);if(len>.1&&player.grounded)camera.position.y+=Math.sin(time*(sprint?16:11))*.035;camera.rotation.set(player.pitch+shotKick*.13+(Math.random()-.5)*shake*.05,player.yaw+(Math.random()-.5)*shake*.05,0);camera.fov=THREE.MathUtils.lerp(camera.fov,aim?56:sprint?84:78,dt*10);camera.updateProjectionMatrix();$('heading').textContent=String(Math.round(((player.yaw*180/Math.PI)%360+360)%360)).padStart(3,'0');
  for(const [name,w]of Object.entries(weapons)){w.mesh.visible=name===current;const bob=len>.1?Math.sin(time*9)*.012:Math.sin(time*1.9)*.003;w.mesh.position.set(aim?.11:.31,-.32+bob,-.52+shotKick);w.mesh.rotation.set(shotKick*.7,0,0);if(w.mesh.userData.barrels)w.mesh.userData.barrels.rotation.z+=dt*(shooting?50:3);if(reloadTime>0&&name===reloadingWeapon){const progress=1-reloadTime/w.reload;w.mesh.rotation.x-=Math.sin(progress*Math.PI)*.6;w.mesh.position.y-=Math.sin(progress*Math.PI)*.25;w.mesh.rotation.z-=Math.sin(progress*Math.PI)*.3;}}
}
function updateEnemies(dt){for(let i=enemies.length-1;i>=0;i--){const e=enemies[i],p=e.mesh.position,target=nearestTarget(p),dx=target.pos.x-p.x,dz=target.pos.z-p.z,dist=Math.hypot(dx,dz);
    if(radio.dancing(p)){e.mesh.rotation.y=Math.atan2(radio.state.x-p.x,radio.state.z-p.z);dancePose(e.mesh,radio.state.elapsed,e.id);continue;}
    e.mesh.rotation.z=0;if(radio.still())continue;
    e.attack-=dt;e.step+=dt*e.speed*2.6;e.mesh.rotation.y=Math.atan2(dx,dz);const u=e.mesh.userData;u.leftLeg.rotation.x=Math.sin(e.step)*.43;u.rightLeg.rotation.x=-Math.sin(e.step)*.43;u.leftArm.rotation.x=-.7+Math.sin(e.step)*.17;u.rightArm.rotation.x=-.8-Math.sin(e.step)*.17;
    if(dist>1.25+e.radius*.4){e.navTimer=(e.navTimer||0)-dt;if(e.navTimer<=0){e.navDir=(target.nav||navigator).direction(p.x,p.z,target.pos.x,target.pos.z,e.radius);e.navTimer=.3;}let mx=e.navDir.x,mz=e.navDir.z;for(let j=0;j<enemies.length;j++){if(i===j)continue;const other=enemies[j],sx=p.x-other.mesh.position.x,sz=p.z-other.mesh.position.z,d2=sx*sx+sz*sz;if(d2<1.3&&d2>.001){mx+=sx/d2*.6;mz+=sz/d2*.6;}}
      const n=Math.max(1,Math.hypot(mx,mz));mx/=n;mz/=n;const step=e.speed*dt,old=p.clone();moveActor(p,mx*step,mz*step,e.radius);if(p.distanceToSquared(old)<step*step*.1){e.stuck+=dt;const tangentX=-mz*e.turn,tangentZ=mx*e.turn;moveActor(p,tangentX*step,tangentZ*step,e.radius);if(e.stuck>2){e.turn*=-1;e.stuck=0;e.navTimer=0;}}else e.stuck=0;
    }else if(e.attack<=0&&target.pos.y<2.5){e.attack=.85+Math.random()*.3;if(target===player)hurtPlayer(e.damage);else target.health=Math.max(0,target.health-e.damage);if(player.health<=0&&!aliveTargets().length)die();if(phase==='gameover')break;}
  }}
function updateProjectiles(dt){for(let i=rockets.length-1;i>=0;i--){const r=rockets[i],start=r.mesh.position.clone(),step=28*dt;r.life-=dt;let hit=false;const segments=Math.ceil(step/.25);for(let s=0;s<segments;s++){r.mesh.position.addScaledVector(r.dir,step/segments);const p=r.mesh.position;if(p.y<.1||Math.abs(p.x)>37.5||Math.abs(p.z)>37.5||world.colliders.some(b=>p.y<=(b.height||3.2)+.12&&Math.abs(p.x-b.x)<b.hx+.12&&Math.abs(p.z-b.z)<b.hz+.12)||enemies.some(e=>p.distanceTo(e.mesh.position.clone().add(new THREE.Vector3(0,1,0)))<(e.type==='brute'?1.4:.9))){hit=true;break;}}
    if(hit||r.life<=0){explode(r.mesh.position.clone(),r.visualOnly);scene.remove(r.mesh);rockets.splice(i,1);}else if(Math.random()<.7){particles(start,1,true);}}
}
function updateEffects(dt){for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){scene.remove(e.mesh);if(e.dispose){e.mesh.geometry.dispose();e.mesh.material.dispose();}effects.splice(i,1);continue;}if(e.type==='particle'){e.vel.y-=13*dt;e.mesh.position.addScaledVector(e.vel,dt);e.mesh.scale.multiplyScalar(Math.max(.5,1-dt*2));}else if(e.type==='explosion'){const p=1-e.life/e.max;e.mesh.scale.setScalar(.5+p*7);e.mesh.material.opacity=(1-p)*.62;}else if(e.type==='line')e.mesh.material.opacity=e.life/e.max;}
  for(let i=dead.length-1;i>=0;i--){const d=dead[i];d.life-=dt;d.mesh.rotation.x=THREE.MathUtils.lerp(d.mesh.rotation.x,-Math.PI/2,dt*8);if(d.life<.5)d.mesh.scale.multiplyScalar(Math.max(.4,1-dt*5));if(d.life<=0){scene.remove(d.mesh);dead.splice(i,1);}}
  for(let i=pickups.length-1;i>=0;i--){const p=pickups[i];p.life-=dt;p.mesh.rotation.y+=dt;p.mesh.position.y=.6+Math.sin(time*3+i)*.12;const dist=Math.hypot(p.mesh.position.x-player.pos.x,p.mesh.position.z-player.pos.z);if(dist<1.65&&player.health>0){if(net.role==='client'){net.send({t:'pickup',id:p.id});takenPickups.add(p.id);scene.remove(p.mesh);pickups.splice(i,1);continue;}if(p.type==='health'){player.health=Math.min(100,player.health+25);toast('АПТЕЧКА · +25 ЗДОРОВЬЯ',1.8);}else{weapons.ak.reserve=Math.min(420,weapons.ak.reserve+45);weapons.rpg.reserve=Math.min(18,weapons.rpg.reserve+1);toast('БОЕПРИПАСЫ · +45 ПАТРОНОВ · +1 РАКЕТА',1.8);}sound('pickup');p.life=0;updateHUD();}if(p.life<=0){scene.remove(p.mesh);p.mesh.traverse(o=>{if(o.isMesh&&o.geometry!==pickupGeo){o.geometry.dispose();o.material.dispose();}});pickups.splice(i,1);}}
}
let previousProgramWave=0;
let coopPaused=false,gameSession=0,netTick=0,enemyId=0,drop=null,dropWave=0,minigunUntil=0,lastSnapshot=0,lastRemoteWave=0;
const squad=new Map(),takenPickups=new Set();
const net=createNetwork({onData:receivePacket,onPeerJoin(id,name){const mate=ensureMate(id,name);renderLobby();if(net.role==='host'&&(phase==='active'||phase==='break')){net.send({t:'start',session:gameSession,spawn:mate.pos.toArray()},id);}},onPeerLeave(id){const q=squad.get(id);if(q){scene.remove(q.mesh);squad.delete(id);}renderLobby();},onStatus(message){$('coopStatus').textContent=message;},onDisconnect(message){returnMenu();$('coopModal').hidden=false;$('coopStatus').textContent=message;renderLobby();}});
function aliveTargets(){return [player,...squad.values()].filter(p=>p.health>0);}
function nearestTarget(pos){let best=player,d=Infinity;for(const q of aliveTargets()){const n=Math.hypot(q.pos.x-pos.x,q.pos.z-pos.z);if(n<d){d=n;best=q;}}return best;}
function ensureMate(id,name='Напарник'){
  if(squad.has(id))return squad.get(id);const mesh=createZombie('walker');
  mesh.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.color.set(0x67b9d3);}});
  const c=document.createElement('canvas');c.width=256;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#163e50';ctx.fillRect(0,0,256,64);ctx.fillStyle='#dff8ff';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.fillText(String(name).slice(0,18),128,41);const tex=new THREE.CanvasTexture(c),label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false}));label.scale.set(1.5,.38,1);label.position.y=2.4;mesh.add(label);scene.add(mesh);
  const starts=[12,14,10].flatMap(z=>[2,-2,4,-4,6,-6,0].map(x=>({x,z})));const spawn=starts.find(p=>!blocked(p.x,p.z,.4)&&[player,...squad.values()].every(q=>Math.hypot(p.x-q.pos.x,p.z-q.pos.z)>=1.8))||{x:0,z:12};
  const q={id,name,mesh,pos:new THREE.Vector3(spawn.x,1.72,spawn.z),health:100,yaw:0,weapon:'ak',mini:0,lastShot:-99,grenades:3,lastGrenade:-99,grenadeRequest:0,revive:0,nav:createNavigator(world.colliders)};q.mesh.position.set(q.pos.x,0,q.pos.z);mesh.visible=phase!=='menu';squad.set(id,q);return q;
}
function renderLobby(){
  $('coopSetup').hidden=net.role!=='solo';$('coopLobby').hidden=net.role==='solo';$('coopLeave').hidden=net.role==='solo';$('coopClose').hidden=net.role!=='solo';$('coopBegin').hidden=net.role!=='host';$('coopWait').hidden=net.role!=='client';$('coopRoomCode').textContent=net.room?.replace('outpost-','')||'';$('coopInvite').value=net.getInviteURL();
  const list=$('coopRoster');list.replaceChildren();const roster=net.role==='solo'?[]:[{id:net.id,name:net.name},...net.peers.values()];for(const q of roster){const li=document.createElement('li');li.textContent=q.name+(q.id===net.room?' · ВЕДУЩИЙ':q.id===net.id?' · ТЫ':' · В СЕТИ');list.appendChild(li);}updateSquadHUD();
}
function updateSquadHUD(){if(!$('squadPanel'))return;$('squadPanel').hidden=net.role==='solo';$('squadCount').textContent=(1+net.peers.size)+' / 4';$('squadList').textContent=[`${net.name}: ${Math.ceil(player.health)} HP`,...[...squad.values()].map(q=>`${q.name}: ${q.health>0?Math.ceil(q.health)+' HP':'РАНЕН · F рядом'}`)].join('\n');}
async function connectRoom(join){initAudio();$('coopCreate').disabled=$('coopJoin').disabled=true;try{if(join)await net.join($('coopCode').value,$('coopName').value);else await net.host($('coopName').value);renderLobby();}catch(e){$('coopStatus').textContent=e.message;}finally{$('coopCreate').disabled=$('coopJoin').disabled=false;}}
$('coopOpen').onclick=()=>{$('coopModal').hidden=false;renderLobby();};$('coopCreate').onclick=()=>connectRoom(false);$('coopJoin').onclick=()=>connectRoom(true);$('coopBegin').onclick=()=>{if(net.role==='host')startGame();};$('coopClose').onclick=()=>{$('coopModal').hidden=true;};$('coopLeave').onclick=()=>{returnMenu();renderLobby();};
$('coopCopy').onclick=async()=>{try{await window.navigator.clipboard.writeText(net.getInviteURL());$('coopStatus').textContent='Приглашение скопировано. Отправь его друзьям.';}catch{$('coopInvite').select();$('coopStatus').textContent='Скопируй выделенную ссылку: Ctrl+C.';}};
const invitation=new URLSearchParams(window.location.search).get('room');if(invitation){$('coopCode').value=invitation;$('coopModal').hidden=false;}
function beginDrop(forWave){drop?.dispose();drop=createAirdrop(scene);dropWave=forWave;sound('airdrop');toast(`АИРДРОП В ЦЕНТРЕ · МИНИГАН НА ВОЛНУ ${forWave}`,8);}
function grantMinigun(){if(minigunUntil===dropWave)return;minigunUntil=dropWave;weapons.minigun.mag=1200;setWeapon('minigun');sound('pickup');toast(`МИНИГАН · ДО КОНЦА ВОЛНЫ ${minigunUntil}`,5);}
function expireMinigun(){if(minigunUntil&&wave>=minigunUntil){minigunUntil=0;weapons.minigun.mag=0;if(current==='minigun')setWeapon('ak');}for(const q of squad.values())if(q.mini&&wave>=q.mini)q.mini=0;if(dropWave&&wave>=dropWave){drop?.dispose();drop=null;dropWave=0;}}
function updateDrop(dt){if(!drop)return;const landed=drop.update(dt);if(landed&&player.health>0&&Math.hypot(player.pos.x,player.pos.z-3)<2.5&&minigunUntil!==dropWave){if(net.role==='client')net.send({t:'crate'});else grantMinigun();}if(net.role==='host'&&landed)for(const q of squad.values()){if(q.health>0&&q.mini!==dropWave&&Math.hypot(q.pos.x,q.pos.z-3)<2.5){q.mini=dropWave;net.send({t:'mini',wave:dropWave},q.id);}}}
function validVector(a){return Array.isArray(a)&&a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<300);}
function receivePacket(m,from){
  if(!m||typeof m!=='object')return;
  if(net.role==='host'){
    const q=squad.get(from)||ensureMate(from,net.peers.get(from)?.name);
    if(m.t==='pose'&&validVector(m.p)&&Number.isFinite(m.yaw)){const p=new THREE.Vector3(...m.p);if(Math.abs(p.x)<38&&Math.abs(p.z)<38&&p.y>=1&&p.y<6&&!blocked(p.x,p.z,.3)){q.pos.copy(p);q.yaw=m.yaw;q.weapon=['ak','rpg','minigun'].includes(m.weapon)?m.weapon:'ak';}q.help=!!m.help;}
    if(m.t==='dj')startDj(q);if(m.t==='shot')remoteShot(m,q);if(m.t==='grenade')remoteGrenade(m,q);
    if(m.t==='pickup'){const p=pickups.find(p=>p.id===m.id);if(p&&q.health>0&&q.pos.distanceTo(p.mesh.position)<3){if(p.type==='health')q.health=Math.min(100,q.health+25);else net.send({t:'supply',ak:45,rpg:1},from);scene.remove(p.mesh);pickups.splice(pickups.indexOf(p),1);}}
    return;
  }
  if(net.role!=='client'||from!==net.room)return;
  if(m.t==='start'){startGame();if(validVector(m.spawn)&&!blocked(m.spawn[0],m.spawn[2],.4))player.pos.fromArray(m.spawn);updatePlayer(0);lastRemoteWave=0;lastSnapshot=0;}
  if(m.t==='over'){phase='gameover';shooting=false;document.exitPointerLock?.();$('finalWave').textContent=wave;$('finalKills').textContent=kills;$('finalScore').textContent=score;$('gameover').hidden=false;}
  if(m.t==='mini'&&Number.isInteger(m.wave)&&m.wave>=wave&&m.wave<=wave+1){dropWave=m.wave;grantMinigun();}
  if(m.t==='supply'){weapons.ak.reserve=Math.min(420,weapons.ak.reserve+(Number(m.ak)||0));weapons.rpg.reserve=Math.min(18,weapons.rpg.reserve+(Number(m.rpg)||0));toast('ПРИПАСЫ ПОЛУЧЕНЫ');}
  if(m.t==='snapshot')applySnapshot(m);
  if(m.t==='pop'&&validVector(m.p))radio.partyPop(new THREE.Vector3(...m.p));
  if(m.t==='shot'&&m.who!==net.id&&validVector(m.o)&&validVector(m.d)){const o=new THREE.Vector3(...m.o),d=new THREE.Vector3(...m.d);tracer(o,o.clone().addScaledVector(d,30));sound(m.weapon==='rpg'?'rocket':m.weapon==='minigun'?'minigun':'shot',{distance:o.distanceTo(player.pos)});}
  if(m.t==='blast'&&validVector(m.p))explode(new THREE.Vector3(...m.p),true);
}
function remoteShot(m,q){
  if(!['active','break'].includes(phase)||q.health<=0||!validVector(m.o)||!validVector(m.d)||!['ak','rpg','minigun'].includes(m.weapon))return;
  if(m.weapon==='minigun'&&(!q.mini||q.mini<wave))return;const rate=m.weapon==='rpg'?.85:m.weapon==='minigun'?.035:.085;if(time-q.lastShot<rate)return;const origin=new THREE.Vector3(...m.o),direction=new THREE.Vector3(...m.d);if(origin.distanceTo(q.pos)>3||direction.length()<.8||direction.length()>1.2)return;q.lastShot=time;direction.normalize();scene.updateMatrixWorld(true);
  if(m.weapon==='rpg'){const mesh=createRocket();mesh.position.copy(origin).addScaledVector(direction,.9);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);scene.add(mesh);rockets.push({mesh,dir:direction,life:4});}
  else {raycaster.set(origin,direction);const wall=obstacleDistance(origin,direction),hits=raycaster.intersectObjects(enemies.map(e=>e.mesh),true);let end=origin.clone().addScaledVector(direction,Math.min(wall,85));if(hits.length&&hits[0].distance<wall){const hit=hits[0],e=hit.object.userData.enemy,head=isHeadHit(hit,e);end=hit.point;hurtEnemy(e,m.weapon==='minigun'?(head?140:60):(head?72:29),head);particles(end,4);}tracer(origin,end);}
  sound(m.weapon==='rpg'?'rocket':m.weapon==='minigun'?'minigun':'shot',{distance:origin.distanceTo(player.pos)});net.broadcast({...m,who:q.id});
}
function snapshot(){return {t:'snapshot',seq:time,radio:{...radio.state},wave,phase,kills,score,waveKills,count:config.count,breakTime,players:[{id:net.id,name:net.name,p:player.pos.toArray(),yaw:player.yaw,health:player.health,weapon:current,grenades:player.grenades},...[...squad.values()].map(q=>({id:q.id,name:q.name,p:q.pos.toArray(),yaw:q.yaw,health:q.health,weapon:q.weapon,mini:q.mini,grenades:q.grenades}))],enemies:enemies.map(e=>({id:e.id,type:e.type,prize:e.prize,p:e.mesh.position.toArray(),r:e.mesh.rotation.y,hp:e.hp})),pickups:pickups.map(p=>({id:p.id,type:p.type,p:p.mesh.position.toArray()})),grenades:grenades.items.map(g=>({id:g.id,p:g.mesh.position.toArray(),v:g.velocity.toArray(),life:g.life})),drop:drop?{wave:dropWave,age:drop.mesh.userData.age}:null};}
function applySnapshot(m){
  if(!Number.isFinite(m.seq)||m.seq<=lastSnapshot||!Array.isArray(m.enemies)||m.enemies.length>100||!Array.isArray(m.players)||m.players.length>4)return;lastSnapshot=m.seq;
  if(!['active','break'].includes(phase))return;
  radio.sync(m.radio);
  const oldPhase=phase;phase=m.phase==='break'?'break':'active';wave=m.wave;config=waveConfig(wave,m.players.length);config.count=m.count;waveKills=m.waveKills;kills=m.kills;score=m.score;breakTime=m.breakTime;
  if(minigunUntil&&wave>minigunUntil)expireMinigun();
  if(wave!==lastRemoteWave){if(lastRemoteWave){weapons.ak.reserve=Math.min(420,weapons.ak.reserve+110+wave*15);weapons.rpg.reserve=Math.min(18,weapons.rpg.reserve+3);}lastRemoteWave=wave;saveBest();}
  if(phase==='active' && (wave!==previousProgramWave||oldPhase==='break')){previousProgramWave=wave;announceProgram();}
  if(phase==='break'&&oldPhase!=='break'){expireMinigun();banner('ВОЛНА ОТБИТА','ПЕРЕДЫШКА','Ведущий начинает следующую волну',8);}
  for(const p of m.players){if(!validVector(p.p))continue;if(p.id===net.id){const old=player.health;player.health=p.health;if(Number.isInteger(p.grenades))player.grenades=THREE.MathUtils.clamp(p.grenades,0,5);if(old>0&&p.health<=0){shooting=false;banner('НУЖНА ПОМОЩЬ','ТЫ РАНЕН','Напарник может поднять тебя: удерживать F рядом.',999);}else if(old<=0&&p.health>0){banner('НАПАРНИК РЯДОМ','СНОВА В СТРОЮ','',3);}else if(p.health<old){damageTime=.3;sound('hurt');}if(p.mini&&!minigunUntil){dropWave=p.mini;grantMinigun();}}else{const q=ensureMate(p.id,p.name);q.pos.fromArray(p.p);q.yaw=p.yaw;q.health=p.health;q.weapon=p.weapon;}}
  const ids=new Set();for(const e of m.enemies){if(!validVector(e.p))continue;ids.add(e.id);let local=enemies.find(q=>q.id===e.id);if(!local){const mesh=createZombie(e.type);dressZombie(mesh,radio.state.program,e.prize);local={id:e.id,type:e.type,mesh,hp:e.hp,target:new THREE.Vector3(...e.p),step:0};mesh.traverse(o=>{if(o.isMesh)o.userData.enemy=local;});mesh.position.fromArray(e.p);scene.add(mesh);enemies.push(local);}local.target=new THREE.Vector3(...e.p);local.hp=e.hp;local.mesh.rotation.y=e.r;}
  for(let i=enemies.length-1;i>=0;i--)if(!ids.has(enemies[i].id)){dead.push({mesh:enemies[i].mesh,life:1.1,max:1.1});enemies.splice(i,1);}
  const pids=new Set();for(const p of m.pickups||[]){pids.add(p.id);if(!pickups.some(x=>x.id===p.id)&&!takenPickups.has(p.id)&&validVector(p.p))dropPickup(new THREE.Vector3(...p.p),p.type,p.id);}for(let i=pickups.length-1;i>=0;i--)if(!pids.has(pickups[i].id)){scene.remove(pickups[i].mesh);pickups.splice(i,1);}for(const id of takenPickups)if(!pids.has(id))takenPickups.delete(id);
  if(Array.isArray(m.grenades)&&m.grenades.length<=32)grenades.sync(m.grenades);
  if(m.drop){if(!drop||dropWave!==m.drop.wave){beginDrop(m.drop.wave);drop.update(m.drop.age||0);}}else if(drop){drop.dispose();drop=null;dropWave=0;}updateHUD();
}
function updateCoop(dt){
  if(net.role==='solo')return;netTick+=dt;
  for(const q of squad.values()){q.mesh.visible=true;q.mesh.position.lerp(new THREE.Vector3(q.pos.x,0,q.pos.z),Math.min(1,dt*14));q.mesh.rotation.y=q.yaw+Math.PI;q.mesh.rotation.z=q.health<=0?Math.PI/2:0;const u=q.mesh.userData;u.leftLeg.rotation.x=Math.sin(time*9)*.22;u.rightLeg.rotation.x=-u.leftLeg.rotation.x;}
  if(net.role==='client'){for(const e of enemies){if(e.target)e.mesh.position.lerp(e.target,Math.min(1,dt*18));if(radio.dancing(e.mesh.position)){dancePose(e.mesh,radio.state.elapsed,e.id);continue;}e.mesh.rotation.z=0;if(radio.still())continue;e.step+=dt*7;const u=e.mesh.userData;u.leftLeg.rotation.x=Math.sin(e.step)*.43;u.rightLeg.rotation.x=-u.leftLeg.rotation.x;}if(netTick>.05){netTick=0;net.send({t:'pose',p:player.pos.toArray(),yaw:player.yaw,weapon:current,help:keys.has('KeyF')&&!coopPaused});}return;}
  const all=[{...player,id:net.id,help:keys.has('KeyF')&&!coopPaused},...squad.values()];for(const q of [player,...squad.values()]){if(q.health>0){q.revive=0;continue;}const helped=all.some(a=>a.health>0&&a.help&&a.pos.distanceTo(q.pos)<3);q.revive=helped?(q.revive||0)+dt:0;if(q.revive>=3){q.health=50;q.revive=0;if(q===player)banner('НАПАРНИК РЯДОМ','СНОВА В СТРОЮ','',3);}}
  if(netTick>.067){netTick=0;net.broadcast(snapshot());}
}
setInterval(()=>{if(net.role==='host'&&document.hidden&&(phase==='active'||phase==='break'))loop(performance.now(),true);},50);

for(const [x,z,type]of [[-4,-7,'walker'],[2,-15,'walker'],[9,-3,'brute'],[6,-25,'runner']]){const mesh=createZombie(type);mesh.position.set(x,0,z);mesh.rotation.y=.25;scene.add(mesh);decor.push(mesh);}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let previous=performance.now(),hudTime=0;
function loop(now,background=false){if(!background)requestAnimationFrame(loop);const dt=Math.min(.05,(now-previous)/1000);previous=now;time+=dt;animateWorld(world.props,time);
  if(phase==='menu'){radio.preview(time);camera.position.set(5+Math.sin(time*.09)*.7,2.65,14);camera.lookAt(-1,1.7,-16);for(const w of Object.values(weapons))w.mesh.visible=false;decor.forEach((d,i)=>{d.rotation.y=.3+Math.sin(time*.2+i)*.1;d.userData.leftArm.rotation.x=-.8+Math.sin(time+i)*.1;d.userData.rightArm.rotation.x=-.9;});}
  if(phase==='active'||phase==='break'){
    shootCooldown=Math.max(0,shootCooldown-dt);shotKick=Math.max(0,shotKick-dt*.7);shake=Math.max(0,shake-dt*.9);damageTime=Math.max(0,damageTime-dt);hitTime=Math.max(0,hitTime-dt);bannerTime=Math.max(0,bannerTime-dt);toastTime=Math.max(0,toastTime-dt);$('damage').style.opacity=damageTime>0?.6:player.health<25?.11:0;$('hitmarker').style.opacity=hitTime>0?1:0;$('banner').style.opacity=bannerTime>0?1:0;$('toast').style.opacity=toastTime>0?1:0;
    if(reloadTime>0){reloadTime-=dt;$('reloadBar').style.display='block';$('reloadBar').firstElementChild.style.width=`${(1-reloadTime/weapons[reloadingWeapon].reload)*100}%`;if(reloadTime<=0){const w=weapons[reloadingWeapon],n=Math.min(w.capacity-w.mag,w.reserve);w.mag+=n;w.reserve-=n;reloadingWeapon=null;sound('reload');updateHUD();}}else $('reloadBar').style.display='none';
    radio.tick(dt,phase==='active');
    flash.visible=shootCooldown>weapons[current].rate-.04&&current!=='rpg'&&flash.visible;weaponLight.intensity=flash.visible?8:0;updatePlayer(dt);if(shooting&&!coopPaused)fire();updateCoop(dt);
    navTime-=dt;if(navTime<=0){navigator.update(player.pos.x,player.pos.z);for(const q of squad.values())q.nav?.update(q.pos.x,q.pos.z);navTime=.5;}if(Object.values(weapons).every(w=>w.mag+w.reserve===0)){emptyTime+=dt;if(emptyTime>=5){weapons.ak.reserve=30;emptyTime=0;toast('АВАРИЙНЫЙ ЗАПАС · +30 ПАТРОНОВ',3);sound('pickup');}}else emptyTime=0;
    if(net.role!=='client'&&phase==='active'){spawnTimer-=dt;if(spawned<config.count&&spawnTimer<=0&&enemies.length<(config.maxAlive||75)){spawnEnemy();spawnTimer=config.spawnInterval;}updateEnemies(dt);}else if(net.role!=='client'&&phase==='break'){breakTime-=dt;$('bannerSub').textContent=`Следующая волна через ${Math.ceil(breakTime)} с · E — начать сейчас`;if(breakTime<=0)nextWave();}
    if(phase!=='gameover'){updateProjectiles(dt);grenades.update(dt,net.role!=='client');updateEffects(dt);}updateDrop(dt);hudTime+=dt;if(hudTime>.2){hudTime=0;updateHUD();}
  }
  renderer.render(scene,camera);
}
try{renderer.compile(scene,camera);$('loading').hidden=true;requestAnimationFrame(loop);}catch(e){$('loadingText').textContent='Не удалось запустить 3D. Попробуй обновить страницу в Chrome или Edge.';console.error(e);}
