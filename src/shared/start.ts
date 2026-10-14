export interface StartPosition {x:number;y:number;z:number}
// All ranked flights in an event use this same bounded scenario.
export function eventStart(seed:string):StartPosition {
  let hash=2166136261;
  for(const c of seed)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  const random=()=>{hash=(Math.imul(hash,1664525)+1013904223)>>>0;return hash/4294967296;};
  const angle=random()*Math.PI*2;
  return {x:200,y:Math.round(Math.cos(angle)*32*1000)/1000,z:Math.round(Math.sin(angle)*32*1000)/1000};
}
