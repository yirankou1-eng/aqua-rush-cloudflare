'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Core=require('../race-core.js'),Sync=require('../online-sync.js');
function isolate(race){race.boats.forEach((b,i)=>{b.bot=false;if(i)b.finished=true;});return race.boats[0];}
test('all maps: every ramp produces landing physics and replayable feedback; boosts emit feedback',()=>{
 for(const map of ['classic','neon-city','playground']){
  for(let i=0;i<4;i++){
   const race=Core.create(map),b=isolate(race),r=race.ramps[i];
   Object.assign(b,{x:r.x-r.tan.x*23,z:r.z-r.tan.z*23,prog:r.t-.005,heading:Math.atan2(r.tan.x,r.tan.z),v:50});
   let landed=false,sunk=false,shook=false;
   for(let n=0;n<360;n++){race.step({0:{w:true}});landed||=!!b.feedback?.landing;sunk||=(b.waterEntry?.offset||0)<-1;shook||=(b.shake||0)>.1;}
   assert(landed&&sunk&&shook,map+' ramp '+i+' needs splash, immersion and shake');
   assert(b.feedback.landing.impact>4);assert(b.jumpCount>0);
  }
  const race=Core.create(map),b=isolate(race),boost=race.boosts[0];Object.assign(b,{x:boost.x,z:boost.z,prog:boost.t,heading:Math.atan2(boost.tan.x,boost.tan.z),v:20});race.step();
  assert.equal(b.feedback.message.text,'BOOST!');assert(b.v>40);
 }
});
test('all Playground floats transfer momentum, slow the boat, shake locally, and coast with drag',()=>{
 for(let i=0;i<18;i++){
  const race=Core.create('playground'),b=isolate(race),r=race.rings[i],dir=race.tangentAt(r.progress);
  Object.assign(b,{x:r.x-dir.x*16.1,z:r.z-dir.z*16.1,prog:r.progress,heading:Math.atan2(dir.x,dir.z),v:50,y:r.y-.3});
  let shook=false,minV=50;
  for(let n=0;n<5;n++){race.step();shook||=b.shake>0;minV=Math.min(minV,b.v);}
  const speed=Math.hypot(r.vx,r.vz),x=r.x,z=r.z;
  assert(speed>1&&minV<49&&shook,'float '+i+' must apply impulse and shake');
  b.finished=true;for(let n=0;n<30;n++)race.step();
  assert(Math.hypot(r.vx,r.vz)<speed);assert(Math.hypot(r.x-x,r.z-z)>0.1);
 }
});
test('feedback survives serialization and fires only once across prediction and authoritative replay',()=>{
 const f=Sync.createFeedback(),b={id:0,feedback:{landing:{count:1,time:1,impact:20}}};
 assert.equal(f.take(b,1).length,1);assert.equal(f.take(JSON.parse(JSON.stringify(b)),1.1).length,0);
 assert.equal(f.take({id:0,feedback:{}},1.2).length,0);assert.equal(f.take(b,1.3).length,0);
 b.feedback.landing.count=2;assert.equal(f.take(b,1.4).length,1);
 f.reset();assert.equal(f.take(b,20).length,0,'stale effects do not replay after a long reconnect');
});
test('predicted rings keep inertia between packets and remain continuous through correction',()=>{
 const server=Core.create('playground'),client=Core.create('playground');isolate(server);isolate(client);server.rings[0].vx=20;
 const sync=Sync.create(client,0);sync.setLatency(200);sync.receive(server.snapshot(),0,'racing');
 const initial=sync.snapshot().rings[0].x;sync.advance(50,{});assert(sync.snapshot().rings[0].x>initial);
 const before=sync.snapshot().rings[0];const packet=server.snapshot();packet.rings[0].x-=3;sync.receive(packet,60,'racing');
 const after=sync.snapshot().rings[0];assert(Math.abs(after.x-before.x)<1e-8);assert(Math.abs(after.z-before.z)<1e-8);
});
