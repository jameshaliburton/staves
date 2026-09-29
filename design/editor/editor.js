
/* A change that only edits fields leaves no mark on a board that draws names and tracks. This gives
   it one for a moment: the card it touched is lit where it sits, and scrolled to if it is off screen,
   so a decision made in a panel has a visible consequence on the work. */
function markChangedOnCanvas(ids){
  const seen=[];
  for(const id of ids||[]){
    const clip=document.querySelector('#tracks .clip[data-job="'+CSS.escape(String(id))+'"]');
    if(!clip)continue;
    seen.push(clip);
    clip.classList.remove('just-changed');
    void clip.offsetWidth; // restart the animation when the same card changes twice
    clip.classList.add('just-changed');
    setTimeout(()=>clip.classList.remove('just-changed'),2200);
  }
  seen[0]?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
}
/* Visual shell over the actual Staves editor. All mutations use its operation store. */
/* ei() falls back to a plain rectangle for any name the icon set does not carry, silently -- so a
   menu of unmapped names renders as a column of blank squares. Every name the editor actually asks
   for is mapped here to one that exists. */
const EICON={"chat-circle":"chat-circle-dots","arrow-left":"arrow-u-up-left","arrows-clockwise":"arrow-counter-clockwise","chart-bar":"columns","chart-line":"graph","check-circle":"check","code":"file-text","cube":"shapes","download-simple":"export","eye-slash":"eye","file-code":"file-text","flow-arrow":"arrow-right","git-branch":"git-diff","keyboard":"table","note-pencil":"note","sliders-horizontal":"gear","terminal-window":"monitor","trash":"prohibit",stack:"squares-four",person:'user',agent:'robot',system:'database',outside:'globe-simple',add:'plus',edit:'pencil-simple',close:'x',more:'dots-three',review:'list-checks',job:'rectangle',task:'squares-four',connect:'arrows-left-right'};
function ei(name){return '<svg class="ic" viewBox="0 0 256 256" aria-hidden="true">'+(ICONS[EICON[name]||name]||ICONS.rectangle)+'</svg>';}
/* icons() converts <i class="ph-name"> and looked the name up in ICONS directly, so it never saw the
   alias table ei() uses. Every menu built through ctx() therefore drew a blank rectangle for any name
   the icon set does not carry under that exact spelling. One resolver for both paths. */
if (typeof icons === 'function') {
  icons = function(){
    document.querySelectorAll('i.ph').forEach(el=>{
      const name=[...el.classList].find(c=>c.startsWith('ph-'));
      const key=name?name.slice(3):'';
      const path=ICONS[EICON[key]||key]||ICONS.rectangle;
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 256 256');svg.setAttribute('class','ic');svg.innerHTML=path;
      if(el.hasAttribute('style'))svg.setAttribute('style',el.getAttribute('style'));
      [...el.classList].filter(c=>!c.startsWith('ph')).forEach(c=>svg.classList.add(c));
      el.replaceWith(svg);
    });
  };
}
const TIPS={'Actions':'Group, split, or hand this job to someone else','Add':'Add a job, a task, a role or something that gets passed along','Board':'Rename this board, edit its goal, or switch to another','Edit':'Edit this job — its name, what it should achieve, and who needs it','Open tasks':'Open this job and work on the tasks inside it','Outline':'The board as a list, by role','View':'Change what the board shows — detail, connections, grouping','Explore':'Open this job as its own board','Discuss':'Talk this job through with Staves','Rehearse':'Walk the workflow one step at a time, as it would run','Review tracks':'Read the board role by role, commenting as each one','Show tasks on canvas':'Show every task inside every job, on the board','Combine into a job':'Make these tasks one job, keeping their order and roles','Group under an outcome':'Gather these jobs under one outcome they share','Undo':'Undo the last change you made','Redo':'Redo the change you just undid'};
function eb(label,icon,fn,primary=false){const b=document.createElement('button');b.className='editor-button'+(primary?' primary':'');b.innerHTML=ei(icon)+'<span>'+esc(label)+'</span>';b.setAttribute('aria-label',label);if(TIPS[label])b.title=TIPS[label];b.onclick=fn;return b;}
const tools=document.createElement('div');tools.id='editor-tools';document.body.append(tools);
// Keep every original command, but put specialist commands in one labelled menu.
const original=[...$('#top').children];for(const el of original){if(el.matches('.logo,.name,#pres,.grow'))continue;if(el.matches('.meter')){tools.append(el);continue;}if(el.matches('button')){const t=el.dataset.tip||'Command';el.setAttribute('aria-label',t);el.classList.remove('ib');const text=document.createElement('span');text.className='tool-label';text.textContent=t;el.append(text);}tools.append(el);}
$('#top').append(eb('Add','add',e=>editorAdd(e),true),eb('Review tracks','review',()=>reviewTracks()),eb('Connect assistant','plugs-connected',()=>window.stavesOpenConnectSheet({reason:'Connect a coding agent so it can read this board and work on it.'})),eb('More','more',()=>tools.classList.toggle('show')));
const tlbar=$('#tl>.ph');const textNode=[...tlbar.childNodes].find(n=>n.nodeType===3&&n.textContent.includes('Timeline'));if(textNode)textNode.textContent=' Workflow ';
tlbar.insertBefore(eb('Outline','list-dashes',()=>{document.body.classList.toggle('outline-open');render();}),tlbar.querySelector('.grow'));
const hint=document.createElement('span');hint.className='editor-hint';hint.textContent='Double-click to edit · Shift-click tasks to collect';tlbar.insertBefore(hint,tlbar.querySelector('.grow'));
const toolbar=document.createElement('div');toolbar.className='editor-toolbar';toolbar.id='editor-selection';tlbar.insertBefore(toolbar,tlbar.querySelector('.grow'));
$('#stage>.ph').append(eb('Close','close',()=>{state.sel=null;state.selKind='board';render();}));
function editorAdd(e){const j=job(state.sel);ctx(e,[['Human role','ph-user',()=>addTrack('person')],['Agent role','ph-robot',()=>addTrack('agent')],['System or service','ph-database',()=>addTrack('system')],['External participant','ph-globe-simple',()=>addTrack('outside')],'—',['Job…','ph-rectangle',()=>chooseTrack()],['Task in selected job','ph-squares-four',()=>j?addTask(j.parent||j.id):toast('Select a job first')],['Connect a job output','ph-flow-arrow',()=>j?connectPicker(j.id):toast('Select the sending job first')]]);}
function chooseTrack(){sheet('Add a job',[['t','Who does this work?',null,state.board.tracks.find(t=>!t.removed)?.id,null,state.board.tracks.filter(t=>!t.removed).map(t=>[t.id,WHOI[t.kind],t.name])]],v=>addJobOn(v.t),'ph-rectangle');}
function editTrack(id){const t=track(id);sheet('Edit role',[['n','Name',null,t.name],['m','What they do (optional)',null,t.meta],['k','Role type',null,t.kind,null,Object.entries(WHOI).filter(([k])=>['person','agent','system','outside'].includes(k)).map(([k,i])=>[k,i,({person:'Human',agent:'Agent',system:'System or service',outside:'External participant'})[k]])]],v=>op([{t:'track',track:{...t,name:v.n||t.name,meta:v.m,kind:v.k||t.kind}}]),WHOI[t.kind]);}
function connectPicker(id){const others=live().filter(j=>j.id!==id);sheet('Connect to another job',[['to','Which job needs this output?',null,others[0]?.id,null,others.map(j=>[j.id,'ph-rectangle',j.name])]],v=>sheetHandoff(id,v.to),'ph-flow-arrow');$('#sh-ok').textContent='Continue';}
function extraJob(e){const j=job(state.sel);if(!j)return;ctx(e,[['Edit','ph-pencil-simple',()=>j.parent?sheetTask(j.id):sheetJob(j.id)],['Connect output','ph-arrows-left-right',()=>connectPicker(j.id)],['Add task','ph-squares-four',()=>addTask(j.id)],['Decision and responsibility','ph-scales',()=>sheetGate(j.id)],['Tool','ph-wrench',()=>sheetTool(j.id)],['Alternative path','ph-arrow-bend-up-right',()=>sheetExit(j.id)],['Repeat or retry','ph-arrows-clockwise',()=>sheet('Repeat or retry',[['to','Return to which job?',null,j.loop?.to,null,live().map(item=>[item.id,'ph-rectangle',item.name])],['limit','Maximum repetitions',null,j.loop?.limit],['then','When the limit is reached',null,j.loop?.then]],v=>op([{t:'updateJob',id:j.id,patch:{loop:{to:v.to,limit:Math.max(1,Number(v.limit)||1),then:v.then}}}]),'ph-arrows-clockwise')],['Link to code','ph-file-code',()=>sheet('Link to code',[['path','File path in the repository'],['symbol','Function or symbol (optional)']],v=>v.path&&op([{t:'updateJob',id:j.id,patch:{sources:[...(j.sources||[]),{path:v.path,symbol:v.symbol||undefined}]}}]),'ph-file-code')],'—',['Delete','ph-trash',()=>deleteJob(j.id)]]);}
function proposeCollection(ids=[...state.multi]){const selected=ids.map(job).filter(Boolean);if(selected.length<2){toast('Shift-click at least two tasks');return;}const decisions=selected.filter(j=>j.gate||j.workKind==='decide');if(decisions.length){toast('Keep these decisions with their current role: '+decisions.map(j=>j.name).join(', '));return;}
  const agents=state.board.tracks.filter(t=>!t.removed&&t.kind==='agent');
  sheet('Propose an agent job',[['n','What will the agent deliver?','Name the outcome'],['t','Who does this work?',null,'new',null,[['new','ph-robot','A new agent track'],...agents.map(t=>[t.id,'ph-robot',t.name])]],['for','Who needs this result? (optional)'],['check','What makes the result good enough? (optional)']],async v=>{const now=Date.now(),id='agent-job-'+now,tid=v.t==='new'?'agent-'+now:v.t;const ops=[];if(v.t==='new')ops.push({t:'track',track:{id:tid,name:v.n||'Proposed agent',kind:'agent',meta:'Proposed agent role'}});ops.push({t:'collect',id,name:v.n||'Prepare the result',track:tid,into:selected.map(j=>j.id)},{t:'updateJob',id,patch:{outcome:v.n,beneficiary:v.for,checks:v.check?[{rule:v.check}]:[]}});const prior=new Set(state.board.proposalsList.map(p=>p.seq));await op(ops,{propose:true});const bundle=state.board.proposalsList.filter(p=>!prior.has(p.seq));state.multi.clear();showCollection(bundle,selected,v.n||'Prepare the result');},'ph-robot');}
function showCollection(bundle,selected,name){const V=$('#veil');V.innerHTML='<div class="sheet"><div class="sh">'+ei('agent')+' '+esc(name)+'</div><div class="sb"><div class="collection-preview"><div>'+selected.map(j=>'<div class="collection-task">'+ei(trackOf(j)?.kind||'system')+esc(j.name)+'</div>').join('')+'</div>'+ei('arrow-right')+'<div class="collection-agent">'+ei('agent')+'<b>'+esc(name)+'</b><small>Proposed agent job</small></div></div><p class="hint">Current assignments stay in place until you accept.</p></div><div class="sf"><button class="bt q" id="collection-later">Review later</button><button class="bt q" id="collection-reject">Reject proposal</button><button class="bt acc" id="collection-accept">Accept agent job</button></div></div>';V.classList.add('show');$('#collection-later').onclick=closeSheet;$('#collection-reject').onclick=async()=>{await op(bundle.map(p=>({t:'reject',seq:p.seq})));closeSheet();};$('#collection-accept').onclick=async()=>{await op(bundle.map(p=>({t:'accept',seq:p.seq,by:'human'})));closeSheet();const collect=bundle.find(p=>p.op.t==='collect');if(collect){if(state.focus)await leaveFocus();select(collect.op.id,'job');}toast('Agent job added to the design');};}
function reviewTracks(){const V=$('#veil');const runs=state.board.runs||[],questions=state.board.questions.filter(q=>!q.answer),pending=state.board.proposalsList||[];V.innerHTML='<div class="sheet" style="width:650px"><div class="sh">'+ei('review')+' Review the workflow</div><div class="sb"><h4>Tasks an agent could take</h4><div id="review-runs"></div><h4>Open questions</h4><div id="review-gaps"></div><h4>Proposed changes <small>'+pending.length+'</small></h4><div id="review-proposals"></div></div><div class="sf"><button class="bt q" id="review-full">Full review</button><button class="bt q" id="review-close">Close</button></div></div>';V.classList.add('show');
 if(!runs.length)$('#review-runs').innerHTML='<p class="hint">No task groups have been suggested by the current checks. Open a job and select tasks to explore a different grouping.</p>';
 runs.forEach(r=>{const b=eb(r.tasks.map(id=>job(id)?.name||id).join(' · '),'agent',()=>{closeSheet();state.multi=new Set(r.tasks);render();proposeCollection(r.tasks);});$('#review-runs').append(b);});
 questions.slice(0,8).forEach(q=>{const b=eb(q.text,'question',()=>{closeSheet();select(q.about,job(q.about)?.parent?'task':'job');toggleAsk(true);});$('#review-gaps').append(b);});
 pending.forEach(p=>{const o=p.op;if(o.t==='handover'){const b=eb((job(o.jobId)?.name||o.jobId)+' → '+(track(o.toTrack)?.name||o.toTrack),'agent',()=>{closeSheet();inspectTransfer(o.jobId,o.toTrack,p.seq);});$('#review-proposals').append(b);return;}const label=(o.t==='collect'?'Collect tasks: ':o.t==='updateJob'?'Change: ':o.t+': ')+(o.name||job(o.id)?.name||o.id||o.track?.name||'');const b=eb(label,'job',()=>{closeSheet();select(o.id||null,'job');toggleAsk(true);});$('#review-proposals').append(b);});
 $('#review-full').onclick=()=>{closeSheet();showReview();};$('#review-close').onclick=closeSheet;
}
// Decorate freshly rendered elements without replacing their existing behavior.
let decorating=false;
function decorate(){if(decorating||!state.board)return;decorating=true;document.body.classList.toggle('has-selection',!!state.sel||$('#ask').classList.contains('open'));toolbar.replaceChildren();if(state.multi.size>=2){toolbar.append(eb('Collect '+state.multi.size+' for an agent','agent',()=>proposeCollection(),true),eb('Combine into a job','job',()=>groupJob()),eb('Group under an outcome','stack',()=>editEpic()));}else if(job(state.sel)){const j=job(state.sel);toolbar.append(eb('Edit','edit',()=>j.parent?sheetTask(j.id):sheetJob(j.id)),eb('Open tasks','task',()=>enterFocus(j.id)),eb('Actions','more',extraJob));}
 $$('.track[data-track]>.h').forEach(h=>{if(h.querySelector('.track-add'))return;const tid=h.parentElement.dataset.track;const b=document.createElement('button');b.className='track-add';b.innerHTML=ei('add');b.title='Add job to '+(track(tid)?.name||'track');b.setAttribute('aria-label',b.title);b.onclick=e=>{e.stopPropagation();addJobOn(tid);};h.append(b);const edit=document.createElement('button');edit.className='track-edit';edit.innerHTML=ei('edit');edit.title='Edit '+(track(tid)?.name||'track');edit.setAttribute('aria-label',edit.title);edit.onclick=e=>{e.stopPropagation();editTrack(tid);};h.append(edit);});
 $$('button[data-tip]').forEach(b=>{if(!b.hasAttribute('aria-label'))b.setAttribute('aria-label',b.dataset.tip);});document.querySelectorAll(".clip[data-job]").forEach(c=>{decorateNodeLanguage(c,job(c.dataset.job));c.draggable=true;c.ondragstart=e=>{const j=job(c.dataset.job);e.dataTransfer.setData("text/plain",(j?.parent?"task":"job")+":"+c.dataset.job);};});document.querySelectorAll('.canvas-task[data-task]').forEach(c=>decorateNodeLanguage(c,job(c.dataset.task)));decorating=false;}
const originalRender=render;render=function(){originalRender();decorate();};
// Run after the existing asynchronous board load.
const ready=setInterval(()=>{if(state.board){clearInterval(ready);decorate();}},100);
document.addEventListener('click',e=>{if(!e.target.closest('#editor-tools')&&!e.target.closest('#top'))tools.classList.remove('show');});

// Combining is structural: review the selected children and their destination first.
groupJob=function(){
  const selected=[...state.multi].map(job).filter(Boolean);if(selected.length<2)return;
  const role=trackOf(selected[0]);
  sheet('Combine into a job',[['n','New parent job name','Describe the shared result'],['summary','Work that becomes tasks',null,selected.map(j=>j.name+' — '+(trackOf(j)?.name||'Unassigned')).join('\n'),'area'],['for','Who needs the result?'],['confirm','Structure change',null,'',null,[['yes','ph-check','Create a parent job on '+role.name+'; move these items inside it. Existing task roles stay assigned.']]]],async v=>{
    if(v.confirm!=='yes')throw new Error('Confirm the structure change before combining.');
    if(!v.n.trim())throw new Error('Name the new parent job.');
    const id='j-'+Date.now();await checkedOp([{t:'collect',id,name:v.n,track:role.id,into:selected.map(j=>j.id)},{t:'updateJob',id,patch:{beneficiary:v.for||undefined}}]);state.multi.clear();select(id,'job');
  },'ph-rectangle');
};

// Shape describes explicitly modelled work; color continues to describe its role.
// A document output does not make its producing job a document node.
function nodeLanguage(j){
  if(!j)return {kind:'action',label:'Action'};
  if(j.gate||j.workKind==='decide')return {kind:'decision',label:'Decision'};
  if(j.workKind==='wait')return {kind:'wait',label:'Wait'};
  if(j.workKind==='draft')return {kind:'document',label:'Draft'};
  if(j.workKind==='read')return {kind:'document',label:'Read'};
  return {kind:'action',label:'Action'};
}
function decorateNodeLanguage(c,j){
  if(!j)return;
  const semantic=nodeLanguage(j);
  if(c.classList.contains('canvas-task')&&!c.querySelector(':scope > .node-task-title')){const text=document.createElement('span');text.className='node-task-title';text.textContent=c.textContent;c.replaceChildren(text);}
  if(typeof trackPalette!=='undefined'){const palette=trackPalette[trackOf(j)?.kind];if(palette){c.style.setProperty('--node-role-color',palette.color);c.style.setProperty('--node-role-tint',palette.tint);}else{c.style.removeProperty('--node-role-color');c.style.removeProperty('--node-role-tint');}}
  c.dataset.nodeKind=semantic.kind;
  c.classList.toggle('node-repeats',Boolean(j.loop));
  let repeat=c.querySelector(':scope > .node-repeat');
  if(j.loop&&!repeat){repeat=document.createElement('span');repeat.className='node-repeat';repeat.setAttribute('aria-hidden','true');repeat.title='Repeat or retry';repeat.innerHTML=ei('arrows-clockwise');c.prepend(repeat);}
  if(!j.loop)repeat?.remove();
  // Every semantic marker has a text equivalent; role and work type never share colors.
  const description=[semantic.label,j.loop?'Repeat or retry':null].filter(Boolean).join(' · ');
  c.setAttribute('aria-description',description);
  c.title=[j.name,trackOf(j)?.name,description].filter(Boolean).join(' · ');
  let marker=c.querySelector(':scope > .node-symbol');
  if(semantic.kind==='action'){marker?.remove();return;}
  if(!marker){marker=document.createElement('span');marker.className='node-symbol';marker.setAttribute('aria-hidden','true');c.prepend(marker);}
  marker.title=semantic.label;
  marker.innerHTML='<svg viewBox="0 0 20 20" focusable="false">'+({
    decision:'<path d="M10 2 18 10 10 18 2 10Z"/>',
    wait:'<path d="M3 3h7a7 7 0 0 1 0 14H3Z"/><path d="M8 7v6m3-6v6"/>',
    document:'<path d="M4 2h8l4 4v12H4Z"/><path d="M12 2v5h4M7 11h6m-6 3h4"/>'
  })[semantic.kind]+'</svg>';
}

// Shared viewport collision handling for lightweight canvas popovers.
function positionCanvasPopover(surface,anchor){
  const rect=anchor.getBoundingClientRect(),gap=8;
  surface.style.position='fixed';surface.style.maxWidth='calc(100vw - 16px)';surface.style.maxHeight='calc(100vh - 16px)';
  const height=surface.offsetHeight,width=surface.offsetWidth;
  surface.style.left=Math.max(gap,Math.min(innerWidth-width-gap,rect.left))+'px';
  surface.style.top=(rect.bottom+gap+height<=innerHeight-gap?rect.bottom+gap:Math.max(gap,rect.top-height-gap))+'px';
}
