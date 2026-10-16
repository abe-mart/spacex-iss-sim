import {api} from './client';

/** AI CAPCOM runs through the event server, which holds the Claude API key. */
export async function askCapcom(model:string, telemetry:unknown, recent:string[], crewMessage='') {
  const reply=await api<{text:string}>('/api/capcom','POST',{model,telemetry,recent,crew_message:crewMessage});
  return reply.text;
}
export function capcomGuidance(state:any) {
  if(!state.position)return state;
  const corrections:string[]=[];
  for(const [axis,less,more] of [['roll','roll_right','roll_left'],['pitch','pitch_down','pitch_up'],['yaw','yaw_right','yaw_left']]) {
    const angle=state.attitude[axis], rate=state.rotation_rate[axis];
    if(Math.abs(angle)>.2)corrections.push(`${axis} ${angle.toFixed(1)} deg: correct with ${angle>0?less:more}; brake before zero. Actual rate ${rate.toFixed(2)} deg/s.`);
  }
  for(const [axis,less,more] of [['y','translate_left','translate_right'],['z','translate_down','translate_up']]) {
    const value=state.position[axis];if(Math.abs(value)>.15)corrections.push(`${axis} offset ${value.toFixed(2)} m: ${value>0?less:more}, then counter-pulse to stop.`);
  }
  return {time_s:state.time_s,position:state.position,velocity:state.velocity,attitude:state.attitude,rotation_rate:state.rotation_rate,
    range:state.range,range_rate:state.range_rate,recommended_closing_mps:Math.max(.08,Math.min(3,state.range*.015)),corrections};
}
