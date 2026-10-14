import {$,api,apiOrigin,callsign,displayError,rememberSession,sessionToken,flightTime,RULES_VERSION,text} from './client';
import {BrowserAI,CAPCOM_SYSTEM,capcomGuidance} from './ai';
import {TRACK_LABELS,type Track} from '../shared/types';
import {loadAgentBrief,copyBrief} from './agent-brief';
import {eventStart,type StartPosition} from '../shared/start';

const win=window as any;
const params=new URLSearchParams(location.search);
const track=(['manual','autopilot','agent'].includes(params.get('mode') || '')?params.get('mode'):'manual') as Track;
const local=params.get('local')==='1';
if(track==='agent'&&!local)location.replace('/setup/agent/');
const bridgeToken=new URLSearchParams(location.hash.slice(1)).get('bridge') || '';
if(bridgeToken)history.replaceState(null,'',location.pathname+location.search);
win.dragonBridge=local?{url:'/bridge/sync',headers:{'X-Dock-Bridge':bridgeToken}}:{url:null};
win.dockFlightReady=false;
let run: {id:string;finished?:boolean;start_position?:StartPosition}|null=null, starting=false, pulseCount=0, busy=false, aiDisabled=false;
let pending: {id:string;body:any}|null=null, lastStatus='', lastCall=0;
const ai=new BrowserAI(), recent:string[]=[];
win.dockBridgeMeta=()=>({ready:win.dockFlightReady,started:!!run,result:pending?{...pending,event_url:apiOrigin(),token:sessionToken()}:null});
const panel=document.createElement('aside');panel.className='dock-flight-panel';
panel.innerHTML=`<a class="flight-brand" id="event-home" href="/">◈ DOCK THE CAPSULE</a><h2>${TRACK_LABELS[track]}</h2><p>${track==='manual'?'First flight? Try unranked practice below. For a leaderboard attempt, enter a crew name and launch.':local?'Your local Python controller flies this capsule. Launch here to connect it.':'An AI agent makes live flight decisions. The capsule waits while it thinks.'}</p>
${local?'<span class="local-badge">● LOCAL BRIDGE / PYTHON CONNECTED</span>':''}
${local&&track==='agent'?'<details open class="flight-help"><summary>Connect your agent</summary><p>Launch your flight, then copy this briefing into your local agent. It includes this helper’s API address and temporary token.</p><button id="copy-agent-brief" disabled>Copy agent briefing</button><textarea id="agent-brief" rows="7" readonly aria-label="Agent connection briefing"></textarea><p id="agent-copy-status" role="status">Keep your simulator tab and helper terminal open.</p></details>':''}
${track==='manual'?'<details class="flight-help"><summary>How to dock</summary><ol><li>Start with <b>Fly unranked practice</b>.</li><li>Use arrows to bring pitch and yaw toward zero. Comma/period adjust roll.</li><li>Use W/S and A/D to center the station. E moves forward; Q brakes.</li><li>Make small taps. Slow down before reaching the port.</li></ol><p>The on-screen buttons work too. Practice as often as you like.</p></details>':''}
<label>CREW NAME / CALLSIGN<input id="flight-callsign" maxlength="24" minlength="2" placeholder="Your crew name" autocomplete="nickname"></label><label>EVENT CODE<input id="flight-code" maxlength="64" placeholder="Ask at the table, if required" autocomplete="off"></label>
<button id="flight-launch" class="launch-button">LAUNCH FLIGHT ↗</button><div class="flight-button-row"><button id="practice">Fly unranked practice</button><button id="flight-abort">Stop / abort</button></div>
<div class="flight-clock" id="flight-clock">0:00.0 <small>SIM TIME</small></div><div id="flight-status" class="flight-status" role="status">Loading flight systems…</div><button id="retry-score" class="retry-score" hidden>Retry score upload ↗</button><button id="discard-score" class="retry-score" hidden>Discard unsent result &amp; start fresh</button>
${!local&&track==='manual'?`<details id="ai-settings"><summary>CAPCOM / YOUR CLAUDE KEY</summary><p class="key-notice">Calls go directly to Anthropic and bill your API account. Key stays in tab memory; reload or Disconnect clears it.</p><label>ANTHROPIC API KEY<input id="claude-key" type="password" autocomplete="off" placeholder="Your own API key"></label><div class="flight-button-row"><button id="connect-ai">Connect key</button><button id="disconnect-ai">Disconnect</button></div><label>MODEL<select id="claude-model"><option value="">Connect to load available models</option></select></label><label id="capcom-check" class="inline-check"><input id="enable-capcom" type="checkbox"> CAPCOM coaching enabled</label><label id="orders-label">MISSION INSTRUCTIONS<textarea id="pilot-orders" rows="2" maxlength="800" placeholder="Dock smoothly. Brake early."></textarea></label></details>`:''}
<div id="flight-log" class="flight-log" aria-live="polite"></div>${track==='manual'&&!local?'<form id="radio-form" class="radio-form"><input id="radio-message" maxlength="300" placeholder="Ask CAPCOM…"><button>Send</button></form>':''}
<div class="small-note">Keep this simulator tab visible.<br><a id="flight-board" href="/leaderboard" target="_blank" rel="noopener">LIVE STANDINGS ↗</a> · <a id="flight-docs" href="/docs" target="_blank" rel="noopener">HANDBOOK ↗</a></div>`;
document.body.append(panel);document.body.classList.add('dock-flight','dock-start-required');
if(local&&track==='agent') {
  const field=$<HTMLTextAreaElement>('agent-brief'), note=$('agent-copy-status');
  loadAgentBrief(location.origin,bridgeToken).then(brief=>{field.value=brief;($<HTMLButtonElement>('copy-agent-brief')).disabled=false;}).catch(error=>{note.textContent=error.message;});
  $('copy-agent-brief').onclick=()=>void copyBrief(field,note);
}
document.documentElement.classList.add('hk');
if(track!=='manual')document.documentElement.classList.add('hk-noflight');
($('flight-callsign') as HTMLInputElement).value=callsign();
for(const [id,path] of [['event-home','/'],['flight-board','/leaderboard'],['flight-docs',`/setup/${track}/`]])($<HTMLAnchorElement>(id)).href=apiOrigin()+path;
for(const event of ['keydown','keyup','keypress','mousedown','mouseup','mousemove','touchstart','touchend']) panel.addEventListener(event,e=>e.stopPropagation());
panel.addEventListener('keydown',e=>{if(e.key==='Escape')(e.target as HTMLElement).blur();});
window.addEventListener('keydown',e=>{if(panel.contains(e.target as Node))return;if(/^\d$/.test(e.key)||track!=='manual'||!run)e.stopImmediatePropagation();},true);
window.addEventListener('keyup',e=>{if(panel.contains(e.target as Node))return;if(/^\d$/.test(e.key)||track!=='manual'||!run)e.stopImmediatePropagation();},true);
function status(message:string,kind=''){$('flight-status').textContent=message;$('flight-status').className=`flight-status ${kind}`;}
function log(label:string,message:string){const row=text('div','');row.append(text('b',label),text('span',message));$('flight-log').append(row);while($('flight-log').children.length>35)$('flight-log').firstElementChild?.remove();$('flight-log').scrollTop=$('flight-log').scrollHeight;recent.push(`${label}: ${message}`);while(recent.length>8)recent.shift();}
function state(){return win.dragon?.getState() || {status:'loading',time_s:0};}
async function cmd(name:string,opts:any={}){const result=await win.dragon.command(name,opts);if(!result.ok)throw new Error(result.error);return result.state;}
function fit(){if(!win.camera || !win.renderer)return;const small=innerWidth<=650;const width=small?innerWidth:innerWidth-(innerWidth<=1000?300:360),height=small?Math.max(420,innerHeight*.7):innerHeight;
  document.documentElement.style.setProperty('--dock-control-scale',String(Math.min(.85,width/1400,height/950)));
  win.width=width;win.height=height;win.windowHalfX=width/2;win.windowHalfY=height/2;win.camera.aspect=width/height;win.camera.updateProjectionMatrix();win.renderer.setSize(width,height);win.tooltipRenderer?.setSize(width,height);
  if(small){const e=document.getElementById('container');if(e)e.style.height=`${height}px`;}}
window.addEventListener('resize',()=>setTimeout(fit,0));
function allowedState(s:any){return {status:s.status,time_s:s.time_s,range:s.range,attitude:s.attitude,velocity:s.velocity,gravity:s.gravity};}
async function savePending(){if(!pending)return;try{await api(`/api/runs/${pending.id}/finish`,'POST',pending.body);pending=null;$('retry-score').hidden=true;$('discard-score').hidden=true;try{sessionStorage.removeItem('dock.pending-score');}catch{}status('Flight recorded. Check the live standings.','success');}catch(e){$('retry-score').hidden=false;$('discard-score').hidden=false;const permanent=[400,401,404,409].includes((e as any)?.status);status(permanent?`This result cannot be uploaded: ${displayError(e)} Discard it below to start fresh.`:`Score saved in this tab. ${displayError(e)} Retry when connected.`,'error');}}
async function finish(outcome:'success'|'fail'|'abort',s=state()){
  win.dockFlightReady=false;if(!run||run.finished)return;run.finished=true;
  const body={outcome,time_s:Number(s.time_s)||0,pulses:pulseCount,message:String(s.message || '').slice(0,200),state:allowedState(s)};
  log(outcome==='success'?'DOCKED':'FLIGHT ENDED',`${flightTime(body.time_s)} simulation seconds · ${pulseCount} pulses`);
  if(run.id==='practice'){status(outcome==='success'?'Practice docking complete. Start a ranked flight to join the standings.':'Practice ended. Launch again when ready.');($('flight-callsign') as HTMLInputElement).disabled=false;return;}
  pending={id:run.id,body};try{sessionStorage.setItem('dock.pending-score',JSON.stringify(pending));}catch{}
  await savePending();($('flight-callsign') as HTMLInputElement).disabled=false;
}
async function abort(){aiDisabled=true;await cmd('pause');await finish('abort');status('Flight aborted. Launch again when ready.');}
async function start(practice=false){
  if(starting)return;if(pending&&!practice){$('retry-score').hidden=false;$('discard-score').hidden=false;status('An earlier result is waiting. Retry its upload, or discard it below to start fresh.','error');return;}
  if(track==='autopilot'&&!local){status('Use the Python starter kit for this track.','error');return;}
  if(track==='agent'&&!local){location.replace('/setup/agent/');return;}
  starting=true;($('flight-launch') as HTMLButtonElement).disabled=true;
  try{
    if(run&&!run.finished)await finish('abort');
    if(!practice){const crew=($('flight-callsign') as HTMLInputElement).value.trim();const joined=await api('/api/join','POST',{callsign:crew,event_code:($('flight-code') as HTMLInputElement).value});rememberSession(joined.token,joined.callsign);
      run=await api('/api/runs','POST',{track,source:local?'local':'hosted',assisted:track==='manual'&&ai.connected&&($('enable-capcom') as HTMLInputElement)?.checked,model:ai.connected?ai.model:'',rules_version:RULES_VERSION,start_version:1});
    }else run={id:'practice',start_position:eventStart(crypto.randomUUID())};
    pulseCount=0;aiDisabled=false;lastCall=0;lastStatus='';status('Capsule arriving. Stand by…');
    await cmd('reset');await cmd('gravity_on');await cmd('translation_fine');await cmd('rotation_fine');
    if(track==='agent')await cmd('pause');else await cmd('resume');
    win.dockFlightReady=true;document.body.classList.remove('dock-start-required');($('flight-callsign') as HTMLInputElement).disabled=true;
    status((local?'Local controller ready. Python can read state and fire thrusters.':'Flight live. Line up your attitude, then approach.')+(practice?' Randomized practice start.':run?.start_position?' Shared event start: identical for every ranked flight.':''));
  }catch(e){status(displayError(e),'error');if(run&&!run.finished){try{await finish('abort');}catch{}}}
  finally{starting=false;($('flight-launch') as HTMLButtonElement).disabled=false;}
}
async function coaching(message=''){
  if(busy||!ai.connected||!run||run.finished||aiDisabled||state().status!=='flying')return;
  busy=true;lastCall=Date.now();try{const answer=await ai.ask(CAPCOM_SYSTEM,JSON.stringify({telemetry:capcomGuidance(state()),recent,crew_message:message}));if(!ai.connected)return;
    const reply=String(answer);if(reply.trim().toUpperCase()!=='STANDBY')log('CAPCOM',reply);
  }catch(e){aiDisabled=true;log('CAPCOM OFFLINE',displayError(e));status('CAPCOM unavailable. You can keep flying solo.','error');}finally{busy=false;}
}
if(!local&&track==='manual'){
  $('orders-label').hidden=true;
  $('connect-ai').onclick=async()=>{const input=$('claude-key') as HTMLInputElement;const key=input.value.trim();input.value='';if(!key){status('Enter your own API key.','error');return;}
    try{ai.connect(key);const models=await ai.models();const select=$('claude-model') as HTMLSelectElement;select.replaceChildren();for(const m of models){const option=document.createElement('option');option.value=m.id;option.textContent=m.name;select.append(option);}const economical=models.find(m=>m.id.includes('haiku'));if(economical)select.value=economical.id;ai.model=select.value;if(!ai.model)throw new Error('This key has no available models.');($('enable-capcom') as HTMLInputElement).checked=true;aiDisabled=false;status('Your key is connected. Requests go directly to Anthropic.');}
    catch(e){ai.disconnect();status(displayError(e),'error');}};
  $('disconnect-ai').onclick=()=>{ai.disconnect();($('claude-key') as HTMLInputElement).value='';($('claude-model') as HTMLSelectElement).replaceChildren(new Option('Connect to load available models',''));status('Key cleared. CAPCOM disconnected.');};
  $('claude-model').onchange=()=>{ai.model=($('claude-model') as HTMLSelectElement).value;};
  $('radio-form')?.addEventListener('submit',e=>{e.preventDefault();const input=$('radio-message') as HTMLInputElement;const message=input.value.trim();input.value='';if(message){log('CREW',message);void coaching(message);}});
}
$('flight-launch').onclick=()=>void start();$('practice').onclick=()=>void start(true);$('flight-abort').onclick=()=>void abort().catch(e=>status(displayError(e),'error'));
$('retry-score').onclick=()=>void savePending();
$('discard-score').onclick=()=>{pending=null;try{sessionStorage.removeItem('dock.pending-score');}catch{}$('retry-score').hidden=true;$('discard-score').hidden=true;status('Unsent result discarded. You can launch a new flight.');};
try{const stored=sessionStorage.getItem('dock.pending-score');if(stored){const candidate=JSON.parse(stored);if(candidate?.id==='practice'||!candidate?.id||!candidate?.body){sessionStorage.removeItem('dock.pending-score');}else{pending=candidate;$('retry-score').hidden=false;$('discard-score').hidden=false;}}}catch{}
document.addEventListener('visibilitychange',()=>{if(document.hidden && run&&!run.finished){void cmd('pause');status('Tab hidden: flight paused. Return and launch again or resume.');}else if(track==='manual'&&run&&!run.finished){void cmd('resume');status('Flight resumed.');}});
async function boot(){
  if(!win.dragon || !win.renderer){setTimeout(boot,200);return;}fit();
  const original=win.dragon.command.bind(win.dragon);
  win.dragon.command=async(name:string,options:any)=>{
    try {
    if(name==='reset' && run && !starting && !(state().time_s<0.1 && !run.finished)){if(!run.finished)await finish('abort');
      if(pending)throw new Error('Previous score is waiting for upload.');
      run=await api('/api/runs','POST',{track,source:local?'local':'hosted',assisted:false,model:'',rules_version:RULES_VERSION,start_version:1});pulseCount=0;lastStatus='';win.dockFlightReady=true;}
    const result=await original(name,name==='reset'?{...options,start_position:run?.start_position}:options);
    if(name==='reset' && result.ok && local)await original(track==='agent'?'pause':'resume',{});
    return result;
    } catch(e) { return {ok:false,command:name,error:displayError(e),state:state()}; }
  };
  for(const fn of ['rollLeft','rollRight','pitchUp','pitchDown','yawLeft','yawRight','translateForward','translateBackward','translateLeft','translateRight','translateUp','translateDown']){const f=win[fn];win[fn]=function(...args:any[]){if(!win.isGameOver && run&&!run.finished)pulseCount++;return f.apply(this,args);};}
  document.getElementById('begin-button')?.addEventListener('click',e=>{e.stopImmediatePropagation();void start();},true);
  document.getElementById('option-restart')?.addEventListener('click',e=>{e.stopImmediatePropagation();void start();},true);
  // All resets go through the flight panel so a new attempt receives a fresh run ID.
  for(const root of ['success','fail'])document.getElementById(root)?.querySelectorAll('.message-button').forEach(button=>button.addEventListener('click',e=>{e.stopImmediatePropagation();void start();},true));
  setInterval(()=>{const s=state();$('flight-clock').replaceChildren(document.createTextNode(flightTime(s.time_s||0)),text('small','SIM TIME'));
    if(!run || run.finished || starting)return;
    if((s.status==='success'||s.status==='fail') && s.status!==lastStatus){lastStatus=s.status;void finish(s.status,s);}
    if(track==='manual'&&!local&&ai.connected&&($('enable-capcom') as HTMLInputElement).checked&&!busy&&Date.now()-lastCall>15000)void coaching();
  },250);
  try{const config=await api('/api/config');if(!config.join_required)($('flight-code') as HTMLInputElement).placeholder='No code required';if(!config.enabled_tracks.includes(track))($('flight-launch') as HTMLButtonElement).disabled=true;
    status(pending?'An earlier result is waiting. Retry its upload, or discard it below to start fresh.':config.event_open?'Flight systems ready. Choose a callsign and launch.':'Event closed. Unranked practice is available.');}
  catch{status('Event service unavailable. Unranked practice is available; ranked flights need a connection.','error');}
}
void boot();

