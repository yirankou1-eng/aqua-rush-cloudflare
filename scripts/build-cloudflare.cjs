'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist','public');
fs.mkdirSync(out,{recursive:true});
// Explicit public-file list: never publish backups, source for servers, or dependencies.
const files=['index.html','three.min.js','dynamics.js','maps.js','city.js','screen-splash.js','race-core.js','online.js','online.css'];
for(const item of fs.readdirSync(out))if(!files.includes(item))fs.rmSync(path.join(out,item),{recursive:true,force:true});
for(const file of files)fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log('Prepared '+files.length+' public game files for Cloudflare.');
