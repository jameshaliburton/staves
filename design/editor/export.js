/* A handoff continues the board in a coding agent. File exports have their own action. */
const handoffDialog = document.createElement('dialog');
handoffDialog.id = 'handoff-dialog';
handoffDialog.setAttribute('aria-labelledby', 'handoff-title');
document.body.append(handoffDialog);
let handoffDraft = null;
let handoffOpener = null;
const handoffCopyIcon = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';

function handoffKey(d) {
  return 'staves:handoff:' + JSON.stringify([d.board, d.scope === 'all' ? 'all' : [...d.ids].sort(), d.intention, d.draft]);
}
function rememberHandoff(d) {
  try { sessionStorage.setItem(handoffKey(d), d.data.requestId); } catch {}
}
function openHandoffExport(options = {}) {
  stopHandoffDelivery();
  handoffOpener = document.activeElement;
  handoffDraft = {
    mode: 'agent', board: options.board || state.name, title: state.board?.title || 'Workflow',
    jobs: live().map(j => ({ ...j })), scope: options.jobIds?.length ? 'selected' : 'all',
    ids: new Set(options.jobIds || state.multi || []), intention: options.intention || '', draft: options.draft || '',
    data: null, copied: false, busy: false, delivery: null, deliveryTimer: null, polling: false,
    result: null, includeSources: false,
  };
  const d = handoffDraft;
  paintHandoffExport();
  if (!handoffDialog.open) handoffDialog.showModal();
  $('#handoff-copy').focus();
  if (d.data) startHandoffDelivery(d);
}
function openWorkflowExport() {
  openHandoffExport();
  stopHandoffDelivery();
  handoffDraft.mode = 'export';
  handoffDraft.data = null;
  paintHandoffExport();
  handoffDialog.querySelector('h2').focus();
}
function handoffScopeMarkup(d) {
  const summary = d.scope === 'all' ? 'Whole workflow' : d.ids.size + ' selected';
  return '<details class="handoff-scope"><summary><span id="handoff-scope-label">' + summary + '</span><span class="handoff-change">Change</span></summary>'
    + '<fieldset id="handoff-scope-fields"' + (d.busy ? ' disabled' : '') + '><legend>Work to include</legend>'
    + '<label><input type="radio" name="handoff-scope" value="all"' + (d.scope === 'all' ? ' checked' : '') + '>Whole workflow</label>'
    + '<label><input type="radio" name="handoff-scope" value="selected"' + (d.scope === 'selected' ? ' checked' : '') + '>Choose jobs</label>'
    + '<div class="handoff-jobs"' + (d.scope === 'all' ? ' hidden' : '') + '>'
    + d.jobs.map(j => '<label><input type="checkbox" data-export-job="' + esc(j.id) + '"' + (d.ids.has(j.id) ? ' checked' : '') + '><span>' + esc(j.name) + (j.parent ? '<small>Task</small>' : '') + '</span></label>').join('')
    + '</div></fieldset></details>';
}
function paintHandoffExport() {
  const d = handoffDraft, exporting = d.mode === 'export';
  handoffDialog.dataset.mode = d.mode;
  handoffDialog.innerHTML = '<header><h2 id="handoff-title" tabindex="-1">' + (exporting ? 'Export workflow' : 'Continue in your coding agent') + '</h2>'
    + '<button type="button" class="ib" aria-label="Close handoff">' + ei('close') + '</button></header>'
    + '<div class="handoff-body"><div class="handoff-board">' + ei('flow-arrow') + '<strong>' + esc(d.title) + '</strong></div>'
    + handoffScopeMarkup(d)
    + (exporting
      ? '<p class="handoff-lead">Download a copy of this workflow.</p><div class="handoff-downloads">'
        + [['markdown', 'Brief', 'file-text'], ['svg', 'Map', 'share-network'], ['json', 'Data', 'code']].map(([format, label, icon]) => '<button type="button" class="bt" data-export-file="' + format + '">' + ei(icon) + label + '</button>').join('')
        + '</div><details class="handoff-more"><summary>More export options</summary><label><input type="checkbox" id="handoff-sources">Include source references</label><button type="button" class="bt q" data-export-file="n8n">Download n8n planning canvas</button></details>'
      : '<p class="handoff-lead">Copy, then paste into your coding agent’s chat.</p><p class="handoff-support">Paste into Claude Code, Codex, Gemini CLI, or Cursor. Your agent will connect and show what you can do with this workflow.</p>'
        + '<button type="button" class="bt acc handoff-primary" id="handoff-copy">' + handoffCopyIcon + '<span>Copy to coding agent</span></button>'
        + '<div id="handoff-delivery" role="status" aria-live="polite"></div>'
        + '<details class="handoff-more" id="handoff-prompt-details" hidden><summary>View copied instructions</summary><textarea id="handoff-prompt-text" readonly rows="7" aria-label="Instructions for your coding agent"></textarea></details>')
    + '<p id="handoff-error" role="alert"></p><p id="handoff-status" role="status"></p></div>';
  handoffDialog.querySelector('header button').onclick = () => handoffDialog.close();
  $$('[name="handoff-scope"]', handoffDialog).forEach(input => input.onchange = () => {
    d.scope = input.value;
    handoffDialog.querySelector('.handoff-jobs').hidden = d.scope === 'all';
    changeHandoffScope(d);
  });
  $$('[data-export-job]', handoffDialog).forEach(input => input.onchange = () => {
    if (input.checked) d.ids.add(input.dataset.exportJob); else d.ids.delete(input.dataset.exportJob);
    changeHandoffScope(d);
  });
  if (exporting) {
    $$('[data-export-file]', handoffDialog).forEach(button => button.onclick = () => downloadHandoff(button.dataset.exportFile));
    $('#handoff-sources').onchange = event => { d.includeSources = event.target.checked; d.result = null; };
  } else {
    $('#handoff-copy').onclick = copyAgentHandoff;
    paintHandoffDelivery();
    updateHandoffCopy(d);
  }
}
function changeHandoffScope(d) {
  stopHandoffDelivery();
  d.data = null; d.result = null; d.delivery = null; d.copied = false;
  $('#handoff-scope-label').textContent = d.scope === 'all' ? 'Whole workflow' : d.ids.size + ' selected';
  $('#handoff-error').textContent = '';
  if (d.mode === 'agent') { updateHandoffCopy(d); paintHandoffDelivery(); }
}
function updateHandoffCopy(d) {
  const button = $('#handoff-copy');
  if (!button || d.mode !== 'agent') return;
  button.disabled = d.busy || !d.jobs.length;
  button.innerHTML = handoffCopyIcon + '<span>' + (d.busy ? 'Preparing…' : d.copied ? 'Copy again' : 'Copy to coding agent') + '</span>';
  $('#handoff-scope-fields').disabled = d.busy;
  if (d.data) {
    $('#handoff-prompt-details').hidden = false;
    $('#handoff-prompt-text').value = d.data.prompt;
  } else $('#handoff-prompt-details').hidden = true;
  if (!d.jobs.length) $('#handoff-error').textContent = 'Add a job to the workflow before handing it over.';
}
function validHandoffScope(d) {
  if (d.scope === 'selected' && !d.ids.size) {
    $('#handoff-error').textContent = 'Choose at least one job, or use the whole workflow.';
    return false;
  }
  return true;
}
async function handoffResponseError(response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.error === 'string') return new Error(parsed.error);
  } catch {}
  return new Error(body.startsWith('<') ? 'Could not reach Staves. Try again.' : body || 'Could not complete the request. Try again.');
}
async function copyAgentHandoff() {
  const d = handoffDraft;
  if (!d || d.mode !== 'agent' || d.busy || !validHandoffScope(d)) return;
  d.busy = true; $('#handoff-error').textContent = ''; updateHandoffCopy(d);
  try {
    if (!d.data) {
      let requestId;
      try { requestId = sessionStorage.getItem(handoffKey(d)) || undefined; } catch {}
      const page = new URL('./', location.href); page.searchParams.set('board', d.board);
      const response = await fetch('./agent-handoff?board=' + encodeURIComponent(d.board), {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ jobIds: d.scope === 'selected' ? [...d.ids] : undefined, page: page.href, intention: d.intention || undefined, draft: d.draft || undefined, requestId }),
      });
      if (!response.ok) throw await handoffResponseError(response);
      d.data = await response.json();
      rememberHandoff(d);
    }
    if (handoffDraft !== d || !handoffDialog.open) return;
    updateHandoffCopy(d);
    try {
      await navigator.clipboard.writeText(d.data.prompt);
      if (handoffDraft !== d || !handoffDialog.open) return;
      d.copied = true;
      $('#handoff-status').textContent = '';
    } catch {
      if (handoffDraft !== d || !handoffDialog.open) return;
      d.copied = false;
      $('#handoff-prompt-details').open = true;
      const field = $('#handoff-prompt-text'); field.focus(); field.select();
      $('#handoff-error').textContent = 'Your browser blocked copying. Copy the selected instructions, then paste them into your agent’s chat.';
    }
    startHandoffDelivery(d);
  } catch (error) {
    if (handoffDraft === d && handoffDialog.open) $('#handoff-error').textContent = error.message || 'Could not prepare the handoff. Try again.';
  } finally {
    d.busy = false;
    if (handoffDraft === d && handoffDialog.open) updateHandoffCopy(d);
  }
}
function startHandoffDelivery(d) {
  stopHandoffDelivery();
  d.deliveryTimer = setInterval(refreshHandoffDelivery, 4000);
  paintHandoffDelivery();
  refreshHandoffDelivery();
}
function stopHandoffDelivery() {
  const d = handoffDraft;
  if (d?.deliveryTimer) { clearInterval(d.deliveryTimer); d.deliveryTimer = null; }
}
async function refreshHandoffDelivery() {
  const d = handoffDraft;
  if (!d?.data || !handoffDialog.open || d.mode !== 'agent') { stopHandoffDelivery(); return; }
  if (d.polling) return;
  d.polling = true;
  const data = d.data;
  try {
    const response = await fetch('./assessment?board=' + encodeURIComponent(d.board) + '&id=' + encodeURIComponent(data.requestId), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw await handoffResponseError(response);
    const saved = await response.json();
    if (handoffDraft !== d || d.data !== data || !handoffDialog.open) return;
    if (saved.request?.id !== data.requestId) throw new Error('Unexpected handoff status.');
    d.delivery = saved.delivery;
    if (['claimed', 'running', 'completed', 'failed'].includes(saved.delivery?.status)) stopHandoffDelivery();
  } catch (error) {
    if (handoffDraft !== d || d.data !== data || !handoffDialog.open) return;
    d.delivery = { error: error.message || 'Status unavailable' };
  } finally { d.polling = false; }
  if (handoffDraft === d && handoffDialog.open) paintHandoffDelivery();
}
function paintHandoffDelivery() {
  const d = handoffDraft, host = $('#handoff-delivery');
  if (!host || d?.mode !== 'agent') return;
  if (!d.data) { host.innerHTML = ''; return; }
  const delivery = d.delivery;
  if (delivery?.error) {
    host.innerHTML = '<p class="handoff-support">Could not check whether your agent received the workflow.</p><button type="button" class="bt q" id="handoff-retry">Check again</button>';
  } else if (delivery?.status === 'failed') {
    host.innerHTML = '<p class="handoff-support">Your agent could not continue. Return to your agent to resolve it.</p>';
  } else if (['claimed', 'running', 'completed'].includes(delivery?.status)) {
    const name = String(delivery.actor || 'your agent').replace(/^agent:/, '');
    host.innerHTML = '<div class="handoff-received">' + ei('check') + '<div><strong>Received by ' + esc(name) + '</strong><p>Continue in your agent.</p></div></div>';
  } else {
    host.innerHTML = '<div class="handoff-waiting">' + ei('chat-circle') + '<div><strong>' + (d.copied ? 'Copied. Paste into your agent’s chat.' : 'Paste the instructions into your agent’s chat.') + '</strong><p>Waiting for your agent to read this workflow.</p><p>If it asks to connect, approve access in your browser, then return to your agent.</p></div></div>';
  }
  const retry = $('#handoff-retry'); if (retry) retry.onclick = refreshHandoffDelivery;
}
async function prepareWorkflowExport() {
  const d = handoffDraft;
  if (!validHandoffScope(d)) return null;
  if (d.result) return d.result;
  const response = await fetch('./handoff-export?board=' + encodeURIComponent(d.board), {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ purpose: 'workshop', jobIds: d.scope === 'selected' ? [...d.ids] : undefined, includeSources: d.includeSources }),
  });
  if (!response.ok) throw await handoffResponseError(response);
  d.result = await response.json();
  return d.result;
}
async function downloadHandoff(format) {
  const d = handoffDraft;
  if (d.busy) return;
  d.busy = true; $('#handoff-error').textContent = '';
  $$('[data-export-file]', handoffDialog).forEach(button => button.disabled = true);
  $('#handoff-scope-fields').disabled = true;
  $('#handoff-sources').disabled = true;
  $('#handoff-status').textContent = 'Preparing download…';
  try {
    const result = await prepareWorkflowExport();
    if (!result || handoffDraft !== d || !handoffDialog.open) return;
    const extensions = { markdown: 'md', svg: 'svg', json: 'json', n8n: 'n8n.json' };
    const types = { markdown: 'text/markdown', svg: 'image/svg+xml', json: 'application/json', n8n: 'application/json' };
    const url = URL.createObjectURL(new Blob([result.formats[format]], { type: types[format] }));
    const a = document.createElement('a'); a.href = url; a.download = d.board + '-r' + result.packet.source.revision + '.' + extensions[format]; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('#handoff-status').textContent = 'Download ready.';
  } catch (error) {
    if (handoffDraft === d && handoffDialog.open) $('#handoff-error').textContent = error.message || 'Could not prepare the download.';
  } finally {
    d.busy = false;
    if (handoffDraft === d && handoffDialog.open) {
      $$('[data-export-file]', handoffDialog).forEach(button => button.disabled = false);
      $('#handoff-scope-fields').disabled = false;
      $('#handoff-sources').disabled = false;
      if ($('#handoff-status').textContent === 'Preparing download…') $('#handoff-status').textContent = '';
    }
  }
}
handoffDialog.addEventListener('close', () => { stopHandoffDelivery(); handoffOpener?.focus(); });
