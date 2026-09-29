'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Sync=require('../online-sync.js');
const DT=1/60;
// Constant-speed motion makes any reversal a synchronization fault, not a collision.
function linearEngine(){
 let time=0,x=0;
 const boat={mesh:{position:{toArray:()=>[x,0,0]},rotation:{x:0,y:Math.PI/2,z:0}}};
 return {boats:[boat],get time(){return time;},step(){time+=DT;x+=100*DT;},restore(s){time=s.time;x=s.boats[0].x;},snapshot(){return state(time);}};
}
function state(time){return {time,boats:[{x:time*100,y:0,z:0,heading:Math.PI/2,position:[time*100,0,0],rotation:[0,Math.PI/2,0]}]};}
test('200–600 ms RTT and ordered delivery bursts cannot rewind the prediction clock or snap the displayed boat',()=>{
 for(const rtt of [200,400,600]){
  const engine=linearEngine(),sync=Sync.create(engine,0);sync.setLatency(rtt);
  let previousTime=0,previousX=null,lastDelivery=0,index=0;const packets=[];
  for(let tick=0;tick<900;tick++){
   const now=tick*DT,serverTime=now;
   if(tick%3===0){const jitter=(Math.floor(tick/30)%3===1)?.13:0;lastDelivery=Math.max(lastDelivery,now+rtt/2000+jitter);packets.push({at:lastDelivery,state:state(serverTime)});}
   while(packets.length&&packets[0].at<=now){const packet=packets.shift();const before=sync.snapshot().boats[0].position[0];sync.receive(packet.state,now*1000,'racing',{0:{w:true}});if(index++)assert(Math.abs(sync.snapshot().boats[0].position[0]-before)<1e-7,'corrections must preserve the visible position');}
   sync.advance(now*1000,{w:true});
   if(!index)continue;
   const x=sync.snapshot().boats[0].position[0];
   assert(sync.time>=previousTime-1e-8,'prediction clock rewound');
   if(previousX!==null){assert(x>=previousX-.01,'constant-speed boat moved backwards');assert(x-previousX<3.5,'visible speed spiked');}
   previousX=x;previousTime=sync.time;
  }
 }
});
test('low rendering frame rate advances by actual elapsed time instead of clamped render dt',()=>{
 const engine=linearEngine(),sync=Sync.create(engine,0);sync.setLatency(200);sync.receive(state(0),0,'racing');
 for(let frame=1;frame<=30;frame++){const now=frame*100;sync.receive(state(now/1000-.1),now,'racing');sync.advance(now,{w:true});}
 assert(engine.time>3&&engine.time<3.3);
});
test('authoritative corrections also move the camera pose smoothly; long gaps bound replay work',()=>{
 const engine=linearEngine(),sync=Sync.create(engine,0);sync.setLatency(200);sync.receive(state(1),0,'racing');sync.advance(16.7,{w:true});
 const before=sync.snapshot().boats[0];sync.receive(state(1.3),20,'racing');const after=sync.snapshot().boats[0];assert.equal(after.x,after.position[0]);assert(Math.abs(after.x-before.x)<1e-7);
 sync.advance(10000,{w:true});assert(engine.time<=1.3+.75);assert(Number.isFinite(sync.snapshot().boats[0].x));
});

test('real race snapshots with 300 ms latency keep visible correction continuous',()=>{
 const Core=require('../race-core.js'),server=Core.create('classic'),client=Core.create('classic'),sync=Sync.create(client,0);
 server.boats[0].bot=false;sync.setLatency(300);let received=0;const queue=[];
 for(let tick=0;tick<300;tick++){
  const now=tick*DT,keys={w:true};server.step({0:keys});
  if(tick%3===0)queue.push({at:now+.15+(tick%60<15?.1:0),state:server.snapshot()});
  while(queue.length&&queue[0].at<=now){const packet=queue.shift(),before=sync.snapshot().boats[0];sync.receive(packet.state,now*1000,'racing',{0:keys});const after=sync.snapshot().boats[0];if(received++)assert(Math.hypot(...after.position.map((v,i)=>v-before.position[i]))<1e-6);}
  sync.advance(now*1000,keys);
 }
 const b=sync.snapshot().boats[0];assert(received>50);assert(b.v>0);assert.equal(b.x,b.position[0]);assert.equal(b.z,b.position[2]);
});
