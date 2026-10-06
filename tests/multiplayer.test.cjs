'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createServer}=require('../server.cjs');
const Core=require('../race-core.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function client(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port+'/socket'),messages=[];
 ws.on('message',raw=>messages.push(JSON.parse(raw)));
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 return {ws,messages,send:value=>ws.send(JSON.stringify(value)),async wait(predicate,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await delay(10);}throw Error('Timed out waiting for message');}};
}
test('three maps: four bots finish, snapshot replay is deterministic, human input and jumps work',()=>{
 for(const map of ['classic','neon-city','playground']){
  const race=Core.create(map);race.boats[0].bot=false;
  const x=race.boats[0].x,z=race.boats[0].z;
  for(let i=0;i<120;i++)race.step({0:{w:true}});
  assert(Math.hypot(race.boats[0].x-x,race.boats[0].z-z)>20);
  const saved=race.snapshot(),immutable=JSON.stringify(saved),copy=Core.create(map);copy.restore(saved);
  for(let i=0;i<40;i++){race.step({0:{w:true,a:true}});copy.step({0:{w:true,a:true}});}
  assert.deepEqual(copy.snapshot(),race.snapshot());assert.equal(JSON.stringify(saved),immutable,"prediction must not mutate buffered server snapshots");
  const botRace=Core.create(map);
  for(let i=0;i<240*60&&!botRace.boats.every(b=>b.finished);i++)botRace.step();
  assert(botRace.boats.every(b=>b.finished),map+' bots must finish');
  assert.deepEqual(botRace.boats.map(b=>b.finishRank).sort(),[1,2,3,4]);
  const jumper=Core.create(map),b=jumper.boats[0],r=jumper.ramps[0];
  Object.assign(b,{bot:false,x:r.x-r.tan.x*23,z:r.z-r.tan.z*23,prog:r.t-23/MapLength(map),heading:Math.atan2(r.tan.x,r.tan.z),v:50});
  for(let i=0;i<360;i++)jumper.step({0:{w:true}});
  assert(b.jumpCount>0,map+' human must jump and land');
 }
});
function MapLength(id){return require('../maps.js').curve(require('../three.min.js'),id).getLength();}
test('rooms: short codes, capacity, readiness, shared simulation, takeover, reconnect and private files',{timeout:20000},async t=>{
 const app=createServer(),cs=[];t.after(async()=>{cs.forEach(c=>c.ws.terminate());await app.close();});const addr=await app.listen(0,'127.0.0.1');
 for(let i=0;i<5;i++)cs.push(await client(addr.port));
 const [a,b,c,d,e]=cs;
 a.send({type:'create',name:'Captain',map:'classic'});const joined=await a.wait(m=>m.type==='joined');assert.match(joined.code,/^[A-Z2-9]{6}$/);
 a.send({type:'start'});assert.match((await a.wait(m=>m.type==='error')).message,/At least two/);
 b.send({type:'join',code:'ZZZZZZ',name:'Wrong'});assert.match((await b.wait(m=>m.type==='error')).message,/not found/);
 for(const [i,client] of [b,c,d].entries()){client.send({type:'join',code:joined.code,name:'Player '+i});const j=await client.wait(m=>m.type==='joined');client.seat=j;}
 e.send({type:'join',code:joined.code,name:'Fifth'});assert.match((await e.wait(m=>m.type==='error')).message,/four players/);
 b.send({type:'start'});assert.match((await b.wait(m=>m.type==='error')).message,/host/);
 for(const client of [a,b,c,d])client.send({type:'ready',ready:true});
 await a.wait(m=>m.type==='room'&&m.seats.every(s=>s.ready));
 // Leave one seat empty to verify bot fill in the actual race.
 d.send({type:'leave'});await d.wait(m=>m.type==='left');
 a.send({type:'start'});await a.wait(m=>m.type==='state'&&m.phase==='racing');
 const room=app.rooms.get(joined.code);assert.equal(room.engine.boats.filter(b=>b.bot).length,1);
 const initial=room.engine.boats[0].z;
 a.send({type:'input',seq:1,w:true,steer:.35});await delay(250);
 assert(room.engine.boats[0].v>0);assert.notEqual(room.engine.boats[0].z,initial);
 assert.equal(room.members[0].input.steer,.35);
 const snapA=await a.wait(m=>m.type==='state'&&m.ack===1),snapB=await b.wait(m=>m.type==='state'&&m.state.time===snapA.state.time);
 assert.deepEqual(snapA.state,snapB.state);
 e.send({type:'join',code:joined.code,name:'Late'});assert.match((await e.wait(m=>m.type==='error')).message,/already started/);
 a.ws.close();await b.wait(m=>m.type==='room'&&m.host===1);assert(room.engine.boats[0].bot);
 e.send({type:'join',code:joined.code,token:joined.token,name:'Captain'});const restored=await e.wait(m=>m.type==='joined');assert.equal(restored.slot,0);assert(!room.engine.boats[0].bot);
 // Client-provided positions cannot change authoritative state.
 e.send({type:'input',seq:2,w:false,x:1e20,lap:100,finished:true});await delay(60);assert(room.engine.boats[0].x<1e6);assert.equal(room.engine.boats[0].finished,false);
 for(const name of ['server.cjs','backups/anything.zip','.git/config','package.json','node_modules/ws/package.json'])assert.equal((await fetch('http://127.0.0.1:'+addr.port+'/'+name)).status,404);
 assert.equal((await fetch('http://127.0.0.1:'+addr.port+'/')).status,200);
});
