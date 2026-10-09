const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const THREE=require('../three.min.js'),Maps=require('../maps.js'),D=require('../dynamics.js');
THREE.WebGLRenderer=class{constructor(){this.domElement={};this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>4};this.info={render:{calls:0}};}setSize(){}setPixelRatio(){}getPixelRatio(){return 1;}setRenderTarget(){}render(){}};
THREE.PMREMGenerator=class{fromScene(){return {texture:new THREE.Texture()};}dispose(){}};
const elements=new Map(),element=()=>({style:{},dataset:{},children:[],setAttribute(){},appendChild(child){this.children.push(child);},classList:{add(){},remove(){}},addEventListener(type,fn){this[type]=fn;}});
const document={body:{appendChild(){}},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement(tag){return tag==='canvas'?{getContext:()=>({fillRect(){},strokeRect(){}})}:element();}};
let seed=93461;const math=Object.create(Math);math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
const ctx=vm.createContext({THREE,MapCatalog:Maps,CityScenery:require('../city.js'),BoatDynamics:D,ScreenSplash:require('../screen-splash.js'),document,window:{},innerWidth:1280,innerHeight:720,devicePixelRatio:1,addEventListener(){},requestAnimationFrame(){},setTimeout(){},location:{search:'?map=playground'},URLSearchParams,performance,console,Math:math});
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],ctx);
const test=code=>vm.runInContext(code,ctx);

assert.equal(test('giantDuck.radius*2/ (halfWidthAt(giantDuck.progress)*2)'),.5);
assert.equal(test(`(()=>{const d=giantDuck,a=curveAt(d.progress-.005),b=curveAt(d.progress+.005);return d.progress>.3&&halfWidthAt(d.progress)>75&&Math.abs((b.y-a.y)/(.01*curveLen))<.01;})()`),true,'wide, nearly flat mid-course site');
assert.equal(test(`(()=>{
 const d=giantDuck;started=true;player.lap=1;updateDuck(.2,1);const yaw=d.mesh.rotation.y;updateDuck(.2,2);
 if(d.mesh.rotation.y===yaw||d.open!==0||d.belt.visible)return false;
 player.lap=2;placeAt(player,d.progress-200/curveLen,0);player.prog=d.progress-200/curveLen;
 camera.position.set(player.x,curveAt(player.prog).y+10,player.z);camera.lookAt(player.x-d.tan.x*100,80,player.z-d.tan.z*100);updateDuck(.1,2);
 if(d.revealed)return false;
 camera.lookAt(d.p.x,d.mesh.position.y+d.radius*.65,d.p.z);updateDuck(.1,2);
 if(!d.revealed||d.open<=0||d.open>=1)return false;
 for(let i=0;i<150;i++)updateDuck(1/60,3+i/60);
 if(d.open!==1||!d.belt.visible)return false;
 player.x=d.toe.x;player.z=d.toe.z;player.y=waterH(player.x,player.z,5);player.air=true;updateDuck(.01,5);if(player.duckTransit)return false;
 player.air=false;player.v=44;updateDuck(.01,5);if(d.stage!=='ride'||!player.duckTransit)return false;
 const old=player.mesh;for(let i=0;i<46;i++)updateDuck(1/60,5);
 if(d.stage!=='inside'||player.mesh.visible)return false;
 for(let i=0;i<110;i++)updateDuck(1/60,6);
 if(d.stage!=='done'||!player.duckForm||player.duckTransit||player.mesh===old||player.lap!==2||player.prog<=d.progress)return false;
 const duck=player.mesh;for(let i=0;i<60;i++)updatePlayer(1/60,7);
 return player.mesh===duck&&player.duckForm&&player.v>0;
})()`),true,'lap and visibility gating, progressive opening, airborne exclusion, transport, permanent playable duck');
assert.equal(test(`(()=>{
 const d=giantDuck;player.finished=true;
 for(const side of [-1,1]){
  const a=ais[0];a.finished=false;a.t=d.progress-290/curveLen;a.lat=side*2;a.baseLat=a.lat;a.curV=60;a.duckSide=null;
  const p=curveAt(a.t),tan=tangentAt(a.t);a.px=p.x-tan.z*a.lat;a.pz=p.z+tan.x*a.lat;
  ais[1].finished=ais[2].finished=true;
  for(let i=0;i<900&&a.t<d.progress+.025;i++){
   updateAI(1/60,8+i/60);
   if(Math.hypot(a.px-d.p.x,a.pz-d.p.z)<d.radius+5)return false;
   if(a.duckTransit||a.duckForm)return false;
  }
  if(a.t<=d.progress)return false;
 }
 return true;
})()`),true,'AI steers around both sides without body contact or transformation');
console.log('PASS: giant duck dimensions, site, reveal, transport, permanent form and AI clearance.');

assert.equal(/[\u3400-\u9fff]/.test(html.match(/<div id="duckFilm"[\s\S]*?<\/div>/)[0]),false,'transformation screen is entirely English');
assert.equal(test(`(()=>{
 const d=giantDuck;d.mesh.updateMatrixWorld(true);d.belt.updateMatrixWorld(true);
 const left=d.belt.localToWorld(new THREE.Vector3(-8,0,d.deck.scale.z/2));
 const right=d.belt.localToWorld(new THREE.Vector3(8,0,d.deck.scale.z/2));
 const mouth=d.mesh.localToWorld(new THREE.Vector3(0,.57,.89));
 const toe=curveAt(d.progress-d.radius*2.3/curveLen);
 return Math.abs(left.y-right.y)<1e-8&&mouth.distanceTo(d.top)<1e-8&&Math.hypot(toe.x-d.toe.x,toe.z-d.toe.z)<1e-8;
})()`),true,'belt has level transverse edges, meets the mouth and ends on the course centerline');
console.log('PASS: English duck screen and conveyor alignment.');
assert.equal(test(`(()=>{
 const d=giantDuck,saved={...player};d.mesh.updateMatrixWorld(true);
 try{
  function contact(x,y,z){const p=d.mesh.localToWorld(new THREE.Vector3(x,y,z));Object.assign(player,{x:p.x,y:p.y-1.2,z:p.z,heading:d.mesh.rotation.y,duckTransit:false,duckForm:false,v:30});const before=new THREE.Vector2(player.x,player.z);collideDuck();return before.distanceTo(new THREE.Vector2(player.x,player.z));}
  // Empty space in front of the narrow waterline was inside the old radius.
  if(contact(0,.03,.88)>1e-8)return false;
  if(contact(.5,.03,-.09)<1)return false;
  // A higher body slice must project further sideways than the submerged base.
  const low=contact(.5,0,-.09),wide=contact(.5,.26,-.09);
  if(wide<=low+1)return false;
  if(contact(.5,1.8,-.09)>1e-8)return false;
  return true;
 }finally{Object.assign(player,saved);}
})()`),true,'collision follows the rendered hull-height slice, leaves empty space free and excludes above-body contact');
console.log('PASS: duck waterline collision.');
assert.equal(test(`(()=>{
 const b=player,saved={...b},p=curveAt(.42);b.duckForm=true;b.air=false;b.onRamp=null;b.waterEntry=null;b.v=0;b.heave=undefined;b.heaveV=0;b.pitchSm=b.pitchV=0;
 try{
  for(let i=0;i<180;i++){
   const now=i/60,surface=waterH(p.x,p.z,now);poseBoat(b,1/60,now,p.x,p.z,surface,0,0);
   b.mesh.updateMatrixWorld(true);
   const body=b.mesh.userData.body,belly=body.localToWorld(new THREE.Vector3(0,-1,0));
   if(belly.y>surface-.25)return false;
  }
  return true;
 }finally{Object.assign(b,saved);}
})()`),true,'duck belly stays immersed during normal floating over changing waves');

assert.equal(test(`(()=>{
 const duck=makeRubberDuck(),{upper,jaw}=duck.userData;
 duck.updateMatrixWorld(true);
 const a=upper.children[0].userData.lip,b=jaw.children[0].userData.lip;
 if(a.length!==65||b.length!==65||'mouth' in duck.userData||'tongue' in duck.userData)return false;
 for(let i=0;i<a.length;i++){
  if(upper.localToWorld(a[i].clone()).distanceTo(jaw.localToWorld(b[i].clone()))>1e-7)return false;
 }
 // The front is an arc: its center projects further than the side corners.
 const front=Math.max(...a.map(v=>v.z)),side=a.reduce((best,v)=>v.x>best.x?v:best);
 if(front-side.z<.20)return false;
 upper.rotation.x=-.32;jaw.rotation.x=.50;duck.updateMatrixWorld(true);
 const tip=a.reduce((best,v)=>v.z>best.z?v:best);
 return upper.localToWorld(tip.clone()).y-jaw.localToWorld(tip.clone()).y>.30;
})()`),true,'closed lips match without a gap, the front stays round, and hinges separate on opening');
console.log('PASS: closed bill geometry and hinged opening.');
