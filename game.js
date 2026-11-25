import * as THREE from './vendor/three.module.js';
import {buildWorld,animateWorld} from './world.js';
import {createZombie,createWeapon,createRocket,createMinigun,createSoldier} from './models.js';
import {waveConfig,enemyStats,blastDamage,bestWave,WAVE_EVENTS,DIFFICULTY,DEFAULT_DIFFICULTY,ENEMY_TYPES,BOSS_TYPES,ENEMY_INFO,MINIGUN_BOSS_MULT,ALIVE_EXTRA,pickEnemyType as pickMixType} from './rules.js';
import {getWave,actFor,CAMPAIGN_LENGTH,VICTORY,ENDLESS_INTRO,MAYAK,DUCK,UNLOCKS,bossName,bossTitle} from './campaign.js';
import {createPostFx,gradeFor} from './postfx.js';
import {createAudio} from './audio.js';
import {createNetwork} from './network.js';
import {createAirdrop} from './airdrop.js';
import {createRadio, programs, dressZombie, dancePose} from './radio.js';
import {createGrenades} from './grenades.js';
import {createNavigator} from './navigation.js';
import {PERKS,perkMods,sanitizePerks,rollPerks} from './perks.js';
import {createFx} from './fx.js';
import {createOverlay} from './overlay.js';
import {loadSave,writeSave,recordWave,maxStart,startPerks,hasBuild,perkCount,clampWave} from './save.js';

const $=id=>document.getElementById(id), canvas=$('game');
const coarse=matchMedia('(pointer:coarse)').matches;
// Player settings persist in localStorage (wrapped: storage can be blocked). Legacy v3 keys are read once.
const QUALITIES=['low','medium','high'],settings={sound:true,sensitivity:1,master:80,sfx:90,music:60,fov:78,quality:coarse?'medium':'high',shadows:true,damageNumbers:true,difficulty:DEFAULT_DIFFICULTY};
try{const legacySound=localStorage.getItem('outpost.sound'),legacySens=Number(localStorage.getItem('outpost.sensitivity'));if(legacySound!==null)settings.sound=legacySound!=='false';if(legacySens>0)settings.sensitivity=legacySens;const s=JSON.parse(localStorage.getItem('outpost.settings')||'{}')||{};const num=(k,lo,hi)=>{const n=Number(s[k]);if(s[k]!==undefined&&Number.isFinite(n))settings[k]=Math.max(lo,Math.min(hi,n));};num('sensitivity',.3,2.2);num('master',0,100);num('sfx',0,100);num('music',0,100);num('fov',70,100);for(const k of ['sound','shadows','damageNumbers'])if(typeof s[k]==='boolean')settings[k]=s[k];if(QUALITIES.includes(s.quality))settings.quality=s.quality;if(DIFFICULTY[s.difficulty])settings.difficulty=s.difficulty;}catch{}
function saveSettings(){try{localStorage.setItem('outpost.settings',JSON.stringify(settings));}catch{}}
let renderer;
// Anti-aliasing comes from the post-processing MSAA targets, so the default framebuffer skips it.
try {renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});} catch(e) {$('loadingText').textContent='Для игры нужен WebGL. Открой ссылку в Chrome или Edge с включённым аппаратным ускорением.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,coarse?1.4:1.65));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.06,230);
camera.rotation.order='YXZ';scene.add(camera);
const world=buildWorld(scene,{quality:settings.quality,onThunder:e=>sound('thunder',{volume:Math.min(1,Number(e.intensity)||1),distance:(Number(e.distance)||20)/40})}),raycaster=new THREE.Raycaster(),v=new THREE.Vector3();
// Tactical flashlight: the only shadow caster, so zombies throw long shadows in its beam.
renderer.shadowMap.enabled=!coarse;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
scene.traverse(o=>{if(o.isMesh||o.isInstancedMesh)o.receiveShadow=true;});
const flashlight=new THREE.SpotLight(0xfff0d8,14,40,.44,.55,1.6);flashlight.position.set(.18,-.12,.1);flashlight.castShadow=!coarse&&settings.shadows;flashlight.shadow.mapSize.set(1024,1024);flashlight.shadow.camera.near=.3;flashlight.shadow.camera.far=44;flashlight.shadow.bias=-.0015;camera.add(flashlight);
const flashTarget=new THREE.Object3D();flashTarget.position.set(0,-.35,-6);camera.add(flashTarget);flashlight.target=flashTarget;
let flashlightOn=true;
// Post-processing (bloom + grade). If it cannot start, the game renders directly.
let postfx=null;try{postfx=createPostFx(renderer,scene,camera,{quality:settings.quality});}catch(e){console.warn('Post-processing unavailable, rendering directly:',e);postfx=null;}
let postfxBypass=false;
function render(dt){if(postfx&&!postfxBypass){try{postfx.render(dt);return;}catch(e){console.error('Post-processing failed, rendering directly:',e);try{postfx.dispose();}catch{}postfx=null;renderer.setRenderTarget(null);renderer.setSize(innerWidth,innerHeight);}}renderer.render(scene,camera);}
function applyQuality(q){settings.quality=QUALITIES.includes(q)?q:'high';world.setQuality(settings.quality);if(postfx)postfx.setQuality(settings.quality);else renderer.setPixelRatio(settings.quality==='low'?1:Math.min(devicePixelRatio,coarse?1.4:1.65));}
function toggleFlashlight(){flashlightOn=!flashlightOn;flashlight.visible=flashlightOn;sound('switch',{rate:1.6});toast(flashlightOn?'ФОНАРИК ВКЛЮЧЁН':'ФОНАРИК ВЫКЛЮЧЕН',1);}
const navigator=createNavigator(world.colliders);
let navTime=0,emptyTime=0;
const weapons={minigun:{mesh:createMinigun(),mag:0,reserve:0,capacity:1200,reload:0,rate:.042},ak:{mesh:createWeapon('ak'),mag:30,reserve:180,capacity:30,reload:1.85,rate:.105},rpg:{mesh:createWeapon('rpg'),mag:1,reserve:6,capacity:1,reload:2.65,rate:.9},shotgun:{mesh:createWeapon('shotgun'),mag:6,reserve:30,capacity:6,reload:2.1,rate:.78},smg:{mesh:createWeapon('smg'),mag:0,reserve:0,capacity:64,reload:1.9,rate:.055},svd:{mesh:createWeapon('svd'),mag:0,reserve:0,capacity:10,reload:2.3,rate:.45}};
const WEAPON_LIST=Object.entries(weapons);
// Slot order = number keys 1–6. smg/svd unlock at their campaign wave (UNLOCKS) and get their starting ammo then.
const WEAPON_NAMES={ak:'АК-47',shotgun:'ДРОБОВИК',smg:'ПП «БИЗОН»',svd:'СВД',rpg:'РПГ-7',minigun:'МИНИГАН'},WEAPON_KEYS=['ak','shotgun','smg','svd','rpg','minigun'];
const SLOT_IDS={ak:'slotAk',shotgun:'slotShotgun',smg:'slotSmg',svd:'slotSvd',rpg:'slotRpg',minigun:'slotMini'},WEAPON_START={smg:[64,192],svd:[10,30]},granted=new Set();
const BOSS_SET=new Set([...BOSS_TYPES,'titan']),ALL_TYPES=new Set([...ENEMY_TYPES,...BOSS_SET]);
const LEGACY_ANIM=new Set(['walker','runner','brute','exploder','boss']);
const RADIUS={boss:.9,titan:.9,father:1.4,brood:1.1,butcher:.7,brute:.65,armored:.5,crawler:.45},ROCKET_R={boss:2.4,titan:2.4,father:3.2,brood:2.6,butcher:1.8,brute:1.4,armored:1.1,crawler:.8};
const SCORE={brute:180,runner:120,exploder:150,crawler:90,spitter:140,screamer:170,armored:200,boss:3000,titan:3000,brood:3500,butcher:3500,father:10000};
const ENRAGE_HINT={boss:'Быстрее, бьёт чаще и зовёт орду. Цель — голова.',brood:'Рожает чаще, кислоты больше. Бей по светящимся мешкам.',butcher:'Быстрее и злее. Не стой на линии крюка.'};
const EVAC_TIME=14;
function enemyName(t){return BOSS_SET.has(t)?bossName(t).toUpperCase():ENEMY_INFO[t]?.name||'Зомби';}
function slotOpen(k){return k==='minigun'?!!minigunUntil:k in UNLOCKS?wave>=UNLOCKS[k]:true;}
function hasWeapon(k){return !!weapons[k]&&slotOpen(k);}
const SHOTGUN_PELLETS=9,AMMO_CAP={ak:420,shotgun:72,rpg:18,smg:448,svd:90},DAMAGE={ak:[34,85],minigun:[60,140],shotgun:[17,36],smg:[20,48],svd:[150,420]};
// Ammo shares: wave end and ammo crates refill every weapon the player already has (never lowers a reserve).
const REFILL={wave:{ak:110,shotgun:12,rpg:3,smg:96,svd:10},pickup:{ak:45,shotgun:8,rpg:1,smg:48,svd:5}},SHOT_SOUND={rpg:'rocket',minigun:'minigun',smg:'smg',svd:'svd'};
// Host-side fire-rate gate for guests: a token bucket per mate (refill 1 per REMOTE_RATE s = 80% of the
// real interval, capacity REMOTE_BURST) so shots bunched by network jitter are not dropped.
const REMOTE_RATE={rpg:.72,shotgun:.62,minigun:.034,ak:.084,smg:.044,svd:.36},REMOTE_BURST={rpg:2,shotgun:2,svd:2,ak:3,smg:3,minigun:3};
// Hard cap on living enemies for every non-boss spawn path (waves, packs, births, summons); bosses always spawn.
// Clients accept up to SNAP_ENEMIES per snapshot (cap + bosses + slack) and clamp instead of dropping it.
const SNAP_ENEMIES=128;function aliveCap(){return (config.maxAlive||75)+ALIVE_EXTRA;}
function refillAmmo(kind){const t=REFILL[kind];if(!t)return;for(const k in t){const w=weapons[k];if(!w||k in UNLOCKS&&!hasWeapon(k))continue;const add=k==='ak'&&kind==='wave'?t.ak+Math.min(wave,40)*15:t[k];w.reserve=Math.max(w.reserve,Math.min(AMMO_CAP[k],w.reserve+add));}}
function pickupText(){return ['БОЕПРИПАСЫ','+45 АК','+8 ДРОБЬ','+1 РАКЕТА',...(hasWeapon('smg')?['+48 ПП']:[]),...(hasWeapon('svd')?['+5 СВД']:[])].join(' · ');}
for(const w of Object.values(weapons)){camera.add(w.mesh);w.mesh.visible=false;w.mesh.traverse(o=>{if(o.isMesh){o.castShadow=false;o.frustumCulled=false;}});}
const weaponLight=new THREE.PointLight(0xffae59,0,5);weaponLight.position.set(.3,-.1,-1.1);camera.add(weaponLight);
const flash=new THREE.Mesh(new THREE.IcosahedronGeometry(.12,0),new THREE.MeshBasicMaterial({color:0xffd477,transparent:true,opacity:.95,depthWrite:false}));flash.visible=false;camera.add(flash);
// Downed state (host-authoritative, synced in snapshots): down = health 0; out = bled out until the wave ends.
const player={perks:{},stats:newStats(),lastHurt:-99,sprinting:false,exhausted:false,down:false,out:false,bleed:0,revive:0,reviver:null,selfT:0,secondUsed:false,grace:0,moveSpeed:0,pos:new THREE.Vector3(0,1.72,12),yaw:0,pitch:0,health:100,stamina:100,vy:0,grounded:true,grenades:3,lastGrenade:-99};
let phase='menu',beforePause='active',wave=0,config=waveConfig(1),spawned=0,waveKills=0,kills=0,score=0,current='ak',shootCooldown=0,reloadTime=0,reloadingWeapon=null,breakTime=0,spawnTimer=0,shotKick=0,shake=0,damageTime=0,hitTime=0,bannerTime=0,toastTime=0,time=0,aim=false,shooting=false,dragLook=false,lockUnavailable=false;
let soundOn=settings.sound,sensitivity=settings.sensitivity,best=0,wins=0,difficulty=settings.difficulty;
// world.js owns fog/sky/light: time of day + weather per wave, wave events as a tint on top.
// The event's gameplay multipliers are already inside waveConfig (do not apply them again).
let waveEvent=null,combo=0,comboTime=0,bossesSpawned=0,bossQueue=[],massKill=false,evacTime=0,heli=null,heliLoop=null,envTod=0,envWeather='clear',objKind='';
const gradeObj={};
function setWaveEvent(key){waveEvent=key&&WAVE_EVENTS[key]?key:null;world.setEventTint(waveEvent?WAVE_EVENTS[waveEvent]:null);updateGrade();}
function updateGrade(instant=false){if(postfx)postfx.setGrade(gradeFor(envTod,waveEvent,envWeather,gradeObj),instant);}
function updateAmbience(){const w=phase==='menu'?'clear':envWeather;audioEngine.setAmbience(w==='storm'?'storm':w==='rain'?'rain':'none',w==='storm'?1:.8);}
function applyWaveEnvironment(def,instant=false){envTod=Number.isFinite(def?.tod)?def.tod:0;envWeather=def?.weather||'clear';world.setTimeOfDay(envTod,instant);world.setWeather(envWeather,instant);updateAmbience();updateGrade(instant);}
// Zombie variants reuse the base rigs with per-instance materials so hits can flash.
const zombieTints={exploder:{emissive:0x1f5a10,glow:.35},boss:{emissive:0x3a0804,glow:.45},father:{emissive:0x3a0804,glow:.45}};
const sacGeo=new THREE.IcosahedronGeometry(.27,1),sacMat=new THREE.MeshStandardMaterial({color:0xb6ff5c,emissive:0x7dff2a,emissiveIntensity:1.6,roughness:.4});
function makeZombie(type,id=0){
  const mesh=createZombie(type,id%3),cache=new Map(),flashMats=[];
  mesh.traverse(o=>{if(!o.isMesh)return;let m=cache.get(o.material);if(!m){m=o.material.clone();cache.set(o.material,m);if(m.emissive&&m.emissive.getHex()===0)flashMats.push(m);}o.material=m;});
  // Per-instance tone jitter so a horde never looks copy-pasted.
  const tint=zombieTints[type],jitter=((id*2654435761)>>>0)/4294967296;
  for(const m of flashMats){if(tint){m.emissive.set(tint.emissive);m.emissiveIntensity=tint.glow;}m.color.setHSL(.08+(jitter-.5)*.1,.06+jitter*.1,.78+jitter*.14);m.userData.baseEmissive=m.emissive.clone();m.userData.baseGlow=m.emissiveIntensity;}
  if(type==='exploder')mesh.userData.sac=mesh.userData.torso;
  const glowMats=[...cache.values()].filter(m=>!flashMats.includes(m)&&m.emissive&&m.emissive.getHex()!==0);for(const m of glowMats){m.userData.baseEmissive=m.emissive.clone();m.userData.baseGlow=m.emissiveIntensity;}
  mesh.userData.type=type;mesh.userData.flashMats=flashMats;mesh.userData.glowMats=glowMats;mesh.userData.ownMats=[...cache.values()];
  return mesh;
}
function disposeZombie(mesh){for(const m of mesh.userData?.ownMats||[])m.dispose();}
function updateFlash(e,dt){const mats=e.mesh.userData.flashMats;if(!mats||!(e.flash>0||e.flashOn))return;e.flash=Math.max(0,(e.flash||0)-dt);const on=e.flash>0;for(const m of mats){if(on){m.emissive.setRGB(1,.38,.28);m.emissiveIntensity=.12+e.flash*3;}else{m.emissive.copy(m.userData.baseEmissive);m.emissiveIntensity=m.userData.baseGlow;}}e.flashOn=on;}
function updateWorldFx(dt){
  if(net.role!=='client'&&comboTime>0){comboTime-=dt;if(comboTime<=0)combo=0;}
  sacMat.emissiveIntensity=1.3+Math.sin(time*9)*.7;
  for(const e of enemies){updateFlash(e,dt);updateGlow(e);const sac=e.mesh.userData.sac;if(sac)sac.scale.setScalar(1+Math.sin(time*10+e.id)*.05);}
  fx.update(dt);overlay.update(dt);
  groanCd-=dt;if(groanCd<=0&&enemies.length&&phase==='active'){groanCd=.7+Math.random()*1.4;const e=enemies[Math.floor(Math.random()*enemies.length)],d=e.mesh.position.distanceTo(player.pos);if(d<30&&!radio.dancing(e.mesh.position))sound(e.boss?'roar':'groan',{distance:d*.6,rate:e.type==='brute'?.75:e.type==='runner'?1.2:.9+Math.random()*.2,volume:e.boss?.6:.8});}
  // Low HP: desaturation + heartbeat rim in postfx; the CSS filter is only the no-postfx fallback.
  const ingame=phase!=='menu'&&phase!=='victory'&&player.health>0;
  const scopeOn=ingame&&scoped();
  if(postfx){postfx.setLowHealth(ingame?Math.max(0,Math.min(1,(35-player.health)/30)):0);postfx.setScope(scopeOn);}
  else{const lowHp=ingame&&player.health<30;if(lowHp!==lowHpFx){lowHpFx=lowHp;canvas.style.filter=lowHp?'saturate(.35) contrast(1.1)':'';}}if($('scope').hidden===scopeOn)$('scope').hidden=!scopeOn;
  acidFx=Math.max(0,acidFx-dt);screamFx=Math.max(0,screamFx-dt);const acidOn=ingame&&acidFx>0,screamOn=ingame&&screamFx>0;if($('acidOverlay').hidden===acidOn)$('acidOverlay').hidden=!acidOn;if($('screamOverlay').hidden===screamOn)$('screamOverlay').hidden=!screamOn;
}
// Boss bar: all living bosses share one bar (sum of HP); phase pips follow the first boss.
function bossPhaseOf(e){const f=e.hp/(e.maxHp||e.hp||1);return e.type==='father'?(f>2/3?0:f>1/3?1:2):(f>.5?0:1);}
function updateBossHUD(){const bosses=enemies.filter(e=>e.boss),bar=$('bossBar');bar.hidden=!bosses.length;if(bosses.length){let hp=0,mx=0;for(const b of bosses){hp+=Math.max(0,b.hp);mx+=b.maxHp||b.hp||1;}$('bossFill').style.width=Math.max(0,Math.min(100,hp/(mx||1)*100))+'%';const types=[...new Set(bosses.map(b=>b.type))];$('bossName').textContent=(types.length===1&&bosses.length>1?`${bossName(types[0])} ×${bosses.length}`:types.map(bossName).join(' + ')).toUpperCase();const lead=bosses[0],phases=lead.type==='father'?3:2,ph=bossPhaseOf(lead);bar.dataset.phases=phases;[...$('bossPhase').children].forEach((pip,i)=>{pip.hidden=i>=phases;pip.classList.toggle('done',i<ph);pip.classList.toggle('active',i===ph);});bar.classList.toggle('enraged',ph===phases-1);}$('eventTag').hidden=!waveEvent||phase!=='active';if(waveEvent)$('eventTag').textContent='СОБЫТИЕ · '+WAVE_EVENTS[waveEvent].title.toUpperCase();$('combo').hidden=combo<3;if(combo>=3)$('combo').textContent=`СЕРИЯ ×${combo}`;}
try {best=Number(localStorage.getItem('outpost.best'))||0;wins=Math.max(0,Math.floor(Number(localStorage.getItem('outpost.wins'))||0));}catch{}
$('sound').checked=soundOn;$('sensitivity').value=sensitivity;$('sensitivityValue').value=sensitivity.toFixed(1);
for(const [id,k] of [['volMaster','master'],['volSfx','sfx'],['volMusic','music']]){$(id).value=settings[k];$(id+'Value').value=String(Math.round(settings[k]));}
$('fov').value=settings.fov;$('fovValue').value=Math.round(settings.fov)+'°';$('quality').value=settings.quality;$('shadowsToggle').checked=settings.shadows;$('damageNumbersToggle').checked=settings.damageNumbers;
function renderProgress(){$('record').textContent=`ВОЛНА ${String(best).padStart(2,'0')}`;$('campaignBest').textContent=String(Math.min(best,CAMPAIGN_LENGTH)).padStart(2,'0');$('campaignWins').textContent=wins;document.querySelector('.campaign')?.style.setProperty('--best',Math.min(best,CAMPAIGN_LENGTH));}
renderProgress();
// ---- Save / continue: every player saves their build at each wave they reach (save.js). The host picks
// the start wave for the squad; each player restores their own build for it (random top-up if missing).
const progress=loadSave();let startWave=maxStart(progress,best),hostStart=1,runStart=1;
function saveProgress(w){if(recordWave(progress,w,player.perks))writeSave(progress);}
function waveLabel(w){const d=getWave(w);return `НОЧЬ ${String(w).padStart(2,'0')} · ${String(d.title||'').toUpperCase()}${d.boss?.length?' ☠':''}`;}
function buildNote(w){const act=actFor(w).label+(getWave(w).boss?.length?' · БОСС':'')+'. ';if(w<=1)return act+'Новая кампания: без усилений, АК, дробовик и РПГ.';const n=perkCount(startPerks(progress,w,()=>0)),guns=['АК','дробовик','РПГ',...Object.keys(UNLOCKS).filter(k=>w>=UNLOCKS[k]).map(k=>WEAPON_NAMES[k])];return act+`Усилений: <b>${n}</b> · ${hasBuild(progress,w)?'твой сохранённый набор':'часть выдаётся случайно (ты не доходил сюда сам)'}. Оружие: ${guns.join(', ')}.`;}
function fillWaves(sel,list,top){const key=list.join(',')+':'+top;if(sel.dataset.key===key)return;sel.dataset.key=key;sel.replaceChildren(...list.map(w=>{const o=document.createElement('option');o.value=String(w);o.textContent=(w===1?'★ НОВАЯ ИГРА · ':w===top&&top>1?'▶ ':'')+waveLabel(w);return o;}));}
function renderStartWave(){const top=maxStart(progress,best);startWave=Math.min(clampWave(startWave),top);const all=[];for(let w=top;w>=1;w--)all.push(w);const client=net.role==='client',shown=client?hostStart:startWave;
  fillWaves($('startWave'),all,top);$('startWave').value=String(startWave);fillWaves($('coopStartWave'),client?[hostStart]:all,client?0:top);$('coopStartWave').value=String(shown);$('coopStartWave').disabled=client;
  $('startWaveInfo').innerHTML=buildNote(startWave);$('coopStartInfo').innerHTML=(client?`Ведущий начнёт с ночи <b>${String(hostStart).padStart(2,'0')}</b>. `:'')+buildNote(shown);
  $('start').querySelector('small').textContent=startWave>1?`Продолжение · с ночи ${String(startWave).padStart(2,'0')}`:'Кампания · шесть актов · тридцать ночей';}
function chooseStartWave(v){if(net.role==='client')return;startWave=clampWave(v);renderStartWave();sound('ui');if(net.role==='host')net.broadcast({t:'sw',w:startWave});}
// Build for a run that starts at wave w > 1: saved perks, full health, grenades as if each pack perk was picked.
function applyStartBuild(w){player.perks=startPerks(progress,w);perkWave=w-1;player.health=maxHealth(player);player.grenades=Math.min(5+mods().grenades,3+2*(player.perks.pack||0));pipKey='';}
const keys=new Set(),enemies=[],dead=[],rockets=[],effects=[],pickups=[],decor=[];
const grenades=createGrenades(scene,world.colliders,(pos,owner)=>explode(pos,false,{owner:owner||null}));
let grenadeRequest=0;
const audioEngine=createAudio();audioEngine.setVolumes({master:settings.master/100,sfx:settings.sfx/100,music:settings.music/100});
const radio=createRadio(scene,sound);
const fx=createFx(scene,(kind,options)=>sound(kind,options)),overlay=createOverlay(camera);
function initAudio(){audioEngine.setEnabled(soundOn);audioEngine.init();}
function sound(kind,options){audioEngine.setEnabled(soundOn);audioEngine.play(kind,options);}
function toast(message,duration=2.4){$('toast').textContent=message;toastTime=duration;$('toast').style.opacity=1;}
// The wave intro card sits where the banner is: banners raised during the intro are queued and shown
// one after another once it ends (boss/event/program banner, then e.g. the weapon unlock).
function banner(label,title,sub,duration=3){if(introTime>0){if(bannerQueue.length<4)bannerQueue.push([label,title,sub,duration]);return;}showBanner(label,title,sub,duration);}
function showBanner(label,title,sub,duration){$('bannerLabel').textContent=label;$('bannerTitle').textContent=title;$('bannerSub').textContent=sub;bannerTime=duration;$('banner').style.opacity=1;}
function nextBanner(){if(introTime<=0&&bannerTime<=0&&bannerQueue.length)showBanner(...bannerQueue.shift());}
function saveBest(){best=bestWave(best,Math.min(wave,9999));try{localStorage.setItem('outpost.best',best);}catch{}renderProgress();}
// ---- Wave intro card + radio subtitles (typewriter, auto-advancing queue) ----
let introTime=0,radioCur=null;const radioQueue=[],bannerQueue=[];
function showIntro(label,title,duration=3.6){const c=$('introCard');$('introAct').textContent=label;$('introTitle').textContent=title;c.classList.remove('out');c.hidden=true;void c.offsetWidth;c.hidden=false;introTime=duration;bannerTime=0;bannerQueue.length=0;$('banner').style.opacity=0;}
function hideIntro(){introTime=0;bannerQueue.length=0;$('introCard').hidden=true;$('introCard').classList.remove('out');}
function radioSay(who,text,hold){if(text)radioQueue.push({who:who||null,text:String(text),hold});}
function radioClear(){radioQueue.length=0;radioCur=null;const box=$('radioBox');box.hidden=true;box.classList.remove('done','out');}
function updateIntro(dt){if(introTime<=0)return;introTime-=dt;const c=$('introCard');if(introTime<=.35&&!c.classList.contains('out'))c.classList.add('out');if(introTime<=0){c.hidden=true;c.classList.remove('out');introTime=0;bannerTime=0;nextBanner();}}
function updateRadioBox(dt){
  const box=$('radioBox');
  if(!radioCur){if(!radioQueue.length)return;radioCur={...radioQueue.shift(),shown:0,t:0,end:0,out:false};box.hidden=false;box.classList.remove('done','out');box.dataset.who=radioCur.who===DUCK?'duck':'mayak';$('radioWho').textContent=(radioCur.who||'ЭФИР').toUpperCase();$('radioText').textContent='';if(radioCur.who===MAYAK||radioCur.who===DUCK)sound('ui',{volume:.35,rate:radioCur.who===DUCK?1.25:.8});}
  const c=radioCur;c.t+=dt;
  if(c.shown<c.text.length){const n=Math.min(c.text.length,Math.floor(c.t*52));if(n!==c.shown){c.shown=n;$('radioText').textContent=c.text.slice(0,n);}if(c.shown>=c.text.length){box.classList.add('done');c.end=c.t+(c.hold??Math.max(2.4,c.text.length*.038));}return;}
  if(!c.out&&c.t>=c.end){c.out=true;box.classList.add('out');c.end=c.t+.3;return;}
  if(c.out&&c.t>=c.end){radioCur=null;box.classList.remove('done','out');if(!radioQueue.length)box.hidden=true;}
}
// ---- Gunplay: per-weapon spread, bloom, recoil and reload behaviour ----
const GUN={
  ak:{hip:.014,ads:.003,bloom:.004,bloomMax:.032,kickV:.012,kickH:.007,recover:.6,pen:1,tac:1.7,empty:2.3,chamber:true,shell:'rifle'},
  shotgun:{hip:.075,ads:.05,bloom:0,bloomMax:0,kickV:.055,kickH:.02,recover:.7,pen:0,pellets:9,shellFirst:.35,shellEach:.47,shell:'shell'},
  minigun:{hip:.026,ads:.02,bloom:.0007,bloomMax:.03,kickV:.0035,kickH:.004,recover:.8,pen:2,shell:'rifle'},
  rpg:{hip:0,ads:0,bloom:0,bloomMax:0,kickV:.07,kickH:.01,recover:.7,pen:0,tac:2.6,empty:2.6,adsRate:9},
  smg:{hip:.02,ads:.006,bloom:.003,bloomMax:.03,kickV:.006,kickH:.005,recover:.7,pen:0,tac:1.9,empty:2.5,chamber:true,shell:'rifle',adsRate:14},
  // СВД: semi-auto (one shot per click), wild from the hip, a laser once scoped (FOV 30).
  svd:{hip:.03,ads:.0005,bloom:.008,bloomMax:.03,kickV:.06,kickH:.012,recover:.55,pen:3,tac:2.3,empty:2.9,chamber:true,semi:true,shell:'rifle',adsRate:8},
};
const BASE_CAP={ak:30,shotgun:6,smg:64,svd:10},MAG_PERK=new Set(['ak','shotgun']),ADS={ak:[0,.143],shotgun:[0,.17],rpg:[-.055,.09],minigun:[.2,0],smg:[0,.18],svd:[0,.14]},SVD_FOV=30;
const AMMO_LABEL={ak:'7.62 × 39 ММ · АВТО',smg:'9 × 18 ММ · АВТО',svd:'7.62 × 54R · ПОЛУАВТОМАТ',rpg:'РЕАКТИВНАЯ ГРАНАТА'};
// First-person view-model state. All pose inputs are blends in 0..1 that ease toward their target,
// so no state change (sprint, ADS, reload, weapon switch, landing, downed) snaps the camera or weapon.
const VM={sprint:0,ads:0,move:0,reload:0,down:0,step:0,land:0,landT:9,sw:0,speed:0,rp:0,rw:null,empty:false,adsFov:60};
const EXHAUST_RECOVER=25,SWITCH_LOWER=.2,SWITCH_RAISE=.25,LAND_T=.32;
let swapTo=null,semiReady=false,wheelT=0;
function resetVM(){Object.assign(VM,{sprint:0,ads:0,move:0,reload:0,down:0,step:0,land:0,landT:9,sw:0,speed:0,rp:0,rw:null,empty:false,adsFov:settings.fov*.72});swapTo=null;semiReady=false;}
const blendK=(dt,rate)=>1-Math.exp(-Math.max(0,dt)*rate),sstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);},plateau=(p,a,b)=>sstep(0,a,p)*(1-sstep(b,1,p)),bump=(p,a,b)=>p>a&&p<b?Math.sin((p-a)/(b-a)*Math.PI):0;
function switching(){return !!swapTo&&(current!==swapTo||VM.sw>.3);}
function scoped(){return aim&&current==='svd'&&!swapTo&&VM.ads>.8&&player.health>0&&!(reloadTime>0&&reloadingWeapon==='svd')&&(phase==='active'||phase==='break');}
function aimSens(){return !aim?1:current==='svd'&&VM.ads>.5?.32:.62;}
let bloom=0,recoilDebtV=0,recoilDebtH=0,reloadTotal=0,swayX=0,swayY=0,shotsFired=0,shotsHit=0,headshots=0,perkChoice=null,perkShown=null,perkOwed=0,perkWave=0,pipKey='',pipMag=-1,groanCd=2,lowHpFx=false;
function mods(who=player){return perkMods(who?.perks||{});}
function capacity(name,who=player){const b=BASE_CAP[name];return b?(MAG_PERK.has(name)?Math.round(b*mods(who).mag):b):weapons[name].capacity;}
function currentSpread(){const g=GUN[current];return ((g.hip+(g.ads-g.hip)*VM.ads)+bloom+Math.min(.03,(player.moveSpeed||0)*.0028)+(player.grounded?0:.03))*mods().spread;}
function updateRecoil(dt){bloom=Math.max(0,bloom-dt*(shooting?.015:.08));const k=Math.min(1,dt*(shooting?2.5:7)),rv=recoilDebtV*k,rh=recoilDebtH*k;player.pitch-=rv;player.yaw-=rh;recoilDebtV-=rv;recoilDebtH-=rh;swayX*=Math.max(0,1-dt*9);swayY*=Math.max(0,1-dt*9);}
function updateReload(dt){
  if(reloadTime<=0||!reloadingWeapon){$('reloadBar').style.display='none';return;}
  reloadTime-=dt;$('reloadBar').style.display='block';$('reloadBar').firstElementChild.style.width=`${(1-Math.max(0,reloadTime)/(reloadTotal||1))*100}%`;
  if(reloadTime>0)return;
  const name=reloadingWeapon,w=weapons[name],cap=capacity(name),g=GUN[name];
  if(name==='shotgun'){if(w.reserve>0&&w.mag<cap){w.mag++;w.reserve--;sound('switch',{rate:.8});}if(w.mag<cap&&w.reserve>0)reloadTotal=reloadTime=g.shellEach*mods().reload;else{reloadingWeapon=null;reloadTime=0;sound('reload',{rate:1.2});}updateHUD();return;}
  const target=cap+(g.chamber&&w.mag>0?1:0),n=Math.min(target-w.mag,w.reserve);w.mag+=n;w.reserve-=n;reloadingWeapon=null;reloadTime=0;sound('switch');updateHUD();
}
// Pips are rebuilt only when the weapon or its capacity changes; a shot just toggles 'spent' on existing nodes.
function renderPips(w){const cap=current==='minigun'?0:capacity(current),key=current+':'+cap,box=$('ammoPips');if(key!==pipKey){pipKey=key;pipMag=-1;box.replaceChildren();box.dataset.kind=current;if(cap){const n=Math.min(cap+1,42);for(let i=0;i<n;i++)box.appendChild(document.createElement('i'));}}if(!cap||w.mag===pipMag)return;pipMag=w.mag;const kids=box.children,n=kids.length,full=Math.round(w.mag*n/Math.max(cap,w.mag));for(let i=0;i<n;i++){const s=i>=full;if(kids[i].classList.contains('spent')!==s)kids[i].classList.toggle('spent',s);}}
// Perk offers: one per completed wave (perkWave = last wave offered). If a choice is still open when the next
// offer comes it is owed (perkOwed) and shown right after the pick. The cards are only shown (and only take
// keys 1/2/3) during a break; a pick left open when the wave starts waits for the next break.
function offerPerks(){if(player.health<=0)return;if(perkChoice){perkOwed++;return;}perkChoice=rollPerks(player.perks,3);if(!perkChoice.length)perkChoice=null;renderPerks();}
function perkPending(){if(perkChoice&&phase==='active')toast('УСИЛЕНИЕ НЕ ВЫБРАНО · ВЫБЕРЕШЬ НА ПЕРЕДЫШКЕ',3.2);}
function renderPerks(){const box=$('perkModal'),show=!!perkChoice&&phase==='break';if(box.hidden===show)box.hidden=!show;if(!show){perkShown=null;return;}if(perkShown===perkChoice)return;perkShown=perkChoice;box.querySelector('.perk-cards').replaceChildren(...perkChoice.map((id,i)=>{const p=PERKS[id],card=document.createElement('button'),k=document.createElement('kbd'),icon=document.createElement('i'),t=document.createElement('b'),d=document.createElement('small'),lvl=document.createElement('em');card.className='perk-card';k.textContent=i+1;icon.textContent=p.icon;t.textContent=p.title;d.textContent=p.desc;lvl.textContent=`УРОВЕНЬ ${(player.perks[id]||0)+1} / ${p.max}`;card.append(k,icon,t,d,lvl);card.onclick=()=>choosePerk(i);return card;}));}
function choosePerk(i){if(!perkChoice||!perkChoice[i])return;const id=perkChoice[i];player.perks[id]=(player.perks[id]||0)+1;if(phase==='break')saveProgress(wave+1);perkChoice=null;if(perkOwed>0){perkOwed--;perkChoice=rollPerks(player.perks,3);if(!perkChoice.length)perkChoice=null;}renderPerks();if(net.role!=='client'){if(id==='pack')player.grenades=Math.min(5+mods().grenades,player.grenades+2);if(id==='tough')heal(player,25);}else net.send({t:'perks',p:player.perks});pipKey='';toast(`УСИЛЕНИЕ · ${PERKS[id].title.toUpperCase()}`,2);sound('pickup');updateHUD();}
function waveSummary(){const acc=shotsFired?Math.round(shotsHit/shotsFired*100):0;return `Точность ${acc}% · попаданий в голову ${headshots} · +30 здоровья · выбери усиление (1/2/3)`;}
// Weapon switch: the held weapon lowers (SWITCH_LOWER), swaps at the bottom, the new one raises
// (SWITCH_RAISE). Re-targeting mid-animation continues from the current height (no snap).
function setWeapon(name,instant=false){if(!weapons[name]||player.health<=0&&!instant)return;if(name in UNLOCKS&&!slotOpen(name)){toast(`${WEAPON_NAMES[name]} · ОТКРОЕТСЯ НА ВОЛНЕ ${UNLOCKS[name]}`,1.4);return;}if(name==='minigun'&&(!minigunUntil||minigunUntil<wave))return;if(!hasWeapon(name))return;if(instant){current=name;swapTo=null;VM.sw=0;}else{if(swapTo===name||!swapTo&&current===name)return;swapTo=name;sound('switch',{rate:.9,volume:.7});}reloadTime=0;reloadingWeapon=null;aim=false;pipKey='';updateHUD();}
function finishSwap(){current=swapTo;pipKey='';shotKick=0;sound('switch',{rate:1.2,volume:.6});updateHUD();}
function cycleWeapon(step=1){const list=WEAPON_KEYS.filter(k=>hasWeapon(k)&&(k!=='minigun'||minigunUntil&&minigunUntil>=wave));if(!list.length)return;const i=list.indexOf(swapTo||current);setWeapon(list[((i<0?0:i)+step+list.length)%list.length]);}
function reload(){if(current==='minigun'||player.health<=0||swapTo)return;const w=weapons[current],g=GUN[current],cap=capacity(current);if(reloadTime>0||w.mag>=cap)return;if(w.reserve<=0){toast('Боезапас исчерпан. Ищи ящики или смени оружие.');return;}const m=mods();VM.empty=w.mag===0;reloadingWeapon=current;reloadTotal=reloadTime=(current==='shotgun'?g.shellFirst+g.shellEach:w.mag>0?g.tac:g.empty)*m.reload;sound('reload',{rate:current==='shotgun'?1.3:1});updateHUD();}
function updateHUD(){updateRadioHud();const w=weapons[current];$('grenadeCount').textContent=player.grenades;$('wave').textContent=String(wave).padStart(2,'0');$('enemies').textContent=Math.max(0,config.count-waveKills);$('waveProgress').style.width=`${(1-waveKills/config.count)*100}%`;$('kills').textContent=kills;$('score').textContent=String(score).padStart(6,'0')+' ОЧКОВ';$('health').textContent=Math.ceil(player.health);$('healthBar').style.width=Math.min(100,player.health/maxHealth(player)*100)+'%';$('healthMax').textContent='/ '+maxHealth(player);$('healthBar').style.background=player.health<30?'#ed714b':'#e5e9dc';updateAmmoHUD();$('weaponName').textContent=WEAPON_NAMES[current];$('ammoStatus').textContent=reloadTime>0?(reloadingWeapon==='shotgun'?'ЗАРЯЖАЮ ПАТРОНЫ…':'ПЕРЕЗАРЯДКА…'):player.health<=0?'РАНЕН · ОРУЖИЕ НЕДОСТУПНО':player.sprinting?'БЕГ · ОРУЖИЕ ОПУЩЕНО':current==='shotgun'?`12 КАЛИБР · ${SHOTGUN_PELLETS} ДРОБИН`:current==='minigun'?`ДО КОНЦА ВОЛНЫ ${minigunUntil}`:AMMO_LABEL[current]||'';for(const k of WEAPON_KEYS){const el=$(SLOT_IDS[k]);el.classList.toggle('locked',!slotOpen(k));el.classList.toggle('active',(swapTo||current)===k);}
  updateBossHUD();updateObjective();updateSquadHUD();}
function setText(el,v){v=String(v);if(el.textContent!==v)el.textContent=v;}
// Ammo counter, pips and the low-ammo warning: the only HUD part refreshed on every shot.
// Single-round weapons (RPG) warn only when empty, not while loaded.
function updateAmmoHUD(){const w=weapons[current],cap=current==='minigun'?0:capacity(current),ammo=$('ammo'),la=$('lowAmmo');setText(ammo,String(w.mag).padStart(2,'0'));const col=w.mag===0?'#ed714b':'';if(ammo.style.color!==col)ammo.style.color=col;setText($('reserve'),w.reserve);renderPips(w);
  const low=(phase==='active'||phase==='break')&&cap>0&&(cap>1?w.mag<=Math.ceil(cap*.25):w.mag===0)&&reloadTime<=0,empty=w.mag+w.reserve===0;if(la.hidden===low)la.hidden=!low;if(la.classList.contains('empty')!==empty)la.classList.toggle('empty',empty);setText(la.firstElementChild,empty?'ПУСТО':w.mag===0?'ПЕРЕЗАРЯДИСЬ':'МАЛО ПАТРОНОВ');}
function updateObjective(){const el=$('objective');let text='',kind='';if(phase==='break')text=evacTime>0?'Эвакуация: держитесь у центра поста':`Передышка · ${Math.max(0,Math.ceil(breakTime))} с${net.role==='client'?'':' · E — начать'}`;else if(phase==='active'||phase==='paused'){const bosses=enemies.filter(e=>e.boss);if(bosses.length){kind='boss';text='Убей: '+[...new Set(bosses.map(e=>bossName(e.type)))].join(' и ');}else{kind='hold';text=`Продержись: осталось ${Math.max(0,config.count-waveKills)}`;}}
  if(el.textContent!==text)el.textContent=text;el.classList.toggle('boss',kind==='boss');if(kind!==objKind){objKind=kind;el.classList.remove('flash');void el.offsetWidth;if(kind)el.classList.add('flash');}}
function clearGame(){previousProgramWave=0;fx.clear();overlay.clear();for(const r of rocks)scene.remove(r.mesh);rocks.length=0;canvas.style.filter='';lowHpFx=false;postfx?.reset();setWaveEvent(null);combo=0;comboTime=0;bossesSpawned=0;bossQueue=[];massKill=false;evacTime=0;removeHeli();radioClear();hideIntro();objKind='';clearHazards();$('scope').hidden=true;$('lowAmmo').hidden=true;$('acidOverlay').hidden=true;$('screamOverlay').hidden=true;radio.clear();grenades.clear();grenadeRequest=0;drop?.dispose();drop=null;dropWave=0;minigunUntil=0;weapons.minigun.mag=0;coopPaused=false;for(const q of squad.values())removeMate(q);squad.clear();clearPings();stopHeartbeat();localReviving=false;$('downed').hidden=true;$('hud').classList.remove('is-down');$('reviveRing').hidden=true;swapTo=null;takenPickups.clear();for(const list of [enemies,dead,rockets,effects,pickups]){for(const e of list){scene.remove(e.mesh);disposeZombie(e.mesh);if(e.dispose){e.mesh.geometry?.dispose();e.mesh.material?.dispose();}}list.length=0;}keys.clear();shooting=false;aim=false;dragLook=false;joyX=joyY=0;navTime=0;emptyTime=0;reloadTime=0;shootCooldown=0;shotKick=0;shake=0;damageTime=0;hitTime=0;bannerTime=0;toastTime=0;flash.visible=false;weaponLight.intensity=0;$('damage').style.opacity=0;}
function startGame(from=1){clearGame();gameSession++;$('coopModal').hidden=true;phase='active';wave=0;kills=0;score=0;current='ak';player.pos.set(0,1.72,12);player.yaw=0;player.pitch=0;player.health=100;player.stamina=100;Object.assign(player,{exhausted:false,down:false,out:false,bleed:0,revive:0,reviver:null,selfT:0,secondUsed:false,grace:0,slowT:0,pull:null});resetVM();player.perks={};perkChoice=null;perkOwed=0;perkWave=0;renderPerks();for(const id of ['restart','restartPause','retryWave'])$(id).hidden=net.role==='client';bloom=0;recoilDebtV=recoilDebtH=0;shotsFired=shotsHit=headshots=0;pipKey='';player.vy=0;player.grounded=true;player.grenades=3;player.lastGrenade=-99;weapons.ak.mag=30;weapons.ak.reserve=180;weapons.rpg.mag=1;weapons.rpg.reserve=6;weapons.shotgun.mag=6;weapons.shotgun.reserve=30;granted.clear();for(const k of Object.keys(WEAPON_START))if(weapons[k]){weapons[k].mag=0;weapons[k].reserve=0;}player.stats=newStats();for(const d of decor)d.visible=false;for(const id of ['menu','pause','gameover','settingsModal','victory','howtoModal'])$(id).hidden=true;$('hud').hidden=false;initAudio();if(net.role!=='client'){runStart=clampWave(from);if(runStart>1)applyStartBuild(runStart);wave=runStart-1;nextWave();if(runStart>1){refillAmmo('wave');updateHUD();}}else updateHUD();if(net.role==='host'){for(const [id,q]of net.peers){const mate=ensureMate(id,q.name);net.send({t:'start',session:gameSession,spawn:mate.pos.toArray(),diff:difficulty,wave},id);}}requestLock();}
// Campaign wave flow: the wave definition (campaign.js) drives enemies, bosses, event,
// weather, time of day and unlocks; rules.waveConfig turns it into numbers for the
// host's difficulty and team size (the event is already applied there).
function nextWave(){if(net.role==='client')return;expireMinigun();phase='active';evacTime=0;wave++;saveProgress(wave);radio.startWave(wave);const def=getWave(wave);config=waveConfig(wave,net.role==='solo'?1:1+net.peers.size,difficulty,def);setWaveEvent(config.event);applyWaveEnvironment(def);bossQueue=[...config.bosses];spawned=0;bossesSpawned=0;waveKills=0;shotsFired=shotsHit=headshots=0;spawnTimer=config.boss?9:.8;if(config.boss&&!WAVE_EVENTS[config.event]?.noAirdrop)beginDrop(wave);saveBest();$('waveState').textContent='УДЕРЖИВАЙ ПОЗИЦИЮ';announceProgram();if(config.unlock)unlockWeapon(config.unlock);for(const k of Object.keys(UNLOCKS))if(wave>=UNLOCKS[k]&&k!==config.unlock&&!granted.has(k))unlockWeapon(k,true);for(const q of [player,...squad.values()])q.secondUsed=false;renderPerks();if(!config.boss)perkPending();sound('wave');updateMusic();updateHUD();}
// Unlocks are derived from the wave number on every machine; this grants starting ammo once
// (when the weapon exists) and plays the unlock moment unless silent (mid-game join).
function unlockWeapon(name,silent=false){if(!(name in UNLOCKS))return;if(!granted.has(name)){granted.add(name);const w=weapons[name],s=WEAPON_START[name];if(w&&s){w.mag=s[0];w.reserve=s[1];}}if(silent)return;const el=$(SLOT_IDS[name]);el.classList.add('fresh');setTimeout(()=>el.classList.remove('fresh'),1500);sound('unlock');banner('НОВОЕ ОРУЖИЕ',WEAPON_NAMES[name],`Клавиша ${WEAPON_KEYS.indexOf(name)+1} — взять в руки. Колесо мыши листает оружие.`,4.2);updateHUD();}
function updateMusic(){if(phase==='paused')return;if(phase==='menu'||phase==='break'&&evacTime<=0){audioEngine.setMusic('calm',.3);return;}if(phase==='gameover'||phase==='victory'){audioEngine.setMusic('off');return;}if(evacTime>0){audioEngine.setMusic('wave',.35);return;}if(enemies.some(e=>e.boss)){audioEngine.setMusic('boss',1);return;}audioEngine.setMusic('wave',Math.min(1,.2+enemies.length/45+Math.min(wave,30)/30*.3));}
function completeWave(){expireMinigun();phase='break';renderPerks();if(wave===CAMPAIGN_LENGTH){beginEvac();return;}saveProgress(wave+1);breakTime=15;player.grenades=Math.min(5+mods().grenades,player.grenades+2);for(const q of squad.values())q.grenades=Math.min(5+mods(q).grenades,q.grenades+2);restoreTeam();refillAmmo('wave');setWaveEvent(null);score+=wave*250;$('waveState').textContent='ПЕРИМЕТР ЗАЧИЩЕН';banner('ВОЛНА ОТБИТА','ПЕРЕДЫШКА',waveSummary(),10);perkWave=wave;offerPerks();toast('E — начать следующую волну',9);sound('pickup');updateMusic();updateHUD();}
// ---- Final wave: evacuation helicopter, then the victory screen ----
function beginEvac(){evacTime=EVAC_TIME;breakTime=EVAC_TIME+1;setWaveEvent(null);score+=wave*250;restoreTeam();$('waveState').textContent='ЭВАКУАЦИЯ';spawnHeli();evacAnnounce();updateMusic();updateHUD();}
function evacAnnounce(){banner('РАССВЕТ','ВЕРТОЛЁТ НА ПОДХОДЕ','Держитесь у центра поста — садимся у КПП.',6);radioClear();radioSay(MAYAK,'Рубеж-7, вижу вас! Вертушка заходит на посадку. Держитесь ещё немного!');radioSay(DUCK,'Кряк FM передаёт привет пилоту! И просит место у окна.');}
const heliMats=[];function heliMat(o){const m=new THREE.MeshStandardMaterial(o);heliMats.push(m);return m;}
function spawnHeli(){if(heli)return;const g=new THREE.Group(),body=heliMat({color:0x34412f,roughness:.62,metalness:.3}),dark=heliMat({color:0x111518,roughness:.5,metalness:.4}),glass=heliMat({color:0x1d2a31,roughness:.15,metalness:.7,emissive:0x0b1b24}),lamp=new THREE.MeshBasicMaterial({color:0xff3a22});heliMats.push(lamp);
  const add=(parent,geo,mat,x,y,z,sx=1,sy=1,sz=1)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m;},box=new THREE.BoxGeometry(1,1,1),ball=new THREE.SphereGeometry(1,14,10);
  add(g,box,body,0,0,0,2.3,2,5.2);add(g,ball,glass,0,-.1,-2.7,1.15,1,1.2);add(g,box,body,0,.45,5.4,.55,.65,6.2);add(g,box,body,0,1.3,8.2,.16,1.9,1.1);add(g,box,body,0,.5,8.2,2.2,.12,.7);
  for(const x of [-1.15,1.15]){add(g,box,dark,x,-1.55,0,.12,.12,5.4);add(g,box,dark,x,-1.2,-1.3,.1,.7,.1);add(g,box,dark,x,-1.2,1.3,.1,.7,.1);}
  add(g,box,dark,0,1.15,0,.5,.4,.5);const rotor=new THREE.Group();rotor.position.set(0,1.42,0);g.add(rotor);for(const r of [0,Math.PI/2])add(rotor,box,dark,0,0,0,13,.06,.36).rotation.y=r;
  const tail=new THREE.Group();tail.position.set(.32,1.3,8.4);g.add(tail);for(const r of [0,Math.PI/2])add(tail,box,dark,0,0,0,.06,2.6,.2).rotation.x=r;const beacon=add(g,ball,lamp,0,-1.05,1.8,.14,.14,.14);
  g.traverse(o=>{if(o.isMesh){o.castShadow=false;o.raycast=()=>{};}});scene.add(g);heli={mesh:g,rotor,tail,beacon,box,ball};heliLoop=audioEngine.play('heli',{loop:true,volume:.05});updateHeli(0);}
// Position is a pure function of the remaining evac time, so host and clients agree.
function updateHeli(dt){if(!heli)return;const k=THREE.MathUtils.clamp(1-evacTime/EVAC_TIME,0,1),fly=THREE.MathUtils.smootherstep(Math.min(1,k/.72),0,1),m=heli.mesh;m.position.set(THREE.MathUtils.lerp(-70,0,fly),THREE.MathUtils.lerp(42,10,fly)-Math.max(0,k-.72)/.28*3.2,THREE.MathUtils.lerp(-85,4,fly));m.rotation.set((1-fly)*.18,Math.PI*.78*(1-fly),Math.sin(time*.8)*.03);heli.rotor.rotation.y+=dt*38;heli.tail.rotation.z+=dt*55;heli.beacon.visible=Math.sin(time*6)>0;if(heliLoop){const d=m.position.distanceTo(player.pos);heliLoop.setVolume(Math.max(.05,Math.min(1,1.25-d/70)));}}
function removeHeli(){heliLoop?.stop(1.2);heliLoop=null;if(!heli)return;scene.remove(heli.mesh);heli.box.dispose();heli.ball.dispose();for(const m of heliMats)m.dispose();heliMats.length=0;heli=null;}
function victory(){const list=collectStats();if(net.role==='host')net.broadcast({t:'victory',stats:list});showVictory(list);}
// late: a guest who joined while the victory screen was up sees it too, without being credited a win.
function showVictory(list,late=false){if(phase==='victory')return;phase='victory';stopHeartbeat();$('downed').hidden=true;$('reviveRing').hidden=true;evacTime=0;shooting=false;aim=false;keys.clear();coopPaused=false;$('pause').hidden=true;renderPerks();saveBest();saveProgress(wave+1);if(!late){wins++;try{localStorage.setItem('outpost.wins',wins);}catch{}}renderProgress();document.exitPointerLock?.();heliLoop?.stop(2.5);heliLoop=null;updateMusic();sound('victory');hideIntro();radioClear();bannerTime=0;$('banner').style.opacity=0;$('victoryText').textContent=VICTORY.text;renderStats($('victoryStats'),list);$('victoryEndless').hidden=net.role==='client';$('victory').hidden=false;}
// Host only: waves 31+ continue the curves; clients follow via snapshots.
// Wave 30 skipped the break rewards (evac instead), so endless starts with them: +2 grenades for the team,
// the wave ammo refill (clients refill on the 30→31 wave change) and the wave-30 perk (shown at the next break).
function startEndless(){if(net.role==='client'||phase!=='victory')return;$('victory').hidden=true;removeHeli();phase='break';player.grenades=Math.min(5+mods().grenades,player.grenades+2);for(const q of squad.values())q.grenades=Math.min(5+mods(q).grenades,q.grenades+2);perkWave=Math.max(perkWave,wave);offerPerks();nextWave();refillAmmo('wave');updateHUD();requestLock();}
function leaveVictory(){$('victory').hidden=true;removeHeli();phase='active';}
// ---- Per-player stats (host-authoritative; sent with 'over' and 'victory') ----
function newStats(){return {kills:0,headshots:0,shots:0,hits:0,damage:0,revives:0};}
function collectStats(){return [{id:net.id||'solo',name:net.role==='solo'?'Ты':net.name,...player.stats},...[...squad.values()].map(q=>({id:q.id,name:q.name,...(q.stats||newStats())}))].map(s=>({...s,damage:Math.round(s.damage)}));}
function renderStats(body,list){body.replaceChildren();const rows=(Array.isArray(list)?list:[]).slice(0,4).filter(s=>s&&typeof s==='object'),n=(s,k)=>Math.max(0,Math.round(Number(s[k])||0)),value=s=>n(s,'damage')+n(s,'kills')*60;let mvp=rows.length>1?rows.reduce((a,b)=>value(b)>value(a)?b:a):null;if(mvp&&value(mvp)<=0)mvp=null;
  for(const s of rows){const tr=document.createElement('tr');if(s===mvp)tr.classList.add('mvp');if(net.role==='solo'||s.id===net.id)tr.classList.add('me');const acc=n(s,'shots')?Math.round(n(s,'hits')/n(s,'shots')*100):0;for(const val of [String(s.name||'Боец').slice(0,24),n(s,'kills'),n(s,'headshots'),acc+'%',n(s,'damage'),n(s,'revives')]){const td=document.createElement('td');td.textContent=val;tr.appendChild(td);}body.appendChild(tr);}}
function pause(){if(net.role!=='solo'&&(phase==='active'||phase==='break')){if(coopPaused)return;coopPaused=true;shooting=false;aim=false;keys.clear();if(document.pointerLockElement)document.exitPointerLock?.();$('pause').hidden=false;return;}if(phase!=='active'&&phase!=='break')return;beforePause=phase;phase='paused';shooting=false;aim=false;keys.clear();if(document.pointerLockElement)document.exitPointerLock?.();$('pause').hidden=false;}
function resume(){if(coopPaused){coopPaused=false;$('pause').hidden=true;requestLock();return;}if(phase!=='paused')return;phase=beforePause;$('pause').hidden=true;requestLock();initAudio();}
function returnMenu(){net.leave();phase='menu';document.exitPointerLock?.();clearGame();for(const id of ['hud','pause','gameover','victory','howtoModal','settingsModal'])$(id).hidden=true;$('menu').hidden=false;for(const d of decor)d.visible=true;applyWaveEnvironment(getWave(1),true);updateMusic();renderDifficulty();renderStartWave();}
// ---- Downed / bleed-out / revive (host-authoritative; clients read it from snapshots) ----
// 0 HP = downed for BLEED_TIME s (can look and ping, can't shoot). A teammate holding F within
// REVIVE_R m for REVIVE_TIME s (faster with «Санитар») revives with 50 HP (+ medic bonus). Bleeding
// out = out until the wave ends (everyone respawns with 50 HP at the wave break). «Второй шанс»
// self-revives once per wave after 5 s. Solo without it: immediate game over. Game over only
// when the whole team is down at once with no self-revive pending.
const BLEED_TIME=30,REVIVE_TIME=3,REVIVE_R=2.5,REVIVE_HP=50;
function team(){return [player,...squad.values()];}
function mateName(id){if(!id)return 'НАПАРНИК';if(id===(net.id||'solo'))return net.role==='solo'?'ТЫ':net.name;return squad.get(id)?.name||'НАПАРНИК';}
function onDown(q){if(net.role==='client'||q.down||phase==='gameover'||phase==='victory')return;const m=mods(q),self=m.selfRevive&&!q.secondUsed;Object.assign(q,{health:0,down:true,out:false,revive:0,reviver:null,bleed:BLEED_TIME,acidAcc:0,selfT:self?m.selfReviveDelay:0});
  if(q===player){shooting=false;aim=false;reloadTime=0;reloadingWeapon=null;player.pull=null;sound('hurt',{rate:.7});}else toast(`${q.name} РАНЕН · ПОДНИМИ: УДЕРЖИВАЙ F`,2.6);
  checkWipe();}
function checkWipe(){if(net.role==='client'||phase==='gameover'||phase==='victory')return false;if(team().every(t=>t.health<=0&&!(t.selfT>0))){gameOver();return true;}return false;}
function reviveTarget(q,hp,by=null){const was=q.out;Object.assign(q,{health:Math.min(maxHealth(q),hp),down:false,out:false,bleed:0,revive:0,reviver:null,selfT:0,grace:1.5,_hp:undefined});if(q===player){banner('СНОВА В СТРОЮ',by?'ПОДНЯЛ: '+String(shooterName(by)).toUpperCase():was?'ВОЗВРАЩЕНИЕ':'ВТОРОЙ ШАНС','',2.4);sound('pickup',{rate:.8});}else if(by===player){toast(`ТЫ ПОДНЯЛ: ${q.name}`.toUpperCase(),1.8);sound('pickup',{rate:1.1,volume:.7});}else if(by)toast(`${by.name} ПОДНЯЛ: ${q.name}`.toUpperCase(),1.8);
  // Teammate revives are announced on every machine ({t:'revived'}); the revived player sees its own banner.
  if(by&&net.role==='host')net.broadcast({t:'revived',who:q===player?net.id:q.id,by:by===player?net.id:by.id});}
// Wave break: the downed and the bled-out come back with 50 HP; the living get +30 (co-op: at least 70).
function restoreTeam(){for(const q of team()){if(q.health<=0)reviveTarget(q,REVIVE_HP);else q.health=Math.min(maxHealth(q),Math.max(net.role==='solo'?0:40,q.health)+30);}}
function updateDowned(dt){
  if(net.role==='client')return;const all=team();
  for(const q of all){if(q.grace>0)q.grace-=dt;if(q.health>0){q.down=false;continue;}if(!q.down){onDown(q);if(phase==='gameover')return;}if(q.out)continue;
    let best=null,rate=0;for(const a of all){if(a===q||a.health<=0||!(a===player?keys.has('KeyF')&&!coopPaused:a.help))continue;if(Math.hypot(a.pos.x-q.pos.x,a.pos.z-q.pos.z)>REVIVE_R+.3||Math.abs(a.pos.y-q.pos.y)>1.2)continue;const r=mods(a).reviveSpeed;if(r>rate){rate=r;best=a;}}
    if(best){q.revive=(q.revive||0)+dt*rate/REVIVE_TIME;q.reviver=best===player?(net.id||'solo'):best.id;if(q.revive>=1){if(best.stats)best.stats.revives++;reviveTarget(q,REVIVE_HP+mods(best).reviveBonus,best);continue;}}
    else{q.revive=Math.max(0,(q.revive||0)-dt*1.5);if(q.revive<=0)q.reviver=null;q.bleed=Math.max(0,q.bleed-dt);}
    if(q.selfT>0){q.selfT-=dt;if(q.selfT<=0){q.selfT=0;q.secondUsed=true;reviveTarget(q,REVIVE_HP);continue;}}
    if(q.bleed<=0){q.out=true;q.revive=0;q.reviver=null;if(q===player)sound('hurt',{rate:.5});else toast(`${q.name} ВЫБЫЛ ДО КОНЦА ВОЛНЫ`,2.4);}
  }}
function gameOver(){if(phase==='gameover'||phase==='victory')return;const list=collectStats();if(net.role==='host')net.broadcast({t:'over',stats:list});phase='gameover';shooting=false;keys.clear();endScreenCleanup();saveBest();renderStats($('statsTable'),list);evacTime=0;heliLoop?.stop(1);heliLoop=null;stopHeartbeat();$('downed').hidden=true;$('reviveRing').hidden=true;updateMusic();document.exitPointerLock?.();$('finalWave').textContent=String(wave).padStart(2,'0');$('finalKills').textContent=kills;$('finalScore').textContent=score;{const r=$('retryWave');r.dataset.wave=String(wave);r.textContent='С НОЧИ '+String(wave).padStart(2,'0');r.hidden=net.role==='client'||wave<=runStart;$('restart').firstChild.textContent=runStart>1?'ЗАНОВО С НОЧИ '+String(runStart).padStart(2,'0')+' ':'ЕЩЁ ОДНА ПОПЫТКА ';}$('deathMessage').textContent=wave>=best?'Каждая попытка делает тебя сильнее. Ещё раз?':'Ты держался до последнего.';$('gameover').hidden=false;sound('blast');}
// Game over freezes the per-frame HUD, so everything transient is closed first (intro card, radio line,
// perk cards, co-op pause dialog, banner, toast) instead of staying frozen under the defeat overlay.
function endScreenCleanup(){hideIntro();radioClear();perkChoice=null;perkOwed=0;renderPerks();coopPaused=false;$('pause').hidden=true;bannerTime=0;$('banner').style.opacity=0;toastTime=0;$('toast').style.opacity=0;$('lowAmmo').hidden=true;$('scope').hidden=true;}
// Pointer lock: most rejections are temporary (no user gesture, e.g. a co-op start from a network packet,
// or Chrome's ~1 s cooldown after Esc). Those keep the click-to-lock hint and every canvas click retries.
// Only LOCK_GIVE_UP failures that followed a real gesture switch to drag-look for this page.
const LOCK_HINT=$('lockHint').textContent,LOCK_GIVE_UP=3;let lockFails=0;
function lockHint(){if(lockUnavailable||document.pointerLockElement===canvas||coarse)return;$('lockHint').textContent=LOCK_HINT;$('lockHint').hidden=!(phase==='active'||phase==='break')||coopPaused;}
function requestLock(){if(coarse)return;const ua=window.navigator.userActivation,gesture=ua?ua.isActive:true;const fail=()=>{if(document.pointerLockElement===canvas)return;if(gesture&&++lockFails>=LOCK_GIVE_UP){if(!lockUnavailable)toast('Полный обзор мышью доступен в отдельном окне Chrome или Edge.',6);lockUnavailable=true;$('lockHint').textContent='Обзор: ЛКМ + движение мыши или стрелки';$('lockHint').hidden=false;}else lockHint();};try{const p=canvas.requestPointerLock();if(p&&typeof p.catch==='function')p.catch(fail);}catch{fail();}}
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===canvas){lockUnavailable=false;lockFails=0;$('lockHint').hidden=true;}else if(phase==='active'||phase==='break')pause();});
document.addEventListener('pointerlockerror',()=>lockHint());
$('start').onclick=()=>{net.leave();startGame(startWave);};$('resume').onclick=resume;$('restart').onclick=()=>{if(net.role!=='client')startGame(runStart);else toast('Перезапуск доступен ведущему.');};$('retryWave').onclick=()=>{if(net.role!=='client')startGame(Number($('retryWave').dataset.wave)||runStart);};
$('startWave').onchange=e=>chooseStartWave(e.target.value);$('coopStartWave').onchange=e=>chooseStartWave(e.target.value);$('restartPause').onclick=$('restart').onclick;$('quit').onclick=returnMenu;$('menuReturn').onclick=returnMenu;
$('settings').onclick=()=>{$('settingsModal').hidden=false;};$('closeSettings').onclick=()=>{$('settingsModal').hidden=true;};
$('sound').onchange=e=>{soundOn=settings.sound=e.target.checked;saveSettings();initAudio();};$('sensitivity').oninput=e=>{sensitivity=settings.sensitivity=Number(e.target.value);$('sensitivityValue').value=sensitivity.toFixed(1);saveSettings();};
for(const [id,k] of [['volMaster','master'],['volSfx','sfx'],['volMusic','music']])$(id).oninput=e=>{settings[k]=Number(e.target.value)||0;$(id+'Value').value=String(Math.round(settings[k]));audioEngine.setVolumes({[k]:settings[k]/100});saveSettings();};
$('fov').oninput=e=>{settings.fov=THREE.MathUtils.clamp(Number(e.target.value)||78,70,100);$('fovValue').value=Math.round(settings.fov)+'°';saveSettings();};$('quality').onchange=e=>{applyQuality(e.target.value);saveSettings();};
$('shadowsToggle').onchange=e=>{settings.shadows=e.target.checked;flashlight.castShadow=!coarse&&settings.shadows;saveSettings();};$('damageNumbersToggle').onchange=e=>{settings.damageNumbers=e.target.checked;saveSettings();};
$('howto').onclick=()=>{$('howtoModal').hidden=false;};$('closeHowto').onclick=()=>{$('howtoModal').hidden=true;};$('pauseSettings').onclick=$('settings').onclick;$('pauseHowto').onclick=$('howto').onclick;
$('victoryEndless').onclick=startEndless;$('victoryMenu').onclick=returnMenu;
// Difficulty: chosen in the menu or lobby, host-authoritative, synced to clients ('diff', 'start', snapshots).
function renderDifficulty(){for(const box of [$('difficulty'),$('coopDifficulty')])for(const b of box.querySelectorAll('[data-difficulty]')){const on=b.dataset.difficulty===difficulty;b.classList.toggle('active',on);b.setAttribute('aria-checked',String(on));}$('coopDifficulty').setAttribute('aria-disabled',String(net.role==='client'));}
function chooseDifficulty(id){if(!DIFFICULTY[id]||net.role==='client'||phase!=='menu')return false;difficulty=settings.difficulty=id;saveSettings();renderDifficulty();sound('ui');if(net.role==='host')net.broadcast({t:'diff',d:id});return true;}
for(const box of [$('difficulty'),$('coopDifficulty')])box.addEventListener('click',e=>{const b=e.target.closest('[data-difficulty]');if(b){initAudio();chooseDifficulty(b.dataset.difficulty);}});
document.addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&phase!=='menu')e.preventDefault();if(e.code==='Escape'){if(!$('howtoModal').hidden){$('howtoModal').hidden=true;return;}if(!$('settingsModal').hidden){$('settingsModal').hidden=true;return;}pause();return;}if(coopPaused||phase!=='active'&&phase!=='break')return;keys.add(e.code);if(perkChoice&&phase==='break'&&/^Digit[123]$/.test(e.code)){choosePerk(Number(e.code.slice(5))-1);return;}if(e.code==='KeyL'&&!e.repeat)toggleFlashlight();const slotKey=/^Digit([1-6])$/.exec(e.code);if(slotKey)setWeapon(WEAPON_KEYS[Number(slotKey[1])-1]);if(e.code==='KeyR')reload();if(e.code==='KeyZ'&&!e.repeat)placePing();if(e.code==='KeyG'&&!e.repeat)throwGrenade();if(e.code==='KeyQ'&&!e.repeat)requestDj();if(e.code==='KeyE'&&phase==='break'&&evacTime<=0)nextWave();if(e.code==='Space'&&player.grounded&&player.health>0){player.vy=6;player.grounded=false;}});
document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousedown',e=>{if(coopPaused||player.health<=0||phase!=='active'&&phase!=='break')return;if(e.button===0){shooting=true;semiReady=true;dragLook=true;if(!document.pointerLockElement&&!lockUnavailable)requestLock();}if(e.button===2)aim=true;initAudio();});
document.addEventListener('mouseup',e=>{if(e.button===0){shooting=false;dragLook=false;}if(e.button===2)aim=false;});
document.addEventListener('mousemove',e=>{if((phase==='active'||phase==='break')&&(document.pointerLockElement===canvas||dragLook)){swayX=THREE.MathUtils.clamp(swayX+e.movementX*.00035,-.05,.05);swayY=THREE.MathUtils.clamp(swayY-e.movementY*.00025,-.035,.035);player.yaw-=e.movementX*.0022*sensitivity*aimSens();player.pitch=THREE.MathUtils.clamp(player.pitch-e.movementY*.0022*sensitivity*aimSens(),-1.35,1.35);}});
canvas.addEventListener('wheel',e=>{if(phase==='active'||phase==='break'){e.preventDefault();if(performance.now()-wheelT<110)return;wheelT=performance.now();cycleWeapon(e.deltaY<0?-1:1);}},{passive:false});
// Touch input is an alternative for tablets; keyboard and pointer lock remain the primary controls.
let joyX=0,joyY=0,joyId=null,lookId=null,lastTouch=null;
$('joystick').addEventListener('pointerdown',e=>{joyId=e.pointerId;$('joystick').setPointerCapture(joyId);moveJoy(e);});
function moveJoy(e){if(e.pointerId!==joyId)return;const r=$('joystick').getBoundingClientRect();let x=(e.clientX-r.left-r.width/2)/40,y=(e.clientY-r.top-r.height/2)/40;const d=Math.max(1,Math.hypot(x,y));joyX=x/d;joyY=y/d;$('joystick').firstElementChild.style.transform=`translate(${joyX*30}px,${joyY*30}px)`;}
$('joystick').addEventListener('pointermove',moveJoy);for(const type of ['pointerup','pointercancel'])$('joystick').addEventListener(type,()=>{joyId=null;joyX=joyY=0;$('joystick').firstElementChild.style.transform='';});
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&(phase==='active'||phase==='break')){lookId=e.pointerId;lastTouch={x:e.clientX,y:e.clientY};canvas.setPointerCapture(lookId);}});
canvas.addEventListener('pointermove',e=>{if(e.pointerId===lookId&&lastTouch){player.yaw-=(e.clientX-lastTouch.x)*.005*sensitivity;player.pitch=THREE.MathUtils.clamp(player.pitch-(e.clientY-lastTouch.y)*.005*sensitivity,-1.35,1.35);lastTouch={x:e.clientX,y:e.clientY};}});
for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,()=>{lookId=null;lastTouch=null;});
$('touchFire').addEventListener('pointerdown',e=>{shooting=true;semiReady=true;e.target.setPointerCapture(e.pointerId);});for(const type of ['pointerup','pointercancel'])$('touchFire').addEventListener(type,()=>shooting=false);$('djAbility').onclick=requestDj;$('touchGrenade').onclick=throwGrenade;$('touchReload').onclick=reload;$('touchSwitch').onclick=()=>cycleWeapon(1);

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
// Wave start on every machine (host: nextWave, clients: first snapshot of a wave): intro card,
// then boss/event banner, plus the radio briefing and the tutorial hint from campaign.js.
function announceProgram() {
  const def=getWave(wave),act=actFor(wave);
  showIntro(def.endless?act.label+' · ВОЛНА '+wave:act.label,'НОЧЬ '+String(wave).padStart(2,'0')+' · '+String(def.title||'').toUpperCase());
  if(config.boss){const first=config.bosses[0];banner('ВОЛНА '+wave+' · БОСС',bossTitle(config.bosses).toUpperCase(),ENEMY_INFO[first]?.desc||'',5);}
  else if(waveEvent){const ev=WAVE_EVENTS[waveEvent];banner('ВОЛНА '+wave+' · СОБЫТИЕ',ev.title,ev.hint,4.6);}
  else{const program=programs[radio.state.program];if(program)banner('КРЯК FM  /  ВОЛНА '+wave,program.title,program.hint,3.6);}
  radioClear();if(wave===CAMPAIGN_LENGTH+1)for(const l of ENDLESS_INTRO.lines)radioSay(l.who,l.text);
  for(const l of def.briefing||[])radioSay(l.who,l.text);if(def.hint)radioSay('Подсказка',def.hint,4.5);
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
// Bosses come from config.bosses: the first at wave start, a second one after ~30% of the
// regulars (or once only the bosses are left to spawn). Regulars follow the campaign mix.
function bossDue(){return bossQueue.length>0&&(bossesSpawned===0||spawned>=bossesSpawned*Math.max(6,config.regularCount*.3)||spawned>=config.count-bossQueue.length);}
function pickEnemyType(){if(forcedType){const t=forcedType;forcedType=null;return t;}if(bossDue()){bossesSpawned++;return bossQueue.shift();}return pickMixType(config);}
// Spawn path for any type (regular, new or boss). Types without a dedicated brain in
// BRAINS use the walker AI until their AI lands (pass 2). Crawlers arrive as packs.
function spawnWaveEnemy(){const point=chooseSpawnPoint();if(!point)return false;const type=pickEnemyType();if(!spawnEnemy(point,type))return false;if(type==='crawler'){sfx('crawl',point);const [lo,hi]=ENEMY_INFO.crawler.pack||[3,5];let extra=lo-1+Math.floor(Math.random()*(hi-lo+1));for(let k=0;k<12&&extra>0&&spawned<config.count-bossQueue.length&&enemies.length<(config.maxAlive||75);k++){const a=Math.random()*Math.PI*2,x=point.x+Math.cos(a)*1.3,z=point.z+Math.sin(a)*1.3;if(!blocked(x,z,.5)&&spawnEnemy({x,z},'crawler'))extra--;}}return true;}
function spawnEnemy(at=null,forced=null){const point=at||chooseSpawnPoint();if(!point)return false;const type=forced||pickEnemyType();if(!BOSS_SET.has(type)&&enemies.length>=aliveCap())return false;const stats=enemyStats(config,type),boss=BOSS_SET.has(type),id=++enemyId,mesh=makeZombie(type,id),e={id,mesh,type,boss,hp:stats.health,maxHp:stats.health,speed:stats.speed,damage:stats.damage,bodyMult:stats.bodyMult||1,stats,phase:0,attack:Math.random()*.7,step:Math.random()*10,radius:RADIUS[type]||.4,stuck:0,turn:Math.random()<.5?-1:1,slam:3};e.prize=!boss&&radio.state.program==='pinata' && spawned%5===0;if(boss)sfx('bossin',point,true,type);
  dressZombie(mesh,radio.state.program,e.prize);
  mesh.position.set(point.x,0,point.z);mesh.traverse(o=>{if(o.isMesh)o.userData.enemy=e;});enemies.push(e);scene.add(mesh);spawned++;return true;}
function killEnemy(e,headshot=false,shooter=null,dir=null){const i=enemies.indexOf(e);if(i<0)return;enemies.splice(i,1);kills++;waveKills++;combo++;comboTime=3;if(shooter?.stats)shooter.stats.kills++;const ev=waveEvent&&WAVE_EVENTS[waveEvent],mult=(ev?.score||1)*(1+Math.min(combo,20)*.05);score+=Math.round(((SCORE[e.type]||100)+(headshot?40:0))*mult);if(!massKill&&[5,10,20,35,50].includes(combo))toast(`СЕРИЯ ×${combo} · ОЧКИ ×${(1+Math.min(combo,20)*.05).toFixed(2)}`,1.4);if(!shooter||shooter===player){hitTime=.2;$('hitmarker').classList.add('kill');}corpse(e,headshot,dir);const vamp=shooter?mods(shooter).vamp:0;if(vamp)heal(shooter,vamp);overlay.kill(shooterName(shooter),enemyName(e.type),headshot);if(net.role==='host')net.broadcast({t:'kill',id:e.id,h:headshot?1:0,d:dir?[dir.x,dir.z]:null,by:shooterName(shooter),ty:e.type});
  if(e.type==='exploder')explode(e.mesh.position.clone().setY(1),massKill,{power:e.stats?.blastPower||200,radius:e.stats?.blastRadius||6,playerDamage:e.stats?.blastPlayerDamage||24,playerRadius:e.stats?.blastPlayerRadius||4.2});
  if(e.boss){const p=e.mesh.position.clone();bossDownVisual(e.type,p);for(let k=0;k<4;k++)dropPickup(p.clone().add(new THREE.Vector3((Math.random()-.5)*3,0,(Math.random()-.5)*3)),k%2?'health':'ammo');if(net.role==='host')net.broadcast({t:'bossdown',p:p.toArray(),ty:e.type});}
  // The Father's death ends the night: every remaining zombie drops and the wave is won.
  if(e.type==='father'&&!massKill){clearHazards();massKill=true;for(const o of [...enemies])killEnemy(o,false,null,null);massKill=false;spawned=config.count;bossQueue=[];waveKills=Math.max(waveKills,config.count);}
  if(massKill)return;
  if(e.prize){radio.partyPop(e.mesh.position);dropPickup(e.mesh.position,'ammo');if(net.role==='host')net.broadcast({t:'pop',p:e.mesh.position.toArray()});}else if(Math.random()<.23*(ev?.drops||1)||kills%7===0)dropPickup(e.mesh.position,player.health<45&&Math.random()<.65?'health':Math.random()<.4?'health':'ammo');updateHUD();if(waveKills>=config.count&&phase==='active')completeWave();}
function bossDownVisual(type,p){const name=bossName(type).toUpperCase();if(type==='father'){banner('ОТЕЦ ОРДЫ ПОВЕРЖЕН','ОРДА ПАДАЕТ','Солнце встаёт над трассой.',4.5);for(let k=0;k<3;k++)explode(p.clone().add(new THREE.Vector3((Math.random()-.5)*4,1+k*1.4,(Math.random()-.5)*4)),true);shake=1;}else banner(`${name} ${type==='brood'?'ПОВЕРЖЕНА':'ПОВЕРЖЕН'}`,`+${SCORE[type]||3000} ОЧКОВ`,'Отличная работа, отряд.',3.5);explode(p.clone().setY(1.2),true);}
function hurtEnemy(e,amount,headshot=false,dir=null,shooter=null){
  if(!enemies.includes(e))return;
  // Boss bodies are armored (rules.enemyStats bodyMult); heads and glowing weak points take full damage.
  // Armored: body hits from the front hemisphere take frontMult (x.35); blasts (no dir) and heads take full.
  if(!headshot)amount*=bodyFactor(e,dir);
  const dealt=headshot&&radio.state.program==='heads'?amount*1.5:amount;if(shooter?.stats)shooter.stats.damage+=Math.max(0,Math.min(dealt,e.hp));e.hp-=dealt;e.flash=.12;
  if(dir&&!e.boss){const k=Math.min(1,amount/45)*(e.type==='brute'?.35:1);if(k>.2){e.stagger=Math.max(e.stagger||0,.1+k*.3);e.kx=dir.x*k*6;e.kz=dir.z*k*6;}}
  if(e.boss&&e.hp>0)bossPhaseCheck(e);
  if(e.hp<=0)killEnemy(e,headshot,shooter,dir);
}
// Boss phases: Titan/Матка/Мясник enrage below 50%; Отец Орды has three phases (66% / 33%).
// The behaviour per phase belongs to each boss brain; this only tracks it and announces it.
function bossPhaseCheck(e){const ph=bossPhaseOf(e);if(ph<=e.phase)return;e.phase=ph;if(e.type==='father'){e.enraged=ph===2;e.speed*=1.15;}else{e.enraged=true;e.speed*=e.type==='butcher'?(e.stats?.enrageSpeed||1.25):e.type==='brood'?1.1:1.3;}if(!(e.charging>0||e.windup>0||e.pendT>0||e.cleaveT>0||e.dashT>0))setAct(e,ACT.roar);phaseBanner(e.type,ph);if(net.role==='host')net.broadcast({t:'bossphase',ty:e.type,ph});}
function phaseBanner(type,ph){if(type==='father')banner('ОТЕЦ ОРДЫ',ph===1?'ВТОРАЯ ФАЗА':'ПОСЛЕДНЯЯ ФАЗА',ph===1?'Кислота и выводок. Не стойте в лужах.':'Он зовёт всю орду. Добейте его!',2.6);else banner(`${bossName(type).toUpperCase()} В ЯРОСТИ`,'ВТОРАЯ ФАЗА',ENRAGE_HINT[type]||'',2.6);sound('roar');}
function frontHit(e,dir){if(e.type!=='armored'||!dir)return false;const ry=e.mesh.rotation.y;return dir.x*Math.sin(ry)+dir.z*Math.cos(ry)<0;}
function bodyFactor(e,dir){return (e.bodyMult||1)*(frontHit(e,dir)?(e.stats?.frontMult||.35):1);}
function maxHealth(who){return 100+mods(who).maxHp;}
function heal(who,amount){if(who.health<=0)return;who.health=Math.min(maxHealth(who),who.health+amount);}
function corpse(e,head,dir){const m=e.mesh,boss=BOSS_SET.has(e.type);if(dir)m.rotation.y=Math.atan2(-dir.x,-dir.z);if(head&&!boss&&m.userData.head){m.userData.head.visible=false;particles(m.position.clone().setY((m.userData.headY||1.5)+.15),18,false,'blood');}fx.decal(m.position,boss?(e.type==='father'?4:2.6):.75+Math.random()*.4,e.type==='exploder');dead.push({mesh:m,life:4.5,max:4.5,t:0,roll:e.type==='crawler'});}
function shooterName(s){return s===player?(net.role==='solo'?'Ты':net.name):s?.name||'Взрыв';}
function slamVisual(pos){const d=pos.distanceTo(player.pos);sound('blast',{rate:.7,distance:d*.3});particles(pos.clone().setY(.3),24,false);shake=Math.max(shake,.5*Math.max(0,1-d/22));const mesh=new THREE.Mesh(new THREE.RingGeometry(.6,1.1,40),new THREE.MeshBasicMaterial({color:0xff7a4a,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(pos.x,.08,pos.z);scene.add(mesh);effects.push({mesh,life:.5,max:.5,type:'ring',dispose:true});}
function bossSlam(e){const pos=e.mesh.position.clone();setAct(e,ACT.slam);slamVisual(pos);sound('roar',{volume:.6,rate:1.2});if(net.role==='host')net.broadcast({t:'slam',p:pos.toArray()});for(const q of [player,...squad.values()]){if(q.health<=0)continue;const d=Math.hypot(q.pos.x-pos.x,q.pos.z-pos.z);if(d>7.5)continue;damageTarget(q,(e.stats?.slamBase??10)+e.damage*.75*(1-d/7.5),pos);}}
// Titan brain: ground slam up close, telegraphed charge at mid range, boulders
// at long range and minion calls. Returns true while it controls movement.
function bossThink(e,dt,target,dist,dx,dz){
  const p=e.mesh.position,rage=e.enraged?.65:1,name=enemyName(e.type);
  e.slam-=dt;e.chargeCd=(e.chargeCd??5)-dt;e.rockCd=(e.rockCd??3)-dt;e.summonCd=(e.summonCd??9)-dt;
  if(e.windup>0){e.windup-=dt;e.mesh.rotation.y=Math.atan2(e.cdx,e.cdz);e.flash=Math.max(e.flash||0,.25);if(e.windup<=0){e.charging=1.15;e.hitDuringCharge=new Set();setAct(e,ACT.charge);}return true;}
  if(e.charging>0){
    e.charging-=dt;const step=15*(e.type==='father'&&e.phase>=2?1.25:1)*dt,moved=moveActor(p,e.cdx*step,e.cdz*step,e.radius);
    if(Math.random()<.5)particles(p.clone().setY(.2),2,false);
    for(const q of [player,...squad.values()]){if(q.health<=0||e.hitDuringCharge.has(q))continue;if(Math.hypot(q.pos.x-p.x,q.pos.z-p.z)<1.2+e.radius){e.hitDuringCharge.add(q);const dmg=(e.stats?.chargeBase??30)+e.damage*.6;damageTarget(q,dmg,p);if(q===player&&player.health>0){moveActor(player.pos,e.cdx*2.5,e.cdz*2.5,.38);shake=.6;}}}
    if(!moved||e.charging<=0){e.charging=0;setAct(e,0);if(!moved){slamVisual(p.clone());if(net.role==='host')net.broadcast({t:'slam',p:p.toArray()});e.stagger=1.3;sfx('stun',p,true,e.type);}}
    return true;
  }
  if(e.slam<=0&&dist<7.5){e.slam=3.2*rage;bossSlam(e);return false;}
  if(e.chargeCd<=0&&dist>7&&dist<28){e.chargeCd=7.5*rage;e.windup=.95;const n=Math.hypot(dx,dz)||1;e.cdx=dx/n;e.cdz=dz/n;setAct(e,ACT.windup);sound('roar');if(net.role==='host')net.broadcast({t:'roar',ty:e.type});toast(`${name} ГОТОВИТ ТАРАН — УХОДИ В СТОРОНУ!`,1.3);return true;}
  if(e.rockCd<=0&&dist>10){e.rockCd=4.6*rage;setAct(e,ACT.throw);throwRock(e,target);return false;}
  if(e.summonCd<=0){e.summonCd=14*rage;setAct(e,ACT.roar);summonMinions(e);}
  return false;
}
const rocks=[],rockGeo=new THREE.DodecahedronGeometry(.45,0),rockMat=new THREE.MeshStandardMaterial({color:0x4a4640,roughness:.95});
function spawnRock(o,v,live,dmg=null){const mesh=new THREE.Mesh(rockGeo,rockMat);mesh.castShadow=true;mesh.position.copy(o);scene.add(mesh);rocks.push({mesh,v,live,dmg});}
function throwRock(e,target){const o=e.mesh.position.clone();o.y=3.4;const t=1.15,tp=target.pos;const v=new THREE.Vector3((tp.x-o.x)/t,(-o.y+.5*20*t*t)/t,(tp.z-o.z)/t);spawnRock(o,v,true,e.stats?.rockDamage);sound('switch',{rate:.45});if(net.role==='host')net.broadcast({t:'rock',o:o.toArray(),v:v.toArray()});}
function updateRocks(dt){for(let i=rocks.length-1;i>=0;i--){const r=rocks[i];r.v.y-=20*dt;r.mesh.position.addScaledVector(r.v,dt);r.mesh.rotation.x+=dt*5;r.mesh.rotation.z+=dt*3;if(r.mesh.position.y>.35)continue;const p=r.mesh.position.clone();p.y=0;scene.remove(r.mesh);rocks.splice(i,1);slamVisual(p);particles(p.clone().setY(.3),14,false);if(!r.live)continue;for(const q of [player,...squad.values()]){if(q.health<=0)continue;const d=Math.hypot(q.pos.x-p.x,q.pos.z-p.z);if(d<3.6){const rd=r.dmg||[12,30];damageTarget(q,rd[0]+rd[1]*(1-d/3.6),p);}}}}
function summonMinions(e){const type=wave>=10?'exploder':'runner',n=wave>=15?5:4;let made=0;for(let k=0;k<n;k++){if(enemies.length>=aliveCap())break;const a=Math.random()*Math.PI*2,x=e.mesh.position.x+Math.cos(a)*2.8,z=e.mesh.position.z+Math.sin(a)*2.8;if(blocked(x,z,.5))continue;forcedType=type;if(spawnEnemy({x,z}))made++;}forcedType=null;config.count+=made;if(made)sfx('summon',e.mesh.position,true,e.type);}
function jitter(dir,s){dir.x+=(Math.random()-.5)*s*2;dir.y+=(Math.random()-.5)*s*2;dir.z+=(Math.random()-.5)*s*2;dir.normalize();return dir;}
function shotModsFor(who){const m=mods(who);return {dm:m.damage,hm:m.head,pen:m.pen};}
// Penetrating hitscan: each bullet can pass through `pen` extra zombies, losing 40% per body.
function hitscan(origin,dir,weapon,applyDamage,shooter=null,mx={}){
  raycaster.set(origin,dir);const wall=obstacleDistance(origin,dir),hits=raycaster.intersectObjects(enemies.map(e=>e.mesh),true);
  let end=origin.clone().addScaledVector(dir,Math.min(wall,85)),hitAny=false,dealt=0,pierce=(GUN[weapon]?.pen||0)+(mx.pen||0),falloff=1;const seen=new Set();
  for(const hit of hits){
    if(hit.distance>=wall)break;const e=hit.object.userData.enemy;if(!e||seen.has(e))continue;seen.add(e);
    const head=isHeadHit(hit,e),shield=!head&&frontHit(e,dir);hitAny=true;end=hit.point;
    let dmg=DAMAGE[weapon][head?1:0]*(mx.dm||1)*(head?(mx.hm||1):1)*falloff;if(weapon==='shotgun')dmg*=Math.max(.35,1-hit.distance/34);
    // The airdropped minigun is a horde weapon: boss armour soaks most of it (rules.MINIGUN_BOSS_MULT, in the boss TTK model).
    if(weapon==='minigun'&&e.boss)dmg*=MINIGUN_BOSS_MULT;
    if(applyDamage)hurtEnemy(e,dmg,head,dir,shooter);dealt+=dmg;
    if(applyDamage&&head&&shooter?.stats)shooter.stats.headshots++;if(shooter===player){if(settings.damageNumbers)overlay.damageNumber(hit.point,head?dmg:dmg*bodyFactor(e,dir),head);if(head)headshots++;if(shield&&Math.random()<.5)sound('switch',{rate:2.4,volume:.45});}
    particles(hit.point,shield?8:head?10:5,false,shield?'spark':e.type==='exploder'?'acid':'blood');
    if(pierce--<=0)break;falloff*=.6;
  }
  if(!hitAny&&wall<85)particles(end,3);
  return {hit:hitAny,end,dealt};
}
function dirAngle(from){const dx=from.x-player.pos.x,dz=from.z-player.pos.z,s=Math.sin(player.yaw),c=Math.cos(player.yaw);return Math.atan2(dx*c-dz*s,-dx*s-dz*c);}
function nearestEnemy(pos){let best=null,d=Infinity;for(const e of enemies){const n=e.mesh.position.distanceToSquared(pos);if(n<d){d=n;best=e;}}return best;}
let godMode=false;
function hurtPlayer(amount,from=null,quiet=false){if(net.role==='client'||player.health<=0||godMode||player.grace>0||phase==='victory')return;player.health=Math.max(0,player.health-amount);player.lastHurt=time;damageTime=quiet?Math.max(damageTime,.15):.35;postfx?.pulseDamage(quiet?amount*.5:amount);if(!quiet){shake=Math.max(shake,.14);sound('hurt');if(from)overlay.hurtFrom(dirAngle(from));}updateHUD();if(player.health<=0)onDown(player);}
function updateRegen(dt){if(net.role==='client')return;for(const q of [player,...squad.values()]){if(q.health<=0){q._hp=q.health;continue;}if(q._hp!==undefined&&q.health<q._hp-.01)q.lastHurt=time;const r=mods(q).regen;if(r&&time-(q.lastHurt??-99)>4&&q.health<maxHealth(q))heal(q,r*dt);q._hp=q.health;}}
const particleGeo=new THREE.BoxGeometry(.1,.1,.1),particleMat=new THREE.MeshBasicMaterial({color:0xffb24e}),impactMat=new THREE.MeshBasicMaterial({color:0xa8b790}),bloodMat=new THREE.MeshBasicMaterial({color:0x9a1712}),bloodDark=new THREE.MeshBasicMaterial({color:0x4f0907}),acidMat=new THREE.MeshBasicMaterial({color:0x9dff4a});
function particles(pos,count=7,explosive=false,kind=null){for(let i=0;i<count;i++){const mesh=new THREE.Mesh(particleGeo,kind==='blood'?(i%2?bloodMat:bloodDark):kind==='acid'?acidMat:explosive||kind==='spark'?particleMat:impactMat);mesh.position.copy(pos);mesh.scale.setScalar(explosive?1+Math.random()*3:.5+Math.random());scene.add(mesh);effects.push({mesh,life:explosive?.65:.23,max:explosive?.65:.23,vel:new THREE.Vector3((Math.random()-.5)*11,Math.random()*10-1,(Math.random()-.5)*11),type:'particle'});}}
function tracer(start,end){const geo=new THREE.BufferGeometry().setFromPoints([start,end]),mat=new THREE.LineBasicMaterial({color:0xffd48a,transparent:true,opacity:.7});const mesh=new THREE.Line(geo,mat);scene.add(mesh);effects.push({mesh,life:.055,max:.055,dispose:true,type:'line'});}
function isHeadHit(hit, enemy) {
  const u=enemy.mesh.userData;
  for(let node=hit.object;node&&node!==enemy.mesh;node=node.parent){
    if(node===u.head||u.sacs&&node===u.sacs)return true;
  }
  // Legacy regular zombies keep the v3 rule; bosses and new types use their measured head height.
  const y=enemy.mesh.worldToLocal(hit.point.clone()).y;
  return LEGACY_ANIM.has(enemy.type)&&!enemy.boss?y>1.48:y>(u.headY||1.5)-(u.height||1.9)*.07;
}
function fire(){
  // No firing while sprinting (or still lowering from a sprint), switching weapons or reviving a teammate.
  if(coopPaused||player.health<=0||player.sprinting||VM.sprint>.35||switching()||localReviving)return;const w=weapons[current],g=GUN[current],m=mods();
  // Firing interrupts a shell-by-shell shotgun reload once a round is loaded.
  if(reloadTime>0){if(reloadingWeapon==='shotgun'&&w.mag>0){reloadTime=0;reloadingWeapon=null;}else return;}
  if(shootCooldown>0)return;
  if(g.semi&&!semiReady)return; // semi-auto: one shot per trigger press
  if(w.mag<=0){reload();shootCooldown=.25;return;}
  w.mag--;shootCooldown=w.rate*(current==='ak'?m.fireRate:1);shotsFired++;if(g.semi)semiReady=false;
  shotKick=current==='rpg'?.24:current==='shotgun'?.2:current==='svd'?.2:current==='minigun'?.035:current==='smg'?.04:.07;
  camera.updateMatrixWorld();const origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3()),spread=currentSpread();
  if(current!=='rpg'){
    const shotgun=current==='shotgun',muzzle=w.mesh.localToWorld(w.mesh.userData.muzzle.clone()),mx=shotModsFor(player);let anyHit=false;
    if(!shotgun)jitter(direction,spread);
    for(let k=0;k<(g.pellets||1);k++){const dir=shotgun?jitter(direction.clone(),spread):direction;const r=hitscan(origin,dir,current,net.role!=='client',player,mx);if(r.hit)anyHit=true;fx.bullet(muzzle,r.end,shotgun);}
    if(net.role!=='client'){player.stats.shots++;if(anyHit)player.stats.hits++;}if(anyHit){shotsHit++;hitTime=Math.max(hitTime,.13);sound('hit');}
    flash.position.copy(camera.worldToLocal(muzzle.clone()));const fs_=shotgun?1.8:current==='svd'?1.5:current==='smg'?.8:1;flash.scale.set((.7+Math.random())*fs_,(.7+Math.random())*fs_,2);flash.rotation.z=Math.random()*6;flash.visible=!scoped();weaponLight.intensity=8;
    ejectCasing(w,g.shell);if(shotgun||Math.random()<.3)fx.smoke(muzzle);
    if(shotgun){sound('shot',{rate:.62});sound('shot',{rate:.42,volume:.7});shake=Math.max(shake,.13);}else{sound(SHOT_SOUND[current]||'shot');if(current==='svd')shake=Math.max(shake,.1);}
  }else {const mesh=createRocket();mesh.position.copy(origin).addScaledVector(direction,.9);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);scene.add(mesh);rockets.push({mesh,dir:direction,life:4,visualOnly:net.role==='client',owner:player});sound('rocket');shake=.15;}
  // Recoil climbs the view; most of it recovers once the trigger is released.
  const kv=g.kickV*(.8+Math.random()*.4)*m.recoil*(1-.3*VM.ads),kh=(Math.random()-.5)*2*g.kickH*m.recoil;
  player.pitch=Math.min(1.35,player.pitch+kv);player.yaw+=kh;recoilDebtV+=kv*g.recover;recoilDebtH+=kh*g.recover;bloom=Math.min(g.bloomMax,bloom+g.bloom);
  const shot={t:'shot',weapon:current,o:origin.toArray(),d:direction.toArray(),s:spread};if(net.role==='client')net.send(shot);else if(net.role==='host')net.broadcast({...shot,who:net.id});updateAmmoHUD();
}
function ejectCasing(w,kind){if(!kind)return;const p=w.mesh.localToWorld(new THREE.Vector3(.06,.06,-.12)),right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);fx.casing(p,right,up,kind);}
function throwGrenade(){
  if(!['active','break'].includes(phase)||coopPaused||player.health<=0||time-player.lastGrenade<.8)return;
  if(player.grenades<=0){toast('ГРАНАТ НЕТ · ПОПОЛНЕНИЕ МЕЖДУ ВОЛНАМИ');return;}
  camera.updateMatrixWorld();const origin=player.pos.clone(),direction=camera.getWorldDirection(new THREE.Vector3());
  if(net.role==='client'&&!net.send({t:'grenade',request:++grenadeRequest,o:origin.toArray(),d:direction.toArray()}))return;
  player.lastGrenade=time;player.grenades--;if(net.role!=='client')grenades.spawn({id:++enemyId,origin,direction,owner:player});
  sound('switch');shotKick=.12;toast('ГРАНАТА!',.9);updateHUD();
}
function remoteGrenade(m,q){
  if(!['active','break'].includes(phase)||q.health<=0||q.grenades<=0||time-q.lastGrenade<.8||!Number.isSafeInteger(m.request)||m.request<=q.grenadeRequest||!validVector(m.o)||!validVector(m.d))return;
  const origin=new THREE.Vector3(...m.o),direction=new THREE.Vector3(...m.d);
  if(origin.distanceTo(q.pos)>3||direction.length()<.8||direction.length()>1.2)return;
  q.grenadeRequest=m.request;q.lastGrenade=time;q.grenades--;grenades.spawn({id:++enemyId,origin:q.pos.clone(),direction:direction.normalize(),owner:q});
}
function explode(pos,visualOnly=false,opts={}){const power=opts.power||240,radius=opts.radius||8.5,pDmg=opts.playerDamage||14,pRad=opts.playerRadius||3.8;if(net.role==='host'&&!visualOnly)net.broadcast({t:'blast',p:pos.toArray()});sound('blast');particles(pos,30,true);shake=.4;const mat=new THREE.MeshBasicMaterial({color:0xffa543,transparent:true,opacity:.62,depthWrite:false}),mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),mat);mesh.position.copy(pos);scene.add(mesh);effects.push({mesh,life:.42,max:.42,type:'explosion',dispose:true});if(!visualOnly&&net.role!=='client')for(const e of [...enemies]){const center=e.mesh.position.clone();center.y=1;const d=pos.distanceTo(center);if(d<radius){hurtEnemy(e,blastDamage(d,radius,power),false,null,opts.owner||null);hitTime=.2;}}if(!visualOnly&&net.role!=='client')for(const q of aliveTargets()){const d=pos.distanceTo(q.pos);if(d<pRad)damageTarget(q,pDmg*(1-d/pRad),pos);}}
const pickupMats={health:new THREE.MeshStandardMaterial({color:0x97ba8b,emissive:0x395735,emissiveIntensity:.6}),ammo:new THREE.MeshStandardMaterial({color:0xc79a48,emissive:0x69471b,emissiveIntensity:.7})},pickupGeo=new THREE.BoxGeometry(.48,.38,.38);
// All pickup parts are shared (box, cross bars, materials), so removing a pickup never needs a dispose.
const pickupBarGeo=[new THREE.BoxGeometry(.22,.06,.015),new THREE.BoxGeometry(.06,.22,.015)],pickupBarMats={health:new THREE.MeshBasicMaterial({color:0xe8f3d7}),ammo:new THREE.MeshBasicMaterial({color:0xffdc93})};
function dropPickup(pos,type,id=++enemyId){if(!pickupMats[type])return;const mesh=new THREE.Group(),box=new THREE.Mesh(pickupGeo,pickupMats[type]);mesh.add(box);const barMat=pickupBarMats[type];for(let i=0;i<2;i++){const bar=new THREE.Mesh(pickupBarGeo[i],barMat);bar.position.z=.198;mesh.add(bar);}mesh.position.copy(pos);mesh.position.y=.6;scene.add(mesh);pickups.push({id,mesh,type,life:35});}
// ---- Player movement + first-person view model ----
// Sprint has hysteresis: emptying the stamina bar exhausts you until it refills to EXHAUST_RECOVER,
// so the sprint state cannot flicker around a threshold (the v3 jitter: stamina>2 toggled every frame).
// Every pose input is a blend eased toward its target (VM.sprint/ads/move/reload/sw/down), and one
// VM.step phase, advanced by the measured horizontal speed, drives both camera bob and weapon bob.
function updatePlayer(dt){
  updateRecoil(dt);const alive=player.health>0;let x=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joyX,z=(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0)+joyY;if(coopPaused||!alive){x=0;z=0;}const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}
  if(player.stamina<=0)player.exhausted=true;else if(player.stamina>=EXHAUST_RECOVER)player.exhausted=false;
  const sprint=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&len>.1&&!aim&&!shooting&&alive&&!player.exhausted;player.sprinting=sprint;
  if(sprint)player.stamina=Math.max(0,player.stamina-dt*23);else player.stamina=Math.min(100,player.stamina+dt*16);
  const sb=$('staminaBar');sb.style.width=player.stamina.toFixed(1)+'%';const tired=player.exhausted?'#ed714b':'';if(sb.style.background!==tired)sb.style.background=tired;
  if(player.slowT>0)player.slowT-=dt;
  const kb=blendK(dt,10),adsOn=aim&&alive&&!swapTo&&!(current==='svd'&&reloadTime>0);VM.sprint+=((sprint?1:0)-VM.sprint)*kb;VM.ads+=((adsOn?1:0)-VM.ads)*blendK(dt,GUN[current].adsRate||12);
  // Speed follows the blends, so walk/sprint/aim changes ramp instead of stepping.
  const speed=(4.8+3.2*VM.sprint-1.8*VM.ads)*mods().speed*(player.slowT>0?.5:1);player.moveSpeed=len*speed;
  const sin=Math.sin(player.yaw),cos=Math.cos(player.yaw),ox=player.pos.x,oz=player.pos.z;moveActor(player.pos,(x*cos+z*sin)*speed*dt,(-x*sin+z*cos)*speed*dt,.38);
  if(dt>0)VM.speed+=(Math.hypot(player.pos.x-ox,player.pos.z-oz)/dt-VM.speed)*blendK(dt,12);
  // Butcher hook: dragged toward the point he stood on, stops 2 m short.
  const pl=player.pull;if(pl&&pl.t>0){pl.t-=dt;const ux=pl.x-player.pos.x,uz=pl.z-player.pos.z,d=Math.hypot(ux,uz);if(d>2&&alive)moveActor(player.pos,ux/d*pl.v*dt,uz/d*pl.v*dt,.38);else pl.t=0;}
  if(keys.has('ArrowLeft'))player.yaw+=1.8*dt;if(keys.has('ArrowRight'))player.yaw-=1.8*dt;if(keys.has('ArrowUp'))player.pitch=Math.min(1.35,player.pitch+dt);if(keys.has('ArrowDown'))player.pitch=Math.max(-1.35,player.pitch-dt);
  const air=!player.grounded,vy0=player.vy;player.vy-=16*dt;player.pos.y+=player.vy*dt;if(player.pos.y<=1.72){player.pos.y=1.72;if(air){VM.land=Math.min(1,Math.max(0,-vy0)/9);VM.landT=0;}player.vy=0;player.grounded=true;}
  // One step = PI of phase; the stride lengthens with speed (walk ~2.1 steps/s, sprint ~2.9).
  if(player.grounded)VM.step+=VM.speed*dt*Math.PI/(1.6+VM.speed*.14);VM.move+=((player.grounded?Math.min(1,VM.speed/4.8):0)-VM.move)*kb;
  VM.landT+=dt;const ld=VM.landT<LAND_T?-Math.sin(VM.landT/LAND_T*Math.PI)*.09*VM.land:0;VM.down+=((alive||phase==='menu'?0:1)-VM.down)*blendK(dt,4);
  const amp=VM.move*(1-.75*VM.ads),vb=Math.cos(VM.step*2)*.5-.5,lb=Math.sin(VM.step),sc=scoped();
  camera.position.set(player.pos.x,player.pos.y+vb*(.05+.03*VM.sprint)*amp+ld-1.2*VM.down,player.pos.z);
  camera.rotation.set(player.pitch+shotKick*.13+(Math.random()-.5)*shake*.05+ld*.25+(sc?Math.sin(time*.8)*.0012:0),player.yaw+(Math.random()-.5)*shake*.05+(sc?Math.sin(time*.55+1)*.0012:0),lb*.005*amp*(1+VM.sprint)+.25*VM.down);
  VM.adsFov+=((current==='svd'?SVD_FOV:settings.fov*.72)-VM.adsFov)*kb;// Smoothstep on the eased blends: pose changes start and end with zero velocity.
  const baseFov=settings.fov+6*sstep(0,1,VM.sprint),fov=baseFov+(VM.adsFov-baseFov)*sstep(0,1,VM.ads);if(Math.abs(camera.fov-fov)>.005){camera.fov=fov;camera.updateProjectionMatrix();}
  $('crosshair').style.setProperty('--gap',(4+currentSpread()*700).toFixed(1)+'px');$('crosshair').classList.toggle('hidden',(VM.ads>.5&&current!=='shotgun')||VM.sprint>.5||!alive||sc);$('heading').textContent=String(Math.round(((player.yaw*180/Math.PI)%360+360)%360)).padStart(3,'0');
  // Weapon switch: lower, swap at the bottom, raise.
  if(swapTo&&current!==swapTo){VM.sw=Math.min(1,VM.sw+dt/SWITCH_LOWER);if(VM.sw>=1)finishSwap();}else{VM.sw=Math.max(0,VM.sw-dt/SWITCH_RAISE);if(swapTo&&VM.sw<=0)swapTo=null;}
  const reloading=reloadTime>0&&reloadingWeapon===current;if(reloading){VM.rp=1-reloadTime/(reloadTotal||1);VM.rw=current;}VM.reload+=((reloading?1:0)-VM.reload)*kb;
  for(const [name,w] of WEAPON_LIST)w.mesh.visible=name===current&&!sc&&VM.down<.97;
  poseWeapon(weapons[current],current,dt,amp,vb,lb,ld);
}
// Weapon pose = hip/ADS blend + sprint carry + bob + sway + recoil + switch drop + landing + reload.
function poseWeapon(w,name,dt,amp,vb,lb,ld){
  const m=w.mesh,u=m.userData,ads=ADS[name]||[.11,0],a=sstep(0,1,VM.ads),s=sstep(0,1,VM.sprint)*(1-a),sw=sstep(0,1,VM.sw),kb=1-a*.8;
  let px=.31+(ads[0]-.31)*a-swayX+lb*.012*amp*kb*(1+s*.6),py=-.32+ads[1]*a+swayY+Math.sin(time*1.9)*.003*(1-VM.move)+vb*.016*amp*kb*(1+s*.5)-s*.1-sw*.3+ld*.5-VM.down*.4,pz=-.52+shotKick*(1-.4*a)+s*.03;
  let rx=shotKick*.7-s*.45-sw*.8+ld*.6,ry=s*.6+swayX*1.5,rz=-swayX*.8+lb*.02*amp*kb+s*.08;
  // Reloads: the overall tilt eases with VM.reload (so an interrupted reload settles smoothly);
  // moving parts follow the progress p: shotgun per-shell push, mag out/in, bolt pull on empty, RPG tube lowered.
  const rl=VM.reload,p=VM.rw===name?VM.rp:0,env=rl*plateau(p,.15,.85);let mag=0,bolt=0;
  if(name==='shotgun'){const push=bump(p,.45,.85)*rl;py+=-.05*rl+.025*push;pz-=.02*push;rx+=.18*rl+.07*push;rz-=.45*rl;px-=.03*rl;}
  else if(name==='rpg'){py-=.36*env;rx-=.75*env;rz-=.2*env;}
  else if(name!=='minigun'){mag=rl*(sstep(.12,.38,p)-sstep(.52,.78,p));py-=.07*env;rx+=(name==='svd'?.18:.3)*env;rz-=(name==='svd'?.42:.5)*env;px-=.03*env;if(VM.empty)bolt=rl*bump(p,.82,.96);if(name==='ak'&&VM.empty)py+=.012*rl*bump(p,.84,.94);}
  if(name==='svd')bolt=Math.max(bolt,Math.max(0,shootCooldown-(w.rate-.12))/.12);else if(name==='smg'&&shootCooldown>0)bolt=Math.max(bolt,shootCooldown/w.rate*.7);
  if(u.mag){if(!u.magRest)u.magRest=u.mag.position.clone();u.mag.position.set(u.magRest.x,u.magRest.y-mag*(name==='svd'?.26:.32),u.magRest.z-mag*(name==='smg'?.1:.04));u.mag.rotation.x=mag*.35;}
  if(u.bolt){if(!u.boltRest)u.boltRest=u.bolt.position.clone();u.bolt.position.z=u.boltRest.z+bolt*(name==='svd'?.09:.06);}
  if(u.pump){const t=Math.max(0,Math.min(1,(shootCooldown-.3)/.48));u.pump.position.z=-.42+Math.sin(t*Math.PI)*.13;}
  if(u.barrels)u.barrels.rotation.z+=dt*(shooting?50:3);
  m.position.set(px,py,pz);m.rotation.set(rx,ry,rz);
}
// ---- Shared zombie animation: host and clients run the same code, so motion matches ----
// Actions (attack swipe, telegraphs, boss moves) are synced in snapshots as an:[code,seq,t].
// Every action envelope starts and ends at a zero offset, so nothing snaps.
const ACT={attack:1,spit:2,scream:3,hook:4,birth:5,windup:6,charge:7,slam:8,throw:9,cleave:10,roar:11,dash:12};
const ACT_TIME=[0,.42,.65,1.4,.55,.85,1,1.2,.5,.6,.95,1,.6];
// Metres covered per walk cycle (two steps): the cycle advances with the measured ground speed (no moonwalking).
const STRIDE={walker:1.25,runner:2,brute:1.55,exploder:1.3,crawler:.85,spitter:1.35,screamer:1.7,armored:1.2,boss:2.7,titan:2.7,brood:2.2,butcher:2.3,father:3.8};
function setAct(e,code){e.act=code;e.actT=0;e.actSeq=((e.actSeq||0)%4095)+1;}
function setJoint(j,r,x,y=0,z=0){if(j)j.rotation.set((r?r[0]:0)+x,(r?r[1]:0)+y,(r?r[2]:0)+z);}
// Piecewise swing: rises to `up` by k1, swings through to `down` by k2, settles back to 0 at 1.
function swing(k,up,down,k1=.4,k2=.65){return k<k1?up*k/k1:k<k2?up+(down-up)*(k-k1)/(k2-k1):down*(1-(k-k2)/(1-k2));}
function animateZombie(e,dt){
  const m=e.mesh,u=m.userData,r=u.rest||{},t=e.type,p=m.position;
  if(!u.restY){u.restY={};for(const n of ['torso','head','leftArm','rightArm'])if(u[n])u.restY[n]=u[n].position.y;}
  if(e.ax===undefined){e.ax=p.x;e.az=p.z;e.mv=0;e.step=e.step||0;}
  const moved=Math.hypot(p.x-e.ax,p.z-e.az);e.ax=p.x;e.az=p.z;if(dt>0)e.mv+=(Math.min(14,moved/dt)-e.mv)*Math.min(1,dt*8);
  const L=STRIDE[t]||1.3,amp=Math.min(1,e.mv/(L*.9));e.step+=e.mv*dt*Math.PI*2/L;
  if(e.act){e.actT=(e.actT||0)+dt;if(e.actT>=ACT_TIME[e.act])e.act=0;}
  const a=e.act||0,k=a?Math.min(1,e.actT/ACT_TIME[a]):0,env=Math.sin(k*Math.PI),s=Math.sin(e.step),c=Math.cos(e.step),tm=time+(e.id||0)*1.37;
  const breath=Math.sin(tm*2.2)*.025,tw=Math.sin(tm*.73)*Math.sin(tm*2.9+1);
  // Base walk: legs swing, arms reach with a phase offset, torso sways, head lolls and twitches.
  let lL=s*.5*amp,rL=-s*.5*amp,lA=Math.sin(e.step+.9)*.2*amp+Math.sin(tm*1.7)*.05,rA=-Math.sin(e.step+.9)*.2*amp+Math.sin(tm*1.9+1)*.05,lZ=0,rZ=0,tX=breath,tY=0,tZ=s*.05*amp+Math.sin(tm*1.1)*.025,hX=breath*.6,hY=Math.sin(tm*.9)*.14,hZ=tw>.72?(tw-.72)*1.6:Math.sin(tm*.6)*.05,jaw=Math.max(0,Math.sin(tm*1.3))*.08,bob=(Math.abs(c)-.6)*.05*amp;
  if(LEGACY_ANIM.has(t)){lA+=.35;rA+=.3;} // v3 rigs keep their lower reaching pose
  switch(t){
    case 'runner':lL*=1.25;rL*=1.25;lA=.55+s*.75*amp;rA=.5-s*.75*amp;tX+=.2*amp;hX-=.15*amp;bob*=1.5;break;
    case 'brute':case 'boss':case 'titan':case 'father':tZ+=s*.13*amp;lA+=s*.1*amp;rA-=s*.1*amp;bob=(Math.pow(Math.abs(c),4)-.4)*.09*amp;lL*=.85;rL*=.85;hY*=.5;break;
    case 'crawler':lL=.1+s*.12*amp;rL=.1-s*.12*amp;lA=s*.55*amp;rA=-s*.55*amp;lZ=-Math.max(0,c)*.3*amp;rZ=Math.max(0,-c)*.3*amp;tZ=s*.1*amp;tX=breath;bob=Math.abs(s)*.03*amp;hX=-.1*Math.abs(c)*amp;hY*=.5;break;
    case 'spitter':if(u.throat)u.throat.scale.setScalar(a===ACT.spit?1+.75*(k<.75?k/.75:(1-k)/.25):1+Math.sin(tm*3.1)*.07);break;
    case 'screamer':lA*=.5;rA*=.5;break;
    case 'armored':lA=Math.sin(tm*1.3)*.03;break; // the shield arm stays up
    case 'brood':tZ=s*.09*amp+Math.sin(tm*.8)*.04;bob*=.6;lL*=.7;rL*=.7;break;
  }
  if(a===ACT.attack){const o=swing(k,-1.4,.6,.35,.7);if(t==='armored')rA+=o;else{lA+=o;rA+=o*(t==='runner'?.6:.9);}tX+=swing(k,-.1,.22,.35,.7);}
  else if(a===ACT.spit){tX+=swing(k,-.5,.3,.7,.85);hX+=swing(k,-.4,.25,.7,.85);lA-=env*.3;rA-=env*.3;}
  else if(a===ACT.scream||a===ACT.roar){const f=a===ACT.roar?env:k<.57?k/.57:k<.85?1:(1-k)/.15;jaw+=f*.75;lA-=f*.6;rA-=f*.6;lZ-=f*.8;rZ+=f*.8;tX-=f*.25;hX-=f*.35;if(f>.95)hY+=Math.sin(tm*40)*.08;}
  else if(a===ACT.birth){tX+=Math.sin(k*Math.PI*4)*.12*env;jaw+=env*.5;lZ-=env*.5;rZ+=env*.5;bob+=Math.sin(k*30)*.03*env;}
  else if(a===ACT.windup){const f=Math.min(1,k/.25);lA-=2*f;rA-=2*f;tX-=.2*f;e.flash=Math.max(e.flash||0,.08);}
  else if(a===ACT.charge){const f=Math.min(1,k/.08,(1-k)/.1);lA-=.9*f;rA-=.9*f;tX+=.35*f;hX-=.2*f;}
  else if(a===ACT.slam){const o=swing(k,-2.2,.4,.4,.6);lA+=o;rA+=o;tX+=swing(k,-.15,.3,.4,.6);}
  else if(a===ACT.throw){rA+=swing(k,-2.6,.4,.5,.75);tY+=env*.3;}
  else if(a===ACT.hook){lA+=swing(k,.7,-1.7,.45,.7);tY-=env*.35;}
  else if(a===ACT.cleave){const q=k<.5?k/.5:(k-.5)/.5;rA+=swing(q,-2.3,.4,.4,.6);tY+=Math.sin(q*Math.PI)*(k<.5?.25:-.25);tX+=Math.sin(q*Math.PI)*.12;}
  else if(a===ACT.dash){const f=Math.min(1,k/.1,(1-k)/.15);tX+=.45*f;lA+=.5*f;rA+=.5*f;}
  // Stagger flinch: upper body jerks back.
  const sg=Math.min(1,Math.max(0,e.stagger||0)*4);if(sg>0){tX-=.35*sg;hX-=.35*sg;lA-=.5*sg;rA-=.4*sg;}m.rotation.x=-.16*sg;
  setJoint(u.leftLeg,r.leftLeg,lL);setJoint(u.rightLeg,r.rightLeg,rL);setJoint(u.leftArm,r.leftArm,lA,0,lZ);setJoint(u.rightArm,r.rightArm,rA,0,rZ);setJoint(u.torso,r.torso,tX,tY,tZ);setJoint(u.head,r.head,hX,hY,hZ);if(u.jaw)setJoint(u.jaw,r.jaw,jaw);
  for(const n in u.restY)u[n].position.y=u.restY[n]+bob;
  if(u.hook){const out=hooks.some(h=>h.owner===e.id);if(u.hook.visible===out)u.hook.visible=!out;}
}
// Screamer buff: red-hot eyes/glow on every buffed zombie (host: buffT, clients: snapshot flag).
function updateGlow(e){const on=e.buffT>0||!!e.buff;if(on===!!e.glowOn)return;e.glowOn=on;for(const m of e.mesh.userData.glowMats||[]){if(on){m.emissive.setRGB(1,.1,.05);m.emissiveIntensity=Math.max(2.2,m.userData.baseGlow*1.4);}else{m.emissive.copy(m.userData.baseEmissive);m.emissiveIntensity=m.userData.baseGlow;}}}
function turnTo(a,b,k){const d=((b-a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;return a+d*Math.min(1,k);}
function damageTarget(q,amount,from=null,quiet=false){if(!q||q.health<=0||!(amount>0)||net.role==='client')return;if(q===player){hurtPlayer(amount,from,quiet);return;}if(q.grace>0||phase==='victory')return;q.health=Math.max(0,q.health-amount);if(q.health<=0)onDown(q);}
// ---- Enemy brains (host only). (e, dt, target, dist, dx, dz) → true while the brain controls movement ----
// Timed abilities: windup() starts a telegraph (a synced action code), then fireAbility() runs it.
function windup(e,kind,t,act,target=null){e.pendKind=kind;e.pendT=t;e.pendTarget=target;setAct(e,act);return true;}
function pendingTick(e,dt,target){if(!(e.pendT>0))return false;e.pendT-=dt;const tg=e.pendTarget&&e.pendTarget.health>0?e.pendTarget:target,p=e.mesh.position;e.mesh.rotation.y=turnTo(e.mesh.rotation.y,Math.atan2(tg.pos.x-p.x,tg.pos.z-p.z),dt*8);if(e.pendT<=0){const kind=e.pendKind;e.pendKind=null;e.pendTarget=null;fireAbility(e,kind,tg);}return true;}
function fireAbility(e,kind,target){if(!enemies.includes(e)||phase!=='active')return;if(kind==='spit')launchGlobs(e,target,1);else if(kind==='fan')launchGlobs(e,target,5);else if(kind==='scream')doScream(e);else if(kind==='birth')broodBirth(e);else if(kind==='hook')throwHook(e,target);}
// Ranged types hold a distance band: retreat when too close, strafe inside the band, walk in when far.
function keepDistance(e,dt,dist,dx,dz,lo,hi,retreat){
  if(dist>hi||dist<1.8)return false;
  const p=e.mesh.position,n=dist||1,ux=dx/n,uz=dz/n;e.mesh.rotation.y=turnTo(e.mesh.rotation.y,Math.atan2(dx,dz),dt*10);
  e.strafeT=(e.strafeT||0)-dt;if(e.strafeT<=0){e.strafeT=1.4+Math.random()*2.2;e.strafe=Math.random()<.2?0:Math.random()<.5?-1:1;}
  const back=dist<retreat?1:dist<lo?.45:0,mx=-ux*back-uz*(e.strafe||0)*.75,mz=-uz*back+ux*(e.strafe||0)*.75,len=Math.hypot(mx,mz);if(len<.01)return true;
  const step=e.speed*(back>=1?1:.55)*(e.buffT>0?1+(e.buffAmt||.35):1)*dt;if(!moveActor(p,mx/len*step,mz/len*step,e.radius))e.strafe=-(e.strafe||1);return true;
}
function spitterThink(e,dt,target,dist,dx,dz){if(pendingTick(e,dt,target))return true;e.spitCd=(e.spitCd??1.2+Math.random()*2)-dt;if(e.spitCd<=0&&dist>4&&dist<22&&target.pos.y<4){e.spitCd=e.stats?.spitEvery||3.5;return windup(e,'spit',.5,ACT.spit,target);}const I=ENEMY_INFO.spitter;return keepDistance(e,dt,dist,dx,dz,I.range?.[0]||9,I.range?.[1]||16,I.retreat||7);}
function screamerThink(e,dt,target,dist,dx,dz){if(pendingTick(e,dt,target))return true;e.screamCd=(e.screamCd??3+Math.random()*3)-dt;if(e.screamCd<=0&&dist<28){e.screamCd=e.stats?.screamEvery||8;return windup(e,'scream',.8,ACT.scream,target);}const I=ENEMY_INFO.screamer;return keepDistance(e,dt,dist,dx,dz,I.range?.[0]||12,I.range?.[1]||20,9);}
// Матка: births crawlers and fires acid fans; enraged (<50%) births faster and leaves bigger pools.
function broodThink(e,dt,target,dist){if(pendingTick(e,dt,target))return true;const st=e.stats||{};e.birthCd=(e.birthCd??3)-dt;e.fanCd=(e.fanCd??2)-dt;if(e.birthCd<=0){e.birthCd=(st.birthEvery||6)*(e.enraged?.6:1);return windup(e,'birth',.8,ACT.birth,target);}if(e.fanCd<=0&&dist>3.5&&dist<24){e.fanCd=(st.spitEvery||4)*(e.enraged?.8:1);return windup(e,'fan',.55,ACT.spit,target);}return false;}
// Мясник: hook throw at 6–20 m (pull + slow), two-swing cleaver combo up close, fast dashes.
function butcherThink(e,dt,target,dist,dx,dz){
  const p=e.mesh.position,st=e.stats||{};if(pendingTick(e,dt,target))return true;
  if(e.cleaveT>0){e.cleaveT-=dt;const el=.95-e.cleaveT;e.mesh.rotation.y=turnTo(e.mesh.rotation.y,Math.atan2(dx,dz),dt*4);if(e.cleaveHits===0&&el>=.34||e.cleaveHits===1&&el>=.8){e.cleaveHits++;cleaveStrike(e);}if(e.cleaveT<=0)e.cleaveCd=1.6;return true;}
  if(e.dashT>0){e.dashT-=dt;const step=e.speed*2.6*dt;if(!moveActor(p,e.ddx*step,e.ddz*step,e.radius))e.dashT=0;for(const q of aliveTargets())if(!e.dashHit.has(q)&&Math.hypot(q.pos.x-p.x,q.pos.z-p.z)<1.8&&q.pos.y<2.6){e.dashHit.add(q);damageTarget(q,e.damage*.7,p);}return true;}
  e.hookCd=(e.hookCd??3)-dt;e.dashCd=(e.dashCd??5)-dt;e.cleaveCd=(e.cleaveCd??0)-dt;const range=st.hookRange||[6,20];
  if(dist<2.3+e.radius&&e.cleaveCd<=0&&target.pos.y<2.6){e.cleaveT=.95;e.cleaveHits=0;setAct(e,ACT.cleave);return true;}
  if(e.hookCd<=0&&dist>=range[0]&&dist<=range[1]&&target.pos.y<4&&!hooks.some(h=>h.owner===e.id)&&clearLine(p,target.pos,dist)){e.hookCd=st.hookEvery||6;return windup(e,'hook',.32,ACT.hook,target);}
  if(e.dashCd<=0&&dist>5&&dist<13){e.dashCd=4.5+Math.random()*2;e.dashT=.55;const n=dist||1;e.ddx=dx/n;e.ddz=dz/n;e.dashHit=new Set();e.mesh.rotation.y=Math.atan2(dx,dz);setAct(e,ACT.dash);sfx('dash',p);return true;}
  return false;
}
function cleaveStrike(e){const p=e.mesh.position,ry=e.mesh.rotation.y,fx_=Math.sin(ry),fz=Math.cos(ry);sfx('cleave',p);for(const q of aliveTargets()){const dx=q.pos.x-p.x,dz=q.pos.z-p.z,d=Math.hypot(dx,dz);if(d<2.7+e.radius*.5&&q.pos.y<2.6&&(dx*fx_+dz*fz)/(d||1)>.2)damageTarget(q,e.damage,p);}}
// Отец Орды: phase 1 = Titan moves; phase 2 adds acid fans and crawler births; phase 3 adds screams
// that buff the horde, and faster charges (bossThink's rage factor + charge speed).
function fatherThink(e,dt,target,dist,dx,dz){
  if(pendingTick(e,dt,target))return true;if(e.windup>0||e.charging>0)return bossThink(e,dt,target,dist,dx,dz);
  if(e.phase>=1){e.fanCd=(e.fanCd??2.5)-dt;e.birthCd=(e.birthCd??4)-dt;if(e.fanCd<=0&&dist>5&&dist<26){e.fanCd=e.phase>=2?4.2:5.5;return windup(e,'fan',.7,ACT.spit,target);}if(e.birthCd<=0){e.birthCd=8.5;return windup(e,'birth',.8,ACT.birth,target);}}
  if(e.phase>=2){e.screamCd=(e.screamCd??1.5)-dt;if(e.screamCd<=0){e.screamCd=e.stats?.screamEvery||8;return windup(e,'scream',.8,ACT.scream,target);}}
  return bossThink(e,dt,target,dist,dx,dz);
}
function clearLine(from,to,dist){const o=new THREE.Vector3(from.x,1.6,from.z),d=new THREE.Vector3(to.x-o.x,to.y-.3-o.y,to.z-o.z).normalize();raycaster.set(o,d);return obstacleDistance(o,d,dist+1)>=dist-.5;}
const BRAINS={boss:bossThink,titan:bossThink,father:fatherThink,spitter:spitterThink,screamer:screamerThink,brood:broodThink,butcher:butcherThink};
function updateEnemies(dt){for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];if(!e)continue;thinkEnemy(e,dt);if(phase==='gameover')break;}}
function thinkEnemy(e,dt){
  const p=e.mesh.position,target=nearestTarget(p),dx=target.pos.x-p.x,dz=target.pos.z-p.z,dist=Math.hypot(dx,dz);
  if(radio.dancing(p)){e.mesh.rotation.y=Math.atan2(radio.state.x-p.x,radio.state.z-p.z);dancePose(e.mesh,radio.state.elapsed,e.id);return;}
  e.mesh.rotation.z=0;if(radio.still())return;
  if(e.buffT>0)e.buffT-=dt;
  if(e.hitPend>0){e.hitPend-=dt;if(e.hitPend<=0)meleeLand(e);if(phase==='gameover')return;}
  if(e.stagger>0){e.stagger-=dt;moveActor(p,(e.kx||0)*dt,(e.kz||0)*dt,e.radius);e.kx=(e.kx||0)*.86;e.kz=(e.kz||0)*.86;animateZombie(e,dt);return;}
  if(e.type==='runner'){e.lungeCd=(e.lungeCd||0)-dt;if(e.lunge>0)e.lunge-=dt;else if(e.lungeCd<=0&&dist<5.5&&dist>1.8){e.lunge=.55;e.lungeCd=3.2;}}
  if(e.type==='exploder'&&dist<1.9&&target.pos.y<2.5){killEnemy(e);return;}
  const brain=BRAINS[e.type];if(brain&&brain(e,dt,target,dist,dx,dz)){if(enemies.includes(e))animateZombie(e,dt);return;}
  if(!enemies.includes(e)||phase==='gameover')return;
  e.attack-=dt;e.mesh.rotation.y=Math.atan2(dx,dz);const reach=1.25+e.radius*.4;
  if(dist>reach){e.navTimer=(e.navTimer||0)-dt;if(e.navTimer<=0||!e.navDir){e.navDir=(target.nav||navigator).direction(p.x,p.z,target.pos.x,target.pos.z,e.radius);e.navTimer=.3;}let mx=e.navDir.x,mz=e.navDir.z;for(let j=0;j<enemies.length;j++){const other=enemies[j];if(other===e)continue;const sx=p.x-other.mesh.position.x,sz=p.z-other.mesh.position.z,d2=sx*sx+sz*sz;if(d2<1.3&&d2>.001){mx+=sx/d2*.6;mz+=sz/d2*.6;}}
    const n=Math.max(1,Math.hypot(mx,mz));mx/=n;mz/=n;const step=e.speed*(e.lunge>0?2.4:1)*(e.buffT>0?1+(e.buffAmt||.35):1)*dt,ox=p.x,oz=p.z;moveActor(p,mx*step,mz*step,e.radius);if((p.x-ox)**2+(p.z-oz)**2<step*step*.1){e.stuck+=dt;const tangentX=-mz*e.turn,tangentZ=mx*e.turn;moveActor(p,tangentX*step,tangentZ*step,e.radius);if(e.stuck>2){e.turn*=-1;e.stuck=0;e.navTimer=0;}}else e.stuck=0;
  }else if(e.attack<=0&&target.pos.y<2.5&&e.damage>0){e.attack=.85+Math.random()*.3;setAct(e,ACT.attack);e.hitPend=.2;e.hitTarget=target;}
  animateZombie(e,dt);
}
// The swipe lands .2 s after it starts (when the arms come down) if the target is still in reach.
function meleeLand(e){const q=e.hitTarget;e.hitTarget=null;if(!q||q.health<=0||!enemies.includes(e))return;const p=e.mesh.position;if(Math.hypot(q.pos.x-p.x,q.pos.z-p.z)>2.15+e.radius*.4||q.pos.y>=2.6)return;damageTarget(q,e.damage,p);}
// ---- Hazards: acid globs + pools, screams, butcher hooks. Host simulates the gameplay; clients
// replay the same projectiles from event packets ('spit', 'scream', 'hook', 'hooked'), visual only.
const HOOK_CLEAVE_CD=1.2,globs=[],pools=[],hooks=[],GLOB_G=16,GLOB_T=1.1,HOOK_FWD=new THREE.Vector3(0,0,1),tmpA=new THREE.Vector3(),tmpB=new THREE.Vector3();
const globGeo=new THREE.IcosahedronGeometry(.2,1),globMat=new THREE.MeshBasicMaterial({color:0xc8ff6a});
const poolGeo=new THREE.CircleGeometry(1,28),poolMat=new THREE.MeshBasicMaterial({color:0x6cff22,transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-3});
const hookGeo=new THREE.TorusGeometry(.17,.045,6,12,Math.PI*1.35),chainGeo=new THREE.BoxGeometry(.04,.04,1),hookMat=new THREE.MeshStandardMaterial({color:0x9aa0a6,metalness:.85,roughness:.3}),chainMat=new THREE.MeshStandardMaterial({color:0x55595d,metalness:.75,roughness:.45});
let acidFx=0,screamFx=0,acidSnd=0;
function fnum(v,d,lo,hi){const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d;}
function launchGlobs(e,target,n){
  const p=e.mesh.position,u=e.mesh.userData,st=e.stats||{},o=new THREE.Vector3(p.x,e.type==='spitter'?1.7:Math.max(1.6,(u.headY||2)*.82),p.z),tx=target.pos.x-o.x,tz=target.pos.z-o.z,d=Math.min(20,Math.hypot(tx,tz))||1,base=Math.atan2(tx,tz),vs=[];
  o.x+=Math.sin(base)*(e.radius||.4);o.z+=Math.cos(base)*(e.radius||.4);
  for(let i=0;i<n;i++){const ang=base+(n>1?(i-(n-1)/2)*.26:0)+(Math.random()-.5)*.05,dd=Math.max(1,d*(n>1?.92+Math.random()*.16:1)+(Math.random()-.5)*.8-(e.radius||.4));vs.push([+(Math.sin(ang)*dd/GLOB_T).toFixed(3),+((.1-o.y+.5*GLOB_G*GLOB_T*GLOB_T)/GLOB_T).toFixed(3),+(Math.cos(ang)*dd/GLOB_T).toFixed(3)]);}
  const big=e.enraged&&e.type==='brood'?1.5:1,spec={o:o.toArray().map(x=>+x.toFixed(2)),vs,dmg:st.acid||config.acidDamage||10,r:st.acidRadius||2.4,pr:+((st.poolRadius||1.8)*big).toFixed(2),pt:st.poolTime||4,dps:st.poolDps||config.acidPoolDps||10};
  spawnGlobs(spec,true);if(net.role==='host')net.broadcast({t:'spit',...spec});
}
// A fan volley shares one hit set (vol): each target takes impact damage from at most one glob of the volley.
function spawnGlobs(s,live){const o=new THREE.Vector3(...s.o),vol=live&&s.vs.length>1?new Set():null;sound('spit',{distance:o.distanceTo(player.pos)*.5});for(const v of s.vs){if(globs.length>=40)break;const mesh=new THREE.Mesh(globGeo,globMat);mesh.position.copy(o);scene.add(mesh);globs.push({mesh,v:new THREE.Vector3(...v),life:3,live,vol,dmg:s.dmg,r:s.r,pr:s.pr,pt:s.pt,dps:s.dps});}}
function insideCollider(p){if(Math.abs(p.x)>37.5||Math.abs(p.z)>37.5)return true;for(const b of world.colliders)if(p.y<=(b.height||3.2)&&Math.abs(p.x-b.x)<b.hx&&Math.abs(p.z-b.z)<b.hz)return true;return false;}
function updateGlobs(dt){for(let i=globs.length-1;i>=0;i--){const g=globs[i],p=g.mesh.position;g.v.y-=GLOB_G*dt;p.addScaledVector(g.v,dt);g.life-=dt;g.mesh.rotation.x+=dt*7;if(Math.random()<dt*12)particles(p,1,false,'acid');const wall=insideCollider(p);if(p.y>.12&&!wall&&g.life>0)continue;if(wall){p.x-=g.v.x*dt*1.5;p.z-=g.v.z*dt*1.5;}scene.remove(g.mesh);globs.splice(i,1);landGlob(g,p.x,p.z);}}
function landGlob(g,x,z){const at=new THREE.Vector3(x,.3,z),dl=Math.hypot(player.pos.x-x,player.pos.z-z);particles(at,10,false,'acid');sound('acid',{distance:dl*.5});addPool(x,z,g.pr,g.pt,g.dps);if(dl<g.r&&player.pos.y<3&&player.health>0)acidFx=1;if(g.live)for(const q of aliveTargets()){if(g.vol?.has(q))continue;const d=Math.hypot(q.pos.x-x,q.pos.z-z);if(d<g.r&&q.pos.y<3){g.vol?.add(q);damageTarget(q,g.dmg*(1-.5*d/g.r),at);}}}
function addPool(x,z,r,t,dps){if(pools.length>=24){const old=pools.shift();scene.remove(old.mesh);old.mesh.material.dispose();}const mesh=new THREE.Mesh(poolGeo,poolMat.clone());mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.03+Math.random()*.01,z);mesh.scale.setScalar(r*.3);scene.add(mesh);pools.push({mesh,x,z,r,life:t,max:t,dps});}
// Pools tick damage every ~4 HP (quiet: no hurt sound spam); the strongest pool under a player counts.
function updatePools(dt){
  let local=false;for(let i=pools.length-1;i>=0;i--){const pl=pools[i];pl.life-=dt;if(pl.life<=0){scene.remove(pl.mesh);pl.mesh.material.dispose();pools.splice(i,1);continue;}const age=pl.max-pl.life;pl.mesh.material.opacity=.5*Math.min(1,pl.life/.8)+Math.sin(time*6+i)*.05;pl.mesh.scale.setScalar(pl.r*(.3+.7*Math.min(1,age/.25)));if(Math.random()<dt*2.5)particles(new THREE.Vector3(pl.x+(Math.random()-.5)*pl.r,.1,pl.z+(Math.random()-.5)*pl.r),1,false,'acid');if(player.health>0&&player.pos.y<2.6&&Math.hypot(player.pos.x-pl.x,player.pos.z-pl.z)<pl.r)local=true;}
  if(local){acidFx=Math.max(acidFx,.35);acidSnd-=dt;if(acidSnd<=0){acidSnd=.7;sound('acid',{volume:.45,rate:1.2});}}else acidSnd=0;
  if(net.role==='client'||!pools.length)return;
  for(const q of aliveTargets()){if(q.pos.y>=2.6){continue;}let dps=0;for(const pl of pools)if(Math.hypot(q.pos.x-pl.x,q.pos.z-pl.z)<pl.r)dps=Math.max(dps,pl.dps);if(!dps)continue;q.acidAcc=(q.acidAcc||0)+dps*dt;if(q.acidAcc>=4){const d=q.acidAcc;q.acidAcc=0;damageTarget(q,d,null,true);}}
}
function ringFx(p,color,grow,life=.5,y=.08){const mesh=new THREE.Mesh(new THREE.RingGeometry(.6,1.1,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(p.x,y,p.z);scene.add(mesh);effects.push({mesh,life,max:life,type:'ring',grow,dispose:true});}
// Scream: nearby zombies (not bosses) get +35% speed for 5 s; players within 18 m get shake + audio duck.
function doScream(e){const p=e.mesh.position,st=e.stats||{},R=st.screamRadius||14,T=st.screamTime||5,B=st.screamBuff||.35;for(const o of enemies){if(o===e||o.boss)continue;if(Math.hypot(o.mesh.position.x-p.x,o.mesh.position.z-p.z)<R){o.buffT=T;o.buffAmt=B;}}const big=e.type==='father';screamVisual(p,big,st.screamShakeRadius||18);if(net.role==='host')net.broadcast({t:'scream',p:p.toArray(),big:big?1:0,sr:st.screamShakeRadius||18});}
function screamVisual(p,big,shakeR=18){const d=Math.hypot(p.x-player.pos.x,p.z-player.pos.z);sound('scream',{distance:d*.35,volume:big?1:.9,rate:big?.72:1});ringFx(p,0xff4a3a,big?18:13,.75,.1);ringFx(p,0xffb09a,big?12:8,.45,1.4);if(d<shakeR&&player.health>0){shake=Math.max(shake,.45*(1-d/shakeR)+.12);audioEngine.duck(.55,.8);screamFx=1.3;}}
// Positional one-shots shared with clients through {t:'sfx'} (ty = boss type for the boss callouts:
// 'bossin' arrival, 'summon' minion call, 'stun' wall-crash window).
function sfx(kind,p,send=true,ty=null){const d=Math.hypot(p.x-player.pos.x,p.z-player.pos.z),bn=enemyName(BOSS_SET.has(ty)?ty:'boss');if(kind==='bossin'){sound('blast',{rate:.5});shake=Math.max(shake,.5);toast(`${bn} НА ПОЛЕ БОЯ`,3);}else if(kind==='summon'){sound('roar',{rate:.8,distance:d*.3});toast(`${bn} ЗОВЁТ ОРДУ`,1.6);}else if(kind==='stun')toast(`${bn} ОГЛУШЁН — БЕЙ В ГОЛОВУ!`,1.5);else if(kind==='brood'){sound('brood',{distance:d*.4});particles(new THREE.Vector3(p.x,1,p.z),16,false,'acid');if(d<45)toast('ВЫВОДОК ПОЛЗУНОВ!',1.3);}else if(kind==='crawl')sound('crawl',{distance:d*.5,volume:.6});else if(kind==='cleave')sound('hook',{distance:d*.4,rate:1.6,volume:.7});else if(kind==='dash')sound('roar',{distance:d*.4,rate:1.35,volume:.55});if(send&&net.role==='host')net.broadcast({t:'sfx',k:kind,p:[+p.x.toFixed(2),+(p.y||0).toFixed(2),+p.z.toFixed(2)],...(ty?{ty}:{})});}
function broodBirth(e){const p=e.mesh.position,n=(e.stats?.birthCount||3)+(e.enraged?1:0);let made=0;for(let k=0;k<n*3&&made<n;k++){if(enemies.length>=aliveCap())break;const a=Math.random()*Math.PI*2,rr=(e.radius||1)+1.1,x=p.x+Math.cos(a)*rr,z=p.z+Math.sin(a)*rr;if(blocked(x,z,.5))continue;if(spawnEnemy({x,z},'crawler'))made++;}config.count+=made;if(made)sfx('brood',p);}
// Butcher hook: out (flying) → latched (pulling a player .4 s) → back (retracting to the hand).
function hookHand(e,out){const p=e.mesh.position,ry=e.mesh.rotation.y,s=Math.sin(ry),c=Math.cos(ry),lx=-.55,lz=.9;return out.set(p.x+lx*c+lz*s,1.9,p.z-lx*s+lz*c);}
function spawnHook(id,owner,o,dir,max,live,ref=null){if(hooks.length>=8)return null;const mesh=new THREE.Mesh(hookGeo,hookMat),chain=new THREE.Mesh(chainGeo,chainMat);mesh.castShadow=chain.castShadow=false;scene.add(mesh);scene.add(chain);const h={id,owner,ref,o:o.clone(),head:o.clone(),hand:o.clone(),dir:dir.clone().normalize(),speed:30,max,dist:0,state:0,latch:0,hit:null,live,mesh,chain};hooks.push(h);sound('hook',{distance:o.distanceTo(player.pos)*.4});return h;}
function throwHook(e,target){const o=hookHand(e,new THREE.Vector3()),dir=new THREE.Vector3(target.pos.x-o.x,target.pos.y-.35-o.y,target.pos.z-o.z),max=Math.min(22,dir.length()+2.5),id=++enemyId;spawnHook(id,e.id,o,dir,max,true,e);if(net.role==='host')net.broadcast({t:'hook',id,ow:e.id,o:o.toArray(),d:dir.normalize().toArray(),mx:+max.toFixed(2)});}
// A landed hook holds the cleaver back HOOK_CLEAVE_CD s, so the pulled (and slowed) player can still step out of reach.
function hookHit(h,q){h.state=2;h.latch=.4;h.hit=q;const own=h.ref,from=own.mesh.position,st=own.stats||{},pull=st.hookPull||6,slow=st.hookSlow||1.5;own.cleaveCd=Math.max(own.cleaveCd||0,HOOK_CLEAVE_CD);damageTarget(q,own.damage*.4,from);if(q===player)startPull(from.x,from.z,pull,slow);if(net.role==='host')net.broadcast({t:'hooked',id:h.id,who:q===player?net.id:q.id,p:[+from.x.toFixed(2),+from.z.toFixed(2)],d:pull,s:slow});}
function startPull(x,z,d,slow){if(player.health<=0)return;player.pull={x,z,t:.4,v:d/.4};player.slowT=Math.max(player.slowT||0,slow);shake=Math.max(shake,.35);sound('hook',{rate:.8});toast('КРЮК МЯСНИКА!',1.2);}
function removeHook(i){const h=hooks[i];scene.remove(h.mesh);scene.remove(h.chain);hooks.splice(i,1);}
function updateHooks(dt){
  for(let i=hooks.length-1;i>=0;i--){const h=hooks[i],own=h.ref||enemies.find(q=>q.id===h.owner);if(!own||!enemies.includes(own)){removeHook(i);continue;}hookHand(own,h.hand);
    if(h.state===0){const step=h.speed*dt;h.head.addScaledVector(h.dir,step);h.dist+=step;if(h.live)for(const q of aliveTargets()){const dx=q.pos.x-h.head.x,dz=q.pos.z-h.head.z;if(dx*dx+dz*dz<1.1&&h.head.y>q.pos.y-1.9&&h.head.y<q.pos.y+.35){hookHit(h,q);break;}}if(h.state===0&&(h.dist>=h.max||h.head.y<.05||insideCollider(h.head)))h.state=1;}
    else if(h.state===2){h.latch-=dt;const q=h.hit;if(q?.pos)h.head.set(q.pos.x,q.pos.y-.45,q.pos.z);if(h.latch<=0)h.state=1;}
    else{tmpA.subVectors(h.hand,h.head);const len=tmpA.length();if(len<.7){removeHook(i);continue;}h.head.addScaledVector(tmpA,Math.min(1,46*dt/len));}
    tmpB.subVectors(h.head,h.hand);const len=Math.max(.01,tmpB.length());tmpB.divideScalar(len);h.chain.position.copy(h.hand).addScaledVector(tmpB,len/2);h.chain.quaternion.setFromUnitVectors(HOOK_FWD,tmpB);h.chain.scale.set(1,1,len);h.mesh.position.copy(h.head);h.mesh.quaternion.copy(h.chain.quaternion);
  }
}
function updateHazards(dt){updateGlobs(dt);updatePools(dt);updateHooks(dt);}
function clearHazards(){for(const g of globs)scene.remove(g.mesh);globs.length=0;for(const pl of pools){scene.remove(pl.mesh);pl.mesh.material.dispose();}pools.length=0;for(let i=hooks.length-1;i>=0;i--)removeHook(i);acidFx=screamFx=0;player.pull=null;player.slowT=0;}
// Death: knees buckle for .24 s (body sinks), then the corpse falls back; crawlers roll onto their side.
function fallPose(d,dt){d.t=(d.t||0)+dt;const m=d.mesh,u=m.userData,h=(u.height||1.9)/1.9;if(d.t<.24&&!d.roll){const k=d.t/.24;for(const n of ['leftLeg','rightLeg'])if(u[n])u[n].rotation.x=(u.rest?.[n]?.[0]||0)-k*.9;for(const n of ['leftArm','rightArm'])if(u[n])u[n].rotation.x=(u.rest?.[n]?.[0]||0)-k*.6;m.position.y=-k*.22*h;return;}if(d.roll)m.rotation.z=THREE.MathUtils.lerp(m.rotation.z,1.5,dt*8);else m.rotation.x=THREE.MathUtils.lerp(m.rotation.x,-Math.PI/2,dt*7);if(d.life>=1.2)m.position.y=THREE.MathUtils.lerp(m.position.y,0,dt*8);}
function updateProjectiles(dt){for(let i=rockets.length-1;i>=0;i--){const r=rockets[i],start=r.mesh.position.clone(),step=28*dt;r.life-=dt;let hit=false;const segments=Math.ceil(step/.25);for(let s=0;s<segments;s++){r.mesh.position.addScaledVector(r.dir,step/segments);const p=r.mesh.position;if(p.y<.1||Math.abs(p.x)>37.5||Math.abs(p.z)>37.5||world.colliders.some(b=>p.y<=(b.height||3.2)+.12&&Math.abs(p.x-b.x)<b.hx+.12&&Math.abs(p.z-b.z)<b.hz+.12)||enemies.some(e=>p.distanceTo(e.mesh.position.clone().add(new THREE.Vector3(0,1,0)))<(ROCKET_R[e.type]||.9))){hit=true;break;}}
    if(hit||r.life<=0){explode(r.mesh.position.clone(),r.visualOnly,{owner:r.owner});scene.remove(r.mesh);rockets.splice(i,1);}else if(Math.random()<.7){particles(start,1,true);}}
}
function updateEffects(dt){for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){scene.remove(e.mesh);if(e.dispose){e.mesh.geometry.dispose();e.mesh.material.dispose();}effects.splice(i,1);continue;}if(e.type==='ring'){const p=1-e.life/e.max;e.mesh.scale.setScalar(1+p*(e.grow||6));e.mesh.material.opacity=(1-p)*.8;continue;}if(e.type==='particle'){e.vel.y-=13*dt;e.mesh.position.addScaledVector(e.vel,dt);e.mesh.scale.multiplyScalar(Math.max(.5,1-dt*2));}else if(e.type==='explosion'){const p=1-e.life/e.max;e.mesh.scale.setScalar(.5+p*7);e.mesh.material.opacity=(1-p)*.62;}else if(e.type==='line')e.mesh.material.opacity=e.life/e.max;}
  for(let i=dead.length-1;i>=0;i--){const d=dead[i];d.life-=dt;fallPose(d,dt);if(d.life<1.2)d.mesh.position.y-=dt*.7;if(d.life<=0){scene.remove(d.mesh);disposeZombie(d.mesh);dead.splice(i,1);}}
  for(let i=pickups.length-1;i>=0;i--){const p=pickups[i];p.life-=dt;p.mesh.rotation.y+=dt;p.mesh.position.y=.6+Math.sin(time*3+i)*.12;const dist=Math.hypot(p.mesh.position.x-player.pos.x,p.mesh.position.z-player.pos.z);if(dist<1.65&&player.health>0){if(net.role==='client'){net.send({t:'pickup',id:p.id});takenPickups.add(p.id);scene.remove(p.mesh);pickups.splice(i,1);continue;}if(p.type==='health'){player.health=Math.min(maxHealth(player),player.health+25);toast('АПТЕЧКА · +25 ЗДОРОВЬЯ',1.8);}else{refillAmmo('pickup');toast(pickupText(),1.8);}sound('pickup');p.life=0;updateHUD();}if(p.life<=0){scene.remove(p.mesh);pickups.splice(i,1);}}
}
let previousProgramWave=0,pendingUnlock=null;
let coopPaused=false,gameSession=0,netTick=0,enemyId=0,drop=null,dropWave=0,minigunUntil=0,lastSnapshot=0,lastRemoteWave=0;
const squad=new Map(),takenPickups=new Set();
const net=createNetwork({onData:receivePacket,onPeerJoin(id,name){const mate=ensureMate(id,name);renderLobby();if(net.role==='host'){net.send({t:'diff',d:difficulty},id);net.send({t:'sw',w:startWave},id);if(phase==='active'||phase==='break'||phase==='victory')net.send({t:'start',session:gameSession,spawn:mate.pos.toArray(),diff:difficulty,wave},id);if(phase==='victory')net.send({t:'victory',stats:collectStats(),late:1},id);}},onPeerLeave(id){const q=squad.get(id);if(q){removeMate(q);squad.delete(id);}renderLobby();if(net.role==='host'&&phase==='active')checkWipe();},onStatus(message){$('coopStatus').textContent=message;},onDisconnect(message){returnMenu();$('coopModal').hidden=false;$('coopStatus').textContent=message;renderLobby();}});
function aliveTargets(){return [player,...squad.values()].filter(p=>p.health>0);}
function nearestTarget(pos){let best=player,d=Infinity;for(const q of aliveTargets()){const n=Math.hypot(q.pos.x-pos.x,q.pos.z-pos.z);if(n<d){d=n;best=q;}}return best;}
// ---- Teammates: soldier model (models.createSoldier), animated from position deltas, with a name tag + HP bar ----
const MATE_COLORS=[0x4fa8ff,0x7ee6a1,0xffd23a,0xff8fd0],mateFlashGeo=new THREE.IcosahedronGeometry(.09,0),mateFlashMat=new THREE.MeshBasicMaterial({color:0xffd477,transparent:true,opacity:.9,depthWrite:false});
function mateColor(id){let h=7;for(const ch of String(id))h=(h*31+ch.charCodeAt(0))>>>0;const used=new Set([...squad.values()].map(q=>q.color));for(let k=0;k<4;k++){const c=MATE_COLORS[(h+k)%4];if(!used.has(c))return c;}return MATE_COLORS[h%4];}
function ensureMate(id,name='Напарник'){
  if(squad.has(id))return squad.get(id);const color=mateColor(id),mesh=createSoldier(color);mesh.rotation.order='YXZ';
  const c=document.createElement('canvas');c.width=256;c.height=80;const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const tagMat=new THREE.SpriteMaterial({map:tex,depthTest:false,depthWrite:false,transparent:true}),tag=new THREE.Sprite(tagMat);tag.scale.set(1.25,.39,1);tag.renderOrder=20;tag.raycast=()=>{};scene.add(mesh);scene.add(tag);
  const flash=new THREE.Mesh(mateFlashGeo,mateFlashMat);flash.visible=false;flash.raycast=()=>{};(mesh.userData.muzzle||mesh).add(flash);
  const starts=[12,14,10].flatMap(z=>[2,-2,4,-4,6,-6,0].map(x=>({x,z})));const spawn=starts.find(p=>!blocked(p.x,p.z,.4)&&[player,...squad.values()].every(q=>Math.hypot(p.x-q.pos.x,p.z-q.pos.z)>=1.8))||{x:0,z:12};
  const q={id,name:String(name||'Напарник').slice(0,24),color,mesh,tag,tagMat,tagTex:tex,tagCanvas:c,tagKey:'',flash,flashT:0,pos:new THREE.Vector3(spawn.x,1.72,spawn.z),health:100,yaw:0,pitch:0,weapon:'ak',mini:0,lastShot:-99,grenades:3,lastGrenade:-99,grenadeRequest:0,revive:0,reviver:null,down:false,out:false,bleed:0,selfT:0,secondUsed:false,grace:0,db:0,mv:0,step:0,ry:Math.PI,stats:newStats(),nav:createNavigator(world.colliders)};
  mesh.position.set(q.pos.x,0,q.pos.z);q.ax=q.pos.x;q.az=q.pos.z;mesh.visible=tag.visible=phase!=='menu';squad.set(id,q);drawTag(q);return q;
}
function removeMate(q){scene.remove(q.mesh);scene.remove(q.tag);q.tagTex.dispose();q.tagMat.dispose();q.helpEl?.remove();q.helpEl=null;}
// The tag canvas is redrawn only when its visible content changes (name, HP in 2% steps, downed seconds).
function drawTag(q){
  const hp=Math.max(0,Math.min(1,q.health/maxHealth(q))),st=q.health>0?'ok':q.out?'out':'down',key=st+':'+(st==='down'?Math.ceil(q.bleed||0):st==='ok'?Math.round(hp*50):0);if(key===q.tagKey)return;q.tagKey=key;
  const ctx=q.tagCanvas.getContext('2d'),nm=String(q.name).slice(0,st==='ok'?16:11);ctx.clearRect(0,0,256,80);ctx.fillStyle='rgba(8,12,14,.66)';ctx.fillRect(16,4,224,72);ctx.fillStyle='#'+new THREE.Color(q.color).getHexString();ctx.fillRect(16,4,6,72);
  ctx.font='700 30px "Fira Sans Extra Condensed","Barlow Condensed",Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=st==='ok'?'#f2f5ea':st==='out'?'#8d918a':'#ff8a7e';ctx.fillText(st==='ok'?nm:st==='out'?nm+' · ВЫБЫЛ':`${nm} · РАНЕН ${Math.ceil(q.bleed||0)}`,131,30);
  ctx.fillStyle='rgba(255,255,255,.16)';ctx.fillRect(36,56,190,9);if(st==='ok'){ctx.fillStyle=hp>.6?'#7ee6a1':hp>.3?'#ff9a3c':'#ff3b2e';ctx.fillRect(36,56,190*hp,9);}
  q.tagTex.needsUpdate=true;
}
// Walk/run cycle from the measured ground speed, aim pitch through the torso (hands stay on the rifle),
// idle breathing, and a downed pose (lying back, propped up, one arm waving for help).
function animateMate(q,dt){
  const m=q.mesh,u=m.userData,r=u.rest||{},p=m.position,k=blendK(dt,14);p.x+=(q.pos.x-p.x)*k;p.z+=(q.pos.z-p.z)*k;
  const moved=Math.hypot(p.x-q.ax,p.z-q.az);q.ax=p.x;q.az=p.z;if(dt>0)q.mv+=(Math.min(12,moved/dt)-q.mv)*blendK(dt,8);
  q.ry=turnTo(q.ry,q.yaw+Math.PI,dt*12);const down=q.health<=0;q.db+=((down?1:0)-q.db)*blendK(dt,5);const db=q.db,up=1-db;
  const run=Math.max(0,Math.min(1,(q.mv-5.4)/2.2))*up,amp=Math.min(1,q.mv/4.2)*up;q.step+=q.mv*dt*Math.PI*2/(1.9+run*.9)*up;
  const s=Math.sin(q.step),c=Math.cos(q.step),br=Math.sin(time*2.1+q.color%7)*.02,pt=q.pitch||0,leg=.62*amp*(1+.3*run);
  m.rotation.set(-1.36*db,q.ry,0);p.y=(Math.abs(c)-.62)*.05*amp*(1+run)+.2*db;
  setJoint(u.leftLeg,r.leftLeg,s*leg+.28*db);setJoint(u.rightLeg,r.rightLeg,-s*leg+.6*db);
  setJoint(u.torso,r.torso,Math.max(-.55,Math.min(.55,-pt*.6))*up+run*.2+br+.5*db,s*.06*amp,0);setJoint(u.head,r.head,Math.max(-.4,Math.min(.4,-pt*.3))*up-run*.12+.45*db);
  const wave=down&&!q.out?Math.sin(time*5)*.35-1.9:0;setJoint(u.leftArm,r.leftArm,s*.05*amp+br*.5);setJoint(u.rightArm,r.rightArm,-s*.05*amp+br*.5+wave*db);
  q.flashT-=dt;const fl=q.flashT>0&&!down;if(q.flash.visible!==fl)q.flash.visible=fl;if(fl)q.flash.scale.setScalar(.7+Math.random()*.6);
  q.tag.position.set(p.x,2.28-1.2*db,p.z);drawTag(q);
}
function teamSnap(q){return {p:q.pos.toArray(),yaw:+(q.yaw||0).toFixed(3),pt:+(q.pitch||0).toFixed(3),health:Math.ceil(q.health*10)/10,grenades:q.grenades,...(q.health<=0?{dn:1,bl:+(q.bleed||0).toFixed(1),...(q.out?{out:1}:{}),...(q.revive>0?{rv:+q.revive.toFixed(2),rb:q.reviver}:{}),...(q.selfT>0?{st:+q.selfT.toFixed(1)}:{})}:{})};}
function readTeam(q,p){q.health=fnum(p.health,0,0,1000);q.down=q.health<=0;q.bleed=fnum(p.bl,0,0,60);q.out=!!p.out&&q.down;q.revive=fnum(p.rv,0,0,1);q.reviver=typeof p.rb==='string'?p.rb.slice(0,80):null;q.selfT=fnum(p.st,0,0,10);q.pitch=fnum(p.pt,0,-1.5,1.5);}
// ---- Pings (Z): world-anchored HUD markers, 6 s, synced through the host ({t:'ping'}) ----
const pings=[],PING_LIFE=6,pv=new THREE.Vector3(),pd=new THREE.Vector3();let pingCd=0;
function placePing(){
  if(!['active','break'].includes(phase)||coopPaused||time<pingCd)return;pingCd=time+.45;camera.updateMatrixWorld();const o=camera.getWorldPosition(new THREE.Vector3()),d=camera.getWorldDirection(new THREE.Vector3());raycaster.set(o,d);const wall=obstacleDistance(o,d,90);
  let kind='go',id=0,point=null;for(const h of raycaster.intersectObjects(enemies.map(e=>e.mesh),true)){if(h.distance>=wall)break;const e=h.object.userData.enemy;if(e&&enemies.includes(e)){kind='enemy';id=e.id;point=e.mesh.position.clone();point.y=(e.mesh.userData.height||1.9)+.3;break;}}
  if(!point){let dist=wall;if(d.y<-.001)dist=Math.min(dist,-o.y/d.y);if(dist>=90){toast('Слишком далеко для метки',1);return;}point=o.clone().addScaledVector(d,Math.max(0,dist-.05));point.y=Math.max(.05,point.y);}
  const m={t:'ping',p:point.toArray().map(n=>+n.toFixed(2)),kind,id},me=net.id||'solo';addPing({...m,by:shooterName(player),from:me});if(net.role==='client')net.send(m);else if(net.role==='host')net.broadcast({...m,by:net.name,from:me});
}
function remotePing(m,q,from){if(!validVector(m.p)||time<(q.pingT||0))return;q.pingT=time+.4;const full={t:'ping',p:m.p.map(n=>+Number(n).toFixed(2)),kind:m.kind==='enemy'?'enemy':'go',id:Number.isSafeInteger(m.id)?m.id:0,by:q.name,from};addPing(full);net.broadcast(full);}
function addPing(m){
  const kind=m.kind==='enemy'?'enemy':'go',mine=pings.filter(x=>x.from===m.from);if(mine.length>=2)removePing(pings.indexOf(mine[0]));if(pings.length>=8)removePing(0);
  const el=document.createElement('div'),i=document.createElement('i'),b=document.createElement('b'),small=document.createElement('small');el.className='ping'+(kind==='enemy'?' enemy':'');b.textContent=kind==='enemy'?'ВРАГ!':'СЮДА';el.append(i,b,small);$('pingLayer').appendChild(el);
  pings.push({el,small,pos:new THREE.Vector3(...m.p),kind,id:Number(m.id)||0,by:String(m.by||''),from:m.from,life:PING_LIFE,txt:''});sound('ping',{volume:.8});
}
function removePing(i){if(i<0)return;pings[i].el.remove();pings.splice(i,1);}
function clearPings(){for(const p of pings)p.el.remove();pings.length=0;for(const q of squad.values()){q.helpEl?.remove();q.helpEl=null;}}
// Screen position; off-screen and behind-camera markers stick to the screen edge.
function markerAt(el,pos,txt,small,cache){
  pv.copy(pos).project(camera);let x=pv.x,y=pv.y;const behind=pv.z>1;if(behind){x=-x;y=-y;}const off=behind||Math.abs(x)>.94||Math.abs(y)>.86;if(off){const s=Math.max(Math.abs(x)/.94,Math.abs(y)/.86);if(s>1e-4){x/=s;y/=s;}else y=-.86;}
  el.style.transform=`translate(${((x*.5+.5)*innerWidth).toFixed(1)}px,${((-y*.5+.5)*innerHeight).toFixed(1)}px) translate(-50%,-100%)`;if(el.classList.contains('offscreen')!==off)el.classList.toggle('offscreen',off);if(cache.txt!==txt){cache.txt=txt;small.textContent=txt;}
}
function updatePings(dt){
  for(let i=pings.length-1;i>=0;i--){const p=pings[i];p.life-=dt;if(p.life<=0){removePing(i);continue;}if(p.id&&p.kind==='enemy'){const e=enemies.find(q=>q.id===p.id);if(e)p.pos.set(e.mesh.position.x,(e.mesh.userData.height||1.9)+.3,e.mesh.position.z);else{p.id=0;p.life=Math.min(p.life,1.2);}}
    if(p.life<.45&&!p.el.classList.contains('fade'))p.el.classList.add('fade');markerAt(p.el,p.pos,`${Math.round(pd.copy(p.pos).setY(player.pos.y).distanceTo(player.pos))} м · ${p.by}`,p.small,p);}
  // Downed teammates get a persistent green marker so they can be found through walls.
  for(const q of squad.values()){const need=q.health<=0&&!q.out&&q.mesh.visible;if(need&&!q.helpEl){const el=document.createElement('div'),i=document.createElement('i'),b=document.createElement('b'),small=document.createElement('small');el.className='ping';i.style.borderColor='var(--good)';i.style.background='rgba(126,230,161,.22)';i.style.boxShadow='0 0 12px rgba(126,230,161,.8)';b.textContent='ПОДНЯТЬ';el.append(i,b,small);$('pingLayer').appendChild(el);q.helpEl=el;q.helpSmall=small;q.helpTxt='';}else if(!need&&q.helpEl){q.helpEl.remove();q.helpEl=null;}
    if(q.helpEl){pd.set(q.mesh.position.x,1.75,q.mesh.position.z);const cache={txt:q.helpTxt};markerAt(q.helpEl,pd,`${q.name} · ${Math.round(Math.hypot(q.pos.x-player.pos.x,q.pos.z-player.pos.z))} м · ${Math.ceil(q.bleed||0)} с`,q.helpSmall,cache);q.helpTxt=cache.txt;}}
}
// ---- Downed overlay + revive ring (both the reviver and the downed player see the progress) ----
let localReviving=false,heartbeat=null;const downedHelp=$('downed').querySelector('p')?.innerHTML||'';
function updateTeamHud(){
  const me=net.id||'solo',down=player.health<=0,d=$('downed');if(d.hidden===down)d.hidden=!down;const hud=$('hud');if(hud.classList.contains('is-down')!==down)hud.classList.toggle('is-down',down);
  if(down){const out=!!player.out,self=player.selfT>0,mode=out?'out':self?'self':'wait';d.classList.toggle('dead',out);const t=String(Math.max(0,Math.ceil(self?player.selfT:player.bleed||0)));if($('downedTimer').textContent!==t)$('downedTimer').textContent=t;d.style.setProperty('--bleed',(self?player.selfT/5:(player.bleed||0)/BLEED_TIME).toFixed(3));
    if(d.dataset.mode!==mode){d.dataset.mode=mode;const p=d.querySelector('p'),title=d.querySelector('.downed-title'),eb=d.querySelector('.downed-eyebrow');if(title)title.textContent=out?'ТЫ ВЫБЫЛ':'ТЫ РАНЕН';if(eb)eb.textContent=out?'ДО КОНЦА ВОЛНЫ':self?'ВТОРОЙ ШАНС':'КРОВОТЕЧЕНИЕ';if(p){if(mode==='wait')p.innerHTML=downedHelp;else p.textContent=out?'Вернёшься в строй на передышке с 50 здоровья. Отряд ещё держится.':net.role==='solo'?'Поднимешься сам через несколько секунд. Соберись.':'Поднимешься сам — или раньше, если напарник поможет.';}}}
  let ring=null;localReviving=false;
  if(down&&!player.out&&player.revive>0)ring={p:player.revive,label:'ТЕБЯ ПОДНИМАЕТ: '+mateName(player.reviver)};
  else if(!down&&net.role!=='solo'){let best=null,bd=REVIVE_R;for(const q of squad.values()){if(q.health>0||q.out)continue;const dd=Math.hypot(q.pos.x-player.pos.x,q.pos.z-player.pos.z);if(dd<bd){bd=dd;best=q;}}if(best){const holding=keys.has('KeyF')&&!coopPaused;localReviving=holding;ring={p:best.reviver===me?best.revive||0:0,label:(holding?'ПОДНИМАЕШЬ: ':'F — ПОДНЯТЬ: ')+best.name};}}
  const rr=$('reviveRing');if(rr.hidden===!!ring)rr.hidden=!ring;if(ring){const off=(100*(1-Math.min(1,ring.p))).toFixed(1);if($('reviveFill').style.strokeDashoffset!==off)$('reviveFill').style.strokeDashoffset=off;if($('reviveLabel').textContent!==ring.label)$('reviveLabel').textContent=ring.label;}
}
// Heartbeat loop while downed or below 25 HP (faster when downed).
function updateHeartbeat(){const want=soundOn&&(phase==='active'||phase==='break')&&(player.health<=0?!player.out:player.health<25);if(want&&!heartbeat)heartbeat=audioEngine.play('heartbeat',{loop:true,volume:.55});else if(!want&&heartbeat)stopHeartbeat();if(heartbeat)heartbeat.setRate(player.health<=0?1.3:1);}
function stopHeartbeat(){heartbeat?.stop(.5);heartbeat=null;}
function renderLobby(){
  $('coopSetup').hidden=net.role!=='solo';$('coopLobby').hidden=net.role==='solo';$('coopLeave').hidden=net.role==='solo';$('coopClose').hidden=net.role!=='solo';$('coopBegin').hidden=net.role!=='host';$('coopWait').hidden=net.role!=='client';$('coopRoomCode').textContent=net.room?.replace('outpost-','')||'';$('coopInvite').value=net.getInviteURL();renderStartWave();
  const list=$('coopRoster');list.replaceChildren();const roster=net.role==='solo'?[]:[{id:net.id,name:net.name},...net.peers.values()];for(const q of roster){const li=document.createElement('li');li.textContent=q.name+(q.id===net.room?' · ВЕДУЩИЙ':q.id===net.id?' · ТЫ':' · В СЕТИ');list.appendChild(li);}updateSquadHUD();
}
function teamState(q){return q.health>0?Math.ceil(q.health)+' HP':q.out?'ВЫБЫЛ':q.selfT>0?'ВСТАЁТ':`РАНЕН · ${Math.ceil(q.bleed||0)} С`;}
function updateSquadHUD(){if(!$('squadPanel'))return;$('squadPanel').hidden=net.role==='solo';if(net.role==='solo')return;$('squadCount').textContent=(1+net.peers.size)+' / 4';const rows=[[net.name+' · ТЫ',player],...[...squad.values()].map(q=>[q.name,q])],box=$('squadList'),key=rows.map(([n,q])=>n+teamState(q)).join('|');if(box.dataset.key===key)return;box.dataset.key=key;box.replaceChildren(...rows.map(([n,q])=>{const d=document.createElement('div'),a=document.createElement('span'),b=document.createElement('b');a.textContent=n;b.textContent=teamState(q);if(q.health<=0)d.className='down';d.append(a,b);return d;}));}
async function connectRoom(join){initAudio();$('coopCreate').disabled=$('coopJoin').disabled=true;try{if(join)await net.join($('coopCode').value,$('coopName').value);else await net.host($('coopName').value);renderLobby();}catch(e){$('coopStatus').textContent=e.message;}finally{$('coopCreate').disabled=$('coopJoin').disabled=false;}}
$('coopOpen').onclick=()=>{$('coopModal').hidden=false;renderLobby();};$('coopCreate').onclick=()=>connectRoom(false);$('coopJoin').onclick=()=>connectRoom(true);$('coopBegin').onclick=()=>{if(net.role==='host')startGame(startWave);};$('coopClose').onclick=()=>{$('coopModal').hidden=true;};$('coopLeave').onclick=()=>{returnMenu();renderLobby();};
$('coopCopy').onclick=async()=>{try{await window.navigator.clipboard.writeText(net.getInviteURL());$('coopStatus').textContent='Приглашение скопировано. Отправь его друзьям.';}catch{$('coopInvite').select();$('coopStatus').textContent='Скопируй выделенную ссылку: Ctrl+C.';}};
const invitation=new URLSearchParams(window.location.search).get('room');if(invitation){$('coopCode').value=invitation;$('coopModal').hidden=false;}
function beginDrop(forWave){drop?.dispose();drop=createAirdrop(scene);dropWave=forWave;sound('airdrop');toast(`АИРДРОП В ЦЕНТРЕ · МИНИГАН НА ВОЛНУ ${forWave}`,8);}
function grantMinigun(){if(minigunUntil===dropWave)return;minigunUntil=dropWave;weapons.minigun.mag=1200;setWeapon('minigun');sound('pickup');toast(`МИНИГАН ДО КОНЦА ВОЛНЫ ${minigunUntil} · КОСИТ ОРДУ, БРОНЮ БОССА БЕРЁТ ПЛОХО`,5);}
function expireMinigun(){if(minigunUntil&&wave>=minigunUntil){minigunUntil=0;weapons.minigun.mag=0;if(current==='minigun'||swapTo==='minigun'){swapTo=null;setWeapon('ak',player.health<=0);}}for(const q of squad.values())if(q.mini&&wave>=q.mini)q.mini=0;if(dropWave&&wave>=dropWave){drop?.dispose();drop=null;dropWave=0;}}
function updateDrop(dt){if(!drop)return;const landed=drop.update(dt);if(landed&&player.health>0&&Math.hypot(player.pos.x,player.pos.z-3)<2.5&&minigunUntil!==dropWave){if(net.role==='client')net.send({t:'crate'});else grantMinigun();}if(net.role==='host'&&landed)for(const q of squad.values()){if(q.health>0&&q.mini!==dropWave&&Math.hypot(q.pos.x,q.pos.z-3)<2.5){q.mini=dropWave;net.send({t:'mini',wave:dropWave},q.id);}}}
function validVector(a){return Array.isArray(a)&&a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<300);}
function receivePacket(m,from){
  if(!m||typeof m!=='object')return;
  if(net.role==='host'){
    const q=squad.get(from)||ensureMate(from,net.peers.get(from)?.name);
    if(m.t==='pose'&&validVector(m.p)&&Number.isFinite(m.yaw)){const p=new THREE.Vector3(...m.p);if(Math.abs(p.x)<38&&Math.abs(p.z)<38&&p.y>=1&&p.y<6&&!blocked(p.x,p.z,.3)){q.pos.copy(p);q.yaw=m.yaw;q.pitch=fnum(m.pt,0,-1.5,1.5);q.weapon=WEAPON_KEYS.includes(m.weapon)?m.weapon:'ak';}q.help=!!m.help;}
    if(m.t==='ping')remotePing(m,q,from);
    if(m.t==='perks'){const before=q.perks||{};q.perks=sanitizePerks(m.p);const dPack=(q.perks.pack||0)-(before.pack||0),dTough=(q.perks.tough||0)-(before.tough||0);if(dPack>0)q.grenades=Math.min(5+mods(q).grenades,q.grenades+2*dPack);if(dTough>0)heal(q,25*dTough);}
    if(m.t==='dj')startDj(q);if(m.t==='shot')remoteShot(m,q);if(m.t==='grenade')remoteGrenade(m,q);
    if(m.t==='pickup'){const p=pickups.find(p=>p.id===m.id);if(p&&q.health>0&&q.pos.distanceTo(p.mesh.position)<3){if(p.type==='health')q.health=Math.min(maxHealth(q),q.health+25);else net.send({t:'supply',k:'pickup'},from);scene.remove(p.mesh);pickups.splice(pickups.indexOf(p),1);}}
    return;
  }
  if(net.role!=='client'||from!==net.room)return;
  if(m.t==='diff'&&DIFFICULTY[m.d]){difficulty=m.d;renderDifficulty();}
  if(m.t==='sw'){hostStart=clampWave(m.w);renderStartWave();}
  if(m.t==='start'){if(DIFFICULTY[m.diff])difficulty=m.diff;renderDifficulty();startGame();runStart=clampWave(m.wave);if(runStart>1){applyStartBuild(runStart);net.send({t:'perks',p:player.perks});updateHUD();}if(validVector(m.spawn)&&!blocked(m.spawn[0],m.spawn[2],.4))player.pos.fromArray(m.spawn);updatePlayer(0);lastRemoteWave=0;lastSnapshot=0;}
  if(m.t==='over'){phase='gameover';shooting=false;keys.clear();endScreenCleanup();$('deathMessage').textContent='Отряд пал. Новую попытку запускает ведущий — ждём его решения…';for(const id of ['restart','restartPause','retryWave'])$(id).hidden=true;evacTime=0;heliLoop?.stop(1);heliLoop=null;stopHeartbeat();$('downed').hidden=true;$('reviveRing').hidden=true;document.exitPointerLock?.();saveBest();$('finalWave').textContent=String(wave).padStart(2,'0');$('finalKills').textContent=kills;$('finalScore').textContent=score;renderStats($('statsTable'),m.stats);updateMusic();$('gameover').hidden=false;}
  if(m.t==='victory')showVictory(m.stats,!!m.late);
  if(m.t==='revived'&&typeof m.who==='string'&&m.who!==net.id){const name=mateName(m.who),by=typeof m.by==='string'?m.by:null;if(by===net.id){toast(`ТЫ ПОДНЯЛ: ${name}`.toUpperCase(),1.8);sound('pickup',{rate:1.1,volume:.7});}else if(by)toast(`${mateName(by)} ПОДНЯЛ: ${name}`.toUpperCase(),1.8);}
  if(m.t==='mini'&&Number.isInteger(m.wave)&&m.wave>=wave&&m.wave<=wave+1){dropWave=m.wave;grantMinigun();}
  if(m.t==='supply'){refillAmmo('pickup');toast(pickupText(),1.8);sound('pickup');}
  if(m.t==='snapshot')applySnapshot(m);
  if(m.t==='pop'&&validVector(m.p))radio.partyPop(new THREE.Vector3(...m.p));
  if(m.t==='shot'&&m.who!==net.id&&validVector(m.o)&&validVector(m.d)){const o=new THREE.Vector3(...m.o),d=new THREE.Vector3(...m.d);tracer(o,o.clone().addScaledVector(d,30));sound(SHOT_SOUND[m.weapon]||'shot',{rate:m.weapon==='shotgun'?.62:1,distance:o.distanceTo(player.pos)});const sh=squad.get(m.who);if(sh)sh.flashT=.06;}
  if(m.t==='ping'&&validVector(m.p)&&m.from!==net.id)addPing({p:m.p,kind:m.kind,id:m.id,by:String(m.by||'').slice(0,20),from:String(m.from||'')});
  if(m.t==='blast'&&validVector(m.p))explode(new THREE.Vector3(...m.p),true);
  if(m.t==='slam'&&validVector(m.p))slamVisual(new THREE.Vector3(...m.p));
  if(m.t==='kill'){const e=enemies.find(q=>q.id===m.id);if(e){enemies.splice(enemies.indexOf(e),1);corpse(e,!!m.h,Array.isArray(m.d)?{x:Number(m.d[0])||0,z:Number(m.d[1])||0}:null);}overlay.kill(String(m.by||'').slice(0,24),enemyName(m.ty),!!m.h);}
  if(m.t==='rock'&&validVector(m.o)&&validVector(m.v))spawnRock(new THREE.Vector3(...m.o),new THREE.Vector3(...m.v),false);
  if(m.t==='roar'){sound('roar');toast(`${enemyName(BOSS_SET.has(m.ty)?m.ty:'boss')} ГОТОВИТ ТАРАН — УХОДИ В СТОРОНУ!`,1.3);}
  if(m.t==='bossdown'&&validVector(m.p)){if(m.ty==='father')clearHazards();bossDownVisual(BOSS_SET.has(m.ty)?m.ty:'boss',new THREE.Vector3(...m.p));}
  if(m.t==='bossphase'&&BOSS_SET.has(m.ty))phaseBanner(m.ty,m.ph===2?2:1);
  if(m.t==='spit'&&validVector(m.o)&&Array.isArray(m.vs)&&m.vs.length>=1&&m.vs.length<=8&&m.vs.every(validVector))spawnGlobs({o:m.o,vs:m.vs,dmg:0,r:fnum(m.r,2.4,.5,6),pr:fnum(m.pr,1.8,.3,5),pt:fnum(m.pt,4,.5,10),dps:0},false);
  if(m.t==='scream'&&validVector(m.p))screamVisual(new THREE.Vector3(...m.p),!!m.big,fnum(m.sr,18,4,40));
  if(m.t==='hook'&&Number.isSafeInteger(m.id)&&validVector(m.o)&&validVector(m.d))spawnHook(m.id,m.ow,new THREE.Vector3(...m.o),new THREE.Vector3(...m.d),fnum(m.mx,20,1,25),false);
  if(m.t==='hooked'&&Array.isArray(m.p)){const h=hooks.find(x=>x.id===m.id),who=m.who===net.id?player:squad.get(m.who);if(h){h.state=2;h.latch=.4;h.hit=who||null;}if(m.who===net.id)startPull(fnum(m.p[0],player.pos.x,-40,40),fnum(m.p[1],player.pos.z,-40,40),fnum(m.d,6,0,10),fnum(m.s,1.5,0,4));}
  if(m.t==='sfx'&&typeof m.k==='string'&&validVector(m.p))sfx(m.k,new THREE.Vector3(...m.p),false,BOSS_SET.has(m.ty)?m.ty:null);
}
function remoteShot(m,q){
  if(!['active','break'].includes(phase)||q.health<=0||!validVector(m.o)||!validVector(m.d)||!WEAPON_KEYS.includes(m.weapon)||!weapons[m.weapon])return;
  if(m.weapon==='minigun'&&(!q.mini||q.mini<wave))return;if(m.weapon in UNLOCKS&&!slotOpen(m.weapon))return;const origin=new THREE.Vector3(...m.o),direction=new THREE.Vector3(...m.d);if(origin.distanceTo(q.pos)>3||direction.length()<.8||direction.length()>1.2)return;
  // Token bucket in real time (packets arrive between host frames and in bursts after jitter).
  const rate=(REMOTE_RATE[m.weapon]||.084)*(m.weapon==='ak'?mods(q).fireRate:1),cap=REMOTE_BURST[m.weapon]||2,now=performance.now()/1000;q.shotTok=Math.min(cap,(q.shotTok??cap)+(now-(q.shotTokT??now))/rate);q.shotTokT=now;if(q.shotTok<1)return;q.shotTok-=1;direction.normalize();scene.updateMatrixWorld(true);
  if(m.weapon==='rpg'){const mesh=createRocket();mesh.position.copy(origin).addScaledVector(direction,.9);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);scene.add(mesh);rockets.push({mesh,dir:direction,life:4,owner:q});}
  const s=THREE.MathUtils.clamp(Number(m.s)||.07,.02,.12);
  if(m.weapon!=='rpg'){const pellets=m.weapon==='shotgun'?GUN.shotgun.pellets:1,mx=shotModsFor(q);let anyHit=false;for(let k=0;k<pellets;k++){const dir=pellets>1?jitter(direction.clone(),s):direction;const r=hitscan(origin,dir,m.weapon,true,q,mx);if(r.hit)anyHit=true;if(k<3)fx.bullet(origin,r.end,pellets>1);}if(q.stats){q.stats.shots++;if(anyHit)q.stats.hits++;}}
  sound(SHOT_SOUND[m.weapon]||'shot',{rate:m.weapon==='shotgun'?.62:1,distance:origin.distanceTo(player.pos)});q.flashT=.06;
  // Relay rebuilt from validated fields only (never the guest's raw object).
  net.broadcast({t:'shot',weapon:m.weapon,o:origin.toArray().map(n=>+n.toFixed(3)),d:direction.toArray().map(n=>+n.toFixed(4)),s:+s.toFixed(4),who:q.id});
}
function snapshot(){return {t:'snapshot',seq:time,radio:{...radio.state},wave,phase,kills,score,waveKills,count:config.count,breakTime,players:[{id:net.id,name:net.name,...teamSnap(player),weapon:current},...[...squad.values()].map(q=>({id:q.id,name:q.name,...teamSnap(q),weapon:q.weapon,mini:q.mini}))],enemies:enemies.map(e=>({id:e.id,type:e.type,prize:e.prize,p:[+e.mesh.position.x.toFixed(2),0,+e.mesh.position.z.toFixed(2)],r:+e.mesh.rotation.y.toFixed(3),hp:Math.round(e.hp),...(e.boss?{mx:e.maxHp}:{}),...(e.actSeq?{an:[e.act||0,e.actSeq,+(e.actT||0).toFixed(2)]}:{}),...(e.stagger>0?{sg:+e.stagger.toFixed(2)}:{}),...(e.buffT>0?{bf:1}:{})})),ev:waveEvent,diff:difficulty,evac:evacTime>0?+evacTime.toFixed(2):0,combo,pickups:pickups.map(p=>({id:p.id,type:p.type,p:p.mesh.position.toArray()})),grenades:grenades.items.map(g=>({id:g.id,p:g.mesh.position.toArray(),v:g.velocity.toArray(),life:g.life})),drop:drop?{wave:dropWave,age:drop.mesh.userData.age}:null};}
function applySnapshot(m){
  // More enemies than SNAP_ENEMIES (the host caps far below it) are clamped, never a reason to drop the whole state.
  if(!Number.isFinite(m.seq)||m.seq<=lastSnapshot||!Array.isArray(m.enemies)||!Array.isArray(m.players)||m.players.length>4)return;lastSnapshot=m.seq;const snapEnemies=m.enemies.length>SNAP_ENEMIES?m.enemies.slice(0,SNAP_ENEMIES):m.enemies;
  // After the victory screen the host may continue into endless mode; follow it.
  if(phase==='victory'&&m.wave>CAMPAIGN_LENGTH&&m.phase==='active')leaveVictory();
  if(!['active','break'].includes(phase))return;
  radio.sync(m.radio);if(DIFFICULTY[m.diff]&&m.diff!==difficulty){difficulty=m.diff;renderDifficulty();}
  if((m.ev||null)!==waveEvent)setWaveEvent(typeof m.ev==='string'?m.ev:null);combo=Number.isInteger(m.combo)?m.combo:0;
  const oldPhase=phase;phase=m.phase==='break'?'break':'active';wave=m.wave;config=waveConfig(wave,m.players.length,difficulty);config.count=m.count;waveKills=m.waveKills;kills=m.kills;score=m.score;breakTime=m.breakTime;if(phase!==oldPhase){renderPerks();if(phase==='active')perkPending();}
  if(minigunUntil&&wave>minigunUntil)expireMinigun();
  if(wave!==lastRemoteWave){saveProgress(wave);if(lastRemoteWave)refillAmmo('wave');const first=!lastRemoteWave;lastRemoteWave=wave;if(first)perkWave=Math.max(perkWave,wave-1);saveBest();applyWaveEnvironment(getWave(wave),first);if(first){for(const k of Object.keys(UNLOCKS))if(wave>=UNLOCKS[k])unlockWeapon(k,true);}else if(config.unlock)pendingUnlock=config.unlock;}
  if(phase==='active' && (wave!==previousProgramWave||oldPhase==='break')){previousProgramWave=wave;announceProgram();if(pendingUnlock){unlockWeapon(pendingUnlock);pendingUnlock=null;}}
  const evacNow=Number.isFinite(m.evac)&&m.evac>0;if(evacNow){if(!heli){evacTime=m.evac;spawnHeli();evacAnnounce();}evacTime=m.evac;}else if(evacTime>0)evacTime=0;
  for(const p of m.players){if(!validVector(p.p))continue;if(p.id===net.id){const old=player.health,by=player.reviver;readTeam(player,p);if(Number.isInteger(p.grenades))player.grenades=THREE.MathUtils.clamp(p.grenades,0,7);if(old>0&&p.health<=0){shooting=false;aim=false;reloadTime=0;reloadingWeapon=null;sound('hurt',{rate:.7});}else if(old<=0&&p.health>0){banner('СНОВА В СТРОЮ',by?'ПОДНЯЛ: '+mateName(by).toUpperCase():'НА НОГАХ','',2.4);sound('pickup',{rate:.8});}else if(p.health<old){damageTime=.3;if(!(acidFx>0&&old-p.health<6))sound('hurt');const ne=nearestEnemy(player.pos);if(ne&&old-p.health>1)overlay.hurtFrom(dirAngle(ne.mesh.position));}if(p.mini&&!minigunUntil){dropWave=p.mini;grantMinigun();}}else{const q=ensureMate(p.id,p.name);q.pos.fromArray(p.p);q.yaw=fnum(p.yaw,q.yaw,-1e4,1e4);readTeam(q,p);q.weapon=p.weapon;}}
  // Wave-break banner and perk offer come after the players loop: a guest that was downed or out at the end of
  // the wave has just been restored by the host (restoreTeam) and must see its new HP first. One offer per
  // completed wave (perkWave), also when the break was too short to reach this guest (the pick then waits).
  if(phase==='break'&&oldPhase!=='break'&&!evacNow){saveProgress(wave+1);expireMinigun();banner('ВОЛНА ОТБИТА','ПЕРЕДЫШКА','Ведущий начинает следующую волну',8);}
  {const done=phase==='break'?wave:wave-1;if(done>perkWave&&!evacNow&&player.health>0){perkWave=done;offerPerks();perkPending();}}
  const ids=new Set();for(const e of snapEnemies){if(!e||typeof e!=='object'||!validVector(e.p))continue;ids.add(e.id);let local=enemies.find(q=>q.id===e.id);if(!local){const type=ALL_TYPES.has(e.type)?e.type:'walker',mesh=makeZombie(type,e.id);dressZombie(mesh,radio.state.program,e.prize);local={id:e.id,type,mesh,boss:BOSS_SET.has(type),bodyMult:enemyStats(config,type).bodyMult||1,hp:e.hp,maxHp:e.mx||e.hp,target:new THREE.Vector3(...e.p),step:0};mesh.traverse(o=>{if(o.isMesh)o.userData.enemy=local;});mesh.position.fromArray(e.p);scene.add(mesh);enemies.push(local);}local.target=new THREE.Vector3(...e.p);if(e.hp<local.hp)local.flash=.12;local.hp=e.hp;if(e.mx)local.maxHp=e.mx;if(Number.isFinite(e.r))local.mesh.rotation.y=e.r;
    if(Array.isArray(e.an)&&Number.isInteger(e.an[0])&&e.an[0]>=0&&e.an[0]<ACT_TIME.length&&e.an[1]!==local.actSeq){local.actSeq=e.an[1];local.act=e.an[0];local.actT=fnum(e.an[2],0,0,ACT_TIME[e.an[0]]);}
    if(Number.isFinite(e.sg)&&e.sg>0)local.stagger=Math.min(1.5,e.sg);local.buff=!!e.bf;}
  for(let i=enemies.length-1;i>=0;i--)if(!ids.has(enemies[i].id)){dead.push({mesh:enemies[i].mesh,life:1.1,max:1.1});enemies.splice(i,1);}
  const pids=new Set();for(const p of m.pickups||[]){pids.add(p.id);if(!pickups.some(x=>x.id===p.id)&&!takenPickups.has(p.id)&&validVector(p.p))dropPickup(new THREE.Vector3(...p.p),p.type,p.id);}for(let i=pickups.length-1;i>=0;i--)if(!pids.has(pickups[i].id)){scene.remove(pickups[i].mesh);pickups.splice(i,1);}for(const id of takenPickups)if(!pids.has(id))takenPickups.delete(id);
  if(Array.isArray(m.grenades)&&m.grenades.length<=32)grenades.sync(m.grenades);
  if(m.drop){if(!drop||dropWave!==m.drop.wave){beginDrop(m.drop.wave);drop.update(m.drop.age||0);}}else if(drop){drop.dispose();drop=null;dropWave=0;}updateHUD();
}
function updateCoop(dt){
  if(net.role==='solo')return;netTick+=dt;
  for(const q of squad.values()){q.mesh.visible=q.tag.visible=true;animateMate(q,dt);}
  if(net.role==='client'){for(const e of enemies){if(e.target)e.mesh.position.lerp(e.target,Math.min(1,dt*18));if(radio.dancing(e.mesh.position)){dancePose(e.mesh,radio.state.elapsed,e.id);continue;}e.mesh.rotation.z=0;if(radio.still())continue;if(e.stagger>0)e.stagger-=dt;animateZombie(e,dt);}if(netTick>.05){netTick=0;net.send({t:'pose',p:player.pos.toArray(),yaw:player.yaw,pt:+player.pitch.toFixed(3),weapon:current,help:keys.has('KeyF')&&!coopPaused});}return;}
  if(netTick>.067){netTick=0;net.broadcast(snapshot());}
}
setInterval(()=>{if(net.role==='host'&&document.hidden&&(phase==='active'||phase==='break'))loop(performance.now(),true);},50);

for(const [x,z,type]of [[-4,-7,'walker'],[2,-15,'walker'],[9,-3,'brute'],[6,-25,'runner']]){const mesh=createZombie(type);mesh.position.set(x,0,z);mesh.rotation.y=.25;scene.add(mesh);decor.push(mesh);}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();if(postfx)postfx.setSize(innerWidth,innerHeight);else renderer.setSize(innerWidth,innerHeight);});
let previous=performance.now(),hudTime=0;
function loop(now,background=false){if(!background)requestAnimationFrame(loop);const dt=Math.max(0,Math.min(.05,(now-previous)/1000));previous=now;time+=dt;animateWorld(world.props,time,dt,camera);updateWorldFx(dt);updateHeli(dt);
  if(phase==='menu'){radio.preview(time);camera.position.set(5+Math.sin(time*.09)*.7,2.65,14);camera.lookAt(-1,1.7,-16);for(const w of Object.values(weapons))w.mesh.visible=false;decor.forEach((d,i)=>{d.rotation.y=.3+Math.sin(time*.2+i)*.1;d.userData.leftArm.rotation.x=-.8+Math.sin(time+i)*.1;d.userData.rightArm.rotation.x=-.9;});}
  if(phase==='active'||phase==='break'){
    shootCooldown=Math.max(0,shootCooldown-dt);shotKick=Math.max(0,shotKick-dt*.7);shake=Math.max(0,shake-dt*.9);damageTime=Math.max(0,damageTime-dt);hitTime=Math.max(0,hitTime-dt);bannerTime=Math.max(0,bannerTime-dt);nextBanner();toastTime=Math.max(0,toastTime-dt);$('damage').style.opacity=damageTime>0?.6:player.health<30?.12+Math.sin(time*7)*.08:0;$('hitmarker').style.opacity=hitTime>0?1:0;if(hitTime<=0)$('hitmarker').classList.remove('kill');$('banner').style.opacity=bannerTime>0?1:0;$('toast').style.opacity=toastTime>0?1:0;
    updateReload(dt);updateIntro(dt);updateRadioBox(dt);
    radio.tick(dt,phase==='active');
    flash.visible=shootCooldown>weapons[current].rate-.04&&current!=='rpg'&&flash.visible;weaponLight.intensity=flash.visible?8:0;updatePlayer(dt);if(shooting&&!coopPaused)fire();updateCoop(dt);if(net.role!=='client')updateDowned(dt);updateTeamHud();updatePings(dt);
    navTime-=dt;if(navTime<=0){navigator.update(player.pos.x,player.pos.z);for(const q of squad.values())q.nav?.update(q.pos.x,q.pos.z);navTime=.5;}if(Object.values(weapons).every(w=>w.mag+w.reserve===0)){emptyTime+=dt;if(emptyTime>=5){weapons.ak.reserve=30;emptyTime=0;toast('АВАРИЙНЫЙ ЗАПАС · +30 ПАТРОНОВ',3);sound('pickup');}}else emptyTime=0;
    if(net.role!=='client'&&phase==='active'){spawnTimer-=dt;if(spawned<config.count&&spawnTimer<=0&&enemies.length<(config.maxAlive||75)){spawnWaveEnemy();spawnTimer=config.spawnInterval;}updateEnemies(dt);}else if(net.role!=='client'&&phase==='break'){if(evacTime>0){evacTime-=dt;if(evacTime<=0){evacTime=0;victory();}}else{breakTime-=dt;if(breakTime<=0)nextWave();}}else if(net.role==='client'&&evacTime>0)evacTime=Math.max(.01,evacTime-dt);
    if(phase!=='gameover'){updateProjectiles(dt);updateRocks(dt);updateHazards(dt);grenades.update(dt,net.role!=='client');updateEffects(dt);}updateDrop(dt);updateRegen(dt);hudTime+=dt;if(hudTime>.2){hudTime=0;updateHUD();updateMusic();updateHeartbeat();}
  }
  render(dt);
}
// Test hooks, only with ?debug=1 in the address bar.
if(new URLSearchParams(window.location.search).get('debug')==='1')window.__outpost={
  get state(){return {phase,wave,waveEvent,combo,score,kills,current,difficulty,evac:+evacTime.toFixed(2),postfx:!!postfx,env:world.getEnvironment(),bosses:config.bosses,bossQueue:[...bossQueue],spawned,waveKills,objective:$('objective').textContent,hazards:{globs:globs.length,pools:pools.length,hooks:hooks.length},radio:{current:radioCur?.text||null,queued:radioQueue.length},intro:introTime>0?$('introTitle').textContent:null,health:Math.round(player.health),count:config.count,boss:config.boss,enemies:enemies.map(e=>({type:e.type,hp:Math.round(e.hp),maxHp:Math.round(e.maxHp||0)})),ammo:Object.fromEntries(Object.entries(weapons).map(([k,w])=>[k,[w.mag,w.reserve]]))};},
  jump(n){for(const e of enemies){scene.remove(e.mesh);disposeZombie(e.mesh);}enemies.length=0;wave=n-1;phase='active';nextWave();spawnTimer=0;},
  spawn(type){forcedType=type;spawnEnemy();return enemies.at(-1)?.type;},
  // Visual/announce only: the event's numbers are baked into waveConfig for campaign waves.
  event(key){setWaveEvent(key);announceProgram();return waveEvent;},
  difficulty(id){return chooseDifficulty(id)?difficulty:null;},
  boss(type='boss'){forcedType=type;spawnEnemy();return enemies.at(-1)?.type;},
  env(tod=0,weather='clear'){applyWaveEnvironment({tod,weather});return world.getEnvironment();},
  evac(){for(const e of enemies){scene.remove(e.mesh);disposeZombie(e.mesh);}enemies.length=0;wave=CAMPAIGN_LENGTH;phase='active';spawned=config.count;bossQueue=[];completeWave();return evacTime;},
  endless(){startEndless();return {phase,wave};},
  stats(){return collectStats();},
  settings(){return {...settings};},
  postfx(on=true){postfxBypass=!on;return !!postfx&&!postfxBypass;},
  get postfxApi(){return postfx;},
  // Offline client-path testing: snapshot() from the host state, fakeClient() flips the role, packet(m) feeds a host packet.
  snapshot(){return JSON.parse(JSON.stringify(snapshot()));},
  fakeClient(on=true,id=null){net.role=on?'client':'solo';net.room=on?'debug-host':null;if(id)net.id=id;return net.role;},
  packet(m){receivePacket(m,net.room);return this.state;},
  // god(): huge HP (as before); god(true): also ignore all damage to the local player.
  god(lock=false){player.health=100000;godMode=!!lock;},
  damage(type,amount=1000,head=false){const e=enemies.find(q=>q.type===type);if(!e)return null;hurtEnemy(e,amount,head,null,player);return {hp:Math.round(e.hp),phase:e.phase,alive:enemies.includes(e)};},
  // Instant switch (tests); weaponAnim(name) uses the lower/raise animation.
  weapon(name){setWeapon(name,true);return current;},
  // Ends the current wave now (host): wave-break restore, ammo refill, perks.
  complete(){if(net.role==='client'||phase!=='active')return null;for(const e of enemies){scene.remove(e.mesh);disposeZombie(e.mesh);}enemies.length=0;completeWave();return {phase,team:this.team};},
  weaponAnim(name){setWeapon(name);return {current,swapTo};},
  get vm(){return {...VM,current,swapTo,sprinting:player.sprinting,stamina:+player.stamina.toFixed(2),exhausted:player.exhausted,fov:+camera.fov.toFixed(2),camY:+camera.position.y.toFixed(4),scoped:scoped(),aim,semiReady};},
  hold(codes=[],on=true){for(const c of [].concat(codes))on?keys.add(c):keys.delete(c);return [...keys];},
  aim(on=true){aim=!!on;return aim;},
  trigger(on=true){shooting=!!on;if(on)semiReady=true;return shooting;},
  stamina(n){player.stamina=Number(n)||0;player.exhausted=false;return player.stamina;},
  // Steps n frames (60 fps) recording the view-model state; returns the per-frame trace plus a summary
  // (sprint state flips and the largest per-frame jumps of the weapon and camera).
  trace(n=120,hold=[],each=null){for(const c of hold)keys.add(c);const out=[];let t=previous;for(let i=0;i<n;i++){if(each)each(i);t+=1000/60;loop(t,true);const w=weapons[current].mesh;out.push({i,spr:player.sprinting?1:0,st:+player.stamina.toFixed(2),ex:player.exhausted?1:0,sb:+VM.sprint.toFixed(4),ab:+VM.ads.toFixed(4),wy:+w.position.y.toFixed(5),wrx:+w.rotation.x.toFixed(5),wry:+w.rotation.y.toFixed(5),cy:+camera.position.y.toFixed(5),fov:+camera.fov.toFixed(3),sw:+VM.sw.toFixed(3),cur:current});}for(const c of hold)keys.delete(c);let flips=0,dwy=0,dwrx=0,dwry=0,dcy=0,dfov=0;for(let i=1;i<out.length;i++){if(out[i].spr!==out[i-1].spr)flips++;dwy=Math.max(dwy,Math.abs(out[i].wy-out[i-1].wy));dwrx=Math.max(dwrx,Math.abs(out[i].wrx-out[i-1].wrx));dwry=Math.max(dwry,Math.abs(out[i].wry-out[i-1].wry));dcy=Math.max(dcy,Math.abs(out[i].cy-out[i-1].cy));dfov=Math.max(dfov,Math.abs(out[i].fov-out[i-1].fov));}return {summary:{frames:n,flips,maxStep:{wy:+dwy.toFixed(5),wrx:+dwrx.toFixed(5),wry:+dwry.toFixed(5),cy:+dcy.toFixed(5),fov:+dfov.toFixed(3)}},trace:out};},
  // Co-op testing offline: fakeHost() makes this page a host with no peers; mate() adds a soldier teammate.
  fakeHost(on=true){net.role=on?'host':'solo';net.id=on?'debug-host':null;net.name=on?'Хост':net.name;return net.role;},
  mate(name='Тест',x=null,z=null){const id='mate-'+(squad.size+1);const q=ensureMate(id,name);if(x!==null){q.pos.set(x,1.72,z);q.mesh.position.set(x,0,z);q.ax=x;q.az=z;}return id;},
  setMate(id,o={}){const q=squad.get(id);if(!q)return null;if(Number.isFinite(o.x))q.pos.x=o.x;if(Number.isFinite(o.z))q.pos.z=o.z;for(const k of ['health','help','pitch','yaw'])if(o[k]!==undefined)q[k]=o[k];if(o.perks)q.perks=sanitizePerks(o.perks);return this.team;},
  hurt(id,amount=1000){const q=id==='me'?player:squad.get(id);if(!q)return null;const g=godMode;godMode=false;q.grace=0;damageTarget(q,amount,null,true);godMode=g;return this.team;},
  get team(){return team().map(q=>({id:q===player?'me':q.id,name:q===player?net.name:q.name,health:+q.health.toFixed(1),down:!!q.down,out:!!q.out,bleed:+(q.bleed||0).toFixed(2),revive:+(q.revive||0).toFixed(3),reviver:q.reviver||null,selfT:+(q.selfT||0).toFixed(2),secondUsed:!!q.secondUsed,revives:q.stats?.revives||0,db:q.db!==undefined?+q.db.toFixed(3):undefined}));},
  get ui(){return {downed:!$('downed').hidden,downedTimer:$('downedTimer').textContent,downedTitle:$('downed').querySelector('.downed-title')?.textContent,dead:$('downed').classList.contains('dead'),ring:!$('reviveRing').hidden,ringLabel:$('reviveLabel').textContent,ringOffset:$('reviveFill').style.strokeDashoffset,pings:[...$('pingLayer').children].map(e=>({cls:e.className,b:e.querySelector('b')?.textContent,small:e.querySelector('small')?.textContent,tf:e.style.transform})),squad:$('squadList').textContent,lowAmmo:$('lowAmmo').hidden?null:$('lowAmmo').textContent,scope:!$('scope').hidden,slots:WEAPON_KEYS.map(k=>({k,locked:$(SLOT_IDS[k]).classList.contains('locked'),active:$(SLOT_IDS[k]).classList.contains('active')})),weaponName:$('weaponName').textContent,ammoStatus:$('ammoStatus').textContent,gameover:!$('gameover').hidden,stats:$('statsTable').textContent};},
  ping(){pingCd=0;placePing();return pings.map(p=>({kind:p.kind,id:p.id,by:p.by,pos:p.pos.toArray().map(n=>+n.toFixed(1))}));},
  mateAnim(id){const q=squad.get(id);if(!q)return null;const u=q.mesh.userData,r=n=>u[n]?+u[n].rotation.x.toFixed(3):null;return {mv:+q.mv.toFixed(2),step:+q.step.toFixed(2),db:+q.db.toFixed(3),rotX:+q.mesh.rotation.x.toFixed(3),y:+q.mesh.position.y.toFixed(3),leftLeg:r('leftLeg'),torso:r('torso'),rightArm:r('rightArm'),tagY:+q.tag.position.y.toFixed(2),tagKey:q.tagKey,flash:q.flash.visible};},
  shootAt(type){const e=enemies.filter(q=>q.type===type).sort((a,b)=>a.mesh.position.distanceTo(player.pos)-b.mesh.position.distanceTo(player.pos))[0]||enemies[0];if(!e)return null;if(e.target)e.mesh.position.copy(e.target);const head=e.mesh.position.clone();head.y=e.boss?(e.mesh.userData.headY||2.9)+.1:Math.min(1.25,(e.mesh.userData.headY||1.5)-.25);const d=head.sub(player.pos);player.yaw=Math.atan2(-d.x,-d.z);player.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));updatePlayer(0);camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);shootCooldown=0;reloadTime=0;semiReady=true;swapTo=null;VM.sw=0;VM.sprint=0;const before=e.hp;fire();return {type:e.type,before:Math.round(before),after:Math.round(e.hp),alive:enemies.includes(e)};},
  near(type,dist=5){const e=enemies.find(q=>q.type===type);if(!e)return null;if(phase==='paused')phase=beforePause;$('pause').hidden=true;e.mesh.position.set(player.pos.x-Math.sin(player.yaw)*dist,0,player.pos.z-Math.cos(player.yaw)*dist);return e.mesh.position.toArray().map(Math.round);},
  arrange(dist=6){const s=Math.sin(player.yaw),c=Math.cos(player.yaw);enemies.forEach((e,i)=>{const off=(i-(enemies.length-1)/2)*1.9;e.mesh.position.set(player.pos.x-s*dist+c*off,0,player.pos.z-c*dist-s*off);e.mesh.rotation.y=player.yaw;});phase='paused';$('pause').hidden=true;bannerTime=0;$('banner').style.opacity=0;return enemies.length;},
  run(sec=1){let t=previous;for(let i=0;i<Math.round(sec*60);i++){t+=1000/60;loop(t,true);}return {phase,health:Math.round(player.health),enemies:enemies.length};},
  perk(id){player.perks[id]=(player.perks[id]||0)+1;pipKey='';updateHUD();return mods();},
  offer(){offerPerks();return perkChoice;},
  slam(){const b=enemies.find(e=>e.type==='boss'||e.type==='father');if(!b)return null;const h=player.health;bossSlam(b);return {before:h,after:player.health};},
  // Pass 2: force an ability on the first enemy of a type: spit fan scream birth hook cleave dash charge.
  ability(type,kind){const e=enemies.find(q=>q.type===type);if(!e)return null;const tg=nearestTarget(e.mesh.position);if(kind==='cleave'){e.cleaveT=.95;e.cleaveHits=0;setAct(e,ACT.cleave);}else if(kind==='dash'){const d=tg.pos.clone().sub(e.mesh.position).setY(0).normalize();e.dashT=.55;e.ddx=d.x;e.ddz=d.z;e.dashHit=new Set();setAct(e,ACT.dash);}else if(kind==='charge'){e.chargeCd=0;e.slam=99;e.rockCd=99;}else windup(e,kind,.05,kind==='scream'?ACT.scream:kind==='birth'?ACT.birth:kind==='hook'?ACT.hook:ACT.spit,tg);return {type,kind,act:e.act,seq:e.actSeq};},
  get hazards(){return {globs:globs.length,pools:pools.length,hooks:hooks.map(h=>({state:h.state,dist:+h.dist.toFixed(1)})),acidFx:+acidFx.toFixed(2),screamFx:+screamFx.toFixed(2),pull:player.pull?{t:+player.pull.t.toFixed(2)}:null,slow:+(player.slowT||0).toFixed(2),buffed:enemies.filter(e=>e.buffT>0||e.buff).length};},
  anim(type){const e=enemies.find(q=>q.type===type);if(!e)return null;const u=e.mesh.userData,r=n=>u[n]?+u[n].rotation.x.toFixed(3):null;return {act:e.act||0,seq:e.actSeq||0,mv:+(e.mv||0).toFixed(2),step:+(e.step||0).toFixed(2),leftLeg:r('leftLeg'),leftArm:r('leftArm'),rightArm:r('rightArm'),torso:r('torso'),jaw:r('jaw'),stagger:+(e.stagger||0).toFixed(2),hookVisible:u.hook?u.hook.visible:null};},
  // Moves the first enemy of a type to a spot relative to the player's view (no pause) and returns its id.
  place(type,dist=8,side=0){const e=enemies.find(q=>q.type===type);if(!e)return null;const s=Math.sin(player.yaw),c=Math.cos(player.yaw);e.mesh.position.set(player.pos.x-s*dist+c*side,0,player.pos.z-c*dist-s*side);e.ax=undefined;return e.id;},
  clearEnemies(){for(const e of enemies){scene.remove(e.mesh);disposeZombie(e.mesh);}enemies.length=0;clearHazards();return 0;},
  shootFrom(type,fromBehind=false){const e=enemies.find(q=>q.type===type);if(!e)return null;const ry=e.mesh.rotation.y,dir=new THREE.Vector3(Math.sin(ry),0,Math.cos(ry)).multiplyScalar(fromBehind?1:-1),before=e.hp;hurtEnemy(e,100,false,dir,player);return {before:Math.round(before),after:Math.round(e.hp)};},
};
applyWaveEnvironment(getWave(1),true);renderDifficulty();renderStartWave();updateMusic();
try{renderer.compile(scene,camera);$('loading').hidden=true;requestAnimationFrame(loop);}catch(e){$('loadingText').textContent='Не удалось запустить 3D. Попробуй обновить страницу в Chrome или Edge.';console.error(e);}
