export function waveConfig(wave,players=1) {
  const w=Math.max(1,Math.min(9999,Math.floor(Number(wave)||1)));
  const team=Math.max(1,Math.min(4,Math.floor(Number(players)||1)));
  const age=w-1;
  // Pressure grows mostly through numbers, speed and mixed enemy types rather
  // than bullet-sponge health, so every wave stays readable and fair. Beyond
  // wave 31 growth becomes linear so long sessions cannot overflow values.
  return {
    count:Math.ceil((6+3.2*w+.55*age*age)*(1+.6*(team-1))),
    health:Math.round(60*Math.pow(1.14,Math.min(age,30))*(1+Math.max(0,age-30)*.15)*(1+.15*(team-1))),
    speed:Math.min(4.3,1.7+age*.2),
    damage:Math.min(38,8+age*1.6),
    runnerChance:w>=2?Math.min(.4,.15+(w-2)*.03):0,
    bruteChance:w>=4?Math.min(.28,.1+(w-4)*.02):0,
    exploderChance:w>=3?Math.min(.16,.07+(w-3)*.012):0,
    spawnInterval:Math.max(.18,.95*Math.pow(.85,age)),
    maxAlive:Math.min(80,16+w*4+(team-1)*6),
    boss:w%5===0,
  };
}
export function enemyStats(config,type) {
  const k={
    walker:{health:1,speed:1,damage:1},
    runner:{health:.7,speed:1.6,damage:.9},
    brute:{health:2.6,speed:.75,damage:1.7},
    exploder:{health:.55,speed:1.35,damage:0},
    boss:{health:24,speed:.82,damage:2.4},
  }[type]||{health:1,speed:1,damage:1};
  return {health:config.health*k.health,speed:Math.min(type==='runner'?6.2:5,config.speed*k.speed),damage:config.damage*k.damage};
}
export function blastDamage(distance,radius=8.5,power=240) { return distance>=radius?0:power*(1-distance/radius)*.85+power*.15; }
export function bestWave(previous,current) { return Math.max(Number(previous)||0,current); }

// Random wave modifiers. Boss waves and the first two waves stay clean.
export const WAVE_EVENTS={
  blood:{title:'Кровавая луна',hint:'Зомби быстрее и злее. Очки ×2.',speed:1.22,damage:1.15,score:2,fog:0x3a1014,bg:0x1d0a0d,density:.024,light:0xff6a5a},
  fog:{title:'Мёртвый туман',hint:'Видимость почти ноль. Слушай шаги. Очки ×1.5.',score:1.5,fog:0x5d6a66,bg:0x434d4b,density:.075,light:0xb8c8c4},
  gold:{title:'Золотая лихорадка',hint:'Из зомби сыплются припасы.',score:1,drops:2.6,fog:0x3a3018,bg:0x1c1a10,density:.02,light:0xffd27a},
  swarm:{title:'Орда бегунов',hint:'Почти все — бегуны. Хрупкие, но быстрые.',score:1.3,runner:.8,health:.75,count:1.3,fog:0x1b2d2a,bg:0x0f1c1f,density:.022,light:0x9ce0c8},
};
export function rollWaveEvent(wave,random=Math.random) {
  if(wave<3||wave%5===0||random()>.42)return null;
  const keys=Object.keys(WAVE_EVENTS);
  return keys[Math.floor(random()*keys.length)];
}
