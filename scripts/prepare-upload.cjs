'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'deploy-upload');
fs.mkdirSync(out,{recursive:true});
const files=['index.html','three.min.js','dynamics.js','maps.js','city.js','screen-splash.js','race-core.js','online.js','online-sync.js','online.css','mobile-controls.js','mobile-controls.css','manifest.webmanifest','app-icon.svg','room-service.cjs','server.cjs','launcher.cjs','启动联机.command','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','wrangler.jsonc','.gitignore','联机说明.md','Cloudflare部署说明.md','cloudflare/worker.js','scripts/build-cloudflare.cjs','scripts/prepare-upload.cjs','tests/duck.test.cjs','tests/boat-contact.test.cjs','tests/online-sync.test.cjs','tests/cloudflare.test.cjs','tests/multiplayer.test.cjs','tests/launcher.test.cjs','tests/game.test.cjs','tests/mobile-controls.test.cjs','tests/online-interactions.test.cjs','ONLINE-INTERACTIONS.md'];
for(const file of files){const dest=path.join(out,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);}
console.log('Prepared '+files.length+' files in deploy-upload. Upload its contents to the repository root.');
