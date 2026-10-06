'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../mobile-controls.js'),D=require('../dynamics.js');
test('screen-relative tilt handles both landscape directions and invalid data',()=>{
 assert.ok(Math.abs(M.screenTilt(20,0,90)-20)<1e-8);assert.ok(Math.abs(M.screenTilt(20,0,270)+20)<1e-8);
 assert.ok(Math.abs(M.screenTilt(0,20,0)-20)<1e-8);assert.equal(M.screenTilt(null,0,90),null);
 assert.equal(M.tiltSteering(2,0),0);assert.equal(M.tiltSteering(25,0),-1);assert.equal(M.tiltSteering(-25,0),1);
 assert.ok(Math.abs(M.tiltSteering(10,0))<Math.abs(M.tiltSteering(20,0)));
});
test('multiple fingers, brake priority and pointer cancellation do not leave throttle held',()=>{
 const i=M.createInput();i.press(1,'forward');i.press(2,'left');assert.deepEqual(i.read(0,false),{w:true,s:false,steer:1});
 i.press(3,'reverse');assert.deepEqual(i.read(16,false),{w:false,s:true,steer:1});i.release(3);i.release(1);assert.equal(i.read(32,false).w,false);
 i.clear();assert.deepEqual(i.read(48,false),{w:false,s:false,steer:0});
});
test('tilt centers, smooths, expires and resets after rotation',()=>{
 const i=M.createInput();i.sample(8,0,90,0);assert.equal(i.read(0,true).steer,0);i.sample(33,0,90,20);
 const first=i.read(20,true).steer;assert.ok(first<0&&first>-1);assert.ok(i.read(120,true).steer<first);
 i.calibrate();assert.equal(i.read(140,true).steer,0);i.sample(10,0,90,150);assert.ok(i.read(170,true).steer>0);
 assert.equal(i.read(2000,true).steer,0);i.resetOrientation();assert.equal(i.active(2001),false);
});
test('shared driving accepts bounded analog input and preserves keyboard fallback',()=>{
 assert.equal(D.steeringInput({steer:.4}),.4);assert.equal(D.steeringInput({steer:99}),1);assert.equal(D.steeringInput({steer:-99}),-1);
 assert.equal(D.steeringInput({a:true}),1);assert.equal(D.steeringInput({d:true}),-1);assert.equal(D.steeringInput({steer:NaN,a:true}),1);
});
