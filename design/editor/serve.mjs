import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { workspaceApi } from './library.mjs';
import { mkdir } from 'node:fs/promises';
import { handoverPlan } from '../../dist/handover.js';
import { Store } from '../../dist/store.js';
import { connectCodex } from './codex-bridge.mjs';
import { VERSION } from '../../dist/version.js';
import { boardHandler } from '../../dist/server.js';
import { editorHandler } from './handler.mjs';
const dir='/tmp/staves-full-editor';
await mkdir(dir,{recursive:true});
const store=new Store(dir);

const companion=await connectCodex(store);
const editor=editorHandler(store,companion.status);
http.createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'&&req.headers.origin&&!['http://localhost:5192','http://127.0.0.1:5192'].includes(req.headers.origin)){res.statusCode=403;return res.end('This local workspace only accepts requests from its own page.');}
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/auth/config'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({configured:false,local:true}));}
    return await editor(req,res);
  }catch(e){res.statusCode=500;res.end(String(e));}
}).listen(5192,'127.0.0.1',()=>console.log('Full editor: http://localhost:5192/workspace · development boards in '+dir));
