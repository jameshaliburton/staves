/* Execution evidence stays separate from design acceptance and implementation progress. */
function langfuseConnection(value) {
  if (!value || typeof value.baseUrl !== 'string' || typeof value.projectId !== 'string') return null;
  try {
    const url = new URL(value.baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || value.baseUrl.length > 2048) return null;
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value.projectId)) return null;
    return { baseUrl: url.origin, projectId: value.projectId };
  } catch { return null; }
}
function editLangfuseConnection(accountNote) {
  const config = state.board.context?.langfuse || {};
  sheet('Select Langfuse project', [
    ...(accountNote ? [['note', accountNote, null, null, 'note']] : []),
    ['baseUrl', 'Langfuse URL', 'Your region’s cloud URL or self-hosted instance. HTTPS required except on localhost.', config.baseUrl || 'https://cloud.langfuse.com'],
    ['projectId', 'Project ID', 'Find this in your Langfuse project settings or project URL.', config.projectId || ''],
    ['meaning', 'This stores a public project reference. Saving does not check access or fetch evidence. Your coding agent reads execution evidence using credentials in its environment. Never enter an API key here.', null, null, 'note']
  ], async values => {
    const config = langfuseConnection({ baseUrl: values.baseUrl.trim(), projectId: values.projectId.trim() });
    if (!config) throw new Error('Enter a valid Langfuse URL without credentials, path, query or fragment, and a project ID containing letters, numbers, hyphens or underscores.');
    const existing = langfuseConnection(state.board.context?.langfuse);
    const hasEvidence = state.board.jobs.some(item => item.executionEvidence?.length);
    if (hasEvidence && (!existing || existing.baseUrl !== config.baseUrl || existing.projectId !== config.projectId)) throw new Error('This board has retained execution evidence. Keep its project reference; use a separate board for another project. Retracting captures preserves their history and does not remove this source association.');
    await checkedOp([{ t: 'setContext', context: { langfuse: config } }]);
  });
}
// A saved project reference is a public pointer, not access. Nothing here fetches from Langfuse, so the
// only proof access works is evidence an agent has fetched; until then the panel says so and names the
// two tools that establish it. The keys never reach this page: they live where the MCP server launches.
function langfuseEvidenceNote(config, hasEvidence) {
  const keys = 'The Langfuse keys live in the MCP server’s launch environment, not in this page.';
  if (!config) return ['Ask your agent: connect this board to Langfuse (staves_langfuse_connect), then staves_langfuse_probe', keys];
  if (!hasEvidence) return ['Connected · access not verified', 'Ask your agent to run staves_langfuse_probe. ' + keys];
  return ['Project reference saved. Saving this reference does not fetch evidence.'];
}
// On staves.io the account holds keys per Langfuse project (Account → Runs). A board with no connection of
// its own is offered each of those projects by name; with none saved, it is pointed at Account. Nothing
// here sees a key: the list carries only origins, project ids and masked public keys, and choosing one
// asks the server to attach that project to this board.
function langfuseAccountOffers(board, account) {
  if (!board || langfuseConnection(board.context?.langfuse) || !account || account.configured !== true || !Array.isArray(account.projects)) return null;
  // The same rule the sheet enforces: retained evidence keeps the board on the project it came from.
  if ((board.jobs || []).some(item => item.executionEvidence?.length)) return null;
  if (!account.projects.length) return { kind: 'keys', text: 'Add Langfuse keys under Account → Runs', href: './workspace#account' };
  const offers = [];
  for (const project of account.projects) {
    const connection = langfuseConnection({ baseUrl: project?.baseUrl, projectId: project?.projectId });
    if (!connection) continue;
    const name = typeof project.projectName === 'string' && project.projectName.trim() ? project.projectName.trim() : connection.projectId;
    offers.push({ label: 'Show runs from ' + (name.length > 60 ? name.slice(0, 59) + '…' : name), projectId: connection.projectId });
  }
  return offers.length ? { kind: 'projects', offers } : null;
}
// Points this board at one of the account's Langfuse projects. The keys stay in the account; this
// only says which project's runs belong to this board.
async function attachLangfuseProject(board, projectId) {
  const response = await fetch('/workspace-api/board-langfuse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board, projectId }), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not show runs on this board.');
  if (state.name === board) { try { await load(); } catch { toast('Saved, but the board could not refresh. Reload to see its runs.'); } }
}
// Board options → Langfuse project. On staves.io the account's projects are offered by name; anywhere
// else, and for a board that wants a different project, the reference is entered by hand.
function chooseLangfuseProject() {
  const offer = langfuseAccountOffers(state.board, langfuseAccount);
  if (offer?.kind === 'projects') {
    const board = state.name;
    sheet('Show runs on this board', [
      ['project', 'Which Langfuse project ran this work?', 'Uses the keys saved under Account → Runs.', offer.offers[0].projectId, null,
        [...offer.offers.map(choice => [choice.projectId, 'ph-plugs-connected', choice.label.replace(/^Show runs from /, '')]), ['manual', 'ph-pencil-line', 'Enter a project reference by hand']]],
    ], async values => {
      if (values.project === 'manual') { closeSheet(); editLangfuseConnection(); return; }
      await attachLangfuseProject(board, values.project);
    }, 'ph-plugs-connected');
    return;
  }
  editLangfuseConnection(offer?.kind === 'keys' ? 'No Langfuse keys are saved for this account yet. Add them under Account → Runs to choose a project by name.' : null);
}
let langfuseAccount = null, langfuseAccountAsked = false;
function loadLangfuseAccount() {
  if (langfuseAccountAsked || !document.querySelector('meta[name="staves-account"]')) return;
  langfuseAccountAsked = true;
  fetch('/workspace-api/langfuse', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    .then(response => response.ok ? response.json() : null)
    .then(settings => { langfuseAccount = settings; if (langfuseAccountOffers(state.board, settings)) paintLangfuse(); })
    .catch(() => {});
}
// Beside the Langfuse button in the timeline header, so it shows whether or not a job is selected.
function paintLangfuseAccountOffer() {
  document.getElementById('langfuse-account-offer')?.remove();
  const offer = langfuseAccountOffers(state.board, langfuseAccount);
  const header = document.querySelector('#tl > .ph');
  if (!offer || !header) return;
  const wrap = document.createElement('span');
  wrap.id = 'langfuse-account-offer';
  wrap.className = 'editor-toolbar';
  if (offer.kind === 'keys') {
    const link = document.createElement('a');
    link.href = offer.href; link.textContent = offer.text; link.className = 'langfuse-note';
    wrap.append(link);
  } else for (const choice of offer.offers) {
    const connect = eb(choice.label, 'plugs-connected', async () => {
      connect.disabled = true;
      try { await attachLangfuseProject(state.name, choice.projectId); }
      catch (error) {
        connect.disabled = false;
        toast(error.message || 'Could not show runs on this board.');
      }
    });
    connect.dataset.projectId = choice.projectId;
    connect.title = 'Uses the Langfuse keys saved under Account → Runs';
    wrap.append(connect);
  }
  header.append(wrap);
}
// Tracks at most one outstanding evidence request; delivery is polled here, not inside paintLangfuse's rebuild.
let langfuseTracking = null;
function stopLangfuseTracking() {
  if (langfuseTracking?.timer) { clearInterval(langfuseTracking.timer); langfuseTracking.timer = null; }
}
async function pollLangfuseDelivery() {
  if (!langfuseTracking) return;
  const { board, requestId } = langfuseTracking;
  try {
    const response = await fetch('./assessment?board=' + encodeURIComponent(board) + '&id=' + encodeURIComponent(requestId));
    if (!response.ok) throw new Error(await response.text());
    const saved = await response.json();
    if (!langfuseTracking || langfuseTracking.requestId !== requestId) return;
    langfuseTracking.snapshot = saved;
    if (['completed', 'failed'].includes(saved.delivery?.status)) stopLangfuseTracking();
    paintLangfuse();
  } catch (error) {
    if (!langfuseTracking || langfuseTracking.requestId !== requestId) return;
    langfuseTracking.snapshot = { error: error.message || 'Could not refresh request status.' };
    paintLangfuse();
  }
}
async function langfuseAgentRequest(item) {
  const button = document.querySelector('#langfuse-request');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    const response = await fetch('./assessment?board=' + encodeURIComponent(state.name), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ intent: 'assess', jobIds: [item.id], includeSources: true,
        rationale: 'Find Langfuse execution evidence for ' + item.name,
        constraints: 'Use staves_langfuse_probe to verify access, then staves_langfuse_discover to find bounded observation candidates. Attach evidence using staves_langfuse_evidence only for instrumented mappings or proposed historical associations with a rationale. Refresh exact capture keys; retain prior captures. Keep credentials in the MCP server process environment, never in tools or board content. Return evidence links and limitations through staves_assessment_return. A successful span does not establish job completion. This request does not authorize code changes.' })
    });
    if (!response.ok) throw new Error('Could not save the evidence request (HTTP ' + response.status + ').');
    const request = await response.json();
    stopLangfuseTracking();
    langfuseTracking = { itemId: item.id, board: state.name, requestId: request.id, snapshot: null, timer: null };
    paintLangfuse();
    await pollLangfuseDelivery();
    if (langfuseTracking) langfuseTracking.timer = setInterval(pollLangfuseDelivery, 5000);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = 'Retry evidence request'; }
    const status = document.createElement('p'); status.setAttribute('role', 'alert'); status.textContent = error.message;
    document.getElementById('langfuse-evidence')?.append(status);
  }
}
function paintLangfuse() {
  document.getElementById('langfuse-action')?.remove();
  document.getElementById('langfuse-evidence')?.remove();
  if (!state.board) return;
  loadLangfuseAccount();
  const config = langfuseConnection(state.board.context?.langfuse);
  const button = eb(config ? 'Langfuse · project selected' : 'Select Langfuse project', 'plugs-connected', editLangfuseConnection);
  button.id = 'langfuse-action';
  document.querySelector('#tl > .ph')?.append(button);
  paintLangfuseAccountOffer();
  const focused = typeof workSpace !== 'undefined' && !workSpace.hidden;
  const item = job(focused ? workEditorId : state.sel);
  if (langfuseTracking && (!item || item.id !== langfuseTracking.itemId || state.name !== langfuseTracking.board)) { stopLangfuseTracking(); langfuseTracking = null; }
  const host = document.getElementById(focused ? 'work-content' : 'sb');
  if (!item || !host) return;
  const panel = document.createElement('section');
  panel.id = 'langfuse-evidence';
  panel.setAttribute('aria-label', 'Execution evidence');
  const title = document.createElement('h3'); title.textContent = 'Execution evidence'; panel.append(title);
  const note = document.createElement('p');
  note.className = 'langfuse-note';
  note.textContent = 'Linked observations do not establish that this job achieved its outcome. This view does not independently verify the source or check current access.';
  panel.append(note);
  // Evidence can only be attached by an agent that actually reached Langfuse, so a board that has any
  // is a board whose access was demonstrated. Anywhere on the board, not just this job.
  const fetched = (state.board.jobs || []).some(entry => (entry.executionEvidence || []).some(ref => ref?.provider === 'langfuse'));
  for (const line of langfuseEvidenceNote(config, fetched)) {
    const connectionStatus = document.createElement('p');
    connectionStatus.className = 'langfuse-note';
    connectionStatus.textContent = line;
    panel.append(connectionStatus);
  }
  const references = Array.isArray(item.executionEvidence) ? item.executionEvidence.filter(ref => ref?.provider === 'langfuse') : [];
  if (!references.length) {
    const empty = document.createElement('p'); empty.textContent = 'No execution evidence linked. This does not mean the job has not run.'; panel.append(empty);
  }
  for (const ref of references) {
    const row = document.createElement('div'); row.className = 'langfuse-reference';
    const label = document.createElement('strong'); label.textContent = ref.retraction ? 'Reference retracted' : ref.status === 'error' ? 'Execution error observed' : 'Execution observed'; row.append(label);
    if (typeof ref.name === 'string') { const name = document.createElement('span'); name.textContent = ref.name; row.append(name); }
    const metadata = document.createElement('small');
    const parts = [];
    if (typeof ref.fetchedAt === 'string') parts.push('Fetched ' + ref.fetchedAt + (ref.fetchedBy ? ' by ' + ref.fetchedBy : ''));
    if (ref.mapping) parts.push(ref.mapping.method === 'instrumented' ? 'Instrumented mapping' : ref.mapping.method === 'reviewed' ? 'Association reviewed by ' + ref.mapping.reviewedBy : 'Association proposed, not reviewed');
    if (ref.supersedes) parts.push('Refreshed capture; prior evidence retained');
    if (ref.retraction) parts.push('Retracted by ' + ref.retraction.by + ': ' + ref.retraction.reason);
    if (typeof ref.observedAt === 'string') parts.push('Observed ' + ref.observedAt);
    if (Number.isFinite(ref.durationMs) && ref.durationMs >= 0) parts.push(ref.durationMs < 1000 ? ref.durationMs + ' ms' : (ref.durationMs / 1000).toFixed(2) + ' s');
    parts.push(ref.designRevision !== undefined ? 'Design revision ' + String(ref.designRevision) : 'Design revision not recorded');
    if (typeof ref.environment === 'string') parts.push('Environment: ' + ref.environment);
    if (typeof ref.observationId === 'string') parts.push('Observation: ' + ref.observationId);
    metadata.textContent = parts.join(' · '); row.append(metadata);
    const source = ref.baseUrl ? langfuseConnection({baseUrl: ref.baseUrl, projectId: ref.projectId}) : config && ref.projectId === config.projectId ? config : null;
    if (source && typeof ref.traceId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(ref.traceId)) {
      const link = document.createElement('a');
      link.href = source.baseUrl + '/project/' + encodeURIComponent(source.projectId) + '/traces/' + encodeURIComponent(ref.traceId);
      if (typeof ref.observationId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(ref.observationId)) link.href += '?observation=' + encodeURIComponent(ref.observationId);
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open trace in Langfuse'; row.append(link);
    } else { const unavailable = document.createElement('small'); unavailable.textContent = 'Trace link unavailable: connect the matching Langfuse project.'; row.append(unavailable); }
    if (!ref.retraction) row.append(eb('Retract reference', 'x', () => sheet('Retract execution reference', [
      ['reason', 'Reason', 'The captured evidence remains in history and will be labelled retracted.', '', 'area']
    ], async values => {
      const reason = values.reason.trim();
      if (!reason || reason.length > 2000) throw new Error('Enter a reason of up to 2,000 characters.');
      const key = JSON.stringify([ref.provider, ref.baseUrl ?? null, ref.projectId, ref.traceId, ref.observationId ?? null, ref.fetchedAt ?? null]);
      await checkedOp([{t: 'retractExecutionEvidence', id: item.id, key, reason}]);
    })));
    panel.append(row);
  }
  const activeTracking = langfuseTracking && langfuseTracking.itemId === item.id ? langfuseTracking : null;
  const activeStatus = activeTracking?.snapshot?.delivery?.status;
  const requestButton = config ? eb('Ask agent to find evidence', 'arrow-right', () => langfuseAgentRequest(item)) : eb('Select Langfuse project', 'plugs-connected', editLangfuseConnection);
  requestButton.id = 'langfuse-request';
  if (activeTracking && !['completed', 'failed'].includes(activeStatus)) { requestButton.disabled = true; requestButton.title = 'A request is already saved for this job. See its status below.'; }
  panel.append(requestButton);
  if (activeTracking) {
    const tracking = document.createElement('div');
    tracking.id = 'langfuse-delivery';
    if (activeTracking.snapshot?.error) { const alert = document.createElement('p'); alert.setAttribute('role', 'alert'); alert.textContent = activeTracking.snapshot.error; tracking.append(alert); }
    else if (activeTracking.snapshot) paintDeliveryTracking(tracking, activeTracking.snapshot, 'assess', state.name, () => pollLangfuseDelivery());
    else { const waiting = document.createElement('p'); waiting.setAttribute('role', 'status'); waiting.textContent = 'Checking request status…'; tracking.append(waiting); }
    panel.append(tracking);
  }
  host.append(panel);
}
const renderBeforeLangfuse = render;
render = function() { renderBeforeLangfuse(); paintLangfuse(); };

const workEditorBeforeLangfuse = paintWorkEditor;
paintWorkEditor = function() { workEditorBeforeLangfuse(); paintLangfuse(); };
