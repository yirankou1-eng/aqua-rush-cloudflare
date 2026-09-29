'use strict';
// Shared room protocol and authoritative clock for Node and Cloudflare.
const RaceCore=require('./race-core.js');
const Maps=require('./maps.js');
function createRoomService(options={}){
  const rooms=new Map(),clients=new Set();
  const send=(ws,data)=>{if(ws&&ws.readyState===1){if(ws.bufferedAmount>512*1024){ws.terminate();return;}ws.send(JSON.stringify(data));}};
  const error=(ws,message)=>send(ws,{type:'error',message});
  function view(room){return {type:'room',code:room.code,map:room.map,phase:room.phase,host:room.host,
    seats:Array.from({length:4},(_,slot)=>{const m=room.members.find(m=>m.slot===slot);return m?{slot,name:m.name,ready:m.ready,connected:!!m.ws,bot:!m.ws,human:true}: {slot,name:'AI '+(slot+1),ready:true,connected:false,bot:true};})};}
  const broadcastRoom=room=>room.members.forEach(m=>send(m.ws,view(room)));
  function detach(ws){
    const room=ws.room,m=ws.member;ws.room=ws.member=null;if(!room||!m||m.ws!==ws)return;
    m.ws=null;m.input={};
    if(room.phase==='lobby')room.members=room.members.filter(other=>other!==m);
    else if(room.engine)room.engine.boats[m.slot].bot=true;
    const connected=room.members.filter(m=>m.ws);
    if(!connected.length){rooms.delete(room.code);return;}
    if(room.host===m.slot)room.host=connected[0].slot;
    broadcastRoom(room);
  }
  function code(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let value;do{value=Array.from(crypto.getRandomValues(new Uint8Array(6)),v=>alphabet[v%alphabet.length]).join('');}while(rooms.has(value));return value;}
  function snapshot(room){const state=room.engine.snapshot();room.members.forEach(m=>send(m.ws,{type:'state',phase:room.phase,remaining:Math.max(0,room.countdown||0),ack:m.seq,state}));}
  function join(ws,room,member){ws.room=room;ws.member=member;member.ws=ws;member.input={};member.lastInput=Date.now();send(ws,{type:'joined',code:room.code,slot:member.slot,token:member.token,map:room.map});broadcastRoom(room);if(room.engine)snapshot(room);}
  function attach(ws){
    startTimers();
    clients.add(ws);ws.lastSeen=Date.now();ws.budget=0;ws.window=Date.now();

    ws.on('error',()=>{});
    ws.on('close',()=>{clients.delete(ws);detach(ws);if(!clients.size)stopTimers();});
    ws.on('message',raw=>{
      ws.lastSeen=Date.now();
      if(typeof raw!=='string')raw=raw.toString();
      if(raw.length>4096)return ws.close(1009,'Message too large');
      if(Date.now()-ws.window>1000){ws.window=Date.now();ws.budget=0;}
      if(++ws.budget>150)return ws.close(1008,'Too many requests');
      let msg;try{msg=JSON.parse(raw);}catch{return error(ws,'Invalid message format.');}
      if(!msg||typeof msg!=='object')return;
      const room=ws.room,m=ws.member;
      if(msg.type==='ping')return send(ws,{type:'pong',time:msg.time});
      if(msg.type==='leave'){detach(ws);return send(ws,{type:'left'});}
      if(msg.type==='create'||msg.type==='join'){
        if(room)return error(ws,'Leave your current room first.');
        const name=typeof msg.name==='string'?msg.name.trim().slice(0,16):'';
        if(!name)return error(ws,'Enter your nickname first.');
        let target;
        if(msg.type==='create'){
          if(ws.canCreate===false)return error(ws,'Room not found or closed. Check the room code.');
          if(rooms.size>=(options.maxRooms||50))return error(ws,'The server is at capacity. Please try again later.');
          if(!Maps.maps.some(m=>m.id===msg.map))return error(ws,'Map not found.');
          target={code:options.code||code(),map:msg.map,members:[],host:0,phase:'lobby',created:Date.now(),engine:null};rooms.set(target.code,target);
        }else{
          target=rooms.get(String(msg.code||'').trim().toUpperCase());
          if(!target)return error(ws,'Room not found or closed. Check the room code.');
          const old=target.members.find(m=>typeof msg.token==='string'&&m.token===msg.token);
          if(old){if(old.ws)return error(ws,'This seat is already connected. Join from another window as a new player.');if(target.engine)target.engine.boats[old.slot].bot=false;return join(ws,target,old);}
          if(target.phase!=='lobby')return error(ws,'The race has already started. New players cannot join mid-race.');
          if(target.members.length>=4)return error(ws,'This room already has four players.');
        }
        const slot=[0,1,2,3].find(slot=>!target.members.some(m=>m.slot===slot));
        const member={slot,name,token:Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join(''),ready:false,seq:0,input:{},ws:null};target.members.push(member);return join(ws,target,member);
      }
      if(!room||!m)return error(ws,'Join a room first.');
      if(msg.type==='ready'&&room.phase==='lobby'){m.ready=msg.ready===true;return broadcastRoom(room);}
      if(msg.type==='start'){
        if(m.slot!==room.host)return error(ws,'Only the host can start the race.');
        if(room.phase!=='lobby')return;
        if(room.members.length<2||room.members.some(m=>!m.ws||!m.ready))return error(ws,'At least two players must join, and everyone must be ready.');
        room.engine=RaceCore.create(room.map);for(const member of room.members){room.engine.boats[member.slot].bot=false;member.seq=0;member.input={};}
        room.phase='countdown';room.countdown=3.5;broadcastRoom(room);return snapshot(room);
      }
      if(msg.type==='input'&&(room.phase==='racing'||room.phase==='countdown')){
        if(!Number.isSafeInteger(msg.seq)||msg.seq<=m.seq||msg.seq>m.seq+10000)return;
        m.seq=msg.seq;m.input={w:msg.w===true,s:msg.s===true,a:msg.a===true,d:msg.d===true};m.lastInput=Date.now();return;
      }
    });
  }
  let ticks=0,last=performance.now(),accumulator=0;
  let timer=null,heartbeat=null;
  function stopTimers(){clearInterval(timer);clearInterval(heartbeat);timer=heartbeat=null;}
  function startTimers(){
    if(timer)return;last=performance.now();accumulator=0;
    timer=setInterval(()=>{
    const now=performance.now();accumulator+=Math.min(.25,(now-last)/1000);last=now;
    while(accumulator>=RaceCore.DT){accumulator-=RaceCore.DT;ticks++;
      for(const room of rooms.values()){
        if(Date.now()-room.created>2*60*60*1000){room.members.forEach(m=>{send(m.ws,{type:'closed',message:'This room has expired. Please create a new one.'});if(m.ws){m.ws.room=m.ws.member=null;m.ws.close(1000,'Room expired');}});rooms.delete(room.code);continue;}
        if(!room.engine)continue;
        if(room.phase==='countdown'){room.countdown-=RaceCore.DT;if(room.countdown<=0){room.phase='racing';broadcastRoom(room);}}
        else if(room.phase==='racing'){
          const inputs={};for(const m of room.members)inputs[m.slot]=Date.now()-m.lastInput<500?m.input:{};
          room.engine.step(inputs);
          if(room.engine.boats.every(b=>b.finished)||room.engine.time>=15*60){room.phase='finished';broadcastRoom(room);}
        }
        if(ticks%3===0)snapshot(room);
      }
    }
  },8);
  heartbeat=setInterval(()=>{for(const ws of clients){if(Date.now()-ws.lastSeen>45000)ws.terminate();}},10000);
  }
  function close(){stopTimers();for(const ws of clients)ws.terminate();rooms.clear();}
  return {attach,close,rooms,clients};
}
module.exports={createRoomService};

