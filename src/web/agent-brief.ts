export async function loadAgentBrief(autopilotUrl='{{AUTOPILOT_URL}}') {
  const response=await fetch('/assets/agent-briefing.txt');
  if(!response.ok)throw new Error('The briefing is unavailable. Open AGENT_GUIDE.md in the starter folder instead.');
  return (await response.text()).replaceAll('{{AUTOPILOT_URL}}',autopilotUrl);
}
export async function copyBrief(field:HTMLTextAreaElement,status:HTMLElement) {
  try {await navigator.clipboard.writeText(field.value);status.textContent='Copied. Paste the briefing into your agent running on this computer.';}
  catch {field.focus();field.select();status.textContent='Press Ctrl+C (Windows) or ⌘C (Mac) to copy, then paste the briefing into your agent.';}
}
