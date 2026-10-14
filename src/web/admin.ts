import {$,api,displayError,flightTime,text} from './client';
import {TRACKS,TRACK_LABELS,type Run,type Settings,type ArchiveSummary} from '../shared/types';
let runs: Run[]=[], eventId='legacy';
const form=$('event-settings') as HTMLFormElement;
function field(name: string) { return form.elements.namedItem(name) as HTMLInputElement; }
function status(message: string) { $('admin-status').textContent=message; }
function renderRuns() {
  const search=($('run-search') as HTMLInputElement).value.toLowerCase();
  const track=($('track-filter') as HTMLSelectElement).value, outcome=($('outcome-filter') as HTMLSelectElement).value;
  const visible=runs.filter(r=>r.callsign.toLowerCase().includes(search) && (track==='all'||r.track===track) && (outcome==='all'||r.outcome===outcome));
  $('run-total').textContent=`/ ${runs.length}`; $('run-rows').replaceChildren();
  for(const r of visible) {
    const row=document.createElement('tr'); if(r.excluded)row.className='excluded-row';
    const crew=text('td',r.callsign); crew.append(text('small',new Date(r.created_at).toLocaleString())); row.append(crew);
    row.append(text('td',TRACK_LABELS[r.track]+(r.challenge && r.challenge!=='standard'?' / '+r.challenge:'')),text('td',r.outcome==='success'?'DOCKED':r.outcome.toUpperCase(),r.outcome==='success'?'success-text':''),text('td',r.time_s===undefined?'—':flightTime(r.time_s)+'s'),text('td',r.pulses===undefined?'—':String(r.pulses)));
    const info=text('td',r.source+(r.assisted?' · assisted':'')); info.append(text('small',r.excluded?r.exclusion_reason || 'Excluded':r.message || r.model || '')); row.append(info);
    const action=text('td',''); const button=text('button',r.excluded?'Restore':'Exclude','button secondary') as HTMLButtonElement;
    button.onclick=async()=>{button.disabled=true; try{await api(`/api/admin/runs/${r.id}`,'PATCH',{excluded:!r.excluded,reason:'Staff review'}); await load();status(r.excluded?'Score restored.':'Score excluded.');}catch(e){status(displayError(e));button.disabled=false;}};
    action.append(button); row.append(action); $('run-rows').append(row);
  }
  if(!visible.length) { const row=text('tr',''); const cell=text('td','No flights match this view.'); (cell as HTMLTableCellElement).colSpan=7; row.append(cell); $('run-rows').append(row); }
}
async function load() {
  const data=await api<{settings:Settings;runs:Run[];archives:ArchiveSummary[]}>('/api/admin');
  $('staff-login').hidden=true; $('admin-content').hidden=false; runs=data.runs;
  field('event_name').value=data.settings.event_name;field('join_url').value=data.settings.join_url;
  field('event_open').checked=data.settings.event_open;field('leaderboard_public').checked=data.settings.leaderboard_public;
  for(const track of TRACKS)field(track).checked=data.settings.enabled_tracks.includes(track);
  eventId=data.settings.event_id || 'legacy';
  $('event-archives').replaceChildren();
  for(const archive of data.archives){
    const row=text('p',`${archive.label} · ${archive.flight_count} flights · ${new Date(Number(archive.archived_at)).toLocaleString()} `);
    const button=text('button','Download archived CSV','button secondary') as HTMLButtonElement;
    button.onclick=async()=>{try{const saved=await api(`/api/admin/archives/${archive.id}`);exportRuns(saved.runs,`dock-archive-${archive.id}.csv`);}catch(e){status(displayError(e));}};
    row.append(button);$('event-archives').append(row);
  }
  if(!data.archives.length)$('event-archives').textContent='No events archived yet.';
  renderRuns();
}
$('staff-login').addEventListener('submit',async e=>{e.preventDefault(); const login=e.target as HTMLFormElement; const input=login.elements.namedItem('password') as HTMLInputElement;
  try{await api('/api/admin/login','POST',{password:input.value});input.value='';await load();status('Staff session active.');}catch(err){input.value='';status(displayError(err));}});
form.addEventListener('submit',async e=>{e.preventDefault();const payload:any={event_name:field('event_name').value,join_url:field('join_url').value,event_open:field('event_open').checked,leaderboard_public:field('leaderboard_public').checked,enabled_tracks:TRACKS.filter(t=>field(t).checked)};
  if(field('clear_code').checked)payload.event_code='';else if(field('event_code').value)payload.event_code=field('event_code').value;
  try{await api('/api/admin/settings','PATCH',payload);field('event_code').value='';field('clear_code').checked=false;status('Event settings saved.');}catch(err){status(displayError(err));}});
for(const id of ['run-search','track-filter','outcome-filter'])$(id).addEventListener('input',renderRuns);
$('refresh-admin').onclick=()=>load().then(()=>status('Records refreshed.')).catch(e=>status(displayError(e)));
$('logout-admin').onclick=async()=>{await api('/api/logout','POST'); location.reload();};
function exportRuns(records:Run[],filename:string){
  const keys=['id','callsign','track','challenge','outcome','time_s','pulses','assisted','model','source','excluded','exclusion_reason','message','rules_version','created_at','finished_at'] as const;
  const escape=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const csv=[keys.join(','),...records.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('export-csv').onclick=()=>exportRuns(runs,'dock-the-capsule-flights.csv');
$('archive-reset-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$<HTMLButtonElement>('archive-reset');button.disabled=true;
 try{await api('/api/admin/archive-reset','POST',{event_id:eventId,label:$<HTMLInputElement>('archive-label').value,confirm:$<HTMLInputElement>('archive-confirm').value});
 $<HTMLFormElement>('archive-reset-form').reset();await load();status('Event archived. Fresh leaderboard ready.');}
 catch(e){status(displayError(e));}finally{button.disabled=false;}
});
void load().catch(e=>{if((e as any).status!==401)status(displayError(e));});

