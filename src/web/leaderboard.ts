import {$,api,flightTime,text} from './client';
import {TRACKS,TRACK_LABELS,RULES_VERSION,type BoardData,type Score,type Track} from '../shared/types';
import {CHALLENGES,type Challenge} from '../shared/challenges';

const demo=new URLSearchParams(location.search).get('demo')==='1';
const requested=new URLSearchParams(location.search).get('challenge')||'standard';
let challenge:Challenge=Object.hasOwn(CHALLENGES,requested)?requested as Challenge:'standard';
const cacheKey='dock.tv.last.'+challenge;
const mission=$<HTMLSelectElement>('mission');
for(const [value,info]of Object.entries(CHALLENGES))mission.append(new Option(info.name,value));
mission.value=challenge;
document.body.classList.toggle('challenge-view',challenge!=='standard');
($('assistance').closest('.tv-filter') as HTMLElement).hidden=challenge!=='standard';
if(challenge!=='standard')document.querySelector('h1')!.append(text('small',CHALLENGES[challenge].name.toUpperCase(),'challenge-title'));
mission.onchange=()=>{const url=new URL(location.href);if(mission.value==='standard')url.searchParams.delete('challenge');else url.searchParams.set('challenge',mission.value);location.href=url.href;};
let previous: BoardData | undefined, lastSuccess=0, toastTimer: ReturnType<typeof setTimeout>;
let refreshTimer: ReturnType<typeof setTimeout>, generation=0;
const refreshInterval=30000, sessionLimit=12*3600000, openedAt=Date.now();
let failures=0;
const crews=['ALPHA','BRAVO','CHARLIE','DELTA','ECHO','FOXTROT','GOLF','HOTEL'];
const names={manual:crews.map(c=>c+' PILOTS'),autopilot:crews.map(c=>c+' CONTROLS'),agent:crews.map(c=>c+' AGENTS')};
function demoData(): BoardData {
  const boards=Object.fromEntries(TRACKS.map((track,j)=>[track,names[track].map((name,i)=>({
    id:`demo-${track}-${i}`,callsign:name,track,assisted:track==='manual' && i%2===0,model:'',
    time_s:74.3+j*19.4+i*23.7+(i%3)*.6,pulses:120+j*25+i*17,created_at:Date.now(),
  }))])) as BoardData['boards'];
  return {event_name:'HACKATHON FLIGHT LAB',join_url:location.origin,rules_version:RULES_VERSION,boards,
    stats:{attempts:147,dockings:38,crews:15},updated_at:Date.now()};
}
function detail(score: Score) {
  return `${score.pulses.toLocaleString()} PULSES · ${score.track==='manual'?(score.assisted?'CAPCOM ASSISTED':'SOLO FLIGHT'):score.track==='autopilot'?'PYTHON CONTROLLER':'LOCAL AGENT'}`;
}
function status(label: string, kind='') {
  const e=$('connection'); e.className=`live-badge ${kind}`; e.replaceChildren(document.createElement('i'),document.createTextNode(label));
}
function announce(message: string) {
  $('record-toast').textContent=message; $('record-toast').classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('record-toast').classList.remove('show'),6500);
}
function renderTrack(track: Track, scores: Score[]) {
  const champion=$(`${track}-champion`), rows=$(`${track}-rows`);
  champion.replaceChildren(); rows.replaceChildren();
  const first=scores[0]; champion.classList.toggle('champion-empty',!first);
  const label=text('div','', 'champion-label');
  label.append(text('span',first?'★  LEADING THE TRACK':'◇  AWAITING FIRST DOCKING','champion-rank'),text('span',first?'01':'—'));
  champion.append(label,text('div',first?.callsign || 'This could be your crew.','crew-name'));
  const time=text('div',first?flightTime(first.time_s):'—:—','champion-time'); time.append(text('small','SIM TIME'));
  champion.append(time,text('div',first?detail(first):'LAUNCH A FLIGHT. SET THE PACE.','champion-detail'));
  if(previous && first && previous.boards[track][0]?.id!==first.id) {
    champion.classList.remove('new-record'); void champion.offsetWidth; champion.classList.add('new-record');
    announce(`${first.callsign} takes the lead in ${TRACK_LABELS[track]}!`);
  }
  for(let i=1;i<8;i++) {
    const score=scores[i], row=document.createElement('li'); if(!score) row.className='empty-slot';
    row.append(text('span',String(i+1).padStart(2,'0'),'row-rank'));
    const crew=text('div',''); crew.append(text('span',score?.callsign || 'Open flight slot','row-name'));
    if(score) crew.append(text('span',detail(score),'row-detail'));
    row.append(crew); const t=text('span',score?flightTime(score.time_s):'—','row-time'); if(score)t.append(text('small','s')); row.append(t); rows.append(row);
  }
  $(`${track}-count`).textContent=`${scores.length} CREW${scores.length===1?'':'S'} DOCKED`;
}
function render(data: BoardData) {
  $('event-name').textContent=data.event_name.toUpperCase();
  let join=data.join_url || location.origin; try { const u=new URL(join); join=u.host+(u.pathname==='/'?'':u.pathname); } catch {}
  $('join-address').textContent=join;
  for(const track of TRACKS) renderTrack(track,data.boards[track] || []);
  for(const key of ['dockings','attempts','crews'] as const) $(key).textContent=String(data.stats[key]).padStart(2,'0');
  previous=data;
}
async function refresh() {
  clearTimeout(refreshTimer); const current=++generation;
  if(document.hidden || Date.now()-openedAt>=sessionLimit) {
    if(!document.hidden) status('DISPLAY PAUSED. RELOAD THE PAGE TO RESUME.','offline');
    return;
  }
  try {
    const data=demo?demoData():await api<BoardData>(`/api/leaderboard?assisted=${($('assistance') as HTMLSelectElement).value}&challenge=${challenge}`);
    if(current!==generation)return;
    render(data); lastSuccess=Date.now(); status(demo?'SAMPLE DATA / PREVIEW':'LIVE STANDINGS',demo?'demo':'');
    failures=0;
    if(!demo) try { localStorage.setItem(cacheKey,JSON.stringify(data)); } catch {}
    $('updated').textContent=demo?'Preview: these scores are examples, not real results':'Standings refresh every 30 seconds and may be up to 60 seconds behind.';
  } catch(error) {
    failures++;
    status('SIGNAL LOST / RETRYING','offline');
    const message=error instanceof Error?error.message:'Connection interrupted.';
    $('updated').textContent=lastSuccess?`Showing last received standings · ${message}`:message;
  } finally { if(current===generation && !demo && !document.hidden)refreshTimer=setTimeout(refresh,Math.min(300000,refreshInterval*2**Math.min(failures,4))); }
}
document.addEventListener('visibilitychange',()=>{clearTimeout(refreshTimer);generation++;if(!document.hidden)void refresh();});
if(!demo) {
  try { const cached=localStorage.getItem(cacheKey); if(cached) { render(JSON.parse(cached)); status('CACHED STANDINGS','offline'); } } catch {}
}
if(!previous) render({event_name:'HACKATHON FLIGHT LAB',join_url:location.origin,rules_version:RULES_VERSION,boards:{manual:[],autopilot:[],agent:[]},stats:{attempts:0,dockings:0,crews:0},updated_at:0});
// Initial loading must not announce empty→first as a new record from a prior event.
previous=undefined;
$('fullscreen').addEventListener('click',async()=>{try {if(document.fullscreenElement) await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}});
$('assistance').addEventListener('change',()=>{previous=undefined; void refresh();});
function tick() { $('clock').textContent=new Date().toLocaleTimeString(undefined,{hour12:false}); }
tick(); setInterval(tick,1000); void refresh();
