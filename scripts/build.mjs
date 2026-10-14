import {build} from 'esbuild';
import {zipSync,strToU8} from 'fflate';
import {cp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'), dist=join(root,'dist');
if(relative(root,dist)!=='dist')throw new Error('Build output must stay in the workspace dist directory.');
await rm(dist,{recursive:true,force:true});
await mkdir(join(dist,'assets'),{recursive:true});
await cp(join(root,'web'),dist,{recursive:true});
for(const name of ['site.css','flight.css'])await cp(join(root,'web',name),join(dist,'assets',name));
await cp(join(root,'iss-sim.spacex.com'),join(dist,'sim'),{recursive:true});
let html=await readFile(join(dist,'sim','index.html'),'utf8');
html=html.replace(/<title>[\s\S]*?<\/title>/,'<title>Flight deck · Dock the Capsule</title>')
  .replace(/<link[^>]*fonts\.googleapis[^>]*>/g,'')
  .replace('</head>','<link rel="stylesheet" href="/assets/flight.css"><script>window.dragonBridge={url:null};</script></head>')
  .replace(/<script[^>]*src="js\/hackathon\.js"[^>]*><\/script>/,'<script type="module" src="/assets/flight.js"></script>');
await writeFile(join(dist,'sim','index.html'),html);
await build({entryPoints:{portal:'src/web/portal.ts',docs:'src/web/docs.ts',leaderboard:'src/web/leaderboard.ts',admin:'src/web/admin.ts',flight:'src/web/flight.ts'},
  absWorkingDir:root,outdir:join(dist,'assets'),bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,entryNames:'[name]',chunkNames:'chunks/[name]-[hash]',logLevel:'warning'});
const zip={};
async function pack(directory,prefix) {
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.name==='downloads')continue;
    const path=join(directory,entry.name), key=prefix+entry.name;
    if(entry.isDirectory())await pack(path,key+'/');else zip[key]=new Uint8Array(await readFile(path));
  }
}
await cp(join(root,'starter','AGENT_GUIDE.md'),join(dist,'assets','agent-briefing.txt'));
await pack(dist,'dock-the-capsule/site/');
for(const name of ['dragon.py','server.py','event_bridge.py','examples/__init__.py'])zip['dock-the-capsule/'+name]=new Uint8Array(await readFile(join(root,name)));
zip['dock-the-capsule/examples/autopilot.py']=new Uint8Array(await readFile(join(root,'starter','controls_demo.py')));
for(const name of ['autopilot.py','agent_bridge.py','retry_scores.py','README.md','AGENT_GUIDE.md','API.md'])zip['dock-the-capsule/'+name]=new Uint8Array(await readFile(join(root,'starter',name)));
zip['dock-the-capsule/VERSION']=strToU8('dock-v1\n');
await mkdir(join(dist,'downloads'),{recursive:true});
await cp(join(root,'starter','API.md'),join(dist,'downloads','dock-the-capsule-api.md'));
const bytes=zipSync(zip,{level:6});await writeFile(join(dist,'downloads','dock-the-capsule-starter.zip'),bytes);
console.log(`Built Dock the Capsule · ${Object.keys(zip).length} starter files · ${(bytes.length/1048576).toFixed(1)} MB starter ZIP`);
