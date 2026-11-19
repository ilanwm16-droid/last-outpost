import * as THREE from './vendor/three.module.js';

const RADIUS=.13, FUSE=2.5, LIMIT=37.5-RADIUS, GRAVITY=16, EPS=.0001;
const bodyGeometry=new THREE.SphereGeometry(.12,10,8);
const neckGeometry=new THREE.CylinderGeometry(.045,.055,.07,8);
const handleGeometry=new THREE.BoxGeometry(.035,.19,.035);
const ringGeometry=new THREE.TorusGeometry(.045,.009,5,10);
const bodyMaterial=new THREE.MeshStandardMaterial({color:0x52663c,roughness:.84,metalness:.25});
const steelMaterial=new THREE.MeshStandardMaterial({color:0x9ba394,roughness:.4,metalness:.75});
const validVector=v=>v&&[v.x,v.y,v.z].every(Number.isFinite);
const validArray=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<300);

function grenadeMesh(){
  const mesh=new THREE.Group();mesh.name='hand-grenade';
  const body=new THREE.Mesh(bodyGeometry,bodyMaterial);body.scale.y=1.2;mesh.add(body);
  const neck=new THREE.Mesh(neckGeometry,steelMaterial);neck.position.y=.15;mesh.add(neck);
  const lever=new THREE.Mesh(handleGeometry,steelMaterial);lever.position.set(.085,.09,0);lever.rotation.z=.23;mesh.add(lever);
  const ring=new THREE.Mesh(ringGeometry,steelMaterial);ring.position.set(-.04,.2,0);mesh.add(ring);
  return mesh;
}

export function createGrenades(scene,colliders,onDetonate=()=>{}){
  const items=[];
  const boxes=colliders.map(b=>({min:[b.x-b.hx-RADIUS,-RADIUS,b.z-b.hz-RADIUS],max:[b.x+b.hx+RADIUS,(b.height||3.2)+RADIUS,b.z+b.hz+RADIUS]}));
  function remove(item){const index=items.indexOf(item);if(index>=0)items.splice(index,1);scene.remove(item.mesh);}
  function clear(){for(const item of [...items])remove(item);}
  function correctOverlap(item){
    const p=item.mesh.position;p.y=Math.max(RADIUS,p.y);p.x=THREE.MathUtils.clamp(p.x,-LIMIT,LIMIT);p.z=THREE.MathUtils.clamp(p.z,-LIMIT,LIMIT);
    for(const box of boxes){const a=p.toArray();if(!a.every((v,i)=>v>box.min[i]+EPS&&v<box.max[i]-EPS))continue;
      const faces=[{axis:0,side:-1,d:a[0]-box.min[0]},{axis:0,side:1,d:box.max[0]-a[0]},{axis:2,side:-1,d:a[2]-box.min[2]},{axis:2,side:1,d:box.max[2]-a[2]},{axis:1,side:1,d:box.max[1]-a[1]}].sort((a,b)=>a.d-b.d);
      const f=faces[0],axis=['x','y','z'][f.axis];p[axis]=(f.side<0?box.min:box.max)[f.axis]+f.side*EPS;
      if(item.velocity[axis]*f.side<0)item.velocity[axis]*=-.45;
    }
  }
  function firstHit(pos,delta){
    let hit=null;
    const accept=(t,axis,sign)=>{if(t>=-EPS&&t<=1&&(!hit||t<hit.t))hit={t:Math.max(0,t),axis,sign};};
    if(delta.y<0&&pos.y+delta.y<RADIUS)accept((RADIUS-pos.y)/delta.y,'y',1);
    for(const axis of ['x','z']){if(delta[axis]>0&&pos[axis]+delta[axis]>LIMIT)accept((LIMIT-pos[axis])/delta[axis],axis,-1);if(delta[axis]<0&&pos[axis]+delta[axis]<-LIMIT)accept((-LIMIT-pos[axis])/delta[axis],axis,1);}
    for(const box of boxes){
      let near=-Infinity,far=Infinity,normalAxis=null,normalSign=0,miss=false;
      for(let i=0;i<3;i++){const axis=['x','y','z'][i],p=pos[axis],d=delta[axis];
        if(Math.abs(d)<1e-12){if(p<box.min[i]||p>box.max[i]){miss=true;break;}continue;}
        const t1=(box.min[i]-p)/d,t2=(box.max[i]-p)/d,entry=Math.min(t1,t2);
        if(entry>near){near=entry;normalAxis=axis;normalSign=d>0?-1:1;}far=Math.min(far,Math.max(t1,t2));
        if(near>far){miss=true;break;}
      }
      if(!miss&&normalAxis&&far>=0&&near>=-EPS)accept(near,normalAxis,normalSign);
    }
    return hit;
  }
  function step(item,dt){
    const p=item.mesh.position,v=item.velocity;v.y-=GRAVITY*dt;
    let left=dt;
    for(let bounce=0;bounce<4&&left>1e-6;bounce++){
      const delta=v.clone().multiplyScalar(left),hit=firstHit(p,delta);
      if(!hit){p.add(delta);break;}
      p.addScaledVector(delta,hit.t);p[hit.axis]+=hit.sign*EPS;
      if(v[hit.axis]*hit.sign<0)v[hit.axis]*=-.45;
      if(hit.axis==='y'&&hit.sign>0){if(Math.abs(v.y)<.7)v.y=0;v.x*=.77;v.z*=.77;}
      left*=1-hit.t;
    }
    item.mesh.rotation.x+=dt*5;item.mesh.rotation.z+=dt*3;
  }
  function simulate(item,dt){
    let remaining=Math.min(dt,item.life);correctOverlap(item);
    while(remaining>1e-8){const h=Math.min(1/120,remaining);step(item,h);remaining-=h;}
    item.life=Math.max(0,item.life-dt);
  }
  function spawn({id,origin,direction,age=0}){
    if(id===undefined||!validVector(origin)||!validVector(direction)||items.some(g=>g.id===id))return null;
    const mesh=grenadeMesh();mesh.position.copy(origin);
    const velocity=direction.clone();if(velocity.lengthSq()<.001)velocity.set(0,0,-1);velocity.normalize().multiplyScalar(14);velocity.y+=4;
    const item={id,mesh,velocity,life:FUSE};items.push(item);scene.add(mesh);correctOverlap(item);
    if(Number.isFinite(age)&&age>0)simulate(item,Math.min(FUSE,age));
    return item;
  }
  function update(dt,authoritative=true){
    if(!Number.isFinite(dt)||dt<=0)return;
    for(const item of [...items]){simulate(item,Math.min(dt,FUSE));if(item.life<=1e-8){const p=item.mesh.position.clone();remove(item);if(authoritative)onDetonate(p);}}
  }
  function sync(records){
    if(!Array.isArray(records))return;
    const ids=new Set();
    for(const r of records.slice(0,32)){
      if(r?.id===undefined||ids.has(r.id)||!validArray(r.p)||!validArray(r.v)||!Number.isFinite(r.life)||r.life<=0||r.life>FUSE)continue;
      ids.add(r.id);let item=items.find(g=>g.id===r.id);
      if(!item){const mesh=grenadeMesh();item={id:r.id,mesh,velocity:new THREE.Vector3(),life:r.life};items.push(item);scene.add(mesh);}
      item.mesh.position.fromArray(r.p);item.velocity.fromArray(r.v);item.life=r.life;
    }
    for(const item of [...items])if(!ids.has(item.id))remove(item);
  }
  return {items,spawn,update,sync,clear};
}
