import {$,api,apiOrigin,callsign,displayError,rememberSession,sessionToken,flightTime,RULES_VERSION,text} from './client';
import {askCapcom,capcomGuidance} from './ai';
import {requireLogin} from './gate';
import {TRACK_LABELS,type Track} from '../shared/types';
import {loadAgentBrief,copyBrief} from './agent-brief';
import {eventStart,type StartPosition} from '../shared/start';
import {CHALLENGES,type Challenge} from '../shared/challenges';

const win=window as any;
const params=new URLSearchParams(location.search);
const track=(['manual','autopilot','agent'].includes(params.get('mode') || '')?params.get('mode'):'manual') as Track;
const local=params.get('local')==='1';
if(track==='agent'&&!local)location.replace('/setup/agent/');
const bridgeToken=(new URLSearchParams(location.hash.slice(1)).get('bridge') || '').replace(/[^a-f0-9]/g,'');
if(bridgeToken)history.replaceState(null,'',location.pathname+location.search);
win.dragonBridge=local?{url:'/bridge/sync',headers:{'X-Dock-Bridge':bridgeToken}}:{url:null};
win.dockFlightReady=false;
let run: {id:string;finished?:boolean;start_position?:StartPosition;challenge?:Challenge;challenge_seed?:string}|null=null, starting=false, pulseCount=0, busy=false, aiDisabled=false;
let selectedChallenge:Challenge='standard';
// Faster-than-real-time flights are for testing controllers. They are never submitted to the leaderboard.
const UNRANKED='unranked-';
const unranked=(id?:string)=>!!id?.startsWith(UNRANKED);
let simSpeed=1;
win.dockSimulationSpeed=()=>unranked(run?.id)&&!run?.finished?simSpeed:1;
win.dockIsPractice=()=>unranked(run?.id);
let pending: {id:string;body:any}|null=null, lastStatus='', lastCall=0;
const recent:string[]=[];
let capcomError='';
const capcomModel=()=>($<HTMLSelectElement>('capcom-model'))?.value || '';
win.dockBridgeMeta=()=>({ready:win.dockFlightReady,started:!!run,flight:run&&!run.finished?run.id:null,ranked:!!run&&!unranked(run.id),simulation_speed:win.dockSimulationSpeed(),
  result:pending?{...pending,event_url:apiOrigin(),token:sessionToken()}:null});
const panel=document.createElement('aside');panel.className='dock-flight-panel';
panel.innerHTML=`<a class="flight-brand" id="event-home" href="/">◈ DOCK THE CAPSULE</a><h2>${TRACK_LABELS[track]}</h2><p>${track==='manual'?'Enter a crew name and launch. AI CAPCOM will talk you in by radio and tell you which keys to press. Choose None below to fly without AI.':track==='agent'?'Your AI agent flies this capsule in real time through the local server. Launch the flight here, then start your agent.':'Your autopilot flies this capsule through the local server. Launch the flight here, then start your autopilot.'}</p>
${local?`<span class="local-badge">● LOCAL SIMULATOR SERVER CONNECTED</span><label>AUTOPILOT URL<input id="autopilot-url" readonly value="${location.origin}/ap/${bridgeToken}"></label>`:''}
${local&&track==='agent'?'<div class="agent-connect"><button id="copy-agent-brief" disabled>Copy agent briefing ↗</button><details class="flight-help"><summary>View connection briefing</summary><textarea id="agent-brief" rows="5" readonly aria-label="Agent connection briefing"></textarea></details><p id="agent-copy-status" role="status">Launch the flight, then paste the briefing into your local agent.</p></div>':''}
${track==='manual'?'<details class="flight-help"><summary>How to dock</summary><ol><li>Use the arrow keys to bring pitch and yaw to zero. The comma and period keys adjust roll.</li><li>Use W/S and A/D to center the station. E moves forward and Q brakes.</li><li>Make small taps, and slow down before you reach the port.</li></ol><p>The on-screen buttons work as well. You can fly as many times as you like; your best time is ranked.</p></details>':''}
<label>CREW NAME / CALLSIGN<input id="flight-callsign" maxlength="24" minlength="2" placeholder="Your crew name" autocomplete="nickname"></label>
<button id="flight-launch" class="launch-button">LAUNCH FLIGHT ↗</button><div class="flight-button-row"><button id="flight-abort">Abort flight</button><button id="flight-menu">Main menu</button></div>
<div class="flight-clock" id="flight-clock">0:00.0 <small>SIM TIME</small></div><div id="flight-status" class="flight-status" role="status">Loading flight systems…</div><button id="retry-score" class="retry-score" hidden>Retry score upload ↗</button><button id="discard-score" class="retry-score" hidden>Discard unsent result &amp; start fresh</button>
${!local&&track==='manual'?'<label id="capcom-label">AI CAPCOM<select id="capcom-model"><option value="">None (fly manually without AI CAPCOM)</option></select></label>':''}
<div id="flight-log" class="flight-log" aria-live="polite"></div>${track==='manual'&&!local?'<form id="radio-form" class="radio-form"><input id="radio-message" maxlength="300" placeholder="Ask CAPCOM…"><button>Send</button></form>':''}
<div class="small-note">Keep this simulator tab visible during the flight.<br><a id="flight-board" href="/leaderboard" target="_blank" rel="noopener">LIVE STANDINGS ↗</a> · <a id="flight-docs" href="/docs" target="_blank" rel="noopener">HANDBOOK ↗</a></div>`;
document.body.append(panel);document.body.classList.add('dock-flight','dock-start-required');
panel.querySelector('h2 + p')?.classList.add('flight-intro');
const setup=document.createElement('details');setup.className='crew-setup';setup.open=true;
setup.innerHTML='<summary>Crew</summary>';
for(const id of ['flight-callsign','capcom-model'])if($(id))setup.append($(id).closest('label')!);
panel.insertBefore(setup,$('flight-launch'));
if(local&&track!=='manual'){
  const testing=document.createElement('details');testing.className='practice-settings';
  testing.innerHTML='<summary>Simulation speed</summary><label>SPEED<select id="sim-speed"><option value="1">1× real time (ranked)</option><option value="2">2× faster than real time (unranked)</option><option value="4">4× faster than real time (unranked)</option><option value="8">8× faster than real time (unranked)</option></select></label><p>Flights faster than real time are for testing and are not submitted to the leaderboard. The achievable speed depends on your computer.</p>';
  panel.insertBefore(testing,$('flight-launch'));
  $('sim-speed').onchange=()=>{simSpeed=Number(($<HTMLSelectElement>('sim-speed')).value);testing.querySelector('summary')!.textContent=simSpeed===1?'Simulation speed':`Simulation speed · ${simSpeed}× (unranked)`;
    if(unranked(run?.id)&&!run?.finished)status(unrankedStatus());};
}
function unrankedStatus(){return `Unranked test flight at ${simSpeed}× speed. This result will not be submitted to the leaderboard.`;}
if(local&&track!=='manual'){
  const choices=document.createElement('details');choices.className='challenge-settings';
  choices.innerHTML='<summary>Optional · Challenge Mode</summary><label>MISSION<select id="challenge-select"></select></label><p id="challenge-brief"></p><a id="challenge-board" target="_blank" rel="noopener">Challenge standings ↗</a>';
  panel.insertBefore(choices,$('flight-launch'));
  const select=$<HTMLSelectElement>('challenge-select');
  for(const [value,info]of Object.entries(CHALLENGES))select.append(new Option(info.name,value));
  const update=()=>{selectedChallenge=select.value as Challenge;choices.querySelector('summary')!.textContent=selectedChallenge==='standard'?'Optional · Challenge Mode':'Mission · '+CHALLENGES[selectedChallenge].name;$('challenge-brief').textContent=CHALLENGES[selectedChallenge].brief;($<HTMLAnchorElement>('challenge-board')).href=apiOrigin()+'/leaderboard'+(selectedChallenge==='standard'?'':'?challenge='+selectedChallenge);$('challenge-board').textContent=selectedChallenge==='standard'?'Standard standings ↗':'Challenge standings ↗';};
  select.onchange=update;update();
}
$('flight-abort').hidden=true;
if($('radio-form'))$('radio-form').hidden=true;
// One expanded setup section at a time keeps laptop panels compact.
panel.querySelectorAll('details').forEach(detail=>detail.addEventListener('toggle',()=>{
  if(detail.open)panel.querySelectorAll('details').forEach(other=>{if(other!==detail)other.open=false;});
}));
if(local)$('autopilot-url').onfocus=e=>(e.target as HTMLInputElement).select();
if(local&&track==='agent') {
  const field=$<HTMLTextAreaElement>('agent-brief'), note=$('agent-copy-status');
  loadAgentBrief(`${location.origin}/ap/${bridgeToken}`).then(brief=>{field.value=brief;($<HTMLButtonElement>('copy-agent-brief')).disabled=false;}).catch(error=>{note.textContent=error.message;});
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
async function finish(outcome:'success'|'fail'|'abort',s=win.dragon?.getFlightState()||state()){
  win.dockFlightReady=false;if(!run||run.finished)return;run.finished=true;
  panel.classList.remove('in-flight');if($('radio-form'))$('radio-form').hidden=true;($<HTMLButtonElement>('flight-launch')).disabled=false;$('flight-launch').textContent='LAUNCH ANOTHER FLIGHT ↗';$('flight-abort').hidden=true;
  if(local&&track!=='manual')($<HTMLSelectElement>('challenge-select')).disabled=false;
  const body={outcome,time_s:Number(s.time_s)||0,pulses:pulseCount,message:String(s.message || '').slice(0,200),state:allowedState(s)};
  log(outcome==='success'?'DOCKED':'FLIGHT ENDED',`${flightTime(body.time_s)} simulation seconds · ${pulseCount} pulses`);
  if(unranked(run.id)){status(outcome==='success'?'Test flight docked. Set the speed to 1× for a ranked flight.':'Test flight ended. Launch again when ready.');($('flight-callsign') as HTMLInputElement).disabled=false;return;}
  pending={id:run.id,body};try{sessionStorage.setItem('dock.pending-score',JSON.stringify(pending));}catch{}
  await savePending();($('flight-callsign') as HTMLInputElement).disabled=false;
}
function setEndScreen(title:string,message=''){const heading=document.querySelector('#fail h2');if(heading)heading.textContent=title;const text=document.getElementById('fail-message');if(text)text.textContent=message;}
// Ends the current flight the way the simulator ends any attempt, so the scene and HUD stop together.
async function endFlight(){
  aiDisabled=true;await finish('abort');
  if(!win.isGameOver&&win.hideInterface){setEndScreen('ABORTED','The flight was aborted.');win.hideInterface('fail');}
}
async function abort(){
  if(!run||run.finished)return;
  if(!confirm('Abort this flight? It will be recorded as an aborted attempt.'))return;
  await endFlight();status('Flight aborted. Launch again when ready.');
}
async function mainMenu(event?:Event){
  event?.preventDefault();
  const flying=!!run&&!run.finished;
  if(!confirm(flying?'End this flight and return to the main menu? The flight will be recorded as an aborted attempt.':'Return to the main menu?'))return;
  if(flying)await endFlight().catch(()=>{});
  location.href=apiOrigin()+'/';
}
async function start(){
  const testFlight=local&&simSpeed>1;
  if(starting)return;if(pending&&!testFlight){$('retry-score').hidden=false;$('discard-score').hidden=false;status('An earlier result is waiting. Retry its upload, or discard it below to start fresh.','error');return;}
  if(track==='autopilot'&&!local){status('This track uses the starter kit. See the setup page for instructions.','error');return;}
  if(track==='agent'&&!local){location.replace('/setup/agent/');return;}
  starting=true;($('flight-launch') as HTMLButtonElement).disabled=true;
  try{
    if(run&&!run.finished)await finish('abort');
    if(!testFlight){const crew=($('flight-callsign') as HTMLInputElement).value.trim();const joined=await api('/api/join','POST',{callsign:crew});rememberSession(joined.token,joined.callsign);
      run=await api('/api/runs','POST',{track,source:local?'local':'hosted',assisted:!!capcomModel(),model:capcomModel(),rules_version:RULES_VERSION,start_version:1,challenge:selectedChallenge,challenge_version:1});
    }else run={id:UNRANKED+crypto.randomUUID(),start_position:eventStart(crypto.randomUUID()),challenge:selectedChallenge,challenge_seed:crypto.randomUUID()};
    setEndScreen('FAIL');pulseCount=0;aiDisabled=false;capcomError='';lastCall=0;lastStatus='';status('The capsule is arriving. Stand by.');
    await cmd('reset');await cmd('gravity_on');await cmd('translation_fine');await cmd('rotation_fine');
    await cmd('resume');
    win.dockFlightReady=true;document.body.classList.remove('dock-start-required');($('flight-callsign') as HTMLInputElement).disabled=true;
    panel.classList.add('in-flight');setup.open=false;panel.querySelectorAll('details').forEach(e=>e.open=false);$('flight-abort').hidden=false;
    if($('radio-form'))$('radio-form').hidden=!capcomModel();
    if(local&&track!=='manual')($<HTMLSelectElement>('challenge-select')).disabled=true;
    if(run?.challenge && run.challenge!=='standard')log('CHALLENGE · '+CHALLENGES[run.challenge].name,CHALLENGES[run.challenge].brief);
    status(testFlight?unrankedStatus():(local?`Flight live. Your ${track==='agent'?'agent':'autopilot'} can now read telemetry and fire thrusters.`:'Flight live. Zero your attitude, then begin the approach.')+(run?.start_position&&!testFlight?' Every ranked flight starts from the same position.':''));
  }catch(e){status(displayError(e),'error');if(run&&!run.finished){try{await finish('abort');}catch{}}}
  finally{starting=false;($('flight-launch') as HTMLButtonElement).disabled=!!run&&!run.finished;}
}
async function coaching(message=''){
  const model=capcomModel();
  if(busy||!model||!run||run.finished||aiDisabled||state().status!=='flying')return;
  busy=true;lastCall=Date.now();try{const reply=String(await askCapcom(model,capcomGuidance(state()),recent,message));capcomError='';
    if(reply.trim()&&reply.trim().toUpperCase().replace(/[.!]$/,'')!=='STANDBY')log('CAPCOM',reply);
  }catch(e){const error=displayError(e);if([401,503].includes((e as any)?.status))aiDisabled=true;
    if(error!==capcomError)log('CAPCOM UNAVAILABLE',`${error} You can continue the flight without CAPCOM.`);capcomError=error;}finally{busy=false;}
}
if(!local&&track==='manual'){
  $('capcom-model').onchange=()=>{aiDisabled=false;capcomError='';$('radio-form').hidden=!capcomModel()||!run||!!run.finished;};
  $('radio-form')?.addEventListener('submit',e=>{e.preventDefault();const input=$('radio-message') as HTMLInputElement;const message=input.value.trim();input.value='';if(message){log('CREW',message);void coaching(message);}});
}
$('flight-launch').onclick=()=>void start();$('flight-abort').onclick=()=>void abort().catch(e=>status(displayError(e),'error'));
$('flight-menu').onclick=e=>void mainMenu(e);$('event-home').onclick=e=>void mainMenu(e);
$('retry-score').onclick=()=>void savePending();
$('discard-score').onclick=()=>{pending=null;try{sessionStorage.removeItem('dock.pending-score');}catch{}$('retry-score').hidden=true;$('discard-score').hidden=true;status('Unsent result discarded. You can launch a new flight.');};
try{const stored=sessionStorage.getItem('dock.pending-score');if(stored){const candidate=JSON.parse(stored);if(unranked(candidate?.id)||candidate?.id==='practice'||!candidate?.id||!candidate?.body){sessionStorage.removeItem('dock.pending-score');}else{pending=candidate;$('retry-score').hidden=false;$('discard-score').hidden=false;}}}catch{}
document.addEventListener('visibilitychange',()=>{if(document.hidden && run&&!run.finished){void cmd('pause');status('The flight paused because this tab was hidden. It resumes when the tab is visible again.');}else if(!document.hidden&&run&&!run.finished){void cmd('resume');status('Flight resumed.');}});
async function boot(){
  if(!win.dragon || !win.renderer){setTimeout(boot,200);return;}fit();
  const original=win.dragon.command.bind(win.dragon);
  win.dragon.command=async(name:string,options:any)=>{
    try {
    if(name==='reset' && run && !starting && !(state().time_s<0.1 && !run.finished)){if(!run.finished)await finish('abort');
      if(pending)throw new Error('Previous score is waiting for upload.');
      run=unranked(run.id)?{id:UNRANKED+crypto.randomUUID(),start_position:eventStart(crypto.randomUUID()),challenge:selectedChallenge,challenge_seed:crypto.randomUUID()}:await api('/api/runs','POST',{track,source:local?'local':'hosted',assisted:false,model:'',rules_version:RULES_VERSION,start_version:1,challenge:selectedChallenge,challenge_version:1});pulseCount=0;lastStatus='';win.dockFlightReady=true;}
    const result=await original(name,name==='reset'?{...options,start_position:run?.start_position,challenge:run?.challenge||'standard',challenge_seed:run?.challenge_seed}:options);
    if(name==='reset' && result.ok && local){
      await original('resume',{});
      panel.classList.add('in-flight');panel.querySelectorAll('details').forEach(e=>e.open=false);
      $('flight-abort').hidden=false;($<HTMLSelectElement>('challenge-select')).disabled=true;
      ($<HTMLButtonElement>('flight-launch')).disabled=true;
    }
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
    if((s.status==='success'||s.status==='fail') && s.status!==lastStatus){lastStatus=s.status;void finish(s.status);}
    if(track==='manual'&&!local&&capcomModel()&&!busy&&Date.now()-lastCall>15000)void coaching();
  },250);
  try{await requireLogin();const config=await api('/api/config');if(!config.enabled_tracks.includes(track))($('flight-launch') as HTMLButtonElement).disabled=true;
    const select=$<HTMLSelectElement>('capcom-model');
    if(select){if(config.capcom?.available){for(const m of config.capcom.models)select.append(new Option(m.name,m.id));select.value=config.capcom.default_model;}
      else $('capcom-label').append(text('small','AI CAPCOM is not available for this event.'));}
    status(pending?'An earlier result is waiting. Retry its upload, or discard it below to start fresh.':config.event_open?'Flight systems are ready. Enter a crew name and launch.':'The event is closed. Flights are not being recorded.');}
  catch{status('The event service is unavailable. Flights cannot be recorded until the connection returns.','error');}
}
void boot();


