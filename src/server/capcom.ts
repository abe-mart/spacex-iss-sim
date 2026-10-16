import Anthropic from '@anthropic-ai/sdk';

/** Models offered to participants. Prices are USD per million tokens and drive the daily spend limit. */
export const CAPCOM_MODELS: Record<string,{label:string;input:number;output:number}> = {
  'claude-haiku-5-5': {label:'Claude Haiku 5.5',input:0.10,output:0.50},
  'claude-sonnet-5-5': {label:'Claude Sonnet 5.5',input:2.00,output:10.00},
  'claude-opus-5-5': {label:'Claude Opus 5.5',input:4.00,output:20.00},
};
export const DEFAULT_CAPCOM_MODEL = 'claude-haiku-5-5';
// Haiku has no server-side refusal fallback; Sonnet and Opus use the default fallback route.
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5','claude-opus-5-5']);

export const CAPCOM_SYSTEM = `You are CAPCOM for a human docking a capsule with the ISS in a simulator. Be calm, brief, and practical: one or two sentences, under 35 words. Tell the pilot exactly which keys to tap and how many times, and briefly why. If nothing important has changed since your recent transmissions, reply with exactly STANDBY and nothing else; otherwise never use the word STANDBY. Never operate flight controls.

Keyboard controls (each tap fires one thruster pulse):
- Roll: comma (,) rolls left, period (.) rolls right.
- Pitch: Up arrow pitches up, Down arrow pitches down.
- Yaw: Left arrow yaws left, Right arrow yaws right.
- Move: W up, S down, A left, D right, E forward (toward the station), Q backward (brakes the approach).

Each tap adds persistent velocity or rotation rate; tapping the opposite key brakes it. Plan: first zero attitude and rotation rates, then remove the sideways (y) and vertical (z) offsets, then approach with E and brake early with Q. Translations only move straight when attitude is near zero. Dock at range <0.2 m, attitude errors <=0.2 degrees, speed on each axis <=0.24 m/s. The telemetry's corrections already name the correct keys and directions; trust them. Reply as plain text.`;

export interface CapcomReply { text: string; input_tokens: number; output_tokens: number }
export interface Capcom { ask(model: string, content: string): Promise<CapcomReply> }

/** Cost of one call in micro-dollars (token counts × USD per million tokens). */
export function costMicros(model: string, reply: CapcomReply) {
  const price=CAPCOM_MODELS[model];
  return Math.ceil(reply.input_tokens*price.input + reply.output_tokens*price.output);
}

export function anthropicCapcom(apiKey: string): Capcom {
  // Netlify ends synchronous functions after about 10 seconds. A stalled coaching call is worse than a
  // skipped one, and the browser asks again on its next interval.
  const client=new Anthropic({apiKey,timeout:8000,maxRetries:0});
  return {
    async ask(model, content) {
      const params={model,max_tokens:1024,output_config:{effort:'low'},system:CAPCOM_SYSTEM,messages:[{role:'user',content}]};
      // The fallback parameters are newer than this SDK's type definitions.
      const response: any=FALLBACK_MODELS.has(model)
        ? await client.beta.messages.create({...params,betas:['server-side-fallback-2026-07-01'],fallbacks:'default'} as any)
        : await client.messages.create(params as any);
      const text=response.stop_reason==='refusal'?'':response.content.filter((b: any)=>b.type==='text').map((b: any)=>b.text).join('\n').trim();
      return {text,input_tokens:response.usage?.input_tokens || 0,output_tokens:response.usage?.output_tokens || 0};
    },
  };
}
