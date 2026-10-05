/* Shared, renderer-independent boat dynamics and route planning. */
(function(root){
  function create(channel={}){
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  // Periodic height field: the closed course returns to the same water level.
  // This is an arcade open-channel model, not a conserved-volume fluid solver.
  const CHANNEL={rise:44,harmonic:12,wide:80,narrowA:30,narrowB:40,startFlare:0,tunnels:[],...channel};
  function channelPulse(angle,center,span){
    const d=Math.atan2(Math.sin(angle-center),Math.cos(angle-center));
    return Math.abs(d)>=span?0:Math.pow(.5+.5*Math.cos(d*Math.PI/span),2);
  }
  function channelField(x,z){
    const angle=Math.atan2(z,x),radius=Math.max(400,Math.hypot(x,z));
    const elevation=CHANNEL.rise*(1-Math.cos(angle))+CHANNEL.harmonic*(1-Math.cos(2*angle));
    let width=CHANNEL.wide+CHANNEL.startFlare*channelPulse(angle,0,.65)-CHANNEL.narrowA*channelPulse(angle,1.85,.85)-CHANNEL.narrowB*channelPulse(angle,-1.65,.8);
    const phase=(angle+Math.PI*2)%(Math.PI*2);
    const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
    for(const zone of CHANNEL.tunnels){
      const blend=smooth(zone.start-zone.blend,zone.start,phase)*(1-smooth(zone.end,zone.end+zone.blend,phase));
      width+=(Math.min(width,zone.width)-width)*blend;
    }
    const derivative=CHANNEL.rise*Math.sin(angle)+2*CHANNEL.harmonic*Math.sin(2*angle);
    const slope=derivative/radius;
    // Equal nominal depth: narrower cross-sections amplify speed, capped for playability.
    const flow=clamp(-slope*100*CHANNEL.wide/width,-13,13);
    return {elevation,width,slope,flow,flowX:-Math.sin(angle)*flow,flowZ:Math.cos(angle)*flow,
      roughness:Math.min(1,Math.abs(flow)/13),canyon:(CHANNEL.wide-width)/CHANNEL.narrowB};
  }
  function baseWaterHeight(x,z){
    const a=Math.atan2(z,x);return CHANNEL.rise*(1-Math.cos(a))+CHANNEL.harmonic*(1-Math.cos(2*a));
  }
  function waveHeight(x,z,t){
    const c=channelField(x,z);
    return c.elevation+(1+c.roughness*.3)*(.78*Math.sin(x*.045+z*.018+t*1.3)+.42*Math.sin(z*.072-x*.021+t*1.05)+.22*Math.sin((x+z)*.11-t*1.65));
  }
  function currentAlong(x,z,fx,fz){const c=channelField(x,z);return c.flowX*fx+c.flowZ*fz;}
  function currentAcceleration(flow){return .35*flow;}
  // GPU water, foam and CPU buoyancy share the same profile constants and wave terms.
  const channelGLSL=`
    float channelPulse(float a,float center,float span){
      float d=atan(sin(a-center),cos(a-center));
      if(abs(d)>=span)return 0.;
      float v=.5+.5*cos(d*3.141592653589793/span);return v*v;
    }
    vec4 channelData(vec2 p){
      float a=atan(p.y,p.x),r=max(400.,length(p));
      float h=${CHANNEL.rise.toFixed(1)}*(1.-cos(a))+${CHANNEL.harmonic.toFixed(1)}*(1.-cos(2.*a));
      float w=${CHANNEL.wide.toFixed(1)}+${CHANNEL.startFlare.toFixed(1)}*channelPulse(a,0.,.65)-${CHANNEL.narrowA.toFixed(1)}*channelPulse(a,1.85,.85)-${CHANNEL.narrowB.toFixed(1)}*channelPulse(a,-1.65,.8);
      float phase=mod(a+6.28318530718,6.28318530718);
      ${CHANNEL.tunnels.map(z=>`w=mix(w,min(w,${z.width.toFixed(6)}),smoothstep(${(z.start-z.blend).toFixed(6)},${z.start.toFixed(6)},phase)*(1.-smoothstep(${z.end.toFixed(6)},${(z.end+z.blend).toFixed(6)},phase)));`).join('\n')}
      float slope=(${CHANNEL.rise.toFixed(1)}*sin(a)+${(2*CHANNEL.harmonic).toFixed(1)}*sin(2.*a))/r;
      float flow=clamp(-slope*100.*${CHANNEL.wide.toFixed(1)}/w,-13.,13.);
      return vec4(h,w,flow,min(1.,abs(flow)/13.));
    }
    vec2 channelFlow(vec2 p){float a=atan(p.y,p.x);return vec2(-sin(a),cos(a))*channelData(p).z;}
    float waterHeight(vec2 p,float t){
      vec4 c=channelData(p);
      return c.x+(1.+c.w*.3)*(.78*sin(dot(p,vec2(.045,.018))+t*1.3)
        +.42*sin(dot(p,vec2(-.021,.072))+t*1.05)+.22*sin(dot(p,vec2(.11,.11))-t*1.65));
    }
  `;
  function spring(value,velocity,target,dt,frequency=6,damping=.7){
    const steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;
    for(let i=0;i<steps;i++){
      velocity+=((target-value)*frequency*frequency-2*damping*frequency*velocity)*h;
      value+=velocity*h;
    }
    return {value,velocity};
  }
  function createWaterEntry(height,velocity,surface,pitch=0){
    return {offset:height-surface,velocity,age:0,omega:Math.max(2.05,Math.abs(velocity)/10.5),
      pitch:clamp(pitch,-.48,.52),height,justEntered:true,done:false};
  }
  function stepWaterEntry(entry,dt){
    // Exact critically damped buoyancy solution. Position AND velocity survive contact.
    // No sinusoidal depth animation, sign reversal, or spring overshoot above the waterline.
    const w=entry.omega,c=entry.velocity+w*entry.offset,decay=Math.exp(-w*dt);
    entry.offset=(entry.offset+c*dt)*decay;
    entry.velocity=(entry.velocity-w*c*dt)*decay;
    entry.age+=dt;
    entry.done=entry.age>1 && Math.abs(entry.offset)<.025 && Math.abs(entry.velocity)<.06;
    return entry;
  }
  function featureDistance(progress,feature,length){return ((feature.t-progress)%1+1)%1*length;}
  function chooseRoute(a,features,length,dt,random=Math.random){
    // Commit to one encounter. Release only after physically passing it, never reroll each frame.
    if(a.route){
      a.route.remaining-=(a.curV||0)*dt;
      if(a.route.remaining < -24)a.route=null;
    }
    if(!a.route){
      const next=features.map(f=>({f,d:featureDistance(a.t%1,f,length)})).sort((a,b)=>a.d-b.d)[0];
      if(next){
        const f=next.f;
        const target=f.kind==='bridge'?f.openings.reduce((b,x)=>Math.abs(x-a.lat)<Math.abs(b-a.lat)?x:b):f.lat;
        const lateralTime=Math.abs(target-a.lat)/16;
        const lead=Math.max(105,Math.max(24,a.curV)*(lateralTime+2.8)+25);
        if(next.d<lead){
          const chance=f.kind==='ramp'?(a.rampSkill===undefined?a.skill:a.rampSkill):a.skill;
          const go=f.kind==='bridge'||random()<chance;
          let lane=target;
          if(!go){
            const clearance=f.kind==='ramp'?18:20;
            const choices=[target-clearance,target+clearance].filter(x=>Math.abs(x)<=(f.laneLimit||68));
            const nextFeature=features.filter(candidate=>candidate!==f&&candidate.kind!=='ramp').sort((x,y)=>featureDistance(f.t,x,length)-featureDistance(f.t,y,length))[0];
            const preferred=a.skill>=.85&&nextFeature&&nextFeature.kind==='boost'?nextFeature.lat:a.lat;
            lane=Math.abs(a.lat-target)>=clearance?a.lat:choices.reduce((best,x)=>Math.abs(x-preferred)<Math.abs(best-preferred)?x:best);
          }
          a.route={feature:f,lane,go,remaining:next.d};
        }
      }
    }
    return a.route?a.route.lane:a.lat;
  }
  function rampSample(r,x,z){
    const dx=x-r.x,dz=z-r.z;
    const along=dx*r.tan.x+dz*r.tan.z,across=-dx*r.tan.z+dz*r.tan.x;
    const inside=Math.abs(across)<r.width/2+1.6 && along>=-r.length/2-5 && along<=r.length/2+6;
    return {along,across,inside,height:clamp((along+r.length/2)/r.length,0,1)*(r.height-.15)+.15};
  }
  // A light floating body against a capsule hull. Normal impulses act equally and
  // oppositely; the off-centre contact also changes the hull's angular velocity.
  function hitFloat(boat,ring){
    const fx=Math.sin(boat.heading),fz=Math.cos(boat.heading);
    const along=clamp((ring.x-boat.x)*fx+(ring.z-boat.z)*fz,-boat.halfLength,boat.halfLength);
    const cx=boat.x+fx*along,cz=boat.z+fz*along;
    const dx=ring.x-cx,dz=ring.z-cz,d=Math.hypot(dx,dz),radius=boat.radius+ring.radius;
    if(d>=radius)return 0;
    const nx=d>1e-8?dx/d:Math.cos(boat.heading),nz=d>1e-8?dz/d:-Math.sin(boat.heading);
    const lever=along*(fz*nx-fx*nz),invB=1/boat.mass,invR=1/ring.mass;
    const closing=(boat.vx-ring.vx)*nx+(boat.vz-ring.vz)*nz+(boat.yaw||0)*lever;
    const impulse=Math.max(0,closing)*1.12/(invB+invR+lever*lever/boat.inertia);
    boat.vx-=impulse*nx*invB;boat.vz-=impulse*nz*invB;
    boat.yaw=(boat.yaw||0)-impulse*lever/boat.inertia;
    ring.vx+=impulse*nx*invR;ring.vz+=impulse*nz*invR;
    // Positional correction is separate from velocity, so resting contacts add no energy.
    const push=(radius-d+.001)/(invB+invR);
    boat.x-=nx*push*invB;boat.z-=nz*push*invB;
    ring.x+=nx*push*invR;ring.z+=nz*push*invR;
    return impulse;
  }
  function stepFloat(ring,dt){
    const decay=Math.exp(-.85*dt),distance=(1-decay)/.85;
    ring.x+=ring.vx*distance;ring.z+=ring.vz*distance;
    ring.vx*=decay;ring.vz*=decay;
    if(Math.hypot(ring.vx,ring.vz)<.035){ring.vx=0;ring.vz=0;}
  }
  // One gate in each timing sector, spanning the whole navigable channel.
  const LAP_CHECKPOINTS=[1/6,1/2,5/6];
  function advanceLapCheckpoints(racer,previous,current){
    const delta=((current-previous+1.5)%1)-.5;
    let count=racer.lapCheckpoint||0;
    if(Math.abs(delta)>.04){racer.lapCheckpoint=0;return false;}
    if(delta>0){
      if(current<previous){
        racer.lapCheckpoint=0;
        return count===LAP_CHECKPOINTS.length;
      }
      while(count<LAP_CHECKPOINTS.length&&previous<LAP_CHECKPOINTS[count]&&current>=LAP_CHECKPOINTS[count])count++;
    }else if(delta<0){
      if(current>previous)count=0;
      else while(count>0&&previous>=LAP_CHECKPOINTS[count-1]&&current<LAP_CHECKPOINTS[count-1])count--;
    }
    racer.lapCheckpoint=count;return false;
  }
  // Convex top-down footprint follows makeBoat's tapered bow and offset stern.
  // Return the minimum translation taking b away from a; do not mutate either body.
  function boatContact(a,b){
    if(a.finished||b.finished||a.duckTransit||b.duckTransit||Math.abs((a.y||0)-(b.y||0))>4)return null;
    if(Math.hypot(b.x-a.x,b.z-a.z)>32)return null;
    function hull(body){
      const points=body.duckForm?Array.from({length:12},(_,i)=>[Math.cos(i*Math.PI/6)*4.2,Math.sin(i*Math.PI/6)*4.2]):
        [[-2.3,-6.9],[-2.6,-4.5],[-2.5,-1],[-2,3],[-1.15,6],[-.06,8.5],[.06,8.5],[1.15,6],[2,3],[2.5,-1],[2.6,-4.5],[2.3,-6.9]];
      const sn=Math.sin(body.heading),cs=Math.cos(body.heading);
      return points.map(([x,z])=>({x:body.x+x*cs+z*sn,z:body.z-x*sn+z*cs}));
    }
    const aa=hull(a),bb=hull(b);let best=null;
    for(const points of [aa,bb])for(let i=0;i<points.length;i++){
      const p=points[i],q=points[(i+1)%points.length],len=Math.hypot(q.x-p.x,q.z-p.z);
      let nx=-(q.z-p.z)/len,nz=(q.x-p.x)/len;
      const av=aa.map(p=>p.x*nx+p.z*nz),bv=bb.map(p=>p.x*nx+p.z*nz);
      const plus=Math.max(...av)-Math.min(...bv),minus=Math.max(...bv)-Math.min(...av);
      if(plus<=0||minus<=0)return null;
      let depth=plus;if(minus<plus){depth=minus;nx=-nx;nz=-nz;}
      if(!best||depth<best.depth)best={nx,nz,depth};
    }
    return best;
  }
  const api={boatContact,LAP_CHECKPOINTS,advanceLapCheckpoints,CHANNEL,channelField,baseWaterHeight,currentAlong,currentAcceleration,channelGLSL,waveHeight,spring,createWaterEntry,stepWaterEntry,chooseRoute,rampSample,featureDistance,hitFloat,stepFloat};
  return api;
  }
  const api={...create(),create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BoatDynamics=api;
})(typeof window!=='undefined'?window:globalThis);
