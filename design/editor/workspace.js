/* Workspace IA: board resources, canvas tools, and one contextual Staves workspace. */
function openWorkspaceBrief(){
  if(typeof paintBoardBrief==='function')paintBoardBrief();
  const brief=$('#board-brief');
  if(!brief){wizard();return;}
  brief.open=!brief.open;
  if(brief.open)requestAnimationFrame(()=>brief.querySelector('textarea')?.focus());
}
function renameWorkspaceBoard(){
  sheet('Rename board',[['title','Board name',null,state.board.title||state.name]],async values=>{
    const title=values.title.trim();if(!title)throw new Error('Enter a board name.');
    await checkedOp([{t:'board',id:state.board.id,title,goal:state.board.goal}]);
  },'ph-pencil-simple');
}
function workspaceBoardMenu(event){
  const anchor=$('#bname').getBoundingClientRect();
  if(!Number.isFinite(event.clientX)||(!event.clientX&&!event.clientY))event={clientX:anchor.left,clientY:anchor.bottom+6,preventDefault:()=>{},stopPropagation:()=>{}};
  ctx(event,[
  ['Rename board','ph-pencil-simple',renameWorkspaceBoard],
  ['Edit board brief','ph-note-pencil',openWorkspaceBrief],
  ['Board setup','ph-sliders-horizontal',()=>wizard()],
  '—',
  ['Create an alternative','ph-git-branch',()=>branch()],
  ['Review questions and changes','ph-list-checks',()=>boardReview()],
  ['Walk through workflow','ph-play',()=>openRehearsal()],
  ['Test a scenario','ph-check-circle',()=>openCaseCheck()],
  ['As run — how it actually ran','ph-monitor',()=>openAsRun()],
  '—',
  ['Connect a coding agent','ph-plugs-connected',()=>window.stavesConnectCodingAgent?.()],
  ['Langfuse project','ph-chart-line',()=>chooseLangfuseProject()],
  ['Export…','ph-export',()=>openWorkflowExport()],
  ['Import design…','ph-tray-arrow-down',()=>importAny()],
  ['Keyboard shortcuts','ph-keyboard',()=>help()]
]);}
const boardMenu=eb('Board options','caret-down',workspaceBoardMenu);
boardMenu.id='board-menu';boardMenu.title='Rename, briefing and board settings';$('#bname').after(boardMenu);
const workspaceIdentity=document.createElement('span');workspaceIdentity.id='workspace-design-identity';boardMenu.after(workspaceIdentity);
// The original nodes remain available to native rendering, but the catch-all UI is retired.
$('#editor-tools').hidden=true;
[...$('#top').querySelectorAll(':scope > .editor-button')].forEach(button=>{
  if(button===boardMenu)return;
  if(button.getAttribute('aria-label')==='Add')$('#tl>.ph').insertBefore(button,$('#tl>.ph .grow'));
  else button.remove();
});



$('#bname').onclick=workspaceBoardMenu;$('#bname').setAttribute('role','button');$('#bname').tabIndex=0;$('#bname').setAttribute('aria-label','Board options');$('#bname').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();workspaceBoardMenu(event);}};
$('.editor-hint')?.remove();

// One mode selector, not separate destinations and a second row of controls.
const canvasMode=document.createElement('select');canvasMode.id='canvas-mode';canvasMode.setAttribute('aria-label','Canvas mode');
for(const [value,label] of [['design','Design'],['rehearse','Walk through'],['case','Test a scenario'],['runs','As run']]){const option=document.createElement('option');option.value=value;option.textContent=label;canvasMode.append(option);}
canvasMode.onchange=()=>{if(canvasMode.value!=='runs')closeAsRun();if(canvasMode.value==='case'){closeRehearsal();openCaseCheck();canvasMode.value='design';}else if(canvasMode.value==='rehearse')openRehearsal();else if(canvasMode.value==='runs'){closeRehearsal();openAsRun();}else closeRehearsal();};
canvasMode.hidden=true;$('#tl>.ph').prepend(canvasMode);
const viewSettings=eb('View','eye',event=>ctx(event,[
  ['Connections on focus'+(connectionVisibility==='focus'?' ✓':''),'ph-cursor',()=>setConnections('focus')],
  ['All connections'+(connectionVisibility==='all'?' ✓':''),'ph-arrows-left-right',()=>setConnections('all')],
  ['Hide connections'+(connectionVisibility==='none'?' ✓':''),'ph-eye-slash',()=>setConnections('none')],
  '—',
  ['Expand tasks in jobs'+(showCanvasTasks?' ✓':''),'ph-squares-four',()=>{showCanvasTasks=!showCanvasTasks;render();}],
  ['Outline','ph-list-dashes',()=>{document.body.classList.toggle('outline-open');render();}],
  ['3D overview','ph-cube',()=>openSpatialOverview()],
  ['Effort estimates','ph-chart-bar',e=>scorecard(e||event)]
]));
function setConnections(value){connectionVisibility=value;connectionControl.value=value;paintConnections();}
$('#tl>.ph').insertBefore(viewSettings,fullButton);
$('#tl>.ph').querySelector('[aria-label="Outline"]')?.remove();
// Strip the inherited static Workflow label; the board title already provides orientation.
for(const node of [...$('#tl>.ph').childNodes])if(node.nodeType===3)node.textContent='';
$('#tl>.ph > svg')?.remove();
viewbar.hidden=true;
editorAdd=event=>ctx(event,[
  ['Job','ph-rectangle',()=>chooseTrack()],
  ['Task in selected job','ph-squares-four',()=>{const j=job(state.sel);if(j)addTask(j.parent||j.id);else{const jobs=live().filter(x=>!x.parent);if(!jobs.length){chooseTrack();return;}sheet('Choose a job for this task',[['job','Job',null,jobs[0].id,null,jobs.map(x=>[x.id,'ph-rectangle',x.name])]],v=>addTask(v.job));}}],
  ['Epic / larger outcome','ph-stack',()=>editEpic()],
  '—',
  ['Human role','ph-user',()=>addTrack('person')],['Agent role','ph-robot',()=>addTrack('agent')],['System','ph-database',()=>addTrack('system')],['External participant','ph-globe-simple',()=>addTrack('outside')],
  '—',
  ['Start from a pattern','ph-puzzle-piece',()=>patterns()],['Describe work in text','ph-text-align-left',()=>sheetSketch()]
]);
// Undo belongs next to editing, with keyboard shortcuts still available everywhere.
const undoControl=eb('Undo','arrow-counter-clockwise',()=>undo());undoControl.classList.add('icon-control');undoControl.title='Undo · ⌘Z';
const redoControl=eb('Redo','arrow-right',()=>redo());redoControl.classList.add('icon-control');redoControl.title='Redo · ⇧⌘Z';
$('#tl>.ph').insertBefore(undoControl,$('#tl>.ph .grow'));$('#tl>.ph').insertBefore(redoControl,$('#tl>.ph .grow'));

// Floating editing and viewing controls keep the canvas visible beneath one app header.
const canvasEditTools=document.createElement('div');canvasEditTools.id='canvas-edit-tools';canvasEditTools.setAttribute('role','toolbar');canvasEditTools.setAttribute('aria-label','Edit workflow');
const canvasViewTools=document.createElement('div');canvasViewTools.id='canvas-view-tools';canvasViewTools.setAttribute('role','toolbar');canvasViewTools.setAttribute('aria-label','Canvas view');
const addControl=$('#tl>.ph > [aria-label="Add"]');
if(addControl)canvasEditTools.append(addControl);
canvasEditTools.append(undoControl,redoControl,eb('Brief','note-pencil',openWorkspaceBrief));
const zoomControls=fitButton.closest('.seg');
canvasViewTools.append(modes,viewSettings);
if(zoomControls)canvasViewTools.append(zoomControls);
canvasViewTools.append(fullButton);
fullButton.title='Toggle full screen · F';
$('#tl').append(canvasEditTools,canvasViewTools);
function paintWorkspaceIdentity(){
  if(!state.board)return;
  const alternative=Boolean(state.board.baseline||state.board.base);
  $('#bname').textContent=state.board.title||state.name;
  workspaceIdentity.textContent=(alternative?'Alternative':'Current design')+(state.board.revision!=null?' · r'+state.board.revision:'');
  workspaceIdentity.dataset.kind=alternative?'alternative':'current';
  workspaceIdentity.title=alternative?'An alternative design; changes stay separate from its source.':'The current workflow design. This does not imply deployed code.';
  const home=$('#shell-home');if(home){home.title='Back to boards';home.setAttribute('aria-label','Back to boards');}
}

let stavesTab='discuss';
/* What the interview still wants, for the scope the conversation is on. The board's own count when we
   are on the whole workflow; that job's four answers when we are inside one. */
const ASK_MEANS={outline:'what the work is and who does what',
  working:'enough to talk about it and find the gaps',
  build:'enough for someone to act on without asking you again'};
const ASK_LABEL={outline:'Outline',working:'Working description',build:'Build-ready'};
const ASK_PHRASE={outline:'an outline',working:'a working description',build:'something a builder can act on'};
function chosenAsk(){try{const v=localStorage.getItem('staves:ask:'+state.name);return ASK_LABEL[v]?v:'working';}catch{return 'working';}}
function chooseAsk(value){try{localStorage.setItem('staves:ask:'+state.name,value);}catch{}
  // repaint the header, but leave the sheet open: closing it meant nobody ever saw what changed
  stavesNavigation();stavesFab();}
function agendaFor(scope){
  const r=state.board?.readiness;if(!r)return null;
  const ask=chosenAsk();
  const j=job(scope);
  const wanted=(r.answers||[]).filter(a=>!a.asks||a.asks.includes(ask));
  const answers=j?wanted.filter(a=>a.id.startsWith(j.id+':')):wanted;
  if(!answers.length)return null;
  const have=answers.filter(a=>a.got).length;
  const au=state.board?.authorship;
  const authorship=j?(au?.jobs?.[j.id]??null):(au?{known:au.known,yours:au.yours,percent:au.percent}:null);
  return {of:j?j.name:'Whole workflow',answers,have,need:answers.length,percent:Math.round(have/answers.length*100),ask,counts:r.counts,authorship};
}
/* interview() resets stavesTab to 'discuss' as part of opening, so asking for Review before the panel
   exists lands you on Talk. Open first, then say where you meant to be. */
function openStavesAt(tab, scope){
  // The menu this was chosen from is drawn over #veil, and renderConversation's review branch bails
  // while the veil is showing -- so asking for Review from the menu quietly landed on Talk.
  // Hide the menu, never remove it: ctx() reuses one persistent .pop node and writes into it, so
  // deleting it breaks every context menu in the app for the rest of the session.
  $('.pop')?.classList.remove('show');
  $('#veil')?.classList.remove('show');
  if(typeof closeSheet==='function')closeSheet();
  openConversation(scope==='board'?undefined:scope);
  if(tab==='discuss')return;
  stavesTab=tab;
  setTimeout(()=>{stavesTab=tab;renderConversation();stavesNavigation();},60);
}
function modelAvailableForBar(){try{return !!localStorage.getItem('staves:key')||(state.presence||[]).some(p=>p.sampling);}catch{return (state.presence||[]).some(p=>p.sampling);}}
function agendaBand(percent){return percent<50?'lo':percent<85?'mid':'hi';}
function closeStavesAgenda(){$('#staves-agenda-sheet')?.remove();$('#staves-agenda')?.setAttribute('aria-expanded','false');}
/* Staves asks; the person answers. Putting the question in the person's own input box made them the
   asker — they would type staves' question and send it back to staves, which inverts the whole
   relationship the interview is built on. So the question arrives as a turn from staves, exactly as
   any other question does, and the cursor lands in the composer ready for the answer.
   The text is staves' own: readiness() derives it from the board, so nothing is being put in the
   model's mouth that the model did not ask. */
async function askAsStaves(question){
  const session=IV;
  if(!session||session.busy){toast&&toast('Staves is still replying. One question at a time.');return;}
  closeStavesAgenda();
  if(stavesTab!=='discuss'){stavesTab='discuss';renderConversation();paintFocusedInterview?.();}
  // It arrives the way every other question from staves arrives — through the same #iv-streaming row a
  // model reply streams into. A question that simply appears reads as a UI event; one that types itself
  // reads as someone asking, and it pulls the scroll and the eye to the end of the conversation where
  // the answer goes.
  session.busy=true;session.responsePreview='';
  globalThis.stavesGenerating?.thinking(true);
  paintInterviewState();
  const still=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const words=question.split(/(\s+)/);
  const step=Math.max(16,Math.min(52,900/Math.max(words.length,1)));
  for(let i=0;i<words.length&&!still;i++){
    if(IV!==session||!session.busy)break;
    session.responsePreview+=words[i];
    paintStreamingReply();
    if(typeof scrollInterviewLatest==='function')scrollInterviewLatest();
    if(words[i].trim())await new Promise(done=>setTimeout(done,step));
  }
  session.busy=false;session.responsePreview='';
  globalThis.stavesGenerating?.thinking(false);
  $('#iv-streaming')?.remove();
  if(IV!==session)return;
  session.lines.push({who:'interviewer',text:question});
  // recorded like any other interviewer turn, so reopening the board does not lose the question
  try{await sessionOp(session,[{t:'comment',comment:{id:'c-ask-'+Date.now(),about:session.job,by:'interviewer',text:question,at:new Date().toISOString()}}]);}
  catch(error){console.warn('[staves] could not record the question',error);}
  if(IV!==session)return;
  renderLines();paintInterviewState();
  if(typeof scrollInterviewLatest==='function')scrollInterviewLatest();
  $('#ivin')?.focus();
}
/* What staves still wants to know, and what happens if you ignore it. That is the whole job of this
   sheet. It had grown a headline count, three tiles of jargon whose figures contradicted the headline,
   a second control about drafting, and a badge on every row saying the same thing — none of which is a
   question. The questions are the content; everything else is one quiet line. */
const DEPTHS=[
  {key:'outline', label:'the shape of it',        means:'what the work is and who does what'},
  {key:'working', label:'enough to talk it through', means:'and where the gaps are'},
  {key:'build',   label:'enough to hand over',    means:'so someone can act on it without asking you'},
];
function openStavesAgenda(handle,agenda){
  const sheet=document.createElement('div');sheet.id='staves-agenda-sheet';sheet.setAttribute('role','dialog');
  sheet.setAttribute('aria-label','What Staves still needs');
  const scoped=!!job(conversationContext());

  /* The agenda is the five classes, and what a person wants from it is where they stand — not a
     queue of questions, which is a work list wearing the mental model's clothes. Each row says how
     much of that part of the workflow came from them and how much staves filled in, in the same two
     materials the board itself is drawn in. */
  const classes=state.board?.authorship?.classes;
  const CLASS_LABEL={brief:'Brief',roles:'Roles',jobs:'Jobs',handoffs:'Handoffs',exceptions:'Exceptions'};

  const head=document.createElement('p');head.className='agenda-count';
  head.innerHTML='<b></b><span></span>';
  const mine=agenda.authorship?agenda.authorship.known-agenda.authorship.yours:0;
  head.querySelector('b').textContent=agenda.authorship&&agenda.authorship.known?agenda.authorship.percent+'%':'—';
  head.querySelector('span').textContent=!agenda.authorship||!agenda.authorship.known
    ?'Nothing written down yet'
    :'of what is written down'+(scoped?' about this job':'')+' came from you'+(mine?' · I made up the other '+mine:'');
  sheet.append(head);

  if(classes&&!scoped){
    const list=document.createElement('div');list.className='agenda-classes';
    for(const key of ['brief','roles','jobs','handoffs','exceptions']){
      const c=classes[key];if(!c)continue;
      const row=document.createElement('div');row.className='agenda-class';
      row.dataset.state=!c.known?'blank':c.percent>=67?'yours':c.percent>0?'mixed':'mine';
      const name=document.createElement('b');name.textContent=CLASS_LABEL[key];
      const bar=document.createElement('span');bar.className='agenda-bar';
      const you=document.createElement('i');you.className='agenda-you';you.style.width=(c.known?c.percent:0)+'%';
      const guess=document.createElement('i');guess.className='agenda-mine';guess.style.width=(c.known?100-c.percent:0)+'%';
      bar.append(you,guess);
      const said=document.createElement('small');
      said.textContent=!c.known?'nothing yet':c.yours===c.known?'all yours':c.yours?c.yours+' of '+c.known+' yours':'all mine';
      row.title=!c.known?'Nothing is written down about this yet'
        :c.yours+' of the '+c.known+' things written down here came from you';
      row.append(name,bar,said);
      list.append(row);
    }
    sheet.append(list);
  }

  const note=document.createElement('p');note.className='agenda-note';
  const needed=agenda.answers.filter(a=>!a.got&&a.weight!=='curious').length;
  note.textContent=!agenda.authorship||!agenda.authorship.known
    ?'Tell me about the work, or ask me to draft it and correct what I get wrong.'
    :mine?'Hatched on the board is mine. Click a card’s marker to settle it.'
    :needed?'All of it came from you. '+needed+' thing'+(needed===1?'':'s')+' I still have not asked about.'
    :'All of it came from you, and I have nothing left to ask.';
  sheet.append(note);

  /* The one control that changes how staves behaves rather than what you are looking at: how much it
     is allowed to make up. It was written, wired through every turn, and then left with nothing to set
     it — setDraftStance existed and nobody called it, so staves has never drafted for anyone. It lives
     at the foot of the agenda because the agenda is what it changes. */
  const STANCES=[
    ['ask','Ask me everything','Nothing goes on the board unless you said it. Slower, and all of it yours.'],
    ['draft','Draft it, and I will mark my guesses','I put up a map of work I recognise. Everything I invent is hatched until you settle it.'],
  ];
  const stance=(typeof draftStance==='function'?draftStance(IV):'ask');
  const here=STANCES.find(x=>x[0]===stance)||STANCES[0];
  const foot=document.createElement('p');foot.className='agenda-depth';
  foot.innerHTML='<span></span> ';
  foot.querySelector('span').textContent=here[1]+' — '+here[2];
  const change=document.createElement('button');change.type='button';change.className='agenda-change';
  change.textContent='Change how much I make up';
  change.onclick=()=>{
    foot.replaceChildren();
    for(const [key,label,means] of STANCES){
      const pick=document.createElement('button');pick.type='button';pick.className='agenda-depth-option';
      pick.setAttribute('aria-pressed',String(key===stance));
      pick.innerHTML='<b></b><small></small>';
      pick.querySelector('b').textContent=label;
      pick.querySelector('small').textContent=means;
      pick.onclick=()=>{
        if(typeof setDraftStance==='function')setDraftStance(key);
        const h=$('#staves-agenda');if(h)openStavesAgenda(h,agendaFor(conversationContext()));
        toast(key==='draft'?'I will draft from here, and mark everything I invent':'I will only write down what you tell me');
      };
      foot.append(pick);
    }
  };
  foot.append(change);
  sheet.append(foot);

  document.body.append(sheet);
  const box=handle.getBoundingClientRect();
  sheet.style.top=(box.bottom+6)+'px';
  sheet.style.right=Math.max(8,window.innerWidth-box.right)+'px';
  handle.setAttribute('aria-expanded','true');
}

/* The way into Staves is a fixed object in the bottom-left corner. It never goes away, so the actions
   behind its caret stay reachable whether the conversation is open or shut -- which is exactly what
   was lost when the panel replaced the button that held them. */
function stavesFab(){
  if(!state.board){$('#staves-fab')?.remove();return;}
  const scope=conversationContext();
  const agenda=agendaFor(scope)||{of:job(scope)?.name||'Whole workflow',answers:[],have:0,need:0,percent:null};
  const waiting=(state.board.proposalsList||[]).length
    +((state.board.questions||[]).filter(q=>typeof isOpenQuestion==='function'?isOpenQuestion(q):!q.answer).length);
  const label=conversationOpen?(job(scope)?'Back to the conversation':'Back to the conversation')
    :(job(scope)?'Talk about this job':'Talk to Staves');
  const signature=JSON.stringify([label,waiting,agenda.percent,agenda.of,conversationOpen]);
  let fab=$('#staves-fab');
  if(fab&&fab.dataset.signature===signature)return;
  fab?.remove();
  fab=document.createElement('div');fab.id='staves-fab';fab.dataset.signature=signature;

  const main=document.createElement('button');main.type='button';main.className='staves-fab-main';
  // The mark is cloned from the logo in the header, not redrawn. Retyping the path is how it ended up
  // with round stroke caps the real mark does not have.
  const source=$('#top svg');
  if(source){const mark=source.cloneNode(true);mark.removeAttribute('width');mark.removeAttribute('height');
    mark.setAttribute('class','staves-fab-mark');main.append(mark);}
  else main.innerHTML='<svg viewBox="0 0 26 30" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true" class="staves-fab-mark"><path d="M3 10v17M11 4v20M19 1v17"/></svg>';
  const text=document.createElement('span');text.className='staves-fab-label';text.textContent=label;main.append(text);
  main.setAttribute('aria-label',label);
  main.title=agenda.need?label+' \u00b7 Staves has '+agenda.have+' of the '+agenda.need+' answers it needs about '+agenda.of:label;
  // like the split control: this press talks, the caret beside it holds everything else
  main.onclick=()=>{
    if(conversationOpen&&stavesTab==='discuss'){$('#ivin')?.focus();return;}
    openStavesAt('discuss',scope);
  };

  const more=document.createElement('button');more.type='button';more.className='staves-fab-more';
  more.setAttribute('aria-haspopup','menu');
  more.setAttribute('aria-label',waiting?'More from Staves \u2014 '+waiting+' waiting':'More from Staves');
  more.title=waiting?waiting+(waiting===1?' thing is waiting on you':' things are waiting on you'):'More from Staves';
  if(waiting){const n=document.createElement('span');n.className='staves-bar-count';n.textContent=String(waiting);more.append(n);}
  // a text triangle renders as a speck at this size; this is a drawn chevron with real stroke weight
  const caret=document.createElement('span');caret.className='staves-fab-caret';
  caret.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  more.append(caret);
  more.onclick=event=>{
    const box=fab.getBoundingClientRect();
    ctx({clientX:box.right,clientY:box.top-6,preventDefault(){},stopPropagation(){}},[
      [conversationOpen&&stavesTab==='discuss'?'Back to the conversation':(job(scope)?'Talk about this job':'Talk about the whole workflow'),'ph-chat-circle',
        ()=>{if(conversationOpen&&stavesTab==='discuss'){$('#ivin')?.focus();return;}openStavesAt('discuss',scope);}],
      // focused on a job, this is the only way back out to the board -- the panel's own scope line used
      // to carry it, and that line went when the agenda started naming the scope
      ...(job(scope)?[['Talk about the whole workflow','ph-arrow-left',()=>{
        if(typeof rescopeConversation==='function'&&conversationOpen){state.sel=null;rescopeConversation('board');}
        else openStavesAt('discuss','board');}]]:[]),
      ['Review changes'+(waiting?' \u00b7 '+waiting:''),'ph-list-checks',()=>openStavesAt('review',scope)],
      [(state.board?.walk?.hops||[]).length?'Walk the flow with me \u00b7 '+state.board.walk.hops.length+' hops':'Walk the flow with me','ph-arrow-right',()=>startWalk()],
      [agenda.need?'What Staves still needs \u00b7 '+agenda.percent+'%':'What Staves still needs','ph-target',
        ()=>{openStavesAt('discuss',scope);setTimeout(()=>$('#staves-agenda')?.click(),400);}],
      '\u2014',
      [modelAvailableForBar()?'Model settings':'Connect a model','ph-key',()=>keySheet()],
    ]);
    event.stopPropagation();
  };
  fab.append(main,more);
  document.body.append(fab);
}

/* Openings: where this work could be done differently, read off the board rather than asked of a
   model. Putting one on the board is a change to the map — the job moves to whoever would hold it and
   the check is written down beside it — not a handoff to anybody's code. The board goes to a coding
   agent once, as a whole, when enough of it is theirs. */
const OPENING_WORD={agent:'An agent, with a check',mechanical:'No model needed',waiting:'Nobody is working'};
function openingsPanel(){
  const host=document.createElement('section');host.id='staves-openings';
  const list=(state.board?.openings||[]);
  const head=document.createElement('p');head.className='openings-head';
  const au=state.board?.authorship;
  head.textContent=!list.length
    ?(au&&au.known&&au.percent<50?'Nothing worth saying yet \u2014 most of this board is still my guess. Correct it and these fill in.'
      :'Nothing stands out yet. Describe how a job is actually done, step by step, and openings appear.')
    :list.length+(list.length===1?' thing':' things')+' worth saying out loud about this workflow.';
  host.append(head);

  for(const o of list){
    const row=document.createElement('article');row.className='opening';row.dataset.kind=o.kind;
    const kind=document.createElement('span');kind.className='opening-kind';kind.textContent=OPENING_WORD[o.kind]||o.kind;
    const title=document.createElement('h4');title.textContent=o.about;
    const says=document.createElement('p');says.className='opening-says';says.textContent=o.says;
    row.append(kind,title,says);
    if(o.needs?.length||o.keeps){
      const facts=document.createElement('div');facts.className='opening-facts';
      if(o.needs?.length){const d=document.createElement('div');d.innerHTML='<small>WHAT IT NEEDS</small><span></span>';d.querySelector('span').textContent=o.needs.join(', ');facts.append(d);}
      if(o.keeps){const d=document.createElement('div');d.innerHTML='<small>WHAT THE PERSON KEEPS</small><span></span>';d.querySelector('span').textContent=o.keeps;facts.append(d);}
      row.append(facts);
    }
    if(o.evidence?.length){const e=document.createElement('p');e.className='opening-evidence';e.textContent=o.evidence.join(' \u00b7 ');row.append(e);}
    const actions=document.createElement('div');actions.className='opening-actions';
    if(o.kind!=='waiting') actions.append(eb('Put it on the board','check',()=>placeOpening(o)));
    actions.append(eb(o.kind==='waiting'?'Talk about it':'Not now','chat-circle',()=>{closeStavesAgenda();openStavesAt('discuss',o.job);setTimeout(()=>{const box=$('#ivin');if(box){box.value='About "'+o.about+'": ';box.focus();}},300);}));
    row.append(actions);
    host.append(row);
  }
  return host;
}
/* The job moves to whoever would hold it, and the rule that keeps a person in the loop is written
   down in the same change. An agent arriving without its check is the thing this whole product is
   supposed to prevent. */
async function placeOpening(o){
  const kind=o.kind==='agent'?'agent':'system';
  const existing=(state.board.tracks||[]).find(t=>!t.removed&&t.kind===kind);
  const trackId=existing?existing.id:kind+'-'+Date.now().toString(36);
  const ops=[];
  if(!existing) ops.push({t:'track',track:{id:trackId,name:kind==='agent'?'Agent':'System',kind,provenance:{source:'human'}}});
  const patch={track:trackId};
  const j=job(o.job);
  if(o.keeps&&!j?.gate) patch.gate={rule:o.keeps,accountable:j?.track};
  ops.push({t:'updateJob',id:o.job,patch});
  try{ await op(ops); toast('"'+o.about+'" is on the board as '+(kind==='agent'?'agent work, with its check':'something a system does')); }
  catch(e){ toast('That did not land: '+(e?.message||'unknown error')); }
}
/* ===== Walking the flow =====
   The questions, standing on the board, in the order the work happens. One hop is one job: the card is
   lit where it sits, everything else recedes, and the single most consequential thing staves does not
   know about it is asked underneath. Answering sends it through the interview exactly as speaking would
   and the board redraws behind the lozenge, so building and checking are the same motion.

   It takes the canvas rather than the panel on purpose. A walk whose subject is hidden behind the thing
   asking about it is a list again. */
let walkOn=false,walkAt=0;
function walkHops(){return (state.board?.walk?.hops)||[];}
function startWalk(){
  if(!walkHops().length){toast('Nothing left to ask about — every job has what it needs');return;}
  walkOn=true;walkAt=0;
  // the walk's subject is the board, so the panel gets out of the way of it
  if(conversationOpen){conversationOpen=false;conversationPanel.classList.remove('open');stavesNavigation();}
  document.body.classList.add('walking');
  // the interview has to exist for an answer to have somewhere to go, even with the panel shut
  if(typeof interview==='function'&&(!IV||IV.board!==state.name))interview('board');
  paintWalk();
}
function endWalk(){
  walkOn=false;document.body.classList.remove('walking');
  $('#staves-walk')?.remove();
  $$('#tracks .clip.walk-here').forEach(c=>c.classList.remove('walk-here'));
  stavesNavigation();
}
function walkStep(by){
  const hops=walkHops();
  const next=walkAt+by;
  if(next<0)return;
  if(next>=hops.length){endWalk();toast('That is the end of the flow — the board has what it needs for now');return;}
  walkAt=next;paintWalk();
}
function paintWalk(){
  if(!walkOn)return;
  const hops=walkHops();
  if(!hops.length){endWalk();toast('Nothing left to ask about');return;}
  if(walkAt>=hops.length)walkAt=hops.length-1;
  const hop=hops[walkAt];

  $$('#tracks .clip.walk-here').forEach(c=>c.classList.remove('walk-here'));
  const clip=document.querySelector('#tracks .clip[data-job="'+CSS.escape(hop.job)+'"]');
  if(clip){clip.classList.add('walk-here');clip.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});}

  let box=$('#staves-walk');
  if(!box){box=document.createElement('div');box.id='staves-walk';box.setAttribute('role','group');box.setAttribute('aria-label','Walking the flow');document.body.append(box);}
  const answered=hop.index-1;
  box.innerHTML='<div class="walk-rail"></div>'
    +'<div class="walk-body"><small></small><p class="walk-q"></p></div>'
    +'<textarea id="walk-answer" rows="1" placeholder="Answer in a line…" aria-label="Your answer"></textarea>'
    +'<div class="walk-actions"></div>';
  const rail=box.querySelector('.walk-rail');
  for(let i=0;i<hops.length;i++){const tick=document.createElement('i');if(i<walkAt)tick.className='done';if(i===walkAt)tick.className='now';rail.append(tick);}
  box.querySelector('small').textContent='Hop '+(walkAt+1)+' of '+hops.length+' · '+hop.name;
  box.querySelector('.walk-q').textContent=hop.question;
  const actions=box.querySelector('.walk-actions');
  const send=eb('Next','arrow-right',()=>submitWalk());
  send.classList.add('primary');
  actions.append(send,eb('Skip','caret-right',()=>walkStep(1)),eb('Stop walking','x',()=>endWalk()));
  const field=box.querySelector('#walk-answer');
  field.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitWalk();}if(e.key==='Escape')endWalk();};
  field.focus();
  void answered;
}
async function submitWalk(){
  const field=$('#walk-answer');const text=(field?.value||'').trim();
  const hop=walkHops()[walkAt];
  if(!text){walkStep(1);return;}
  /* The answer goes where every other answer goes. Walking is a way of asking, not a second way of
     writing to the board: the same turn, the same provenance, the same record in the transcript. */
  if(typeof rescopeConversation==='function'&&hop&&IV&&IV.job!==hop.job){try{rescopeConversation(hop.job);}catch{}}
  if(field)field.value='';
  toast('Noted — drawing it in');
  try{ if(typeof say==='function') await say(text); }catch(error){ toast('That did not send: '+(error?.message||'unknown')); }
  // the board has moved, so the remaining hops have too
  walkAt=0;paintWalk();
}
function stavesNavigation(){
  const bar=$('#staves-topbar');
  if(!state.board){bar?.remove();closeStavesAgenda();return;}
  if(!conversationOpen)closeStavesAgenda();
  const scope=conversationContext();
  const agenda=agendaFor(scope)||{of:job(scope)?.name||'Whole workflow',answers:[],have:0,need:0,percent:null};
  const waiting=(state.board.proposalsList||[]).length
    +((state.board.questions||[]).filter(q=>typeof isOpenQuestion==='function'?isOpenQuestion(q):!q.answer).length);
  const signature=JSON.stringify([conversationOpen,stavesTab,agenda.of,agenda.have,agenda.need,agenda.percent,waiting,(state.board?.openings||[]).length,!!IV?.busy,!!IV?.paused]);
  if(bar&&bar.dataset.signature===signature)return;
  closeStavesAgenda();bar?.remove();
  const group=document.createElement('div');group.id='staves-topbar';group.dataset.signature=signature;
  // open: a section of the bar over the panel, divided from the app. shut: just the way in.
  group.classList.toggle('is-open',!!conversationOpen);
  // the reading size the person chose, applied wherever the conversation is drawn
  try{const v=parseFloat(localStorage.getItem('staves:chat-scale'));
    conversationPanel.style.setProperty('--staves-chat-scale',String([0.9,1,1.15,1.3,1.5].includes(v)?v:1));}catch{}

  if(!conversationOpen){$('#top').append(group);}

  /* Open, the bar carries where you are, how far the description has got, and the two places to be.
     The number belongs here rather than on the door: you are inside the thing it describes. */
  const handle=document.createElement('button');handle.type='button';handle.id='staves-agenda';
  handle.setAttribute('aria-expanded','false');
  handle.innerHTML='<span class="agenda-word">Agenda</span><span class="agenda-of"></span><span class="agenda-pct"></span>';
  handle.querySelector('.agenda-of').textContent=agenda.of;
  const pct=handle.querySelector('.agenda-pct');
  /* Completeness is a number staves can drive to 100% on its own in two minutes by inventing the
     lot, which makes it a fact about how hard the model tried rather than about the work. The share
     that came from the person is the one thing here nobody but them can move, so it is the one that
     sits in the header; how much is left to ask lives inside the sheet, next to the class it is about. */
  const au=agenda.authorship;
  const known=!!au&&au.known>0;
  pct.textContent=known?au.percent+'% yours':'\u2014';
  if(known)pct.dataset.band=agendaBand(au.percent);else delete pct.dataset.band;
  handle.title=known?au.yours+' of the '+au.known+' things written down about '+agenda.of+' came from you'
    +(au.known-au.yours?'. I made up the other '+(au.known-au.yours)+'.':'.')
    :'Nothing is written down about '+agenda.of+' yet';
  handle.disabled=!agenda.answers.length;
  handle.onclick=()=>handle.getAttribute('aria-expanded')==='true'?closeStavesAgenda():openStavesAgenda(handle,agenda);
  group.append(handle);

  const nav=document.createElement('nav');nav.id='staves-tabs';nav.dataset.tab=stavesTab;nav.setAttribute('aria-label','Staves workspace');
  /* Where the work could be done differently is the reason for describing it, and it had been item
     eight of a menu. It sits beside Talk and Review, filling up as the board becomes theirs. */
  const open=(state.board?.openings||[]).length;
  for(const [key,label] of [['discuss','Talk'],['review','Review'],['openings','Openings']]){
    const button=eb(label,key==='discuss'?'chat-circle':key==='openings'?'lightning':'review',()=>{
      const draft=$('#conversation-question');if(draft&&renderedConversationScope)conversationDrafts.set(renderedConversationScope,draft.value);
      if(key!=='discuss')suspendConversationVoice();
      stavesTab=key;closeStavesAgenda();renderConversation();paintFocusedInterview?.();});
    button.setAttribute('aria-pressed',String(stavesTab===key));
    if(key==='review'&&waiting){const n=document.createElement('span');n.className='staves-bar-count';n.textContent=String(waiting);button.append(n);}
    if(key==='openings'&&open){const n=document.createElement('span');n.className='staves-bar-count is-openings';n.textContent=String(open);button.append(n);}
    nav.append(button);
  }
  group.append(nav);
  // Built here, not moved here: this group is rebuilt whenever its signature changes, and a moved node
  // is destroyed with it -- which left the conversation with no Stop and no Close.
  const stop=document.createElement('button');stop.type='button';stop.className='bt q';stop.id='interview-pause';
  stop.textContent=IV?.paused?'Resume':'Stop';stop.hidden=!(IV&&(IV.busy||IV.paused));
  stop.onclick=()=>{if(typeof toggleInterviewPause==='function')toggleInterviewPause();stavesNavigation();};
  const close=document.createElement('button');close.type='button';close.className='ib';close.id='focus-back';
  close.setAttribute('aria-label','Close conversation');close.title='Close conversation';
  close.innerHTML=typeof ei==='function'?ei('close'):'\u2715';
  // The observer on the panel's class usually catches this, but it is a microtask and the close path
  // is long; repaint here too so the header can never be left showing an open conversation.
  close.onclick=()=>{if(typeof closeDesignConversation==='function')closeDesignConversation();stavesNavigation();};
  group.append(stop,close);
  // The card's chrome belongs on the card. In the app bar -- which spans the whole window, above the
  // canvas as well -- Talk and Review read as tabs for the entire application.
  conversationPanel.prepend(group);
}

/* Nine paths close the conversation and none of them repaint. The panel's open class is the one fact
   every path already updates, so watch that rather than trusting nine call sites to remember. */
new MutationObserver(()=>{stavesNavigation();stavesFab();}).observe(conversationPanel,{attributes:true,attributeFilter:['class']});

/* A sheet that outlives its trigger is a trap: close it on an outside click or Escape. */
document.addEventListener('pointerdown',event=>{const sheet=$('#staves-agenda-sheet');
  if(sheet&&!sheet.contains(event.target)&&!$('#staves-agenda')?.contains(event.target))closeStavesAgenda();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#staves-agenda-sheet')){closeStavesAgenda();$('#staves-agenda')?.focus();}});

const discussionRender=renderConversation;
const boardReview=reviewTracks;
renderConversation=function(){
  if(stavesTab==='discuss'){
    conversationPanel.classList.toggle('open',conversationOpen);if(!conversationOpen)return;
    const scope=conversationContext();const iv=$('#iv');
    if(iv.parentElement!==conversationPanel||IV.job!==scope||IV.board!==state.name){conversationPanel.replaceChildren();conversationPanel.append(iv);interview(scope);}iv.classList.add('show');renderImplementationRequests();
  }else if(stavesTab==='openings'){
    /* Its own destination, mounted the way Review is: the interview moves out of the panel and this
       takes the whole surface. It is somewhere you go, not a strip beside the conversation. */
    conversationPanel.classList.toggle('open',conversationOpen);
    if(!conversationOpen||!state.board)return;
    if($('#iv').parentElement===conversationPanel)document.body.append($('#iv'));$('#iv').classList.remove('show');
    conversationPanel.replaceChildren();conversationPanel.append(openingsPanel());
  }else if(stavesTab==='queue'){
    if($('#iv').parentElement===conversationPanel)document.body.append($('#iv'));$('#iv').classList.remove('show');
    discussionRender();$('.conversation-start',conversationPanel)?.remove();$('.conversation-history',conversationPanel)?.remove();
  }else{
    conversationPanel.classList.toggle('open',conversationOpen);
    if(!conversationOpen||!state.board)return;
    if($('#veil').classList.contains('show'))return;
    if($('#iv').parentElement===conversationPanel)document.body.append($('#iv'));$('#iv').classList.remove('show');
    const signature=JSON.stringify([state.board.runs,state.board.questions,state.board.proposalsList]);if(conversationPanel.dataset.reviewSignature===signature&&$('.review-visual',conversationPanel))return;conversationPanel.dataset.reviewSignature=signature;
    // Reuse the actual review decisions and handlers in this single workspace.
    boardReview();
    const review=$('#veil .review-visual');
    conversationPanel.replaceChildren();
    $('#veil').classList.remove('show');
    if(review){
      conversationPanel.append(review);
      $('.review-map',review)?.remove();
      // It is a tab, not a dialog. The .sheet chrome -- 700px, dark plate, modal shadow -- was being
      // lifted whole into a 460px light sidebar, and its footer Close closed the conversation rather
      // than the review. The tab beside it is the way back; a tab does not need a Close.
      review.classList.add('review-in-panel');
      const heading=$('.sh',review);
      if(heading){heading.replaceChildren();heading.append(document.createTextNode('Review this workflow'));}
      $('.sf',review)?.remove();
    }
  }
  stavesNavigation();
};
reviewTracks=function(){suspendConversationVoice();closeSheet();stavesTab='review';conversationOpen=true;renderConversation();paintFocusedInterview?.();};
const discussOpen=openConversation;
openConversation=function(scope){stavesTab='discuss';discussOpen(scope||(job(state.sel)?state.sel:'board'));paintFocusedInterview?.();};
// Contextual asks also use Staves instead of opening a second competing chat.
$('#askb').onclick=()=>openConversation();
/* The board's first paint happens before this module finishes loading, so hooking paintNavigation
   alone left the app with no agenda handle -- and therefore no way into the conversation -- until
   something forced a second paint. render() runs every time the canvas is drawn, which is the one
   signal that always fires. */
const paintBeforeAgenda=render;
render=function(...args){const out=paintBeforeAgenda.apply(this,args);try{stavesNavigation();stavesFab();}catch(error){console.warn('[staves] header paint failed',error);}return out;};
requestAnimationFrame(()=>{try{stavesNavigation();stavesFab();}catch{}});

const workspacePaint=paintNavigation;
paintNavigation=function(){workspacePaint();paintWorkspaceIdentity();stavesNavigation();stavesFab();zoomReadout.textContent=Math.round(detailZoom*100)+'%';zoomReadout.title=Math.round(detailZoom*100)+'% horizontal detail';};
const rehearsalClose=closeRehearsal;
closeRehearsal=function(){rehearsalClose();canvasMode.value='design';};

const legacyAsk=toggleAsk;
toggleAsk=function(on){legacyAsk(false);if(on!==false)openConversation();};

const beginRehearsal=openRehearsal;
openRehearsal=function(){closeAsRun();beginRehearsal();canvasMode.value='rehearse';};
const beginCaseCheck=openCaseCheck;
openCaseCheck=function(...args){closeAsRun();return beginCaseCheck(...args);};

state.view='normal';document.body.classList.remove('chairs');

$('#ask').hidden=true;$('#ask').inert=true;$('#ask').setAttribute('aria-hidden','true');

const workspaceRender=render;render=function(){workspaceRender();const retired=$('#ask');if(retired){retired.hidden=true;retired.inert=true;retired.setAttribute('aria-hidden','true');}};

// The sidebar owns one remembered width, independent of conversation content and board changes.
const conversationWidthKey='staves:conversation-width';
let preferredConversationWidth=460;
try{const saved=Number(localStorage.getItem(conversationWidthKey));if(Number.isFinite(saved)&&saved>=320)preferredConversationWidth=saved;}catch{}
const conversationResize=document.createElement('div');
conversationResize.id='conversation-resize';conversationResize.tabIndex=0;
conversationResize.setAttribute('role','separator');conversationResize.setAttribute('aria-orientation','vertical');
conversationResize.setAttribute('aria-label','Resize Staves conversation');conversationResize.setAttribute('aria-controls','conversation-panel');
conversationResize.title='Drag to resize · arrow keys adjust · double-click resets';
document.body.append(conversationResize);
function conversationWidthBounds(){return {min:320,max:Math.max(320,Math.min(850,window.innerWidth-300))};}
function applyConversationWidth(){
  const bounds=conversationWidthBounds(),width=Math.round(Math.max(bounds.min,Math.min(bounds.max,preferredConversationWidth)));
  document.documentElement.style.setProperty('--staves-conversation-width',width+'px');
  conversationResize.setAttribute('aria-valuemin',String(bounds.min));conversationResize.setAttribute('aria-valuemax',String(bounds.max));conversationResize.setAttribute('aria-valuenow',String(width));conversationResize.setAttribute('aria-valuetext',width+' pixels wide');
  return width;
}
function rememberConversationWidth(width){
  const bounds=conversationWidthBounds();preferredConversationWidth=Math.max(bounds.min,Math.min(bounds.max,width));applyConversationWidth();
  try{localStorage.setItem(conversationWidthKey,String(preferredConversationWidth));}catch{}
}
let conversationResizeDrag=null;
conversationResize.addEventListener('pointerdown',event=>{
  if(event.button!==0||window.innerWidth<=750)return;
  event.preventDefault();conversationResizeDrag={pointer:event.pointerId,x:event.clientX,width:applyConversationWidth()};
  conversationResize.setPointerCapture(event.pointerId);document.body.classList.add('resizing-conversation');
});
conversationResize.addEventListener('pointermove',event=>{
  if(conversationResizeDrag?.pointer!==event.pointerId)return;
  rememberConversationWidth(conversationResizeDrag.width+conversationResizeDrag.x-event.clientX);
});
function finishConversationResize(){conversationResizeDrag=null;document.body.classList.remove('resizing-conversation');if(typeof minimap==='function')requestAnimationFrame(minimap);}
conversationResize.addEventListener('pointerup',finishConversationResize);
conversationResize.addEventListener('pointercancel',finishConversationResize);
conversationResize.addEventListener('lostpointercapture',finishConversationResize);
conversationResize.addEventListener('dblclick',()=>rememberConversationWidth(460));
conversationResize.addEventListener('keydown',event=>{
  const width=applyConversationWidth(),step=event.shiftKey?50:20,bounds=conversationWidthBounds();
  const next={ArrowLeft:width+step,ArrowRight:width-step,Home:bounds.min,End:bounds.max}[event.key];
  if(next==null)return;event.preventDefault();event.stopPropagation();rememberConversationWidth(next);requestAnimationFrame(minimap);
});
window.addEventListener('resize',applyConversationWidth);
applyConversationWidth();
