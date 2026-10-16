import {api} from './client';

/** AI CAPCOM runs through the event server, which holds the Claude API key. */
export async function askCapcom(model:string, telemetry:unknown, recent:string[], crewMessage='') {
  const reply=await api<{text:string}>('/api/capcom','POST',{model,telemetry,recent,crew_message:crewMessage});
  return reply.text;
}
// Keyboard keys for each simulator command, so CAPCOM can tell the pilot what to tap.
const KEYS: Record<string,string>={roll_left:'comma (,)',roll_right:'period (.)',pitch_up:'Up arrow',pitch_down:'Down arrow',yaw_left:'Left arrow',yaw_right:'Right arrow',
  translate_left:'A',translate_right:'D',translate_up:'W',translate_down:'S',translate_forward:'E',translate_backward:'Q'};
export function capcomGuidance(state:any) {
  if(!state.position)return state;
  const corrections:string[]=[];
  for(const [axis,less,more] of [['roll','roll_right','roll_left'],['pitch','pitch_down','pitch_up'],['yaw','yaw_right','yaw_left']]) {
    const angle=state.attitude[axis], rate=state.rotation_rate[axis];
    if(Math.abs(angle)>.2)corrections.push(`${axis} ${angle.toFixed(1)} deg: tap ${KEYS[angle>0?less:more]} to rotate toward zero, then tap ${KEYS[angle>0?more:less]} to brake before zero. Current rate ${rate.toFixed(2)} deg/s.`);
  }
  for(const [axis,less,more] of [['y','translate_left','translate_right'],['z','translate_down','translate_up']]) {
    const value=state.position[axis];if(Math.abs(value)>.15)corrections.push(`${axis} offset ${value.toFixed(2)} m: tap ${KEYS[value>0?less:more]}, then tap ${KEYS[value>0?more:less]} to stop the drift.`);
  }
  const recommended=Math.max(.08,Math.min(3,state.range*.015)), closing=-state.range_rate;
  if(closing<recommended*.6)corrections.push(`closing at ${closing.toFixed(2)} m/s, target about ${recommended.toFixed(2)} m/s: tap E to speed up the approach once attitude is zeroed.`);
  else if(closing>recommended*1.5)corrections.push(`closing at ${closing.toFixed(2)} m/s, faster than the ${recommended.toFixed(2)} m/s target: tap Q to slow down.`);
  return {time_s:state.time_s,position:state.position,velocity:state.velocity,attitude:state.attitude,rotation_rate:state.rotation_rate,
    range:state.range,range_rate:state.range_rate,recommended_closing_mps:recommended,corrections};
}
