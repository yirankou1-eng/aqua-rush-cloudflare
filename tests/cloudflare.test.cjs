'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {WebSocket}=require('ws');
const path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve(__dirname,'..'),port=8788,base='http://127.0.0.1:'+port;
test('Cloudflare runtime: isolated rooms, four seats, server simulation, reconnect, cleanup and asset boundary',{timeout:90000},async t=>{
 let logs='';const clients=[];
 const processHandle=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--ip','127.0.0.1','--port',String(port),'--show-interactive-dev-session=false'],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 processHandle.stdout.on('data',v=>logs+=v);processHandle.stderr.on('data',v=>logs+=v);
 t.after(async()=>{for(const c of clients)c.ws.terminate();processHandle.kill('SIGTERM');await Promise.race([new Promise(r=>processHandle.once('exit',r)),delay(3000)]);if(processHandle.exitCode===null)processHandle.kill('SIGKILL');});
 let live=false;for(let i=0;i<300;i++){try{const r=await fetch(base+'/health');if(r.ok){live=true;break;}}catch{}if(processHandle.exitCode!==null)break;await delay(100);}
 assert(live,'Worker failed to start: '+logs);
 async function connect(query){
  const ws=new WebSocket(base.replace('http','ws')+'/socket?'+query),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw)));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const c={ws,messages,send:msg=>ws.send(JSON.stringify(msg)),async wait(fn,timeout=6000){const end=Date.now()+timeout;while(Date.now()<end){const i=messages.findIndex(fn);if(i>=0)return messages.splice(i,1)[0];await delay(10);}throw Error('Message timeout. '+logs);}};
  clients.push(c);return c;
 }
 const a=await connect('create=1');a.send({type:'create',name:'Host',map:'classic'});const seat=await a.wait(m=>m.type==='joined');assert.match(seat.code,/^[A-HJ-NP-Z2-9]{6}$/);
 a.send({type:'start'});assert.match((await a.wait(m=>m.type==='error')).message,/At least two/);
 const roster=[a];for(let i=1;i<4;i++){const c=await connect('room='+seat.code);c.send({type:'join',name:'Player '+i,code:seat.code});await c.wait(m=>m.type==='joined');roster.push(c);}
 const fifth=await connect('room='+seat.code);fifth.send({type:'join',name:'Fifth',code:seat.code});assert.match((await fifth.wait(m=>m.type==='error')).message,/four players/);fifth.ws.close();
 // Another room must not receive this room's messages or accept its code.
 const other=await connect('create=1');other.send({type:'create',name:'Other',map:'playground'});const otherSeat=await other.wait(m=>m.type==='joined');assert.notEqual(otherSeat.code,seat.code);
 const wrong=await connect('room='+otherSeat.code);wrong.send({type:'join',name:'Wrong route',code:seat.code});assert.match((await wrong.wait(m=>m.type==='error')).message,/not found/);wrong.ws.close();
 const [host,b,c,d]=roster;
 b.send({type:'start'});assert.match((await b.wait(m=>m.type==='error')).message,/host/);
 d.send({type:'leave'});await d.wait(m=>m.type==='left');d.ws.close();
 for(const p of [host,b,c])p.send({type:'ready',ready:true});await host.wait(m=>m.type==='room'&&m.seats.every(s=>s.ready));host.send({type:'start'});
 const first=await host.wait(m=>m.type==='state'&&m.phase==='racing');assert.equal(first.state.boats.filter(b=>b.bot).length,1);
 host.send({type:'input',seq:1,w:true,x:1e20,finished:true});const update=await host.wait(m=>m.type==='state'&&m.ack===1&&m.state.time>first.state.time+.1);assert(update.state.boats[0].v>0);assert(!update.state.boats[0].finished);assert(Math.abs(update.state.boats[0].x)<1e6);
 const mirror=await b.wait(m=>m.type==='state'&&m.state.time===update.state.time);assert.deepEqual(mirror.state,update.state);
 // Server keeps advancing after the host leaves; AI takes their seat.
 host.ws.close();await b.wait(m=>m.type==='room'&&m.host===1);const takeover=await b.wait(m=>m.type==='state'&&m.state.boats[0].bot&&m.state.time>update.state.time+.1);assert(takeover.state.time>update.state.time);
 const reconnect=await connect('room='+seat.code);reconnect.send({type:'join',code:seat.code,token:seat.token,name:'Host'});assert.equal((await reconnect.wait(m=>m.type==='joined')).slot,0);await reconnect.wait(m=>m.type==='state'&&!m.state.boats[0].bot);
 for(const p of [b,c,reconnect]){p.send({type:'leave'});await p.wait(m=>m.type==='left');p.ws.close();}
 const expired=await connect('room='+seat.code);expired.send({type:'join',name:'Too late',code:seat.code});assert.match((await expired.wait(m=>m.type==='error')).message,/not found/);
 for(const file of ['server.cjs','room-service.cjs','backups/test.zip','package.json','wrangler.jsonc','.git/config'])assert.equal((await fetch(base+'/'+file)).status,404,file);
 assert.equal((await fetch(base+'/')).status,200);assert.match(await (await fetch(base+'/online.js')).text(),/MULTIPLAYER/);
 assert.equal((await fetch(base+'/socket')).status,426);
 await new Promise((resolve,reject)=>{const blocked=new WebSocket(base.replace('http','ws')+'/socket?room=ABC234',{origin:'https://unrelated.example'});blocked.on('unexpected-response',(_,res)=>{try{assert.equal(res.statusCode,403);res.resume();blocked.terminate();resolve();}catch(e){reject(e);}});blocked.on('error',()=>{});blocked.on('open',()=>{blocked.terminate();reject(Error('Unexpected cross-origin connection'));});});
 console.log('Cloudflare runtime verified: 4 seats, AI fill, independent room, synchronized race, host exit, reconnect, room cleanup and private files.');
});
