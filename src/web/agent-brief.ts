export async function loadAgentBrief(apiUrl='{{API_URL}}',token='{{CONTROLLER_TOKEN}}') {
  const response=await fetch('/assets/agent-briefing.txt');
  if(!response.ok)throw new Error('Briefing unavailable. Open AGENT_CONNECTION.md from the starter folder.');
  return (await response.text()).replaceAll('{{API_URL}}',apiUrl).replaceAll('{{CONTROLLER_TOKEN}}',token);
}
export async function copyBrief(field:HTMLTextAreaElement,status:HTMLElement) {
  try {await navigator.clipboard.writeText(field.value);status.textContent='Copied. Paste this into your locally running agent.';}
  catch {field.focus();field.select();status.textContent='Press Ctrl+C (Windows) or ⌘C (Mac), then paste into your agent.';}
}
