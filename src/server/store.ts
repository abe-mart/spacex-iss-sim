import { neon } from "@neondatabase/serverless";
import type { Run, Session, Settings, EventArchive, ArchiveSummary } from "../shared/types";

export interface Store {
  settings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<void>;
  putSession(session: Session): Promise<void>;
  session(hash: string): Promise<Session | null>;
  deleteSession(hash: string): Promise<void>;
  createRun(run: Run): Promise<void>;
  run(id: string): Promise<Run | null>;
  finish(id: string, participant: string, patch: Partial<Run>): Promise<Run | null>;
  exclude(id: string, excluded: boolean, reason: string): Promise<Run | null>;
  runs(): Promise<Run[]>;
  /** Adds `amount` (default 1) to a windowed counter; true while the total stays within `limit`. */
  permit(key: string, limit: number, windowSeconds: number, amount?: number): Promise<boolean>;
  archiveAndReset(expected:string, archive:Omit<EventArchive,'runs'>, next:Settings):Promise<boolean>;
  archives():Promise<ArchiveSummary[]>;
  archive(id:string):Promise<EventArchive|null>;
}

export class NeonStore implements Store {
  private sql;
  constructor(url: string) { this.sql = neon(url); }
  async settings() {
    const rows = await this.sql`SELECT data FROM dock_settings WHERE id = 'event'`;
    return rows[0]?.data as Settings || null;
  }
  async saveSettings(settings: Settings) {
    const rows=await this.sql`INSERT INTO dock_settings (id, data) VALUES ('event', ${JSON.stringify(settings)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
      WHERE COALESCE(dock_settings.data->>'event_id','legacy')=COALESCE(EXCLUDED.data->>'event_id','legacy') RETURNING id`;
    if(!rows.length)throw new Error('Event changed during settings update');
  }
  async putSession(session: Session) {
    await this.sql`DELETE FROM dock_sessions WHERE expires_at < ${Date.now()}`;
    await this.sql`INSERT INTO dock_sessions (token_hash, expires_at, data)
      VALUES (${session.token_hash}, ${session.expires_at}, ${JSON.stringify(session)}::jsonb)`;
  }
  async session(hash: string) {
    const rows = await this.sql`SELECT data FROM dock_sessions WHERE token_hash = ${hash} AND expires_at > ${Date.now()}`;
    return rows[0]?.data as Session || null;
  }
  async deleteSession(hash: string) { await this.sql`DELETE FROM dock_sessions WHERE token_hash = ${hash}`; }
  async createRun(run: Run) {
    const rows=await this.sql`INSERT INTO dock_runs (id, data) SELECT ${run.id}, ${JSON.stringify(run)}::jsonb
      FROM dock_settings WHERE id='event' AND COALESCE(data->>'event_id','legacy')=${run.event_id || 'legacy'} FOR SHARE RETURNING id`;
    if(!rows.length)throw new Error('Event changed during launch');
  }
  async run(id: string) {
    const rows = await this.sql`SELECT data FROM dock_runs WHERE id = ${id}`;
    return rows[0]?.data as Run || null;
  }
  async finish(id: string, participant: string, patch: Partial<Run>) {
    const rows = await this.sql`UPDATE dock_runs SET data = data || ${JSON.stringify(patch)}::jsonb
      WHERE id = ${id} AND data->>'participant_id' = ${participant} AND data->>'outcome' = 'flying'
      AND COALESCE(data->>'event_id','legacy')=(SELECT COALESCE(data->>'event_id','legacy') FROM dock_settings WHERE id='event') RETURNING data`;
    return rows[0]?.data as Run || null;
  }
  async exclude(id: string, excluded: boolean, reason: string) {
    const rows = await this.sql`UPDATE dock_runs SET data = data || ${JSON.stringify({excluded, exclusion_reason: reason})}::jsonb
      WHERE id = ${id} RETURNING data`;
    return rows[0]?.data as Run || null;
  }
  async runs() { return (await this.sql`SELECT data FROM dock_runs WHERE COALESCE(data->>'event_id','legacy')=(SELECT COALESCE(data->>'event_id','legacy') FROM dock_settings WHERE id='event') ORDER BY (data->>'created_at')::bigint DESC LIMIT 10000`).map(r => r.data as Run); }
  async archiveAndReset(expected:string, archive:Omit<EventArchive,'runs'>, next:Settings) {
    const rows=await this.sql`WITH current AS MATERIALIZED (
      SELECT data FROM dock_settings WHERE id='event' FOR UPDATE
    ), saved AS (
      INSERT INTO dock_settings(id,data)
      SELECT ${'archive:'+archive.id}, ${JSON.stringify(archive)}::jsonb || jsonb_build_object('settings',current.data,'runs',
        (SELECT COALESCE(jsonb_agg(data),'[]'::jsonb) FROM dock_runs WHERE COALESCE(data->>'event_id','legacy')=${expected}))
      FROM current WHERE COALESCE(current.data->>'event_id','legacy')=${expected} RETURNING id
    ) UPDATE dock_settings SET data=${JSON.stringify(next)}::jsonb WHERE id='event' AND EXISTS(SELECT 1 FROM saved) RETURNING id`;
    return rows.length>0;
  }
  async archives() {return (await this.sql`SELECT data->>'id' AS id,data->>'label' AS label,(data->>'archived_at')::bigint AS archived_at,jsonb_array_length(data->'runs') AS flight_count FROM dock_settings WHERE id LIKE 'archive:%' ORDER BY (data->>'archived_at')::bigint DESC`).map(r=>r as unknown as ArchiveSummary);}
  async archive(id:string) {const rows=await this.sql`SELECT data FROM dock_settings WHERE id=${'archive:'+id}`;return rows[0]?.data as EventArchive || null;}
  async permit(key: string, limit: number, windowSeconds: number, amount=1) {
    const now = Date.now(), expires = now + windowSeconds * 1000;
    const rows = await this.sql`INSERT INTO dock_limits (key, count, expires_at) VALUES (${key}, ${amount}, ${expires})
      ON CONFLICT (key) DO UPDATE SET count = CASE WHEN dock_limits.expires_at <= ${now} THEN ${amount} ELSE dock_limits.count + ${amount} END,
      expires_at = CASE WHEN dock_limits.expires_at <= ${now} THEN ${expires} ELSE dock_limits.expires_at END RETURNING count`;
    return rows[0].count <= limit;
  }
}

/** Test/development store. Never used as an implicit fallback in production. */
export class MemoryStore implements Store {
  
  data: {settings: Settings | null; sessions: Record<string, Session>; runs: Record<string, Run>; archives?:Record<string,EventArchive>} = {settings: null, sessions: {}, runs: {}};
  private limits = new Map<string, {count: number; expires: number}>();
  protected async changed() {}
  async settings() { return this.data.settings; }
  async saveSettings(settings: Settings) { this.data.settings = settings; await this.changed(); }
  async putSession(session: Session) { this.data.sessions[session.token_hash] = session; await this.changed(); }
  async session(hash: string) { const s=this.data.sessions[hash]; return s && s.expires_at > Date.now() ? s : null; }
  async deleteSession(hash: string) { delete this.data.sessions[hash]; await this.changed(); }
  async createRun(run: Run) { this.data.runs[run.id]=run; await this.changed(); }
  async run(id: string) { return this.data.runs[id] || null; }
  async finish(id: string, participant: string, patch: Partial<Run>) {
    const r=this.data.runs[id]; if (!r || r.participant_id !== participant || r.outcome !== 'flying') return null;
    Object.assign(r,patch); await this.changed(); return r;
  }
  async exclude(id: string, excluded: boolean, reason: string) {
    const r=this.data.runs[id]; if (!r) return null; Object.assign(r,{excluded,exclusion_reason:reason}); await this.changed(); return r;
  }
  async runs() { return Object.values(this.data.runs).filter(r=>(r.event_id||'legacy')===(this.data.settings?.event_id||'legacy')).sort((a,b)=>b.created_at-a.created_at); }
  async archiveAndReset(expected:string, archive:Omit<EventArchive,'runs'>, next:Settings) {
    if((this.data.settings?.event_id||'legacy')!==expected)return false;
    (this.data.archives ||= {})[archive.id]=structuredClone({...archive,settings:this.data.settings!,runs:Object.values(this.data.runs).filter(r=>(r.event_id||'legacy')===expected)});
    this.data.settings=next;await this.changed();return true;
  }
  async archives(){return Object.values(this.data.archives || {}).map(a=>({id:a.id,label:a.label,archived_at:a.archived_at,flight_count:a.runs.length}));}
  async archive(id:string){return this.data.archives?.[id]||null;}
  async permit(key: string, limit: number, seconds: number, amount=1) {
    let entry=this.limits.get(key); if(!entry || entry.expires<=Date.now()) { entry={count:0,expires:Date.now()+seconds*1000}; this.limits.set(key,entry); }
    return (entry.count+=amount)<=limit;
  }
}
