import {api,rememberToken,displayError} from './client';

const STYLE=`.dock-gate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:#080d14f2;backdrop-filter:blur(10px);font:14px/1.5 Inter,'Segoe UI',Arial,sans-serif;color:#eef4fa}
.dock-gate form{width:min(380px,100%);background:#101824;border:1px solid #263342;border-radius:12px;padding:28px;display:flex;flex-direction:column;gap:14px}
.dock-gate h1{margin:0;font-size:22px;font-weight:600}.dock-gate p{margin:0;color:#8795a7;font-size:13px}
.dock-gate label{display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:.08em;color:#95abc1}
.dock-gate input{padding:10px 12px;border-radius:8px;border:1px solid #304358;background:#080d14;color:#eef4fa;font:inherit}
.dock-gate button{padding:11px;border:0;border-radius:8px;background:#67e4d4;color:#06201c;font-weight:700;cursor:pointer}
.dock-gate button:disabled{opacity:.5;cursor:wait}.dock-gate output{min-height:1.5em;color:#ff8f8f;font-size:13px}
.dock-gate .brand{font:600 11px Consolas,monospace;letter-spacing:.16em;color:#67e4d4}`;

/**
 * Resolves once this browser holds a valid event login. Pages call it before anything that needs the event API.
 * If the event service is unreachable the page is left usable; the API itself still enforces the login.
 */
export async function requireLogin(): Promise<void> {
  try { await api('/api/access'); return; }
  catch(error) { if((error as {status?:number}).status!==401) return; }
  const style=document.createElement('style');style.textContent=STYLE;document.head.append(style);
  const gate=document.createElement('div');gate.className='dock-gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');
  gate.innerHTML=`<form><div class="brand">◈ DOCK THE CAPSULE</div><h1>Event login</h1><p>Enter the event password provided by the organizers.</p>
    <label>PASSWORD<input type="password" autocomplete="current-password" required maxlength="128"></label><button>Log in</button><output role="status"></output></form>`;
  // Keep simulator keyboard shortcuts from firing while the password is typed.
  for(const event of ['keydown','keyup','keypress'])gate.addEventListener(event,e=>e.stopPropagation());
  document.body.append(gate);
  const form=gate.querySelector('form')!, input=gate.querySelector('input')!, button=gate.querySelector('button')!, message=gate.querySelector('output')!;
  input.focus();
  await new Promise<void>(resolve=>{
    form.onsubmit=async event=>{
      event.preventDefault();button.disabled=true;message.textContent='';
      try { const login=await api('/api/login','POST',{password:input.value}); if(login.token)rememberToken(login.token); gate.remove(); style.remove(); resolve(); }
      catch(error) { message.textContent=displayError(error); input.select(); }
      finally { button.disabled=false; }
    };
  });
}
