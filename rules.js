export function waveConfig(wave,players=1) {
  const w=Math.max(1,Math.min(9999,Math.floor(Number(wave)||1)));
  const team=Math.max(1,Math.min(4,Math.floor(Number(players)||1)));
  const age=w-1;
  // Early waves teach the arena; exponential durability and a quadratic horde
  // make wave ten a sustained siege. Beyond wave 31 growth becomes linear
  // so long-running sessions cannot overflow numeric health values.
  return {
    count:Math.ceil((7+4*w+1.3*age*age)*(1+.65*(team-1))),
    health:Math.round(64*Math.pow(1.2,Math.min(age,30))*(1+Math.max(0,age-30)*.2)*(1+.12*(team-1))),
    speed:Math.min(4.2,1.65+age*.22),
    damage:Math.min(50,9.3+age*2.1),
    runnerChance:w>=3?Math.min(.42,.18+(w-3)*.028):0,
    bruteChance:w>=5?Math.min(.32,.13+(w-5)*.024):0,
    spawnInterval:Math.max(.12,.915*Math.pow(.79,age)),
    maxAlive:Math.min(90,20+w*4+(team-1)*6),
  };
}
export function enemyStats(config,type) { return {health:config.health*(type==='brute'?2.8:type==='runner'?.72:1),speed:config.speed*(type==='runner'?1.65:type==='brute'?.72:1),damage:config.damage*(type==='brute'?1.8:1)}; }
export function blastDamage(distance,radius=8.5,power=240) { return distance>=radius?0:power*(1-distance/radius)*.85+power*.15; }
export function bestWave(previous,current) { return Math.max(Number(previous)||0,current); }
