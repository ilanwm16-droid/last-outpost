import * as THREE from './vendor/three.module.js';
import {buildWorld,animateWorld} from './world.js';
import {createZombie,createWeapon,createRocket,createMinigun} from './models.js';
import {waveConfig,enemyStats,blastDamage,bestWave,WAVE_EVENTS,rollWaveEvent} from './rules.js';
import {createAudio} from './audio.js';
import {createNetwork} from './network.js';
import {createAirdrop} from './airdrop.js';
import {createRadio, programs, dressZombie, dancePose} from './radio.js';
import {createGrenades} from './grenades.js';
import {createNavigator} from './navigation.js';
import {PERKS,perkMods,sanitizePerks,rollPerks} from './perks.js';
import {createFx} from './fx.js';
import {createOverlay} from './overlay.js';

const $=id=>document.getElementById(id), canvas=$('game');
const coarse=matchMedia('(pointer:coarse)').matches;
let renderer;
try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});} catch(e) {$('loadingText').textContent='Для игры нужен WebGL. Открой ссылку в Chrome или Edge с включённым аппаратным ускорением.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,coarse?1.4:1.65));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.06,230);
camera.rotation.order='YXZ';scene.add(camera);
const world=buildWorld(scene),raycaster=new THREE.Raycaster(),v=new THREE.Vector3();
// Tactical flashlight: the only shadow caster, so zombies throw long shadows in its beam.
renderer.shadowMap.enabled=!coarse;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
scene.traverse(o=>{if(o.isMesh||o.isInstancedMesh)o.receiveShadow=true;});
const flashlight=new THREE.SpotLight(0xfff0d8,14,40,.44,.55,1.6);flashlight.position.set(.18,-.12,.1);flashlight.castShadow=!coarse;flashlight.shadow.mapSize.set(1024,1024);flashlight.shadow.camera.near=.3;flashlight.shadow.camera.far=44;flashlight.shadow.bias=-.0015;camera.add(flashlight);
const flashTarget=new THREE.Object3D();flashTarget.position.set(0,-.35,-6);camera.add(flashTarget);flashlight.target=flashTarget;
let flashlightOn=true;
function toggleFlashlight(){flashlightOn=!flashlightOn;flashlight.visible=flashlightOn;sound('switch',{rate:1.6});toast(flashlightOn?'ФОНАРИК ВКЛЮЧЁН':'ФОНАРИК ВЫКЛЮЧЕН',1);}
const navigator=createNavigator(world.colliders);
let navTime=0,emptyTime=0;
const weapons={minigun:{mesh:createMinigun(),mag:0,reserve:0,capacity:1200,reload:0,rate:.042},ak:{mesh:createWeapon('ak'),mag:30,reserve:180,capacity:30,reload:1.85,rate:.105},rpg:{mesh:createWeapon('rpg'),mag:1,reserve:6,capacity:1,reload:2.65,rate:.9},shotgun:{mesh:createWeapon('shotgun'),mag:6,reserve:30,capacity:6,reload:2.1,rate:.78}};
const WEAPON_NAMES={ak:'АК-47',shotgun:'ДРОБОВИК',rpg:'РПГ-7',minigun:'МИНИГАН'},WEAPON_KEYS=['ak','shotgun','rpg','minigun'];
const SHOTGUN_PELLETS=9,AMMO_CAP={ak:420,shotgun:72,rpg:18},DAMAGE={ak:[34,85],minigun:[60,140],shotgun:[17,36]};
for(const w of Object.values(weapons)){camera.add(w.mesh);w.mesh.visible=false;w.mesh.traverse(o=>{if(o.isMesh){o.castShadow=false;o.frustumCulled=false;}});}
const weaponLight=new THREE.PointLight(0xffae59,0,5);weaponLight.position.set(.3,-.1,-1.1);camera.add(weaponLight);
const flash=new THREE.Mesh(new THREE.IcosahedronGeometry(.12,0),new THREE.MeshBasicMaterial({color:0xffd477,transparent:true,opacity:.95,depthWrite:false}));flash.visible=false;camera.add(flash);
const player={perks:{},lastHurt:-99,sprinting:false,moveSpeed:0,pos:new THREE.Vector3(0,1.72,12),yaw:0,pitch:0,health:100,stamina:100,vy:0,grounded:true,grenades:3,lastGrenade:-99};
let phase='menu',beforePause='active',wave=0,config=waveConfig(1),spawned=0,waveKills=0,kills=0,score=0,current='ak',shootCooldown=0,reloadTime=0,reloadingWeapon=null,breakTime=0,spawnTimer=0,shotKick=0,shake=0,damageTime=0,hitTime=0,bannerTime=0,toastTime=0,time=0,aim=false,shooting=false,dragLook=false,lockUnavailable=false;
let soundOn=true,sensitivity=1,best=0;
// Wave events tint fog, sky and ambient light; values ease toward a target every frame.
let waveEvent=null,combo=0,comboTime=0,bossesSpawned=0;
const hemi=scene.children.find(o=>o.isHemisphereLight),hemiBase=hemi?hemi.color.clone():new THREE.Color(),hemiTarget=hemiBase.clone();
const envBase={fog:scene.fog.color.clone(),bg:scene.background.clone(),density:scene.fog.density},envTarget={fog:envBase.fog.clone(),bg:envBase.bg.clone(),density:envBase.density};
function setWaveEvent(key){waveEvent=key&&WAVE_EVENTS[key]?key:null;const ev=waveEvent&&WAVE_EVENTS[waveEvent];envTarget.fog.set(ev?ev.fog:envBase.fog);envTarget.bg.set(ev?ev.bg:envBase.bg);envTarget.density=ev?ev.density:envBase.density;hemiTarget.set(ev?ev.light:hemiBase);}
function applyEventToConfig(){const ev=waveEvent&&WAVE_EVENTS[waveEvent];if(!ev)return;if(ev.speed)config.speed*=ev.speed;if(ev.damage)config.damage*=ev.damage;if(ev.health)config.health=Math.round(config.health*ev.health);if(ev.count)config.count=Math.ceil(config.count*ev.count);if(ev.runner){config.runnerChance=ev.runner;config.bruteChance*=.3;config.exploderChance*=.5;}}
// Zombie variants reuse the base rigs with per-instance materials so hits can flash.
const zombieTints={exploder:{emissive:0x1f5a10,glow:.35},boss:{emissive:0x3a0804,glow:.45}};
const sacGeo=new THREE.IcosahedronGeometry(.27,1),sacMat=new THREE.MeshStandardMaterial({color:0xb6ff5c,emissive:0x7dff2a,emissiveIntensity:1.6,roughness:.4});
function makeZombie(type,id=0){
  const mesh=createZombie(type,id%3),cache=new Map(),flashMats=[];
  mesh.traverse(o=>{if(!o.isMesh)return;let m=cache.get(o.material);if(!m){m=o.material.clone();cache.set(o.material,m);if(m.emissive&&m.emissive.getHex()===0)flashMats.push(m);}o.material=m;});
  // Per-instance tone jitter so a horde never looks copy-pasted.
  const tint=zombieTints[type],jitter=((id*2654435761)>>>0)/4294967296;
  for(const m of flashMats){if(tint){m.emissive.set(tint.emissive);m.emissiveIntensity=tint.glow;}m.color.setHSL(.08+(jitter-.5)*.1,.06+jitter*.1,.78+jitter*.14);m.userData.baseEmissive=m.emissive.clone();m.userData.baseGlow=m.emissiveIntensity;}
  if(type==='exploder')mesh.userData.sac=mesh.userData.torso;
  mesh.userData.type=type;mesh.userData.flashMats=flashMats;mesh.userData.ownMats=[...cache.values()];
  return mesh;
}
function disposeZombie(mesh){for(const m of mesh.userData?.ownMats||[])m.dispose();}
function updateFlash(e,dt){const mats=e.mesh.userData.flashMats;if(!mats||!(e.flash>0||e.flashOn))return;e.flash=Math.max(0,(e.flash||0)-dt);const on=e.flash>0;for(const m of mats){if(on){m.emissive.setRGB(1,.38,.28);m.emissiveIntensity=.12+e.flash*3;}else{m.emissive.copy(m.userData.baseEmissive);m.emissiveIntensity=m.userData.baseGlow;}}e.flashOn=on;}
function updateWorldFx(dt){
  const k=Math.min(1,dt*1.4);scene.fog.color.lerp(envTarget.fog,k);scene.background.lerp(envTarget.bg,k);scene.fog.density+=(envTarget.density-scene.fog.density)*k;if(hemi)hemi.color.lerp(hemiTarget,k);
  if(net.role!=='client'&&comboTime>0){comboTime-=dt;if(comboTime<=0)combo=0;}
  sacMat.emissiveIntensity=1.3+Math.sin(time*9)*.7;
  for(const e of enemies){updateFlash(e,dt);const sac=e.mesh.userData.sac;if(sac)sac.scale.setScalar(1+Math.sin(time*10+e.id)*.05);}
  fx.update(dt);overlay.update(dt);
  groanCd-=dt;if(groanCd<=0&&enemies.length&&phase==='active'){groanCd=.7+Math.random()*1.4;const e=enemies[Math.floor(Math.random()*enemies.length)],d=e.mesh.position.distanceTo(player.pos);if(d<30&&!radio.dancing(e.mesh.position))sound(e.type==='boss'?'roar':'groan',{distance:d*.6,rate:e.type==='brute'?.75:e.type==='runner'?1.2:.9+Math.random()*.2,volume:e.type==='boss'?.6:.8});}
  const lowHp=phase!=='menu'&&player.health>0&&player.health<30;if(lowHp!==lowHpFx){lowHpFx=lowHp;canvas.style.filter=lowHp?'saturate(.35) contrast(1.1)':'';}
}
function updateBossHUD(){const b=enemies.find(e=>e.type==='boss');$('bossBar').hidden=!b;if(b)$('bossFill').style.width=Math.max(0,Math.min(100,b.hp/(b.maxHp||b.hp||1)*100))+'%';$('eventTag').hidden=!waveEvent||phase!=='active';if(waveEvent)$('eventTag').textContent='СОБЫТИЕ · '+WAVE_EVENTS[waveEvent].title.toUpperCase();$('combo').hidden=combo<3;if(combo>=3)$('combo').textContent=`СЕРИЯ ×${combo}`;}
try {best=Number(localStorage.getItem('outpost.best'))||0;soundOn=localStorage.getItem('outpost.sound')!=='false';sensitivity=Number(localStorage.getItem('outpost.sensitivity'))||1;}catch{}
$('record').textContent=`ВОЛНА ${String(best).padStart(2,'0')}`;$('sound').checked=soundOn;$('sensitivity').value=sensitivity;$('sensitivityValue').value=sensitivity.toFixed(1);
const keys=new Set(),enemies=[],dead=[],rockets=[],effects=[],pickups=[],decor=[];
const grenades=createGrenades(scene,world.colliders,pos=>explode(pos));
let grenadeRequest=0;
const audioEngine=createAudio();
const radio=createRadio(scene,sound);
const fx=createFx(scene,(kind,options)=>sound(kind,options)),overlay=createOverlay(camera);
function initAudio(){audioEngine.setEnabled(soundOn);audioEngine.init();}
function sound(kind,options){audioEngine.setEnabled(soundOn);audioEngine.play(kind,options);}
function toast(message,duration=2.4){$('toast').textContent=message;toastTime=duration;$('toast').style.opacity=1;}
function banner(label,title,sub,duration=3){$('bannerLabel').textContent=label;$('bannerTitle').textContent=title;$('bannerSub').textContent=sub;bannerTime=duration;$('banner').style.opacity=1;}
function saveBest(){best=bestWave(best,wave);try{localStorage.setItem('outpost.best',best);}catch{}$('record').textContent=`ВОЛНА ${String(best).padStart(2,'0')}`;}
// ---- Gunplay: per-weapon spread, bloom, recoil and reload behaviour ----
const GUN={
  ak:{hip:.014,ads:.003,bloom:.004,bloomMax:.032,kickV:.012,kickH:.007,recover:.6,pen:1,tac:1.7,empty:2.3,chamber:true,shell:'rifle'},
  shotgun:{hip:.075,ads:.05,bloom:0,bloomMax:0,kickV:.055,kickH:.02,recover:.7,pen:0,pellets:9,shellFirst:.35,shellEach:.47,shell:'shell'},
  minigun:{hip:.026,ads:.02,bloom:.0007,bloomMax:.03,kickV:.0035,kickH:.004,recover:.8,pen:2,shell:'rifle'},
  rpg:{hip:0,ads:0,bloom:0,bloomMax:0,kickV:.07,kickH:.01,recover:.7,pen:0,tac:2.6,empty:2.6},
};
const BASE_CAP={ak:30,shotgun:6},ADS={ak:[0,.143],shotgun:[0,.17],rpg:[-.055,.09],minigun:[.2,0]};
let bloom=0,recoilDebtV=0,recoilDebtH=0,reloadTotal=0,swayX=0,swayY=0,shotsFired=0,shotsHit=0,headshots=0,perkChoice=null,pipKey='',groanCd=2,lowHpFx=false;
function mods(who=player){return perkMods(who?.perks||{});}
function capacity(name,who=player){return BASE_CAP[name]?Math.round(BASE_CAP[name]*mods(who).mag):weapons[name].capacity;}
function currentSpread(){const g=GUN[current];return ((aim?g.ads:g.hip)+bloom+Math.min(.03,(player.moveSpeed||0)*.0028)+(player.grounded?0:.03))*mods().spread;}
function updateRecoil(dt){bloom=Math.max(0,bloom-dt*(shooting?.015:.08));const k=Math.min(1,dt*(shooting?2.5:7)),rv=recoilDebtV*k,rh=recoilDebtH*k;player.pitch-=rv;player.yaw-=rh;recoilDebtV-=rv;recoilDebtH-=rh;swayX*=Math.max(0,1-dt*9);swayY*=Math.max(0,1-dt*9);}
function updateReload(dt){
  if(reloadTime<=0||!reloadingWeapon){$('reloadBar').style.display='none';return;}
  reloadTime-=dt;$('reloadBar').style.display='block';$('reloadBar').firstElementChild.style.width=`${(1-Math.max(0,reloadTime)/(reloadTotal||1))*100}%`;
  if(reloadTime>0)return;
  const name=reloadingWeapon,w=weapons[name],cap=capacity(name),g=GUN[name];
  if(name==='shotgun'){if(w.reserve>0&&w.mag<cap){w.mag++;w.reserve--;sound('switch',{rate:.8});}if(w.mag<cap&&w.reserve>0)reloadTotal=reloadTime=g.shellEach*mods().reload;else{reloadingWeapon=null;reloadTime=0;sound('reload',{rate:1.2});}updateHUD();return;}
  const target=cap+(g.chamber&&w.mag>0?1:0),n=Math.min(target-w.mag,w.reserve);w.mag+=n;w.reserve-=n;reloadingWeapon=null;reloadTime=0;sound('switch');updateHUD();
}
function renderPips(w){const cap=current==='minigun'?0:capacity(current),key=current+cap+':'+w.mag;if(key===pipKey)return;pipKey=key;const box=$('ammoPips');box.replaceChildren();box.dataset.kind=current;if(!cap)return;const n=Math.min(cap+1,42),full=Math.round(w.mag*n/Math.max(cap,w.mag));for(let i=0;i<Math.max(n,full);i++){const s=document.createElement('i');if(i>=full)s.className='spent';box.appendChild(s);}}
function offerPerks(){if(player.health<=0)return;perkChoice=rollPerks(player.perks,3);if(!perkChoice.length)perkChoice=null;renderPerks();}
function renderPerks(){const box=$('perkModal');box.hidden=!perkChoice;if(!perkChoice)return;box.querySelector('.perk-cards').replaceChildren(...perkChoice.map((id,i)=>{const p=PERKS[id],card=document.createElement('button'),k=document.createElement('kbd'),icon=document.createElement('i'),t=document.createElement('b'),d=document.createElement('small'),lvl=document.createElement('em');card.className='perk-card';k.textContent=i+1;icon.textContent=p.icon;t.textContent=p.title;d.textContent=p.desc;lvl.textContent=`УРОВЕНЬ ${(player.perks[id]||0)+1} / ${p.max}`;card.append(k,icon,t,d,lvl);card.onclick=()=>choosePerk(i);return card;}));}
function choosePerk(i){if(!perkChoice||!perkChoice[i])return;const id=perkChoice[i];player.perks[id]=(player.perks[id]||0)+1;perkChoice=null;renderPerks();if(net.role!=='client'){if(id==='pack')player.grenades=Math.min(5+mods().grenades,player.grenades+2);if(id==='tough')heal(player,25);}else net.send({t:'perks',p:player.perks});pipKey='';toast(`УСИЛЕНИЕ · ${PERKS[id].title.toUpperCase()}`,2);sound('pickup');updateHUD();}
function waveSummary(){const acc=shotsFired?Math.round(shotsHit/shotsFired*100):0;return `Точность ${acc}% · попаданий в голову ${headshots} · +30 здоровья · выбери усиление (1/2/3)`;}
function setWeapon(name){if(current===name||!weapons[name])return;if(name==='minigun'&&minigunUntil<wave||name==='minigun'&&!minigunUntil)return;current=name;reloadTime=0;reloadingWeapon=null;aim=false;shotKick=.12;sound('switch');updateHUD();}
function cycleWeapon(step=1){const list=WEAPON_KEYS.filter(k=>k!=='minigun'||minigunUntil&&minigunUntil>=wave);const i=list.indexOf(current);setWeapon(list[((i<0?0:i)+step+list.length)%list.length]);}
function reload(){if(current==='minigun')return;const w=weapons[current],g=GUN[current],cap=capacity(current);if(reloadTime>0||w.mag>=cap)return;if(w.reserve<=0){toast('Боезапас исчерпан. Ищи ящики или смени оружие.');return;}const m=mods();reloadingWeapon=current;reloadTotal=reloadTime=(current==='shotgun'?g.shellFirst+g.shellEach:w.mag>0?g.tac:g.empty)*m.reload;sound('reload',{rate:current==='shotgun'?1.3:1});updateHUD();}
function updateHUD(){updateRadioHud();const w=weapons[current];$('grenadeCount').textContent=player.grenades;$('wave').textContent=String(wave).padStart(2,'0');$('enemies').textContent=Math.max(0,config.count-waveKills);$('waveProgress').style.width=`${(1-waveKills/config.count)*100}%`;$('kills').textContent=kills;$('score').textContent=String(score).padStart(6,'0')+' ОЧКОВ';$('health').textContent=Math.ceil(player.health);$('healthBar').style.width=Math.min(100,player.health/maxHealth(player)*100)+'%';$('healthMax').textContent='/ '+maxHealth(player);$('healthBar').style.background=player.health<30?'#ed714b':'#e5e9dc';$('ammo').textContent=String(w.mag).padStart(2,'0');$('ammo').style.color=w.mag===0?'#ed714b':'';$('reserve').textContent=w.reserve;renderPips(w);$('weaponName').textContent=WEAPON_NAMES[current];$('ammoStatus').textContent=reloadTime>0?(reloadingWeapon==='shotgun'?'ЗАРЯЖАЮ ПАТРОНЫ…':'ПЕРЕЗАРЯДКА…'):player.sprinting?'БЕГ · ОРУЖИЕ ОПУЩЕНО':current==='ak'?'7.62 × 39 ММ · АВТО':current==='shotgun'?`12 КАЛИБР · ${SHOTGUN_PELLETS} ДРОБИН`:current==='minigun'?`ДО КОНЦА ВОЛНЫ ${minigunUntil}`:'РЕАКТИВНАЯ ГРАНАТА';$('slotAk').classList.toggle('active',current==='ak');$('slotShotgun').classList.toggle('active',current==='shotgun');$('slotRpg').classList.toggle('active',current==='rpg');updateBossHUD();$('slotMini').hidden=!minigunUntil;$('slotMini').classList.toggle('active',current==='minigun');updateSquadHUD();}
function clearGame(){previousProgramWave=0;fx.clear();overlay.clear();for(const r of rocks)scene.remove(r.mesh);rocks.length=0;canvas.style.filter='';lowHpFx=false;setWaveEvent(null);combo=0;comboTime=0;bossesSpawned=0;radio.clear();grenades.clear();grenadeRequest=0;drop?.dispose();drop=null;dropWave=0;minigunUntil=0;weapons.minigun.mag=0;coopPaused=false;for(const q of squad.values()){scene.remove(q.mesh);}squad.clear();takenPickups.clear();for(const list of [enemies,dead,rockets,effects,pickups]){for(const e of list){scene.remove(e.mesh);disposeZombie(e.mesh);if(e.dispose){e.mesh.geometry?.dispose();e.mesh.material?.dispose();}}list.length=0;}keys.clear();shooting=false;aim=false;dragLook=false;joyX=joyY=0;navTime=0;emptyTime=0;reloadTime=0;shootCooldown=0;shotKick=0;shake=0;damageTime=0;hitTime=0;bannerTime=0;toastTime=0;flash.visible=false;weaponLight.intensity=0;$('damage').style.opacity=0;}
function startGame(){clearGame();gameSession++;$('coopModal').hidden=true;phase='active';wave=0;kills=0;score=0;current='ak';player.pos.set(0,1.72,12);player.yaw=0;player.pitch=0;player.health=100;player.stamina=100;player.perks={};perkChoice=null;renderPerks();bloom=0;recoilDebtV=recoilDebtH=0;shotsFired=shotsHit=headshots=0;pipKey='';player.vy=0;player.grounded=true;player.grenades=3;player.lastGrenade=-99;weapons.ak.mag=30;weapons.ak.reserve=180;weapons.rpg.mag=1;weapons.rpg.reserve=6;weapons.shotgun.mag=6;weapons.shotgun.reserve=30;for(const d of decor)d.visible=false;for(const id of ['menu','pause','gameover','settingsModal'])$(id).hidden=true;$('hud').hidden=false;initAudio();if(net.role!=='client')nextWave();else updateHUD();if(net.role==='host'){for(const [id,q]of net.peers){const mate=ensureMate(id,q.name);net.send({t:'start',session:gameSession,spawn:mate.pos.toArray()},id);}}requestLock();}
function nextWave(){if(net.role==='client')return;expireMinigun();phase='active';wave++;radio.startWave(wave);config=waveConfig(wave,net.role==='solo'?1:1+net.peers.size);setWaveEvent(rollWaveEvent(wave));applyEventToConfig();if(config.boss)config.count+=1+Math.floor(wave/20);spawned=0;bossesSpawned=0;waveKills=0;shotsFired=shotsHit=headshots=0;spawnTimer=wave%5===0?9:.8;if(wave%5===0)beginDrop(wave);saveBest();$('waveState').textContent='УДЕРЖИВАЙ ПОЗИЦИЮ';announceProgram();sound('wave');updateHUD();}
function completeWave(){expireMinigun();phase='break';breakTime=15;player.grenades=Math.min(5+mods().grenades,player.grenades+2);for(const q of squad.values()){q.grenades=Math.min(5+mods(q).grenades,q.grenades+2);q.health=Math.min(maxHealth(q),Math.max(40,q.health)+30);}player.health=Math.min(maxHealth(player),Math.max(net.role==='solo'?0:40,player.health)+30);weapons.ak.reserve=Math.min(360,weapons.ak.reserve+110+wave*15);weapons.rpg.reserve=Math.min(14,weapons.rpg.reserve+3);weapons.shotgun.reserve=Math.min(AMMO_CAP.shotgun,weapons.shotgun.reserve+12);setWaveEvent(null);score+=wave*250;$('waveState').textContent='ПЕРИМЕТР ЗАЧИЩЕН';banner('ВОЛНА ОТБИТА','ПЕРЕДЫШКА',waveSummary(),10);offerPerks();toast('E — начать следующую волну',9);sound('pickup');updateHUD();}
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
document.addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&phase!=='menu')e.preventDefault();if(e.code==='Escape'){pause();return;}if(coopPaused||phase!=='active'&&phase!=='break')return;keys.add(e.code);if(perkChoice&&/^Digit[123]$/.test(e.code)){choosePerk(Number(e.code.slice(5))-1);return;}if(e.code==='KeyL'&&!e.repeat)toggleFlashlight();if(e.code==='Digit1')setWeapon('ak');if(e.code==='Digit2')setWeapon('shotgun');if(e.code==='Digit3')setWeapon('rpg');if(e.code==='Digit4')setWeapon('minigun');if(e.code==='KeyR')reload();if(e.code==='KeyG'&&!e.repeat)throwGrenade();if(e.code==='KeyQ'&&!e.repeat)requestDj();if(e.code==='KeyE'&&phase==='break')nextWave();if(e.code==='Space'&&player.grounded&&player.health>0){player.vy=6;player.grounded=false;}});
document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousedown',e=>{if(coopPaused||player.health<=0||phase!=='active'&&phase!=='break')return;if(e.button===0){shooting=true;dragLook=true;if(!document.pointerLockElement&&!lockUnavailable)requestLock();}if(e.button===2)aim=true;initAudio();});
document.addEventListener('mouseup',e=>{if(e.button===0){shooting=false;dragLook=false;}if(e.button===2)aim=false;});
document.addEventListener('mousemove',e=>{if((phase==='active'||phase==='break')&&(document.pointerLockElement===canvas||dragLook)){swayX=THREE.MathUtils.clamp(swayX+e.movementX*.00035,-.05,.05);swayY=THREE.MathUtils.clamp(swayY-e.movementY*.00025,-.035,.035);player.yaw-=e.movementX*.0022*sensitivity*(aim?.62:1);player.pitch=THREE.MathUtils.clamp(player.pitch-e.movementY*.0022*sensitivity*(aim?.62:1),-1.35,1.35);}});
canvas.addEventListener('wheel',e=>{if(phase==='active'||phase==='break'){e.preventDefault();cycleWeapon(e.deltaY<0?-1:1);}},{passive:false});
// Touch input is an alternative for tablets; keyboard and pointer lock remain the primary controls.
let joyX=0,joyY=0,joyId=null,lookId=null,lastTouch=null;
$('joystick').addEventListener('pointerdown',e=>{joyId=e.pointerId;$('joystick').setPointerCapture(joyId);moveJoy(e);});
function moveJoy(e){if(e.pointerId!==joyId)return;const r=$('joystick').getBoundingClientRect();let x=(e.clientX-r.left-r.width/2)/40,y=(e.clientY-r.top-r.height/2)/40;const d=Math.max(1,Math.hypot(x,y));joyX=x/d;joyY=y/d;$('joystick').firstElementChild.style.transform=`translate(${joyX*30}px,${joyY*30}px)`;}
$('joystick').addEventListener('pointermove',moveJoy);for(const type of ['pointerup','pointercancel'])$('joystick').addEventListener(type,()=>{joyId=null;joyX=joyY=0;$('joystick').firstElementChild.style.transform='';});
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&(phase==='active'||phase==='break')){lookId=e.pointerId;lastTouch={x:e.clientX,y:e.clientY};canvas.setPointerCapture(lookId);}});
canvas.addEventListener('pointermove',e=>{if(e.pointerId===lookId&&lastTouch){player.yaw-=(e.clientX-lastTouch.x)*.005*sensitivity;player.pitch=THREE.MathUtils.clamp(player.pitch-(e.clientY-lastTouch.y)*.005*sensitivity,-1.35,1.35);lastTouch={x:e.clientX,y:e.clientY};}});
for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,()=>{lookId=null;lastTouch=null;});
$('touchFire').addEventListener('pointerdown',e=>{shooting=true;e.target.setPointerCapture(e.pointerId);});for(const type of ['pointerup','pointercancel'])$('touchFire').addEventListener(type,()=>shooting=false);$('djAbility').onclick=requestDj;$('touchGrenade').onclick=throwGrenade;$('touchReload').onclick=reload;$('touchSwitch').onclick=()=>cycleWeapon(1);

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
  if(config.boss){banner('ВОЛНА '+wave+' · БОСС','ТИТАН ИДЁТ','Огромный и медленный, бьёт по земле. Держи дистанцию — миниган уже летит.',5);return;}
  if(waveEvent){const ev=WAVE_EVENTS[waveEvent];banner('ВОЛНА '+wave+' · СОБЫТИЕ',ev.title,ev.hint,4.6);return;}
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
let forcedType=null;
function pickEnemyType(){if(forcedType){const t=forcedType;forcedType=null;if(t==='boss')bossesSpawned++;return t;}if(config.boss&&bossesSpawned<1+Math.floor(wave/20)){bossesSpawned++;return 'boss';}const roll=Math.random();let acc=config.bruteChance;if(roll<acc)return 'brute';acc+=config.exploderChance||0;if(roll<acc)return 'exploder';acc+=config.runnerChance;if(roll<acc)return 'runner';return 'walker';}
function spawnEnemy(at=null){const point=at||chooseSpawnPoint();if(!point)return false;const type=pickEnemyType(),stats=enemyStats(config,type),id=++enemyId,mesh=makeZombie(type,id),e={id,mesh,type,hp:stats.health,maxHp:stats.health,speed:stats.speed,damage:stats.damage,attack:Math.random()*.7,step:Math.random()*10,radius:type==='boss'?.9:type==='brute'?.65:.4,stuck:0,turn:Math.random()<.5?-1:1,slam:3};e.prize=type!=='boss'&&radio.state.program==='pinata' && spawned%5===0;if(type==='boss'){sound('blast',{rate:.5});shake=.5;toast('ТИТАН НА ПОЛЕ БОЯ',3);}
  dressZombie(mesh,radio.state.program,e.prize);
  mesh.position.set(point.x,0,point.z);mesh.traverse(o=>{if(o.isMesh)o.userData.enemy=e;});enemies.push(e);scene.add(mesh);spawned++;return true;}
function killEnemy(e,headshot=false,shooter=null,dir=null){const i=enemies.indexOf(e);if(i<0)return;enemies.splice(i,1);kills++;waveKills++;combo++;comboTime=3;const ev=waveEvent&&WAVE_EVENTS[waveEvent],mult=(ev?.score||1)*(1+Math.min(combo,20)*.05);score+=Math.round(((({brute:180,runner:120,exploder:150,boss:3000})[e.type]||100)+(headshot?40:0))*mult);if([5,10,20,35,50].includes(combo))toast(`СЕРИЯ ×${combo} · ОЧКИ ×${(1+Math.min(combo,20)*.05).toFixed(2)}`,1.4);if(!shooter||shooter===player){hitTime=.2;$('hitmarker').classList.add('kill');}corpse(e,headshot,dir);const vamp=shooter?mods(shooter).vamp:0;if(vamp)heal(shooter,vamp);overlay.kill(shooterName(shooter),ENEMY_NAMES[e.type]||'Зомби',headshot);if(net.role==='host')net.broadcast({t:'kill',id:e.id,h:headshot?1:0,d:dir?[dir.x,dir.z]:null,by:shooterName(shooter),ty:e.type});
  if(e.type==='exploder')explode(e.mesh.position.clone().setY(1),false,{power:200,radius:6,playerDamage:24,playerRadius:4.2});
  if(e.type==='boss'){const p=e.mesh.position.clone();banner('ТИТАН ПОВЕРЖЕН','+3000 ОЧКОВ','Отличная работа, отряд.',3.5);for(let k=0;k<4;k++)dropPickup(p.clone().add(new THREE.Vector3((Math.random()-.5)*3,0,(Math.random()-.5)*3)),k%2?'health':'ammo');explode(p.clone().setY(1.2),true);if(net.role==='host')net.broadcast({t:'bossdown',p:p.toArray()});}if(e.prize){radio.partyPop(e.mesh.position);dropPickup(e.mesh.position,'ammo');if(net.role==='host')net.broadcast({t:'pop',p:e.mesh.position.toArray()});}else if(Math.random()<.23*(ev?.drops||1)||kills%7===0)dropPickup(e.mesh.position,player.health<45&&Math.random()<.65?'health':Math.random()<.4?'health':'ammo');updateHUD();if(waveKills>=config.count&&phase==='active')completeWave();}
const ENEMY_NAMES={walker:'Ходок',runner:'Бегун',brute:'Громила',exploder:'Бомбер',boss:'ТИТАН'};
function hurtEnemy(e,amount,headshot=false,dir=null,shooter=null){
  if(!enemies.includes(e))return;
  // The Titan's body is armored; the glowing head is the weak point.
  if(e.type==='boss'&&!headshot)amount*=.6;
  e.hp-=headshot&&radio.state.program==='heads'?amount*1.5:amount;e.flash=.12;
  if(dir&&e.type!=='boss'){const k=Math.min(1,amount/45)*(e.type==='brute'?.35:1);if(k>.2){e.stagger=Math.max(e.stagger||0,.1+k*.3);e.kx=dir.x*k*6;e.kz=dir.z*k*6;}}
  if(e.type==='boss'&&!e.enraged&&e.hp>0&&e.hp<e.maxHp*.5){e.enraged=true;e.speed*=1.3;banner('ТИТАН В ЯРОСТИ','ВТОРАЯ ФАЗА','Быстрее, бьёт чаще и зовёт орду. Цель — голова.',2.6);sound('roar');}
  if(e.hp<=0)killEnemy(e,headshot,shooter,dir);
}
function maxHealth(who){return 100+mods(who).maxHp;}
function heal(who,amount){if(who.health<=0)return;who.health=Math.min(maxHealth(who),who.health+amount);}
function corpse(e,head,dir){const m=e.mesh;if(dir)m.rotation.y=Math.atan2(-dir.x,-dir.z);if(head&&e.type!=='boss'&&m.userData.head){m.userData.head.visible=false;particles(m.position.clone().setY((m.userData.headY||1.5)+.15),18,false,'blood');}fx.decal(m.position,e.type==='boss'?2.6:.75+Math.random()*.4,e.type==='exploder');dead.push({mesh:m,life:4.5,max:4.5});}
function shooterName(s){return s===player?(net.role==='solo'?'Ты':net.name):s?.name||'Взрыв';}
function slamVisual(pos){const d=pos.distanceTo(player.pos);sound('blast',{rate:.7,distance:d*.3});particles(pos.clone().setY(.3),24,false);shake=Math.max(shake,.5*Math.max(0,1-d/22));const mesh=new THREE.Mesh(new THREE.RingGeometry(.6,1.1,40),new THREE.MeshBasicMaterial({color:0xff7a4a,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(pos.x,.08,pos.z);scene.add(mesh);effects.push({mesh,life:.5,max:.5,type:'ring',dispose:true});}
function bossSlam(e){const pos=e.mesh.position.clone();slamVisual(pos);sound('roar',{volume:.6,rate:1.2});if(net.role==='host')net.broadcast({t:'slam',p:pos.toArray()});for(const q of [player,...squad.values()]){if(q.health<=0)continue;const d=Math.hypot(q.pos.x-pos.x,q.pos.z-pos.z);if(d>7.5)continue;const dmg=10+e.damage*.75*(1-d/7.5);if(q===player)hurtPlayer(dmg,pos);else q.health=Math.max(0,q.health-dmg);}if(player.health<=0&&!aliveTargets().length)die();}
// Titan brain: ground slam up close, telegraphed charge at mid range, boulders
// at long range and minion calls. Returns true while it controls movement.
function bossThink(e,dt,target,dist,dx,dz){
  const p=e.mesh.position,rage=e.enraged?.65:1,u=e.mesh.userData;
  e.slam-=dt;e.chargeCd=(e.chargeCd??5)-dt;e.rockCd=(e.rockCd??3)-dt;e.summonCd=(e.summonCd??9)-dt;
  if(e.windup>0){e.windup-=dt;e.mesh.rotation.y=Math.atan2(e.cdx,e.cdz);u.leftArm.rotation.x=-2.5;u.rightArm.rotation.x=-2.5;e.flash=Math.max(e.flash||0,.25);if(e.windup<=0){e.charging=1.15;e.hitDuringCharge=new Set();}return true;}
  if(e.charging>0){
    e.charging-=dt;const step=15*dt,moved=moveActor(p,e.cdx*step,e.cdz*step,e.radius);e.step+=dt*14;u.leftLeg.rotation.x=Math.sin(e.step)*.7;u.rightLeg.rotation.x=-Math.sin(e.step)*.7;u.leftArm.rotation.x=-1.4;u.rightArm.rotation.x=-1.4;
    if(Math.random()<.5)particles(p.clone().setY(.2),2,false);
    for(const q of [player,...squad.values()]){if(q.health<=0||e.hitDuringCharge.has(q))continue;if(Math.hypot(q.pos.x-p.x,q.pos.z-p.z)<2.1){e.hitDuringCharge.add(q);const dmg=30+e.damage*.6;if(q===player){hurtPlayer(dmg,p);moveActor(player.pos,e.cdx*2.5,e.cdz*2.5,.38);shake=.6;}else q.health=Math.max(0,q.health-dmg);}}
    if(!moved||e.charging<=0){e.charging=0;if(!moved){slamVisual(p.clone());if(net.role==='host')net.broadcast({t:'slam',p:p.toArray()});e.stagger=1.3;toast('ТИТАН ОГЛУШЁН — БЕЙ В ГОЛОВУ!',1.5);}}
    if(player.health<=0&&!aliveTargets().length)die();return true;
  }
  if(e.slam<=0&&dist<7.5){e.slam=3.2*rage;bossSlam(e);return false;}
  if(e.chargeCd<=0&&dist>7&&dist<28){e.chargeCd=7.5*rage;e.windup=.95;const n=Math.hypot(dx,dz)||1;e.cdx=dx/n;e.cdz=dz/n;sound('roar');if(net.role==='host')net.broadcast({t:'roar'});toast('ТИТАН ГОТОВИТ ТАРАН — УХОДИ В СТОРОНУ!',1.3);return true;}
  if(e.rockCd<=0&&dist>10){e.rockCd=4.6*rage;throwRock(e,target);return false;}
  if(e.summonCd<=0){e.summonCd=14*rage;summonMinions(e);}
  return false;
}
const rocks=[],rockGeo=new THREE.DodecahedronGeometry(.45,0),rockMat=new THREE.MeshStandardMaterial({color:0x4a4640,roughness:.95});
function spawnRock(o,v,live){const mesh=new THREE.Mesh(rockGeo,rockMat);mesh.castShadow=true;mesh.position.copy(o);scene.add(mesh);rocks.push({mesh,v,live});}
function throwRock(e,target){const o=e.mesh.position.clone();o.y=3.4;const t=1.15,tp=target.pos;const v=new THREE.Vector3((tp.x-o.x)/t,(-o.y+.5*20*t*t)/t,(tp.z-o.z)/t);spawnRock(o,v,true);sound('switch',{rate:.45});if(net.role==='host')net.broadcast({t:'rock',o:o.toArray(),v:v.toArray()});}
function updateRocks(dt){for(let i=rocks.length-1;i>=0;i--){const r=rocks[i];r.v.y-=20*dt;r.mesh.position.addScaledVector(r.v,dt);r.mesh.rotation.x+=dt*5;r.mesh.rotation.z+=dt*3;if(r.mesh.position.y>.35)continue;const p=r.mesh.position.clone();p.y=0;scene.remove(r.mesh);rocks.splice(i,1);slamVisual(p);particles(p.clone().setY(.3),14,false);if(!r.live)continue;for(const q of [player,...squad.values()]){if(q.health<=0)continue;const d=Math.hypot(q.pos.x-p.x,q.pos.z-p.z);if(d<3.6){const dmg=12+30*(1-d/3.6);if(q===player)hurtPlayer(dmg,p);else q.health=Math.max(0,q.health-dmg);}}if(player.health<=0&&!aliveTargets().length)die();}}
function summonMinions(e){const type=wave>=10?'exploder':'runner',n=wave>=15?5:4;let made=0;for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,x=e.mesh.position.x+Math.cos(a)*2.8,z=e.mesh.position.z+Math.sin(a)*2.8;if(blocked(x,z,.5))continue;forcedType=type;if(spawnEnemy({x,z}))made++;}forcedType=null;config.count+=made;if(made){sound('roar',{rate:.8});toast('ТИТАН ЗОВЁТ ОРДУ',1.6);}}
function jitter(dir,s){dir.x+=(Math.random()-.5)*s*2;dir.y+=(Math.random()-.5)*s*2;dir.z+=(Math.random()-.5)*s*2;dir.normalize();return dir;}
function shotModsFor(who){const m=mods(who);return {dm:m.damage,hm:m.head,pen:m.pen};}
// Penetrating hitscan: each bullet can pass through `pen` extra zombies, losing 40% per body.
function hitscan(origin,dir,weapon,applyDamage,shooter=null,mx={}){
  raycaster.set(origin,dir);const wall=obstacleDistance(origin,dir),hits=raycaster.intersectObjects(enemies.map(e=>e.mesh),true);
  let end=origin.clone().addScaledVector(dir,Math.min(wall,85)),hitAny=false,dealt=0,pierce=(GUN[weapon]?.pen||0)+(mx.pen||0),falloff=1;const seen=new Set();
  for(const hit of hits){
    if(hit.distance>=wall)break;const e=hit.object.userData.enemy;if(!e||seen.has(e))continue;seen.add(e);
    const head=isHeadHit(hit,e);hitAny=true;end=hit.point;
    let dmg=DAMAGE[weapon][head?1:0]*(mx.dm||1)*(head?(mx.hm||1):1)*falloff;if(weapon==='shotgun')dmg*=Math.max(.35,1-hit.distance/34);
    if(applyDamage)hurtEnemy(e,dmg,head,dir,shooter);dealt+=dmg;
    if(shooter===player){overlay.damageNumber(hit.point,e.type==='boss'&&!head?dmg*.6:dmg,head);if(head)headshots++;}
    particles(hit.point,head?10:5,false,e.type==='exploder'?'acid':'blood');
    if(pierce--<=0)break;falloff*=.6;
  }
  if(!hitAny&&wall<85)particles(end,3);
  return {hit:hitAny,end,dealt};
}
function dirAngle(from){const dx=from.x-player.pos.x,dz=from.z-player.pos.z,s=Math.sin(player.yaw),c=Math.cos(player.yaw);return Math.atan2(dx*c-dz*s,-dx*s-dz*c);}
function nearestEnemy(pos){let best=null,d=Infinity;for(const e of enemies){const n=e.mesh.position.distanceToSquared(pos);if(n<d){d=n;best=e;}}return best;}
function hurtPlayer(amount,from=null){if(net.role==='client'||player.health<=0)return;player.health=Math.max(0,player.health-amount);player.lastHurt=time;damageTime=.35;shake=Math.max(shake,.14);sound('hurt');if(from)overlay.hurtFrom(dirAngle(from));updateHUD();if(player.health<=0)die();}
function updateRegen(dt){if(net.role==='client')return;for(const q of [player,...squad.values()]){if(q.health<=0){q._hp=q.health;continue;}if(q._hp!==undefined&&q.health<q._hp-.01)q.lastHurt=time;const r=mods(q).regen;if(r&&time-(q.lastHurt??-99)>4&&q.health<maxHealth(q))heal(q,r*dt);q._hp=q.health;}}
const particleGeo=new THREE.BoxGeometry(.1,.1,.1),particleMat=new THREE.MeshBasicMaterial({color:0xffb24e}),impactMat=new THREE.MeshBasicMaterial({color:0xa8b790}),bloodMat=new THREE.MeshBasicMaterial({color:0x9a1712}),bloodDark=new THREE.MeshBasicMaterial({color:0x4f0907}),acidMat=new THREE.MeshBasicMaterial({color:0x9dff4a});
function particles(pos,count=7,explosive=false,kind=null){for(let i=0;i<count;i++){const mesh=new THREE.Mesh(particleGeo,kind==='blood'?(i%2?bloodMat:bloodDark):kind==='acid'?acidMat:explosive?particleMat:impactMat);mesh.position.copy(pos);mesh.scale.setScalar(explosive?1+Math.random()*3:.5+Math.random());scene.add(mesh);effects.push({mesh,life:explosive?.65:.23,max:explosive?.65:.23,vel:new THREE.Vector3((Math.random()-.5)*11,Math.random()*10-1,(Math.random()-.5)*11),type:'particle'});}}
function tracer(start,end){const geo=new THREE.BufferGeometry().setFromPoints([start,end]),mat=new THREE.LineBasicMaterial({color:0xffd48a,transparent:true,opacity:.7});const mesh=new THREE.Line(geo,mat);scene.add(mesh);effects.push({mesh,life:.055,max:.055,dispose:true,type:'line'});}
function isHeadHit(hit, enemy) {
  for(let node=hit.object;node&&node!==enemy.mesh;node=node.parent){
    if(node===enemy.mesh.userData.head)return true;
  }
  return enemy.mesh.worldToLocal(hit.point.clone()).y>1.48;
}
function fire(){
  if(coopPaused||player.health<=0||player.sprinting)return;const w=weapons[current],g=GUN[current],m=mods();
  // Firing interrupts a shell-by-shell shotgun reload once a round is loaded.
  if(reloadTime>0){if(reloadingWeapon==='shotgun'&&w.mag>0){reloadTime=0;reloadingWeapon=null;}else return;}
  if(shootCooldown>0)return;
  if(w.mag<=0){reload();shootCooldown=.25;return;}
  w.mag--;shootCooldown=w.rate*(current==='ak'?m.fireRate:1);shotsFired++;
  shotKick=current==='rpg'?.24:current==='shotgun'?.2:current==='minigun'?.035:.07;
  camera.updateMatrixWorld();const origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3()),spread=currentSpread();
  if(current!=='rpg'){
    const shotgun=current==='shotgun',muzzle=w.mesh.localToWorld(w.mesh.userData.muzzle.clone()),mx=shotModsFor(player);let anyHit=false;
    if(!shotgun)jitter(direction,spread);
    for(let k=0;k<(g.pellets||1);k++){const dir=shotgun?jitter(direction.clone(),spread):direction;const r=hitscan(origin,dir,current,net.role!=='client',player,mx);if(r.hit)anyHit=true;fx.bullet(muzzle,r.end,shotgun);}
    if(anyHit){shotsHit++;hitTime=Math.max(hitTime,.13);sound('hit');}
    flash.position.copy(camera.worldToLocal(muzzle.clone()));flash.scale.set((.7+Math.random())*(shotgun?1.8:1),(.7+Math.random())*(shotgun?1.8:1),2);flash.rotation.z=Math.random()*6;flash.visible=true;weaponLight.intensity=8;
    ejectCasing(w,g.shell);if(shotgun||Math.random()<.3)fx.smoke(muzzle);
    if(shotgun){sound('shot',{rate:.62});sound('shot',{rate:.42,volume:.7});shake=Math.max(shake,.13);}else sound(current==='minigun'?'minigun':'shot');
  }else {const mesh=createRocket();mesh.position.copy(origin).addScaledVector(direction,.9);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);scene.add(mesh);rockets.push({mesh,dir:direction,life:4,visualOnly:net.role==='client'});sound('rocket');shake=.15;}
  // Recoil climbs the view; most of it recovers once the trigger is released.
  const kv=g.kickV*(.8+Math.random()*.4)*m.recoil*(aim?.7:1),kh=(Math.random()-.5)*2*g.kickH*m.recoil;
  player.pitch=Math.min(1.35,player.pitch+kv);player.yaw+=kh;recoilDebtV+=kv*g.recover;recoilDebtH+=kh*g.recover;bloom=Math.min(g.bloomMax,bloom+g.bloom);
  const shot={t:'shot',weapon:current,o:origin.toArray(),d:direction.toArray(),s:spread};if(net.role==='client')net.send(shot);else if(net.role==='host')net.broadcast({...shot,who:net.id});updateHUD();
}
function ejectCasing(w,kind){if(!kind)return;const p=w.mesh.localToWorld(new THREE.Vector3(.06,.06,-.12)),right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);fx.casing(p,right,up,kind);}
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
function explode(pos,visualOnly=false,opts={}){const power=opts.power||240,radius=opts.radius||8.5,pDmg=opts.playerDamage||14,pRad=opts.playerRadius||3.8;if(net.role==='host'&&!visualOnly)net.broadcast({t:'blast',p:pos.toArray()});sound('blast');particles(pos,30,true);shake=.4;const mat=new THREE.MeshBasicMaterial({color:0xffa543,transparent:true,opacity:.62,depthWrite:false}),mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),mat);mesh.position.copy(pos);scene.add(mesh);effects.push({mesh,life:.42,max:.42,type:'explosion',dispose:true});if(!visualOnly&&net.role!=='client')for(const e of [...enemies]){const center=e.mesh.position.clone();center.y=1;const d=pos.distanceTo(center);if(d<radius){hurtEnemy(e,blastDamage(d,radius,power));hitTime=.2;}}const pd=pos.distanceTo(player.pos);if(!visualOnly&&pd<pRad)hurtPlayer(pDmg*(1-pd/pRad));if(!visualOnly&&net.role==='host'){for(const q of squad.values()){const d=pos.distanceTo(q.pos);if(d<pRad)q.health=Math.max(0,q.health-pDmg*(1-d/pRad));}if(player.health<=0&&!aliveTargets().length)die();}}
const pickupMats={health:new THREE.MeshStandardMaterial({color:0x97ba8b,emissive:0x395735,emissiveIntensity:.6}),ammo:new THREE.MeshStandardMaterial({color:0xc79a48,emissive:0x69471b,emissiveIntensity:.7})},pickupGeo=new THREE.BoxGeometry(.48,.38,.38);
function dropPickup(pos,type,id=++enemyId){const mesh=new THREE.Group(),box=new THREE.Mesh(pickupGeo,pickupMats[type]);mesh.add(box);const barMat=new THREE.MeshBasicMaterial({color:type==='health'?0xe8f3d7:0xffdc93});for(let i=0;i<2;i++){const bar=new THREE.Mesh(new THREE.BoxGeometry(i?.06:.22,i?.22:.06,.015),barMat);bar.position.z=.198;mesh.add(bar);}mesh.position.copy(pos);mesh.position.y=.6;scene.add(mesh);pickups.push({id,mesh,type,life:35});}
function updatePlayer(dt){updateRecoil(dt);let x=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joyX,z=(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0)+joyY;if(coopPaused||player.health<=0){x=0;z=0;}const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}const sprint=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&len>.1&&player.stamina>2&&!aim&&!shooting;player.sprinting=sprint;const speed=(sprint?8:aim?3:4.8)*mods().speed;player.moveSpeed=len*speed;if(sprint)player.stamina=Math.max(0,player.stamina-dt*23);else player.stamina=Math.min(100,player.stamina+dt*16);$('staminaBar').style.width=player.stamina+'%';const sin=Math.sin(player.yaw),cos=Math.cos(player.yaw);moveActor(player.pos,(x*cos+z*sin)*speed*dt,(-x*sin+z*cos)*speed*dt,.38);
  if(keys.has('ArrowLeft'))player.yaw+=1.8*dt;if(keys.has('ArrowRight'))player.yaw-=1.8*dt;if(keys.has('ArrowUp'))player.pitch=Math.min(1.35,player.pitch+dt);if(keys.has('ArrowDown'))player.pitch=Math.max(-1.35,player.pitch-dt);
  player.vy-=16*dt;player.pos.y+=player.vy*dt;if(player.pos.y<=1.72){player.pos.y=1.72;player.vy=0;player.grounded=true;}
  camera.position.copy(player.pos);if(len>.1&&player.grounded)camera.position.y+=Math.sin(time*(sprint?16:11))*.035;camera.rotation.set(player.pitch+shotKick*.13+(Math.random()-.5)*shake*.05,player.yaw+(Math.random()-.5)*shake*.05,0);camera.fov=THREE.MathUtils.lerp(camera.fov,aim?56:sprint?84:78,dt*10);camera.updateProjectionMatrix();$('crosshair').style.setProperty('--gap',(4+currentSpread()*700).toFixed(1)+'px');$('crosshair').classList.toggle('hidden',(aim&&current!=='shotgun')||player.sprinting);$('heading').textContent=String(Math.round(((player.yaw*180/Math.PI)%360+360)%360)).padStart(3,'0');
  for(const [name,w]of Object.entries(weapons)){w.mesh.visible=name===current;const bob=len>.1?Math.sin(time*9)*.012:Math.sin(time*1.9)*.003;const ads=ADS[name]||[.11,0],low=player.sprinting&&name===current?1:0;w.mesh.position.set((aim?ads[0]:.31)-swayX,-.32+bob+(aim?ads[1]:0)+swayY-low*.1,-.52+shotKick*(aim?.6:1));w.mesh.rotation.set(shotKick*.7-low*.45,low*.6+swayX*1.5,-swayX*.8);if(w.mesh.userData.pump){const t=name===current?Math.max(0,Math.min(1,(shootCooldown-.3)/.48)):0;w.mesh.userData.pump.position.z=-.42+Math.sin(t*Math.PI)*.13;}if(w.mesh.userData.barrels)w.mesh.userData.barrels.rotation.z+=dt*(shooting?50:3);if(w.mesh.userData.mag)w.mesh.userData.mag.position.y=-.065;if(reloadTime>0&&name===reloadingWeapon){const progress=1-reloadTime/(reloadTotal||1);if(w.mesh.userData.mag)w.mesh.userData.mag.position.y=-.065-Math.sin(Math.min(1,progress*1.6)*Math.PI)*.32;w.mesh.rotation.x-=Math.sin(progress*Math.PI)*.6;w.mesh.position.y-=Math.sin(progress*Math.PI)*.25;w.mesh.rotation.z-=Math.sin(progress*Math.PI)*.3;}}
}
function updateEnemies(dt){for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];if(!e)continue;const p=e.mesh.position,target=nearestTarget(p),dx=target.pos.x-p.x,dz=target.pos.z-p.z,dist=Math.hypot(dx,dz);
    if(radio.dancing(p)){e.mesh.rotation.y=Math.atan2(radio.state.x-p.x,radio.state.z-p.z);dancePose(e.mesh,radio.state.elapsed,e.id);continue;}
    e.mesh.rotation.z=0;if(radio.still())continue;
    if(e.stagger>0){e.stagger-=dt;moveActor(p,(e.kx||0)*dt,(e.kz||0)*dt,e.radius);e.kx=(e.kx||0)*.86;e.kz=(e.kz||0)*.86;e.mesh.rotation.x=-.3*Math.min(1,e.stagger*4);continue;}e.mesh.rotation.x=0;
    if(e.type==='runner'){e.lungeCd=(e.lungeCd||0)-dt;if(e.lunge>0)e.lunge-=dt;else if(e.lungeCd<=0&&dist<5.5&&dist>1.8){e.lunge=.55;e.lungeCd=3.2;}}
    if(e.type==='exploder'&&dist<1.9&&target.pos.y<2.5){killEnemy(e);if(phase==='gameover')break;continue;}
    if(e.type==='boss'){const busy=bossThink(e,dt,target,dist,dx,dz);if(phase==='gameover')break;if(busy)continue;}
    e.attack-=dt;e.step+=dt*e.speed*2.6;e.mesh.rotation.y=Math.atan2(dx,dz);const u=e.mesh.userData;u.leftLeg.rotation.x=Math.sin(e.step)*.43;u.rightLeg.rotation.x=-Math.sin(e.step)*.43;u.leftArm.rotation.x=-.7+Math.sin(e.step)*.17;u.rightArm.rotation.x=-.8-Math.sin(e.step)*.17;
    if(dist>1.25+e.radius*.4){e.navTimer=(e.navTimer||0)-dt;if(e.navTimer<=0){e.navDir=(target.nav||navigator).direction(p.x,p.z,target.pos.x,target.pos.z,e.radius);e.navTimer=.3;}let mx=e.navDir.x,mz=e.navDir.z;for(let j=0;j<enemies.length;j++){if(i===j)continue;const other=enemies[j],sx=p.x-other.mesh.position.x,sz=p.z-other.mesh.position.z,d2=sx*sx+sz*sz;if(d2<1.3&&d2>.001){mx+=sx/d2*.6;mz+=sz/d2*.6;}}
      const n=Math.max(1,Math.hypot(mx,mz));mx/=n;mz/=n;const step=e.speed*(e.lunge>0?2.4:1)*dt,old=p.clone();moveActor(p,mx*step,mz*step,e.radius);if(p.distanceToSquared(old)<step*step*.1){e.stuck+=dt;const tangentX=-mz*e.turn,tangentZ=mx*e.turn;moveActor(p,tangentX*step,tangentZ*step,e.radius);if(e.stuck>2){e.turn*=-1;e.stuck=0;e.navTimer=0;}}else e.stuck=0;
    }else if(e.attack<=0&&target.pos.y<2.5){e.attack=.85+Math.random()*.3;if(target===player)hurtPlayer(e.damage,p);else target.health=Math.max(0,target.health-e.damage);if(player.health<=0&&!aliveTargets().length)die();if(phase==='gameover')break;}
  }}
function updateProjectiles(dt){for(let i=rockets.length-1;i>=0;i--){const r=rockets[i],start=r.mesh.position.clone(),step=28*dt;r.life-=dt;let hit=false;const segments=Math.ceil(step/.25);for(let s=0;s<segments;s++){r.mesh.position.addScaledVector(r.dir,step/segments);const p=r.mesh.position;if(p.y<.1||Math.abs(p.x)>37.5||Math.abs(p.z)>37.5||world.colliders.some(b=>p.y<=(b.height||3.2)+.12&&Math.abs(p.x-b.x)<b.hx+.12&&Math.abs(p.z-b.z)<b.hz+.12)||enemies.some(e=>p.distanceTo(e.mesh.position.clone().add(new THREE.Vector3(0,1,0)))<(e.type==='boss'?2.4:e.type==='brute'?1.4:.9))){hit=true;break;}}
    if(hit||r.life<=0){explode(r.mesh.position.clone(),r.visualOnly);scene.remove(r.mesh);rockets.splice(i,1);}else if(Math.random()<.7){particles(start,1,true);}}
}
function updateEffects(dt){for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){scene.remove(e.mesh);if(e.dispose){e.mesh.geometry.dispose();e.mesh.material.dispose();}effects.splice(i,1);continue;}if(e.type==='ring'){const p=1-e.life/e.max;e.mesh.scale.setScalar(1+p*6);e.mesh.material.opacity=(1-p)*.8;continue;}if(e.type==='particle'){e.vel.y-=13*dt;e.mesh.position.addScaledVector(e.vel,dt);e.mesh.scale.multiplyScalar(Math.max(.5,1-dt*2));}else if(e.type==='explosion'){const p=1-e.life/e.max;e.mesh.scale.setScalar(.5+p*7);e.mesh.material.opacity=(1-p)*.62;}else if(e.type==='line')e.mesh.material.opacity=e.life/e.max;}
  for(let i=dead.length-1;i>=0;i--){const d=dead[i];d.life-=dt;d.mesh.rotation.x=THREE.MathUtils.lerp(d.mesh.rotation.x,-Math.PI/2,dt*8);if(d.life<1.2)d.mesh.position.y-=dt*.7;if(d.life<=0){scene.remove(d.mesh);disposeZombie(d.mesh);dead.splice(i,1);}}
  for(let i=pickups.length-1;i>=0;i--){const p=pickups[i];p.life-=dt;p.mesh.rotation.y+=dt;p.mesh.position.y=.6+Math.sin(time*3+i)*.12;const dist=Math.hypot(p.mesh.position.x-player.pos.x,p.mesh.position.z-player.pos.z);if(dist<1.65&&player.health>0){if(net.role==='client'){net.send({t:'pickup',id:p.id});takenPickups.add(p.id);scene.remove(p.mesh);pickups.splice(i,1);continue;}if(p.type==='health'){player.health=Math.min(maxHealth(player),player.health+25);toast('АПТЕЧКА · +25 ЗДОРОВЬЯ',1.8);}else{weapons.ak.reserve=Math.min(420,weapons.ak.reserve+45);weapons.rpg.reserve=Math.min(18,weapons.rpg.reserve+1);weapons.shotgun.reserve=Math.min(AMMO_CAP.shotgun,weapons.shotgun.reserve+8);toast('БОЕПРИПАСЫ · +45 ПАТРОНОВ · +8 ДРОБИ · +1 РАКЕТА',1.8);}sound('pickup');p.life=0;updateHUD();}if(p.life<=0){scene.remove(p.mesh);p.mesh.traverse(o=>{if(o.isMesh&&o.geometry!==pickupGeo){o.geometry.dispose();o.material.dispose();}});pickups.splice(i,1);}}
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
    if(m.t==='pose'&&validVector(m.p)&&Number.isFinite(m.yaw)){const p=new THREE.Vector3(...m.p);if(Math.abs(p.x)<38&&Math.abs(p.z)<38&&p.y>=1&&p.y<6&&!blocked(p.x,p.z,.3)){q.pos.copy(p);q.yaw=m.yaw;q.weapon=WEAPON_KEYS.includes(m.weapon)?m.weapon:'ak';}q.help=!!m.help;}
    if(m.t==='perks'){const before=q.perks||{};q.perks=sanitizePerks(m.p);if((q.perks.pack||0)>(before.pack||0))q.grenades=Math.min(5+mods(q).grenades,q.grenades+2);if((q.perks.tough||0)>(before.tough||0))heal(q,25);}
    if(m.t==='dj')startDj(q);if(m.t==='shot')remoteShot(m,q);if(m.t==='grenade')remoteGrenade(m,q);
    if(m.t==='pickup'){const p=pickups.find(p=>p.id===m.id);if(p&&q.health>0&&q.pos.distanceTo(p.mesh.position)<3){if(p.type==='health')q.health=Math.min(maxHealth(q),q.health+25);else net.send({t:'supply',ak:45,rpg:1,sg:8},from);scene.remove(p.mesh);pickups.splice(pickups.indexOf(p),1);}}
    return;
  }
  if(net.role!=='client'||from!==net.room)return;
  if(m.t==='start'){startGame();if(validVector(m.spawn)&&!blocked(m.spawn[0],m.spawn[2],.4))player.pos.fromArray(m.spawn);updatePlayer(0);lastRemoteWave=0;lastSnapshot=0;}
  if(m.t==='over'){phase='gameover';shooting=false;document.exitPointerLock?.();$('finalWave').textContent=wave;$('finalKills').textContent=kills;$('finalScore').textContent=score;$('gameover').hidden=false;}
  if(m.t==='mini'&&Number.isInteger(m.wave)&&m.wave>=wave&&m.wave<=wave+1){dropWave=m.wave;grantMinigun();}
  if(m.t==='supply'){weapons.ak.reserve=Math.min(420,weapons.ak.reserve+(Number(m.ak)||0));weapons.shotgun.reserve=Math.min(AMMO_CAP.shotgun,weapons.shotgun.reserve+(Number(m.sg)||0));weapons.rpg.reserve=Math.min(18,weapons.rpg.reserve+(Number(m.rpg)||0));toast('ПРИПАСЫ ПОЛУЧЕНЫ');}
  if(m.t==='snapshot')applySnapshot(m);
  if(m.t==='pop'&&validVector(m.p))radio.partyPop(new THREE.Vector3(...m.p));
  if(m.t==='shot'&&m.who!==net.id&&validVector(m.o)&&validVector(m.d)){const o=new THREE.Vector3(...m.o),d=new THREE.Vector3(...m.d);tracer(o,o.clone().addScaledVector(d,30));sound(m.weapon==='rpg'?'rocket':m.weapon==='minigun'?'minigun':'shot',{rate:m.weapon==='shotgun'?.62:1,distance:o.distanceTo(player.pos)});}
  if(m.t==='blast'&&validVector(m.p))explode(new THREE.Vector3(...m.p),true);
  if(m.t==='slam'&&validVector(m.p))slamVisual(new THREE.Vector3(...m.p));
  if(m.t==='kill'){const e=enemies.find(q=>q.id===m.id);if(e){enemies.splice(enemies.indexOf(e),1);corpse(e,!!m.h,Array.isArray(m.d)?{x:Number(m.d[0])||0,z:Number(m.d[1])||0}:null);}overlay.kill(String(m.by||'').slice(0,24),ENEMY_NAMES[m.ty]||'Зомби',!!m.h);}
  if(m.t==='rock'&&validVector(m.o)&&validVector(m.v))spawnRock(new THREE.Vector3(...m.o),new THREE.Vector3(...m.v),false);
  if(m.t==='roar'){sound('roar');toast('ТИТАН ГОТОВИТ ТАРАН — УХОДИ В СТОРОНУ!',1.3);}
  if(m.t==='bossdown'&&validVector(m.p)){banner('ТИТАН ПОВЕРЖЕН','+3000 ОЧКОВ','Отличная работа, отряд.',3.5);explode(new THREE.Vector3(...m.p).setY(1.2),true);}
}
function remoteShot(m,q){
  if(!['active','break'].includes(phase)||q.health<=0||!validVector(m.o)||!validVector(m.d)||!WEAPON_KEYS.includes(m.weapon))return;
  if(m.weapon==='minigun'&&(!q.mini||q.mini<wave))return;const rate=(m.weapon==='rpg'?.85:m.weapon==='shotgun'?.7:m.weapon==='minigun'?.035:.085)*(m.weapon==='ak'?mods(q).fireRate:1);if(time-q.lastShot<rate)return;const origin=new THREE.Vector3(...m.o),direction=new THREE.Vector3(...m.d);if(origin.distanceTo(q.pos)>3||direction.length()<.8||direction.length()>1.2)return;q.lastShot=time;direction.normalize();scene.updateMatrixWorld(true);
  if(m.weapon==='rpg'){const mesh=createRocket();mesh.position.copy(origin).addScaledVector(direction,.9);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);scene.add(mesh);rockets.push({mesh,dir:direction,life:4});}
  else {const pellets=m.weapon==='shotgun'?GUN.shotgun.pellets:1,s=THREE.MathUtils.clamp(Number(m.s)||.07,.02,.12),mx=shotModsFor(q);for(let k=0;k<pellets;k++){const dir=pellets>1?jitter(direction.clone(),s):direction;const r=hitscan(origin,dir,m.weapon,true,q,mx);if(k<3)fx.bullet(origin,r.end,pellets>1);}}
  sound(m.weapon==='rpg'?'rocket':m.weapon==='minigun'?'minigun':'shot',{rate:m.weapon==='shotgun'?.62:1,distance:origin.distanceTo(player.pos)});net.broadcast({...m,who:q.id});
}
function snapshot(){return {t:'snapshot',seq:time,radio:{...radio.state},wave,phase,kills,score,waveKills,count:config.count,breakTime,players:[{id:net.id,name:net.name,p:player.pos.toArray(),yaw:player.yaw,health:player.health,weapon:current,grenades:player.grenades},...[...squad.values()].map(q=>({id:q.id,name:q.name,p:q.pos.toArray(),yaw:q.yaw,health:q.health,weapon:q.weapon,mini:q.mini,grenades:q.grenades}))],enemies:enemies.map(e=>({id:e.id,type:e.type,prize:e.prize,p:e.mesh.position.toArray(),r:e.mesh.rotation.y,hp:e.hp,...(e.type==='boss'?{mx:e.maxHp}:{})})),ev:waveEvent,combo,pickups:pickups.map(p=>({id:p.id,type:p.type,p:p.mesh.position.toArray()})),grenades:grenades.items.map(g=>({id:g.id,p:g.mesh.position.toArray(),v:g.velocity.toArray(),life:g.life})),drop:drop?{wave:dropWave,age:drop.mesh.userData.age}:null};}
function applySnapshot(m){
  if(!Number.isFinite(m.seq)||m.seq<=lastSnapshot||!Array.isArray(m.enemies)||m.enemies.length>100||!Array.isArray(m.players)||m.players.length>4)return;lastSnapshot=m.seq;
  if(!['active','break'].includes(phase))return;
  radio.sync(m.radio);
  if((m.ev||null)!==waveEvent)setWaveEvent(typeof m.ev==='string'?m.ev:null);combo=Number.isInteger(m.combo)?m.combo:0;
  const oldPhase=phase;phase=m.phase==='break'?'break':'active';wave=m.wave;config=waveConfig(wave,m.players.length);config.count=m.count;waveKills=m.waveKills;kills=m.kills;score=m.score;breakTime=m.breakTime;
  if(minigunUntil&&wave>minigunUntil)expireMinigun();
  if(wave!==lastRemoteWave){if(lastRemoteWave){weapons.ak.reserve=Math.min(420,weapons.ak.reserve+110+wave*15);weapons.rpg.reserve=Math.min(18,weapons.rpg.reserve+3);weapons.shotgun.reserve=Math.min(AMMO_CAP.shotgun,weapons.shotgun.reserve+12);}lastRemoteWave=wave;saveBest();}
  if(phase==='active' && (wave!==previousProgramWave||oldPhase==='break')){previousProgramWave=wave;announceProgram();}
  if(phase==='break'&&oldPhase!=='break'){expireMinigun();offerPerks();banner('ВОЛНА ОТБИТА','ПЕРЕДЫШКА','Ведущий начинает следующую волну',8);}
  for(const p of m.players){if(!validVector(p.p))continue;if(p.id===net.id){const old=player.health;player.health=p.health;if(Number.isInteger(p.grenades))player.grenades=THREE.MathUtils.clamp(p.grenades,0,7);if(old>0&&p.health<=0){shooting=false;banner('НУЖНА ПОМОЩЬ','ТЫ РАНЕН','Напарник может поднять тебя: удерживать F рядом.',999);}else if(old<=0&&p.health>0){banner('НАПАРНИК РЯДОМ','СНОВА В СТРОЮ','',3);}else if(p.health<old){damageTime=.3;sound('hurt');const ne=nearestEnemy(player.pos);if(ne&&old-p.health>1)overlay.hurtFrom(dirAngle(ne.mesh.position));}if(p.mini&&!minigunUntil){dropWave=p.mini;grantMinigun();}}else{const q=ensureMate(p.id,p.name);q.pos.fromArray(p.p);q.yaw=p.yaw;q.health=p.health;q.weapon=p.weapon;}}
  const ids=new Set();for(const e of m.enemies){if(!validVector(e.p))continue;ids.add(e.id);let local=enemies.find(q=>q.id===e.id);if(!local){const type=['walker','runner','brute','exploder','boss'].includes(e.type)?e.type:'walker',mesh=makeZombie(type,e.id);dressZombie(mesh,radio.state.program,e.prize);local={id:e.id,type,mesh,hp:e.hp,maxHp:e.mx||e.hp,target:new THREE.Vector3(...e.p),step:0};mesh.traverse(o=>{if(o.isMesh)o.userData.enemy=local;});mesh.position.fromArray(e.p);scene.add(mesh);enemies.push(local);}local.target=new THREE.Vector3(...e.p);if(e.hp<local.hp)local.flash=.12;local.hp=e.hp;if(e.mx)local.maxHp=e.mx;local.mesh.rotation.y=e.r;}
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
function loop(now,background=false){if(!background)requestAnimationFrame(loop);const dt=Math.min(.05,(now-previous)/1000);previous=now;time+=dt;animateWorld(world.props,time);updateWorldFx(dt);
  if(phase==='menu'){radio.preview(time);camera.position.set(5+Math.sin(time*.09)*.7,2.65,14);camera.lookAt(-1,1.7,-16);for(const w of Object.values(weapons))w.mesh.visible=false;decor.forEach((d,i)=>{d.rotation.y=.3+Math.sin(time*.2+i)*.1;d.userData.leftArm.rotation.x=-.8+Math.sin(time+i)*.1;d.userData.rightArm.rotation.x=-.9;});}
  if(phase==='active'||phase==='break'){
    shootCooldown=Math.max(0,shootCooldown-dt);shotKick=Math.max(0,shotKick-dt*.7);shake=Math.max(0,shake-dt*.9);damageTime=Math.max(0,damageTime-dt);hitTime=Math.max(0,hitTime-dt);bannerTime=Math.max(0,bannerTime-dt);toastTime=Math.max(0,toastTime-dt);$('damage').style.opacity=damageTime>0?.6:player.health<30?.12+Math.sin(time*7)*.08:0;$('hitmarker').style.opacity=hitTime>0?1:0;if(hitTime<=0)$('hitmarker').classList.remove('kill');$('banner').style.opacity=bannerTime>0?1:0;$('toast').style.opacity=toastTime>0?1:0;
    updateReload(dt);
    radio.tick(dt,phase==='active');
    flash.visible=shootCooldown>weapons[current].rate-.04&&current!=='rpg'&&flash.visible;weaponLight.intensity=flash.visible?8:0;updatePlayer(dt);if(shooting&&!coopPaused)fire();updateCoop(dt);
    navTime-=dt;if(navTime<=0){navigator.update(player.pos.x,player.pos.z);for(const q of squad.values())q.nav?.update(q.pos.x,q.pos.z);navTime=.5;}if(Object.values(weapons).every(w=>w.mag+w.reserve===0)){emptyTime+=dt;if(emptyTime>=5){weapons.ak.reserve=30;emptyTime=0;toast('АВАРИЙНЫЙ ЗАПАС · +30 ПАТРОНОВ',3);sound('pickup');}}else emptyTime=0;
    if(net.role!=='client'&&phase==='active'){spawnTimer-=dt;if(spawned<config.count&&spawnTimer<=0&&enemies.length<(config.maxAlive||75)){spawnEnemy();spawnTimer=config.spawnInterval;}updateEnemies(dt);}else if(net.role!=='client'&&phase==='break'){breakTime-=dt;$('bannerSub').textContent=`Следующая волна через ${Math.ceil(breakTime)} с · E — начать сейчас`;if(breakTime<=0)nextWave();}
    if(phase!=='gameover'){updateProjectiles(dt);updateRocks(dt);grenades.update(dt,net.role!=='client');updateEffects(dt);}updateDrop(dt);updateRegen(dt);hudTime+=dt;if(hudTime>.2){hudTime=0;updateHUD();}
  }
  renderer.render(scene,camera);
}
// Test hooks, only with ?debug=1 in the address bar.
if(new URLSearchParams(window.location.search).get('debug')==='1')window.__outpost={
  get state(){return {phase,wave,waveEvent,combo,score,kills,current,health:Math.round(player.health),count:config.count,boss:config.boss,enemies:enemies.map(e=>({type:e.type,hp:Math.round(e.hp),maxHp:Math.round(e.maxHp||0)})),ammo:Object.fromEntries(Object.entries(weapons).map(([k,w])=>[k,[w.mag,w.reserve]]))};},
  jump(n){for(const e of enemies){scene.remove(e.mesh);disposeZombie(e.mesh);}enemies.length=0;wave=n-1;phase='active';nextWave();spawnTimer=0;},
  spawn(type){forcedType=type;spawnEnemy();return enemies.at(-1)?.type;},
  event(key){setWaveEvent(key);applyEventToConfig();announceProgram();},
  god(){player.health=100000;},
  weapon(name){setWeapon(name);return current;},
  shootAt(type){const e=enemies.filter(q=>q.type===type).sort((a,b)=>a.mesh.position.distanceTo(player.pos)-b.mesh.position.distanceTo(player.pos))[0]||enemies[0];if(!e)return null;if(e.target)e.mesh.position.copy(e.target);const head=e.mesh.position.clone();head.y=(e.type==='boss'?2.9:1.25);const d=head.sub(player.pos);player.yaw=Math.atan2(-d.x,-d.z);player.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));updatePlayer(0);camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);shootCooldown=0;reloadTime=0;const before=e.hp;fire();return {type:e.type,before:Math.round(before),after:Math.round(e.hp),alive:enemies.includes(e)};},
  near(type,dist=5){const e=enemies.find(q=>q.type===type);if(!e)return null;if(phase==='paused')phase=beforePause;$('pause').hidden=true;e.mesh.position.set(player.pos.x-Math.sin(player.yaw)*dist,0,player.pos.z-Math.cos(player.yaw)*dist);return e.mesh.position.toArray().map(Math.round);},
  arrange(dist=6){const s=Math.sin(player.yaw),c=Math.cos(player.yaw);enemies.forEach((e,i)=>{const off=(i-(enemies.length-1)/2)*1.9;e.mesh.position.set(player.pos.x-s*dist+c*off,0,player.pos.z-c*dist-s*off);e.mesh.rotation.y=player.yaw;});phase='paused';$('pause').hidden=true;bannerTime=0;$('banner').style.opacity=0;return enemies.length;},
  run(sec=1){let t=previous;for(let i=0;i<Math.round(sec*60);i++){t+=1000/60;loop(t,true);}return {phase,health:Math.round(player.health),enemies:enemies.length};},
  perk(id){player.perks[id]=(player.perks[id]||0)+1;pipKey='';updateHUD();return mods();},
  offer(){offerPerks();return perkChoice;},
  slam(){const b=enemies.find(e=>e.type==='boss');if(!b)return null;const h=player.health;bossSlam(b);return {before:h,after:player.health};},
};
try{renderer.compile(scene,camera);$('loading').hidden=true;requestAnimationFrame(loop);}catch(e){$('loadingText').textContent='Не удалось запустить 3D. Попробуй обновить страницу в Chrome или Edge.';console.error(e);}
