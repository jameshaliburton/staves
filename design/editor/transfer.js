/* Reallocation is a design proposal, backed by the shared operation store. */
let transferView = null;
async function transferRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
function transferUrl(id, to, placement = {}) {
  return './handover?board=' + encodeURIComponent(state.name) + '&job=' + encodeURIComponent(id) + '&to=' + encodeURIComponent(to) + '&placement=' + encodeURIComponent(JSON.stringify(placement));
}
async function inspectTransfer(id, to, seq = null, placement = {}) {
  try {
    const saved = seq && state.board.proposalsList.find(p => p.seq === seq);
    placement = saved?.op.placement || placement;
    const plan = await transferRequest(transferUrl(id, to, placement));
    const supersedes = saved && saved.op.basis !== plan.basis ? seq : null;
    transferView = {plan, seq: supersedes ? null : seq, supersedes, placement};
    drawTransfer();
  } catch (error) { toast(error.message); }
}
function transferCard(label, items, icon, warning = false) {
  return '<section class="transfer-fact' + (warning ? ' blocked' : '') + '"><h3>' + ei(icon) + esc(label) + '<span>' + items.length + '</span></h3>' + (items.length ? '<ul>' + items.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>' : '<p class="hint">None identified</p>') + '</section>';
}
function drawTransfer() {
  const view=transferView;
  const {plan, seq, supersedes, placement} = view;
  const labelFor = id => job(id)?.name || plan.ops[0]?.after.jobs.find(j => j.id === id)?.name || id;
  const source = track(plan.fromTrack), target = track(plan.toTrack), current = job(plan.jobId);
  const veil = $('#veil');
  veil.innerHTML = '<div class="sheet transfer-sheet" role="dialog" aria-modal="true" aria-labelledby="transfer-title">' +
    '<header class="transfer-header"><div><small>REVIEW A ROLE CHANGE</small><h2 id="transfer-title">' + esc(current?.name || plan.jobId) + '</h2></div><button class="ib" id="transfer-close" aria-label="Close role change review">' + ei('close') + '</button></header>' +
    '<div class="transfer-body"><div class="transfer-route"><div>' + ei(source?.kind || 'person') + '<span><small>Current</small><b>' + esc(source?.name || plan.fromTrack) + '</b></span></div>' + ei('arrow-right') + '<div class="destination">' + ei(target?.kind || 'agent') + '<span><small>Proposed</small><b>' + esc(target?.name || plan.toTrack) + '</b></span></div></div>' +
    '<div class="transfer-grid">' + transferCard('Assigned to the new role', plan.moves.map(labelFor), 'arrow-right') + transferCard('Keeps its current role', plan.stays.map(labelFor), 'person') + '</div>' +
    (plan.blocks.length ? transferCard('Resolve before accepting', plan.blocks, 'warning', true) : '') +
    '<details class="transfer-details"' + '' + '><summary>Questions to resolve <span>' + plan.needs.length + '</span></summary>' + plan.needs.map(t => '<p>' + esc(t) + '</p>').join('') + '</details>' +
    '<details class="transfer-details"><summary>What changes <span>' + plan.changes.length + '</span></summary>' + plan.changes.map(t => '<p>' + esc(t) + '</p>').join('') + '</details>' +
    '<div id="transfer-discussion" hidden><label for="transfer-question">Question for the coding assistant</label><textarea id="transfer-question" rows="3" placeholder="What would it take to make this work?"></textarea><p class="hint">' + (state.presence.length ? 'Save a question for the connected assistant to review.' : 'No assistant is connected. You can save the question and connect one later.') + '</p><button class="bt" id="transfer-send">Save question</button><div id="transfer-replies"></div></div>' +
    '<p class="transfer-error" id="transfer-error" role="alert"></p></div>' +
    '<footer class="transfer-footer"><span>Changes the design only</span><button class="bt q" id="transfer-reject">' + (seq ? 'Reject' : 'Cancel') + '</button><button class="bt q" id="transfer-outbox">Ask coding agent</button><button class="bt q" id="transfer-discuss">Discuss with Staves</button><button class="bt acc" id="transfer-accept"' + (plan.blocks.length ? ' disabled' : '') + '>Accept change</button></footer></div>';
  veil.classList.add('show');
  if (supersedes) $('#transfer-error').textContent = 'The board changed. This is a fresh analysis; accepting replaces the earlier proposal.';
  $('#transfer-close').onclick = closeSheet;
  $('#transfer-reject').onclick = async () => {
    try { if (seq || supersedes) await checkedOp([{t:'reject', seq:seq || supersedes, by:'human'}]); closeSheet(); transferView = null; }
    catch (error) { $('#transfer-error').textContent = error.message; }
  };
  $('#transfer-discuss').onclick = () => {
    const context='Review this proposed role change: '+current.name+' from '+source.name+' to '+target.name+'. Work that moves: '+plan.moves.map(labelFor).join(', ')+'. Work that stays: '+plan.stays.map(labelFor).join(', ')+'. Open checks: '+[...plan.blocks,...plan.needs].join('; ')+'. Help me consider the human consequences before I accept it.';
    closeSheet();talkWithStaves(plan.jobId,context,{label:'Return to role change',run:()=>inspectTransfer(plan.jobId,plan.toTrack,seq,placement)});
  };
  $('#transfer-outbox').onclick = () => {
    $('#transfer-discussion').hidden = false;
    $('#transfer-question').focus();
    const questions = state.board.questions.filter(q => q.about === plan.jobId);
    $('#transfer-replies').innerHTML = questions.map(q => '<div class="transfer-thread"><b>' + esc(q.answer ? 'Answered' : q.status === 'done' ? 'Resolved' : 'Open') + '</b><p>' + esc(q.text) + '</p>' + (q.answer ? '<p>' + esc(q.answeredBy || 'Assistant') + ': ' + esc(q.answer) + '</p>' : '') + '</div>').join('');
  };
  $('#transfer-send').onclick = async () => {
    const input = $('#transfer-question');
    if (!input.value.trim()) { $('#transfer-error').textContent='Write a question for the coding agent.';input.focus(); return; }
    const sendButton=$('#transfer-send'),errorBox=$('#transfer-error');
    if(sendButton.disabled)return;
    const dismiss=[$('#transfer-close'),$('#transfer-reject'),$('#transfer-discuss'),$('#transfer-outbox'),$('#transfer-accept')];
    const disabled=dismiss.map(control=>control.disabled);dismiss.forEach(control=>control.disabled=true);sendButton.disabled=true;sendButton.textContent='Saving…';veil.dataset.saving='true';
    try {
      const context = 'Considering moving "' + current.name + '" from ' + source.name + ' to ' + target.name + '. ' + [...plan.blocks, ...plan.needs].join(' ');
      await checkedOp([{t:'ask', question:{id:'transfer-question-' + Date.now(), about:plan.jobId, text:context + '\n\n' + input.value.trim(), status:'raised', askedBy:'human', at:new Date().toISOString()}}]);
      if(input.isConnected){input.value='';sendButton.textContent='Question saved';errorBox.textContent='Saved in the coding-agent question queue. It has not been sent automatically.';}
    } catch (error) {if(errorBox.isConnected){errorBox.textContent=error.message;sendButton.textContent='Retry saving question';}}
    finally{delete veil.dataset.saving;if(sendButton.isConnected){sendButton.disabled=false;dismiss.forEach((control,i)=>control.disabled=disabled[i]);}}
  };
  $('#transfer-accept').onclick = async () => {
    const acceptButton=$('#transfer-accept'),boardId=state.name;
    acceptButton.disabled=true;acceptButton.textContent='Saving…';veil.dataset.saving='true';
    const dismiss=[$('#transfer-close'),$('#transfer-reject'),$('#transfer-discuss'),$('#transfer-outbox')];dismiss.forEach(control=>control.disabled=true);
    try {
      let proposalSeq = view.seq;
      if (!proposalSeq) {
        const result = await transferRequest(transferUrl(plan.jobId, plan.toTrack, placement), {method:'POST', body:JSON.stringify({basis:plan.basis})});
        proposalSeq = result.seq;
        view.seq = proposalSeq;
      }
      await checkedOp([{t:'accept', seq:proposalSeq, by:'human'}, ...(supersedes ? [{t:'reject',seq:supersedes,by:'human'}] : [])]);
      delete veil.dataset.saving;if(acceptButton.isConnected&&state.name===boardId){closeSheet();transferView=null;}
      toast('Role change saved · Undo is available');
    } catch (error) {
      if(acceptButton.isConnected){$('#transfer-error').textContent=error.message+' Close and reopen this role change to review the current board.';acceptButton.disabled=false;acceptButton.textContent='Accept change';dismiss.forEach(control=>control.disabled=false);}
    } finally {delete veil.dataset.saving;}
  };
  veil.querySelector('.transfer-sheet').onkeydown = event => {
    if (event.key !== 'Tab') return;
    const controls = [...veil.querySelectorAll('button:not(:disabled),textarea,summary')].filter(el => el.offsetParent !== null);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  $('#transfer-close').focus();
}
async function checkedOp(operations, options = {}) {
  const boardId=state.name;
  const response = await fetch('./op?board=' + encodeURIComponent(boardId) + (options.propose ? '&propose=1' : ''), {method:'POST', body:JSON.stringify(operations)});
  if (!response.ok) throw new Error(await response.text());
  if(state.name===boardId){try{await load();}catch{toast('Saved, but the board could not refresh. Reload to see the saved change.');}}
}
// All native reassignment gestures and edit sheets pass through this operation boundary.
op = async function(operations, options = {}) {
  const acceptance = operations.find(o => o.t === "accept");
  const proposed = acceptance && state.board.proposalsList.find(p => p.seq === acceptance.seq);
  if (proposed?.op.t === "handover") { await inspectTransfer(proposed.op.jobId, proposed.op.toTrack, proposed.seq); return; }
  const move = !options.propose && operations.find(o => o.t === 'updateJob' && o.patch.track && job(o.id) && job(o.id).track !== o.patch.track && ['person:agent','agent:person'].includes(trackOf(job(o.id))?.kind + ':' + track(o.patch.track)?.kind));
  if (move) { const placement={}; for(const key of ['parent','trigger']) if(key in move.patch) placement[key]=move.patch[key]; const order=operations.find(o=>o.t==='reorder'&&o.id===move.id); if(order){placement.before=order.before;placement.after=order.after;} await inspectTransfer(move.id, move.patch.track, null, placement); return; }
  try { await checkedOp(operations, options); } catch (error) { toast(error.message); throw error; }
};
const originalTransferPropLine = propLine;
propLine = function(p) { return p.op.t === 'handover' ? 'Reassign ' + esc(job(p.op.jobId)?.name || p.op.jobId) + ' · <button class="bt q" data-transfer-seq="' + p.seq + '">Review role change</button>' : originalTransferPropLine(p); };
document.addEventListener('click', event => {
  const button = event.target.closest('[data-transfer-seq]');
  if (!button) return;
  const proposal = state.board.proposalsList.find(p => p.seq === Number(button.dataset.transferSeq));
  if (proposal) inspectTransfer(proposal.op.jobId, proposal.op.toTrack, proposal.seq);
});
