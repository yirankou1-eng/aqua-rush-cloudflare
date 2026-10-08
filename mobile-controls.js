/* Touch and tilt input. Sensor/fullscreen requests only run after an explicit gesture. */
(function(root){
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function screenTilt(beta,gamma,angle){
  if(![beta,gamma,angle].every(Number.isFinite))return null;
  const r=Math.PI/180,b=beta*r,g=gamma*r,a=angle*r;
  return Math.asin(clamp(Math.sin(g)*Math.cos(b)*Math.cos(a)+Math.sin(b)*Math.sin(a),-1,1))/r;
}
function tiltSteering(value,neutral){const d=value-neutral,amount=clamp((Math.abs(d)-3)/22,0,1);return amount===0?0:-Math.sign(d)*Math.pow(amount,1.15);}
function createInput(){
  const pointers=new Map();let neutral=null,raw=null,sampleAt=-Infinity,filtered=0,updatedAt=null;
  return {
    press(id,key){pointers.set(id,key);},release(id){pointers.delete(id);},
    clear(){pointers.clear();filtered=0;updatedAt=null;},
    calibrate(){neutral=raw;filtered=0;},resetOrientation(){neutral=raw=null;sampleAt=-Infinity;filtered=0;pointers.clear();},
    sample(beta,gamma,angle,now){const value=screenTilt(beta,gamma,angle);if(value===null)return false;raw=value;sampleAt=now;if(neutral===null)neutral=value;return true;},
    active(now){return raw!==null&&now-sampleAt<1000;},
    read(now,tiltEnabled){const keys=new Set(pointers.values()),dt=updatedAt===null?1/60:clamp((now-updatedAt)/1000,0,.1);updatedAt=now;
      const target=tiltEnabled&&this.active(now)?tiltSteering(raw,neutral):0;filtered+=(target-filtered)*(1-Math.exp(-dt/.09));
      let steer=keys.has('left')===keys.has('right')?filtered:keys.has('left')?1:-1;
      if(!tiltEnabled||!this.active(now)){filtered=0;if(!keys.has('left')&&!keys.has('right'))steer=0;}
      return {w:keys.has('forward')&&!keys.has('reverse'),s:keys.has('reverse'),steer:Math.round(steer*50)/50};
    }
  };
}
function mount(game){
  const $=id=>document.getElementById(id),input=createInput();
  const autoMobile=()=>navigator.maxTouchPoints>0&&(matchMedia('(pointer: coarse)').matches||Math.min(innerWidth,innerHeight)<600);
  let mode='auto',mobile=false,tiltEnabled=false,permissionPending=false,requestId=0,panelOpen=false,driving=false,wasBlocked=false,lastTiltActive=null,pendingPlay=null,setupDone=false,noticeUntil=0;
  try{const saved=localStorage.getItem('aqua-input-mode');if(['auto','desktop','mobile'].includes(saved))mode=saved;}catch{}
  const opener=document.createElement('button');opener.id='controlsOpen';opener.type='button';$('startBtn').before(opener);
  const ui=document.createElement('div');ui.id='mobileUI';ui.innerHTML=`
    <div id="controlPanel" class="hidden"><section class="control-card" role="dialog" aria-modal="true" aria-labelledby="controlTitle">
      <h2 id="controlTitle" tabindex="-1">DRIVING SETTINGS</h2><p>Choose keyboard or phone controls. You can change these settings during a race.</p><div class="input-modes" aria-label="Control mode"><button id="modeAuto" type="button">AUTO</button><button id="modeDesktop" type="button">DESKTOP</button><button id="modeMobile" type="button">MOBILE</button></div>
      <p id="modeDescription"></p><div id="mobileOptions"><p>Hold your phone sideways. Tilt left or right to steer. More tilt gives stronger steering.</p>
      <div class="control-actions"><button id="enableMobile" type="button">ENABLE TILT & FULLSCREEN</button><button id="enterFullscreen" type="button">FULLSCREEN</button><button id="calibrateTilt" type="button">CENTER STEERING</button></div>
      <p id="tiltStatus" role="status">Tilt is off. Touch steering is available.</p><p id="fullscreenStatus" role="status"></p>
      <details id="fullscreenHelp"><summary>Browser bars still visible? Show help</summary><p id="installHelp">If browser bars remain: use your browser's “Add to Home Screen” option, then launch the game from its icon. On iPhone, use Safari → Share → Add to Home Screen, and enable “Open as Web App” if offered.</p></details>
      </div><div class="control-footer"><button id="closeControls" type="button">SAVE & RETURN</button><button id="cancelSetup" class="hidden" type="button">BACK TO MAPS</button></div></section></div>
    <div id="touchDrive" class="hidden" aria-label="Touch driving controls"><div id="touchSteering"><button data-drive="left" aria-label="Steer left">◀</button><button data-drive="right" aria-label="Steer right">▶</button></div><div id="touchPedals"><button data-drive="forward" aria-label="Accelerate"><span>▲</span>FORWARD</button><button data-drive="reverse" aria-label="Brake and reverse"><span>▼</span>BRAKE / REVERSE</button></div></div>
    <div id="mobileTools" class="hidden"><button id="openMobileControls" type="button">DRIVING SETTINGS</button><button id="quickCenter" type="button">RECENTER TILT</button></div>
    <p id="controlNotice" role="status" class="hidden"></p><p id="rotateHint" class="hidden">Rotate your phone for landscape play.</p>`;
  document.body.appendChild(ui);
  const now=()=>performance.now();
  const angle=()=>screen.orientation?.angle??(typeof window.orientation==='number'?window.orientation:0);
  function clear(){input.clear();game.clearKeys();for(const b of ui.querySelectorAll('[data-drive]'))b.classList.remove('pressed');}
  function showPanel(value){panelOpen=value;clear();game.panelChanged?.(value);$('controlPanel').classList.toggle('hidden',!value);if(value){$('closeControls').textContent=pendingPlay?'CONTINUE':'SAVE & RETURN';$('cancelSetup').classList.toggle('hidden',!pendingPlay);$('controlTitle').focus();}else $('openMobileControls').focus();}
  function applyMode(value){mode=value;mobile=value==='mobile'||value==='auto'&&autoMobile();clear();requestId++;
    if(!mobile){tiltEnabled=false;window.removeEventListener('deviceorientation',onTilt);input.resetOrientation();}
    document.body.classList.toggle('mobile-mode',mobile);
    for(const [id,v] of [['modeAuto','auto'],['modeDesktop','desktop'],['modeMobile','mobile']])$(id).setAttribute('aria-pressed',String(v===mode));
    if(!$('startBtn').classList.contains('hidden'))$('ovSub').textContent=mobile?'Tilt to steer · Hold FORWARD to accelerate · BRAKE / REVERSE to slow down':'W / ↑ throttle · S / ↓ brake · A D / ← → steer';
    opener.textContent='DRIVING SETTINGS · '+(mode==='auto'?'AUTO ('+(mobile?'MOBILE':'DESKTOP')+')':mode.toUpperCase());
    $('modeDescription').textContent=mobile?'Mobile controls selected.':'Keyboard: W/↑ accelerate · S/↓ brake and reverse · A/D steer.';
    $('mobileOptions').classList.toggle('hidden',!mobile);
    try{localStorage.setItem('aqua-input-mode',mode);}catch{}
  }
  function onTilt(event){if(!mobile||!tiltEnabled)return;input.sample(event.beta,event.gamma,angle(),now());}
  function calibrate(){if(!tiltEnabled||!input.active(now()))return;input.calibrate();noticeUntil=now()+3000;$('controlNotice').textContent='Tilt centered — this angle is now straight ahead.';$('controlNotice').classList.remove('hidden');$('tiltStatus').textContent='Steering centered. This phone angle is now straight ahead.';}
  function fullscreen(){
    if(document.fullscreenElement||navigator.standalone||matchMedia('(display-mode: standalone)').matches){$('fullscreenStatus').textContent='App view is active.';return Promise.resolve();}
    const target=document.documentElement,request=target.requestFullscreen||target.webkitRequestFullscreen;
    if(!request){$('fullscreenStatus').textContent='Fullscreen is unavailable in this browser. See the Home Screen option below.';return Promise.resolve();}
    let result;try{result=request.call(target,{navigationUI:'hide'});}catch(e){result=Promise.reject(e);}
    return Promise.resolve(result).then(async()=>{
      $('fullscreenStatus').textContent='Fullscreen enabled.';
      try{await screen.orientation?.lock?.('landscape');}catch{$('fullscreenStatus').textContent='Fullscreen enabled. Rotate your phone sideways if needed.';}
    },()=>{$('fullscreenStatus').textContent='Fullscreen was not enabled. Try FULLSCREEN again, or use the Home Screen option below.';});
  }
  function enable(){
    if(permissionPending)return;
    if(!mobile)applyMode('mobile');
    const id=++requestId;clear();input.resetOrientation();tiltEnabled=false;permissionPending=true;$('enableMobile').disabled=true;
    // Start both requests in the click handler, before any await consumes user activation.
    let permission;
    if(!window.isSecureContext){permission=Promise.reject(Error('Use the HTTPS game address to enable tilt.'));}
    else if(!window.DeviceOrientationEvent){permission=Promise.reject(Error('Motion sensors are unavailable. Use touch steering.'));}
    else {try{permission=typeof DeviceOrientationEvent.requestPermission==='function'?DeviceOrientationEvent.requestPermission():Promise.resolve('granted');}catch(e){permission=Promise.reject(e);}}
    fullscreen();
    Promise.resolve(permission).then(result=>{
      if(id!==requestId||!mobile)return;
      if(result!=='granted')throw Error('Motion access was not allowed. Use touch steering, or enable motion access in your browser settings.');
      tiltEnabled=true;window.addEventListener('deviceorientation',onTilt);$('tiltStatus').textContent='Waiting for motion data… Touch steering works until tilt is ready.';
      setTimeout(()=>{if(id===requestId&&tiltEnabled&&!input.active(now()))$('tiltStatus').textContent='No motion data received. Use touch steering or try enabling tilt again.';},2500);
    }).catch(error=>{if(id===requestId)$('tiltStatus').textContent=error.message||'Tilt could not be enabled. Use touch steering.';}).finally(()=>{permissionPending=false;$('enableMobile').disabled=false;});
  }
  opener.onclick=()=>showPanel(true);$('openMobileControls').onclick=()=>showPanel(true);$('closeControls').onclick=()=>{const next=pendingPlay;pendingPlay=null;setupDone=true;showPanel(false);next?.();};$('cancelSetup').onclick=()=>{pendingPlay=null;showPanel(false);};
  $('modeAuto').onclick=()=>applyMode('auto');$('modeDesktop').onclick=()=>applyMode('desktop');$('modeMobile').onclick=()=>applyMode('mobile');
  $('enableMobile').onclick=enable;$('enterFullscreen').onclick=()=>fullscreen();$('calibrateTilt').onclick=calibrate;$('quickCenter').onclick=calibrate;
  for(const b of ui.querySelectorAll('[data-drive]')){
    b.addEventListener('pointerdown',event=>{if(!driving||panelOpen)return;event.preventDefault();b.setPointerCapture(event.pointerId);input.press(event.pointerId,b.dataset.drive);b.classList.add('pressed');});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(type,event=>{input.release(event.pointerId);b.classList.remove('pressed');});
    b.addEventListener('contextmenu',e=>e.preventDefault());
  }
  $('controlPanel').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();pendingPlay=null;showPanel(false);}if(event.key==='Tab'){const buttons=[...ui.querySelectorAll('#controlPanel button, #controlPanel summary')].filter(b=>!b.disabled&&b.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  window.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
  function rotated(){clear();input.resetOrientation();if(tiltEnabled)$('tiltStatus').textContent='Screen rotated. Hold comfortably while steering recenters.';}
  window.addEventListener('orientationchange',rotated);screen.orientation?.addEventListener?.('change',rotated);
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)clear();});
  function tick(){
    opener.classList.add('hidden');
    driving=game.canControl();const blocked=!driving||panelOpen||document.hidden;
    if(blocked&&!wasBlocked)clear();wasBlocked=blocked;
    const activeTilt=tiltEnabled&&input.active(now());
    $('enableMobile').disabled=permissionPending||activeTilt;
    if(pendingPlay)$('closeControls').textContent=mobile?(activeTilt?'CONTINUE WITH TILT':'CONTINUE WITH TOUCH BUTTONS'):'CONTINUE WITH KEYBOARD';
    $('enableMobile').classList.toggle('enabled',activeTilt);$('enableMobile').textContent=permissionPending?'REQUESTING ACCESS…':activeTilt?'TILT ENABLED':'ENABLE TILT & FULLSCREEN';
    $('calibrateTilt').disabled=!activeTilt;$('quickCenter').classList.toggle('hidden',!mobile);$('quickCenter').title=activeTilt?'Hold your phone comfortably, then tap to set straight ahead.':'Enable tilt in Driving Settings first.';
    const full=!!(document.fullscreenElement||document.webkitFullscreenElement||navigator.standalone||matchMedia('(display-mode: standalone)').matches);
    $('enterFullscreen').classList.toggle('enabled',full);$('enterFullscreen').textContent=full?'FULLSCREEN ACTIVE':'ENTER FULLSCREEN';$('enterFullscreen').disabled=full;
    $('controlNotice').classList.toggle('hidden',now()>noticeUntil);
    if(lastTiltActive!==activeTilt){$('touchSteering').classList.toggle('hidden',activeTilt);$('quickCenter').disabled=!activeTilt;lastTiltActive=activeTilt;if(activeTilt)$('tiltStatus').textContent='Tilt is active. Hold comfortably, then CENTER STEERING to set straight ahead.';else if(tiltEnabled)$('tiltStatus').textContent='Waiting for motion data. Touch steering is available.';}
    $('touchDrive').classList.toggle('hidden',!mobile||blocked);$('mobileTools').classList.toggle('hidden',!driving||panelOpen);
    $('rotateHint').classList.toggle('hidden',!mobile||innerWidth>=innerHeight||panelOpen);
  }
  applyMode(mode);tick();
  return {tick,clear,beforePlay(next){if(setupDone){next();return;}pendingPlay=next;showPanel(true);},get panelOpen(){return panelOpen;},get mobile(){return mobile;},read(){return mobile&&!panelOpen&&game.canControl()&&!document.hidden?input.read(now(),tiltEnabled):{w:false,s:false,steer:0};}};
}
const api={screenTilt,tiltSteering,createInput,mount};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MobileControls=api;
})(typeof window!=='undefined'?window:globalThis);
