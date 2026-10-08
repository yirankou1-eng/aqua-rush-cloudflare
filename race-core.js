/* Authoritative multiplayer simulation. No DOM, renderer, timers or network access.
 * Uses the single-player driving equations and BoatDynamics on both server and client.
 * Keep changes to driving equations aligned with index.html's single-player mode.
 */
(function(root){
'use strict';
const node=typeof module!=='undefined'&&module.exports;
const THREE=node?require('./three.min.js'):root.THREE;
const MapCatalog=node?require('./maps.js'):root.MapCatalog;
const BoatDynamics=node?require('./dynamics.js'):root.BoatDynamics;
const DT=1/60;
function create(mapId){
  const activeMap=MapCatalog.get(mapId),RACE_LAPS=activeMap.laps;
  const physics=BoatDynamics.create(MapCatalog.channel(THREE,activeMap.id));
  const curve=MapCatalog.curve(THREE,activeMap.id),curveLen=curve.getLength();
  const SAMPLES=1200,sPts=curve.getSpacedPoints(SAMPLES);
  const waterH=(x,z,t)=>physics.waveHeight(x,z,t);
  function curveAt(t){t=((t%1)+1)%1;const f=t*SAMPLES,i=Math.floor(f),p=sPts[i].clone().lerp(sPts[(i+1)%SAMPLES],f-i);p.y=physics.baseWaterHeight(p.x,p.z);return p;}
  function tangentAt(t){return curveAt(t+.002).sub(curveAt(t-.002)).setY(0).normalize();}
  function halfWidthAt(t){const p=curveAt(t);return physics.channelField(p.x,p.z).width;}
  function laneLimitAt(t,margin=12){return halfWidthAt(t)-margin;}
  function nearestT(x,z,prevT){const previous=Math.round(((prevT%1+1)%1)*SAMPLES)%SAMPLES;let best=previous,dist=Infinity;
    for(let k=-60;k<=60;k++){const i=(previous+k+SAMPLES)%SAMPLES,d=(sPts[i].x-x)**2+(sPts[i].z-z)**2;if(d<dist){dist=d;best=i;}}return best/SAMPLES;}
  function feature(t,originalLat,kind){const p=curveAt(t),tan=tangentAt(t),lat=originalLat*halfWidthAt(t)/80;
    return {t,lat,kind,tan,x:p.x-tan.z*lat,z:p.z+tan.x*lat,laneLimit:laneLimitAt(t)};}
  const ramps=[[.19,-48],[.46,44],[.73,-22],[.92,56]].map(([t,lat])=>{
    const r=feature(t,lat,'ramp');return {...r,width:18,length:30,height:5.2,baseY:physics.baseWaterHeight(r.x,r.z),
      slope:(physics.baseWaterHeight(r.x+r.tan.x*15,r.z+r.tan.z*15)-physics.baseWaterHeight(r.x-r.tan.x*15,r.z-r.tan.z*15))/30};});
  const boosts=[[.27,52],[.56,-54],[.83,26]].map(([t,lat])=>feature(t,lat,'boost'));
  const bridges=(activeMap.scenery&&activeMap.bridges!==false?[[.12,3],[.38,2],[.65,3]]:[]).map(([t,holes])=>{
    const p=curveAt(t),tan=tangentAt(t),width=halfWidthAt(t),pillars=Array.from({length:holes+1},(_,i)=>-width+i*2*width/holes);
    return {t,p,tan,n:new THREE.Vector3(-tan.z,0,tan.x),pillars,openings:pillars.slice(1).map((v,i)=>(v+pillars[i])/2),halfOpening:(2*width/holes-12)/2,baseY:p.y,kind:'bridge'};});
  const tunnels=(activeMap.tunnels||[]).map(zone=>{let high=-Infinity;const steps=Math.ceil((zone.end-zone.start)*curveLen/4);
    for(let i=0;i<=steps;i++)high=Math.max(high,curveAt(zone.start+(zone.end-zone.start)*i/steps).y);
    return {...zone,ceilingAt:lat=>high+10+Math.sqrt(Math.max(0,zone.halfWidth**2-lat**2))};});
  const boats=[-20,-60,20,60].map((lane,id)=>{
    const prog=.003-lane*.1/curveLen,p=curveAt(prog),tan=tangentAt(prog),x=p.x-tan.z*lane,z=p.z+tan.x*lane;
    const b={id,bot:true,mesh:new THREE.Object3D(),x,z,y:waterH(x,z,0),v:0,vy:0,heading:Math.atan2(tan.x,tan.z),
      prog,lap:1,finished:false,finishTime:0,sec:0,secStart:0,secLast:null,secLastIdx:0,secBest:[null,null,null],boostInside:[false,false,false],baseLat:lane,lapCheckpoint:0};
    b.mesh.position.set(x,b.y+1.2,z);b.mesh.rotation.set(0,b.heading,0,'YXZ');return b;});
  const rings=[];
  if(activeMap.id==='playground')for(const anchor of [.075,.145,.235,.335,.485,.605,.705,.785,.905])for(const side of [-1,1]){
    const progress=anchor+(side===1?.006:0),p=curveAt(progress),tan=tangentAt(progress),lane=side*halfWidthAt(progress)*(.24+(rings.length%3)*.14);
    const x=p.x-tan.z*lane,z=p.z+tan.x*lane;rings.push({x,z,vx:0,vz:0,radius:8.8,mass:.11,progress,y:waterH(x,z,0)+.3,vy:0});}
  const duck=activeMap.id==='playground'?{progress:.4,p:curveAt(.4),radius:halfWidthAt(.4)*.5,open:0}:null;
  let player=boats[0],keys={},raceTime=0,started=true,shake=0,flashT=0;
  // Simulation records feedback; the client renders it once, including after replay.
  function feedback(b,type,data){const previous=b.feedback?.[type];b.feedback||={};b.feedback[type]={count:(previous?.count||0)+1,time:raceTime,...data};}
  function bigSplash(x,y,z,power){feedback(player,'splash',{x,y,z,power});}
  function flash(text){feedback(player,'message',{text});player.flashUntil=raceTime+1.5;}

  function recordFinish(b){if(b.finished)return;b.finishRank=1+boats.filter(a=>a.finished).length;b.finishTime=raceTime;b.finished=true;}
function registerLanding(b,x,z,impact,now){
  b.landingAge=0;b.landingStrength=Math.min(1,impact/22);
  const height=b===player?b.y:b.y2;
  const speed=b===player?b.v:b.curV,fx=Math.sin(b.heading),fz=Math.cos(b.heading);
  const surfaceRate=(waterH(x+fx*speed*.01,z+fz*speed*.01,now+.01)-waterH(x,z,now))/.01;
  b.waterEntry=physics.createWaterEntry(height,-impact-surfaceRate,waterH(x,z,now),b.pitchSm||0);
  b.heaveV=-impact;
  b.entryDrag=impact>14?.36:.14;
  
  feedback(b,'landing',{x:x+fx*5,y:waterH(x+fx*5,z+fz*5,now),z:z+fz*5,impact});
  b.jumpCount=(b.jumpCount||0)+1;
}
function tunnelAt(progress){return tunnels.find(s=>progress>=s.start&&progress<=s.end);}
function limitTunnelHeight(b,progress){
  const tunnel=tunnelAt(progress);if(!tunnel||!b.air)return false;
  const yKey=b===player?'y':'y2',vKey=b===player?'vy':'vy2';
  const p=curveAt(progress),tan=tangentAt(progress),lat=b===player?-(b.x-p.x)*tan.z+(b.z-p.z)*tan.x:b.lat;
  const ceiling=tunnel.ceilingAt(Math.min(tunnel.halfWidth,Math.abs(lat)+3));
  if(b[yKey]<=ceiling-4.5)return false;
  b[yKey]=ceiling-4.5;b[vKey]=-Math.max(2,Math.abs(b[vKey]||0)*.35);
  return true;
}
function poseBoat(b,dt,now,x,z,baseY,verticalV,steerRoll){
  const fx=Math.sin(b.heading),fz=Math.cos(b.heading),rx=fz,rz=-fx;
  const halfLength=b.duckForm?2.6:5;
  const front=waterH(x+fx*halfLength,z+fz*halfLength,now),back=waterH(x-fx*halfLength,z-fz*halfLength,now);
  const right=waterH(x+rx*2.2,z+rz*2.2,now),left=waterH(x-rx*2.2,z-rz*2.2,now);
  b.landingAge=(b.landingAge===undefined?9:b.landingAge)+dt;
  const speed=b===player?Math.abs(b.v):b.curV;
  let pitch,vertical;
  if(b.air){
    vertical=baseY+1.2;pitch=THREE.MathUtils.clamp(-verticalV*.024,-.48,.52);
    b.heave=vertical;b.heaveV=verticalV;
  }else if(b.waterEntry){
    const entry=b.waterEntry,surface=waterH(x,z,now);
    if(entry.justEntered){
      // The airborne integrator already advanced this frame; do not advance a second time.
      entry.justEntered=false;entry.offset=entry.height-surface;
    }else physics.stepWaterEntry(entry,dt);
    vertical=surface+1.2+entry.offset;
    const level=THREE.MathUtils.smoothstep(entry.age,.15,2.2);
    // Spread impact drag over immersion instead of removing speed on one frame.
    const drag=Math.exp(-b.entryDrag*(Math.exp(-Math.max(0,entry.age-dt)*3)-Math.exp(-entry.age*3)));
    if(b===player)b.v*=drag;else b.curV*=drag;
    const wavePitch=-Math.atan2(front-back,halfLength*2)*1.35;
    pitch=entry.pitch*(1-level)+wavePitch*level;
    b.heave=vertical;b.heaveV=entry.velocity;
    if(b===player){b.y=vertical-1.2;b.vy=entry.velocity;}else{b.y2=vertical-1.2;b.vy2=entry.velocity;}
    if(entry.done)b.waterEntry=null;
  }else{
    const ramp=b.onRamp;
    const target=ramp?baseY+1.2:(front+back+right+left)/4+1.2+Math.min(1,speed/52)*.12*Math.sin(now*7.5+(b.phase||0));
    if(b.heave===undefined){b.heave=target;b.heaveV=0;}
    const heave=physics.spring(b.heave,b.heaveV||0,target,dt,ramp?14:6,.72);
    b.heave=ramp?Math.max(heave.value,baseY+1.5):heave.value;b.heaveV=heave.velocity;vertical=b.heave;
    pitch=ramp?-Math.atan2(ramp.height-.15,ramp.length)-Math.atan(ramp.slope):-Math.atan2(front-back,halfLength*2)*1.35;
  }
  const angular=physics.spring(b.pitchSm||0,b.pitchV||0,pitch,dt,9,1);
  b.pitchSm=angular.value;b.pitchV=angular.velocity;
  const roll=steerRoll+(b.air?0:Math.atan2(right-left,4.4)*.7);
  // Duck geometry has no deep boat hull: its belly must sit below the waterline.
  b.mesh.position.set(x,vertical-(b.duckForm?1.5:0),z);b.mesh.rotation.set(b.pitchSm,b.heading,roll,'YXZ');
}
function rideRamp(b,x,z,speed){
  let active=null;
  for(const r of ramps){
    const sample=physics.rampSample(r,x,z);
    const forward=Math.sin(b.heading)*r.tan.x+Math.cos(b.heading)*r.tan.z;
    if(!sample.inside || forward<.55)continue;
    // Hull overlap counts at the approach; the tall back face still cannot trigger a jump.
    if(!b.onRamp && sample.along>-r.length/2+12)continue;
    active=r;b.onRamp=r;
    if(sample.along>=r.length/2-1 && speed>18){b.onRamp=null;return {launch:true,height:r.baseY+r.slope*r.length/2+r.height,surfaceVy:r.slope*speed};}
    return {height:r.baseY+r.slope*sample.along+sample.height};
  }
  b.onRamp=active;return null;
}

function updatePlayer(dt, t){
  if(!started || player.finished || player.duckTransit) return;
  const th = keys['arrowup']||keys['w'], br = keys['arrowdown']||keys['s'];
  const st = physics.steeringInput(keys);

  const ground = waterH(player.x, player.z, t);
  const flow=physics.currentAlong(player.x,player.z,Math.sin(player.heading),Math.cos(player.heading));
  if(!player.air){
    if(!player.onRamp)player.v+=physics.currentAcceleration(flow)*dt;
    if(th) player.v += 26*dt;
    if(br) player.v -= 34*dt;
    player.v -= player.v*0.35*dt;                 // drag
    player.bonus = Math.max(0, (player.bonus||0) - 1.4*dt);   // boost energy bleeds off over ~19s
    player.v = Math.max(-8, Math.min(player.v,52+player.bonus+flow));
    // steering with angular inertia: input accelerates yaw rate, water damps it,
    // so turning builds up with hold time and coasts after release
    const sf = Math.min(1, Math.abs(player.v)/18) * Math.sign(player.v||1);
    player.yawVel = (player.yawVel||0) + st * 3.6 * sf * dt;
    player.yawVel -= player.yawVel * 3.1 * dt;
    player.yawVel = Math.max(-1.25*Math.abs(sf), Math.min(1.25*Math.abs(sf), player.yawVel));
    player.heading += player.yawVel * dt;

    // boost pads — one-shot impulse on entry (edge-triggered, big kick)
    for(const b of boosts){
      const dx = player.x-b.x, dz = player.z-b.z;
      const inside = dx*dx+dz*dz < 144;
      if(inside && !player.boostInside[boosts.indexOf(b)]){
        player.bonus = Math.min((player.bonus||0) + 26, 43);
        player.v = Math.min(player.v + 26, 52 + player.bonus);
        flash('BOOST!');

      }
      player.boostInside[boosts.indexOf(b)] = inside;
    }
    if(!player.waterEntry)player.y=ground;
    const ramp=player.waterEntry?null:rideRamp(player,player.x,player.z,player.v);
    if(ramp){
      player.y=Math.max(ground,ramp.height);
      if(ramp.launch){player.air=true;player.vy=8+player.v*.2+ramp.surfaceVy;flash('JUMP!');}
    }
  } else {
    player.vy -= 22*dt;
    player.y += player.vy*dt;
    // weak, damped air control with the same inertia model
    player.yawVel = (player.yawVel||0) + st * 0.5 * dt;
    player.yawVel -= player.yawVel * 0.5 * dt;
    player.heading += player.yawVel * dt;
    if(player.y <= ground){
      const impact = Math.abs(player.vy);
      player.air = false;
      registerLanding(player,player.x,player.z,impact,t);
      if(impact > 6) shake = Math.min(1, impact*0.08);
      flash(impact > 14 ? 'ROUGH LANDING' : 'SPLASHDOWN');
    }
  }

  player.floatVX=(player.floatVX||0)*Math.exp(-3.1*dt);
  player.floatVZ=(player.floatVZ||0)*Math.exp(-3.1*dt);
  player.x += (Math.sin(player.heading)*player.v+player.floatVX)*dt;
  player.z += (Math.cos(player.heading)*player.v+player.floatVZ)*dt;

  // wall collision — angle-dependent: graze (<30° to the wall) scrubs speed
  // proportionally with a light tremor; a steeper hit (>30°) is a full crash stop
  {
    const nt0 = nearestT(player.x, player.z, player.prog);
    const cp = curveAt(nt0), tan = tangentAt(nt0);
    const nx = -tan.z, nz = tan.x;
    const lat = (player.x-cp.x)*nx + (player.z-cp.z)*nz;
    const limit=laneLimitAt(nt0,4);
    const wasWall = player.wallOn; player.wallOn = false;
    if(Math.abs(lat) > limit){
      const s = Math.sign(lat);
      // remove ONLY the lateral excess — clamping to an absolute point would pin
      // the boat to a curve sample and erase all forward motion
      const excess = lat - s*limit;
      player.x -= nx*excess;
      player.z -= nz*excess;
      player.wallOn = true;
      // angle between travel direction and the wall: sin of it = normal component
      const sinA = Math.abs(Math.sin(player.heading)*nx + Math.cos(player.heading)*nz);
      if(sinA < 0.5){
        // grazing — nearly frictionless; the angle term is symbolic at this scale
        player.v = Math.max(0, player.v - 0.3*(sinA/0.5)*dt);
        if(th) shake = Math.max(shake, 0.12);      // tremor only while pushing against it
        if(!wasWall){
          if(th) shake = 0.25;
          bigSplash(player.x, waterH(player.x, player.z, t), player.z, 2);
        }
      } else {
        // square hit — crash stop
        player.v *= 0.55;
        if(!wasWall){
          shake = 0.8;
          player.hits = (player.hits||0)+1;
          bigSplash(player.x, waterH(player.x, player.z, t), player.z, 4);
          if(flashT<=0) flash('WALL!');
        }
      }
    }
  }

  // bridge pillars — same angle rule as walls: grazing the pillar face scrubs
  // speed, a steep hit stops you cold
  const wasPillar = player.pillarOn; player.pillarOn = false;
  for(const bridge of bridges){
    const {p:bridgePos,tan:bridgeTan,n:bridgeN,pillars:PILLARS}=bridge;
    if(player.y>=bridge.baseY+20.5)continue;
    const sdx = player.x - bridgePos.x, sdz = player.z - bridgePos.z;
    const along = sdx*bridgeTan.x + sdz*bridgeTan.z;      // distance through the bridge
    if(Math.abs(along) < 9){
      const lat = sdx*bridgeN.x + sdz*bridgeN.z;
      const nearest=bridge.openings.reduce((best,o)=>Math.abs(lat-o)<Math.abs(lat-best)?o:best);
      const u=Math.min(1,Math.abs(lat-nearest)/bridge.halfOpening);
      const ceiling=bridge.baseY+7.5+9.3*Math.sqrt(1-u*u);
      if(player.air && player.y+3.3>ceiling){player.y=ceiling-3.3;player.vy=-Math.abs(player.vy)*.5;player.v*=.75;shake=.5;}
      for(const c of PILLARS){
        if(Math.abs(lat - c) < 10){
          const side = Math.sign(along)||1;
          // push out along the bridge axis only, preserving lateral position
          const pushOut = 9*side - along;
          player.x += bridgeTan.x*pushOut;
          player.z += bridgeTan.z*pushOut;
          player.pillarOn = true;
          // pillar face normal is bridgeTan; sin of approach angle = normal component
          const sinA = Math.abs(Math.sin(player.heading)*bridgeTan.x + Math.cos(player.heading)*bridgeTan.z);
          if(sinA < 0.5){
            player.v = Math.max(0, player.v - 0.5*(sinA/0.5)*dt);
            if(th) shake = Math.max(shake, 0.12);
            if(!wasPillar){
              if(th) shake = 0.25;
              bigSplash(player.x, waterH(player.x, player.z, t), player.z, 3);
            }
          } else {
            player.v *= 0.4;
            if(!wasPillar){
              shake = 0.9;
              bigSplash(player.x, waterH(player.x, player.z, t), player.z, 5);
              player.hits = (player.hits||0)+1;
              if(flashT<=0) flash('BRIDGE PILLAR!');
            }
          }
          break;
        }
      }
    }
  }

  collideDuck();
  // progress & laps
  const nt = nearestT(player.x, player.z, player.prog);
  const previousProgress=player.prog;
  const completedLap=physics.advanceLapCheckpoints(player,previousProgress,nt);
  if(completedLap){
    player.lap++;
    if(player.lap > RACE_LAPS){
      recordFinish(player);
      flash('FINISH!');
    } else flash('LAP ' + player.lap + ' / ' + RACE_LAPS);
  }
  player.prog = nt;

  // sector timing (3 sectors per lap, best sector tracked)
  const sec = Math.min(2, Math.floor(player.prog*3));
  // Only a forward, ordered boundary crossing completes a timed sector.
  // Keep the active sector while reversing; the finish boundary needs a valid lap.
  const sectorCrossed=sec===0?completedLap:
    previousProgress<sec/3&&nt>=sec/3&&nt-previousProgress<.04&&player.lapCheckpoint>=sec;
  if(sec === (player.sec+1)%3 && sectorCrossed && raceTime - player.secStart > 3){
    const st = raceTime - player.secStart;
    const prev = player.sec;
    player.secLast = st; player.secLastIdx = prev;
    if(!player.secBest[prev] || st < player.secBest[prev]){
      player.secBest[prev] = st;
      if(!player.finished)flash('SECTOR ' + (prev+1) + ' BEST!');
    } else if(!player.finished)flash('SECTOR ' + (sec+1));
    player.sec = sec; player.secStart = raceTime;
  }

  // mesh pose
  player.topV = Math.max(player.topV||0, player.v);
  const targetRoll=THREE.MathUtils.clamp(-(player.yawVel||0)*.5,-.45,.45);
  player.rollSm=(player.rollSm||0)+(targetRoll-(player.rollSm||0))*Math.min(1,9*dt);
  if(limitTunnelHeight(player,player.prog)){player.v*=.92;shake=Math.max(shake,.3);}
  poseBoat(player,dt,t,player.x,player.z,player.y,player.vy,player.rollSm);

}


  function collideDuck(){
    if(!duck||player.duckTransit)return;
    const dx=player.x-duck.p.x,dz=player.z-duck.p.z,d=Math.hypot(dx,dz),r=duck.radius*.83+5;
    if(d<r){const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;player.x=duck.p.x+nx*r;player.z=duck.p.z+nz*r;
      if(player.v*(nx*Math.sin(player.heading)+nz*Math.cos(player.heading))<0)player.v*=.94;}
  }
  function duckStep(b,dt){
    if(!duck||b.finished)return false;
    const tan=tangentAt(duck.progress),dx=b.x-duck.p.x,dz=b.z-duck.p.z,along=dx*tan.x+dz*tan.z,lat=-dx*tan.z+dz*tan.x;
    if(b.lap>1&&along< -duck.radius&&along> -360)duck.open=Math.min(1,duck.open+dt/2.2);
    if(!b.bot&&!b.duckUsed&&b.lap>1&&duck.open>.92&&!b.air&&Math.abs(lat)<duck.radius*.24+2.6&&along< -duck.radius*.9&&along> -duck.radius*2.3-7){
      b.duckTransit=true;b.duckAge=0;b.duckX=b.x;b.duckZ=b.z;b.duckSpeed=b.v;b.v=0;
    }
    if(!b.duckTransit)return false;
    b.duckAge+=dt;
    if(b.duckAge<.75){const f=b.duckAge/.75;b.x=b.duckX+(duck.p.x-b.duckX)*f;b.z=b.duckZ+(duck.p.z-b.duckZ)*f;b.y=waterH(b.x,b.z,raceTime)+duck.radius*.55*f;}
    else if(b.duckAge>=2){const progress=duck.progress+(duck.radius+16)/curveLen,p=curveAt(progress),dir=tangentAt(progress);
      b.prog=progress;b.x=p.x;b.z=p.z;b.y=waterH(p.x,p.z,raceTime);b.heading=Math.atan2(dir.x,dir.z);b.v=Math.max(28,b.duckSpeed);
      feedback(b,'message',{text:'QUACK!'});b.duckTransit=false;b.duckUsed=true;b.duckForm=true;b.heave=b.y+1.2;b.heaveV=b.pitchSm=b.pitchV=b.yawVel=b.vy=0;b.waterEntry=b.onRamp=null;b.air=false;}
    b.mesh.position.set(b.x,b.y+1.2,b.z);b.mesh.rotation.set(0,b.heading,0,'YXZ');return true;
  }
  function botInput(b){
    const p=curveAt(b.prog),tan=tangentAt(b.prog),lat=-(b.x-p.x)*tan.z+(b.z-p.z)*tan.x;
    let aim=b.baseLat*.5;
    for(const boost of boosts){const d=physics.featureDistance(b.prog,boost,curveLen);if(d>0&&d<240)aim=boost.lat;}
    for(const bridge of bridges){const d=physics.featureDistance(b.prog,bridge,curveLen);if(d> -20&&d<260)aim=bridge.openings.reduce((best,o)=>Math.abs(o-lat)<Math.abs(best-lat)?o:best);}
    if(duck){const d=((duck.progress-b.prog+1.5)%1-.5)*curveLen;if(d> -duck.radius-50&&d<300)aim=(Math.sign(b.baseLat)||1)*(duck.radius+16);}
    const look=Math.max(22,Math.abs(b.v)*.85),targetT=b.prog+look/curveLen,target=curveAt(targetT),dir=tangentAt(targetT);
    aim=THREE.MathUtils.clamp(aim,-laneLimitAt(targetT),laneLimitAt(targetT));target.x-=dir.z*aim;target.z+=dir.x*aim;
    const delta=Math.atan2(Math.sin(Math.atan2(target.x-b.x,target.z-b.z)-b.heading),Math.cos(Math.atan2(target.x-b.x,target.z-b.z)-b.heading));
    const steer=delta-(b.yawVel||0)*.38;
    return {w:Math.abs(delta)<.95||b.v<12,s:Math.abs(delta)>1.1&&b.v>20,a:steer>.035,d:steer<-.035};
  }
  function contacts(dt){
    // Resolve full hull penetration, including head-on and perpendicular impacts.
    // Revisit pairs so a three-boat pile-up does not leave the first pair embedded.
    for(let pass=0;pass<4;pass++)for(let i=0;i<boats.length;i++)for(let j=i+1;j<boats.length;j++){
      const a=boats[i],b=boats[j],hit=physics.boatContact(a,b);if(!hit)continue;
      const push=(hit.depth+.025)/2;
      a.x-=hit.nx*push;a.z-=hit.nz*push;b.x+=hit.nx*push;b.z+=hit.nz*push;
      if(raceTime-(a.lastBump??-9)>.4){a.shake=Math.max(a.shake||0,.35);b.shake=Math.max(b.shake||0,.35);a.v*=.9;b.v*=.9;a.hits=(a.hits||0)+1;b.hits=(b.hits||0)+1;a.lastBump=b.lastBump=raceTime;}
    }
    for(let step=0;step<2;step++){
      for(const r of rings)physics.stepFloat(r,dt/2);
      for(const b of boats){if(b.air||b.finished||b.duckTransit||b.onRamp)continue;
        const body={x:b.x,z:b.z,heading:b.heading,radius:2.6,halfLength:4.8,mass:1,inertia:28,yaw:b.yawVel||0,vx:Math.sin(b.heading)*b.v+(b.floatVX||0),vz:Math.cos(b.heading)*b.v+(b.floatVZ||0)};
        let hit=false;for(const r of rings){const impulse=physics.hitFloat(body,r);if(impulse>0)hit=true;
          if(impulse>.45&&raceTime-(b.lastFloatImpact??-9)>.22){b.shake=Math.max(b.shake||0,Math.min(.48,.14+impulse*.065));b.lastFloatImpact=raceTime;}
        }
        if(hit||body.contact){b.x=body.x;b.z=body.z;b.v=body.vx*Math.sin(b.heading)+body.vz*Math.cos(b.heading);b.floatVX=body.vx-Math.sin(b.heading)*b.v;b.floatVZ=body.vz-Math.cos(b.heading)*b.v;b.yawVel=body.yaw;}
      }
      for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++){Object.assign(rings[i],{heading:0,halfLength:0,inertia:1,yaw:0});physics.hitFloat(rings[i],rings[j]);}
      for(const r of rings){r.progress=nearestT(r.x,r.z,r.progress);const p=curveAt(r.progress),tan=tangentAt(r.progress),lat=-(r.x-p.x)*tan.z+(r.z-p.z)*tan.x,limit=halfWidthAt(r.progress)-r.radius-.15;
        if(Math.abs(lat)>limit){const side=Math.sign(lat),excess=lat-side*limit;r.x+=tan.z*excess;r.z-=tan.x*excess;const out=(-r.vx*tan.z+r.vz*tan.x)*side;if(out>0){r.vx+=1.25*out*tan.z*side;r.vz-=1.25*out*tan.x*side;}}}
    }
    for(const r of rings){const s=physics.spring(r.y,r.vy,waterH(r.x,r.z,raceTime)+.3,dt,5,.8);r.y=s.value;r.vy=s.velocity;}
    for(let pass=0;pass<4;pass++)for(let i=0;i<boats.length;i++)for(let j=i+1;j<boats.length;j++){
      const a=boats[i],b=boats[j],hit=physics.boatContact(a,b);if(!hit)continue;const push=(hit.depth+.025)/2;
      a.x-=hit.nx*push;a.z-=hit.nz*push;b.x+=hit.nx*push;b.z+=hit.nz*push;
    }
    for(const b of boats){b.mesh.position.x=b.x;b.mesh.position.z=b.z;}
  }
  function step(inputs={}){
    raceTime+=DT;
    for(const b of boats){player=b;shake=Math.max(0,(b.shake||0)-2.6*DT);flashT=Math.max(0,(b.flashUntil||0)-raceTime);keys=b.bot?botInput(b):(inputs[b.id]||{});if(!duckStep(b,DT))updatePlayer(DT,raceTime);b.shake=shake;}
    contacts(DT);
  }
  function snapshot(){return {time:raceTime,duckOpen:duck?duck.open:0,rings:rings.map(r=>({...r})),boats:boats.map(b=>{
    const data={};for(const [k,v] of Object.entries(b))if(k!=='mesh'&&k!=='onRamp')data[k]=v;
    data.onRamp=b.onRamp?ramps.indexOf(b.onRamp):-1;data.position=b.mesh.position.toArray();data.rotation=[b.mesh.rotation.x,b.mesh.rotation.y,b.mesh.rotation.z];return JSON.parse(JSON.stringify(data));})};}
  function restore(source){const s=JSON.parse(JSON.stringify(source));raceTime=s.time;if(duck)duck.open=s.duckOpen;
    s.rings.forEach((r,i)=>Object.assign(rings[i],r));
    s.boats.forEach((data,i)=>{const b=boats[i],mesh=b.mesh;for(const k of Object.keys(b))if(k!=='mesh')delete b[k];Object.assign(b,data);b.mesh=mesh;b.onRamp=ramps[data.onRamp]||null;b.mesh.position.fromArray(data.position);b.mesh.rotation.set(...data.rotation,'YXZ');delete b.position;delete b.rotation;});}
  return {boats,rings,duck,step,snapshot,restore,botInput,curveAt,tangentAt,halfWidthAt,laneLimitAt,ramps,boosts,bridges,tunnels,get time(){return raceTime;}};
}
const api={create,DT};if(node)module.exports=api;else root.RaceCore=api;
})(typeof window!=='undefined'?window:globalThis);
