/** Receive a password only from the same-origin admin tab that opened this display. */
export function listenForTvPassword(display: (password: string) => void, host: Window = window) {
  const controller=host.opener;
  if(!controller)return;
  const origin=host.location.origin;
  host.addEventListener('message',event=>{
    if(event.source!==controller || event.origin!==origin)return;
    const data=event.data;
    if(data?.type!=='dock.tv.password' || typeof data.password!=='string' || data.password.length>128)return;
    display(data.password);
  });
  host.addEventListener('pagehide',()=>{
    display('');
    controller.postMessage({type:'dock.tv.not-ready'},origin);
  });
  controller.postMessage({type:'dock.tv.ready'},origin);
}
