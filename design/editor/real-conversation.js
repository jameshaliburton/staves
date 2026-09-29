/* Production conversation surface. Uses the existing interview session and operation store. */
function sizeConversationInput(input) {
  input.style.height = 'auto';
  input.style.height = Math.min(160, Math.max(24, input.scrollHeight)) + 'px';
  input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
}
/* Filing a pasted transcript keyed off the canvas selection, not the conversation. So pasting while a
   job happened to be selected filed the turns under that job and then rebuilt the live conversation
   around it — the transcript landed somewhere the person was not, and moved them there. The
   conversation's own scope is the only right answer while the conversation is open. */
const importTranscriptBeforeConversation = typeof importTranscript === 'function' ? importTranscript : null;
if (importTranscriptBeforeConversation) importTranscript = function(){
  const open = typeof conversationOpen !== 'undefined' && conversationOpen && IV && IV.board === state.name;
  if (!open) return importTranscriptBeforeConversation();
  const key = IV.job || 'board';
  sheet('Paste a transcript', [['tx','One line per turn. "Name: what they said". Lines without a name are theirs.',null,'','area']], async v => {
    const ops = v.tx.split('\n').map(l=>l.trim()).filter(Boolean).map((l,i)=>{
      const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
      const who = m ? m[1].trim() : '';
      const text = m ? m[2] : l;
      const isQ = /^(staves|interviewer|you|me|q)$/i.test(who);
      return {t:'comment',comment:{id:'c-'+Date.now()+'-'+i,about:key,by:isQ?'interviewer':'human',text:(isQ?'':'[interview] ')+text,at:new Date().toISOString()}};
    });
    if (ops.length) await op(ops);
    interview(key === 'board' ? undefined : key);
  }, 'ph-tray-arrow-down');
  const area = $('.sheet textarea'); if (area) area.style.minHeight = '220px';
};

/* localStorage throws outright in a hardened or private-mode browser, and these reads sit on the path
   that sends a message. One guarded helper, used everywhere, rather than eight bare reads. */
function readSetting(key){ try { return localStorage.getItem(key); } catch { return null; } }
function writeSetting(key, value){ try { localStorage.setItem(key, value); } catch {} }
function modelAvailable(){ return !!readSetting('staves:key') || (state.presence||[]).some(p=>p.sampling); }

/* Selecting work on the canvas re-points the conversation and the agenda at it. Opening a conversation
   pinned conversationScope to whatever was selected at the time, so every later click on a job changed
   the canvas and left the chat talking about something else. */
function rescopeConversation(target){
  if (!target || (IV && IV.job === target)) return;
  const card = $('#conversation-panel');
  card?.classList.add('scope-changing');
  conversationScope = target === 'board' ? null : target;
  interview(target === 'board' ? undefined : target);
  if (typeof stavesNavigation === 'function') stavesNavigation();
  if (typeof stavesFab === 'function') stavesFab();
  requestAnimationFrame(() => requestAnimationFrame(() => card?.classList.remove('scope-changing')));
}
if (typeof select === 'function') {
  const selectBeforeConversationScope = select;
  select = function(id, kind){
    const out = selectBeforeConversationScope.apply(this, arguments);
    // only a real selection re-points it; clicking empty canvas deselects without dragging the
    // conversation back to the whole workflow underneath the person
    if (conversationOpen && id && !(IV && IV.busy)) {
      const picked = job(id);
      const target = picked ? (picked.parent || picked.id) : null;
      if (target) rescopeConversation(target);
    }
    return out;
  };
}

/* Reading size is a preference about this person's eyes, not about the workflow, so it is remembered
   for them and lives in the menu rather than taking a permanent slot in a 42px header. */
const CHAT_SCALES = [0.9, 1, 1.15, 1.3, 1.5];
function chatScale(){ const v = parseFloat(readSetting('staves:chat-scale') ?? '1'); return CHAT_SCALES.includes(v) ? v : 1; }
function stepChatScale(direction){
  const now = chatScale();
  const next = CHAT_SCALES[Math.max(0, Math.min(CHAT_SCALES.length - 1, CHAT_SCALES.indexOf(now) + direction))];
  writeSetting('staves:chat-scale', String(next));
  $('#conversation-panel')?.style.setProperty('--staves-chat-scale', String(next));
  if (next === now) toast(direction > 0 ? 'That is the largest text' : 'That is the smallest text');
  else toast('Text at ' + Math.round(next * 100) + '%');
}

function conversationCommand(label, icon, action, hint) {
  const button = eb(label, icon, () => {
    const menu = $('#staves-compose-menu');
    // move focus back to the summary before the menu closes, or it lands on <body> and the keyboard
    // user loses their place entirely
    if (menu) { menu.querySelector('summary')?.focus(); menu.open = false; }
    action();
  });
  if (hint) button.title = hint;
  return button;
}
// Follows the cards on every interview paint, not only when the list opens: once nothing is left to add, it goes.
function paintAcceptRemaining() {
  const apply = $('#iv .form')?.querySelector('.conversation-accept-remaining');
  if (!apply) return;
  apply.hidden = !IV.cards.some(card => !card.gone && !card.accepted && card.ops.length);
  apply.disabled = IV.busy;
}
function showConversationSuggestions() {
  const form = $('#iv .form');
  if (!form) return;
  if(!form.querySelector('.conversation-accept-remaining')){const apply=conversationCommand('Add remaining suggestions and close','check',()=>stopAndSketch());apply.classList.add('conversation-accept-remaining');form.append(apply);}
  paintAcceptRemaining();
  form.classList.toggle('conversation-inspecting');
  form.hidden = !form.classList.contains('conversation-inspecting');
  if (!form.hidden) form.scrollIntoView({block:'nearest'});
}
function showConversationQuestions(includeResolved = false) {
  const requests = (state.board.questions || []).filter(q => includeResolved || !['done','dismissed'].includes(q.status));
  const body = document.createElement('div');
  body.className = 'staves-question-list';
  if (!requests.length) body.textContent = 'No open questions on this workflow.';
  for (const question of requests) {
    const button = conversationCommand(question.text, 'question', () => {
      closeSheet();
      const scope = question.about || 'board';
      openConversation(job(scope) ? scope : 'board');
      say('Let’s work through this saved question: ' + question.text);
    });
    const scope = document.createElement('small');
    scope.textContent = job(question.about)?.name || 'Whole workflow';
    button.append(scope);
    if(question.answer){const answer=document.createElement('small');answer.textContent='Reply: '+question.answer;button.append(answer);}
    body.append(button);
  }
  const veil = $('#veil');
  veil.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="staves-questions-title"><div class="sh" id="staves-questions-title">Open questions</div><div class="sb"></div><div class="sf"><button class="bt q" id="staves-questions-close">Close</button></div></div>';
  if(includeResolved)$('#staves-questions-title').textContent='Questions and agent replies';
  $('#veil .sb').append(body);
  $('#staves-questions-close').onclick = closeSheet;
  veil.classList.add('show');
  $('#staves-questions-close').focus();
}
function editConversationIntention() {
  const session = IV;
  sheet('Conversation focus', [['intention','What are we working toward?','Optional. This stays with the conversation.',conversationIntention(state.board, session.job),'area']], async values => {
    await saveWorkingIntention(session, values.intention);
    paintFocusedInterview();
  }, 'ph-target');
}
function buildComposerMenu(box) {
  const menu = document.createElement('details');
  menu.id = 'staves-compose-menu';
  menu.innerHTML = '<summary aria-label="Add context or choose an action" title="Add context or choose an action">'+ei('plus')+'</summary><div class="staves-compose-actions"></div>';
  const actions = menu.querySelector('.staves-compose-actions');
  const group = (name, commands) => {
    const section = document.createElement('section');
    const heading = document.createElement('small');heading.textContent = name;section.append(heading);
    for (const command of commands) section.append(conversationCommand(...command));
    actions.append(section);
  };
  group('Bring into the conversation', [
    ['Paste a transcript','tray-arrow-down',()=>importTranscript()],
    ['Open questions','question',showConversationQuestions],
    ['Inspect workflow context','rectangle',()=>{if(!IV.busy&&!IV.paused)say('Show me what you have so far as a coherent workflow update. Use our earlier answers and leave unsupported parts unknown.');}],
    ['Set conversation focus','target',editConversationIntention],
    ['Start voice conversation','microphone',()=>toggleTalk(),'Speak and listen using this conversation']
  ]);
  group('Work on this design', [
    ['Check a scenario','play',()=>openCaseCheck(),'Set starting facts and preview the modeled path'],
    ['Reflect on the workflow','magnifying-glass',()=>say('Reflect on this workflow against its goal. Identify consequential gaps or assumptions with their evidence, and ask me one useful question.')],
    ['Explore automation','lightning',()=>{if(IV.busy)return;setInterviewActivity('opportunities');IV.paused=false;paintInterviewState();say('Assess automation opportunities in the current workflow using our conversation. Compare human work, deterministic software, agent assistance and bounded agent execution. Name the existing jobs or tasks, evidence for value, required human judgment and checks, and unknowns. Separate waiting from active effort; consider frequency, volume, variability, expertise, data access, resource constraints and failure cost. Give a concise provisional recommendation and ask the single missing question most likely to change it. Do not invent savings or apply implementation decisions automatically.');}],
    ['Review proposed changes','list-checks',showConversationSuggestions],
    ['Continue with coding agent','code',()=>openConversationHandoff(),'Queue this conversation and its context for your coding agent'],
    ['Read agent replies','chat-circle',()=>showConversationQuestions(true)]
  ]);
  group('This conversation', [
    ['Smaller text','minus',()=>stepChatScale(-1)],
    ['Larger text','plus',()=>stepChatScale(1)],
  ]);
  group('Guide the next reply', Object.entries(INTERVIEW_ACTIVITIES).map(([id,item]) => [item.label,'chat-circle',()=>{setInterviewActivity(id);paintComposeMenuModes();},item.description]));
  menu.addEventListener('keydown', event => { if(event.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();event.stopPropagation();} });
  menu.addEventListener('toggle',()=>menu.querySelector('summary').setAttribute('aria-expanded',String(menu.open)));
  box.prepend(menu);
  paintComposeMenuModes();
}
/* Which way the next reply is guided is a choice the person makes; it has to look chosen. */
function paintComposeMenuModes(){
  const menu=$('#staves-compose-menu');if(!menu)return;
  const ids=Object.keys(INTERVIEW_ACTIVITIES);
  const labels=Object.fromEntries(Object.entries(INTERVIEW_ACTIVITIES).map(([id,item])=>[item.label,id]));
  const selected=interviewActivity();
  for(const button of menu.querySelectorAll('button')){
    const id=labels[(button.textContent||'').trim()];
    if(!id||!ids.includes(id))continue;
    button.setAttribute('aria-pressed',String(id===selected));
  }
}
function placeConversationScope(header, scope) {
  // It used to be tucked inside .conversation-heading. That heading is empty now that Stop and Close
  // are built in the app header, and the rule that hides an empty heading was hiding the only way back
  // out of a focused job along with it. It stays a direct child of the header.
  if (!header || !scope || scope.parentElement === header) return;
  header.append(scope);
}
// What an exchange was about, in one quiet line under it. An answer usually feeds more than one class —
// the craft says so — so the footnote names each, and the strip rings the same ones.
function paintTopicFootnotes(){
 const lines=$('#ivlines');if(!lines||!state.board)return;
 const settled=Object.fromEntries((state.board.ledger||[]).map(item=>[item.class,item]));
 const replies=(IV.lines||[]).filter(l=>l.who==='interviewer');
 [...lines.querySelectorAll('.line.q')].forEach((line,index)=>{
  const topics=(replies[index]?.topics||[]).filter(t=>SETTLED_LABEL[t]);
  let foot=line.querySelector('.line-topics');
  if(!topics.length){foot?.remove();return;}
  if(!foot){foot=document.createElement('p');foot.className='line-topics';line.append(foot);}
  const signature=topics.join(',');
  if(foot.dataset.signature===signature)return;
  foot.dataset.signature=signature;
  foot.innerHTML=topics.map(t=>'<span class="line-tag'+(settled[t]?.state==='closed'?' settled':'')+'">'+esc(SETTLED_LABEL[t].toLowerCase())+'</span>').join('');
 });
}

// What the conversation has settled, in one row. A tick Staves gave says so; one click reopens.
const SETTLED_LABEL={brief:'Brief',roles:'Roles',jobs:'Jobs',handoffs:'Handoffs',exceptions:'Exceptions'};
function settledMark(item){return item.state==='closed'?(item.by==='staves'?'◐':'✓'):item.state==='open'?'◌':'·';}
function settledTitle(item){
 const gap=item.gap?' · '+item.gap:'';
 if(item.state!=='closed')return SETTLED_LABEL[item.class]+': '+(item.state==='open'?'named, not confirmed complete':'not discussed')+gap+(item.lapsed?' — settled before, then the work moved':'');
 return SETTLED_LABEL[item.class]+': settled by '+(item.by==='staves'?'Staves':'you')+(item.quote?' — “'+item.quote+'”':'')+gap+'. Click to reopen.';
}
async function reopenSettled(cls){
 try{await checkedOp([{t:'settle',class:cls,settled:false,by:'human'}]);}
 catch(error){toast(error.message||'Could not reopen that.');}
}
// Clicking a class says where to go next. Going back to one you settled reopens it — you are the one
// asking again — and the question itself is asked in the conversation, not by the strip.
// Clicking a class asks to go there. It does not change the board: a status line you cannot hover
// without risking a change is a trap, and reopening a settled class is a judgment for the conversation.
function steerTo(cls){
 if(typeof askAsStaves==='function')askAsStaves('Let us look at '+SETTLED_LABEL[cls].toLowerCase()+'. What should I know?');
}
function paintSettledRow(){
 const header=$('#focused-interview-header');if(!header||!state.board)return;
 const items=(state.board.ledger||[]).filter(item=>SETTLED_LABEL[item.class]);
 let row=$('#settled-row');
 if(!items.length){row?.remove();return;}
 if(!row){row=document.createElement('div');row.id='settled-row';header.append(row);}
 // the classes the last exchange was about: ringed, not re-ordered
 const live=(IV.topics||[]).filter(t=>SETTLED_LABEL[t]);
 const signature=JSON.stringify([items,live]);
 if(row.dataset.signature===signature)return;
 row.dataset.signature=signature;
 // The detail is content, not a label, so it does not live in a tooltip a keyboard cannot reach.
 row.innerHTML=items.map(item=>'<button class="settled-item'+(item.state==='closed'?' closed':'')+(item.by==='staves'?' by-staves':'')+'" data-class="'+item.class+'"'
  +(live.includes(item.class)?' data-live="true" aria-current="true"':'')+' aria-describedby="settled-tip"><span aria-hidden="true">'+settledMark(item)+'</span>'+esc(SETTLED_LABEL[item.class])+'</button>').join('')
  +'<span id="settled-tip" role="status"></span>';
 // The detail floats over the conversation. It must never take a row of its own: the strip is a status
 // line, and a status line that grows when you look at it moves the thing you were reading.
 const detail=row.querySelector('#settled-tip');
 const say=item=>{detail.textContent=item?settledTitle(item):'';detail.toggleAttribute('data-show',!!item);};
 row.querySelectorAll('.settled-item').forEach(button=>{
  const item=items.find(i=>i.class===button.dataset.class);
  button.onmouseenter=()=>say(item);button.onfocus=()=>say(item);
  button.onmouseleave=()=>say(null);button.onblur=()=>say(null);
  button.onclick=()=>steerTo(button.dataset.class);
 });
}

function paintRealConversation() {
  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches) return;
  const panel=$('#conversation-panel'),iv=$('#iv'),ask=$('#iv>.ask');
  if(!panel || !iv || !ask || !conversationOpen)return;
  panel.classList.add('real-conversation');
  const header=$('#focused-interview-header');
  if(header){
    const scope=$('#conversation-scope');
    placeConversationScope(header, scope);
  }
  const input=$('#ivin'),box=ask.querySelector('.box');
  if(!input || !box)return;
  if(!$('#staves-compose-menu'))buildComposerMenu(box);
  if(!input.dataset.compactInput){
    input.dataset.compactInput='true';input.rows=1;
    input.addEventListener('input',()=>sizeConversationInput(input));
  }
  input.placeholder='Talk to Staves…';
  sizeConversationInput(input);
  const send=$('#ivsend');
  if(send){send.innerHTML=IV.busy?ei('clock'):'<svg class="send-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';send.setAttribute('aria-label',IV.busy?'Preparing response':IV.listening?'Finish dictation and send':'Send message');send.title=send.getAttribute('aria-label');}
  const mic=$('#ivmic');if(mic){mic.innerHTML=ei(IV.listening?'stop':'microphone');mic.title=IV.listening?'Stop dictation':'Dictate message';mic.removeAttribute('data-tip');}
  let footer=$('#staves-compose-footer');
  if(!footer){
    footer=document.createElement('div');footer.id='staves-compose-footer';
    footer.innerHTML='<label title="Save agreed changes to the board as the conversation develops"><input type="checkbox" id="staves-auto-update">Auto-update</label><button type="button" id="staves-proposals"></button><button type="button" id="staves-model">Model</button>';
    ask.append(footer);
    $('#staves-auto-update').onchange=e=>{localStorage.setItem('staves:auto-build:'+IV.board,String(e.target.checked));paintBuildControls();};
    $('#staves-model').onclick=keySheet;
    $('#staves-proposals').onclick=showConversationSuggestions;
  }
  $('#staves-auto-update').checked=autoBuildEnabled(IV);
  const proposals=(IV.cards||[]).filter(card=>!card.gone&&!card.accepted&&card.ops?.length).length;
  $('#staves-proposals').textContent=proposals ? proposals+' proposed '+(proposals===1?'change':'changes') : '';
  $('#staves-proposals').hidden=!proposals;
  // A hosted model counts as connected. Asking only about the browser key made the footer say
  // "Connect model" while a model was, in fact, connected and answering.
  $('#staves-model').textContent=IV.engine || (modelAvailable()?'Model settings':'Connect model');
  const form=$('#iv .form');if(form)form.hidden=!form.classList.contains('conversation-inspecting');
  const stateLine=$('#ivstate');if(stateLine)stateLine.hidden=!IV.busy&&!IV.listening&&!IV.speaking&&!IV.error&&!IV.voiceError&&!IV.paused;
  const voice=[...($('#staves-compose-menu')?.querySelectorAll('button')||[])].find(button=>/voice conversation/.test(button.getAttribute('aria-label')||''));
  if(voice){const label=voice.querySelector('span');if(label)label.textContent=IV.talk?'Stop voice conversation':'Start voice conversation';voice.setAttribute('aria-pressed',String(!!IV.talk));}
}
const paintBeforeRealConversation=paintFocusedInterview;
paintFocusedInterview=function(){paintBeforeRealConversation();paintRealConversation();};
const controlsBeforeRealConversation=paintInterviewState;
paintInterviewState=function(){controlsBeforeRealConversation();paintRealConversation();paintAcceptRemaining();$('#settled-row')?.remove();paintTopicFootnotes();};
document.addEventListener('pointerdown',event=>{const menu=$('#staves-compose-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;});
paintRealConversation();
