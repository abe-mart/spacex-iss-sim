import {loadAgentBrief,copyBrief} from './agent-brief';
// Use the event's actual address in every copyable setup example.
for (const block of document.querySelectorAll('code')) {
  if (block.textContent?.includes('https://YOUR-SITE.netlify.app')) {
    block.textContent = block.textContent.replaceAll('https://YOUR-SITE.netlify.app', location.origin);
  }
}
const legacy=location.hash.slice(1);
if(['manual','autopilot','agent'].includes(legacy)&&location.pathname==='/docs')location.replace(`/setup/${legacy}/`);
const field=document.getElementById('agent-template') as HTMLTextAreaElement|null;
if(field){
 const status=document.getElementById('agent-template-status')!;
 loadAgentBrief().then(brief=>{field.value=brief;(document.getElementById('copy-agent-template') as HTMLButtonElement).disabled=false;}).catch(error=>{status.textContent=error.message;});
 document.getElementById('copy-agent-template')!.onclick=()=>void copyBrief(field,status);
}
