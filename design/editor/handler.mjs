import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { workspaceApi } from './library.mjs';
import { handoverPlan } from '../../dist/handover.js';
import { VERSION } from '../../dist/version.js';
import { boardHandler } from '../../dist/server.js';
import { APP2_HTML, APP2_JS } from '../../dist/app2.js';
const here=new URL('./',import.meta.url);
export function editorHandler(store, modelStatus={status:'unavailable'}, prefix='', options={}) {
const dir=store.dir;
// how much of a turn gets recorded travels from the gateway, which is the only layer that knows whose it is
const handler=boardHandler(store,'',{trace:options.trace});
const mountedHtml = html => html.replace(/(src|href)="\/(?!\/)/g, '$1="./').replace('<head>', `<head><base href="${prefix || ''}/">`);
const editor = async (req,res)=>{
const u=new URL(req.url,'http://localhost');
if(prefix && (u.pathname===prefix || u.pathname.startsWith(prefix+'/'))) {u.pathname=u.pathname.slice(prefix.length)||'/';}
const originalUrl=req.url;req.url=u.pathname+u.search;
try {
    if(await workspaceApi(req,res,u,store,prefix))return;
    if(u.pathname==='/workspace'||(u.pathname==='/'&&!u.searchParams.has('board'))){res.setHeader('content-type','text/html');return res.end(mountedHtml(await readFile(new URL('home.html',here),'utf8')));}
    if(u.pathname==='/workspace-config'){if(store.setup){res.setHeader('content-type','application/json');return res.end(JSON.stringify({codex:store.setup.codex,other:JSON.stringify(store.setup.cursor,null,2)}));}const args=[fileURLToPath(new URL('../../dist/cli.js',import.meta.url)),'mcp','--dir',dir];res.setHeader('content-type','application/json');return res.end(JSON.stringify({codex:'[mcp_servers.staves]\ncommand = \"node\"\nargs = '+JSON.stringify(args),other:JSON.stringify({mcpServers:{staves:{command:'node',args}}},null,2)}));}
    if(u.pathname==='/workspace-font.css'){res.setHeader('content-type','text/css');return res.end(await readFile(new URL('../mockups/archivo.css',here),'utf8'));}
    if(u.pathname==='/prototype-status'){
      const entries=await store.entries(u.searchParams.get('board')||'my-board');
      res.setHeader('content-type','application/json');return res.end(JSON.stringify({version:VERSION,revision:entries.at(-1)?.seq||0,model:modelStatus}));
    }
    if(u.pathname==='/handover'){
      const board=u.searchParams.get('board'),job=u.searchParams.get('job'),to=u.searchParams.get('to');
      if(!board||!job||!to)throw new Error('Board, job and destination are required');
      res.setHeader('content-type','application/json');
      if(req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw new Error('Request too large');}const input=JSON.parse(body||'{}');return res.end(JSON.stringify(await store.proposeHandover(board,job,to,input.basis,JSON.parse(u.searchParams.get('placement')||'{}'))));}
      return res.end(JSON.stringify(handoverPlan(await store.board(board),job,to,JSON.parse(u.searchParams.get('placement')||'{}'))));
    }
    if(['/real-conversation.js','/real-conversation.css','/mobile.js','/mobile.css','/history.js','/history.css','/editor.css','/editor.js','/langfuse.js','/langfuse.css','/as-run.js','/as-run.css','/transfer.js','/connections.js','/connections.css','/conversation.js','/conversation.css','/navigation.js','/navigation.css','/rehearsal.js','/rehearsal.css','/workspace.js','/workspace.css','/shell.js','/shell.css','/manipulation.js','/task-grouping.js','/manipulation.css','/implementation.js','/track-groups.js','/track-groups.css','/home.js','/home.css','/onboarding.js','/onboarding.css','/brief.js','/brief.css','/export.js','/export.css','/feedback.js','/feedback.css','/tour.js','/generating.js','/generating.css','/controls.js','/controls.css','/vendor/html-to-image.js','/vendor/driver.js','/vendor/driver.css'].includes(u.pathname)) {res.setHeader('content-type',u.pathname.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(new URL(u.pathname.slice(1),here),'utf8'));}
    if(u.pathname==='/app2.js'){
      res.setHeader('content-type','text/javascript');
      const automatic="else if(qs.get('review')==='1'||(topJobs().length&&!topJobs().some(j=>j.status==='confirmed'))) showReview();";
      if(!APP2_JS.includes(automatic))throw new Error('Editor startup changed; review overlay patch needs review.');
      return res.end(APP2_JS.replace(automatic,"else if(qs.get('review')==='1'){sessionStorage.setItem('reviewed:'+state.name,'1');const initialReview=()=>reviewTracks();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialReview,{once:true});else initialReview();}").replaceAll("toast('Moved to '+track(tid).name+' — handover checks apply');",'').replaceAll("toast('Moved to '+t.name+' — handover checks apply');",'').replace("const SW=['#f0a35e','#4fcb92','#8fa3b8','#d9c9a6','#e07a7a','#b48ce0'];","const SW=['#2455e6','#555d70','#9197a5','#d9dce5','#252832','#bcc5dc'];"));
    }
    if(u.pathname==='/'){
      res.setHeader('content-type','text/html');
      const fonts=await readFile(new URL('../mockups/archivo.css',here),'utf8');
      return res.end(mountedHtml(APP2_HTML.replace('</head>',`<style>${fonts}</style><link rel="stylesheet" href="/mobile.css"><script src="/mobile.js"></script><link rel="stylesheet" href="/editor.css"><link rel="stylesheet" href="/connections.css"><link rel="stylesheet" href="/conversation.css"><link rel="stylesheet" href="/navigation.css"><link rel="stylesheet" href="/track-groups.css"><link rel="stylesheet" href="/rehearsal.css"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/shell.css"><link rel="stylesheet" href="/manipulation.css"><link rel="stylesheet" href="/export.css"><link rel="stylesheet" href="/onboarding.css"><link rel="stylesheet" href="/brief.css"><link rel="stylesheet" href="/feedback.css"><link rel="stylesheet" href="/generating.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/langfuse.css"><link rel="stylesheet" href="/as-run.css"><link rel="stylesheet" href="/history.css"><link rel="stylesheet" href="/real-conversation.css"></head>`).replace('</body>','<script src="/editor.js"></script><script src="/transfer.js"></script><script src="/connections.js"></script><script src="/conversation.js"></script><script src="/track-groups.js"></script><script src="/navigation.js"></script><script src="/rehearsal.js"></script><script src="/workspace.js"></script><script src="/shell.js"></script><script src="/task-grouping.js"></script><script src="/manipulation.js"></script><script src="/implementation.js"></script><script src="/export.js"></script><script src="/onboarding.js"></script><script src="/brief.js"></script><script src="/generating.js"></script><script src="/controls.js"></script><script src="/feedback.js"></script><script src="/langfuse.js"></script><script src="/as-run.js"></script><script src="/history.js"></script><script src="/real-conversation.js"></script></body>')));
    }
    return await handler(req,res);
} catch(error) { if(!res.headersSent) {res.statusCode=500;res.setHeader('content-type','application/json');}res.end(JSON.stringify({error:'Could not load the editor. Please retry.'}));
} finally { req.url=originalUrl; }
};
editor.store=store;
return editor;
}
