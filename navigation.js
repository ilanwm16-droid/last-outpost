// One shared field serves the entire horde. Rebuild it when the player moves
// (at most twice a second); directions can be queried every animation frame.
export function createNavigator(colliders, bound=37.5) {
  const cell=1.25, clearance=0.72, size=Math.ceil(bound*2/cell);
  const length=size*size, free=new Uint8Array(length), field=new Int32Array(length), queue=new Int32Array(length);
  const center=i=>-bound+(i+0.5)*cell;
  const index=(x,z)=>z*size+x;
  const clamp=n=>Math.max(0,Math.min(size-1,n));
  const toGrid=n=>clamp(Math.floor((n+bound)/cell));
  let goal=-1;

  function blocked(x,z,r) {
    return Math.abs(x)>bound-r || Math.abs(z)>bound-r || colliders.some(b=>Math.abs(x-b.x)<b.hx+r&&Math.abs(z-b.z)<b.hz+r);
  }
  // Slab intersection checks the complete segment, including long segments
  // that would otherwise skip narrow poles or crate corners when sampled.
  function clearSegment(x,z,tx,tz,r) {
    if(Math.abs(x)>bound-r||Math.abs(z)>bound-r||Math.abs(tx)>bound-r||Math.abs(tz)>bound-r)return false;
    const dx=tx-x,dz=tz-z;
    for(const b of colliders) {
      let lo=0,hi=1;
      const minX=b.x-b.hx-r,maxX=b.x+b.hx+r,minZ=b.z-b.hz-r,maxZ=b.z+b.hz+r;
      if(Math.abs(dx)<1e-9) {if(x<=minX||x>=maxX)continue;}
      else {const a=(minX-x)/dx,c=(maxX-x)/dx;lo=Math.max(lo,Math.min(a,c));hi=Math.min(hi,Math.max(a,c));if(lo>=hi)continue;}
      if(Math.abs(dz)<1e-9) {if(z<=minZ||z>=maxZ)continue;}
      else {const a=(minZ-z)/dz,c=(maxZ-z)/dz;lo=Math.max(lo,Math.min(a,c));hi=Math.min(hi,Math.max(a,c));if(lo>=hi)continue;}
      if(lo<hi)return false;
    }
    return true;
  }
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)free[index(x,z)]=blocked(center(x),center(z),clearance)?0:1;
  field.fill(-1);
  function update(playerX,playerZ) {
    let nextGoal=-1,best=Infinity,fallback=-1,fallbackDistance=Infinity;
    for(let z=0;z<size;z++)for(let x=0;x<size;x++) {
      const i=index(x,z);if(!free[i])continue;
      const px=center(x),pz=center(z),d=(px-playerX)**2+(pz-playerZ)**2;
      if(d<fallbackDistance){fallbackDistance=d;fallback=i;}
      if(d<best&&clearSegment(px,pz,playerX,playerZ,0.36)){best=d;nextGoal=i;}
    }
    if(nextGoal<0)nextGoal=fallback;
    if(nextGoal===goal)return;
    goal=nextGoal;field.fill(-1);if(goal<0)return;
    let head=0,tail=0;queue[tail++]=goal;field[goal]=0;
    while(head<tail) {
      const i=queue[head++],x=i%size,z=Math.floor(i/size),distance=field[i]+1;
      for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=size||nz>=size)continue;
        const ni=index(nx,nz);if(free[ni]&&field[ni]<0){field[ni]=distance;queue[tail++]=ni;}
      }
    }
  }
  function normalize(x,z) {const d=Math.hypot(x,z);return d>0.001?{x:x/d,z:z/d}:{x:0,z:0};}
  function direction(x,z,targetX,targetZ,radius=0.4) {
    if(clearSegment(x,z,targetX,targetZ,radius))return normalize(targetX-x,targetZ-z);
    const gx=toGrid(x),gz=toGrid(z),here=index(gx,gz),hereDistance=field[here];
    let bestNode=-1,bestScore=Infinity;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
      const nx=gx+dx,nz=gz+dz;if(nx<0||nz<0||nx>=size||nz>=size)continue;
      const ni=index(nx,nz);if(!free[ni]||field[ni]<0)continue;
      if(hereDistance>=0&&field[ni]>hereDistance)continue;
      if(dx&&dz&&(!free[index(gx+dx,gz)]||!free[index(gx,gz+dz)]))continue;
      const px=center(nx),pz=center(nz),d=Math.hypot(px-x,pz-z);
      if(d<0.08||!clearSegment(x,z,px,pz,radius))continue;
      const score=field[ni]+d/cell*0.15;
      if(score<bestScore){bestScore=score;bestNode=ni;}
    }
    // An actor can stand in a cell excluded by the more conservative brute
    // clearance. Reconnect it to a visible, reachable center nearby.
    if(bestNode<0) {
      let nearest=Infinity;
      for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++) {
        const nx=gx+dx,nz=gz+dz;if(nx<0||nz<0||nx>=size||nz>=size)continue;
        const ni=index(nx,nz);if(!free[ni]||field[ni]<0)continue;
        const px=center(nx),pz=center(nz),d=Math.hypot(px-x,pz-z);
        if(d<0.1||d>=nearest||!clearSegment(x,z,px,pz,radius))continue;
        nearest=d;bestNode=ni;
      }
    }
    if(bestNode<0)return normalize(targetX-x,targetZ-z);
    return normalize(center(bestNode%size)-x,center(Math.floor(bestNode/size))-z);
  }
  return {update,direction};
}
