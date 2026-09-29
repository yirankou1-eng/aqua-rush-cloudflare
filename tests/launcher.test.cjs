const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {start,isGameServer}=require('../launcher.cjs');
test('launcher waits for service readiness, reuses the game, and leaves the first service alive',async t=>{
 const opened=[];const first=await start({port:0,host:'127.0.0.1',open:async url=>{assert(await isGameServer(url));opened.push(url);}});
 t.after(()=>first.close());
 const second=await start({port:Number(new URL(first.url).port),host:'127.0.0.1',open:async url=>opened.push(url)});
 assert(second.reused);assert.equal(first.url,second.url);assert.deepEqual(opened,[first.url,first.url]);await second.close();assert(await isGameServer(first.url));
});
test('launcher recognizes the old game and does not reuse an unrelated service',async t=>{
 let legacy=false;
 const server=http.createServer((req,res)=>{if(legacy&&req.url==='/health'){res.setHeader('Content-Type','application/json');res.end('{"ok":true,"rooms":0}');}else res.end(legacy?'<title>Aqua Rush GP — Racing</title><script src="online.js"></script>':'Another application');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port,url='http://localhost:'+port;assert.equal(await isGameServer(url),false);
 await assert.rejects(start({port,host:'127.0.0.1',open:async()=>assert.fail('Must not open an unrelated service')}),/another application/);
 legacy=true;assert(await isGameServer(url));const app=await start({port,open:async target=>assert.equal(target,url)});assert(app.reused);
});
