import * as THREE from './vendor/three.module.js';

// Each instance owns its assets, so picking up a drop can dispose everything.
export function createAirdrop(scene) {
  const mesh=new THREE.Group(),canopy=new THREE.Group(),plane=new THREE.Group();
  mesh.name='minigun-airdrop';mesh.position.set(0,32,3);
  mesh.userData={landed:false,age:0,kind:'minigun',expiresAfterWave:null};
  const orange=new THREE.MeshStandardMaterial({color:0xc97f2c,roughness:.8});
  const metal=new THREE.MeshStandardMaterial({color:0x34483f,metalness:.4,roughness:.6});
  const dark=new THREE.MeshStandardMaterial({color:0x182e2b,roughness:.8});
  const fabric=new THREE.MeshStandardMaterial({color:0xcfc5a2,roughness:1,side:THREE.DoubleSide});
  const glow=new THREE.MeshBasicMaterial({color:0xffc567});
  const ropeMat=new THREE.LineBasicMaterial({color:0xaebaa7});
  const assets=new Set([orange,metal,dark,fabric,glow,ropeMat]);
  function add(parent,geometry,material,x=0,y=0,z=0){assets.add(geometry);const part=new THREE.Mesh(geometry,material);part.position.set(x,y,z);parent.add(part);return part;}
  const cube=new THREE.BoxGeometry(1,1,1);assets.add(cube);
  function box(parent,mat,x,y,z,w,h,d){const part=add(parent,cube,mat,x,y,z);part.scale.set(w,h,d);return part;}
  box(mesh,orange,0,0,0,1.5,1.08,1.1);
  box(mesh,metal,0,.56,0,1.62,.1,1.2);
  box(mesh,metal,0,-.55,0,1.62,.1,1.2);
  for(const x of [-.59,.59])box(mesh,dark,x,0,0,.12,1.14,1.12);
  for(const z of [-.56,.56]){
    box(mesh,glow,0,.06,z,.7,.07,.015);
    box(mesh,glow,0,.06,z,.07,.5,.015);
    box(mesh,metal,-.5,-.14,z,.12,.12,.04);
    box(mesh,metal,.5,-.14,z,.12,.12,.04);
  }
  const beaconMat=new THREE.MeshBasicMaterial({color:0xffac3d,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide});assets.add(beaconMat);
  const beam=add(mesh,new THREE.CylinderGeometry(.16,.4,8,12,1,true),beaconMat,0,4.6,0);
  const ringMat=new THREE.MeshBasicMaterial({color:0xffbd5d,transparent:true,opacity:.65,depthWrite:false,side:THREE.DoubleSide});assets.add(ringMat);
  const ring=add(mesh,new THREE.RingGeometry(1.15,1.3,40),ringMat,0,-.53,0);ring.rotation.x=-Math.PI/2;
  const lamp=new THREE.PointLight(0xffb752,4,9);lamp.position.y=1;mesh.add(lamp);
  // Hemispherical canopy with its open skirt pointing down.
  canopy.position.y=4.8;mesh.add(canopy);
  add(canopy,new THREE.SphereGeometry(2.45,20,10,0,Math.PI*2,0,Math.PI/2),fabric);
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4,geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a)*2.36,0,Math.sin(a)*2.36),new THREE.Vector3(Math.cos(a)*.55,-4.2,Math.sin(a)*.4)]);assets.add(geo);
    canopy.add(new THREE.Line(geo,ropeMat));
  }
  box(plane,dark,0,0,0,1.1,.75,5.4);
  box(plane,metal,0,0,.15,9,.17,1.25);
  box(plane,metal,0,.3,2.1,3.2,.15,.8);
  box(plane,dark,0,.9,2.2,.15,1.8,.9);
  for(const x of [-2.4,2.4])box(plane,dark,x,-.15,-.15,.65,.6,1.9);
  box(plane,glow,-4.5,0,.12,.1,.1,.15);box(plane,glow,4.5,0,.12,.1,.1,.15);
  plane.position.set(-35,34,3);plane.rotation.y=-Math.PI/2;
  scene.add(mesh,plane);
  let age=0,landAge=0,disposed=false;
  function update(dt) {
    if(disposed)return mesh.userData.landed;
    dt=Math.max(0,Number(dt)||0);age+=dt;mesh.userData.age=age;
    plane.position.x=-35+age*10;plane.visible=age<12;
    if(!mesh.userData.landed){
      mesh.position.y=Math.max(.6,mesh.position.y-4*dt);
      canopy.rotation.z=Math.sin(age*1.5)*.11;
      canopy.rotation.x=Math.cos(age*1.15)*.07;
      if(mesh.position.y<=.6){mesh.userData.landed=true;mesh.rotation.set(0,0,0);}
    }else{
      landAge+=dt;const fold=Math.max(.001,1-landAge/.8);canopy.scale.set(fold,fold,fold);canopy.visible=landAge<.8;
    }
    const pulse=1+Math.sin(age*3)*.12;beam.scale.x=beam.scale.z=pulse;ring.scale.setScalar(pulse);lamp.intensity=4+Math.sin(age*3)*1.2;
    return mesh.userData.landed;
  }
  function dispose(){if(disposed)return;disposed=true;scene.remove(mesh,plane);assets.forEach(asset=>asset.dispose());lamp.dispose?.();}
  return {mesh,canopy,plane,update,dispose};
}
