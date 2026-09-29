/* Conversation and review use the live board. Model interviewing remains the native interview engine. */
let conversationOpen = false;
let conversationScope = null;
let renderedConversationScope = null;
const conversationDrafts = new Map();
const conversationPanel = document.createElement('aside');
conversationPanel.id = 'conversation-panel';
conversationPanel.setAttribute('aria-label', 'Conversation about the workflow');
document.body.append(conversationPanel);
// The agenda handle in the app bar is the way in: it already names the scope and how much of the
// interview staves has, so a pill labelled "Staves" beside it was a second door to the same room
// carrying less information — and, sharing the same anchored slot, it landed on top of Review.
// Focus returns to the agenda handle in the app bar, which is now the only door into the conversation.
// The header repaints when the panel closes, which destroys whatever was focused. Wait for that
// repaint, or focus lands on <body> every single time the conversation is closed.
const focusConversationEntry = () => requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('#staves-agenda')?.focus()));
function conversationContext() { return conversationScope || (job(state.sel) ? state.sel : 'board'); }
function openConversation(scope) {
  conversationScope = scope || null;
  conversationOpen = true;
  renderConversation();
}
function conversationPrompts(j) {
  if (!j) return ['Walk me through the last time someone used this workflow.', 'Where does the work leave this system?', 'Which part requires someone to use their judgment?'];
  const prompts = [];
  if (!j.outcome) prompts.push('What would a good result look like for the person relying on this job?');
  if (!j.gate) prompts.push('What happens when the person doing this is unsure?');
  if (!kids(j.id).length) prompts.push('Walk me through the last time this job was done. What happened first?');
  prompts.push('What changes when this does not go as expected?', 'What information does the next person need?');
  return prompts.slice(0, 3);
}
function renderConversation() {
  conversationPanel.classList.toggle('open', conversationOpen);
  if (!conversationOpen || !state.board) return;
  const scope = conversationContext(), j = job(scope), name = j?.name || state.board.title || 'Whole workflow';
  const signature=JSON.stringify([scope,state.board.questions,state.board.comments,state.presence]);if(conversationPanel.dataset.queueSignature===signature&&$('#conversation-form'))return;conversationPanel.dataset.queueSignature=signature;
  const connected = (state.presence || []).filter(p=>!p.sampling).map(p => p.name);
  const sampler = (state.presence || []).some(p => p.sampling);
  const model = sampler || !!localStorage.getItem('staves:key');
  const qs = (state.board.questions || []).filter(q => (q.about || 'board') === scope);
  const comments = (state.board.comments || []).filter(c => c.about === scope && (c.by === 'interviewer' || /^\[interview\]/.test(c.text)));
  const existingInput = $('#conversation-question');
  if(existingInput && renderedConversationScope) conversationDrafts.set(renderedConversationScope, existingInput.value);
  renderedConversationScope = state.name + ':' + scope;
  const draft = conversationDrafts.get(renderedConversationScope) || '';
  const focused = document.activeElement === existingInput;
  conversationPanel.innerHTML = '<header><span class="conversation-eyebrow">CONVERSATION</span><button class="ib" id="conversation-close" aria-label="Close conversation">'+ei('close')+'</button></header>'
    + '<div class="conversation-context">'+ei(j ? trackOf(j)?.kind || 'job' : 'job')+'<div><small>'+esc(j ? trackOf(j)?.name || 'Job' : 'Board')+'</small><h3>'+esc(name)+'</h3></div></div>'
    + '<section class="conversation-start"><h4>Talk through the work</h4><p>Describe what happens, explore exceptions, and propose changes together.</p><button class="bt acc" id="conversation-interview">'+ei('microphone')+' Talk it through</button><button class="bt q" id="conversation-challenge">Challenge this workflow</button><small>'+ (model ? 'Model configured · connection checked when you start' : 'Connect a model to start the conversation') +'</small><div class="conversation-prompts"></div></section>'
    + (comments.length ? '<details class="conversation-history"><summary>Interview notes <span>'+comments.length+'</span></summary>'+comments.slice(-8).map(c=>'<div class="conversation-turn"><small>'+esc(c.by === 'interviewer' ? 'Staves' : 'You')+'</small><p>'+esc(c.text.replace(/^\[interview\]\s*/,''))+'</p></div>').join('')+'</details>' : '')
    + '<section class="conversation-assistant"><div class="conversation-section-title"><h4>Ask the coding assistant</h4><span class="conversation-dot '+(connected.length?'connected':'')+'"></span></div><small>'+esc(connected.length ? connected.join(', ')+' connected · can read saved questions' : 'No coding assistant connected · questions are saved')+'</small><div class="conversation-thread">'+qs.map(q=>'<details class="conversation-question"><summary><span class="conversation-status">'+esc(questionStatus(q))+'</span><span>'+esc(q.text.split('\n').filter(Boolean).at(-1))+'</span></summary><p>'+esc(q.text)+'</p>'+(q.answer ? '<div class="conversation-answer"><small>'+esc(q.answeredBy || 'Assistant')+'</small><p>'+esc(q.answer)+'</p></div>' : '<small>Saved for a coding assistant to review.</small>')+'</details>').join('')+'</div><form id="conversation-form"><textarea id="conversation-question" aria-label="Question for the coding assistant" placeholder="Ask about this work or suggest a change…" rows="3"></textarea><div><button type="button" class="bt q" id="conversation-connect">Connect assistant</button><button type="submit" class="bt acc">Save question</button></div></form><p class="conversation-error" role="status"></p></section>';
  $('#conversation-close').onclick = () => { conversationOpen = false; conversationPanel.classList.remove('open'); focusConversationEntry(); };
  $('#conversation-interview').onclick = () => { conversationOpen = false; conversationPanel.classList.remove('open'); interview(scope); };
  $('#conversation-challenge').onclick = () => beginChallenge(scope);
  const prompts = conversationPrompts(j);
  prompts.forEach(prompt => {
    const b = document.createElement('button'); b.className = 'conversation-prompt'; b.textContent = prompt;
    b.onclick = () => { conversationOpen = false; conversationPanel.classList.remove('open'); interview(scope); const input = $('#ivin'); if(input) { input.value = 'Explore this with me: '+prompt; input.focus(); } };
    $('.conversation-prompts', conversationPanel).append(b);
  });
  $('#conversation-connect').onclick = () => window.stavesOpenConnectSheet({reason:'Saved questions are answered by a connected coding assistant.'});
  $('#conversation-question').value = draft;
  if (focused) $('#conversation-question').focus();
  $('#conversation-form').onsubmit = async e => {
    e.preventDefault(); const input = $('#conversation-question'), text = input.value.trim(); if (!text) {$('.conversation-error',conversationPanel).textContent='Enter a question before saving.';input.focus();return;}
    const submit = e.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
    try { await checkedOp([{t:'ask', question:{id:'conversation-'+Date.now(), about:scope, askedBy:'human', text, status:'raised', at:new Date().toISOString()}}]); conversationDrafts.delete(state.name + ':' + scope); const fresh=$('#conversation-question'); if(fresh && conversationContext()===scope)fresh.value=''; }
    catch (error) { $('.conversation-error', conversationPanel).textContent = error.message; }
    finally { if(submit.isConnected)submit.disabled=false; }
  };
}
function reviewTrackMap() {
  const tracks = (state.board.tracks || []).filter(t=>!t.removed);
  const jobs = (state.board.jobs || []).filter(j=>!j.removed);
  return '<div class="review-map-title"><b>'+esc(state.board.title || 'Workflow')+'</b><small>'+jobs.filter(j=>!j.parent).length+' jobs · '+jobs.filter(j=>j.parent).length+' tasks · '+tracks.length+' tracks</small></div><div class="review-map-tracks">'+tracks.map(t=>'<span class="review-map-track '+esc(t.kind)+'" title="'+esc(t.name)+' · '+jobs.filter(j=>j.track===t.id).length+' jobs and tasks">'+ei(t.kind)+'<span>'+esc(t.name)+'</span><b>'+jobs.filter(j=>j.track===t.id).length+'</b></span>').join('')+'</div>';
}
function reviewFieldLabel(field) {
  return ({name:'Name',track:'Who does the work',parent:'Part of job',outcome:'Intended result',beneficiary:'Who needs the result',doneWhen:'Completion criteria',checks:'Checks',trigger:'When it starts',inputs:'Inputs',outputs:'Outputs',gate:'Decision and responsibility',sources:'Code references',workKind:'Type of work',tools:'Tools',meta:'Description',kind:'Type',into:'Included tasks',before:'Before',after:'After',removed:'Removed',confirmed:'Confirmed',rule:'Check',onFail:'If the check fails',limit:'Repeat limit',then:'After the limit',to:'Destination'})[field] || field.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
}
function reviewChangeLabel(type) {
  return ({updateJob:'Update job',collect:'Group tasks',job:'Job',track:'Role',artifact:'Shared output',reorder:'Change order',removeJob:'Remove job',handover:'Change role'})[type] || 'Design change';
}
function isOpenQuestion(q){return !q.answer&&!['done','dismissed','answered'].includes(q.status);}
function questionStatus(q) {
  return q.answer ? 'Answered' : ({raised:'Open',open:'Open',working:'Being reviewed',done:'Resolved',dismissed:'Dismissed'})[q.status] || 'Open';
}
function reviewValue(value) {
  if(value == null || value === '') return '<span class="review-value-empty">Not defined</span>';
  if(Array.isArray(value)) return value.length ? value.map(v=>reviewValue(v)).join('<br>') : '<span class="review-value-empty">None</span>';
  if(typeof value==='object') return Object.entries(value).map(([k,v])=>'<span class="review-object-field"><small>'+esc(reviewFieldLabel(k))+'</small> '+reviewValue(v)+'</span>').join('');
  return esc(typeof value==='string' ? job(value)?.name || track(value)?.name || value : String(value));
}
function inspectReviewProposal(seq) {
  const p=(state.board.proposalsList || []).find(p=>p.seq===seq);
  if(!p) {toast('This proposal is no longer pending');reviewTracks();return;}
  const o=p.op, id=o.id||o.job?.id||o.artifact?.id, current=job(id), name=p.suggestion?.name||o.name||o.job?.name||current?.name||o.track?.name||o.artifact?.name||o.t;
  let rows=[];
  if(o.t==='updateJob') rows=Object.entries(o.patch).map(([field,value])=>({field,before:current?.[field],after:value}));
  else if(o.t==='collect') rows=[{field:'Tasks',before:o.into,after:o.name},{field:'Performer',before:null,after:o.track}];
  else if(o.t==='job') rows=Object.entries(o.job).filter(([field])=>!['id','provenance'].includes(field)).map(([field,after])=>({field,before:current?.[field],after}));
  else if(o.t==='track') {const before=track(o.track.id);rows=Object.entries(o.track).filter(([field])=>field!=='id').map(([field,after])=>({field,before:before?.[field],after}));}
  else rows=Object.entries(o).filter(([field])=>!['t','id'].includes(field)).map(([field,after])=>({field,before:'Comparison unavailable for this change',after}));
  const veil=$('#veil');
  veil.innerHTML='<div class="sheet review-proposal"><div class="sh">'+ei('job')+' '+esc(name)+'</div><div class="sb"><div class="review-proposal-meta">Proposed by '+esc(p.by || 'assistant')+' · '+esc(reviewChangeLabel(o.t))+'</div>'+(p.demoted?'<p class="review-proposal-warning">The board has changed since this was proposed. Check the current details before accepting.</p>':'')+'<div class="review-change-grid"><div></div><small>Current</small><small>Proposed</small>'+rows.map(r=>'<b>'+esc(reviewFieldLabel(r.field))+'</b><div>'+reviewValue(r.before)+'</div><div class="review-change-after">'+reviewValue(r.after)+'</div>').join('')+'</div><details class="review-raw"><summary>Technical change details</summary><pre>'+esc(JSON.stringify(o,null,2))+'</pre></details><p id="review-proposal-error" role="status"></p></div><div class="sf"><button class="bt q" id="review-proposal-back">Back</button><button class="bt q" id="review-proposal-discuss">Discuss</button><span class="grow"></span><button class="bt q" id="review-proposal-reject">Reject</button><button class="bt acc" id="review-proposal-accept">Accept change</button></div></div>';
  veil.classList.add('show');
  $('#review-proposal-back').onclick=reviewTracks;
  $('#review-proposal-discuss').onclick=()=>{closeSheet();talkWithStaves(current?.id||'board','Help me assess proposal #'+seq+' ('+name+'). Proposed change: '+JSON.stringify(o));};
  async function decide(t) {
    const buttons=$$('button',veil);buttons.forEach(b=>b.disabled=true);
    try {
      await op([{t,seq,by:'human'}]);
      /* Accepting used to be silent. The write landed and the canvas said nothing, which for a change
         to a field rather than a whole job means nothing visible happened anywhere — and a person
         reasonably concludes their decision was dropped. Say what changed, and say where it went. */
      if(t==='accept'){
        const touched=o.id||o.job?.id||o.jobId;
        const where=touched&&typeof job==='function'?job(touched)?.name:null;
        toast(where?'Accepted \u2014 '+where+' is updated on the board':'Accepted \u2014 the board is updated');
        if(touched) setTimeout(()=>markChangedOnCanvas([touched]),80);
      }
      reviewTracks();
    }
    catch(error) {$('#review-proposal-error').textContent=error.message;buttons.forEach(b=>b.disabled=false);}
  }
  $('#review-proposal-reject').onclick=()=>decide('reject');
  $('#review-proposal-accept').onclick=()=>decide('accept');
}
reviewTracks = function() {
  const runs = state.board.runs || [], questions = (state.board.questions || []).filter(q=>isOpenQuestion(q)), proposals = state.board.proposalsList || [];
  const veil = $('#veil');
  veil.innerHTML = '<div class="sheet review-visual"><div class="sh">'+ei('review')+' Review tracks</div><div class="sb"><div class="review-map">'+reviewTrackMap()+'</div><div class="review-counts"><button data-review-tab="runs"><b>'+runs.length+'</b><span>Tasks to explore with an agent</span></button><button data-review-tab="questions"><b>'+questions.length+'</b><span>Open questions</span></button><button data-review-tab="proposals"><b>'+proposals.length+'</b><span>Proposed changes</span></button></div><div id="review-cards"></div></div><div class="sf"><button class="bt q" id="review-full-native">Detailed review</button><button class="bt q" id="review-talk">Talk through this</button><button class="bt acc" id="review-finish">Done</button></div></div>';
  veil.classList.add('show');
  function show(category) {
    window.stavesReviewCategory=category;
    $$('[data-review-tab]', $('#review-cards').closest('.review-visual')).forEach(b=>b.classList.toggle('active',b.dataset.reviewTab===category));
    const container = $('#review-cards'); container.replaceChildren();
    const list = category==='runs'?runs:category==='questions'?questions:proposals;
    if(!list.length) { const empty=document.createElement('div'); empty.className='review-empty'; empty.innerHTML=ei(category==='runs'?'agent':'check')+'<h4>'+({runs:'No task groups flagged',questions:'No open questions',proposals:'No pending changes'})[category]+'</h4><p>'+({runs:'Nothing flagged for an agent to look at. These come from checks on the board, not from a model review.',questions:'No questions are waiting on you. Anything Staves cannot work out from the board will appear here.',proposals:'Nothing is waiting. Changes you agree in the conversation land here first, and your coding agent can leave them here too \u2014 nothing reaches the board without you.'})[category]+'</p>';container.append(empty);return; }
    list.forEach(item=>{
      const card=document.createElement('article');card.className='review-object-card';
      if(category==='runs') {
        const names=item.tasks.map(id=>job(id)?.name||id); card.innerHTML='<div class="review-object-icon">'+ei('agent')+'</div><div><small>SUGGESTED BY BOARD CHECKS · '+names.length+' TASKS</small><h4>'+esc(track(item.track)?.name || 'Human tasks')+'</h4><div class="review-task-stack">'+names.map(n=>'<span>'+esc(n)+'</span>').join('')+'</div></div>';
        card.append(eb('Explore','arrow-right',()=>{closeSheet();state.multi=new Set(item.tasks);render();proposeCollection(item.tasks);}));
      } else if(category==='questions') {
        card.innerHTML='<div class="review-object-icon">'+ei('question')+'</div><div><small>'+esc(job(item.about)?.name || 'Whole workflow')+'</small><h4>'+esc(item.text.split('\n').filter(Boolean).at(-1))+'</h4><span class="conversation-status">'+esc(questionStatus(item))+'</span></div>';
        card.append(eb('Discuss','chat-circle',()=>{closeSheet();if(job(item.about))select(item.about,job(item.about).parent?'task':'job');openConversation(item.about||'board');}));
      } else {
        const o=item.op, id=o.jobId||o.id;
        // A suggestion from the interview knows its own name and the words it came from; an op does not.
        const title=item.suggestion?.name||o.name||o.job?.name||job(id)?.name||o.track?.name||o.artifact?.name||o.t;
        const from=item.suggestion?`FROM THE CONVERSATION${item.suggestion.confidence==='implied'?' · ASSUMPTION':''}`:null;
        card.innerHTML='<div class="review-object-icon">'+ei(o.t==='handover'?'agent':'job')+'</div><div><small>'+esc(from||(o.t==='handover'?'REASSIGN WORK':o.t==='collect'?'GROUP TASKS':reviewChangeLabel(o.t).toUpperCase()))+'</small><h4>'+esc(title)+'</h4>'+(item.suggestion?.quote?'<p class="review-quote">“'+esc(item.suggestion.quote)+'”</p>':'')+(o.toTrack?'<span class="review-destination">'+esc(track(o.toTrack)?.name||o.toTrack)+'</span>':'')+'</div>';
        card.append(eb('Review','arrow-right',()=>{closeSheet();if(o.t==='handover')inspectTransfer(o.jobId,o.toTrack,item.seq);else{inspectReviewProposal(item.seq);}}));
      }
      container.append(card);
    });
  }
  $$('[data-review-tab]',veil).forEach(b=>b.onclick=()=>show(b.dataset.reviewTab));
  $('#review-finish').onclick=closeSheet; $('#review-full-native').onclick=()=>{closeSheet();showReview();}; $('#review-talk').onclick=()=>{closeSheet();openConversation('board');};
  show(proposals.length?'proposals':questions.length?'questions':runs.length?'runs':(window.stavesReviewCategory||'proposals'));
};
const renderBeforeConversation = render;
render = function() { renderBeforeConversation(); renderConversation(); };
const presenceBeforeConversation = presence;
presence = function(list) { presenceBeforeConversation(list); renderConversation(); };
// Explain actual capabilities instead of hard-coding which client supports sampling.
keyGate = function() { paintConversationModelGate(); };

// Starting an intention is an explicit model request, retained in the existing transcript.
function talkWithStaves(scope,contextText,returnAction){openConversation(scope||'board');if(contextText){$('#ivin').value=contextText;IV.draft=contextText;$('#ivin').focus();}if(returnAction){IV.returnAction=returnAction;discussionActions();}}
function beginChallenge(scope){talkWithStaves(scope,'Challenge this workflow with me. Start from the board evidence and ask one consequential question about the human outcome. Follow my answers; leave unknown implementation details as open questions.');}
function discussionActions() {
  const box = $('#iv .ask');
  if (!box) return;$('#discussion-actions')?.remove();
  const actions = document.createElement('div');
  actions.id = 'discussion-actions';
  const unknown = eb('Not sure yet', 'question', () => {
    if (IV.busy) return;
    say('I do not know yet. Leave that unresolved and help me identify what would answer it.');
  });
  unknown.disabled=IV.busy;unknown.title=IV.busy?'Wait for the current reply':'Leave this question unresolved';actions.append(unknown);const actionMenu=$('#iv .iv-options-menu');if(actionMenu)actionMenu.append(actions);
  const options=$('#iv .iv-options-menu');
  if(options&&!$('#implementation-request-action')){const request=eb('Request implementation input…','code',()=>requestImplementationInput());request.id='implementation-request-action';options.append(request);}
  renderImplementationRequests();
  $('#iv-progress')?.remove();
  const progress=document.createElement('div');progress.id='iv-progress';
  const count=IV.cards.filter(c=>!c.gone&&c.ops.length).length,saved=IV.cards.filter(c=>c.accepted).length;
  const summary=document.createElement('span');summary.textContent=IV.lines.filter(l=>l.who==='person').length+' responses'+(saved?' · '+saved+' changes saved':'');progress.append(summary);
  if(count){const review=eb('Review '+count+' suggestions','list-checks',()=>{$('#iv .form').scrollIntoView({block:'start'});IV.followLatest=false;});progress.append(review);}
  if(IV.job!=='board'&&kids(IV.job).length){progress.append(eb('Show tasks on canvas','rows',()=>{const id=IV.job;suspendConversationVoice();conversationOpen=false;conversationPanel.classList.remove('open');$('#iv').classList.remove('show');enterFocus(id);}));}
  // #iv-progress is retired by the newest conversation surface (real-conversation.css hides it with the
  // old bar and chat controls); it stays where it was rather than being revived against that decision.
  $('#iv .bar').append(progress);
  $('#iv-return')?.remove();if(IV.returnAction){const action=IV.returnAction;const button=eb(action.label,'arrow-left',()=>{suspendConversationVoice();conversationOpen=false;conversationPanel.classList.remove('open');$('#iv').classList.remove('show');action.run();});button.id='iv-return';($('#focused-interview-header')||$('#iv .bar')).append(button);}
  const title = $('#iv .bar h3');
  if (title) title.textContent = 'Talk with Staves';const done=$('#ivclose');if(done)done.onclick=()=>{suspendConversationVoice();conversationOpen=false;conversationPanel.classList.remove('open');$('#iv').classList.remove('show');focusConversationEntry();};
}
const interviewBeforeDiscussion = interview;
interview = function(scope) {
  captureConversationDraft();
  if(IV.board===state.name&&IV.job&&scope&&scope!==IV.job)saveConversationLocal('basis',conversationBasis(state.board,IV.job));
  interviewBeforeDiscussion(scope);
  IV.returnBasis=readConversationLocal('basis');
  restoreConversationDraft();
  try{localStorage.setItem('staves:conversation-scope:'+IV.board,IV.job);}catch{}
  const composer=$('#iv .ask');if(composer)$('#iv').append(composer);
  conversationScope=IV.job;conversationOpen=true;if(typeof stavesTab!=='undefined')stavesTab='discuss';if($('#iv').parentElement!==conversationPanel){const iv=$('#iv');conversationPanel.replaceChildren();conversationPanel.append(iv);}conversationPanel.classList.add('open');if(typeof stavesNavigation==='function')stavesNavigation();
  discussionActions();
  if(typeof paintFocusedInterview==='function')paintFocusedInterview();
  requestAnimationFrame(()=>scrollInterviewLatest());
  queueMicrotask(()=>startDesignConversation());
};
// Review inferred roles and context just like other proposed changes.
const cardsBeforeDiscussion = cardsHtml;
cardsHtml = function() {
  return cardsBeforeDiscussion().replace(/context · applied/g, 'context').replace(/who · added/g, 'role');
};

// Implementation requests belong to the selected conversation, with explicit delivery state.
function requestImplementationInput() {
  const scope=IV.job,boardId=IV.board;
  const latest=[...IV.lines].reverse().find(line=>line.who==='interviewer');
  const clients=(state.presence||[]).filter(p=>!p.sampling&&!/companion/i.test(p.name)).map(p=>p.name);
  sheet('Request implementation input',[
    ['question','What should be checked in the implementation?',clients.length?'MCP clients present: '+clients.join(', ')+'. Repository access is not verified. This saves a request for them to collect.':'No project assistant is verified. Save this request, then open it from your coding environment through MCP.',latest?.text||'','area']
  ],async values=>{
    if(state.name!==boardId)throw new Error('The board changed. Reopen this request on the original board.');
    const text=values.question.trim();if(!text)throw new Error('Describe what you want checked.');
    await checkedOp([{t:'ask',question:{id:'implementation-'+crypto.randomUUID(),about:scope,askedBy:'human',text,status:'raised',at:new Date().toISOString()}}]);
    renderImplementationRequests();toast('Request saved · waiting for a project assistant to collect it');
  },'ph-code');
  const submit=$('#veil .sf .acc');if(submit)submit.textContent='Save implementation request';
}
function renderImplementationRequests() {
  renderConversationWork();
  if(!$('#ivlines')||IV.board!==state.name)return;
  const requests=(state.board.questions||[]).filter(q=>(q.about||'board')===IV.job&&q.status!=='dismissed');
  let section=$('#iv-implementation-requests');
  if(!requests.length){section?.remove();return;}
  if(!section){section=document.createElement('details');section.id='iv-implementation-requests';$('#ivlines').after(section);}
  const signature=JSON.stringify(requests);if(section.dataset.signature===signature)return;section.dataset.signature=signature;
  section.innerHTML='<summary>Implementation requests · '+requests.filter(q=>!q.answer&&q.status!=='done').length+' waiting</summary>'+requests.map(q=>'<article><small>'+esc(q.answer?'Reply from '+(q.answeredBy||'project assistant'):q.status==='working'?'Being reviewed by project assistant':q.status==='done'?'Resolved':'Saved · awaiting project assistant')+'</small><p>'+esc(q.text)+'</p>'+(q.answer?'<blockquote>'+esc(q.answer)+'</blockquote>':'')+'</article>').join('');
}

function suspendConversationVoice(){IV.talk=false;IV.speak=false;stopDictation();stopSpeaking();}
function renderConversationWork(){
 const form=$('#iv .form');if(!form||IV.board!==state.name)return;
 const heading=[...form.querySelectorAll('h5')].find(h=>h.textContent==='On the board');if(!heading)return;
 let container=$('#iv-board-work');
 if(!container){while(heading.nextSibling)heading.nextSibling.remove();container=document.createElement('div');container.id='iv-board-work';heading.after(container);}
 const work=IV.job==='board'?topJobs():kids(IV.job),signature=JSON.stringify(work.map(j=>[j.id,j.name]));if(container.dataset.signature===signature)return;container.dataset.signature=signature;container.replaceChildren();
 if(!work.length){container.textContent=IV.job==='board'?'No jobs added yet.':'No tasks added yet.';return;}
 for(const item of work){const button=eb(item.name,'rectangle',()=>{suspendConversationVoice();conversationOpen=false;conversationPanel.classList.remove('open');$('#iv').classList.remove('show');if(item.parent)enterFocus(item.parent);select(item.id,item.parent?'task':'job');});button.title='Show '+item.name+' on the canvas';container.append(button);}
}
