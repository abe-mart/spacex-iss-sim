import { RULES_VERSION } from "../shared/types";
export { RULES_VERSION };
export const $ = <T extends HTMLElement=HTMLElement>(id: string) => document.getElementById(id) as T;
export function apiOrigin() {
  const supplied=new URLSearchParams(location.search).get('event');
  if(supplied) { const u=new URL(supplied); if(u.protocol!=='https:' && !['localhost','127.0.0.1'].includes(u.hostname)) throw new Error('Event address must use HTTPS.'); return u.origin; }
  return location.origin;
}
function tokenKey() { return `dock.session.${apiOrigin()}`; }
export function sessionToken() { try { return sessionStorage.getItem(tokenKey()) || ''; } catch { return ''; } }
export function rememberSession(token: string, callsign: string) {
  try { sessionStorage.setItem(tokenKey(),token); localStorage.setItem('dock.callsign',callsign); } catch { /* private browser mode */ }
}
export function callsign() { try { return localStorage.getItem('dock.callsign') || ''; } catch { return ''; } }
export async function api<T=any>(path: string, method='GET', body?: unknown): Promise<T> {
  const headers: Record<string,string>={'Content-Type':'application/json'};
  const staff=path.startsWith('/api/admin') || (path==='/api/logout' && location.pathname.startsWith('/admin'));
  const token=staff?'':sessionToken(); if(token) headers.Authorization=`Bearer ${token}`;
  const response=await fetch(apiOrigin()+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
    credentials:apiOrigin()===location.origin?'same-origin':'omit',signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({error:'The event service did not return a response.'}));
  if(!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`),{status:response.status});
  return data as T;
}
export function text(tag: string, content: string, cls='') {
  const e=document.createElement(tag); e.textContent=content; if(cls) e.className=cls; return e;
}
export function flightTime(seconds: number) {
  if(seconds<60) return seconds.toFixed(1);
  return `${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
}
export function displayError(error: unknown) { return error instanceof Error?error.message:'Connection interrupted. Please retry.'; }
