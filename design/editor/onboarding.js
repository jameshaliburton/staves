// Activities are user-selected lenses, not a completion percentage or a fixed script.
const INTERVIEW_ACTIVITIES={
 understand:{label:'Understand',description:'Clarify purpose, people and success while mapping how the work happens.'},
 check:{label:'Check the map',description:'Walk through roles, handoffs and variations. Find missing work and check assumptions together.'},
 friction:{label:'Explore friction',description:'Find where time, effort, capacity or judgment constrain the result.'},
 opportunities:{label:'Design opportunities',description:'Compare human, software and agent approaches against the result you need. Suggestions require review.'}
};
function interviewActivity(session=IV){let value=null;try{value=localStorage.getItem('staves:activity:'+session.board);}catch{}return Object.hasOwn(INTERVIEW_ACTIVITIES,value)?value:'understand';}
/* Who writes the first draft. "ask" records what they say; "draft" lets staves put up a provisional map
   of familiar work for them to correct. Stored per board, because it is a decision about this work. */
/* Drafting is the default now: correcting is faster than answering, and the board marks every
   invented line as staves' until the person settles it. Only an explicit 'ask' turns it off. */
function draftStance(session=IV){try{return localStorage.getItem('staves:draft:'+session.board)==='ask'?'ask':'draft';}catch{return 'draft';}}
function setDraftStance(value){try{localStorage.setItem('staves:draft:'+IV.board,value==='draft'?'draft':'ask');}catch{}}
function setInterviewActivity(value){
 if(!Object.hasOwn(INTERVIEW_ACTIVITIES,value)||IV.busy)return;
 try{localStorage.setItem('staves:activity:'+IV.board,value);}catch{}
 IV.finished=false;paintInterviewState();
}
function paintInterviewActivities(){
 let panel=$('#interview-activities');
 if(!panel){panel=document.createElement('details');panel.id='interview-activities';panel.innerHTML='<summary>Guide the next reply</summary><div>'+Object.entries(INTERVIEW_ACTIVITIES).map(([id,item])=>'<button type="button" data-activity="'+id+'">'+item.label+'</button>').join('')+'</div><p id="interview-activity-description"></p>';$('#iv .iv-options-menu').append(panel);panel.querySelectorAll('button').forEach(button=>button.onclick=()=>setInterviewActivity(button.dataset.activity));}
 const selected=interviewActivity();panel.querySelectorAll('button').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.activity===selected));button.disabled=!!IV.busy;});
 $('#interview-activity-description').textContent=INTERVIEW_ACTIVITIES[selected].description;
}

/* A new design begins with human intent, before there is anything to arrange. */
const emptyStart=document.createElement('section');emptyStart.id='empty-start';emptyStart.setAttribute('aria-labelledby','empty-start-title');$('#tl').append(emptyStart);
let emptySignature='';
let startInterviewRequested=new URLSearchParams(location.search).get('interview')==='1';
let startingInterview=false;
const manualStartRequested=new URLSearchParams(location.search).get('manual')==='1';
let manualStartConsumed=false;
// Roles count as work on the canvas: the start card hides the tracks beneath it, so a board with roles is never empty.
function isEmptyWorkflow(){return !!state.board&&!state.focus&&!state.board.jobs.some(j=>!j.removed)&&!(state.board.tracks||[]).some(t=>!t.removed);}
async function beginWorkflowInterview(){
  if(startingInterview)return;
  const goal=(state.board.goal||state.board.context?.purpose||'').trim();
  if(!goal){$('#empty-goal')?.focus();return;}
  startingInterview=true;
  try{
    openConversation('board');
    $('#ivin')?.focus();
  }finally{startingInterview=false;}
}
function paintEmptyStart(){
  if(manualStartRequested&&!manualStartConsumed&&state.board){manualStartConsumed=true;emptyStart.dataset.manual=state.name;const url=new URL(location.href);url.searchParams.delete('manual');history.replaceState(history.state,'',url);}
  emptyStart.hidden=!isEmptyWorkflow();if(emptyStart.hidden)return;
  const goal=state.board.goal||state.board.context?.purpose||'';
  const progress=state.board.context?.agentProgress;
  if(progress&&emptyStart.dataset.workHere!==state.name&&!startInterviewRequested){
    const signature=JSON.stringify([state.name,'agent',progress]);
    if(signature!==emptySignature){
      emptySignature=signature;
      emptyStart.innerHTML='<h2 id="empty-start-title">Your agent will build the graph here</h2><p>Continue in your coding agent; nothing to fill in here. Saved changes will appear on this board.</p><p id="empty-agent-progress" role="status"></p><div class="empty-alternatives"><button class="bt q" id="empty-work-here">Work here instead</button></div>';
      const savedAt=new Date(progress.updatedAt);
      $('#empty-agent-progress').textContent=(progress.state==='ready'?'Agent draft marked ready for review':progress.state==='partial'?'Agent saved partial work':'Agent setup saved')+(Number.isFinite(savedAt.getTime())?' · '+savedAt.toLocaleString():'');
      $('#empty-work-here').onclick=()=>{emptyStart.dataset.workHere=state.name;emptySignature='';paintEmptyStart();const title=$('#empty-start-title');title.tabIndex=-1;title.focus();};
    }
    if(emptyStart.dataset.manual===state.name)emptyStart.hidden=true;
    return;
  }
  const signature=JSON.stringify([state.name,goal,state.board.origin]);
  if(signature!==emptySignature){
    emptySignature=signature;
    emptyStart.innerHTML='<div class="empty-sequence" aria-hidden="true"><span>Person</span><i>→</i><span>Goal</span><i>→</i><span>Work</span></div><h2 id="empty-start-title">Start with the result someone needs</h2>'+(goal?'<p class="empty-goal-summary">'+esc(goal)+'</p><p>Staves will ask about a real example, then suggest jobs and tasks. You decide what goes on the canvas.</p><button class="bt acc" id="empty-interview">Open conversation</button>':'<p>Who is this for, and what should they be able to do?</p><form id="empty-goal-form"><label for="empty-goal">Workflow goal</label><textarea id="empty-goal" required maxlength="2000" rows="3" placeholder="For example: help a customer understand their options and choose a next step"></textarea><button class="bt acc" type="submit">Save goal & open conversation</button><p id="empty-goal-error" role="alert"></p></form>')+'<div class="empty-alternatives"><button class="bt q" id="empty-manual">Design on the canvas</button><button class="bt q" id="empty-example">Browse examples</button></div>';
    $('#empty-interview')?.addEventListener('click',beginWorkflowInterview);
    $('#empty-example').onclick=()=>{location.href='./workspace#examples';};
    $('#empty-manual').onclick=()=>{emptyStart.hidden=true;emptyStart.dataset.manual=state.name;chooseTrack();};
    $('#empty-goal-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const field=$('#empty-goal'),value=field.value.trim(),button=event.currentTarget.querySelector('button'),error=$('#empty-goal-error');
      if(!value){error.textContent='Describe the person and the result they need.';field.focus();return;}
      button.disabled=true;button.textContent='Saving…';
      try{await checkedOp([{t:'board',id:state.board.id,title:state.board.title,goal:value},{t:'setContext',context:{...state.board.context,purpose:value}}]);await beginWorkflowInterview();}
      catch(e){if(error.isConnected){error.textContent=e.message;button.disabled=false;button.textContent='Save goal & open conversation';}}
    });
  }
  if(emptyStart.dataset.manual===state.name)emptyStart.hidden=true;
  if(startInterviewRequested&&goal&&!startingInterview){
    startInterviewRequested=false;
    const url=new URL(location.href);url.searchParams.delete('interview');history.replaceState(history.state,'',url);
    // The new-board CTA explicitly requested this model turn; never restart it on polling.
    queueMicrotask(()=>beginWorkflowInterview());
  }
}
const renderBeforeEmptyStart=render;render=function(){renderBeforeEmptyStart();paintEmptyStart();};paintEmptyStart();

// Interviewing keeps the conversation and its emerging canvas side by side.
let focusedInterview=false;
function leaveFocusedInterview(){focusedInterview=false;document.body.classList.remove('interview-focus');}
function paintFocusedInterview(){
 // Focus mode is for talking. In the Review tab it would hide #staves-tabs — the only way back to the
 // conversation — and style a panel the interview has been moved out of.
 const active=conversationOpen&&IV.board===state.name&&(typeof stavesTab==='undefined'||stavesTab==='discuss');
 focusedInterview=active;
 document.body.classList.toggle('interview-focus',active);
 if(!active)return;
 const iv=$('#iv');if(!iv)return;
 let header=$('#focused-interview-header');
 if(!header){
  header=document.createElement('header');header.id='focused-interview-header';
  // Stop and Close are built by stavesNavigation in the app bar. Building them here too produced two
  // nodes with the same id and a second X inside the panel, right under the first one.
  header.innerHTML='<div id="conversation-scope"></div><section id="conversation-intention"></section>';
  iv.prepend(header);
  const picker=$('#iv .iv-scope-picker');if(picker){picker.hidden=true;picker.setAttribute('aria-hidden','true');}
  const options=$('#iv .iv-options');if(options){options.hidden=true;options.inert=true;}
  $('#conversation-intention').hidden=true;

 }
 paintBuildControls();paintConversationWorkspace();paintChatControls();
 // the return action stays where it was put: the options menu is hidden and inert in focus mode
 const input=$('#ivin');
 if(input?.tagName==='INPUT'){
  const area=document.createElement('textarea');area.id='ivin';area.rows=2;area.value=input.value;area.disabled=input.disabled;area.oninput=input.oninput;
  area.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#ivsend').click();}};
  input.replaceWith(area);
 }
 $('#ivin').placeholder='Tell Staves about the work…';$('#ivin').setAttribute('aria-label','Message to Staves');
}
const beginBeforeFocus=beginWorkflowInterview;
beginWorkflowInterview=async function(){
 if(!(state.board.goal||state.board.context?.purpose||'').trim())return beginBeforeFocus();
 focusedInterview=true;
 showCanvasTasks=true;
 const pending=beginBeforeFocus();paintFocusedInterview();await pending;paintFocusedInterview();
};
const paintBeforeFocus=paintInterviewState;paintInterviewState=function(){paintBeforeFocus();paintFocusedInterview();};
const renderBeforeFocus=render;render=function(){renderBeforeFocus();paintFocusedInterview();};
const suspendBeforeFocus=suspendConversationVoice;suspendConversationVoice=function(){leaveFocusedInterview();suspendBeforeFocus();};

async function readInterviewResponse(response,onReply){
 if(!response.ok){const message=await response.text();let error;try{error=JSON.parse(message).error;}catch{}throw new Error(error||message||'Could not get a reply');}
 if(!response.headers.get('content-type')?.includes('ndjson'))return response.json();
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
 function event(line){if(!line.trim())return;const value=JSON.parse(line);if(value.type==='reply')onReply(value.text);if(value.type==='complete')result=value;if(value.type==='error')throw new Error(value.message);}
 try{while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let end;while((end=buffer.indexOf('\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(done)break;}if(buffer.trim())event(buffer);}
 finally{reader.releaseLock();}
 if(!result)throw new Error('The reply was interrupted. Your answer is saved; retry to continue.');return result;
}
function paintStreamingReply(){
 const lines=$('#ivlines');if(!lines)return;
 if(!IV.busy){$('#iv-streaming')?.remove();return;}
 let row=$('#iv-streaming');if(!row){row=document.createElement('div');row.id='iv-streaming';row.className='line q';row.innerHTML='<span class="who">Staves</span><span class="say"></span>';lines.append(row);}
 row.querySelector('.say').textContent=IV.responsePreview||'';
}
const paintBeforeStreaming=paintInterviewState;paintInterviewState=function(){paintBeforeStreaming();paintStreamingReply();};
ask=async function(said,session=IV,options){
 options=options||(said===session.lastSaid&&!session.pendingLine?session.lastRequestOptions:null)||{};session.lastRequestOptions=options;
 const requestJob=session.pendingLine?.requestJob||options.focus||session.focusJob||session.job;session.requestFocus=requestJob;if(session.pendingLine)session.pendingLine.requestJob=requestJob;
 if(!session.busy)session.busy=true;session.lastSaid=said;session.error='';session.responsePreview='';globalThis.stavesGenerating?.thinking(true);session.requestController=new AbortController();if(IV===session)paintInterviewState();
 try{
  const line=session.pendingLine;
  if(line&&!line.saved){await sessionOp(session,[{t:'comment',comment:{id:line.id,about:session.job,by:'human',text:'[interview] '+line.text,at:new Date().toISOString()}}]);line.saved=true;}
  const response=await fetch('./interview?stream=1&board='+encodeURIComponent(session.board),{method:'POST',signal:AbortSignal.any([session.requestController.signal,AbortSignal.timeout(125000)]),body:JSON.stringify({job:requestJob,mode:interviewActivity(session),draft:(typeof draftStance==='function'?draftStance(session):'ask'),provider:localStorage.getItem('staves:provider')||undefined,model:localStorage.getItem('staves:model')||undefined,lines:session.lines.map(l=>({who:l.who,text:l.text})),said,suggestions:session.cards.map(c=>({type:c.type,name:c.name,quote:c.quote,state:c.accepted?'accepted':c.gone?'dismissed':'pending',about:c.ops.find(o=>o.t==='updateJob')?.id||c.ops.find(o=>o.t==='job')?.job.parent||'board'})),key:localStorage.getItem('staves:key')||undefined})});
  const r=await readInterviewResponse(response,text=>{session.responsePreview=text;if(IV===session){paintStreamingReply();scrollInterviewLatest();}});
  if(r.engine==='none')throw new Error('No model available. Connect a model in Settings, then retry.');
  await sessionOp(session,[{t:'comment',comment:{id:'c-reply-'+Date.now(),about:session.job,by:'interviewer',text:r.reply,at:new Date().toISOString()}}]);
  session.checkpoint=r.checkpoint;session.topics=r.topics||[];const newCards=(options.opening||r.checkpoint?.state==='collect'?[]:(r.cards||[])).map(c=>({...c}));session.cards=[...newCards,...session.cards];session.lines.push({who:'interviewer',text:r.reply,topics:r.topics||[]});if(line)line.delivery='sent';session.pendingLine=null;session.engine=r.via?'Connected to '+r.via:'Staves';
  if(!options.assessment&&r.checkpoint?.state!=='collect'){if(session.paused)session.heldBuild=newCards;else if(autoBuildEnabled(session))await applyInterviewBatch(session,newCards);}
  if(!options.assessment&&IV===session&&!session.paused&&session.speak&&$('#iv')?.classList.contains('show'))speak(r.reply,()=>{if(IV===session&&session.talk&&!session.busy&&!session.listening&&$('#iv')?.classList.contains('show'))toggleMic();});
 }catch(error){globalThis.stavesGenerating?.failed(String(error?.message||'').slice(0,120)||undefined);if(session.paused&&session.requestController?.signal.aborted){session.resumeNeeded=true;if(session.pendingLine)session.pendingLine.delivery='paused';}else{session.error=conversationFailure(error);if(session.pendingLine)session.pendingLine.delivery='failed';}}
 finally{session.busy=false;session.responsePreview='';proposeSuggestions(session);globalThis.stavesGenerating?.thinking(false);if(IV===session){renderLines();if($('#ivcards'))$('#ivcards').innerHTML=cardsHtml();paintInterviewState();}}
};

/* The browser's own words for these are "Failed to fetch" and "signal timed out", which tell the
   person nothing and do not say the thing that matters: their message is still here. */
function conversationFailure(error){
 const name=String(error&&error.name||''),message=String(error&&error.message||'');
 if(name==='TimeoutError'||/timed out/i.test(message))return 'No reply came back in two minutes. Your message is kept \u2014 retry when you are ready.';
 if(name==='AbortError')return 'That reply was stopped. Your message is kept.';
 if(/failed to fetch|networkerror|load failed/i.test(message))return 'Could not reach Staves. Check your connection; your message is kept.';
 return message||'Could not get a reply';
}
function autoBuildEnabled(session){try{return localStorage.getItem('staves:auto-build:'+session.board)!=='false';}catch{return true;}}
function compactAction(c){
 if(c.ops.some(o=>o.t==='removeJob'))return 'Remove from timeline';
 if(c.ops.some(o=>o.t==='job'&&o.job.parent))return 'Add task to job';
 if(c.ops.some(o=>o.t==='job'))return 'Add job to timeline';
 if(c.ops.some(o=>o.t==='updateJob'))return 'Update node';
 if(c.ops.some(o=>o.t==='track'))return 'Add track';
 if(c.ops.some(o=>o.t==='board'||o.t==='setContext'))return 'Update goal';
 return 'Apply change';
}
cardsHtml=function(){
 // proposeSuggestions records a write failure on the session and on each card, and nothing ever read
 // either one -- so the case this whole mechanism exists to prevent, suggestions quietly lost when you
 // leave the board, looked exactly like the case where everything worked.
 const warning=IV.suggestionError?'<p class="suggestion-warning" role="alert">'+esc(IV.suggestionError)+'</p>':'';
 return warning+IV.cards.map((c,i)=>{
 if(c.gone&&!c.accepted)return '';
 return '<div class="compact-change"><span class="compact-change-name">'+esc(c.name)+(c.confidence==='implied'&&!c.accepted?'<small class="assumption-label">Assumption · review before adding</small>':'')+'</span>'+(c.unsaved?'<small class="compact-unsaved" title="This suggestion is shown here but is not saved to the board yet.">Not saved</small>':'')+(c.accepted?'<span class="compact-saved">Applied</span>':c.ops.length?'<button class="bt q" '+(c.pending?'disabled':'')+' onclick="acceptCard('+i+')">'+(c.pending?'Adding…':esc(compactAction(c)))+'</button><button class="compact-inspect" '+(c.pending?'disabled':'')+' onclick="dismissCard('+i+')" title="Dismiss this suggestion">Dismiss</button>':'<button class="compact-inspect" onclick="clarifyCard('+i+')">Ask what is missing</button>')+'<button class="compact-inspect" onclick="inspectInterviewChange('+i+')">'+(c.ops.some(o=>o.t==='job'||o.t==='updateJob'||o.t==='removeJob')?'Review node':'Details')+'</button>'+(c.error?'<small role="alert">'+esc(c.error)+'</small>':'')+'</div>';
}).join('');};
/* A card with no operations cannot be applied. Saying "Needs clarification" and stopping there left
   the person with nothing to do about it; now it asks. */
function clarifyCard(index){
 const c=IV.cards[index];if(!c)return;
 if(typeof say==='function'&&!IV.busy&&!IV.paused)say('You suggested "'+c.name+'" but it is not something I can put on the board yet. What is missing, and what would you need from me to make it concrete?');
}
function inspectInterviewChange(index){
 const c=IV.cards[index];if(!c)return;
 const target=c.ops.find(o=>o.t==='job')?.job.id||c.ops.find(o=>o.t==='updateJob'||o.t==='removeJob')?.id;
 const existing=target&&job(target);
 // "Review node" promised the node and delivered a dialog that repeated the card back — the same name
 // as the title, then "Current:" with that name again, then the quote, and for an applied change only
 // a Close button. If the node is on the board, show them the node.
 if(existing&&!existing.removed){
  closeSheet();
  if(typeof select==='function')select(existing.parent||existing.id,existing.parent?'task':'job');
  if(typeof caseFocus==='function')caseFocus(existing.id);
  return;
 }
 const effect=cardEffect(c)||compactAction(c);
 const veil=$('#veil');
 veil.innerHTML='<div class="sheet"><div class="sh">'+esc(c.name)+'</div><div class="sb"><p>'+esc(effect)+'</p>'
  // only worth printing when it differs; otherwise it was the title a second time
  +(existing&&existing.name!==c.name?'<p>Currently on the board: '+esc(existing.name)+'</p>':'')
  +(target&&!existing?'<p>This is no longer on the board.</p>':'')
  +(c.detail?'<p>'+esc(c.detail)+'</p>':'')
  +(c.quote?'<p class="quote-source">From what you said</p><blockquote>'+esc(c.quote)+'</blockquote>':'')
  +(c.warning?'<p>'+esc(c.warning)+'</p>':'')
  +'</div><div class="sf"><button class="bt q" id="change-close">Close</button>'
  +(c.ops.length&&!c.accepted?'<button class="bt acc" id="change-add">'+esc(compactAction(c))+'</button>':'')+'</div></div>';
 veil.classList.add('show');$('#change-close').onclick=closeSheet;
 $('#change-add')?.addEventListener('click',async()=>{closeSheet();await acceptCard(index);});
}
function paintBuildControls(){
 const iv=$('#iv');if(!iv)return;
 let controls=$('#interview-build-controls');
 if(!controls){controls=document.createElement('div');controls.id='interview-build-controls';controls.innerHTML='<button class="compact-inspect" id="interview-show-outline">Show what we have</button><span id="interview-checkpoint" role="status"></span><label title="Apply new suggestions to this board as the conversation develops. Each batch can be undone."><input type="checkbox" id="interview-auto-build"> Build automatically</label><button class="bt q" id="interview-analyze">Analyze automation</button><button class="compact-inspect" id="interview-reflect" title="Review the whole workflow against its goal, roles and handoffs">Reflect on workflow</button>';$('#iv .iv-options-menu').append(controls);
 $('#interview-show-outline').onclick=()=>{if(!IV.busy&&!IV.paused)say('Show me what you have so far as a coherent workflow update. Use our earlier answers and leave unsupported parts unknown.');};
 $('#interview-auto-build').onchange=e=>{localStorage.setItem('staves:auto-build:'+IV.board,String(e.target.checked));toast(e.target.checked?'New suggestions will update the timeline automatically':'New suggestions will wait for you to add them');};
 $('#interview-analyze').onclick=()=>{if(IV.busy)return;setInterviewActivity('opportunities');IV.paused=false;paintInterviewState();say('Assess automation opportunities in the current workflow using our conversation. Compare human work, deterministic software, agent assistance and bounded agent execution. Name the existing jobs or tasks, evidence for value, required human judgment and checks, and unknowns. Separate waiting from active effort; consider frequency, volume, variability, expertise, data access, resource constraints and failure cost. Give a concise provisional recommendation and ask the single missing question most likely to change it. Do not invent savings or apply implementation decisions automatically.');};
 $('#interview-reflect').onclick=()=>{if(IV.busy)return;say('Step back and reflect on the whole workflow against our goal and everything I have said. Check gaps, duplicate jobs, responsibility and handoffs. Suggest justified corrections to existing nodes, and ask me about any unresolved assumptions.');};}
 $('#interview-show-outline').disabled=!!IV.busy||!!IV.paused;$('#interview-checkpoint').textContent=IV.checkpoint?.state==='collect'?'Gathering context · '+IV.checkpoint.reason:'';{const header=$('#focused-interview-header'),status=$('#interview-checkpoint');if(header&&status&&status.parentElement!==header)header.append(status);}
 $('#interview-analyze').disabled=!!IV.busy;$('#interview-auto-build').checked=autoBuildEnabled(IV);$('#interview-reflect').disabled=!!IV.busy;
 const form=$('#iv .form');if(form){form.classList.add('compact-changes');form.hidden=!IV.cards.length;}
 let receipt=$('#interview-build-receipt');if(!receipt){receipt=document.createElement('div');receipt.id='interview-build-receipt';$('#ivscroll').prepend(receipt);}
 receipt.hidden=!IV.lastBuild;
 if(IV.lastBuild){receipt.innerHTML='<span>'+esc(IV.lastBuild.undone?'Automatic changes undone':IV.lastBuild.summary)+'</span>'+(!IV.lastBuild.undone?'<button class="compact-inspect" id="undo-interview-build">Undo</button>':'');$('#undo-interview-build')?.addEventListener('click',()=>undoInterviewBatch(IV));}
}
async function applyInterviewBatch(session,cards){
 /* A drafted card is the point of drafting, so it lands. It used to be filtered out here for being
    staves' reading rather than theirs, which meant auto-update applied only what the person had
    already said — everything staves offered queued up in review, and the draft never reached the
    board it was drawn for. What may land is decided once, in interviewer.ts, and travels as auto. */
 const ready=cards.filter(c=>!c.gone&&c.ops?.length&&c.confidence!=='asked'&&c.auto!==false);if(!ready.length)return;
 const snapshotResponse=await fetch('./board.json?board='+encodeURIComponent(session.board));if(!snapshotResponse.ok)throw new Error('Could not snapshot the workflow before updating');const before=await snapshotResponse.json();
 const created=ready.flatMap(c=>c.ops);const exists=(type,id)=>!id||(before[type==='job'?'jobs':type==='track'?'tracks':'artifacts']||[]).some(item=>item.id===id&&!item.removed)||created.some(op=>op.t===type&&op[type]?.id===id);
 const unresolved=created.some(op=>op.t==='job'&&(!exists('track',op.job.track)||!exists('job',op.job.parent)||[...(op.job.inputs||[]),...(op.job.outputs||[])].some(id=>!exists('artifact',id))));
 if(unresolved){ready.forEach(c=>c.error='This section depends on a role, handoff or parent awaiting review. Apply that suggestion first.');return;}
 const actor='interview-build-'+crypto.randomUUID();
 const ops=ready.flatMap(c=>c.ops),preconditions=ready.flatMap(c=>c.preconditions||[]);
 if(preconditions.length!==ops.length){ready.forEach(c=>c.error='This suggestion needs refreshing before an automatic update.');return;}
 const response=await fetch('./op?board='+encodeURIComponent(session.board)+'&by='+actor,{method:'POST',body:JSON.stringify({ops,preconditions})});
 if(!response.ok){ready.forEach(c=>c.error='Automatic update failed. Review and apply this change.');globalThis.stavesGenerating?.failed('That did not land. Nothing on the board changed.');return;}
 // Apply and display the whole revision together; there is no per-node arrival delay.
 ready.forEach(c=>{c.gone=true;c.accepted=true;});session.lastBuild={actor,before,summary:ready.map(c=>c.name).join(' · '),cards:ready,undone:false};
 if(state.name===session.board){try{await load();}catch{toast('Changes saved. Reload to refresh the timeline.');}}
 globalThis.stavesGenerating?.done();
}
async function undoInterviewBatch(session){
 const batch=session.lastBuild;if(!batch||batch.undone||batch.undoing)return;batch.undoing=true;
 try{const response=await fetch('./entries?board='+encodeURIComponent(session.board));if(!response.ok)throw new Error('Could not load change history');const entries=await response.json();const own=entries.filter(e=>e.by===batch.actor);if(!own.length)throw new Error('Could not find these changes');const inverses=[],restored=new Set();
 for(const entry of own.reverse()){
  const o=entry.op,entity=o.t==='track'?'track':o.t==='artifact'?'artifact':['job','updateJob','removeJob','reorder'].includes(o.t)?'job':null;
  if(entity){const id=o[entity]?.id||o.id;const restore=id=>{const key=entity+':'+id;if(restored.has(key))return;restored.add(key);const prior=(batch.before[entity==='job'?'jobs':entity==='track'?'tracks':'artifacts']||[]).find(x=>x.id===id)||null;inverses.push({t:'revert',of:entry.id||String(entry.seq),entity,id,prior});};restore(id);if(o.t==='removeJob')for(const child of batch.before.jobs.filter(j=>j.parent===id))restore(child.id);}
  else if(o.t==='setContext'){const context={};for(const key of Object.keys(o.context))context[key]=batch.before.context?.[key]??null;inverses.push({t:'setContext',context});}
  else if(o.t==='board'){inverses.push({t:'board',id:batch.before.id,title:batch.before.title,goal:batch.before.goal});}
 }
 if(!inverses.length)throw new Error('No reversible changes found');await sessionOp(session,inverses);batch.undone=true;batch.cards.forEach(c=>{c.accepted=false;c.gone=true;});}
 catch(error){toast(error.message);}finally{batch.undoing=false;if(IV===session){$('#ivcards').innerHTML=cardsHtml();paintInterviewState();}}
}
// Suggestions you have not acted on wait on the board, as proposals.
//
// They used to live in the session object, so leaving mid-interview — and an interview is never really
// over — left a conversation where Staves had proposed eight roles with nothing left to accept. The ones
// lost were the ones that needed a person: auto-build applies what you said outright, never an assumption.
//
// A proposal is the mechanism for exactly this: recorded, not applied, answered later by its seq. On the
// board it is visible to whoever opens it next and to a coding agent reading through MCP, it carries the
// words it came from, and its basis makes a stale one refuse rather than apply quietly.
async function proposeSuggestions(session){
 const waiting=(session.cards||[]).filter(c=>(c.ops||[]).length&&!c.gone&&!c.accepted&&c.seq===undefined);
 if(!waiting.length)return;
 const ops=waiting.flatMap(c=>c.ops);
 // A card with no captured basis is still worth recording; losing it is the bug this fixes.
 const preconditions=waiting.every(c=>c.preconditions)?waiting.flatMap(c=>c.preconditions):undefined;
 // the card's own words ride with its first op; the rest are the same suggestion's machinery
 const suggestions=waiting.flatMap(c=>c.ops.map((_,i)=>i?undefined:{name:c.name,quote:c.quote,detail:c.detail,confidence:c.confidence,type:c.type,warning:c.warning}));
 try{
  const response=await fetch('./op?propose=1&by=interviewer&board='+encodeURIComponent(session.board),{method:'POST',body:JSON.stringify({ops,preconditions,suggestions})});
  if(!response.ok)throw new Error(opFailureMessage(response.status,await response.text()));
  const {seqs}=await response.json();
  let at=0;
  for(const card of waiting){card.seq=seqs?.[at];at+=card.ops.length;}
 }catch(error){
  // Silence here is how suggestions went missing in the first place.
  session.suggestionError='These suggestions are shown here but not saved to the board yet: '+(error.message||'the write failed');
  waiting.forEach(c=>{c.unsaved=true;});
 }
}
async function recallSuggestions(session){
 if(!session?.board||(session.cards||[]).length)return;
 try{
  const response=await fetch('./proposals?board='+encodeURIComponent(session.board));
  if(!response.ok)return;
  const waiting=(await response.json()).filter(entry=>entry.suggestion);
  if(!waiting.length)return;
  session.cards=waiting.map(entry=>({...entry.suggestion,ops:[entry.op],preconditions:entry.proposalBasis?[entry.proposalBasis]:undefined,seq:entry.seq}));
  session.recalled=session.cards.length;
 }catch{}
}

// Opening a conversation reads what is still waiting on the board, so it is there however you arrive.
if(typeof interview==='function'){
 const interviewBeforeRecall=interview;
 interview=function(scope){
  interviewBeforeRecall(scope);
  const session=IV;
  recallSuggestions(session).then(()=>{
   if(session.recalled&&IV===session&&$('#ivcards')){$('#ivcards').innerHTML=cardsHtml();paintInterviewState();}
  });
 };
}

// Adding a node also supplies its proposed role and shared-output records, each with the precondition captured for it.
// Records already applied (on the board, or through their own card) are not sent again.
const ownCardOps=c=>'ownOps' in c?{ops:c.ownOps||[],preconditions:c.ownPreconditions}:{ops:c.ops||[],preconditions:c.preconditions};
function interviewDependencies(card,session){
 const onBoard=(type,id)=>state.name===session.board&&(state.board?.[type==='job'?'jobs':type==='track'?'tracks':'artifacts']||[]).some(x=>x.id===id&&!x.removed);
 const available=session.cards.filter(c=>c!==card&&!c.accepted).flatMap(c=>{const own=ownCardOps(c);return own.ops.map((op,i)=>({op,basis:own.preconditions?.[i],card:c}));});
 const own=ownCardOps(card),ops=[],preconditions=[],providers=new Set(),seen=new Set();
 function add(op,basis){const key=JSON.stringify(op);if(seen.has(key))return;seen.add(key);
  if(op.t==='job'){
   const requirements=[['track',op.job.track],...(op.job.inputs||[]).map(id=>['artifact',id]),...(op.job.outputs||[]).map(id=>['artifact',id]),...(op.job.parent?[['job',op.job.parent]]:[])];
   for(const [type,id] of requirements){if(onBoard(type,id))continue;const provider=available.find(p=>p.op.t===type&&p.op[type]?.id===id);if(provider){providers.add(provider.card);add(provider.op,provider.basis);}}
  }
  ops.push(op);preconditions.push(basis);
 }
 own.ops.forEach((op,i)=>add(op,own.preconditions?.[i]));
 return {ops,preconditions:own.preconditions===undefined?undefined:preconditions,providers:[...providers]};
}
// A card that already waits on the board is answered there: accept turns the proposal into work,
// dismiss closes it. Writing its ops again would apply the same change twice.
const acceptBeforeProposal=acceptCard;
acceptCard=async function(index){
 const session=IV,card=session.cards[index];
 if(!card||card.seq===undefined)return acceptBeforeProposal(index);
 if(card.pending)return;
 card.pending=true;card.error='';
 if(IV===session&&$('#ivcards'))$('#ivcards').innerHTML=cardsHtml();
 try{await sessionOp(session,[{t:'accept',seq:card.seq}]);card.gone=true;card.accepted=true;toast(session.refreshError||'Saved to workflow');}
 catch(error){card.error=error.message;toast('Not saved: '+error.message);}
 finally{card.pending=false;if(IV===session&&$('#ivcards')){$('#ivcards').innerHTML=cardsHtml();paintInterviewState();}}
};
async function dismissCard(index){
 const session=IV,card=session.cards[index];if(!card)return;
 if(card.seq!==undefined){try{await sessionOp(session,[{t:'reject',seq:card.seq}]);}catch(error){toast('Could not dismiss: '+error.message);return;}}
 card.gone=true;
 if(IV===session&&$('#ivcards')){$('#ivcards').innerHTML=cardsHtml();paintInterviewState();}
}

const acceptBeforeDependencies=acceptCard;
acceptCard=async function(index){
 const session=IV,card=session.cards[index];if(!card)return;
 if(!('ownOps' in card)){card.ownOps=card.ops;card.ownPreconditions=card.preconditions;}
 const plan=interviewDependencies(card,session);card.ops=plan.ops;card.preconditions=plan.preconditions;
 await acceptBeforeDependencies(index);
 if(!card.accepted)return;
 // A role card whose every operation went in with this job is applied too, so it is not offered again.
 plan.providers.filter(c=>ownCardOps(c).ops.every(op=>plan.ops.includes(op))).forEach(c=>{c.accepted=true;c.gone=true;});
  if(IV===session&&$('#ivcards')){$('#ivcards').innerHTML=cardsHtml();paintInterviewState();}
};

async function toggleInterviewPause(){
 const session=IV;
 if(!session.paused){session.paused=true;session.resumeNeeded=!!session.busy;session.requestController?.abort();session.talk=false;stopDictation(session);stopSpeaking();}
 else{session.paused=false;if(session.resumeNeeded){session.resumeNeeded=false;await ask(session.lastSaid,session);}else if(session.heldBuild){const cards=session.heldBuild;session.heldBuild=null;if(autoBuildEnabled(session))await applyInterviewBatch(session,cards);}}
 paintInterviewState();if(!session.paused)$('#ivin')?.focus();
}
const paintBeforePause=paintInterviewState;paintInterviewState=function(){paintBeforePause();const button=$('#interview-pause');if(button){button.hidden=!IV.busy;button.textContent='Stop';}if(IV.paused){$('#ivin').disabled=false;$('#ivsend').disabled=!!IV.busy;$('#ivstate').innerHTML='Response stopped. Your message is kept. <button class="bt q" id="conversation-resume">Retry response</button>';$('#conversation-resume').onclick=()=>toggleInterviewPause();}};
const sayBeforePause=say;say=function(text){if(IV.paused){IV.paused=false;IV.resumeNeeded=false;}saveConversationLocal('draft','');return sayBeforePause(text);};

// Feedback follows real graph changes; opening an existing board is not a change.
function canvasNodeChanges(previous,nodes){
 const next=new Map(nodes.map(n=>[n.id,JSON.stringify([n.name,n.parent,n.track,n.inputs,n.outputs,n.outcome,n.rationale,n.anchor,n.gate,n.checks,n.tools,n.minutes,n.perWeek,n.beneficiary,n.doneWhen,n.trigger,n.workKind,n.order])])),added=[],updated=[],removed=[];
 if(previous){for(const n of nodes){if(!previous.has(n.id))added.push(n.id);else if(previous.get(n.id)!==next.get(n.id))updated.push(n.id);}for(const id of previous.keys())if(!next.has(id))removed.push(id);}
 return {next,added,updated,removed};
}
let canvasFeedbackBoard=null,canvasPrevious=null,canvasRecent=new Set(),canvasNotice='',canvasNoticeTimer;
const canvasActivity=document.createElement('div');canvasActivity.id='canvas-activity';canvasActivity.hidden=true;canvasActivity.setAttribute('role','status');canvasActivity.setAttribute('aria-live','polite');$('#tl').append(canvasActivity);
function paintCanvasActivity(){
 /* Changes land on the canvas from every tab, so the feedback that shows them cannot be gated on
    being in the Talk tab. It was: focusedInterview is only true while talking, so accepting a
    change in Review switched off the very thing that would have shown it happening — and a field
    edit on an existing job is invisible on a board that draws names and tracks. Nothing appeared
    to happen, which is indistinguishable from nothing happening. */
 const active=conversationOpen&&IV.board===state.name;
 if(!active){canvasActivity.hidden=true;canvasFeedbackBoard=null;canvasPrevious=null;canvasRecent.clear();canvasNotice='';clearTimeout(canvasNoticeTimer);return;}
 const nodes=state.board.jobs.filter(j=>!j.removed);
 if(canvasFeedbackBoard!==state.name){canvasFeedbackBoard=state.name;canvasPrevious=null;canvasRecent.clear();canvasNotice='';}
 const delta=canvasNodeChanges(canvasPrevious,nodes);canvasPrevious=delta.next;
 if(delta.added.length||delta.updated.length||delta.removed.length){
  canvasRecent=new Set([...delta.added,...delta.updated]);
  const parts=[];if(delta.added.length){const proposed=delta.added.some(id=>nodes.find(n=>n.id===id)?.draft);parts.push(delta.added.length+' '+(proposed?(delta.added.length===1?'node proposed':'nodes proposed'):(delta.added.length===1?'node added':'nodes added')));}if(delta.updated.length)parts.push(delta.updated.length+' updated');if(delta.removed.length)parts.push(delta.removed.length+' removed');canvasNotice=parts.join(' · ');
  clearTimeout(canvasNoticeTimer);canvasNoticeTimer=setTimeout(()=>{canvasRecent.clear();canvasNotice='';paintCanvasActivity();},3200);
 }
 $$('#tracks [data-job], #tracks [data-task]').forEach(el=>el.classList.toggle('canvas-changed',canvasRecent.has(el.dataset.job||el.dataset.task)));
 $$('#tracks path[data-to]').forEach(el=>el.classList.toggle('canvas-link-changed',canvasRecent.has(el.dataset.to)||canvasRecent.has(el.dataset.from)));
 // Thinking is announced by stavesGenerating (generating.js); this notice only reports what changed.
 canvasActivity.hidden=!canvasNotice;
 if(canvasActivity.textContent!==canvasNotice)canvasActivity.textContent=canvasNotice;
}
const paintBeforeCanvasActivity=paintInterviewState;paintInterviewState=function(){paintBeforeCanvasActivity();paintCanvasActivity();};
const renderBeforeCanvasActivity=render;render=function(){renderBeforeCanvasActivity();paintCanvasActivity();};
const stopBeforeCanvasActivity=suspendConversationVoice;suspendConversationVoice=function(){stopBeforeCanvasActivity();canvasActivity.hidden=true;};

// Task disclosure uses the native timeline objects and survives opening the chat.
const taskToggle=document.createElement('button');taskToggle.className='bt q';taskToggle.id='show-canvas-tasks';taskToggle.textContent='Show tasks';taskToggle.title='Show task objects underneath each job';
function paintTaskToggle(){taskToggle.setAttribute('aria-pressed',String(showCanvasTasks));document.body.classList.toggle('show-canvas-tasks',showCanvasTasks);if(!taskToggle.isConnected)fitButton.parentElement.before(taskToggle);}
taskToggle.onclick=()=>{showCanvasTasks=!showCanvasTasks;render();};
const renderBeforeTaskToggle=render;render=function(){renderBeforeTaskToggle();paintTaskToggle();};paintTaskToggle();

// Findings have one destination; job attributes are not warning badges.
function jobReviewFindings(j){return findings(j).concat(j.parent?[]:kids(j.id).flatMap(task=>findings(task)));}
function openJobFindings(id){
 select(id,job(id)?.parent?'task':'job');
 const panel=$('#noticed');if(panel){panel.tabIndex=-1;panel.scrollIntoView({block:'nearest'});panel.focus({preventScroll:true});}
}
function paintJobFindings(){
 $$('#tracks .clip[data-job]').forEach(clip=>{
  const j=job(clip.dataset.job);if(!j)return;const list=jobReviewFindings(j);let badge=clip.querySelector('.pin');
  if(!list.length){badge?.remove();return;}
  if(!badge){badge=document.createElement('span');badge.className='pin';clip.append(badge);}
  badge.textContent=list.length;badge.tabIndex=0;badge.setAttribute('role','button');
  badge.setAttribute('aria-label','Review '+list.length+' '+(list.length===1?'finding':'findings')+' for '+j.name);
  badge.title=list.map(f=>f.message).join('\n');
  badge.onmousedown=e=>e.stopPropagation();badge.onclick=e=>{e.stopPropagation();openJobFindings(j.id);};
  badge.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();openJobFindings(j.id);}};
 });
 const j=typeof state.sel==='string'?job(state.sel):null;if(!j)return;
 $('#sh .chip.alert')?.remove();
 const panel=$('#noticed'),body=$('#sb');
 if(panel){body.prepend(panel);panel.setAttribute('aria-label','Needs attention');const title=panel.querySelector('.ih b');if(title)title.textContent='Needs attention';const count=panel.querySelector('.cnt');if(count)count.textContent=jobReviewFindings(j).length===1?'1 finding':jobReviewFindings(j).length+' findings';
  const list=jobReviewFindings(j);panel.querySelectorAll('.iss').forEach((row,i)=>{const text=row.querySelector('.t>div');if(text&&list[i])text.textContent=list[i].rule==='orphan'?'This job has no connections to other jobs yet.':list[i].message;if(list[i]?.rule==='orphan'&&!row.querySelector('button')){const connect=document.createElement('button');connect.className='bt q';connect.textContent='Connect job';connect.onclick=()=>connectPicker(list[i].about);row.append(connect);}});
 }
 const raise=$('#raise');if(raise){raise.placeholder='Ask a question or flag a concern…';raise.setAttribute('aria-label','Question or concern about this work');const section=raise.closest('.issues');const title=section?.querySelector('.ih b');if(title)title.textContent='Your questions';}
 const chain=body?.querySelector('.chain');if(chain&&!kids(j.id).length){const add=chain.firstElementChild;if(add){add.textContent='+ Add task';add.setAttribute('aria-label','Add task to '+j.name);}chain.classList.add('empty-task-chain');}
}
const renderBeforeJobFindings=render;render=function(){renderBeforeJobFindings();paintJobFindings();};paintJobFindings();


// The focused workspace shares the app's conversation; opening chat never leaves the work.
const workSpace=document.createElement('section');workSpace.id='work-space';workSpace.hidden=true;workSpace.setAttribute('aria-label','Job workspace');$('#ws').append(workSpace);
let workEditorId=null,workRootId=null,workView='flow',workReturn=null,workBoard=null,workConversation=null,workSave=Promise.resolve();
const workDrafts=new Map();
function workDraftKey(id){return state.name+':'+id;}
function captureWorkDraft(){
 const form=$('#work-form');if(!form||!workEditorId)return;
 const values=Object.fromEntries(new FormData(form));
 const baseline=JSON.parse(form.dataset.baseline||'{}');
 if(JSON.stringify(values)===JSON.stringify(baseline)){workDrafts.delete(workDraftKey(workEditorId));return;}
 workDrafts.set(workDraftKey(workEditorId),{values,baseline,scroll:$('#work-content').scrollTop});
}
function workValues(item){return {name:item.name,purpose:item.parent?item.rationale||'':item.outcome||'',beneficiary:item.beneficiary||'',done:(item.doneWhen||[]).join('\n'),track:item.track,trigger:item.trigger||'hand',triggerNote:item.triggerNote||'',workKind:item.workKind||'',checks:(item.checks||[]).map(c=>c.rule).join('\n')};}
function workPatch(item,values,baseline=workValues(item)){
 const before=baseline,patch={};
 for(const key of Object.keys(before)){
  if(values[key]===before[key])continue;
  const value=values[key];
  if(key==='name'){if(!value.trim())throw new Error('Give this work a name.');patch.name=value.trim();}
  else if(key==='purpose')patch[item.parent?'rationale':'outcome']=value;
  else if(key==='done')patch.doneWhen=value.split('\n').map(x=>x.trim()).filter(Boolean);
  else if(key==='checks')patch.checks=value.split('\n').map(x=>x.trim()).filter(Boolean).map(rule=>item.checks?.find(c=>c.rule===rule)||{rule});
  else patch[key]=value;
 }
 for(const key of Object.keys(patch))if(JSON.stringify(patch[key])===JSON.stringify(item[key]))delete patch[key];
 return patch;
}
function saveWorkDraft(){
 captureWorkDraft();const id=workEditorId,board=state.name,draft=workDrafts.get(workDraftKey(id));
 if(!draft)return workSave;
 const values={...draft.values};
 workSave=workSave.catch(()=>{}).then(async()=>{
  if(board!==state.name)throw new Error('Return to the original board to save these changes.');
  const item=job(id);if(!item)throw new Error('This work is no longer on the board.');
  const patch=workPatch(item,values,draft.baseline);if(!Object.keys(patch).length)return;
  try{
   if($('#work-save-state'))$('#work-save-state').textContent='Saving…';
   const reviewRole=patch.track&&['person:agent','agent:person'].includes(trackOf(item)?.kind+':'+track(patch.track)?.kind)?patch.track:null;
   if(reviewRole)delete patch.track;
   if(Object.keys(patch).length)await op([{t:'updateJob',id,patch}]);
   if(workEditorId===id&&$('#work-form')){
    // Rebase acknowledged values even when the focused form was deliberately not repainted.
    $('#work-form').dataset.baseline=JSON.stringify({...values,track:reviewRole?item.track:values.track});
    if(reviewRole)$('#work-form').elements.track.value=item.track;
   }
   if(workDrafts.get(board+':'+id)?.values&&JSON.stringify(workDrafts.get(board+':'+id).values)===JSON.stringify(values))workDrafts.delete(board+':'+id);
   if($('#work-save-state'))$('#work-save-state').textContent='Saved';
   if(reviewRole){await inspectTransfer(id,reviewRole);throw new Error('Review the role change before continuing. Other edits are saved.');}
  }
  catch(e){if($('#work-save-state'))$('#work-save-state').textContent=e.message;throw e;}
 });return workSave;
}
function openWorkEditor(id){
 const item=job(id);if(!item)return;
 captureWorkDraft();
 if(workSpace.hidden){workReturn={element:document.activeElement,left:$('#tls').scrollLeft,top:$('#tls').scrollTop,sel:state.sel,kind:state.selKind};workBoard=state.name;workConversation=conversationOpen&&IV.board===state.name?IV.job:state.board.comments.some(c=>c.about==='board'&&(c.by==='interviewer'||c.text?.startsWith('[interview]')))?'board':null;}
 workEditorId=id;workRootId=item.parent||id;workView=item.parent?'details':'flow';
 workSpace.hidden=false;document.body.classList.add('work-focus');$('#tl').inert=true;$('#stage').inert=true;
 paintWorkEditor();
}
async function closeWorkEditor(){
 try{await saveWorkDraft();}catch{return;}
 workSpace.hidden=true;document.body.classList.remove('work-focus');$('#tl').inert=false;$('#stage').inert=false;
 if(IV)IV.focusJob=null;
 if(workReturn){$('#tls').scrollLeft=workReturn.left;$('#tls').scrollTop=workReturn.top;workReturn.element?.isConnected&&workReturn.element.focus({preventScroll:true});}
 workEditorId=null;workRootId=null;workConversation=null;
}
function discussWork(focusInput=true){
 captureWorkDraft();
 // Keep one transcript while navigating the job. Only the request focus changes.
 const scope=workConversation||workRootId;
 if(!conversationOpen||IV.board!==state.name||IV.job!==scope){openConversation(scope);workConversation=scope;}
 IV.focusJob=null;paintInterviewState();paintWorkContext();if(focusInput)$('#ivin')?.focus();
}
// One assessment per saved context; rapid browsing settles before invoking the model.
function createWorkAssessmentScheduler({current,blocked,run,delay=1800,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,pending=null;const seen=new WeakMap();
 const known=c=>seen.get(c.session)?.has(c.key);
 function cancel(){if(timer!==null)clearTimer(timer);timer=null;pending=null;}
 function tick(){
  timer=null;const c=current();
  if(!c){cancel();return;}
  if(!pending||c.session!==pending.session||c.key!==pending.key){cancel();schedule();return;}
  if(known(c)){cancel();return;}
  if(blocked(c)){timer=setTimer(tick,delay);return;}
  const keys=seen.get(c.session)||new Set();keys.add(c.key);seen.set(c.session,keys);pending=null;
  // A failure remains visible for explicit retry, rather than a background retry loop.
  Promise.resolve(run(c)).catch(()=>{});
 }
 function schedule(){const c=current();if(!c||known(c)){cancel();return;}if(pending?.session===c.session&&pending.key===c.key)return;cancel();pending=c;timer=setTimer(tick,delay);}
 return {schedule,cancel};
}
function workAssessmentContext(){
 if(!conversationOpen||IV.board!==state.name||(typeof window!=='undefined'&&window.matchMedia('(max-width: 700px)').matches))return null;
 const item=job(workSpace.hidden?state.sel:workEditorId);if(!item||item.removed)return null;
 const related=state.board.jobs.filter(j=>!j.removed&&(j.id===item.id||j.id===item.parent||j.parent===item.id||(item.inputs||[]).some(id=>(j.outputs||[]).includes(id))||(item.outputs||[]).some(id=>(j.inputs||[]).includes(id))));
 const artifactIds=new Set(related.flatMap(j=>[...(j.inputs||[]),...(j.outputs||[])]));
 return {session:IV,id:item.id,key:JSON.stringify([state.name,item.id,state.board.goal,state.board.context?.purpose,related,state.board.tracks,state.board.artifacts.filter(a=>artifactIds.has(a.id))])};
}
let workTypingAt=0;
document.addEventListener('input',event=>{if(event.target.closest?.('#work-form,#ivin,[contenteditable="plaintext-only"]'))workTypingAt=Date.now();},true);
const workAssessments=createWorkAssessmentScheduler({
 current:workAssessmentContext,
 blocked:({session})=>session.busy||session.paused||session.error||session.pendingLine||session.listening||session.speaking||!!session.draft?.trim()||!!$('#ivin')?.value.trim()||Date.now()-workTypingAt<2200||!!document.activeElement?.closest('#work-form,[contenteditable="plaintext-only"]')||!!$('#veil.show')||workDrafts.has(workDraftKey(workEditorId)),
 run:({session,id})=>ask('The designer has focused this job or task. Read its current saved context and the conversation before responding. Talk directly to the person about the focused work. Ground your reply in its specific outcome, responsibilities, inputs and surrounding workflow. Do not ask whether they want to discuss it; focusing it is the context. Give one relevant observation and ask one useful question to move the design conversation forward. Build on what has already been answered; do not repeat a settled question or invent missing evidence. If clarification would help, ask at most one concrete, open question derived from this context. If nothing material needs clarification, give a concise observation instead. Do not propose or apply edits in this assessment. This is a context change, not a new answer from the designer.',session,{assessment:true,opening:true,focus:id}),
});
function scheduleWorkAssessment(){if(conversationOpen&&(localStorage.getItem('staves:key')||(state.presence||[]).some(p=>p.sampling)))workAssessments.schedule();else workAssessments.cancel();}
function paintWorkContext(){ if(!state.board)return;
 const focused=job(workSpace.hidden?state.sel:workEditorId);IV.focusJob=focused?.id||null;
 document.body.classList.toggle('work-chat',conversationOpen);
 const title=$('#work-discuss');if(title){title.hidden=conversationOpen;title.style.display=conversationOpen?'none':'';title.textContent='Discuss with Staves';title.setAttribute('aria-expanded',String(conversationOpen));}
 if(IV.busy&&IV.lastRequestOptions?.assessment&&!IV.paused&&$('#ivin'))$('#ivin').disabled=false;
 scheduleWorkAssessment();
}
function workFlowHtml(parent,tasks){
 return '<div class="work-flow-summary"><small>JOB OUTCOME</small><h2>'+esc(parent.outcome||parent.name)+'</h2></div><div class="work-flow-cards">'+tasks.map(task=>'<button class="work-flow-task" data-work="'+esc(task.id)+'"><small>'+esc(track(task.track)?.name||'Unassigned')+'</small><strong>'+esc(task.name)+'</strong><span>'+esc(task.triggerNote||(task.trigger==='chain'?'After preceding work':TRIG[task.trigger]?.[1])||'Start not defined')+'</span></button>').join('')+'<button class="work-flow-add" id="work-flow-add">+ Add task</button></div><div class="work-flow-links">'+tasks.flatMap(task=>tasks.filter(other=>other.id!==task.id&&(task.outputs||[]).some(a=>(other.inputs||[]).includes(a))).map(other=>'<div>'+esc(task.name)+' <span aria-label="provides output to">→</span> '+esc(other.name)+'</div>')).join('')+'</div>';
}
function paintWorkEditor(){
 const item=job(workEditorId);if(!item||workSpace.hidden)return;const parent=job(workRootId);if(!parent)return;
 const tasks=kids(parent.id),draft=workDrafts.get(workDraftKey(item.id)),v=draft?.values||workValues(item);
 workSpace.innerHTML='<header class="work-header"><nav aria-label="Work location"><button class="bt q" id="work-back">← Workflow</button><span>/</span><button class="work-crumb" data-work="'+esc(parent.id)+'">'+esc(parent.name)+'</button>'+(item.parent?'<span>/</span><strong>'+esc(item.name)+'</strong>':'')+'</nav><button class="bt acc" id="work-discuss">Discuss with Staves</button></header><div class="work-layout"><nav aria-label="Job and tasks"><button class="work-item '+(!item.parent?'active':'')+'" data-work="'+esc(parent.id)+'">'+esc(parent.name)+'</button><div class="work-nav-label">Tasks <span>'+tasks.length+'</span></div>'+tasks.map(t=>'<button draggable="true" class="work-item '+(t.id===item.id?'active':'')+'" data-work="'+esc(t.id)+'">'+esc(t.name)+'</button>').join('')+'<button class="bt q" id="work-add">+ Add task</button><p class="work-nav-note">Drag to arrange tasks. Start conditions define when they run.</p></nav><main id="work-content"><div class="work-view-tabs" aria-label="Work view"><button class="bt q" id="work-flow" aria-pressed="'+(workView==='flow')+'">Task flow</button><button class="bt q" id="work-details" aria-pressed="'+(workView==='details')+'">'+(item.parent?'Task details':'Job details')+'</button><button class="bt q" id="work-connect">Connect output</button></div>'+(workView==='flow'?workFlowHtml(parent,tasks):'<form id="work-form"><small>'+ (item.parent?'TASK':'JOB')+'</small><label>Name<input name="name" required value="'+esc(v.name)+'"></label><label>'+(item.parent?'What happens?':'What should this achieve?')+'<textarea name="purpose" rows="3">'+esc(v.purpose)+'</textarea></label><label>Who needs the result?<input name="beneficiary" value="'+esc(v.beneficiary)+'"></label><label>Complete when<textarea name="done" rows="2" placeholder="What tells you this work is complete?">'+esc(v.done)+'</textarea></label><details><summary>Start conditions & responsibility</summary><label>Responsible role<select name="track">'+state.board.tracks.filter(t=>!t.removed).map(t=>'<option value="'+esc(t.id)+'" '+(t.id===v.track?'selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></label><label>Starts<select name="trigger">'+Object.entries(TRIG).map(([key,value])=>'<option value="'+key+'" '+(key===v.trigger?'selected':'')+'>'+esc(key==='chain'?'After preceding work':value[1])+'</option>').join('')+'</select></label><label>Trigger details<textarea name="triggerNote" rows="2">'+esc(v.triggerNote)+'</textarea></label></details><details><summary>Tools & checks</summary><label>Work type<input name="workKind" value="'+esc(v.workKind)+'"></label><label>Checks — one per line<textarea name="checks" rows="3">'+esc(v.checks)+'</textarea></label><button type="button" class="bt q" id="work-tools">Edit tools</button></details><footer><span id="work-save-state" role="status">Changes save when you leave a field.</span><button type="submit" class="bt q">Save changes</button></footer></form>')+'</main></div>';
 $('#work-back').onclick=closeWorkEditor;$('#work-discuss').onclick=discussWork;$('#work-connect').onclick=async()=>{try{await saveWorkDraft();connectPicker(item.id);}catch{}};
 for(const [id,view] of [['work-flow','flow'],['work-details','details']])$('#'+id).onclick=async()=>{try{await saveWorkDraft();workView=view;paintWorkEditor();}catch{}};
 const form=$('#work-form');if(form){form.dataset.baseline=JSON.stringify(draft?.baseline||Object.fromEntries(new FormData(form)));form.oninput=captureWorkDraft;form.onchange=()=>saveWorkDraft().catch(()=>{});form.onsubmit=async e=>{e.preventDefault();await saveWorkDraft();};$('#work-tools').onclick=async()=>{try{await saveWorkDraft();sheetTool(item.id);}catch{}};}
 $$('#work-space [data-work]').forEach(button=>{
  button.onclick=async()=>{try{await saveWorkDraft();const focus=button.dataset.work;workEditorId=focus;workView=job(focus)?.parent?'details':'flow';paintWorkEditor();if(conversationOpen)paintWorkContext();}catch{}};
  button.ondragstart=e=>e.dataTransfer.setData('text/plain',button.dataset.work);
  button.ondragover=e=>{if(button.dataset.work!==parent.id){e.preventDefault();button.classList.add('drop-before');}};
  button.ondragleave=()=>button.classList.remove('drop-before');
  button.ondrop=async e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(kids(parent.id).some(t=>t.id===id)&&id!==button.dataset.work&&button.dataset.work!==parent.id){await op([{t:'reorder',id,before:button.dataset.work}]);paintWorkEditor();}};
 });
 const add=async()=>{try{await saveWorkDraft();await addTask(parent.id);}catch{}};$('#work-add').onclick=add;if($('#work-flow-add'))$('#work-flow-add').onclick=add;
 $('#work-content').scrollTop=draft?.scroll||0;workSpace.dataset.signature=JSON.stringify([parent,tasks]);paintWorkContext();
}
sheetJob=openWorkEditor;sheetTask=openWorkEditor;enterFocus=openWorkEditor;
const selectBeforeWorkEditor=select;select=function(id,kind){if(kind==='task'&&job(id)){openWorkEditor(id);return;}selectBeforeWorkEditor(id,kind);paintWorkContext();paintFocusedInterview();};
const workRenderBefore=render;render=function(){workRenderBefore();if(!workSpace.hidden){if(state.name!==workBoard){workSpace.hidden=true;document.body.classList.remove('work-focus','work-chat');$('#tl').inert=false;$('#stage').inert=false;return;}const parent=job(workRootId);if(!parent){workSpace.innerHTML='<p>This job was removed.</p><button class="bt q" onclick="closeWorkEditor()">Back to workflow</button>';return;}const signature=JSON.stringify([parent,kids(parent.id)]);if(signature!==workSpace.dataset.signature&&!$('#work-form')?.contains(document.activeElement)){captureWorkDraft();paintWorkEditor();}paintWorkContext();}};
const workPaintBefore=paintInterviewState;paintInterviewState=function(){workPaintBefore();paintWorkContext();};
const workOpenConversationBefore=openConversation;openConversation=function(scope){
 captureConversationDraft();let remembered;try{remembered=localStorage.getItem('staves:conversation-scope:'+state.name);}catch{}
 const target=scope||(!workSpace.hidden?workEditorId:IV.board===state.name&&IV.job?IV.job:remembered==='board'||job(remembered)?remembered:'board');
 workOpenConversationBefore(target);IV.returnBasis=readConversationLocal('basis');paintFocusedInterview();paintWorkContext();queueMicrotask(()=>startDesignConversation());
};
const workRevealBefore=revealAccepted;revealAccepted=async function(index){if(workSpace.hidden)return workRevealBefore(index);const card=IV.cards[index];const id=card?.ops.find(o=>o.t==='job')?.job.id||card?.ops.find(o=>o.t==='updateJob')?.id;if(job(id)){await saveWorkDraft();openWorkEditor(id);}else toast('Saved to the workflow.');};

// Conversation identity is board + explicit scope. Browser storage holds only drafts and reading position.
function conversationLocalKey(kind,session=IV){return 'staves:conversation:'+JSON.stringify([session.board,session.job,kind]);}
function readConversationLocal(kind,session=IV){try{return localStorage.getItem(conversationLocalKey(kind,session))||'';}catch{return '';}}
function saveConversationLocal(kind,value,session=IV){if(!session.board||!session.job)return;try{localStorage.setItem(conversationLocalKey(kind,session),value);}catch{}}
function captureConversationDraft(){if(IV.board&&IV.job&&$('#ivin')){IV.draft=$('#ivin').value;saveConversationLocal('draft',IV.draft);}}
function restoreConversationDraft(){if(!IV.draft)IV.draft=readConversationLocal('draft');const input=$('#ivin');if(input){input.value=IV.draft||'';input.oninput=()=>{IV.draft=input.value;saveConversationLocal('draft',input.value);};}}
function conversationBasis(board,scope){const jobs=board.jobs.filter(j=>!j.removed&&(scope==='board'||j.id===scope||j.parent===scope));return JSON.stringify([board.goal,board.context?.purpose,jobs,board.tracks,board.artifacts]);}
function conversationIntention(board,scope){return board.comments.find(c=>c.id==='design-conversation:'+scope&&c.about===scope&&c.designConversation?.version===1&&c.designConversation.scope===scope)?.designConversation.intention||'';}
async function saveWorkingIntention(session,intention){
 const value=intention.trim();if(value.length>2000)throw new Error('Keep the working intention under 2,000 characters.');
 await sessionOp(session,[{t:'comment',comment:{id:'design-conversation:'+session.job,about:session.job,by:'human',text:'Working intention: '+value,at:new Date().toISOString(),designConversation:{version:1,scope:session.job,intention:value}}}]);
 saveConversationLocal('intention','',session);return value;
}
function closeDesignConversation(){
 captureConversationDraft();saveConversationLocal('basis',conversationBasis(state.board,IV.job));
 conversationOpen=false;conversationPanel.classList.remove('open');$('#iv').classList.remove('show');
 suspendConversationVoice();document.body.classList.remove('work-chat');focusConversationEntry();
}
function paintConversationModelGate(){
 const composer=$('#iv>.ask');if(!composer)return;
 const available=!!localStorage.getItem('staves:key')||(state.presence||[]).some(p=>p.sampling);
 let gate=$('#conversation-model-gate');if(available){gate?.remove();return;}
 if(!gate){gate=document.createElement('div');gate.id='conversation-model-gate';gate.innerHTML='<span>Connect a model to get a reply. Your draft stays here.</span><button class="compact-inspect" id="conversation-key">Set up model</button><button class="compact-inspect" id="conversation-handoff">Continue in your coding agent</button>';composer.prepend(gate);$('#conversation-key').onclick=keySheet;$('#conversation-handoff').onclick=openConversationHandoff;}
}
// Delivery state is named plainly; a queued request never implies an agent has started it.
function deliveryStateLabel(delivery){
 const status=delivery?.status;
 const label=status==='queued'?'Queued'
  :status==='claimed'?'Claimed by '+(delivery.actor||'an unknown agent')
  :status==='running'?'Running'
  :status==='completed'?'Completed'
  :status==='failed'?'Failed'
  :status||'Unknown';
 return label+(delivery?.note?' · '+delivery.note:'');
}
// Discuss and implement requests need an interactive agent; the listener claims neither, so offering
// its command for them would be a command that never delivers. Assess requests it does claim.
function deliveryCommandText(intent,board){
 if(intent==='implement')return{
  lead:'Open this project in Claude Code or Codex and say:',
  command:'resume staves',
  note:'The background listener does not claim implementation requests; your interactive agent picks this one up.'
 };
 if(intent==='assess')return{
  lead:'Run in your project terminal:',
  command:'npx @staves/cli listen --agent claude --board '+board+' --once',
  note:'Use --agent codex instead if your project uses Codex.'
 };
 return{
  lead:'Open this project in Claude Code or Codex and say:',
  command:'resume staves',
  note:'Conversation requests need your interactive agent; they are not run in the background.'
 };
}
// No dedicated report view exists yet; show the agent's returned conclusions inline.
function deliveryReportHtml(snapshot){
 const latest=snapshot?.returns?.length?snapshot.returns[snapshot.returns.length-1]:null;
 if(!latest)return '';
 const jobs=latest.result?.jobs||[],limitations=latest.result?.limitations||[];
 return '<div class="delivery-report"><h4>Agent report</h4><p>Repository access: '+esc(latest.result?.repositoryAccess||'unknown')+'</p>'
  +(jobs.length?'<ul>'+jobs.map(j=>'<li><strong>'+esc(job(j.jobId)?.name||j.jobId)+'</strong> · '+esc(j.conclusion)+' — '+esc(j.reason)+'</li>').join('')+'</ul>':'')
  +(limitations.length?'<p>Limitations: '+esc(limitations.join('; '))+'</p>':'')
  +(latest.result?.counterproposal?'<p>Counterproposal: '+esc(latest.result.counterproposal)+'</p>':'')
  +'</div>';
}
// Delivery details for the Langfuse evidence panel.
// A queued request waits for an agent. When no agent has ever written to this board, saying so here,
// next to the command, is the difference between a stalled request and an unfinished setup.
function paintDeliveryTracking(container,snapshot,intent,board,onRefresh,onConnect){
 const cmd=deliveryCommandText(intent,board);
 const connection=typeof window!=='undefined'&&window.stavesAgentConnection?window.stavesAgentConnection():null;
 container.innerHTML='<p class="delivery-state" role="status">'+esc(deliveryStateLabel(snapshot.delivery))+' · revision '+esc(String(snapshot.request?.source?.revision??'unknown'))+'</p>'
  +'<p class="delivery-refresh"><button type="button" class="compact-inspect delivery-refresh-now">Refresh now</button></p>'
  +'<div class="delivery-how"><p>'+esc(cmd.lead)+' <code>'+esc(cmd.command)+'</code> <button type="button" class="bt q delivery-copy">Copy</button></p><p class="hint">'+esc(cmd.note)+'</p>'
  // The same guide the connect sheet offers: a command nobody can run is a command nobody has set up yet.
  +'<p class="delivery-guide"><a href="./workspace#docs/connect">Connection guide</a></p>'
  +(connection?.state==='never'?'<p class="connect-agent"><span class="hint">'+esc(connection.text)+'.</span> <button type="button" class="bt q delivery-connect">Connect an agent</button></p>':'')
  +'</div>'
  +(snapshot.delivery?.status==='completed'?deliveryReportHtml(snapshot):'');
 container.querySelector('.delivery-refresh-now').onclick=onRefresh;
 container.querySelector('.delivery-copy').onclick=async e=>{try{await navigator.clipboard.writeText(cmd.command);e.target.textContent='Copied';}catch{e.target.textContent='Select and copy the command above';}};
 const connect=container.querySelector('.delivery-connect');
 if(connect)connect.onclick=()=>(onConnect||(()=>window.stavesOpenConnectSheet({reason:'This request needs a connected agent.'})))();
}

// Continue the current conversation through the shared handoff panel.
function openConversationHandoff(){
 captureConversationDraft();
 const session=IV;
 openHandoffExport({
  board:session.board,
  jobIds:session.job&&session.job!=='board'?[session.job]:undefined,
  intention:conversationIntention(state.board,session.job),
  draft:session.draft||''
 });
}

function paintChatControls(){
 const composer=$('#iv>.ask');if(!composer)return;
 let controls=$('#chat-controls');if(!controls){controls=document.createElement('div');controls.id='chat-controls';controls.innerHTML='<label><input type="checkbox" id="chat-auto-build"> Update board as we talk</label>';composer.append(controls);$('#chat-auto-build').onchange=e=>{localStorage.setItem('staves:auto-build:'+IV.board,String(e.target.checked));paintBuildControls();};}
 $('#chat-auto-build').checked=autoBuildEnabled(IV);
}
function startDesignConversation(){
 const session=IV;
 if((typeof window!=='undefined'&&window.matchMedia('(max-width: 700px)').matches)||!conversationOpen||session.board!==state.name||session.busy||session.paused||session.openingRequested||session.lines.length)return;
 const available=!!localStorage.getItem('staves:key')||(state.presence||[]).some(p=>p.sampling);
 if(!available)return;
 if(session.focusJob){scheduleWorkAssessment();return;}
 session.openingRequested=true;
 return ask('The person has opened this design conversation. Read the saved board, its working intention and the explicit conversation scope. Begin talking directly to the person: briefly ground your opening in this actual workflow, then ask one concrete question that helps them design or improve it. For an empty board, ask who needs what outcome. Do not present a menu, instructions for using the interface, or a list of things they could ask. Do not invent knowledge of the repository or traces. Do not propose or apply graph edits in this opening. This is an opening event, not a statement from the person.',session,{opening:true,assessment:true,focus:session.job});
}
function conversationStarterPrompts(board,scope){
 const item=board.jobs.find(j=>j.id===scope&&!j.removed);
 if(item)return ['Help me clarify the result of “'+item.name+'”.','Walk through an exception in “'+item.name+'” with me.'];
 if(board.jobs.some(j=>!j.removed))return ['Help me understand this workflow and what remains uncertain.','Let’s explore where this workflow creates unnecessary effort.'];
 return ['I want to work through a real example.','Help me clarify who needs a result and what success means.'];
}
function paintConversationWorkspace(){
 const scope=IV.job,session=IV,intention=conversationIntention(state.board,scope),section=$('#conversation-intention');
 const focus=IV.focusJob||scope;const scopeBar=$('#conversation-scope');if(scopeBar){scopeBar.replaceChildren();// The agenda in the card's own header names the scope; saying it again here was the same fact twice.
 scopeBar.hidden=true;if(focus!=='board')scopeBar.append(eb('Back to whole workflow','arrow-left',()=>{if(!workSpace.hidden)closeWorkEditor();state.sel=null;IV.focusJob=null;openConversation('board');}));}
 if(!section)return;
 if(!section.dataset.ready){
  section.dataset.ready='true';section.innerHTML='<button class="conversation-intention-label" id="conversation-edit-intention"><small>WORKING INTENTION</small><span></span>'+ei('pencil-simple')+'</button><form id="conversation-intention-form" hidden><label for="conversation-intention-input">What do you want to work on?</label><textarea id="conversation-intention-input" maxlength="2000" rows="2" placeholder="For example: understand why handoffs fail and design a clearer process"></textarea><div><button class="bt acc" type="submit">Save intention</button><button class="bt q" id="conversation-intention-cancel" type="button">Cancel</button></div><p role="status" id="conversation-intention-error"></p></form>';
  $('#conversation-edit-intention').onclick=()=>{const form=$('#conversation-intention-form');form.hidden=false;$('#conversation-edit-intention').hidden=true;$('#conversation-intention-input').value=readConversationLocal('intention')||conversationIntention(state.board,scope);$('#conversation-intention-input').focus();};
  $('#conversation-intention-input').oninput=e=>saveConversationLocal('intention',e.target.value);
  $('#conversation-intention-cancel').onclick=()=>{$('#conversation-intention-form').hidden=true;$('#conversation-edit-intention').hidden=false;};
  $('#conversation-intention-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{await saveWorkingIntention(session,$('#conversation-intention-input').value);if(IV===session){form.hidden=true;$('#conversation-edit-intention').hidden=false;paintConversationWorkspace();}}catch(error){if(form.isConnected)$('#conversation-intention-error').textContent=error.message;}finally{button.disabled=false;}};
 }
 $('#conversation-edit-intention span').textContent=intention||'What would you like to work on?';$('#conversation-edit-intention').title=intention||'Set a working intention';
 let orientation=$('#conversation-orientation');
 if(!orientation){orientation=document.createElement('section');orientation.id='conversation-orientation';$('#ivlines').before(orientation);}
 const questions=(state.board.questions||[]).filter(q=>(q.about||'board')===scope&&isOpenQuestion(q));
 const basis=conversationBasis(state.board,scope),previous=readConversationLocal('basis');
 if(session.returnBasis===undefined)session.returnBasis=previous;
 const changed=!!session.returnBasis&&session.returnBasis!==basis;
 const signature=JSON.stringify([scope,IV.lines.length,questions,changed,intention,state.board.goal]);
 if(orientation.dataset.signature!==signature){
  orientation.dataset.signature=signature;
  orientation.hidden=true;orientation.replaceChildren();

 }
 $('#conversation-selected-context')?.remove();
 paintConversationModelGate();
}
window.addEventListener('pagehide',()=>{captureConversationDraft();if(IV.board===state.name&&IV.job)saveConversationLocal('basis',conversationBasis(state.board,IV.job));});
