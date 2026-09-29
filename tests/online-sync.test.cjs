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
test('200–1000 ms RTT and ordered delivery bursts cannot rewind the prediction clock or snap the displayed boat',()=>{
 for(const rtt of [200,400,600,1000]){
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
 sync.advance(10000,{w:true});assert(engine.time<=1.3+1.5);assert(Number.isFinite(sync.snapshot().boats[0].x));
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

for(const stall of [.35,1.1])test('remote interpolation stays within history through '+stall+' second stalls',()=>{
 const sync=Sync.create(linearEngine(),0);sync.setLatency(1000);
 const packets=[],states=[];let delivery=0,previous=null,maxJump=0,stopped=0,outside=0,samples=0;
 for(let tick=0;tick<3600;tick++){
  const now=tick*DT;
  if(tick%6===0){delivery=Math.max(delivery,now+.5+(tick%180<20?stall:0));packets.push({at:delivery,state:state(now)});}
  while(packets.length&&packets[0].at<=now){const p=packets.shift();states.push(p.state);while(states.length>2&&states[1].time<p.state.time-2)states.shift();sync.receive(p.state,now*1000,'racing');}
  sync.advance(now*1000,{w:true});if(!states.length)continue;
  const target=sync.remoteTime;let a=states[0],b=states.at(-1);
  for(let i=1;i<states.length;i++)if(states[i].time>=target){a=states[i-1];b=states[i];break;}
  const f=b.time===a.time?1:Math.max(0,Math.min(1,(target-a.time)/(b.time-a.time)));
  const x=(a.time+(b.time-a.time)*f)*100;
  if(tick>300){samples++;if(target<states[0].time-1e-6)outside++;if(previous!==null){maxJump=Math.max(maxJump,x-previous);if(Math.abs(x-previous)<1e-6)stopped++;assert(x>=previous-1e-6);}}
  previous=x;
 }
 assert.equal(outside,0,'display clock fell outside snapshot history');
 assert(maxJump<2.1,'interpolation teleported: '+maxJump+' m/frame');
 assert(stopped/samples<.05,'remote boats froze for '+stopped+'/'+samples+' frames');
 console.log('Remote jitter replay:',{maxJump,stopped,samples,outside});
});
