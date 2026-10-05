'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../dynamics.js'),Core=require('../race-core.js');
const boat=(x,z,heading=0)=>({x,z,y:0,heading});
test('hull contact covers the bow, head-on, crossing, sideways and coincident boats',()=>{
 for(const [a,b] of [[boat(0,0),boat(0,13.5)],[boat(0,0),boat(0,16,Math.PI)],[boat(0,0),boat(4,0,Math.PI/2)],[boat(0,0),boat(4.5,0)],[boat(0,0),boat(0,0)]]){
  const hit=D.boatContact(a,b);assert(hit);assert(Number.isFinite(hit.depth));
  a.x-=hit.nx*(hit.depth+.03)/2;a.z-=hit.nz*(hit.depth+.03)/2;b.x+=hit.nx*(hit.depth+.03)/2;b.z+=hit.nz*(hit.depth+.03)/2;
  assert.equal(D.boatContact(a,b),null,'full separation must leave no penetrating hull');
 }
 assert.equal(D.boatContact(boat(0,0),boat(0,20)),null);
 assert.equal(D.boatContact(boat(0,0),{...boat(0,0),y:10,air:true}),null,'a boat well above another may jump across');
});
test('server resolves human-human and human-AI overlap using the same hulls',()=>{
 for(const opponentBot of [false,true])for(const heading of [0,Math.PI/2,Math.PI]){
  const race=Core.create('classic'),a=race.boats[0],b=race.boats[1],p=race.curveAt(.12),dir=race.tangentAt(.12),forward=Math.atan2(dir.x,dir.z);
  for(const [i,c] of race.boats.entries()){c.bot=false;c.prog=.12;c.x=p.x+50*i;c.z=p.z;c.heading=forward;c.v=0;c.mesh.position.set(c.x,c.y,c.z);}
  Object.assign(b,{x:a.x+Math.cos(forward)*2,z:a.z-Math.sin(forward)*2,heading:forward+heading,bot:opponentBot});
  race.step();const hit=D.boatContact(a,b);assert(!hit||hit.depth<.03,'server left hulls intersecting');assert(a.hits>0);
 }
});
