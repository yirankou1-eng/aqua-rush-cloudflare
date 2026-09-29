/* Room UI, network input and prediction; rendering stays in index.html. */
(function(root){
'use strict';
const COLORS=[0x1c7fd4,0xe03030,0xffa028,0x38c94f];
const CSS_COLORS=['#59b6ff','#ef6969','#ffb454','#6ddd8a'];
function mount(game){
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
  let ws=null,room=null,slot=0,token='',code='',engine=null,phase='menu',seq=0,ack=0,pending=[],states=[],accumulator=0;
  let connected=false,intentional=false,retryUntil=0,retryTimer=null,lastStateAt=0,ping=0,lastPing=0,ready=false;
  let keepAlive=null;
  let rendering=false,remaining=3.5,credentials=null,joinRequest=null;
  try{credentials=JSON.parse(sessionStorage.getItem('aqua-room')||'null');}catch{}
  const panel=document.createElement('div');panel.id='onlinePanel';panel.className='hidden';
  panel.innerHTML=`<section class="online-card" role="dialog" aria-modal="true" aria-labelledby="onlineTitle">
    <p class="online-eyebrow">AQUA RUSH · MULTIPLAYER</p><h2 id="onlineTitle">RACE TOGETHER</h2>
    <p id="onlineLocalHelp" class="hidden">Multiplayer needs the running game server. Start it, then <a id="onlineServerLink">open the multiplayer game</a>.</p>
    <div id="onlineEntry"><p>2–4 players · Short room codes · AI fills empty seats</p>
      <label for="onlineName">Your nickname</label><input id="onlineName" maxlength="16" placeholder="Enter your nickname" autocomplete="nickname">
      <p id="onlineMap"></p><div class="online-actions"><button id="createRoom" class="primary">Create room</button></div>
      <hr class="online-divider"><label for="joinCode">Room code</label><input id="joinCode" maxlength="6" placeholder="e.g. K7M4PX" autocapitalize="characters" autocomplete="off" spellcheck="false">
      <div class="online-actions"><button id="joinRoom" class="primary">Join room</button><button id="onlineBack">Back</button></div>
    </div>
    <div id="onlineLobby" class="hidden"><p id="roomMap"></p><div class="online-room-code" id="roomCode"></div><p>Share this six-character code with friends. The host can start when all players are ready.</p>
      <div id="roomSeats"></div><div class="online-actions"><button id="roomReady" class="primary">Ready</button><button id="roomStart">Start race</button><button id="roomLeave">Leave</button></div>
    </div><p class="online-message" id="onlineMessage" role="status" aria-live="polite"></p>
  </section>`;document.body.appendChild(panel);
  const badge=document.createElement('div');badge.id='onlineBadge';badge.className='hidden';badge.innerHTML='<span id="onlineCodeBadge"></span><button id="onlineExit">Leave race</button><span id="onlineConnection"></span>';document.body.appendChild(badge);
  const button=document.createElement('button');button.id='onlineBtn';button.textContent='MULTIPLAYER';$('startBtn').after(button);
  const message=text=>$('onlineMessage').textContent=text;
  const send=data=>{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
  const name=()=>($('onlineName').value.trim()||'').slice(0,16);
  try{$('onlineName').value=localStorage.getItem('aqua-name')||'';}catch{}
  const localFile=location.protocol==='file:';
  $('onlineServerLink').href='http://localhost:3210/?map='+encodeURIComponent(game.map.id);
  if(localFile){$('onlineLocalHelp').classList.remove('hidden');$('createRoom').disabled=$('joinRoom').disabled=true;}
  $('onlineMap').textContent='Room map: '+game.map.name+' (change it in the main menu)';
  function entry(){panel.classList.remove('hidden');$('onlineEntry').classList.remove('hidden');$('onlineLobby').classList.add('hidden');$('onlineTitle').textContent='RACE TOGETHER';message('');$('onlineName').focus();}
  button.onclick=()=>{entry();if(location.protocol==='file:')message('Use the link above to open http://localhost:3210 after starting the server.');};
  function busy(value){$('createRoom').disabled=$('joinRoom').disabled=value;}
  function connect(request){
    if(!['http:','https:'].includes(location.protocol)){message('Open http://localhost:3210 to create or join a room.');return;}
    joinRequest=request;busy(true);intentional=false;
    clearInterval(keepAlive);if(ws)ws.close();
    const route=request.type==='create'?'create=1':'room='+encodeURIComponent(request.code);
    ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/socket?'+route);
    const socket=ws;
    socket.onopen=()=>{if(socket!==ws)return;connected=true;send(joinRequest);keepAlive=setInterval(()=>send({type:'ping',time:Date.now()}),10000);};
    socket.onmessage=event=>{if(socket!==ws)return;let data;try{data=JSON.parse(event.data);}catch{return;}receive(data);};
    socket.onerror=()=>{};
    socket.onclose=()=>{
      if(socket!==ws)return;clearInterval(keepAlive);connected=false;busy(false);
      if(intentional)return;
      if(rendering&&code&&token){
        if(!retryUntil)retryUntil=Date.now()+15000;
        if(Date.now()<retryUntil){$('onlineConnection').textContent='Disconnected · AI is driving · Reconnecting…';retryTimer=setTimeout(()=>connect({type:'join',code,token,name:name()||'Player'}),1000);}
        else disconnected('Unable to reconnect. Leave and create a new room.');
      }else{room=null;entry();message('Connection lost. Check that the server is running, then create or join a room.');}
    };
  }
  function startRequest(type){if(!name()){message('Enter your nickname first.');$('onlineName').focus();return;}
    const joinCode=$('joinCode').value.trim().toUpperCase();if(type==='join'&&!/^[A-Z2-9]{6}$/.test(joinCode)){message('Enter a six-character room code.');return;}
    try{localStorage.setItem('aqua-name',name());}catch{}
    message('Connecting…');connect({type,name:name(),map:game.map.id,code:joinCode});
  }
  $('createRoom').onclick=()=>startRequest('create');$('joinRoom').onclick=()=>startRequest('join');
  $('joinCode').oninput=()=>{$('joinCode').value=$('joinCode').value.toUpperCase().replace(/[^A-Z2-9]/g,'');};
  $('onlineBack').onclick=()=>{intentional=true;if(ws)ws.close();panel.classList.add('hidden');try{sessionStorage.removeItem('aqua-room');}catch{}const url=new URL(location.href);url.searchParams.delete('room');history.replaceState(null,'',url);};
  function leave(){intentional=true;clearTimeout(retryTimer);send({type:'leave'});if(ws)ws.close();try{sessionStorage.removeItem('aqua-room');}catch{}location.href=location.pathname+'?map='+game.map.id;}
  $('roomLeave').onclick=leave;$('onlineExit').onclick=leave;
  $('roomReady').onclick=()=>send({type:'ready',ready:!ready});$('roomStart').onclick=()=>send({type:'start'});
  panel.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);if(!nodes.length)return;if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}});
  function lobby(){
    $('onlineEntry').classList.add('hidden');$('onlineLobby').classList.remove('hidden');$('onlineTitle').textContent='RACE LOBBY';
    $('roomCode').textContent=code;$('roomMap').textContent=game.map.name+' · '+game.map.laps+' laps';
    $('roomSeats').replaceChildren();
    room.seats.forEach(member=>{const row=document.createElement('div');row.className='online-seat';const dot=document.createElement('i');dot.style.background=CSS_COLORS[member.slot];const label=document.createElement('span');label.textContent=member.name+(member.slot===slot?' (You)':'')+(member.slot===room.host?' · Host':'');const state=document.createElement('small');state.textContent=member.bot?'AI racer':member.ready?'Ready':'Not ready';row.append(dot,label,state);$('roomSeats').appendChild(row);});
    ready=room.seats[slot].ready;$('roomReady').textContent=ready?'Not ready':'Ready';
    $('roomStart').hidden=room.host!==slot;$('roomStart').disabled=room.seats.filter(m=>!m.bot).length<2||room.seats.some(m=>!m.bot&&!m.ready);
    message(room.seats.filter(m=>!m.bot).length<2?'Waiting for at least one more player.':'AI fills empty seats. Ready up to race.');panel.classList.remove('hidden');
  }
  function disconnected(text){intentional=true;clearTimeout(retryTimer);$('onlineConnection').textContent=text;game.clearKeys();if(ws)ws.close();}
  function receive(data){
    if(data.type==='error'){busy(false);message(data.message);if(rendering)disconnected(data.message);return;}
    if(data.type==='closed'){disconnected(data.message);return;}
    if(data.type==='pong'){ping=Math.max(0,Date.now()-data.time);return;}
    if(data.type==='joined'){
      busy(false);retryUntil=0;slot=data.slot;token=data.token;code=data.code;
      try{sessionStorage.setItem('aqua-room',JSON.stringify({code,token,map:data.map,name:name()}));}catch{}
      if(data.map!==game.map.id){intentional=true;send({type:'leave'});ws.close();location.href=location.pathname+'?map='+encodeURIComponent(data.map)+'&room='+code;return;}
      const url=new URL(location.href);url.searchParams.set('room',code);history.replaceState(null,'',url);
      return;
    }
    if(data.type==='room'){
      room=data;phase=data.phase;
      if(phase==='lobby'){lobby();return;}
      if(!rendering){rendering=true;game.begin(slot,COLORS);engine=RaceCore.create(game.map.id);seq=0;pending=[];states=[];}
      panel.classList.add('hidden');badge.classList.remove('hidden');$('onlineCodeBadge').textContent='Room '+code+' · Boat '+(slot+1);
      if(phase==='finished')$('onlineConnection').textContent='Race complete · Leave to start a new room';
      return;
    }
    if(data.type==='state'&&engine){
      phase=data.phase;remaining=data.remaining;lastStateAt=performance.now();ack=data.ack;
      seq=Math.max(seq,ack);pending=pending.filter(item=>item.seq>ack);
      states.push(data.state);while(states.length>8)states.shift();
      engine.restore(data.state);
      if(phase==='racing')for(const item of pending)engine.step({[slot]:item.keys});else pending=[];
    }
  }
  function update(dt){
    if(!rendering||!engine)return;
    const now=performance.now();
    if(connected&&now-lastPing>2000){send({type:'ping',time:Date.now()});lastPing=now;}
    const stale=!lastStateAt||now-lastStateAt>1500;
    if(phase!=='finished'&&connected)$('onlineConnection').textContent=stale?'Waiting for the server…':(phase==='countdown'?'Starting race · ':document.hidden?'Window in background · ':'Connected · ')+Math.round(ping)+' ms';
    accumulator=Math.min(accumulator+dt,.2);
    while(accumulator>=RaceCore.DT){accumulator-=RaceCore.DT;
      if(phase==='racing'&&connected&&!stale){const input=game.input();const entry={seq:++seq,keys:input};pending.push(entry);if(pending.length>120){disconnected('Connection timed out. Leave and try again.');pending=[];break;}send({type:'input',seq,w:!!input.w,s:!!input.s,a:!!input.a,d:!!input.d});engine.step({[slot]:input});}
    }
    if(!states.length)return;
    const latest=states.at(-1),target=latest.time-.08+Math.min(.1,(now-lastStateAt)/1000);
    let a=states[0],b=latest;for(let i=1;i<states.length;i++){if(states[i].time>=target){a=states[i-1];b=states[i];break;}}
    const alpha=b.time===a.time?1:Math.max(0,Math.min(1,(target-a.time)/(b.time-a.time)));
    const predicted=engine.snapshot();
    game.render({latest,predicted,a,b,alpha,slot,phase,remaining,room,dt,colors:CSS_COLORS});
  }
  addEventListener('blur',()=>game.clearKeys());
  document.addEventListener('visibilitychange',()=>{if(document.hidden){game.clearKeys();if(rendering&&phase==='racing')send({type:'input',seq:++seq,w:false,s:false,a:false,d:false});}});
  const requested=params.get('room');
  if(requested){entry();$('joinCode').value=requested;
    if(credentials&&credentials.code===requested){$('onlineName').value=credentials.name||$('onlineName').value;connect({type:'join',code:requested,token:credentials.token,name:name()||'Player'});}
  }
  return {update,leave,get active(){return rendering;},get inRoom(){return !!room;},get panelOpen(){return !panel.classList.contains('hidden');}};
}
root.AquaOnline={mount};
})(window);
