import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,digest,makeBoards,passwordHash} from '../src/server/app';
import {MemoryStore} from '../src/server/store';
import {RULES_VERSION,type Run,type Settings} from '../src/shared/types';

const state={status:'success',time_s:85.3,range:.15,attitude:{roll:0,pitch:.1,yaw:0},velocity:{x:-.12,y:0,z:0},gravity:true};
function fixture(){const store=new MemoryStore();const app=createApp(store,{eventCode:'DOCK',siteUrl:'https://dock.test',adminPasswordHash:passwordHash('long-staff-password')});
  // Flights are submitted immediately in tests; backdate launches so the flight clock stays behind real time.
  const createRun=store.createRun.bind(store);store.createRun=async run=>{run.created_at-=600000;return createRun(run);};
  let serial=0;
  async function call(path:string,method='GET',body?:unknown,token='',origin='https://dock.test',cookie=''){
    const headers:Record<string,string>={};if(token)headers.Authorization=`Bearer ${token}`;if(origin)headers.Origin=origin;if(cookie)headers.Cookie=cookie;
    const response=await app(new Request('https://dock.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),'test-'+serial++);
    return {response,data:await response.json()};
  }
  async function join(name='TEST CREW'){return (await call('/api/join','POST',{callsign:name,event_code:'DOCK'})).data.token as string;}
  async function launch(token:string,track='autopilot'){return (await call('/api/runs','POST',{track,source:'local',rules_version:RULES_VERSION,start_version:1},token)).data.id as string;}
  return {store,call,join,launch};
}

test('ranked starts are shared across tracks and legacy clients cannot enter randomized events',async()=>{
  const f=fixture(), token=await f.join();
  const starts=[];
  for(const track of ['manual','autopilot','agent']){
    const result=await f.call('/api/runs','POST',{track,rules_version:RULES_VERSION,start_version:1},token);
    assert.equal(result.response.status,201);starts.push(result.data.start_position);
    assert.deepEqual((await f.store.run(result.data.id))?.start_position,result.data.start_position);
  }
  assert.deepEqual(starts[0],starts[1]);assert.deepEqual(starts[1],starts[2]);
  assert.equal((await f.call('/api/runs','POST',{track:'manual',rules_version:RULES_VERSION},token)).response.status,409);
  const settings=await f.store.settings();delete settings!.start_seed;await f.store.saveSettings(settings!);
  const legacy=await f.call('/api/runs','POST',{track:'manual',rules_version:RULES_VERSION},token);
  assert.equal(legacy.response.status,201);assert.equal(legacy.data.start_position,undefined);
});

test('only successful public standings receive CDN caching, with separate origin and filter keys',async()=>{
  const f=fixture();
  const publicBoard=await f.call('/api/leaderboard?assisted=solo');
  assert.equal(publicBoard.response.headers.get('netlify-cdn-cache-control'),'public, durable, max-age=30');
  assert.equal(publicBoard.response.headers.get('netlify-vary'),'query=assisted|challenge, header=Origin');
  assert.equal((await f.call('/api/admin')).response.headers.get('netlify-cdn-cache-control'),null);
  const settings=(await f.store.settings())!;settings.leaderboard_public=false;
  const denied=await f.call('/api/leaderboard');
  assert.equal(denied.response.status,401);assert.equal(denied.response.headers.get('netlify-cdn-cache-control'),null);
  const token=await f.join();
  assert.equal((await f.call('/api/leaderboard','GET',undefined,token)).response.headers.get('netlify-cdn-cache-control'),null);
  settings.leaderboard_public=true;
  f.store.runs=async()=>{throw new Error('storage unavailable');};
  const failed=await f.call('/api/leaderboard');
  assert.equal(failed.response.status,503);assert.equal(failed.response.headers.get('netlify-cdn-cache-control'),null);
});

test('challenge runs validate the track and stay out of standard standings',async()=>{
  const f=fixture(),token=await f.join();
  const payload={track:'autopilot',source:'local',rules_version:RULES_VERSION,start_version:1,challenge_version:1,challenge:'noise'};
  assert.equal((await f.call('/api/runs','POST',{...payload,track:'manual'},token)).response.status,400);
  assert.equal((await f.call('/api/runs','POST',{...payload,challenge:'unknown'},token)).response.status,400);
  const launched=await f.call('/api/runs','POST',payload,token);assert.equal(launched.response.status,201);
  assert.equal(launched.data.challenge,'noise');
  const result=await f.call(`/api/runs/${launched.data.id}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:12,state},token);
  assert.equal(result.response.status,200);
  assert.equal((await f.call('/api/leaderboard')).data.boards.autopilot.length,0);
  const board=await f.call('/api/leaderboard?challenge=noise');assert.equal(board.data.boards.autopilot.length,1);
  assert.equal((await f.call('/api/leaderboard?challenge=broken')).data.boards.autopilot.length,0);
  assert.equal((await f.call('/api/leaderboard?challenge=unknown')).response.status,400);
});
test('event code, run ownership, and expired credentials are enforced',async()=>{
  const f=fixture();assert.equal((await f.call('/api/join','POST',{callsign:'CREW',event_code:'wrong'})).response.status,401);
  const a=await f.join('ALPHA'), b=await f.join('BRAVO'), id=await f.launch(a);
  assert.equal((await f.call(`/api/runs/${id}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:120,state},b)).response.status,404);
  const session=await f.store.session(digest(a));session!.expires_at=Date.now()-1;
  assert.equal((await f.call('/api/runs','POST',{track:'agent',rules_version:RULES_VERSION},a)).response.status,401);
});

test('archive/reset preserves history, isolates late uploads and rejects repeated or unauthorized resets',async()=>{
  const f=fixture(), token=await f.join(), id=await f.launch(token);
  const scored=await f.launch(token);
  await f.call(`/api/runs/${scored}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:120,state},token);
  await f.store.exclude(scored,true,'Review retained');
  const payload={event_id:'legacy',label:'Rehearsal',confirm:'ARCHIVE AND RESET'};
  assert.equal((await f.call('/api/admin/archive-reset','POST',payload,token)).response.status,401);
  const login=await f.call('/api/admin/login','POST',{password:'long-staff-password'});
  const cookie=login.response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await f.call('/api/admin/archive-reset','POST',{...payload,confirm:'RESET'},'','https://dock.test',cookie)).response.status,400);
  const reset=await f.call('/api/admin/archive-reset','POST',payload,'','https://dock.test',cookie);
  assert.equal(reset.response.status,200);
  const archived=await f.call(`/api/admin/archives/${reset.data.archive_id}`,'GET',undefined,'','https://dock.test',cookie);
  assert.equal(archived.data.runs[0].id,id);assert.equal(archived.data.settings.event_code_hash,undefined);
  const retained=archived.data.runs.find((r:Run)=>r.id===scored);
  assert.equal(retained.time_s,85.3);assert.equal(retained.excluded,true);assert.equal(retained.exclusion_reason,'Review retained');
  assert.equal((await f.call('/api/leaderboard')).data.stats.attempts,0);
  assert.equal((await f.call(`/api/runs/${id}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:120,state},token)).response.status,409);
  assert.equal((await f.call('/api/admin/archive-reset','POST',payload,'','https://dock.test',cookie)).response.status,409);
  assert.equal((await f.call('/api/admin','GET',undefined,'','https://dock.test',cookie)).data.archives.length,1);
  const next=await f.launch(token);assert.notEqual(next,id);assert.equal((await f.call('/api/admin','GET',undefined,'','https://dock.test',cookie)).data.runs.length,1);
  assert.equal((await f.call(`/api/admin/archives/${reset.data.archive_id}`,'GET',undefined,token)).response.status,401);
});

test('TV exposes the current join code and follows staff changes without exposing staff credentials',async()=>{
  const f=fixture();
  assert.equal((await f.call('/api/leaderboard')).data.event_code,'DOCK');
  assert.equal((await f.call('/api/config')).data.event_code_hash,undefined);
  const login=await f.call('/api/admin/login','POST',{password:'long-staff-password'});
  const cookie=login.response.headers.get('set-cookie')!.split(';')[0];
  await f.call('/api/admin/settings','PATCH',{event_code:'NEXT'},'','https://dock.test',cookie);
  assert.equal((await f.call('/api/leaderboard')).data.event_code,'NEXT');
  assert.equal((await f.call('/api/join','POST',{callsign:'CREW',event_code:'DOCK'})).response.status,401);
  await f.call('/api/admin/settings','PATCH',{event_code:''},'','https://dock.test',cookie);
  assert.equal((await f.call('/api/leaderboard')).data.event_code,'');
});
test('acknowledged score uploads are idempotent, including concurrent retries',async()=>{
  const f=fixture(), token=await f.join(), id=await f.launch(token);
  const body={outcome:'success',time_s:85.3,pulses:120,state};
  const uploads=await Promise.all([f.call(`/api/runs/${id}/finish`,'POST',body,token),f.call(`/api/runs/${id}/finish`,'POST',body,token)]);
  assert.ok(uploads.every(x=>x.response.status===200));
  const board=(await f.call('/api/leaderboard')).data;
  assert.equal(board.boards.autopilot.length,1);assert.equal(board.stats.dockings,1);
  assert.equal(board.boards.autopilot[0].time_s,85.3);
});
test('invalid docking telemetry and clock mismatches cannot enter the leaderboard',async()=>{
  const f=fixture(),token=await f.join(),id=await f.launch(token);
  for(const bad of [{...state,range:2},{...state,attitude:{roll:1,pitch:0,yaw:0}},{...state,velocity:{x:1,y:0,z:0}},{...state,time_s:1},{...state,attitude:{roll:null,pitch:0,yaw:0}}]){
    assert.equal((await f.call(`/api/runs/${id}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:120,state:bad},token)).response.status,400);
  }
  assert.equal((await f.call('/api/leaderboard')).data.stats.dockings,0);
});
test('staff session authorizes reversible exclusions; participant cannot moderate',async()=>{
  const f=fixture(),token=await f.join(),id=await f.launch(token);
  await f.call(`/api/runs/${id}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:120,state},token);
  assert.equal((await f.call(`/api/admin/runs/${id}`,'PATCH',{excluded:true},token)).response.status,401);
  const login=await f.call('/api/admin/login','POST',{password:'long-staff-password'});
  assert.equal(login.response.status,200);assert.equal(login.data.token,undefined);
  const cookie=login.response.headers.get('set-cookie')!.split(';')[0];
  await f.call(`/api/admin/runs/${id}`,'PATCH',{excluded:true,reason:'Test flight'},'', 'https://dock.test',cookie);
  assert.equal((await f.call('/api/leaderboard')).data.boards.autopilot.length,0);
  await f.call(`/api/admin/runs/${id}`,'PATCH',{excluded:false},'', 'https://dock.test',cookie);
  assert.equal((await f.call('/api/leaderboard')).data.boards.autopilot.length,1);
});
test('localhost result submissions use restricted CORS; foreign origins are denied',async()=>{
  const f=fixture();const local=await f.call('/api/join','POST',{callsign:'LOCAL',event_code:'DOCK'},'','http://127.0.0.1:49500');
  assert.equal(local.response.status,200);assert.equal(local.response.headers.get('access-control-allow-origin'),'http://127.0.0.1:49500');assert.equal(local.response.headers.get('set-cookie'),null);
  assert.equal((await f.call('/api/join','POST',{callsign:'EVIL',event_code:'DOCK'},'','https://untrusted.test')).response.status,403);
  assert.equal((await f.call('/api/admin/login','POST',{password:'long-staff-password'},'','http://127.0.0.1:49500')).response.status,403);
});
test('boards use best per callsign, pulse tiebreaks, and assisted filtering',()=>{
  const settings:Settings={event_name:'Test',event_code_hash:'',event_open:true,leaderboard_public:true,join_url:'https://dock.test',enabled_tracks:['manual','autopilot','agent'],rules_version:RULES_VERSION};
  const base:Run={id:'1',participant_id:'a',callsign:'CREW',track:'manual',source:'hosted',assisted:false,model:'',rules_version:RULES_VERSION,created_at:0,outcome:'success',time_s:100,pulses:50,excluded:false};
  const rows=[base,{...base,id:'2',callsign:'crew',time_s:90,pulses:100,assisted:true},{...base,id:'3',callsign:'OTHER',time_s:90,pulses:80}];
  const board=makeBoards(rows,settings);assert.equal(board.boards.manual.length,2);assert.equal(board.boards.manual[0].callsign,'OTHER');
  assert.equal(makeBoards(rows,settings,'solo').boards.manual.find(r=>r.callsign==='CREW')?.time_s,100);
});
