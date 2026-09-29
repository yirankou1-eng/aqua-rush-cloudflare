'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {WebSocketServer,WebSocket}=require('ws');
const {createRoomService}=require('./room-service.cjs');
const ROOT=__dirname;
const PUBLIC=new Set(['index.html','three.min.js','dynamics.js','maps.js','city.js','screen-splash.js','race-core.js','online.js','online-sync.js','online.css']);
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
function createServer(options={}){
  const service=createRoomService(),{rooms,clients}=service;
  const server=http.createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';}catch{res.writeHead(400);return res.end();}
    if(name==='health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,app:'aqua-rush-gp',rooms:rooms.size}));}
    if(!PUBLIC.has(name)){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(name)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();fs.createReadStream(path.join(ROOT,name)).pipe(res);
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    let originOK=true;try{if(req.headers.origin)originOK=new URL(req.headers.origin).host===req.headers.host;}catch{originOK=false;}
    if(new URL(req.url,'http://localhost').pathname!=='/socket'||!originOK||clients.size>=200){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',service.attach);
  async function close(){service.close();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}
  return {server,rooms,close,listen:(port=3210,host='0.0.0.0')=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve(server.address());});})};
}
if(require.main===module){const app=createServer();app.server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'Port is already in use. The game may be running at http://localhost:3210':err);process.exit(1);});app.listen(Number(process.env.PORT)||3210,process.env.HOST||'0.0.0.0').then(address=>{
  console.log('\nAQUA RUSH GP multiplayer server is running\nOpen on this computer: http://localhost:'+address.port);
  for(const addresses of Object.values(os.networkInterfaces()))for(const a of addresses||[])if(a.family==='IPv4'&&!a.internal)console.log('Friends on the same Wi-Fi can open: http://'+a.address+':'+address.port);
  console.log('Keep this window open to play online. Press Control+C to stop the server.\n');
});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));}
module.exports={createServer};
