'use strict';
const {spawn}=require('node:child_process');
const os=require('node:os');
async function isGameServer(url){
  try{
    const response=await fetch(url+'/health',{signal:AbortSignal.timeout(1500)});
    if(!response.ok)return false;
    const health=await response.json();
    if(health.ok!==true)return false;
    if(health.app==='aqua-rush-gp')return true;
    // Recognize the first release already running on this computer, too.
    if(health.app!==undefined||!Number.isInteger(health.rooms))return false;
    const page=await fetch(url+'/',{signal:AbortSignal.timeout(1500)});
    const html=await page.text();
    return page.ok&&html.includes('<title>Aqua Rush GP')&&html.includes('src="online.js"');
  }catch{return false;}
}
function openBrowser(url){return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/open',[url],{stdio:'ignore'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Could not open the browser.')));
});}
async function start({port=3210,host='0.0.0.0',open=openBrowser}={}){
  let url='http://localhost:'+port;
  if(port&&await isGameServer(url)){await open(url);return {url,reused:true,close:async()=>{}};}
  const app=require('./server.cjs').createServer();
  let address;
  try{address=await app.listen(port,host);}catch(error){
    await app.close();
    // A second launch may have started the game between the probe and listen.
    if(error.code==='EADDRINUSE'&&await isGameServer(url)){await open(url);return {url,reused:true,close:async()=>{}};}
    if(error.code==='EADDRINUSE')throw Error('Port '+port+' is used by another application. Close it or choose another PORT.');
    throw error;
  }
  url='http://localhost:'+address.port;
  console.log('\nAQUA RUSH GP multiplayer server is running\nOpen on this computer: '+url);
  for(const addresses of Object.values(os.networkInterfaces()))for(const a of addresses||[])if(a.family==='IPv4'&&!a.internal)console.log('Friends on the same Wi-Fi can open: http://'+a.address+':'+address.port);
  console.log('Keep this window open. Press Control+C to stop the server.\n');
  try{await open(url);}catch{console.log('Open this address in your browser: '+url);}
  return {url,reused:false,close:()=>app.close()};
}
if(require.main===module){start({port:Number(process.env.PORT)||3210,host:process.env.HOST||'0.0.0.0'}).then(app=>{
  if(app.reused)console.log('The game is already running. Opened '+app.url+' in your browser.');
  else for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={start,isGameServer};
