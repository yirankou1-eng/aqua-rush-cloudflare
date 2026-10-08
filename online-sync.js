/* A monotonic prediction clock; packet counts are not elapsed simulation time. */
(function(root){
'use strict';
const DT=1/60,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
function create(engine,slot){
  let latest=null,receivedAt=0,clock=0,lastFrame=null,rtt=.1,racing=false,initialized=false;
  let ringCorrection=[],history=[],remoteInputs={},offset=[0,0,0],turn=[0,0,0],remoteTime=0,bufferDelay=.15,lastRacePacket=null;
  const pose=()=>{const b=engine.boats[slot];return {position:b.mesh.position.toArray(),rotation:[b.mesh.rotation.x,b.mesh.rotation.y,b.mesh.rotation.z]};};
  function inputsAt(time){let own=remoteInputs[slot]||{};for(const item of history){if(item.time>time+DT*.1)break;own=item.keys;}return {...remoteInputs,[slot]:own};}
  function simulate(){let steps=0;while(engine.time+DT<=clock+1e-6&&steps++<100)engine.step(inputsAt(engine.time));}
  function setLatency(ms){if(Number.isFinite(ms)&&ms>=0)rtt=clamp(ms/1000,0,1.2);}
  function receive(state,now,phase,inputs={}){
    const before=initialized?pose():null,beforeRings=initialized?(engine.rings||[]).map(r=>({x:r.x,y:r.y,z:r.z})):null,wasRacing=racing;
    if(phase==='racing'&&lastRacePacket!==null){const gap=Math.max(0,(now-lastRacePacket)/1000);bufferDelay=clamp(Math.max(bufferDelay*.995,gap*1.2),.15,1.25);}
    if(phase==='racing')lastRacePacket=now;
    latest=state;receivedAt=now;remoteInputs=inputs;racing=phase==='racing';
    if(!initialized||!racing||!wasRacing){clock=state.time+(racing?rtt:0);lastFrame=now;history=[];}
    // A long suspension must not replay seconds of stale input or allocate unbounded work.
    clock=clamp(clock,state.time,state.time+1.5);
    engine.restore(state);if(racing)simulate();
    if(before&&wasRacing){const after=pose();for(let k=0;k<3;k++){offset[k]+=before.position[k]-after.position[k];turn[k]=angle(turn[k]+before.rotation[k]-after.rotation[k]);}
      if(Math.hypot(...offset)>60){offset=[0,0,0];turn=[0,0,0];}
    }
    if(beforeRings&&wasRacing){ringCorrection=(engine.rings||[]).map((r,i)=>{const old=beforeRings[i];if(!old)return {x:0,y:0,z:0};const c=ringCorrection[i]||{x:0,y:0,z:0};const next={x:c.x+old.x-r.x,y:c.y+old.y-r.y,z:c.z+old.z-r.z};return Math.hypot(next.x,next.y,next.z)>60?{x:0,y:0,z:0}:next;});}else ringCorrection=[];
    const old=history.filter(h=>h.time<=state.time);history=[...old.slice(-1),...history.filter(h=>h.time>state.time)];
    if(!initialized)remoteTime=state.time;
    initialized=true;
  }
  function advance(now,keys,onStep=()=>{}){
    if(!initialized)return;
    const elapsed=lastFrame===null?0:Math.max(0,(now-lastFrame)/1000);lastFrame=now;
    const dt=Math.min(elapsed,.25),age=Math.max(0,(now-receivedAt)/1000);
    if(racing&&age<1.5){
      const wanted=latest.time+Math.min(age,.25)+rtt;
      // Correct clock drift gradually. Snapshot arrival jitter cannot rewind time.
      clock=Math.min(latest.time+1.5,clock+dt*clamp(1+(wanted-clock)*2,.9,1.1));
      if(elapsed>.5){history=[];clock=Math.min(wanted,latest.time+1.5);}
      history.push({time:engine.time,keys:{...keys}});
      let steps=0;while(engine.time+DT<=clock+1e-6&&steps++<100){onStep(keys);engine.step({...remoteInputs,[slot]:keys});}
    }
    const wantedRemote=Math.max(0,latest.time-bufferDelay+Math.min(age,bufferDelay));
    // Keep a real jitter buffer and recover drift without jumping to its oldest sample.
    const remoteRate=clamp(1+(wantedRemote-remoteTime)*2,.75,1.15);
    if(racing)remoteTime=Math.min(latest.time,remoteTime+dt*remoteRate);
    const decay=Math.exp(-dt/0.18);offset=offset.map(v=>v*decay);turn=turn.map(v=>v*decay);ringCorrection=ringCorrection.map(c=>({x:c.x*decay,y:c.y*decay,z:c.z*decay}));
  }
  function snapshot(){const result=engine.snapshot(),b=result.boats[slot];for(let k=0;k<3;k++){b.position[k]+=offset[k];b.rotation[k]+=turn[k];}
    // The camera, wakes and hull follow the same corrected pose.
    b.x=b.position[0];b.z=b.position[2];b.y+=offset[1];b.heading+=turn[1];for(const [i,r] of (result.rings||[]).entries()){const c=ringCorrection[i];if(c){r.x+=c.x;r.y+=c.y;r.z+=c.z;}}return result;
  }
  return {receive,advance,snapshot,setLatency,get remoteTime(){return remoteTime;},get time(){return clock;}};
}
// Only boat hulls use display separation. Floats keep their predicted physical motion.
// Retained boat offsets relax rather than disappearing on the next frame.
function createContactView(physics){
  let boatOffsets=[];
  function reset(){boatOffsets=[];}
  function solve(boats,rings,dt){
    const decay=Math.exp(-Math.min(Math.max(dt,0),.25)/.22);
    const baseBoats=boats.map(b=>({...b}));
    boats=boats.map((b,i)=>({...b,x:b.x+(i?boatOffsets[i]?.x||0:0)*decay,z:b.z+(i?boatOffsets[i]?.z||0:0)*decay}));
    rings=rings.map(r=>({...r}));
    for(let pass=0;pass<6;pass++){
      for(let i=0;i<boats.length;i++)for(let j=i+1;j<boats.length;j++){
        const a=boats[i],b=boats[j],hit=physics.boatContact(a,b);if(!hit)continue;
        const wa=i===0?0:1,shift=(hit.depth+.03)/(wa+1);
        a.x-=hit.nx*shift*wa;a.z-=hit.nz*shift*wa;b.x+=hit.nx*shift;b.z+=hit.nz*shift;
      }
    }
    boatOffsets=boats.map((b,i)=>({x:b.x-baseBoats[i].x,z:b.z-baseBoats[i].z}));
    return {boats,rings};
  }
  return {solve,reset};
}

// Counters are per boat and effect type, survive snapshots, and never rewind on replay.
function createFeedback(){
  const seen=new Map();
  return {reset(){seen.clear();},take(boat,time){const events=[];for(const [type,event] of Object.entries(boat.feedback||{})){
    const key=boat.id+':'+type,previous=seen.get(key)||0;if(event.count<=previous)continue;
    seen.set(key,event.count);if(time-event.time<=2.5)events.push({type,...event});
  }return events;}};
}
const api={create,createContactView,createFeedback};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OnlineSync=api;
})(typeof window!=='undefined'?window:globalThis);
