import {api} from './client';
api('/api/config').then(config=>{
  if(!config.event_open) {
    const e=document.querySelector('.eyebrow'); if(e) e.textContent='EVENT CLOSED / PRACTICE STILL AVAILABLE';
  }
}).catch(()=>{ /* Static manual practice still works without event storage. */ });
