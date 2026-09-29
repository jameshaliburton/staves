/* App navigation and observed connection status, outside the workflow canvas. */
const shellState = { server:'checking', presence:[], details:null, checking:false, entries:null, entriesRevision:null };
const shellHome=eb('Boards','squares-four',()=>location.assign('./workspace'));
shellHome.innerHTML='<svg viewBox="0 0 26 30" width="20" height="24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M3 10v17M11 4v20M19 1v17"/></svg><span class="shell-wordmark">staves</span><span class="beta-label">Beta</span><span class="shell-boards-label">Boards</span>';
shellHome.id='shell-home';shellHome.title='Workspace home';
$('#top').prepend(shellHome);
const shellStatus=document.createElement('footer');shellStatus.id='shell-status';shellStatus.setAttribute('aria-label','Workspace status');document.body.append(shellStatus);
// A hosted workspace has no local server, so "unavailable" was being reported for things that were
// never there to be available. Say what is true, and where something is missing offer the way to fix
// it rather than a dead status.
const hostedShell=!!document.querySelector('meta[name="staves-account"]');
// How long ago, in the largest plain unit. Floored, so it never rounds up to a time that has not passed.
function agentActivityAgo(then,now){
  const unit=(value,name)=>value+' '+name+(value===1?'':'s')+' ago';
  const minutes=Math.max(1,Math.floor((now-then)/60000));
  if(minutes<60)return unit(minutes,'minute');
  const hours=Math.floor(minutes/60);
  if(hours<24)return unit(hours,'hour');
  const days=Math.floor(hours/24);
  if(days<30)return unit(days,'day');
  const months=Math.floor(days/30);
  return months<12?unit(months,'month'):unit(Math.floor(months/12),'year');
}
// An agent that has never written here is an unfinished setup, not a fault; one that wrote an hour ago
// is connected and quiet. Only what the log actually shows is claimed: a request queued for an agent
// is not an agent. Humans are "human" or "human:<name>"; every other named actor is an agent, and an
// actor that is not a string at all is unknown rather than an agent.
function agentConnectionState(entries,deliveries,now){
  const isHuman=actor=>typeof actor!=='string'||!actor||actor==='human'||actor.startsWith('human:');
  const events=[];
  for(const entry of entries||[])if(entry&&!isHuman(entry.by))events.push({actor:entry.by,at:entry.at});
  for(const delivery of deliveries||[])if(delivery&&!isHuman(delivery.actor))events.push({actor:delivery.actor,at:delivery.at});
  const dated=events.map(event=>({actor:event.actor,at:event.at,ms:Date.parse(event.at)})).filter(event=>Number.isFinite(event.ms));
  if(!dated.length)return {state:'never',actor:null,at:null,text:'No agent has written to this board'};
  const latest=dated.reduce((newest,event)=>event.ms>newest.ms?event:newest);
  if(now-latest.ms<=600000)return {state:'active',actor:latest.actor,at:latest.at,text:'Agent active · '+latest.actor};
  return {state:'idle',actor:latest.actor,at:latest.at,text:'Agent last active '+agentActivityAgo(latest.ms,now)};
}
// Every board connection entry uses the same one-paste handoff.
function openConnectSheet() {
  if ($('#veil')?.classList.contains('show')) closeSheet();
  openHandoffExport();
}
window.stavesOpenConnectSheet=openConnectSheet;
window.stavesAgentConnection=()=>agentConnectionState(shellState.entries||[],shellDeliveryEvents(),Date.now());
// Delivery events live on the board's own comments, so they need no extra request.
function shellDeliveryEvents(){
  const comments=(typeof state!=='undefined'&&state.board?.comments)||[];
  return comments.filter(comment=>comment.assessment?.kind==='delivery').map(comment=>comment.assessment.delivery).filter(Boolean);
}
function shellModelLabel(){
  // Browser credentials are sent with the conversation request, so the server's
  // status cannot describe them. Saved settings do not prove a live connection.
  try {
    if(localStorage.getItem('staves:key')?.trim()){
      const provider=localStorage.getItem('staves:provider')||'anthropic';
      const name=localStorage.getItem('staves:model')?.trim()||({anthropic:'Anthropic',openai:'OpenAI',gemini:'Google Gemini'}[provider]||'Model');
      return {text:name+' configured',go:'./workspace#account'};
    }
  } catch {
    if(hostedShell)return {text:'Model settings unavailable',fix:'Check settings',go:'./workspace#account'};
  }
  const model=shellState.details?.model;
  if(!model)return hostedShell?{text:'No model connected',fix:'Add a key',go:'./workspace#account'}:{text:'Model not checked'};
  if(model.status==='connected'||model.status==='ready')return {text:(model.name||'Model')+' available'};
  if(model.status==='working')return {text:(model.name||'Model')+' responding…'};
  if(model.status==='error')return {text:'Model connection needs attention',fix:'Check the key',go:'./workspace#account'};
  if(model.status==='configured')return {text:(model.name||'Model')+' configured'};
  return {text:'No model connected',fix:'Add a key',go:'./workspace#account'};
}
function shellServerLabel(){
  if(hostedShell)return {text:'Cloud workspace'};
  if(shellState.server==='online')return {text:'Local server available'};
  if(shellState.server==='checking')return {text:'Checking local server…'};
  return {text:'Local server not running',fix:'How to start it',go:'./workspace#docs/from-source'};
}
function shellAgentLabel(){
  const names=shellState.presence.map(p=>p.name).filter(Boolean);
  if(names.length)return {state:'active',text:'Agent active · '+names.join(', ')};
  if(!hostedShell&&shellState.server!=='online')return {state:'unknown',text:shellState.server==='checking'?'Checking agent status…':'Agent status unavailable'};
  if(!shellState.entries)return {state:'unknown',text:'Checking agent status…'};
  const agent=agentConnectionState(shellState.entries,shellDeliveryEvents(),Date.now());
  if(agent.state==='active')return {state:'active',text:agent.text};
  return {state:agent.state,text:agent.text,fix:agent.state==='never'?'Connect one':'Reconnect',connect:true};
}
function paintShellStatus(){
  const server=shellServerLabel(), mcp=shellAgentLabel(), model=shellModelLabel();
  if(!shellStatus.children.length){shellStatus.innerHTML='<button id="shell-status-server"><i class="shell-status-dot"></i><span></span></button><button id="shell-status-mcp"><i class="shell-status-dot"></i><span></span></button><span class="shell-status-spacer"></span><button id="shell-status-model"><span></span></button><span class="shell-version"></span>';['server','mcp','model'].forEach(id=>$('#shell-status-'+id).onclick=()=>openShell('settings'));}
  const fill=(id,state)=>{
    const button=$('#shell-status-'+id); if(!button)return;
    const span=button.querySelector('span')||button;
    span.textContent=state.text;
    button.querySelector('.shell-status-fix')?.remove();
    if(state.fix){
      const link=document.createElement('b');link.className='shell-status-fix';link.textContent=state.fix;
      button.append(link);
    }
    button.title=state.fix?state.text+' — '+state.fix:state.text;
    button.setAttribute('aria-label',button.title);
    button.onclick=()=>{ if(state.connect)openConnectSheet({}); else if(state.go)location.assign(state.go); else openShell('settings'); };
  };
  $('#shell-status-server i').classList.toggle('available',hostedShell||shellState.server==='online');
  $('#shell-status-mcp i').classList.toggle('available',mcp.state==='active');
  fill('server',server); fill('mcp',mcp); fill('model',model);
  $('.shell-version').textContent=[shellState.details?.version?'v'+shellState.details.version:'',shellState.details?.revision!=null?'revision '+shellState.details.revision:''].filter(Boolean).join(' · ');

}
function openShell(page){location.assign('./workspace#'+(page==='settings'?'account':'boards'));}
async function refreshShellStatus(){
  if(shellState.checking||document.hidden)return;shellState.checking=true;
  const results=await Promise.allSettled([fetch('./presence',{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('Unavailable');return r.json();}),fetch('./prototype-status?board='+encodeURIComponent(state.name||''),{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('Unavailable');return r.json();})]);
  const [presenceResult,statusResult]=results;
  shellState.server=presenceResult.status==='fulfilled'&&Array.isArray(presenceResult.value)?'online':'offline';
  shellState.presence=shellState.server==='online'?presenceResult.value:[];
  shellState.details=statusResult.status==='fulfilled'?statusResult.value:null;
  await refreshShellAgentLog();
  shellState.checking=false;paintShellStatus();
}
// The board's own log says whether an agent has ever worked here. It changes only when the revision
// does, so this reads it once per change rather than on every status poll. A failed read is left for
// the next poll: claiming "no agent" because a request failed would be a claim the log did not make.
async function refreshShellAgentLog(){
  const revision=shellState.details?.revision;
  if(revision==null||revision===shellState.entriesRevision)return;
  try{
    const response=await fetch('./entries?board='+encodeURIComponent(state.name||''),{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Unavailable');
    const entries=await response.json();
    if(!Array.isArray(entries))throw new Error('Unavailable');
    shellState.entries=entries.map(entry=>({by:entry.by,at:entry.at}));
    shellState.entriesRevision=revision;
  }catch{}
}
paintShellStatus();refreshShellStatus();setInterval(refreshShellStatus,10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){paintShellStatus();refreshShellStatus();}});
window.addEventListener('storage',event=>{if(event.key===null||['staves:key','staves:provider','staves:model'].includes(event.key))paintShellStatus();});
window.addEventListener('focus',paintShellStatus);

const shellShare=eb('Continue in your coding agent','terminal-window',()=>openHandoffExport());shellShare.id='shell-share';shellShare.innerHTML=ei('terminal-window')+'<span>Coding agent</span>';shellShare.title='Continue this workflow in Codex or Claude Code';$('#top').append(shellShare);
// The primary conversation action sits directly above its rail.

/* Optional spatial overview. Always uses the current board, never demo traces. */
let spatialGraph=null, spatialLoader=null;
async function openSpatialOverview(){
  const objects=live();
  const dialog=document.createElement('dialog');dialog.id='spatial-overview';
  dialog.setAttribute('aria-labelledby','spatial-title');
  dialog.innerHTML='<header><div><small>SPATIAL OVERVIEW</small><h2 id="spatial-title"></h2></div><button class="bt" data-close>Back to canvas</button></header><div class="spatial-toolbar"><label>Find work <select aria-label="Find a job or task"><option value="">Choose a job or task…</option></select></label><button class="bt" data-fit>Fit graph</button><span>Drag to orbit · Scroll to zoom · Click to inspect</span></div><div class="spatial-stage"></div><footer><span data-status role="status">Loading 3D overview…</span><button class="bt" data-open disabled>Open in editor</button></footer>';
  dialog.querySelector('h2').textContent=state.board.title||'Workflow';document.body.append(dialog);
  const selectBox=dialog.querySelector('select');objects.forEach(j=>{const option=document.createElement('option');option.value=j.id;option.textContent=(j.parent?'↳ ':'')+j.name;selectBox.append(option);});
  let selected=null,observer,disposed=false;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status=dialog.querySelector('[data-status]');
  const inspect=node=>{selected=node.id;selectBox.value=node.id;status.textContent=node.name+' · '+node.role;dialog.querySelector('[data-open]').disabled=false;};
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{disposed=true;observer?.disconnect();spatialGraph?._destructor();spatialGraph=null;dialog.remove();});
  dialog.querySelector('[data-open]').onclick=()=>{const id=selected;dialog.close();if(id)select(id,'job');};
  dialog.showModal();
  if(!objects.length){status.textContent='Add a job to see its connections in 3D.';return;}
  try{
    if(!window.ForceGraph3D){
      if(!spatialLoader)spatialLoader=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/3d-force-graph@1.80.0/dist/3d-force-graph.min.js';script.onload=resolve;script.onerror=()=>{script.remove();spatialLoader=null;reject(new Error('Could not load 3D view. Close and try again.'));};document.head.append(script);});
      await spatialLoader;
    }
    if(disposed)return;
    const palette={person:'#eccba5',team:'#eccba5',agent:'#79dcd3',system:'#98b9ef',outside:'#c4aadf'};
    const nodes=objects.map(j=>({id:j.id,name:j.name,role:trackOf(j)?.name||'Unassigned',color:palette[trackOf(j)?.kind]||'#c2d3dd',val:j.parent?.6:3}));
    const ids=new Set(nodes.map(n=>n.id));
    const links=(state.board.handoffs||[]).filter(h=>ids.has(h.from)&&ids.has(h.to)).map(h=>({source:h.from,target:h.to,color:'#85b6c2'}));
    objects.filter(j=>j.parent&&ids.has(j.parent)).forEach(j=>links.push({source:j.parent,target:j.id,color:'#405767'}));
    spatialGraph=new window.ForceGraph3D(dialog.querySelector('.spatial-stage')).backgroundColor('#080f17').graphData({nodes,links}).nodeColor('color').nodeVal('val').nodeLabel(n=>{const label=document.createElement('span');label.textContent=n.name+' · '+n.role;return label;}).linkColor('color').linkOpacity(.45).showNavInfo(false).enableNodeDrag(false).onNodeClick(inspect).warmupTicks(80).cooldownTicks(reducedMotion?0:80);
    const resize=()=>{const stage=dialog.querySelector('.spatial-stage');spatialGraph?.width(stage.clientWidth).height(stage.clientHeight);};observer=new ResizeObserver(resize);observer.observe(dialog.querySelector('.spatial-stage'));resize();
    dialog.querySelector('[data-fit]').onclick=()=>spatialGraph.zoomToFit(reducedMotion?0:600,65);
    selectBox.onchange=()=>{const node=nodes.find(n=>n.id===selectBox.value);if(!node)return;inspect(node);spatialGraph.cameraPosition({x:(node.x||0)+60,y:(node.y||0)+35,z:(node.z||0)+100},node,reducedMotion?0:700);};
    status.textContent=objects.filter(j=>!j.parent).length+' jobs · '+objects.filter(j=>j.parent).length+' tasks · Design connections, not a live run';
    spatialGraph.zoomToFit(0,65);
  }catch(error){status.textContent=error.message;}
}
