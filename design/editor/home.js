const isHostedWorkspace=!!document.querySelector('meta[name="staves-account"]');
const content=document.querySelector('#content'),dialog=document.querySelector('#start-dialog');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let boardSort='edited';
let workspaceData={boards:[],templates:[],examples:[]},workspaceStatus=null,loadError='',query='',workspaceConfig=null,loadState='loading',configState='loading',statusChecked=null;
async function requestJson(url,options={}){const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'The local server is unavailable. Try again.');return data;}
// home.html loads home.js alone, so this page cannot call into the editor's shell.js. These two are
// the same rule as the editor footer's, kept identical by design/editor/test/agent-connection.test.mjs.
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
// The workspace API orders boards by when each one last changed here, falling back to the age of the
// work itself. Sorting the same list on updatedAt alone buried a log replayed in from another machine
// under everything else, so the page contradicted the response it was painting. One rule, both places.
function boardStamp(board){return board.touchedAt||board.updatedAt||'';}
function compareBoards(sort,a,b){
  if(sort==='name')return a.title.localeCompare(b.title);
  // A board with no timestamps is undated, not ancient: reversing it to the top of "Oldest edit"
  // would claim an edit date its log does not have. It sorts last either way, by name among its own.
  const left=boardStamp(a),right=boardStamp(b);
  if(!left||!right)return left===right?a.title.localeCompare(b.title):left?-1:1;
  const recent=right.localeCompare(left);
  return sort==='oldest'?-recent:recent;
}
// "Edited" is when the work changed; "arrived" is when that change reached this workspace. They are the
// same event for a board edited here, so the second half appears only when it says something new.
function boardEditedLabel(board,now){
  if(!board.updatedAt)return 'Edit date unavailable';
  const edited='Edited '+new Date(board.updatedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  const touched=Date.parse(board.touchedAt||''),updated=Date.parse(board.updatedAt);
  return Number.isFinite(touched)&&Number.isFinite(updated)&&touched-updated>60000?edited+' · arrived '+agentActivityAgo(touched,now):edited;
}
function focusHeading(){const heading=content.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus();}}
function configMarkup(){if(isHostedWorkspace)return '<h3>Work on a board from your coding agent</h3><p>On a board, choose <strong>Coding agent</strong> and paste what it copies into your agent’s chat. The agent connects itself and writes to the board as it works. From a terminal instead: <code>npx @staves/cli connect</code> in the project, then <code>npx @staves/cli doctor</code> to check the connection.</p><p>To take a copy elsewhere, use <strong>Board options → Export…</strong>. Nothing you do to an export comes back to the board.</p>';return configState==='ready'?'<h3>Connect a coding agent</h3><p>In a terminal, from this project:</p><pre>npx @staves/cli init</pre><p>Registers the Staves MCP server for Claude Code, Codex, Gemini CLI and Cursor, installs the skill, and adds a managed block to CLAUDE.md, AGENTS.md and GEMINI.md.</p><p>Want a hosted Staves account instead of local boards? <code>npx @staves/cli connect</code>.</p><p>Either way, check the result:</p><pre>npx @staves/cli doctor</pre><details><summary>Manual configuration</summary><h4>Codex</h4><pre>'+escapeHtml(workspaceConfig.codex)+'</pre><h4>Claude Code / Cursor</h4><pre>'+escapeHtml(workspaceConfig.other)+'</pre></details>':configState==='error'?'<p class="error" role="alert">Could not load this workspace’s connection configuration.</p><button class="button" id="retry-config">Retry configuration</button>':'<p role="status">Loading connection configuration…</p>';}
function paintAccountStatus(){const ready=['ready','working'].includes(workspaceStatus?.model?.status);const unavailable=!workspaceStatus;const label=unavailable?(statusChecked?'Status unavailable':'Checking connection…'):ready?'Interview model available':'Interview model status unavailable';const pill=document.querySelector('#account-model-state');if(pill){pill.textContent=label;pill.dataset.available=String(ready);}const note=document.querySelector('#account-model-note');if(note)note.textContent=unavailable?(statusChecked?'The latest connection check failed. Retry to check availability.':'Checking interview model availability.'):ready?'The local server reports an available interview model. Coding-agent project access is a separate connection.':'Model availability is checked when you start an interview. Connect a coding agent using the workspace configuration below. Browser interviews require an agent with sampling support or a model provider configured on the board.';const checked=document.querySelector('#account-last-check');if(checked)checked.textContent=statusChecked?'Last checked '+statusChecked.toLocaleTimeString(): 'Checking connection…';const version=document.querySelector('#account-version');if(version)version.textContent='Staves '+(workspaceStatus?.version||'version unavailable');}
const colors={person:'var(--person)',agent:'var(--agent)',system:'var(--system)',outside:'var(--outside)'};
function miniature(preview){return '<div class="mini" aria-hidden="true">'+(preview||[]).map(role=>'<div class="mini-row" style="--role:'+colors[role.kind]+'">'+role.positions.map(position=>'<i style="position:absolute;left:'+(12+position*72)+'%;width:12%"></i>').join('')+'</div>').join('')+'</div>';}
function heading(title,description,action=''){return '<div class="page-head"><div><p class="eyebrow">Workspace / '+escapeHtml(title)+'</p><h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(description)+'</p></div>'+action+'</div>';}
function page(){return location.hash.slice(1).split('/')[0]||'boards';}
function renderRefresh(){const active=document.activeElement;const id=active?.id;const scroll=window.scrollY;const isHeading=active?.matches('h1,h2');render();if(!dialog.open){if(id)document.getElementById(id)?.focus();else if(isHeading)focusHeading();}window.scrollTo(0,scroll);}
function render(){
  const current=page();document.title=({boards:'Your boards',examples:'Example library',account:'Account & connections',docs:'Documentation'}[current]||'Your boards')+' · Staves';document.querySelectorAll('[data-page]').forEach(a=>a.setAttribute('aria-current',a.dataset.page===current?'page':'false'));
  if(current==='examples'){
    content.innerHTML=heading('Example library','Four ways people and agents can work together.')+'<div class="library-grid">'+(loadState==='ready'?workspaceData.examples:[]).map(example=>'<article class="example">'+miniature(example.preview)+'<div class="example-body"><span class="tag">'+escapeHtml(example.pattern)+'</span><h2>'+escapeHtml(example.title)+'</h2><p>'+escapeHtml(example.description)+'</p><div class="example-footer"><small>Fictional example · editable copy</small><button class="button" data-example="'+escapeHtml(example.id)+'" aria-label="Use '+escapeHtml(example.title)+'" title="Create an editable copy">Use example</button></div></div></article>').join('')+(loadState==='loading'?'<p role="status">Loading examples…</p>':'')+'</div>';
    content.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>start('example',b.dataset.example));
  }else if(current==='account'){
    const ready=['ready','working'].includes(workspaceStatus?.model?.status);
    // A workspace has no single log, so the boards' own logs answer it. Read once per visit, most
    // recently worked on first; a workspace with more boards than that says what it actually read.
    async function scanWorkspaceAgents(){
      const boards=[...workspaceData.boards].sort((a,b)=>compareBoards('edited',a,b)).slice(0,12);
      const logs=await Promise.all(boards.map(async board=>{
        try{
          const response=await fetch('./entries?board='+encodeURIComponent(board.id),{cache:'no-store',signal:AbortSignal.timeout(10000)});
          if(!response.ok)return null;
          const entries=await response.json();
          return Array.isArray(entries)?entries.map(entry=>({by:entry.by,at:entry.at})):null;
        }catch{return null;}
      }));
      return {entries:logs.filter(Boolean).flat(),read:logs.filter(Boolean).length,asked:boards.length,partial:workspaceData.boards.length>boards.length};
    }
    function paintAgentUnavailable(reason){
      const line=document.querySelector('#account-agent-state');if(!line)return;
      const note=document.querySelector('#account-agent-note'),connect=document.querySelector('#account-agent-connect');
      line.textContent='Agent status unavailable';line.dataset.available='false';
      if(note)note.textContent=reason;
      if(connect)connect.hidden=false;
    }
    function paintAgentLine(scan){
      const line=document.querySelector('#account-agent-state');if(!line)return;
      const note=document.querySelector('#account-agent-note'),connect=document.querySelector('#account-agent-connect');
      if(!scan){line.textContent='Checking your boards…';line.dataset.available='false';if(connect)connect.hidden=true;return;}
      // Nothing read is not the same as nothing found; say which one it is.
      if(scan.asked&&!scan.read){paintAgentUnavailable('None of your board logs could be read. Use Check connection to read them again.');return;}
      const agent=agentConnectionState(scan.entries,[],Date.now());
      line.textContent=agent.state==='never'?'No agent has written to '+(scan.partial?'your recent boards':'your boards'):agent.text;
      line.dataset.available=String(agent.state==='active');
      if(note)note.textContent=scan.read<scan.asked?'Some board logs could not be read, so this may be incomplete.':'Read from the log of '+scan.read+' board'+(scan.read===1?'':'s')+'. A queued request is not a connected agent.';
      if(connect)connect.hidden=agent.state==='active';
    }
    function startAgentScan(){
      if(loadState!=='ready')return;
      if(!window.stavesAgentScan)window.stavesAgentScan=scanWorkspaceAgents().then(scan=>{window.stavesAgentScanResult=scan;return scan;});
      window.stavesAgentScan.then(paintAgentLine);
    }
    // "Check connection" has to re-check everything this page reports, not only the model: the board
    // scan is cached for the page's lifetime, and a workspace that failed to load has no board list.
    async function retryAccountChecks(){
      window.stavesAgentScan=null;window.stavesAgentScanResult=null;
      paintAgentLine(null);
      status();
      if(loadState==='ready')startAgentScan();else await load();
    }
    content.innerHTML=heading('Account & connections','Your workspace, assistant and model access.')+'<section class="setting"><h2>Workspace</h2><div><strong>Local workspace</strong><p>Your boards are stored on this computer. This workspace has no separate Staves account or cloud sync.</p></div></section><section class="setting"><h2>Model access</h2><div><strong>Interview model</strong><span class="pill" id="account-model-state">'+(ready?'Interview model available':'Interview model status unavailable')+'</span><p id="account-model-note" style="margin-top:15px">'+(ready?'The local server reports an available interview model. Coding-agent project access is a separate connection.':'Model availability is checked when you start an interview. Connect a coding agent using the workspace configuration below. Browser interviews require an agent with sampling support or a model provider configured on the board.')+'</p><p>Model access is separate from a coding agent’s access to your project.</p><p id="account-last-check"></p><button class="button" id="retry-status">Check connection</button> <a class="button" href="#docs/connect">Connection guide</a></div></section><section class="setting"><h2>Coding agent</h2><div><strong>Project access is separate</strong><p>A coding agent connected to your repository can inspect code, describe workflows and respond to proposals through MCP.</p><button class="button" id="project-start">Connect a project</button>'+(!isHostedWorkspace?'<p class="pill" id="account-agent-state">Checking your boards…</p><p id="account-agent-note"></p><button class="button" id="account-agent-connect" hidden>How to connect an agent</button><div id="config-section">'+configMarkup()+'</div>':'')+'</div></section><section class="setting"><h2>Application</h2><div><strong id="account-version">Staves '+escapeHtml(workspaceStatus?.version||'prototype')+'</strong><p>Local workspace · '+workspaceData.boards.length+' boards</p></div></section>';
    document.querySelector('#project-start').onclick=()=>start('project');document.querySelector('#retry-status').onclick=retryAccountChecks;paintAccountStatus();
    if(!isHostedWorkspace){
      // The connect commands already sit in this section; the trigger takes the person to them rather
      // than opening a second copy that can drift from the one below it.
      document.querySelector('#account-agent-connect').onclick=()=>{const section=document.querySelector('#config-section');if(!section)return;section.scrollIntoView({block:'nearest'});const title=section.querySelector('h3');if(title){title.tabIndex=-1;title.focus();}};
      // A workspace that failed to load has no board list to read, so say so and keep the commands in
      // reach. Checking forever would be the one thing the person can do nothing about.
      if(loadState==='error')paintAgentUnavailable('This workspace could not be loaded, so its board logs were not read. Use Check connection to try again.');
      else{paintAgentLine(window.stavesAgentScanResult||null);startAgentScan();}
    }
  }else if(current==='docs'){
    // The guides live at /docs now — one source, searchable, with an index. Anyone arriving on the
    // old in-app route is sent there rather than shown a second, drifting copy.
    const deep=location.hash.split('/')[1];
    location.replace((isHostedWorkspace?'/docs/':'https://staves.io/docs/')+(deep?encodeURIComponent(deep)+'/':''));
    return;
  }else{
    content.innerHTML=heading('Your boards','Make the work visible. Shape what happens next.','<button class="button primary" id="new-board">＋ New board</button>')+'<label class="search-label" for="board-search">Find a board</label><input id="board-search" class="search" aria-label="Find a board" placeholder="Find a board…" value="'+escapeHtml(query)+'"><label class="board-sort-label">Sort<select id="board-sort" aria-label="Sort boards"><option value="edited">Recently edited</option><option value="name">Name A–Z</option><option value="oldest">Oldest edit</option></select></label><p id="search-status" role="status" aria-live="polite"></p><div id="board-results"></div>';
    document.querySelector('#board-sort').value=boardSort;document.querySelector('#board-sort').onchange=e=>{boardSort=e.target.value;paintBoards();};document.querySelector('#new-board').onclick=()=>start();document.querySelector('.search').oninput=e=>{query=e.target.value;paintBoards();};paintBoards();
  }
  if(loadError)content.insertAdjacentHTML('beforeend','<p class="error" role="alert">'+escapeHtml(loadError)+'</p><button class="button" id="retry">Retry</button>');
  document.querySelector('#retry')?.addEventListener('click',()=>load(true));document.querySelector('#retry-config')?.addEventListener('click',loadConfig);
}
function paintBoards(){
  const results=document.querySelector('#board-results');if(loadState!=='ready'){results.innerHTML=loadState==='loading'?'<p role="status">Loading your boards…</p>':'';return;}
  const now=Date.now();
  const boards=workspaceData.boards.filter(b=>(b.title+' '+b.id).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>compareBoards(boardSort,a,b));
  document.querySelector('#search-status').textContent=boards.length+' '+(boards.length===1?'board':'boards')+(query?' found':'');
  results.innerHTML='<div class="board-list">'+boards.map(b=>'<article class="managed-board"><a class="board-row" href="./?board='+encodeURIComponent(b.id)+'">'+miniature(b.preview)+'<div><h3>'+escapeHtml(b.title)+'</h3><p>'+b.jobs+' jobs · '+b.roles+' roles · revision '+b.revision+'</p><time class="board-edited"'+(b.updatedAt?' datetime="'+escapeHtml(b.updatedAt)+'"':'')+'>'+escapeHtml(boardEditedLabel(b,now))+'</time></div><span class="arrow">↗</span></a><div class="board-actions"><button class="button" data-save-template="'+escapeHtml(b.id)+'" aria-label="Save '+escapeHtml(b.title)+' as template">Save as template</button><button class="button danger" data-delete-board="'+escapeHtml(b.id)+'" aria-label="Delete '+escapeHtml(b.title)+'">Delete</button></div></article>').join('')+'</div>'+(!boards.length?'<div class="empty">'+(query?'No boards match your search.':'Start with your project, an example, or a blank canvas.')+'</div>':'')+'<section class="saved-templates"><h2>Your templates</h2><p>Private workflow designs. Each new board is an independent copy.</p><div class="board-list">'+(workspaceData.templates||[]).map(b=>'<article class="managed-board"><div class="board-row">'+miniature(b.preview)+'<div><h3>'+escapeHtml(b.title)+'</h3><p>'+b.jobs+' jobs · '+b.roles+' roles</p></div></div><div class="board-actions"><button class="button" data-use-template="'+escapeHtml(b.id)+'">Use template</button><button class="button danger" data-delete-board="'+escapeHtml(b.id)+'" aria-label="Delete template '+escapeHtml(b.title)+'">Delete</button></div></article>').join('')+'</div>'+(!(workspaceData.templates||[]).length?'<p>Save a board as a template to reuse its design here.</p>':'')+'</section>';
  results.querySelectorAll('[data-save-template]').forEach(button=>button.onclick=()=>manageBoard(button.dataset.saveTemplate,'save'));
  results.querySelectorAll('[data-delete-board]').forEach(button=>button.onclick=()=>manageBoard(button.dataset.deleteBoard,'delete'));
  results.querySelectorAll('[data-use-template]').forEach(button=>button.onclick=()=>start('template',button.dataset.useTemplate));
}
function manageBoard(id, action){
  const board=[...workspaceData.boards,...(workspaceData.templates||[])].find(item=>item.id===id);
  if(!board)return;
  const deleting=action==='delete',requestId=crypto.randomUUID();
  dialog.innerHTML='<header class="wizard-head"><span>'+ (deleting?'DELETE':'SAVE TEMPLATE') +'</span><button class="close" aria-label="Close">×</button></header><div class="wizard-body"><h2 id="start-title">'+(deleting?'Delete “'+escapeHtml(board.title)+'”?':'Save as a private template')+'</h2><p>'+(deleting?'This permanently deletes '+(board.origin==='saved-template'?'this template':'this board and its saved history')+'. This cannot be undone. Independent boards created from a template are kept.':'Save the current roles, jobs, tasks and workflow design. Conversation history, comments, proposals and code references are excluded.')+'</p>'+(!deleting?'<label for="template-name">Template name</label><input id="template-name" maxlength="160" value="'+escapeHtml(board.title)+'">':'')+'<p class="error" role="alert" id="manage-error"></p></div><footer class="wizard-footer"><button class="button" id="manage-cancel">Cancel</button><button class="button '+(deleting?'danger':'primary')+'" id="manage-confirm">'+(deleting?'Delete permanently':'Save template')+'</button></footer>';
  dialog.querySelector('.close').onclick=()=>dialog.close();dialog.querySelector('#manage-cancel').onclick=()=>dialog.close();
  dialog.querySelector('#manage-confirm').onclick=async event=>{
    const title=dialog.querySelector('#template-name')?.value.trim();
    if(!deleting&&!title){dialog.querySelector('#manage-error').textContent='Name your template.';return;}
    const button=event.currentTarget;button.disabled=true;
    try{await requestJson(deleting?'./workspace-api/boards?board='+encodeURIComponent(id):'./workspace-api/templates',{method:deleting?'DELETE':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(deleting?{confirm:true}:{boardId:id,title,requestId})});dialog.close();await load();focusHeading();}
    catch(error){dialog.querySelector('#manage-error').textContent=error.message;button.disabled=false;}
  };
  dialog.showModal();dialog.querySelector(deleting?'#manage-cancel':'#template-name').focus();
}
let setup={};
function start(source,exampleId){if(source==='project'&&isHostedWorkspace){openAgentStart();return;}setup={step:source?1:0,source:source||'project',exampleId,title:(source==='template'?(workspaceData.templates||[]):workspaceData.examples).find(e=>e.id===exampleId)?.title||'',goal:'',requestId:crypto.randomUUID()};paintWizard();dialog.showModal();dialog.querySelector('h2').focus();}
function paintWizard(){
  const example=setup.source==='template'?{...(workspaceData.templates||[]).find(e=>e.id===setup.exampleId),description:'Create an independent board from your saved workflow design. Changes here will not change the template.'}:workspaceData.examples.find(e=>e.id===setup.exampleId);
  dialog.innerHTML='<header class="wizard-head"><span>NEW BOARD · '+(setup.step===0?'CHOOSE A START':setup.step===1?'SET THE CONTEXT':'READY')+'</span><button class="close" aria-label="Close setup">×</button></header><div class="wizard-body"><div class="steps"><i class="on"></i><i class="'+(setup.step>0?'on':'')+'"></i><i class="'+(setup.step>1?'on':'')+'"></i></div>'+(setup.step===0?'<h2>Where would you like to work?</h2><p>Start here or let your coding agent create the board. No setup interview required.</p><div class="start-options"><button class="start-option" data-start="blank"><span class="start-symbol">＋</span><span><strong>Work here</strong><small>Talk it through or skip the interview and build manually.</small></span></button><button class="start-option" data-start="project"><span class="start-symbol">⌘</span><span><strong>Use my coding agent</strong><small>Bring a project, start an idea, or be interviewed in your agent.</small></span></button><button class="start-option" data-start="examples"><span class="start-symbol">▤</span><span><strong>Use an example</strong><small>Explore a complete workflow, then make it your own.</small></span></button></div>':setup.step===1?'<h2>'+escapeHtml(example?(setup.source==='template'?'Use your saved template':'Make this example yours'):setup.source==='project'?'Bring your project into view':'Start a new workflow')+'</h2><p>'+escapeHtml(example?example.description:setup.source==='project'?'Create a board first. Next, we’ll prepare a request for the coding agent that has access to your project.':'Start with the person and the result they need. Staves will ask one question at a time and suggest jobs and tasks for you to review.')+'</p><label for="board-title">Board name</label><input id="board-title" aria-describedby="setup-error" maxlength="120" placeholder="For example, help customers resolve a problem" value="'+escapeHtml(setup.title)+'"><label for="board-goal">Who is this for, and what should they be able to do? <span style="color:var(--muted)">('+ (setup.source==='blank'?'required':'optional') +')</span></label><textarea id="board-goal" maxlength="2000" aria-describedby="setup-error" placeholder="For example: help a customer understand their options and choose a next step">'+escapeHtml(setup.goal)+'</textarea><p class="error" id="setup-error" role="alert"></p>':'<h2>'+escapeHtml(setup.source==='project'?'Board created · awaiting project agent':'Your board is ready')+'</h2><p>'+escapeHtml(setup.source==='project'?'Connect Staves to the coding agent in your project, then give it this request. Model availability does not verify repository access. Project-agent connection is not yet verified; the first descriptions with code evidence will appear on your board.':'Open the canvas to explore, edit and discuss the workflow.')+'</p>'+(setup.source==='project'?'<div class="setup-result"><a href="./workspace#docs/connect" target="_blank" rel="noopener">Read the MCP connection guide ↗</a><pre id="agent-prompt">'+escapeHtml(projectPrompt())+'</pre><button class="button" id="copy-prompt">Copy agent request</button></div>':'') )+'</div>'+(setup.step===1?'<footer class="wizard-footer"><button class="button" id="setup-back">Back</button><button class="button primary" id="create-board">Create board</button></footer>':setup.step===2?'<footer class="wizard-footer"><button class="button" id="setup-close">Back to workspace</button><a class="button primary" href="./?board='+encodeURIComponent(setup.id)+'">Open board ↗</a></footer>':'');
  if(setup.step===1){document.querySelector('#board-goal').required=setup.source==='blank';document.querySelector('#create-board').textContent=setup.source==='blank'?'Create & start interview':'Create board';}
  if(setup.step===1&&setup.source==='blank'){const skip=document.createElement('button');skip.className='button';skip.id='skip-interview';skip.textContent='Skip interview — build manually';skip.onclick=()=>createBoard(true);document.querySelector('.wizard-footer').insertBefore(skip,document.querySelector('#create-board'));}
  dialog.querySelector('.wizard-body h2').id='start-title';dialog.querySelector('h2').tabIndex=-1;
  dialog.querySelector('.close').onclick=()=>dialog.close();dialog.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>{if(b.dataset.start==='project'&&isHostedWorkspace){dialog.close();openAgentStart();return;}if(b.dataset.start==='examples'){dialog.close();location.hash='examples';return;}setup.source=b.dataset.start;setup.exampleId=undefined;setup.step=1;paintWizard();});
  document.querySelector('#setup-back')?.addEventListener('click',()=>{setup.title=document.querySelector('#board-title').value;setup.goal=document.querySelector('#board-goal').value;setup.step=0;paintWizard();});
  document.querySelector('#create-board')?.addEventListener('click',()=>createBoard(false));document.querySelector('#setup-close')?.addEventListener('click',()=>{dialog.close();load();});
  document.querySelector('#copy-prompt')?.addEventListener('click',async e=>{try{await navigator.clipboard.writeText(projectPrompt());e.target.textContent='Copied';}catch{e.target.textContent='Select and copy the request above';}});
  dialog.querySelector('h2').focus();
}
function projectPrompt(){return 'Use Staves to describe this project on board "'+setup.id+'". First inspect the repository and identify the human outcomes, roles, jobs, tasks and handoffs. '+(setup.goal?'Focus on this outcome: '+setup.goal+'. ':'')+'Attach code evidence. Mark planned and unfinished work explicitly; do not treat missing evidence as proof that functionality is absent. Ask me focused questions where human intent is unclear. Then review the workflow and return the most useful findings as questions or proposals for me to consider. Use the Staves workspace configured for this local server.';}
async function createBoard(manual=false){
  const submitting=setup;
  setup.title=document.querySelector('#board-title').value.trim();setup.goal=document.querySelector('#board-goal').value.trim();const error=document.querySelector('#setup-error'),button=document.querySelector('#create-board');
  if(!setup.title){error.textContent='Give your board a name.';document.querySelector('#board-title').setAttribute('aria-invalid','true');document.querySelector('#board-title').focus();return;}document.querySelector('#board-title').removeAttribute('aria-invalid');if(setup.source==='blank'&&!manual&&!setup.goal){error.textContent='Describe who this is for and the result they need.';document.querySelector('#board-goal').setAttribute('aria-invalid','true');document.querySelector('#board-goal').focus();return;}document.querySelector('#board-goal').removeAttribute('aria-invalid');button.disabled=true;document.querySelector('#setup-back').disabled=true;button.textContent='Creating…';if(document.querySelector('#skip-interview'))document.querySelector('#skip-interview').disabled=true;
  try{const result=await requestJson('./workspace-api/boards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:setup.title,goal:setup.goal,source:setup.source,startMode:manual?'manual':'interview',exampleId:setup.exampleId,templateId:setup.source==='template'?setup.exampleId:undefined,requestId:setup.requestId})});if(setup!==submitting){await load();return;}setup.id=result.id;if(setup.source==='blank'){location.href='./?board='+encodeURIComponent(result.id)+(manual?'&manual=1':'&interview=1');return;}setup.step=2;paintWizard();await load();}catch(e){if(setup!==submitting)return;error.textContent=e.name==='TimeoutError'?'The request timed out. Retry safely; this will not create a second board.':e.message;button.disabled=false;document.querySelector('#setup-back').disabled=false;button.textContent=setup.source==='blank'?'Create & start interview':'Create board';if(document.querySelector('#skip-interview'))document.querySelector('#skip-interview').disabled=false;}
}
async function load(orient=false){
  loadError='';loadState='loading';renderRefresh();
  try{workspaceData=await requestJson('./workspace-api');loadState='ready';}catch(e){loadState='error';loadError=e.name==='TimeoutError'?'The workspace took too long to respond. Retry when the server is available.':e.message;}
  renderRefresh();if(orient)focusHeading();
}
let statusPending=false;
async function status(){if(statusPending)return;statusPending=true;
  try{workspaceStatus=await requestJson('./prototype-status');}catch{workspaceStatus=null;}finally{statusChecked=new Date();statusPending=false;}
  const connected=['ready','working'].includes(workspaceStatus?.model?.status);
  document.querySelector('#sidebar-status').textContent=isHostedWorkspace?'Your AI provider':!workspaceStatus?'Status unavailable':connected?'Interview model available':'Interview model status unavailable';
  document.querySelector('#connection-status').textContent=isHostedWorkspace?'Private beta · Cloud workspace':!workspaceStatus?'Connection status unavailable':connected?'Interview model available · v'+workspaceStatus.version:'Interview model status unavailable';
  paintAccountStatus();
}
async function loadConfig(){
  configState='loading';
  const update=()=>{const section=content.querySelector('#config-section');if(section){section.innerHTML=configMarkup();section.querySelector('#retry-config')?.addEventListener('click',loadConfig);}};
  update();
  try{workspaceConfig=await requestJson('./workspace-config');configState='ready';}catch{workspaceConfig=null;configState='error';}
  update();
}
document.querySelector('.skip-link').onclick=e=>{e.preventDefault();content.focus();};
window.addEventListener('hashchange',()=>{render();focusHeading();});render();load();status();loadConfig();setInterval(status,15000);

async function openAgentStart(){
  try {
    if(!window.stavesOpenAgentHandoff)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/beta/agent-handoff.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('Could not load agent setup. Please retry.'));};document.head.append(script);});
    window.stavesOpenAgentHandoff();
  } catch(error) {loadError=error.message;renderRefresh();}
}
