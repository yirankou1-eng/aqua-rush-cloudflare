/* Map geometry is shared by the playable course and its selection preview. */
(function(root){
  const maps=[
    {id:'classic',name:'Classic',laps:2,night:false,scenery:true,channel:{}},
    {id:'neon-city',name:'Neon City',laps:3,night:true,scenery:false,tunnels:[{id:'long',start:.30,end:.39,halfWidth:43},{id:'short',start:.78,end:.815,halfWidth:38}],channel:{wide:72,narrowA:25,narrowB:32,startFlare:8}},
    {id:'playground',name:'Playground',laps:2,night:false,scenery:true,bridges:false,aiSpeeds:[49,55,59],channel:{}}
  ];
  function get(id){return maps.find(m=>m.id===id)||maps[0];}
  function curve(THREE,id){
    const map=get(id),neon=map.id==='neon-city',playground=map.id==='playground',pts=[];
    // Unequal bend spacing and alternating broad/short turns, without repeated lobes.
    if(playground){
      const outline=[[880,0],[880,250],[700,430],[420,450],[240,620],[0,850],[-290,860],[-510,660],[-600,340],[-820,120],[-920,-140],[-820,-440],[-510,-560],[-220,-500],[80,-650],[360,-840],[660,-760],[740,-460],[700,-200]];
      for(const [x,z] of outline)pts.push(new THREE.Vector3(x,0,z));
    }else for(let i=0;i<20;i++){
      const a=i/20*Math.PI*2;
      const r=700*(neon?1+.23*Math.cos(3*a+.4)+.06*Math.sin(2*a):1+.16*Math.sin(2*a+1.3)+.09*Math.sin(5*a+4.1)+.05*Math.cos(3*a));
      pts.push(new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r));
    }
    let result=new THREE.CatmullRomCurve3(pts,true,'catmullrom',.6);
    if(neon||playground){
      const scale=curve(THREE,'classic').getLength()*(playground?1.1:.8)/result.getLength();
      pts.forEach(p=>p.multiplyScalar(scale));
      result=new THREE.CatmullRomCurve3(pts,true,'catmullrom',.6);
    }
    return result;
  }
  function channel(THREE,id){
    const map=get(id),c=curve(THREE,id);
    const angle=t=>{const p=c.getPointAt(t);return (Math.atan2(p.z,p.x)+Math.PI*2)%(Math.PI*2);};
    return {...map.channel,tunnels:(map.tunnels||[]).map(t=>({start:angle(t.start),end:angle(t.end),width:t.halfWidth,blend:.10}))};
  }
  const api={maps,get,curve,channel};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MapCatalog=api;
})(typeof window!=='undefined'?window:globalThis);
