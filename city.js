/* Neon City scenery. Buildings and tunnel shells never alter boat physics. */
(function(root){
  function overlaps(a,b,gap=.4){
    if(a.base+a.height<=b.base+.01||b.base+b.height<=a.base+.01)return false;
    const axes=b=>[[Math.cos(b.angle),-Math.sin(b.angle)],[Math.sin(b.angle),Math.cos(b.angle)]];
    const aa=axes(a),bb=axes(b),dx=b.x-a.x,dz=b.z-a.z;
    const radius=(b,axes,n)=>Math.abs(axes[0][0]*n[0]+axes[0][1]*n[1])*b.w/2+Math.abs(axes[1][0]*n[0]+axes[1][1]*n[1])*b.d/2;
    return [...aa,...bb].every(n=>Math.abs(dx*n[0]+dz*n[1])<radius(a,aa,n)+radius(b,bb,n)+gap);
  }
  function build(T,scene,course){
    const {curveAt,tangentAt,halfWidthAt,baseHeight,nearestDist,tunnels,curveLen}=course;
    let seed=14091;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    const blocks=[],tunnelInfo=[],palette=[0x39cddd,0xdf55ae,0xf2b05e,0x8c8cfc];
    const batches=palette.map(()=>[]),crowns=palette.map(()=>[]);
    const add=(x,y,z,w,h,d,angle,tint,tunnel=false)=>{
      const block={x,z,w,d,base:y,height:h,angle,tunnel};
      if(blocks.some(b=>overlaps(block,b)))return false;
      batches[tint].push({x,y:y+h/2,z,w,h,d,angle});
      blocks.push(block);
      // Architectural crown and two vertical sign bands, not track-edge lights.
      for(const side of [-1,1]){
        crowns[tint].push({x:x+Math.cos(angle)*side*w/2,y:y+h-2,z:z-Math.sin(angle)*side*w/2,w:.18,h:1.2,d,angle});
        crowns[tint].push({x:x+Math.sin(angle)*side*d/2,y:y+h-2,z:z+Math.cos(angle)*side*d/2,w,h:1.2,d:.18,angle});
      }
      if(h>170)crowns[tint].push({x:x+Math.sin(angle)*(d/2+.3),y:y+h*.66,z:z+Math.cos(angle)*(d/2+.3),w:1.4,h:h*.48,d:.35,angle});
    };
    // Dense, staggered city blocks on both sides of the entire circuit.
    for(let gx=-11;gx<=11;gx++)for(let gz=-11;gz<=11;gz++){
      const x=gx*126+(random()-.5)*22,z=gz*126+(random()-.5)*22;
      if(Math.hypot(x,z)>1590)continue;
      const w=48+random()*39,d=48+random()*39,radius=Math.hypot(w,d)/2;
      if(nearestDist(x,z)<80+radius+24)continue;
      let blocked=false;
      for(const tunnel of tunnels)for(let t=tunnel.start-.015;t<=tunnel.end+.015;t+=.008){
        const p=curveAt(t);if(Math.hypot(x-p.x,z-p.z)<halfWidthAt(t)*2.5+radius+20)blocked=true;
      }
      if(blocked)continue;
      const h=90+Math.pow(random(),.65)*290,tint=Math.floor(random()*4),angle=(random()-.5)*.16;
      const ground=baseHeight(x,z)+8;
      add(x,ground,z,w,h,d,angle,tint);
      if(random()>.55)add(x,ground+h,z,w*.58,22+random()*48,d*.58,angle,tint);
    }
    function facadeMaterial(color,index){
      const c=new T.Color(color),mat=new T.MeshStandardMaterial({color:0x182333,metalness:.4,roughness:.55});
      mat.onBeforeCompile=shader=>{
        shader.vertexShader='varying vec3 vFacade;varying vec3 vFaceNormal;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          #ifdef USE_INSTANCING
          vFacade=position*vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
          #else
          vFacade=position;
          #endif
          vFaceNormal=normal;`);
        shader.fragmentShader='varying vec3 vFacade;varying vec3 vFaceNormal;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
          vec2 facade=vec2(abs(vFaceNormal.z)>.5?vFacade.x:vFacade.z,vFacade.y);
          vec2 cell=facade/vec2(7.2,8.8),tile=fract(cell);
          float randomCell=fract(sin(dot(floor(cell),vec2(12.9898,78.233)))*43758.5453);
          vec2 aa=max(fwidth(cell),vec2(.002));
          float windowMask=smoothstep(.18-aa.x,.18+aa.x,tile.x)*(1.-smoothstep(.78-aa.x,.78+aa.x,tile.x))*smoothstep(.24-aa.y,.24+aa.y,tile.y)*(1.-smoothstep(.76-aa.y,.76+aa.y,tile.y))*(1.-step(.5,abs(vFaceNormal.y)));
          float resolved=1.-smoothstep(.3,.8,max(aa.x,aa.y));
          float lit=step(.62,randomCell)*windowMask*resolved;
          vec3 neon=vec3(${c.r.toFixed(5)},${c.g.toFixed(5)},${c.b.toFixed(5)});
          totalEmissiveRadiance+=mix(neon,vec3(1.,.72,.4),step(.86,randomCell))*lit*(.45+randomCell*.7);
          diffuseColor.rgb*=.6+windowMask*.4;`);
      };
      mat.customProgramCacheKey=()=> 'city-windows-'+index;
      return mat;
    }
    const facadeMats=palette.map(facadeMaterial);
    const concrete=new T.MeshStandardMaterial({color:0x46525e,roughness:.86,emissive:0x46525e,emissiveIntensity:.24,side:T.DoubleSide});
    const lining=new T.MeshStandardMaterial({color:0x819095,roughness:.9,emissive:0x819095,emissiveIntensity:.22,side:T.DoubleSide});
    lining.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec2 vBrickUV;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBrickUV=uv;');
      shader.fragmentShader='varying vec2 vBrickUV;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        vec2 brick=vec2(vBrickUV.x/3.4+mod(floor(vBrickUV.y/1.25),2.)*.5,vBrickUV.y/1.25);
        vec2 tile=fract(brick),aa=max(fwidth(brick),vec2(.004));
        float joint=smoothstep(.035-aa.x,.035+aa.x,min(tile.x,1.-tile.x))*smoothstep(.035-aa.y,.035+aa.y,min(tile.y,1.-tile.y));
        float variation=fract(sin(dot(floor(brick),vec2(12.98,78.23)))*43758.54);
        diffuseColor.rgb*=mix(.28,.82+variation*.18,joint);`);
    };
    const curbMat=new T.MeshStandardMaterial({color:0xadb1ab,roughness:.95,emissive:0xadb1ab,emissiveIntensity:.15,side:T.DoubleSide});
    curbMat.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vPaving;varying vec3 vPavingNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPaving=position;vPavingNormal=normal;');
      shader.fragmentShader='varying vec3 vPaving;varying vec3 vPavingNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        vec2 pavingPlane=abs(vPavingNormal.y)>.5?vPaving.xz:vec2(vPaving.x+vPaving.z,vPaving.y);
        vec2 brick=pavingPlane/vec2(2.8,1.4);brick.x+=mod(floor(brick.y),2.)*.5;
        vec2 f=fract(brick),aa=max(fwidth(brick),vec2(.002));
        float joint=smoothstep(.025-aa.x,.025+aa.x,min(f.x,1.-f.x))*smoothstep(.04-aa.y,.04+aa.y,min(f.y,1.-f.y));
        float grain=fract(sin(dot(floor(brick),vec2(13.17,79.3)))*41235.7);
        diffuseColor.rgb*=mix(.32,.8+grain*.2,joint);`);
    };
    const curbEdgeMat=new T.MeshStandardMaterial({color:0xe4b83e,roughness:.85,emissive:0xe4b83e,emissiveIntensity:.12,side:T.DoubleSide});
    const lightMat=new T.MeshBasicMaterial({color:0xb7ccd2,side:T.DoubleSide});
    const portalMat=new T.MeshStandardMaterial({color:0xc9b36b,roughness:.7,emissive:0xc9b36b,emissiveIntensity:.25});
    function box(w,h,d,mat,x,y,z,angle=0,parent=scene){
      const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.y=angle;parent.add(m);return m;
    }
    for(const tunnel of tunnels){
      const group=new T.Group();group.name='building-tunnel-'+tunnel.id;scene.add(group);
      const exterior=facadeMaterial(palette[tunnel.id==='long'?0:2],'podium-'+tunnel.id);exterior.side=T.DoubleSide;
      const length=(tunnel.end-tunnel.start)*curveLen,steps=Math.ceil(length/4);
      let high=-Infinity;
      for(let i=0;i<=steps;i++){const p=curveAt(tunnel.start+(tunnel.end-tunnel.start)*i/steps);high=Math.max(high,p.y);}
      const spring=high+10,roof=spring+tunnel.halfWidth;
      const ceilingAt=lat=>spring+Math.sqrt(Math.max(0,tunnel.halfWidth*tunnel.halfWidth-lat*lat));
      function ribbon(name,edgeA,edgeB,mat){
        const pos=[],idx=[],uv=[],samples=[...new Set([...Array.from({length:steps+1},(_,i)=>i/steps),2/length,1-2/length])].sort((a,b)=>a-b);
        for(let i=0;i<samples.length;i++){
          const u=samples[i],t=tunnel.start+(tunnel.end-tunnel.start)*u,p=curveAt(t),tan=tangentAt(t),w=halfWidthAt(t);
          for(const edge of [edgeA,edgeB]){
            const [lat,y]=edge(w,p,u);pos.push(p.x-tan.z*lat,y,p.z+tan.x*lat);uv.push(u*length,y-spring);
          }
          if(i<samples.length-1){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
        }
        const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
        const mesh=new T.Mesh(geo,mat);mesh.name=name;group.add(mesh);
      }
      // A true semicircle above short vertical spring walls, following the canal bend.
      const arcPos=[],arcUV=[],arcIndex=[],rings=36;
      for(let i=0;i<=steps;i++){
        const t=tunnel.start+(tunnel.end-tunnel.start)*i/steps,p=curveAt(t),tan=tangentAt(t),w=halfWidthAt(t);
        for(let j=0;j<=rings;j++){
          const a=j/rings*Math.PI,lat=Math.cos(a)*w;
          arcPos.push(p.x-tan.z*lat,spring+Math.sin(a)*w,p.z+tan.x*lat);arcUV.push(i/steps*length,a*w);
          if(i<steps&&j<rings){const k=i*(rings+1)+j,n=k+rings+1;arcIndex.push(k,n,k+1,k+1,n,n+1);}
        }
      }
      const arcGeo=new T.BufferGeometry();arcGeo.setAttribute('position',new T.Float32BufferAttribute(arcPos,3));arcGeo.setAttribute('uv',new T.Float32BufferAttribute(arcUV,2));arcGeo.setIndex(arcIndex);arcGeo.computeVertexNormals();
      const arch=new T.Mesh(arcGeo,lining);arch.name='tunnel-ceiling';group.add(arch);
      ribbon('tower-foundation-roof',w=>[-w*2.5,roof+8],w=>[w*2.5,roof+8],exterior);
      for(const side of [-1,1]){
        ribbon('tunnel-inner-wall',(w,p)=>[side*w,p.y-9],w=>[side*w,spring],lining);
        ribbon('tunnel-outer-wall',(w,p)=>[side*w*2.5,p.y-9],w=>[side*w*2.5,roof+8],exterior);
        const curbWidth=u=>4.5+Math.min(1,u*length/2,(1-u)*length/2);
        const inner=(w,p,u)=>[side*(w-.05-curbWidth(u)),p.y+1.8];
        ribbon('tunnel-curb-top',inner,(w,p,u)=>[side*(w-.05),p.y+1.8],curbMat);
        ribbon('tunnel-curb-face',(w,p,u)=>[side*(w-.05-curbWidth(u)),p.y-3],inner,curbMat);
        ribbon('tunnel-curb-yellow-edge',(w,p,u)=>[side*(w-.05-curbWidth(u)+.05),p.y+1.825],(w,p,u)=>[side*(w-.05-curbWidth(u)+.55),p.y+1.825],curbEdgeMat);
        for(const progress of [tunnel.start,tunnel.end]){
          const p=curveAt(progress),tan=tangentAt(progress),w=halfWidthAt(progress),pos=[];
          for(const [lat,y] of [[side*(w-.05-4.5),p.y-3],[side*(w-.05),p.y-3],[side*(w-.05),p.y+1.8],[side*(w-.05-4.5),p.y+1.8]])pos.push(p.x-tan.z*lat,y,p.z+tan.x*lat);
          const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();
          const cap=new T.Mesh(geo,curbMat);cap.name='tunnel-curb-end';group.add(cap);
        }
        const angle=side<0?Math.PI*.24:Math.PI*.76;
        ribbon('tunnel-ceiling-light',w=>[w*Math.cos(angle-.01),spring+w*Math.sin(angle-.01)-.18],w=>[w*Math.cos(angle+.01),spring+w*Math.sin(angle+.01)-.18],lightMat);
      }
      // Solid overhead blocks rise directly from the shell: the water runs through their lower floors.
      const spans=Math.ceil(length/58);
      for(let i=0;i<spans;i++){
        const t=tunnel.start+(i+.5)/spans*(tunnel.end-tunnel.start),p=curveAt(t),tan=tangentAt(t),angle=Math.atan2(tan.x,tan.z);
        add(p.x,roof+7,p.z,5*halfWidthAt(t),120+random()*150,length/spans+14,angle,i%4,true);
      }
      // Wide solid facades have a genuine arched opening, not a rectangular frame.
      for(const t of [tunnel.start,tunnel.end]){
        const p=curveAt(t),tan=tangentAt(t),angle=Math.atan2(tan.x,tan.z),w=halfWidthAt(t),bottom=p.y-9;
        const shape=new T.Shape();shape.moveTo(-w*2.5,bottom);shape.lineTo(-w-1,bottom);shape.lineTo(-w-1,spring);
        for(let j=0;j<=48;j++){const a=Math.PI-j/48*Math.PI;shape.lineTo(Math.cos(a)*(w+1),spring+Math.sin(a)*(w+1));}
        shape.lineTo(w+1,bottom);shape.lineTo(w*2.5,bottom);shape.lineTo(w*2.5,roof+8);shape.lineTo(-w*2.5,roof+8);shape.closePath();
        const facade=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:2,bevelEnabled:false}),exterior);facade.name='tunnel-building-facade';facade.position.set(p.x,0,p.z);facade.rotation.y=angle;group.add(facade);
        const ring=new T.Shape();
        for(let j=0;j<=48;j++){const a=j/48*Math.PI;const x=Math.cos(a)*(w+1.8),y=spring+Math.sin(a)*(w+1.8);if(!j)ring.moveTo(x,y);else ring.lineTo(x,y);}
        for(let j=48;j>=0;j--){const a=j/48*Math.PI;ring.lineTo(Math.cos(a)*(w+.4),spring+Math.sin(a)*(w+.4));}ring.closePath();
        const trim=new T.Mesh(new T.ExtrudeGeometry(ring,{depth:3,bevelEnabled:false}),portalMat);trim.position.set(p.x-tan.x*.5,0,p.z-tan.z*.5);trim.rotation.y=angle;group.add(trim);
      }
      tunnelInfo.push({...tunnel,length,roof,spring,ceilingAt,buildingWidth:5*tunnel.halfWidth,group,minClearance:spring-high});
    }
    // Procedural lit windows keep the skyline detailed with a small number of draw calls.
    const geo=new T.BoxGeometry(1,1,1),matrix=new T.Matrix4(),q=new T.Quaternion(),axis=new T.Vector3(0,1,0);
    function instances(list,mat,name){
      if(!list.length)return;
      const mesh=new T.InstancedMesh(geo,mat,list.length);mesh.name=name;
      list.forEach((b,i)=>{q.setFromEuler(new T.Euler(0,b.angle,b.tilt||0,'YXZ'));matrix.compose(new T.Vector3(b.x,b.y,b.z),q,new T.Vector3(b.w,b.h,b.d));mesh.setMatrixAt(i,matrix);});
      mesh.instanceMatrix.needsUpdate=true;scene.add(mesh);
    }
    palette.forEach((color,index)=>{
      const mat=facadeMats[index];
      instances(batches[index],mat,'city-towers-'+index);
      const signMat=new T.MeshStandardMaterial({color:0x293440,emissive:color,emissiveIntensity:1.6,roughness:.4});
      signMat.onBeforeCompile=shader=>{
        shader.vertexShader='varying float vSignVertical;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSignVertical=1.-step(.5,abs(normal.y));');
        shader.fragmentShader='varying float vSignVertical;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=vSignVertical;');
      };
      instances(crowns[index],signMat,'city-signs-'+index);
    });
    // Paired streetlights along the entire outdoor course, with six nearby lights active.
    const streetlights=[],posts=[],heads=[],bulbs=[],count=Math.ceil(curveLen/72);
    for(let i=0;i<count;i++){
      const progress=i/count;
      if(tunnels.some(t=>progress>t.start-.012&&progress<t.end+.012))continue;
      const p=curveAt(progress),tan=tangentAt(progress),angle=Math.atan2(tan.x,tan.z);
      for(const side of [-1,1]){
        const lane=side*(halfWidthAt(progress)+5),x=p.x-tan.z*lane,z=p.z+tan.x*lane,y=baseHeight(x,z)+8;
        const footprint={x,z,base:y,height:33,w:3,d:3,angle};
        if(blocks.some(b=>overlaps(footprint,b,2)))continue;
        posts.push({x,y:y+15,z,w:.65,h:30,d:.55,angle});
        heads.push({x:x+tan.z*side*4,y:y+30,z:z-tan.x*side*4,w:8.8,h:.4,d:1.2,angle});
        const position=new T.Vector3(x+tan.z*side*8,y+29.7,z-tan.x*side*8);
        bulbs.push({x:position.x,y:position.y,z:position.z,w:2.8,h:.16,d:1,angle,tilt:side*.45});
        const target=new T.Vector3(p.x-tan.z*side*(halfWidthAt(progress)-24),p.y,p.z+tan.x*side*(halfWidthAt(progress)-24));
        streetlights.push({progress,side,position,target,direction:target.clone().sub(position).normalize(),base:y});
      }
    }
    instances(posts,new T.MeshStandardMaterial({color:0x465367,metalness:.6,roughness:.4}),'streetlight-posts');
    instances(heads,new T.MeshStandardMaterial({color:0x26303e,metalness:.5,roughness:.5}),'streetlight-heads');
    const lampHousing=new T.MeshStandardMaterial({color:0x303c49,roughness:.5});
    const lampEmitter=new T.MeshBasicMaterial({color:new T.Color(0xffe8bc).multiplyScalar(2.4)});
    instances(bulbs,[lampHousing,lampHousing,lampHousing,lampEmitter,lampHousing,lampHousing],'streetlight-leds');
    // A static spatial light table covers the whole course, independent of the player.
    // Each water fragment reads only lights that can reach its 96 m cell.
    const cellSize=96,reach=115;
    const origin=new T.Vector2(Math.floor((Math.min(...streetlights.map(l=>l.position.x))-reach)/cellSize)*cellSize,Math.floor((Math.min(...streetlights.map(l=>l.position.z))-reach)/cellSize)*cellSize);
    const columns=Math.ceil((Math.max(...streetlights.map(l=>l.position.x))+reach-origin.x)/cellSize),rows=Math.ceil((Math.max(...streetlights.map(l=>l.position.z))+reach-origin.y)/cellSize);
    const cells=Array.from({length:columns*rows},()=>[]);
    streetlights.forEach((lamp,index)=>{
      const a=Math.max(0,Math.floor((lamp.position.x-reach-origin.x)/cellSize)),b=Math.min(columns-1,Math.floor((lamp.position.x+reach-origin.x)/cellSize));
      const c=Math.max(0,Math.floor((lamp.position.z-reach-origin.y)/cellSize)),d=Math.min(rows-1,Math.floor((lamp.position.z+reach-origin.y)/cellSize));
      for(let z=c;z<=d;z++)for(let x=a;x<=b;x++)cells[z*columns+x].push(index);
    });
    const slots=Math.max(1,...cells.map(c=>c.length)),data=new Float32Array(slots*2*cells.length*4);
    if(slots>32)throw new Error('Water light grid exceeds shader capacity');
    cells.forEach((indices,row)=>indices.forEach((index,slot)=>{
      const lamp=streetlights[index],offset=(row*slots*2+slot*2)*4;
      data.set([...lamp.position.toArray(),1,...lamp.direction.toArray(),0],offset);
    }));
    const texture=new T.DataTexture(data,slots*2,cells.length,T.RGBAFormat,T.FloatType);
    texture.minFilter=texture.magFilter=T.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
    const waterLighting={texture,origin,cellSize,columns,rows,slots,cells};
    const localLights=Array.from({length:6},()=>{
      const light=new T.SpotLight(0xffe8bc,4,115,.62,.65,1);scene.add(light,light.target);return light;
    });
    const drones=createDrones(T,scene,course,blocks);
    function update(time,boats=[]){
      drones.update(time,boats);
      const at=boats[0]?.position||curveAt(0),nearest=streetlights.slice().sort((a,b)=>a.position.distanceToSquared(at)-b.position.distanceToSquared(at));
      localLights.forEach((light,i)=>{
        light.visible=!!nearest[i];if(!nearest[i])return;
        light.position.copy(nearest[i].position);light.target.position.copy(nearest[i].target);
      });
    }
    update(0);
    return {blocks,tunnels:tunnelInfo,streetlights,waterLighting,drones:drones.items,update};
  }
  function createDrones(T,scene,course,blocks){
    const {curveAt,tangentAt,halfWidthAt,tunnels,curveLen}=course,items=[];
    const bodyMat=new T.MeshStandardMaterial({color:0xc1c7ca,metalness:.45,roughness:.4,emissive:0xc1c7ca,emissiveIntensity:.23});
    const darkMat=new T.MeshStandardMaterial({color:0x2b3239,roughness:.5,emissive:0x2b3239,emissiveIntensity:.18});
    const red=new T.MeshBasicMaterial({color:new T.Color(0xff263b).multiplyScalar(3.5)}),green=new T.MeshBasicMaterial({color:new T.Color(0x26ff89).multiplyScalar(3.5)});
    const blurMat=new T.MeshBasicMaterial({color:0xb5c4cc,transparent:true,opacity:.12,side:T.DoubleSide,depthWrite:false});
    const armGeo=new T.BoxGeometry(.14,.13,4.8),bodyGeo=new T.BoxGeometry(1.4,.48,1.8),hubGeo=new T.CylinderGeometry(.18,.22,.3,8),bladeGeo=new T.BoxGeometry(1.85,.035,.14),diskGeo=new T.CircleGeometry(.98,20),lampGeo=new T.SphereGeometry(.24,8,6);
    for(const [i,anchor] of [.035,.11,.21,.25,.455,.53,.61,.68,.865,.96].entries()){
      if(tunnels.some(s=>anchor>s.start-.03&&anchor<s.end+.03))continue;
      const group=new T.Group();group.name='decorative-quadcopter';scene.add(group);
      const body=new T.Mesh(bodyGeo,bodyMat);group.add(body);
      for(const angle of [Math.PI/4,-Math.PI/4]){const arm=new T.Mesh(armGeo,darkMat);arm.rotation.y=angle;group.add(arm);}
      const rotors=[];
      for(const x of [-1.65,1.65])for(const z of [-1.65,1.65]){
        const rotor=new T.Group();rotor.position.set(x,.28,z);group.add(rotor);rotors.push(rotor);
        rotor.add(new T.Mesh(hubGeo,darkMat));
        for(const angle of [0,Math.PI/2]){const blade=new T.Mesh(bladeGeo,bodyMat);blade.position.y=.17;blade.rotation.y=angle;rotor.add(blade);}
        const disk=new T.Mesh(diskGeo,blurMat);disk.rotation.x=-Math.PI/2;disk.position.y=.18;rotor.add(disk);

      }
      for(const x of [-1.45,1.45]){
        const lamp=new T.Mesh(lampGeo,i%2?green:red);lamp.name='drone-status-light';lamp.position.set(x,-.05,0);group.add(lamp);
      }
      const lens=new T.Mesh(new T.SphereGeometry(.22,8,6),darkMat);lens.position.set(0,-.3,.7);group.add(lens);
      const lower=Math.max(-.025,...tunnels.filter(s=>s.end<anchor).map(s=>s.end+.025));
      const upper=Math.min(1.025,...tunnels.filter(s=>s.start>anchor).map(s=>s.start-.025));
      items.push({group,rotors,anchor,phase:i*1.93,lower,upper,progress:anchor,lane:0,height:40,nextChoice:0,mode:'patrol',velocity:new T.Vector3()});
    }
    // Share draw calls across the fleet while keeping each rotor's independent transform.
    const batches=new Map();
    for(const drone of items)drone.group.traverse(part=>{
      if(!part.isMesh)return;
      const key=part.geometry.uuid+part.material.uuid;
      if(!batches.has(key))batches.set(key,{geometry:part.geometry,material:part.material,parts:[]});
      batches.get(key).parts.push(part);part.visible=false;
    });
    for(const batch of batches.values()){
      batch.mesh=new T.InstancedMesh(batch.geometry,batch.material,batch.parts.length);
      batch.mesh.name='drone-fleet-parts';batch.mesh.frustumCulled=false;
      batch.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);scene.add(batch.mesh);
    }
    let previousTime=null,seed=71821;
    const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    function clearOfBuildings(p){
      return !blocks.some(b=>{
        if(p.y<b.base-5||p.y>b.base+b.height+5)return false;
        const dx=p.x-b.x,dz=p.z-b.z,c=Math.cos(b.angle),s=Math.sin(b.angle);
        return Math.abs(dx*c-dz*s)<b.w/2+5&&Math.abs(dx*s+dz*c)<b.d/2+5;
      });
    }
    function update(time,boats=[]){
      const dt=previousTime===null||time<previousTime?0:Math.min(.1,time-previousTime);previousTime=time;
      for(const drone of items){
        const nearby=boats.filter(b=>b.progress>drone.lower&&b.progress<drone.upper&&Math.abs(b.progress-drone.progress)<.12);
        if(time>=drone.nextChoice){
          const choice=random();drone.mode=nearby.length&&choice<.45?'follow':choice<.78?'dive':'patrol';
          drone.targetIndex=boats.indexOf(nearby.includes(boats[0])&&random()<.7?boats[0]:nearby[Math.floor(random()*nearby.length)]);drone.side=random()<.5?-1:1;
          drone.goal=clamp(drone.progress+(random()-.5)*.06,drone.lower,drone.upper);
          drone.goalLane=(random()-.5)*2*(halfWidthAt(drone.goal)+50);
          drone.goalHeight=30+random()*48;drone.began=time;drone.duration=7+random()*5;drone.nextChoice=time+drone.duration;
        }
        let progress=drone.goal,lane=drone.goalLane,height=drone.goalHeight;
        // Track a live boat, including its jump height, rather than a stored snapshot.
        const boat=boats[drone.targetIndex];
        if(drone.mode==='follow'&&boat&&boat.progress>drone.lower&&boat.progress<drone.upper){
          progress=clamp(boat.progress+34/curveLen,drone.lower,drone.upper);
          const p=curveAt(boat.progress),tan=tangentAt(boat.progress);
          lane=-(boat.position.x-p.x)*tan.z+(boat.position.z-p.z)*tan.x+drone.side*7;
          height=Math.max(7,boat.position.y-p.y+10)+1.2*Math.sin(time*.7+drone.phase);
        }else if(drone.mode==='dive'){
          const u=clamp((time-drone.began)/drone.duration,0,1);
          height=7+58*Math.pow(Math.abs(2*u-1),1.5);
        }
        const following=drone.mode==='follow'&&boat&&boat.progress>drone.lower&&boat.progress<drone.upper;
        const speed=following?Math.max(28,(boat.speed||0)+16):24;
        const nextProgress=clamp(drone.progress+clamp((progress-drone.progress)*1.4,-speed*dt/curveLen,speed*dt/curveLen),drone.lower,drone.upper);
        const nextLane=drone.lane+clamp(lane-drone.lane,-13*dt,13*dt);
        const w=halfWidthAt(nextProgress),p=curveAt(nextProgress),tan=tangentAt(nextProgress);
        // Rise over the canal wall before leaving the water; keep low passes above boat roofs.
        height=Math.max(height,Math.abs(nextLane)>w-10?22:7);
        const nextHeight=Math.max(Math.abs(nextLane)>w-10?22:7,drone.height+clamp(height-drone.height,-10*dt,9*dt));
        const next=new T.Vector3(p.x-tan.z*nextLane,p.y+nextHeight,p.z+tan.x*nextLane);
        if(clearOfBuildings(next)){
          const old=drone.group.position.clone();drone.group.position.copy(next);
          if(dt>0)drone.velocity.lerp(next.clone().sub(old).multiplyScalar(1/dt),1-Math.exp(-8*dt));
          drone.progress=nextProgress;drone.lane=nextLane;drone.height=nextHeight;
        }else{drone.nextChoice=0;drone.goalLane=0;}
        const v=drone.velocity;
        drone.group.rotation.set(clamp(-v.y*.009,-.5,.5),v.lengthSq()>1?Math.atan2(v.x,v.z):Math.atan2(tan.x,tan.z),.10*Math.sin(time*.8+drone.phase),'YXZ');
        drone.rotors.forEach((rotor,i)=>rotor.rotation.y=time*(i%2?180:-180)+drone.phase);
        drone.group.updateMatrixWorld(true);
      }
      for(const batch of batches.values()){
        batch.parts.forEach((part,i)=>batch.mesh.setMatrixAt(i,part.matrixWorld));batch.mesh.instanceMatrix.needsUpdate=true;
      }
    }
    update(0);return {items,update};
  }
  const api={build,overlaps};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityScenery=api;
})(typeof window!=='undefined'?window:globalThis);
