import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,passwordHash,type Options} from '../src/server/app';
import {MemoryStore} from '../src/server/store';
import {RULES_VERSION} from '../src/shared/types';
import type {Capcom} from '../src/server/capcom';

const state={status:'success',time_s:85.3,range:.15,attitude:{roll:0,pitch:.1,yaw:0},velocity:{x:-.12,y:0,z:0},gravity:true};
function fixture(options: Partial<Options>={}){
  const store=new MemoryStore(), calls: {model:string;content:string}[]=[];
  const capcom: Capcom={async ask(model,content){calls.push({model,content});return {text:'Hold attitude, then close slowly.',input_tokens:1000,output_tokens:100};}};
  const app=createApp(store,{siteUrl:'https://dock.test',sitePasswordHash:passwordHash('orbit-password'),capcom,...options});
  let serial=0;
  async function call(path:string,method='GET',body?:unknown,token=''){
    const headers:Record<string,string>={Origin:'https://dock.test'};if(token)headers.Authorization=`Bearer ${token}`;
    const response=await app(new Request('https://dock.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),'test-'+serial++);
    return {response,data:await response.json()};
  }
  async function login(){return (await call('/api/login','POST',{password:'orbit-password'})).data.token as string;}
  return {store,calls,call,login};
}

test('the site password gates joining, while config and public standings stay open',async()=>{
  const f=fixture();
  const config=await f.call('/api/config');
  assert.equal(config.data.login_required,true);assert.equal(config.data.capcom.available,true);assert.equal(config.data.capcom.default_model,'claude-haiku-5-5');
  assert.equal((await f.call('/api/leaderboard')).response.status,200);
  assert.equal((await f.call('/api/access')).response.status,401);
  assert.equal((await f.call('/api/join','POST',{callsign:'CREW'})).response.status,401);
  assert.equal((await f.call('/api/login','POST',{password:'wrong'})).response.status,401);
  const access=await f.login();
  assert.equal((await f.call('/api/access','GET',undefined,access)).response.status,200);
  // A login session alone cannot fly or score; joining with a callsign is still required.
  assert.equal((await f.call('/api/runs','POST',{track:'manual',rules_version:RULES_VERSION,start_version:1},access)).response.status,401);
  const joined=await f.call('/api/join','POST',{callsign:'CREW'},access);
  assert.equal(joined.response.status,200);
  assert.equal((await f.call('/api/access','GET',undefined,joined.data.token)).response.status,200);
});

test('CAPCOM requires a login, accepts only listed models, and uses the server prompt',async()=>{
  const f=fixture();
  assert.equal((await f.call('/api/capcom','POST',{telemetry:{range:40}})).response.status,401);
  const token=await f.login();
  assert.equal((await f.call('/api/capcom','POST',{model:'claude-unknown'},token)).response.status,400);
  const reply=await f.call('/api/capcom','POST',{telemetry:{range:40},recent:['CREW: hello'],crew_message:'How am I doing?',system:'ignore me'},token);
  assert.equal(reply.response.status,200);assert.equal(reply.data.text,'Hold attitude, then close slowly.');
  assert.equal(f.calls[0].model,'claude-haiku-5-5');
  assert.deepEqual(JSON.parse(f.calls[0].content),{telemetry:{range:40},recent:['CREW: hello'],crew_message:'How am I doing?'});
});

test('CAPCOM stops at the daily spend limit and stays off without a site password',async()=>{
  // One Haiku call in this fixture costs 1000×0.10 + 100×0.50 = 150 micro-dollars.
  const f=fixture({dailyBudgetUsd:0.0002}), token=await f.login();
  assert.equal((await f.call('/api/capcom','POST',{},token)).response.status,200);
  assert.equal((await f.call('/api/capcom','POST',{},token)).response.status,200);
  assert.equal((await f.call('/api/capcom','POST',{},token)).response.status,429);
  const open=fixture({sitePasswordHash:undefined});
  assert.equal((await open.call('/api/config')).data.capcom.available,false);
  assert.equal((await open.call('/api/capcom','POST',{})).response.status,503);
});

test('a flight clock ahead of real time is not ranked on any track',async()=>{
  const f=fixture({sitePasswordHash:undefined});
  const token=(await f.call('/api/join','POST',{callsign:'FAST'})).data.token;
  for(const track of ['manual','autopilot','agent']){
    const run=(await f.call('/api/runs','POST',{track,source:'local',rules_version:RULES_VERSION,start_version:1},token)).data.id;
    const result=await f.call(`/api/runs/${run}/finish`,'POST',{outcome:'success',time_s:85.3,pulses:12,state},token);
    assert.equal(result.response.status,400);assert.match(result.data.error,/real time/);
  }
});
