import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,rename,stat} from 'node:fs/promises';
import {resolve,join,extname,relative} from 'node:path';
import './build.mjs';

await mkdir('.dock-data',{recursive:true});
await build({entryPoints:['src/server/app.ts','src/server/store.ts','src/server/capcom.ts'],outdir:'.dock-data/server',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'warning'});
const {createApp,passwordHash}=await import('../.dock-data/server/app.js');
const {MemoryStore,NeonStore}=await import('../.dock-data/server/store.js');
const {anthropicCapcom}=await import('../.dock-data/server/capcom.js');
class FileStore extends MemoryStore {
  tail=Promise.resolve();
  async changed(){const snapshot=JSON.stringify(this.data);this.tail=this.tail.catch(()=>{}).then(async()=>{await writeFile('.dock-data/event.json.tmp',snapshot);await rename('.dock-data/event.json.tmp','.dock-data/event.json');});await this.tail;}
}
const local=new FileStore();try{local.data=JSON.parse(await readFile('.dock-data/event.json','utf8'));}catch{}
const port=Number(process.env.PORT || 8888),origin=`http://127.0.0.1:${port}`;
const store=process.env.DATABASE_URL?new NeonStore(process.env.DATABASE_URL):local;
const app=createApp(store,{development:true,siteUrl:origin,adminPasswordHash:process.env.ADMIN_PASSWORD_HASH || passwordHash('mission-control'),
  sitePasswordHash:process.env.SITE_PASSWORD_HASH || (process.env.SITE_PASSWORD?passwordHash(process.env.SITE_PASSWORD):undefined),
  capcom:process.env.ANTHROPIC_API_KEY?anthropicCapcom(process.env.ANTHROPIC_API_KEY):undefined,dailyBudgetUsd:Number(process.env.DAILY_BUDGET_USD) || undefined});
const root=resolve('dist');const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.glb':'model/gltf-binary','.zip':'application/zip','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const response=await app(request,req.socket.remoteAddress || 'local');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const routes={'/':'/index.html','/leaderboard':'/leaderboard.html','/admin':'/admin.html','/docs':'/docs.html','/sim':'/sim/index.html','/sim/':'/sim/index.html'};
  const path=resolve(root,'.'+decodeURIComponent(routes[url.pathname] || (url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname)));
  if(relative(root,path).startsWith('..') || !(await stat(path)).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(await readFile(path));
}catch{res.writeHead(404);res.end('Not found');}});
server.listen(port,'127.0.0.1',()=>{console.log(`Dock the Capsule: ${origin}\nTV preview: ${origin}/leaderboard?demo=1\nLocal development staff password: mission-control\nSite password: ${process.env.SITE_PASSWORD || process.env.SITE_PASSWORD_HASH?'configured':'not required'} · AI CAPCOM: ${process.env.ANTHROPIC_API_KEY?'server key configured':'no ANTHROPIC_API_KEY'}\nStorage: ${process.env.DATABASE_URL?'Neon':'local .dock-data/event.json (development only)'}`);});
