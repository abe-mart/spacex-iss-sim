import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { RULES_VERSION, TRACKS, type BoardData, type Run, type Session, type Settings, type Track } from "../shared/types";
import type { Store } from "./store";
import {eventStart} from '../shared/start';

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`;
}
function equal(a: string, b: string) {
  const left=Buffer.from(a), right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}
function checkPassword(password: string, encoded: string) {
  const [kind,salt,expected]=encoded.split("$");
  return kind==='scrypt' && !!salt && !!expected && equal(scryptSync(password,salt,32).toString("hex"),expected);
}
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface Options { adminPasswordHash?: string; eventCode?: string; siteUrl?: string; development?: boolean }
export function isLoopbackOrigin(origin: string) {
  try { const u=new URL(origin); return u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname); }
  catch { return false; }
}
function publicSettings(s: Settings, development: boolean) {
  const {event_code_hash, ...rest}=s;
  return {...rest, join_required: !!event_code_hash, development};
}
function cleanName(value: unknown) {
  if(typeof value !== 'string') throw new ApiError(400,'Enter a callsign.');
  const name=value.trim().replace(/\s+/g,' ');
  if(name.length<2 || name.length>24 || !/^[\p{L}\p{N} ._'\-]+$/u.test(name)) throw new ApiError(400,'Callsigns need 2–24 letters, numbers, spaces, or simple punctuation.');
  return name;
}
function number(value: unknown, lo: number, hi: number, name: string) {
  if(typeof value!=='number' || !Number.isFinite(value) || value<lo || value>hi) throw new ApiError(400,`Invalid ${name}.`);
  return value;
}
export function validateFinish(body: Record<string, unknown>, run: Run) {
  const outcome=body.outcome;
  if(!['success','fail','abort'].includes(String(outcome))) throw new ApiError(400,'Invalid flight outcome.');
  const time=number(body.time_s,0,7200,'simulation time');
  const pulses=number(body.pulses,0,100000,'pulse count');
  if(!Number.isInteger(pulses)) throw new ApiError(400,'Pulse count must be an integer.');
  if(outcome==='success') {
    if(time<5) throw new ApiError(400,'Docking time is implausibly short.');
    const state=body.state as Record<string,unknown> | undefined;
    if(!state || state.status!=='success') throw new ApiError(400,'Docking telemetry is required.');
    if(state.gravity!==true) throw new ApiError(400,'Gravity must remain enabled for event flights.');
    number(state.range,0,0.2,'docking range');
    if(Number(state.range)>=0.2) throw new ApiError(400,'Capsule is outside the docking range.');
    for(const group of ['attitude','velocity'] as const) {
      const vector=state[group] as Record<string,unknown> | undefined;
      const axes=group==='attitude'?['roll','pitch','yaw']:['x','y','z'];
      const limit=group==='attitude'?0.2:0.24;
      if(!vector) throw new ApiError(400,'Complete docking telemetry is required.');
      for(const axis of axes) number(vector[axis],-limit,limit,`${group} ${axis}`);
    }
    if(Math.abs(number(state.time_s,0,7200,'telemetry time')-time)>0.02) throw new ApiError(400,'Flight clock does not match telemetry.');
  }
  if(run.track==='manual' && time>(Date.now()-run.created_at)/1000+30) throw new ApiError(400,'Manual flight clock exceeds elapsed time.');
  return {outcome: outcome as Run['outcome'], time_s: Math.round(time*1000)/1000, pulses,
    message: typeof body.message==='string'?body.message.slice(0,200):'', finished_at:Date.now()};
}
export function makeBoards(runs: Run[], settings: Settings, assisted='all'): BoardData {
  const eligible=runs.filter(r=>!r.excluded && r.rules_version===settings.rules_version);
  const boards: BoardData['boards']={manual:[],autopilot:[],agent:[]};
  for(const track of TRACKS) {
    const best=new Map<string,Run>();
    for(const run of eligible.filter(r=>r.track===track && r.outcome==='success')) {
      if(track==='manual' && assisted!=='all' && run.assisted!==(assisted==='capcom')) continue;
      const key=run.callsign.toLocaleLowerCase('en-US');
      const prev=best.get(key);
      if(!prev || run.time_s!<prev.time_s! || (run.time_s===prev.time_s && run.pulses!<prev.pulses!)) best.set(key,run);
    }
    boards[track]=[...best.values()].sort((a,b)=>a.time_s!-b.time_s! || a.pulses!-b.pulses! || a.created_at-b.created_at).slice(0,8).map(r=>({
      id:r.id, callsign:r.callsign,track:r.track,assisted:r.assisted,model:r.model,
      time_s:r.time_s!,pulses:r.pulses!,created_at:r.finished_at || r.created_at,
    }));
  }
  return {event_code:settings.event_code_display || '',event_name:settings.event_name,join_url:settings.join_url,rules_version:settings.rules_version,boards,
    stats:{attempts:eligible.filter(r=>r.outcome!=='flying').length,dockings:eligible.filter(r=>r.outcome==='success').length,
      crews:new Set(eligible.map(r=>r.callsign.toLocaleLowerCase('en-US'))).size},updated_at:Date.now()};
}

export function createApp(store: Store, options: Options={}) {
  async function settings(origin: string) {
    let s=await store.settings();
    if(!s) {
      s={start_seed:randomUUID(),event_name:'Dock the Capsule',event_code_hash:options.eventCode?digest(options.eventCode):'',event_open:true,
        leaderboard_public:true,join_url:options.siteUrl || origin,enabled_tracks:[...TRACKS],rules_version:RULES_VERSION};
      await store.saveSettings(s);
    }
    if(s.event_code_display===undefined){
      s.event_code_display=options.eventCode && digest(options.eventCode)===s.event_code_hash?options.eventCode:'';
      await store.saveSettings(s);
    }
    return s;
  }
  return async function handle(request: Request, ip='local') {
    const url=new URL(request.url), origin=request.headers.get('Origin');
    const allowed=!origin || origin===url.origin || origin===options.siteUrl || isLoopbackOrigin(origin);
    const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    // Local flight pages submit to the hosted event API using bearer credentials.
    if(origin && allowed && origin!==url.origin) {
      headers.set('Access-Control-Allow-Origin',origin);
      headers.set('Access-Control-Allow-Headers','Content-Type, Authorization');
      headers.set('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
      headers.set('Vary','Origin');
    }
    const respond=(data: unknown, status=200) => new Response(JSON.stringify(data),{status,headers});
    try {
      if(!allowed) throw new ApiError(403,'Origin is not allowed.');
      if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
      const cookies=Object.fromEntries((request.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=')));
      const rawToken=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || cookies.dock_session || '';
      const who=async (role?: string) => {
        const s=await store.session(digest(rawToken));
        if(!s || (role && s.role!==role)) throw new ApiError(401,role==='admin'?'Staff login required.':'Join the event first.');
        return s;
      };
      const body=async () => {
        const text=await request.text();
        if(text.length>16384) throw new ApiError(413,'Request is too large.');
        let b; try { b=JSON.parse(text || '{}'); } catch { throw new ApiError(400,'Send valid JSON.'); }
        if(!b || Array.isArray(b) || typeof b!=='object') throw new ApiError(400,'Send a JSON object.');
        return b as Record<string,unknown>;
      };
      const rate=async (key: string, limit: number, seconds: number) => {
        if(!await store.permit(digest(key),limit,seconds)) throw new ApiError(429,'Too many requests. Try again shortly.');
      };
      const session=async (role: Session['role'], callsign: string) => {
        const token=randomBytes(32).toString('hex');
        const s: Session={token_hash:digest(token),participant_id:randomUUID(),callsign,role,expires_at:Date.now()+8*3600000};
        await store.putSession(s);
        // Cross-origin local pages use the returned participant token, never staff cookies.
        if(!origin || origin===url.origin) headers.set('Set-Cookie',`dock_session=${token}; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax${url.protocol==='https:'?'; Secure':''}`);
        return {token,callsign,role,expires_at:s.expires_at};
      };
      const s=await settings(url.origin);
      const path=url.pathname;
      if(path==='/api/config' && request.method==='GET') return respond(publicSettings(s,!!options.development));
      if(path==='/api/leaderboard' && request.method==='GET') {
        if(!s.leaderboard_public) await who();
        const board=makeBoards(await store.runs(),s,url.searchParams.get('assisted') || 'all');
        if(s.leaderboard_public) {
          // Share public standings at the CDN; private standings and staff data stay uncached.
          headers.set('Netlify-CDN-Cache-Control','public, durable, max-age=30');
          headers.set('Netlify-Vary','query=assisted, header=Origin');
          headers.set('Vary','Origin');
        }
        return respond(board);
      }
      if(path==='/api/join' && request.method==='POST') {
        await rate(`join:${ip}`,40,60);
        const b=await body();
        if(!s.event_open) throw new ApiError(409,'The event is closed.');
        if(s.event_code_hash && !equal(digest(String(b.event_code || '')),s.event_code_hash)) throw new ApiError(401,'That event code did not match.');
        return respond(await session('participant',cleanName(b.callsign)));
      }
      if(path==='/api/admin/login' && request.method==='POST') {
        if(origin && isLoopbackOrigin(origin) && origin!==url.origin) throw new ApiError(403,'Open staff login on the event website.');
        await rate(`admin:${ip}`,5,60);
        if(!options.adminPasswordHash) throw new ApiError(503,'Staff authentication has not been configured.');
        const b=await body(), pass=String(b.password || '');
        if(pass.length>128 || !checkPassword(pass,options.adminPasswordHash)) throw new ApiError(401,'Password did not match.');
        const login=await session('admin','Mission Control');
        return respond({role:login.role,expires_at:login.expires_at});
      }
      if(path==='/api/logout' && request.method==='POST') {
        await store.deleteSession(digest(rawToken));
        headers.set('Set-Cookie','dock_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
        return respond({ok:true});
      }
      if(path==='/api/runs' && request.method==='POST') {
        const user=await who(); await rate(`runs:${user.participant_id}`,15,60);
        if(!s.event_open) throw new ApiError(409,'The event is closed.');
        const b=await body();
        if(!s.enabled_tracks.includes(b.track as Track)) throw new ApiError(400,'This track is not available.');
        if(b.rules_version!==s.rules_version) throw new ApiError(409,'Update your starter bundle; its rules version is out of date.');
        if(s.start_seed && b.start_version!==1)throw new ApiError(409,'This event uses randomized starts. Reload the website or download the latest starter bundle.');
        const run: Run={event_id:s.event_id || 'legacy',id:randomUUID(),participant_id:user.participant_id,callsign:user.callsign,track:b.track as Track,
          source:b.source==='local'?'local':'hosted',assisted:b.assisted===true,model:typeof b.model==='string'?b.model.slice(0,80):'',
          rules_version:s.rules_version,created_at:Date.now(),outcome:'flying',excluded:false};
        if(s.start_seed)run.start_position=eventStart(s.start_seed);
        await store.createRun(run); return respond({id:run.id,created_at:run.created_at,start_position:run.start_position},201);
      }
      const finish=path.match(/^\/api\/runs\/([a-f0-9-]{36})\/(finish|abort)$/);
      if(finish && request.method==='POST') {
        const user=await who(); const run=await store.run(finish[1]);
        if(!run || run.participant_id!==user.participant_id) throw new ApiError(404,'Flight not found.');
        if((run.event_id||'legacy')!==(s.event_id||'legacy'))throw new ApiError(409,'This flight belongs to an archived event. Join and launch a new flight.');
        if(run.outcome!=='flying') return respond({ok:true,run,already_recorded:true});
        const b=await body();
        const patch=validateFinish(finish[2]==='abort'?{...b,outcome:'abort',time_s:b.time_s || 0,pulses:b.pulses || 0}:b,run);
        const saved=await store.finish(run.id,user.participant_id,patch);
        return respond({ok:true,run:saved || await store.run(run.id)});
      }
      if(path==='/api/admin' && request.method==='GET') {
        await who('admin'); return respond({settings:publicSettings(s,!!options.development),runs:await store.runs(),archives:await store.archives()});
      }
      if(path==='/api/admin/archive-reset' && request.method==='POST') {
        await who('admin');const b=await body();
        if(b.confirm!=='ARCHIVE AND RESET')throw new ApiError(400,'Type ARCHIVE AND RESET to confirm.');
        if(b.event_id!==(s.event_id||'legacy'))throw new ApiError(409,'The event changed. Refresh before resetting.');
        const label=typeof b.label==='string'?b.label.trim().slice(0,80):'';
        if(!label)throw new ApiError(400,'Give this archive a name.');
        const archive={id:randomUUID(),label,archived_at:Date.now(),settings:s};
        const next={...s,event_id:randomUUID(),start_seed:randomUUID()};
        if(!await store.archiveAndReset(s.event_id||'legacy',archive,next))throw new ApiError(409,'The event already changed. Refresh before resetting.');
        return respond({ok:true,archive_id:archive.id,settings:publicSettings(next,!!options.development)});
      }
      const archived=url.pathname.match(/^\/api\/admin\/archives\/([a-f0-9-]{36})$/);
      if(archived && request.method==='GET') {
        await who('admin');const archive=await store.archive(archived[1]);
        if(!archive)throw new ApiError(404,'Archive not found.');
        return respond({...archive,settings:publicSettings(archive.settings,!!options.development)});
      }
      if(path==='/api/admin/settings' && request.method==='PATCH') {
        await who('admin'); const b=await body();
        const next={...s};
        if(typeof b.event_name==='string') { next.event_name=b.event_name.trim().slice(0,60); if(!next.event_name) throw new ApiError(400,'Event name is required.'); }
        if(typeof b.event_open==='boolean') next.event_open=b.event_open;
        if(typeof b.leaderboard_public==='boolean') next.leaderboard_public=b.leaderboard_public;
        if(typeof b.event_code==='string') { if(b.event_code.length>64) throw new ApiError(400,'Event code is too long.'); next.event_code_hash=b.event_code?digest(b.event_code):''; next.event_code_display=b.event_code; }
        if(typeof b.join_url==='string') { let u; try { u=new URL(b.join_url); } catch { throw new ApiError(400,'Enter a full join URL.'); }
          if(u.protocol!=='https:' && !isLoopbackOrigin(u.origin)) throw new ApiError(400,'Join URL must use HTTPS.'); next.join_url=u.href.slice(0,250); }
        if(Array.isArray(b.enabled_tracks)) { if(!b.enabled_tracks.length || b.enabled_tracks.some(t=>!TRACKS.includes(t as Track))) throw new ApiError(400,'Enable at least one valid track.'); next.enabled_tracks=[...new Set(b.enabled_tracks)] as Track[]; }
        await store.saveSettings(next); return respond(publicSettings(next,!!options.development));
      }
      const moderation=path.match(/^\/api\/admin\/runs\/([a-f0-9-]{36})$/);
      if(moderation && request.method==='PATCH') {
        await who('admin'); const b=await body();
        if(typeof b.excluded!=='boolean') throw new ApiError(400,'Set excluded to true or false.');
        const run=await store.exclude(moderation[1],b.excluded,typeof b.reason==='string'?b.reason.slice(0,160):'Staff review');
        if(!run) throw new ApiError(404,'Flight not found.'); return respond(run);
      }
      throw new ApiError(404,'Endpoint not found.');
    } catch(e) {
      if(e instanceof ApiError) return respond({error:e.message},e.status);
      console.error('Dock API storage/request error');
      return respond({error:'Event storage is unavailable. Your flight can continue; retry the score upload later.'},503);
    }
  };
}
