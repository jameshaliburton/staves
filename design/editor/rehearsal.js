/* A traversable design account, never an execution engine or a fabricated run. */
const rehearsalSteps=new Map();
function saveRehearsalDraft(){const id=rehearsalPanel.dataset.step;if(!id)return;rehearsalSteps.set(id,{draft:$('#rehearsal-question')?.value||'',open:!$('#rehearsal-note')?.hidden,branch:$('#rehearsal-next')?.value||''});}
const rehearsal = { open:false, board:null, path:[], cursor:0, message:'', draft:'' };
const rehearsalPanel = document.createElement('section');
rehearsalPanel.id='rehearsal-panel';
rehearsalPanel.hidden=true;
rehearsalPanel.setAttribute('aria-label','Design rehearsal');
document.body.append(rehearsalPanel);
function rehearsalJob() { return job(rehearsal.path[rehearsal.cursor]); }
function rehearsalEdges(id) {
  const edges=(state.board.handoffs||[]).filter(h=>h.from===id && job(h.to) && !job(h.to).removed);
  const stops=(job(id)?.exits||[]).filter(e=>e.target==='stop').map(e=>({from:id,to:'stop',kind:'exit',condition:e.condition}));
  return [...edges,...stops];
}
function rehearsalEdgeLabel(edge) {
  const artifact=state.board.artifacts.find(a=>a.id===edge.artifact)?.name;
  return (edge.to==='stop'?'End this path':job(edge.to)?.name||edge.to)+(artifact?' · '+artifact:edge.condition?' · '+edge.condition:edge.kind==='loop'?' · loop':'');
}
function rehearsalHighlight(reveal=false) {
  const current=rehearsalJob(), visited=new Set(rehearsal.path.slice(0,rehearsal.cursor));
  document.body.classList.toggle('rehearsing',rehearsal.open);
  $$('.clip[data-job]').forEach(clip=>{
    clip.classList.toggle('rehearsal-current',rehearsal.open && clip.dataset.job===current?.id);
    clip.classList.toggle('rehearsal-visited',rehearsal.open && visited.has(clip.dataset.job));
  });
  if(reveal && current) {
    const clip=$$('.clip[data-job]').find(c=>c.dataset.job===current.id);
    clip?.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
  }
}
function openRehearsal() {
  if(!state.board)return;
  if(rehearsal.board===state.name&&rehearsal.path.length){rehearsal.open=true;renderRehearsal();return;}
  rehearsal.open=true;rehearsal.board=state.name;rehearsal.message='Step through the design and choose what happens next. This is a walkthrough, not a live run.';rehearsal.draft='';
  const jobs=live();
  const start=job(state.sel)||jobs.find(j=>!j.parent && ['person','outside'].includes(trackOf(j)?.kind) && j.trigger==='hand')||jobs.find(j=>!j.parent && !(state.board.handoffs||[]).some(h=>h.to===j.id))||jobs[0];
  rehearsal.path=start?[start.id]:[];rehearsal.cursor=0;rehearsalPanel.replaceChildren();
  renderRehearsal();rehearsalHighlight(true);
}
function rehearsalCheck(current) {
  if(!current.outcome) return 'What should change for the person relying on “'+current.name+'”? This job has no result described yet.';
  if(!current.beneficiary) return 'Who benefits from “'+current.name+'”, and how would they know it helped? This job does not yet say who needs the result.';
  if(!current.doneWhen?.length && !current.checks?.length) return 'What would tell us that “'+current.name+'” achieved its outcome? This job has no completion checks yet.';
  if(!current.exits?.length && !current.gate && !current.checks?.some(c=>c.onFail)) return 'If “'+current.name+'” cannot achieve its outcome, who notices and what happens next? This job does not yet describe what happens when it fails.';
  if(!rehearsalEdges(current.id).length) return 'After “'+current.name+'”, how does the person relying on it receive or recognize the result? This job has no onward handoff in the design.';
  return 'If the result of “'+current.name+'” were late, incomplete or wrong, what would the person relying on it experience?';
}
function renderRehearsal() {
  saveRehearsalDraft();
  if(rehearsal.board!==state.name)rehearsal.open=false;
  rehearsalPanel.hidden=!rehearsal.open;
  rehearsalHighlight();
  if(!rehearsal.open)return;
  const current=rehearsalJob();
  if(!current || current.removed){rehearsalPanel.innerHTML='<p>This job is no longer available.</p>';rehearsalPanel.append(eb('Restart','arrow-right',openRehearsal),eb('Close','close',closeRehearsal));return;}
  const signature=JSON.stringify([current,rehearsal.cursor,rehearsal.path,rehearsal.message,state.board.handoffs,state.board.questions]);if(rehearsalPanel.dataset.signature===signature&&$('#rehearsal-question'))return;rehearsalPanel.dataset.signature=signature;
  const edges=rehearsalEdges(current.id),saved=rehearsalSteps.get(state.name+':'+current.id)||{};rehearsal.draft=saved.draft||'';rehearsalPanel.dataset.step=state.name+':'+current.id;
  const notes=(state.board.questions||[]).filter(q=>q.about===current.id && q.text.startsWith('[Design rehearsal]'));
  rehearsalPanel.innerHTML='<header><span class="rehearsal-label">Design rehearsal</span><span class="rehearsal-step">Step '+(rehearsal.cursor+1)+'</span><span class="grow"></span><button class="ib" id="rehearsal-close" aria-label="Close rehearsal">'+ei('close')+'</button></header>'
    +'<div class="rehearsal-transport"><button class="bt q" id="rehearsal-back" aria-label="Previous rehearsal step">'+ei('arrow-u-up-left')+'</button><div class="rehearsal-current-job"><small>'+esc(trackOf(current)?.name||'Unassigned')+'</small><button id="rehearsal-inspect">'+esc(current.name)+'</button></div><select id="rehearsal-next" aria-label="Choose the next handoff"><option value="">'+(edges.length?'Choose a handoff…':'No outgoing handoff')+'</option>'+edges.map((edge,i)=>'<option value="'+i+'">'+esc(rehearsalEdgeLabel(edge))+'</option>').join('')+'</select><button class="bt acc" id="rehearsal-forward">Next '+ei('arrow-right')+'</button></div>'
    +'<div class="rehearsal-tools"><button class="bt q" id="rehearsal-flag">'+ei('bookmark-simple')+' Add a question'+(notes.length?' · '+notes.length:'')+'</button><button class="bt q" id="rehearsal-check">'+ei('question')+' Suggest a question</button><details class="rehearsal-assumptions"><summary>About this walkthrough</summary><p>Follow one handoff at a time and choose each branch. This walkthrough does not simulate parallel work, waiting for multiple inputs, timing, or actual results.</p></details><label class="rehearsal-start">Start at <select id="rehearsal-start" aria-label="Restart rehearsal at a job">'+live().map(j=>'<option value="'+esc(j.id)+'"'+(j.id===current.id?' selected':'')+'>'+esc(j.name)+'</option>').join('')+'</select></label></div>'
    +'<div id="rehearsal-note" hidden><label for="rehearsal-question" id="rehearsal-note-label">Question about this job</label><textarea id="rehearsal-question" rows="2" placeholder="What feels wrong, missing or worth exploring?"></textarea><div><small>Saved on this job for discussion with your coding assistant.</small><button class="bt acc" id="rehearsal-save">Save question</button></div></div><p class="rehearsal-status" role="status">'+esc(rehearsal.message)+'</p>';
  $('#rehearsal-close').onclick=closeRehearsal;
  $('#rehearsal-inspect').onclick=()=>select(current.id,current.parent?'task':'job');
  $('#rehearsal-back').disabled=rehearsal.cursor===0;
  $('#rehearsal-back').onclick=()=>{rehearsal.cursor--;rehearsal.message='';rehearsal.draft='';saveRehearsalDraft();rehearsalPanel.replaceChildren();delete rehearsalPanel.dataset.step;renderRehearsal();rehearsalHighlight(true);};
  const next=$('#rehearsal-next'),forward=$('#rehearsal-forward');
  if(saved.branch&&edges[Number(saved.branch)])next.value=saved.branch;else if(edges.length===1)next.value='0';
  forward.disabled=!edges.length || !next.value;
  next.onchange=()=>{forward.disabled=next.value==='';const edge=edges[Number(next.value)];rehearsal.message=edge && rehearsal.path.includes(edge.to)?'This revisits a job. Advance only if this scenario loops back.':'';$('.rehearsal-status',rehearsalPanel).textContent=rehearsal.message;};
  forward.onclick=()=>{
    const edge=edges[Number(next.value)];if(!edge)return;
    if(edge.to==='stop'){rehearsal.message='This path ends here in the design. The walkthrough does not verify the result.';renderRehearsal();return;}
    if(rehearsal.cursor>=199){rehearsal.message='200 steps reached. Restart to explore another scenario.';renderRehearsal();return;}
    rehearsal.path=rehearsal.path.slice(0,rehearsal.cursor+1);rehearsal.path.push(edge.to);rehearsal.cursor++;rehearsal.message='';rehearsal.draft='';saveRehearsalDraft();rehearsalPanel.replaceChildren();delete rehearsalPanel.dataset.step;renderRehearsal();rehearsalHighlight(true);
  };
  $('#rehearsal-start').onchange=e=>{rehearsal.path=[e.target.value];rehearsal.cursor=0;rehearsal.message='';rehearsal.draft='';saveRehearsalDraft();rehearsalPanel.replaceChildren();delete rehearsalPanel.dataset.step;renderRehearsal();rehearsalHighlight(true);};
  $('#rehearsal-question').value=rehearsal.draft;$('#rehearsal-note').hidden=!saved.open;
  function showNote(check){$('#rehearsal-note').hidden=false;$('#rehearsal-note-label').textContent=check?'Suggested question · based on this job’s details':'Question about this job';if(check)$('#rehearsal-question').value=rehearsalCheck(current);$('#rehearsal-question').focus();}
  $('#rehearsal-flag').onclick=()=>showNote(false);$('#rehearsal-check').onclick=()=>showNote(true);
  $('#rehearsal-save').onclick=async()=>{
    const text=$('#rehearsal-question').value.trim();if(!text)return;
    const button=$('#rehearsal-save');button.disabled=true;
    try{await checkedOp([{t:'ask',question:{id:'rehearsal-'+Date.now(),about:current.id,askedBy:'human',text:'[Design rehearsal]\nPath: '+rehearsal.path.slice(0,rehearsal.cursor+1).map(id=>job(id)?.name||id).join(' → ')+'\n'+text,status:'raised',at:new Date().toISOString()}}]);rehearsal.message='Question saved on '+current.name;rehearsal.draft='';$('#rehearsal-question').value='';$('#rehearsal-note').hidden=true;saveRehearsalDraft();rehearsalPanel.replaceChildren();delete rehearsalPanel.dataset.step;renderRehearsal();}
    catch(error){$('.rehearsal-status',rehearsalPanel).textContent=error.message;button.disabled=false;}
  };
}
function closeRehearsal(){saveRehearsalDraft();if($('#rehearsal-question')?.value.trim())toast('Draft kept on this step. Reopen Walk through to continue.');rehearsal.open=false;renderRehearsal();}
const rehearsalRender=render;
render=function(){rehearsalRender();renderRehearsal();};
const rehearsalTimeline=timeline;
timeline=function(){rehearsalTimeline();rehearsalHighlight();};
/* Runs are read from the connected Langfuse project by the As run mode, not rehearsed here. */
function asRunEntry(){const button=eb('As run','monitor',()=>openAsRun());button.title='Compare the described workflow against what actually happened';return button;}
const rehearsalReady=setInterval(()=>{const bar=$('.editor-viewbar');if(!bar)return;clearInterval(rehearsalReady);const actions=document.createElement('div');actions.className='rehearsal-entry';actions.append(eb('Rehearse','play',openRehearsal),eb('Test a scenario','check',openCaseCheck),asRunEntry());bar.append(actions);rehearsalPanel.hidden=true;},100);

/* Scenarios preview declared rules; their prose is a label, never inferred facts. */
const casePanel=document.createElement('section');casePanel.id='scenario-panel';casePanel.hidden=true;casePanel.setAttribute('aria-labelledby','case-title');document.body.append(casePanel);
let caseBoard=null,caseBusy=false,caseOpener=null,caseRequest=0,caseSession=0,casePreview=null,caseSignature=null;
const caseChoices={conditions:new Map(),exits:new Map(),loops:new Map()};
function caseBoardSignature(){
  if(!state.board)return '';const board=structuredClone(state.board);for(const key of ['findings','stale','scorecard','runs','baseScorecard','diff','boards','columns','handoffs','proposalsList','review','regionMetrics'])delete board[key];board.comments=[];
  if(board.context){delete board.context.agentProgress;delete board.context.langfuse;}
  for(const j of board.jobs){delete j.implementation;delete j.executionEvidence;delete j.confirmedFields;j.status='draft';j.provenance={source:'derived'};}
  const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}':JSON.stringify(value)??'null';
  return 'v1:'+canonical(board);
}
function caseClearOverlay(){$$('.scenario-reached,.scenario-blocked').forEach(node=>node.classList.remove('scenario-reached','scenario-blocked'));}
function caseHighlight(){
  caseClearOverlay();if(casePanel.hidden||!casePreview||caseSignature!==caseBoardSignature()||$('.scenario-history',casePanel)?.open)return;
  const reached=new Set(casePreview.steps.map(step=>step.jobId)),blocked=new Set([...casePreview.questions,...casePreview.waits].map(item=>item.jobId));
  $$('.clip[data-job],.canvas-task[data-task]').forEach(node=>{const id=node.dataset.job||node.dataset.task;node.classList.toggle('scenario-reached',reached.has(id));node.classList.toggle('scenario-blocked',blocked.has(id));});
}
let caseFromConversation=false;
// The scenario panel needs the canvas, so it closes the conversation to get it. It has to give it back:
// launched from the composer's own menu, closing the scenario used to leave the person on a bare canvas
// with the conversation they were in simply gone.
function closeCaseCheck(restore=true){caseRequest++;caseSession++;caseBusy=false;casePanel.hidden=true;document.body.classList.remove('scenario-open');caseClearOverlay();
 if(caseFromConversation){caseFromConversation=false;if(typeof openConversation==='function')openConversation(typeof conversationScope!=='undefined'&&conversationScope?conversationScope:undefined);return;}
 if(restore&&caseOpener?.isConnected)caseOpener.focus();}
function caseSync(){if(casePanel.hidden)return;if(caseBoard!==state.name){closeCaseCheck(false);return;}if(caseSignature&&caseSignature!==caseBoardSignature()){caseRequest++;caseBusy=false;casePreview=null;caseSignature=null;caseClearOverlay();$('#case-save').disabled=true;$('#case-preview').disabled=false;$('#case-save-status').textContent='Preview the updated design';$('#case-result').innerHTML='<p class="scenario-notice">The design changed. Preview again to check this version.</p>';}caseHighlight();}
function caseFocus(id){const node=$$('.clip[data-job],.canvas-task[data-task]').find(node=>(node.dataset.job||node.dataset.task)===id);if(node){node.scrollIntoView({block:'nearest',inline:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});node.setAttribute('tabindex','-1');node.focus({preventScroll:true});}else toast('This job is not visible in the current canvas view.');}
function caseLabel(result,id){return result.snapshot.jobs.find(j=>j.id===id)?.name||id;}
function caseResultMarkup(saved,historical=false){
  const run=saved.run||saved,result=run.result||run;
  const item=(id,text)=>historical?'<span>'+esc(text)+'</span>':'<button type="button" class="scenario-focus" data-case-focus="'+esc(id)+'">'+esc(text)+' '+ei('arrow-right')+'</button>';
  const issues=[...result.questions,...result.waits];
  return '<div class="scenario-summary"><strong>'+esc(result.status==='complete'?'Declared path checked':result.status==='waiting'?'Waiting for inputs':'Needs clarification')+'</strong><span>'+result.steps.length+' steps · '+issues.length+' open points</span></div>'+(historical?'<p class="scenario-muted">Saved revision '+run.sourceRevision+' · '+esc(saved.status||'captured')+'. Historical snapshot; not highlighted on the current canvas.</p>':'<p class="scenario-legend"><span>Reached</span><span>Blocked / unresolved</span></p>')+(run.omittedPendingProposals?'<p>'+run.omittedPendingProposals+' unaccepted proposals excluded.</p>':'')+(issues.length?'<h3>Resolve the open points</h3><ul class="scenario-issues">'+issues.map(issue=>'<li>'+(issue.jobId?item(issue.jobId,caseLabel(result,issue.jobId)):'')+'<p>'+esc(issue.reason)+'</p></li>').join('')+'</ul>':'')+(result.steps.length?'<details open><summary>Modelled path</summary><ol class="scenario-path">'+result.steps.map(step=>'<li>'+item(step.jobId,caseLabel(result,step.jobId))+'<small>Round '+step.round+' · attempt '+step.occurrence+'</small></li>').join('')+'</ol></details>':'')+'<p class="scenario-muted">'+result.outcomes.length+' modelled completion or stop outcomes. No software was executed.</p>'+(historical?'<details><summary>Captured inputs and assumptions</summary><pre>'+esc(JSON.stringify(result.case,null,2))+'</pre></details>':'');
}
function caseRenderChoices(result){
  for(const issue of [...result.questions,...result.waits]){
    const j=result.snapshot.jobs.find(j=>j.id===issue.jobId);if(!j)continue;
    if(j.prerequisites?.kind==='conditional'&&issue.reason.includes('condition'))caseChoices.conditions.set(j.prerequisites.condition,j.prerequisites.condition);
    if(j.exits?.length&&/exit condition|chosen exit/i.test(issue.reason))caseChoices.exits.set(j.id,j);
    if(j.loop&&/whether this case takes/i.test(issue.reason))caseChoices.loops.set(j.id,j);
  }
  const old=caseValues();
  $('#case-choices').innerHTML=[...caseChoices.conditions].map(([condition])=>'<label>'+esc(condition)+'<select data-case-condition="'+esc(condition)+'"><option value="">Unknown</option><option value="true">True in this scenario</option><option value="false">False in this scenario</option></select></label>').join('')+[...caseChoices.exits].map(([id,j])=>'<label>'+esc(j.name)+'<select data-case-exit="'+esc(id)+'"><option value="">Choose what happens…</option>'+j.exits.map(exit=>'<option value="'+esc(exit.condition)+'">'+esc(exit.condition)+'</option>').join('')+'</select></label>').join('')+[...caseChoices.loops].map(([id,j])=>'<label>'+esc(j.name)+' · retry<select data-case-loop="'+esc(id)+'"><option value="">Choose retry behavior…</option><option value="true">Take the declared retry</option><option value="false">Skip the retry</option></select></label>').join('');
  for(const [selector,values] of [['condition',old.conditions],['exit',old.exitChoices],['loop',old.loopChoices]])$$('[data-case-'+selector+']',casePanel).forEach(input=>{const key=input.dataset['case'+selector[0].toUpperCase()+selector.slice(1)];if(Object.hasOwn(values,key))input.value=String(values[key]);});
  $('#case-choices-wrap').hidden=!$('#case-choices').children.length;
}
function caseValues(){const values=(selector,boolean)=>Object.fromEntries($$('[data-case-'+selector+']',casePanel).filter(input=>input.value!=='').map(input=>[input.dataset['case'+selector[0].toUpperCase()+selector.slice(1)],boolean?input.value==='true':input.value]));return {name:$('#case-name').value.trim()||'Untitled scenario',initialArtifacts:$$('[data-case-artifact]',casePanel).filter(input=>input.checked).map(input=>input.dataset.caseArtifact),conditions:values('condition',true),exitChoices:values('exit',false),loopChoices:values('loop',true)};}
async function caseLoadHistory(){const session=caseSession;try{const response=await fetch('./walkthrough?board='+encodeURIComponent(caseBoard),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(await response.text());const saved=await response.json();if(casePanel.hidden||session!==caseSession)return;$('#case-history').innerHTML=saved.length?saved.map(item=>'<details><summary>'+esc(item.run.result.case.name)+' <small>· '+esc(item.status)+'</small></summary>'+caseResultMarkup(item,true)+'</details>').join(''):'<p class="scenario-muted">No saved scenarios yet.</p>';}catch(error){if(!casePanel.hidden&&session===caseSession)$('#case-history').textContent=error.message;}}
async function openCaseCheck(){
  if(!state.board)return;if(!casePanel.hidden){closeCaseCheck();return;}const request=++caseRequest;caseSession++;caseBoard=state.name;caseOpener=document.activeElement;caseBusy=false;casePreview=null;caseSignature=null;Object.values(caseChoices).forEach(map=>map.clear());closeRehearsal();
  if(typeof conversationOpen!=='undefined'){caseFromConversation=conversationOpen;conversationOpen=false;conversationPanel.classList.remove('open');if(typeof stavesNavigation==='function')stavesNavigation();}
  const outputs=new Set(state.board.jobs.filter(j=>!j.removed).flatMap(j=>j.outputs||[]));const inputs=state.board.artifacts.filter(a=>!outputs.has(a.id)),other=state.board.artifacts.filter(a=>outputs.has(a.id));const options=artifacts=>artifacts.map(a=>'<label class="scenario-input"><input type="checkbox" data-case-artifact="'+esc(a.id)+'"><span>'+esc(a.name)+'</span></label>').join('');
  casePanel.innerHTML='<header><div><small>MODEL CHECK</small><h2 id="case-title">Test a scenario</h2></div><button type="button" class="ib" id="case-close" aria-label="Close scenario panel">'+ei('close')+'</button></header><div class="scenario-body"><p class="scenario-intro">Explore what can happen, and where this design needs more detail.</p><form id="case-form"><label class="scenario-name" for="case-name">Situation</label><input id="case-name" maxlength="200" placeholder="For example, missing vendor evidence" aria-describedby="case-name-hint"><p id="case-name-hint" class="scenario-muted">A name for this scenario. Set its facts below.</p><fieldset><legend>What is available at the start?</legend>'+options(inputs)+(other.length?'<details><summary>Other inputs · '+other.length+'</summary>'+options(other)+'</details>':'')+(!state.board.artifacts.length?'<p class="scenario-muted">No inputs declared. Check which jobs can start.</p>':'')+'</fieldset><section id="case-choices-wrap" hidden><h3>Clarify this scenario</h3><p class="scenario-muted">These choices are needed by the path you’re exploring.</p><div id="case-choices"></div></section><button type="submit" class="bt acc" id="case-preview">'+ei('play')+' Preview path</button></form><p id="case-error" role="alert"></p><section id="case-result" aria-live="polite"><p class="scenario-empty">Choose starting facts, then preview. Reached jobs and open points will appear on the canvas.</p></section><details class="scenario-history"><summary>Saved scenarios</summary><div id="case-history">Loading…</div></details></div><footer><span id="case-save-status" role="status">Preview before saving</span><button type="button" class="bt" id="case-save" disabled>Save scenario</button></footer>';
  casePanel.hidden=false;document.body.classList.add('scenario-open');$('#case-close').onclick=()=>closeCaseCheck();$('#case-form').onsubmit=event=>{event.preventDefault();runCaseCheck(false);};$('#case-save').onclick=()=>runCaseCheck(true);$('.scenario-history',casePanel).ontoggle=caseHighlight;$('#case-name').focus();
  $('#case-form').oninput=()=>{caseRequest++;caseBusy=false;casePreview=null;caseSignature=null;caseClearOverlay();$('#case-preview').disabled=false;$('#case-save').disabled=true;$('#case-save-status').textContent='Preview before saving';$('#case-result').innerHTML='<p class="scenario-empty">Facts changed. Preview again to update the path.</p>';};
  caseLoadHistory(request);
}
async function runCaseCheck(save){
  if(caseBusy||casePanel.hidden)return;caseSync();if(save&&!casePreview)return;const request=++caseRequest,signature=caseBoardSignature(),example=caseValues();caseBusy=true;caseSignature=signature;$('#case-preview').disabled=true;$('#case-save').disabled=true;$('#case-error').textContent='';$('#case-save-status').textContent=save?'Saving…':'Checking declared rules…';
  try{const response=await fetch('./walkthrough?board='+encodeURIComponent(caseBoard),{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({case:example,save,...(save?{expectedBasis:casePreview.basis}:{})})});if(!response.ok)throw new Error(await response.text());const result=await response.json();if(casePanel.hidden||request!==caseRequest)return;if(signature!==caseBoardSignature()){caseSync();return;}
    if(!save&&result.basis!==signature){casePreview=null;caseClearOverlay();throw new Error('The saved design differs from this canvas. Refresh the board, then preview again.');}
    if(save){$('#case-save-status').textContent='Scenario saved';caseLoadHistory(request);}else{casePreview=result;caseRenderChoices(result);$('#case-result').innerHTML=caseResultMarkup(result);$$('[data-case-focus]',casePanel).forEach(button=>button.onclick=()=>caseFocus(button.dataset.caseFocus));$('#case-save-status').textContent='Preview only · not saved';caseHighlight();}
  }catch(error){if(!casePanel.hidden&&request===caseRequest){$('#case-error').textContent=error.message;$('#case-save-status').textContent='Check could not finish';}}finally{if(request===caseRequest){caseBusy=false;$('#case-preview').disabled=false;$('#case-save').disabled=!casePreview;}}
}
casePanel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCaseCheck();}});
const scenarioRender=render;render=function(){scenarioRender();caseSync();};
const scenarioTimeline=timeline;timeline=function(){scenarioTimeline();caseSync();};
