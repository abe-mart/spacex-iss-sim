import Anthropic from '@anthropic-ai/sdk';

export const CAPCOM_SYSTEM=`You are CAPCOM for a human docking a capsule with the ISS in a simulator. Be calm, brief, and practical: one or two sentences, under 35 words. Coach the plan and why, not a stream of commands. If nothing important has changed, say STANDBY. Never operate flight controls. Thruster pulses add persistent velocity/rates; opposite pulses brake. First zero attitude/rates, then lateral offsets, then approach slowly and brake early. Dock at range <0.2 m, attitude errors <=0.2 degrees, speed on each axis <=0.24 m/s. Trust supplied sign-correct guidance. Reply as plain text.`;
export class BrowserAI {
  private client: Anthropic | null=null;
  private controller: AbortController | null=null;
  model='';
  connect(key:string) { this.disconnect(); this.client=new Anthropic({apiKey:key,dangerouslyAllowBrowser:true,maxRetries:0,timeout:30000}); }
  disconnect() { this.controller?.abort();this.controller=null;this.client=null;this.model=''; }
  get connected() {return !!this.client;}
  async models() {
    if(!this.client)throw new Error('Connect your own Claude key first.');
    const page=await this.client.models.list(); return page.data.map(m=>({id:m.id,name:m.display_name}));
  }
  async ask(system:string,content:string) {
    if(!this.client || !this.model)throw new Error('Connect your key and select a model.');
    this.controller=new AbortController();
    const response=await this.client.messages.create({model:this.model,max_tokens:160,system,messages:[{role:'user',content}]},{signal:this.controller.signal});
    this.controller=null;
    return response.content.filter(b=>b.type==='text').map(b=>b.type==='text'?b.text:'').join('\n');
  }
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
