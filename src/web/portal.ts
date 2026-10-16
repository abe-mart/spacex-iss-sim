import {api} from './client';
import {requireLogin} from './gate';
void requireLogin();
api('/api/config').then(config=>{
  if(!config.event_open) {
    const e=document.querySelector('.eyebrow'); if(e) e.textContent='THE EVENT IS CLOSED';
  }
}).catch(()=>{ /* The page remains readable without event storage. */ });
