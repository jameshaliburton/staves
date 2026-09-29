/* As run: production observations painted over the design. Measurement beside design — a job with
   runs is not thereby implemented as designed, and a job with none is not thereby missing. Every
   number carries the window it covers and the bound of the scan that produced it. */

/** Work that cannot run on its own: a store is a home, a queue is a wait, a watch is looking rather
 * than acting, a ghost is not done today, and outside work happens beyond our instrumentation.
 * Silence about any of these says nothing at all. */
const asRunCannotRun = new Set(['store', 'queue', 'watch', 'ghost', 'outside']);

/** What the page wears for one state of the mode. The paint exists only once a window has arrived:
 * a refused or failed read must never leave the board half-lit behind the message explaining why. */
function overlayClasses(state) {
  const open = Boolean(state && state.open);
  return { 'as-run-open': open, 'as-run-painted': open && Boolean(state && state.overlay) && !(state && state.error) };
}

/** One drift row, one question: asking twice about the same thing replaces it rather than piling up. */
function asRunQuestionId(kind, jobId) {
  return 'as-run-' + (kind === 'unknown' ? 'unknown' : 'never') + '-' + String(jobId);
}

/** A duration as a person would say it. */
function durationLabel(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return Math.round(value) + 'ms';
  if (value < 60000) return (Math.round(value / 100) / 10) + 's';
  const seconds = Math.round(value / 1000);
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}

/** One window of runs as paint values: per job, per exit, per handoff, and the drift in both directions. */
function runOverlay(aggregate, board) {
  const summary = aggregate || {};
  const jobs = ((board && board.jobs) || []).filter(item => !item.removed);
  const measured = summary.jobs || {}, taken = summary.exits || {};
  const nodes = {};
  for (const item of jobs) {
    const seen = measured[item.id];
    nodes[item.id] = {
      runs: seen ? seen.runs : 0,
      failures: seen ? seen.failures : 0,
      p50Ms: seen ? seen.p50Ms : 0,
      p50: durationLabel(seen ? seen.p50Ms : 0),
      p95: durationLabel(seen ? seen.p95Ms : 0),
      ran: Boolean(seen),
      // Absence is evidence only where running was possible.
      dim: !seen && !asRunCannotRun.has(item.kind || 'work'),
      lastSeen: seen ? seen.lastSeen : null,
      exits: Object.entries(taken[item.id] || {}).map(([to, count]) => ({ to, count }))
        .sort((a, b) => b.count - a.count || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0)),
    };
  }
  const edges = [];
  for (const [from, row] of Object.entries(summary.handoffs || {})) for (const [to, count] of Object.entries(row)) edges.push({ from, to, count });
  const busiest = Math.max(1, ...edges.map(edge => edge.count));
  for (const edge of edges) edge.weight = 1 + Math.round(3 * edge.count / busiest);
  edges.sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  const drift = summary.drift || {};
  const known = new Map(jobs.map(item => [item.id, item]));
  const window = summary.window || {};
  const days = Number(summary.days) || Math.max(1, Math.round((Date.parse(window.to) - Date.parse(window.from)) / 86400000)) || 7;
  const scanned = Number(summary.scanned) || 0;
  return {
    window, days, scanned, truncated: Boolean(summary.truncated), cases: Number(summary.cases) || 0,
    legend: days + (days === 1 ? ' day' : ' days') + ' · scanned ' + scanned + ' · ' + (summary.truncated ? 'truncated' : 'complete'),
    nodes, edges,
    drift: {
      unknownJobs: Object.entries(drift.unknownJobs || {}).map(([jobId, count]) => ({ jobId, count }))
        .sort((a, b) => b.count - a.count || (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0)),
      // A task is not instrumented separately, and work that cannot run is not missing.
      neverRan: (drift.neverRan || []).map(id => known.get(id))
        .filter(item => item && !item.parent && !asRunCannotRun.has(item.kind || 'work'))
        .map(item => ({ jobId: item.id, name: item.name || item.id })),
    },
  };
}

/** The window's cases, newest first: at most twenty, each with what it cost. */
function caseListFrom(aggregate) {
  const rows = (aggregate && aggregate.recentCases) || [];
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && typeof row.caseId === 'string')
    .map(row => ({ caseId: row.caseId, startTime: row.startTime, steps: Number(row.steps) || 0, failures: Number(row.failures) || 0, totalMs: Number(row.totalMs) || 0, duration: durationLabel(row.totalMs) }))
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
    .slice(0, 20);
}

/** What a refused read says. On staves.io the keys live in the account, so a refusal fixed there
 * ("no keys", "another project") carries the way to Account — a link this page owns, never one the
 * response names. */
function asRunProblem(payload, fallback) {
  const said = payload && typeof payload.error === 'string' && payload.error ? payload.error : fallback;
  return { message: said, account: Boolean(payload && payload.account === '/workspace#account') };
}

/* The mode: one window fetched on demand, painted over the canvas and explained in a panel. */
const asRun = { open: false, board: null, days: 7, overlay: null, cases: [], error: '', errorAccount: false, loading: false, request: 0, caseId: null, replay: null, status: '', asked: new Set() };
const asRunPanel = document.createElement('section');
asRunPanel.id = 'as-run-panel'; asRunPanel.hidden = true; asRunPanel.setAttribute('aria-labelledby', 'as-run-title');
document.body.append(asRunPanel);
const asRunLegend = document.createElement('div');
asRunLegend.id = 'as-run-legend'; asRunLegend.hidden = true; asRunLegend.setAttribute('role', 'status');
$('#tl').append(asRunLegend);

function asRunModeSelect() { return document.getElementById('canvas-mode'); }

function paintAsRunBody() {
  for (const [name, on] of Object.entries(overlayClasses(asRun))) document.body.classList.toggle(name, on);
}

function openAsRun() {
  if (!state.board) { toast('Open a board before reading its runs.'); return; }
  if (typeof closeRehearsal === 'function' && !asRun.open) closeRehearsal();
  asRun.open = true; asRun.board = state.name; asRun.caseId = null; asRun.replay = null; asRun.status = ''; asRun.asked = new Set();
  paintAsRunBody();
  const select = asRunModeSelect(); if (select) select.value = 'runs';
  renderAsRun();
  loadAsRun();
}

function closeAsRun() {
  if (!asRun.open) return;
  asRun.open = false; asRun.request++; asRun.overlay = null; asRun.cases = []; asRun.error = ''; asRun.errorAccount = false; asRun.caseId = null; asRun.replay = null; asRun.loading = false; asRun.asked = new Set();
  paintAsRunBody();
  asRunPanel.hidden = true; asRunLegend.hidden = true;
  unpaintAsRun();
  const select = asRunModeSelect(); if (select && select.value === 'runs') select.value = 'design';
}

async function loadAsRun() {
  const request = ++asRun.request, board = asRun.board;
  asRun.loading = true; asRun.error = ''; asRun.errorAccount = false; asRun.overlay = null; asRun.cases = []; asRun.caseId = null; asRun.replay = null;
  renderAsRun();
  try {
    const response = await fetch('./langfuse-runs?board=' + encodeURIComponent(board) + '&days=' + asRun.days, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => ({}));
    if (request !== asRun.request || !asRun.open) return;
    // The server says what is missing — keys, a connection, or a project the account's keys do not reach.
    if (!response.ok) { const problem = asRunProblem(payload, 'Could not read runs for this board.'); asRun.errorAccount = problem.account; throw new Error(problem.message); }
    asRun.overlay = runOverlay(payload, state.board);
    asRun.cases = caseListFrom(payload);
  } catch (error) {
    if (request !== asRun.request || !asRun.open) return;
    asRun.error = error.message || 'Could not read runs for this board.';
  } finally {
    if (request === asRun.request) { asRun.loading = false; renderAsRun(); paintAsRun(); }
  }
}

async function replayAsRunCase(caseId) {
  const request = ++asRun.request;
  asRun.caseId = caseId; asRun.replay = null; asRun.status = 'Reading this case…';
  renderAsRun();
  try {
    const response = await fetch('./langfuse-run?board=' + encodeURIComponent(asRun.board) + '&case=' + encodeURIComponent(caseId) + '&days=' + asRun.days, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => ({}));
    if (request !== asRun.request || !asRun.open) return;
    if (!response.ok) throw new Error(payload.error || 'Could not read this case.');
    asRun.replay = payload; asRun.status = '';
  } catch (error) {
    if (request !== asRun.request || !asRun.open) return;
    asRun.status = error.message || 'Could not read this case.';
  } finally { if (request === asRun.request) { renderAsRun(); paintAsRun(); } }
}

function unpaintAsRun() {
  $$('.clip[data-job]').forEach(clip => {
    clip.classList.remove('as-run-dim', 'as-run-step', 'as-run-failed');
    clip.querySelector('.as-run-badge')?.remove();
  });
  $$('.wires .w').forEach(path => { path.classList.remove('as-run-wire'); path.style.strokeWidth = ''; });
}

function paintAsRun() {
  unpaintAsRun();
  paintAsRunBody();
  if (!asRun.open || !asRun.overlay) return;
  const overlay = asRun.overlay;
  const path = asRun.replay ? asRun.replay.steps.map(step => step.jobId) : [];
  $$('.clip[data-job]').forEach(clip => {
    const node = overlay.nodes[clip.dataset.job];
    if (!node) return;
    clip.classList.toggle('as-run-dim', node.dim);
    clip.classList.toggle('as-run-failed', node.failures > 0);
    clip.classList.toggle('as-run-step', path.includes(clip.dataset.job));
    const badge = document.createElement('div');
    badge.className = 'as-run-badge';
    const runs = document.createElement('span');
    runs.className = 'as-run-count';
    runs.textContent = node.ran ? node.runs + '×' : 'no runs';
    badge.append(runs);
    if (node.ran) { const p50 = document.createElement('span'); p50.className = 'as-run-p50'; p50.textContent = 'p50 ' + node.p50; badge.append(p50); }
    if (node.failures > 0) { const failed = document.createElement('span'); failed.className = 'as-run-failure'; failed.textContent = node.failures + ' failed'; badge.append(failed); }
    for (const exit of node.exits) {
      const chip = document.createElement('span');
      chip.className = 'as-run-exit';
      chip.textContent = exit.to + ' ' + exit.count;
      badge.append(chip);
    }
    badge.title = node.ran
      ? node.runs + ' runs in this window · p50 ' + node.p50 + ' · p95 ' + node.p95 + (node.failures ? ' · ' + node.failures + ' ended with an error' : '') + (node.lastSeen ? ' · last ' + node.lastSeen : '')
      : 'No observation named this job in this window. That is not proof it did not run.';
    clip.append(badge);
  });
  $$('.wires .w').forEach(wire => {
    const edge = overlay.edges.find(item => item.from === wire.dataset.from && item.to === wire.dataset.to);
    wire.classList.toggle('as-run-wire', Boolean(edge));
    wire.style.strokeWidth = edge ? edge.weight + 'px' : '';
  });
}

function asRunWindowPicker() {
  const picker = document.createElement('div');
  picker.className = 'as-run-window'; picker.setAttribute('role', 'group'); picker.setAttribute('aria-label', 'Window');
  for (const days of [1, 7, 30]) {
    const button = document.createElement('button');
    button.className = 'bt q'; button.type = 'button'; button.textContent = days + 'd';
    button.setAttribute('aria-pressed', String(asRun.days === days));
    button.title = 'Read the last ' + days + (days === 1 ? ' day' : ' days');
    button.onclick = () => { if (asRun.days === days) return; asRun.days = days; loadAsRun(); };
    picker.append(button);
  }
  return picker;
}

function asRunDriftItem(kind, item) {
  const row = document.createElement('li');
  const label = document.createElement('div');
  label.className = 'as-run-drift-label';
  const title = document.createElement('b');
  title.textContent = kind === 'unknown' ? item.jobId : item.name;
  const detail = document.createElement('small');
  detail.textContent = kind === 'unknown' ? item.count + ' observations name this id; the board has no such job' : 'no observation named this job in this window';
  label.append(title, detail);
  const id = asRunQuestionId(kind, item.jobId);
  const ask = document.createElement('button');
  ask.className = 'bt q'; ask.type = 'button';
  ask.textContent = asRun.asked.has(id) ? 'Asked' : 'Ask about this';
  ask.disabled = asRun.asked.has(id);
  ask.onclick = async () => {
    ask.disabled = true;
    try {
      const text = kind === 'unknown'
        ? '[As run] Observations name the job id "' + item.jobId + '" ' + item.count + ' times in the last ' + asRun.days + (asRun.days === 1 ? ' day' : ' days') + ', and this board has no job with that id. Has the work been renamed or moved, or is the instrumentation wrong?'
        : '[As run] "' + item.name + '" did not appear in any observation in the last ' + asRun.days + (asRun.days === 1 ? ' day' : ' days') + ' (' + asRun.overlay.scanned + ' scanned). Is it still part of this workflow, or is it simply not instrumented?';
      await checkedOp([{ t: 'ask', question: { id, ...(kind === 'unknown' ? {} : { about: item.jobId }), askedBy: 'human', text, status: 'raised', at: new Date().toISOString() } }]);
      asRun.asked.add(id);
      asRun.status = 'Question raised for review.';
    } catch (error) { asRun.status = error.message || 'Could not raise this question.'; ask.disabled = false; }
    renderAsRun();
  };
  row.append(label, ask);
  return row;
}

function renderAsRun() {
  paintAsRunBody();
  if (!asRun.open) { asRunPanel.hidden = true; asRunLegend.hidden = true; return; }
  asRunPanel.hidden = false;
  asRunPanel.replaceChildren();
  const header = document.createElement('header');
  const heading = document.createElement('span');
  heading.id = 'as-run-title'; heading.className = 'as-run-label'; heading.textContent = 'Runs';
  const grow = document.createElement('span'); grow.className = 'grow';
  const close = eb('Close As run', 'close', closeAsRun); close.classList.add('ib');
  header.append(heading, asRunWindowPicker(), grow, close);
  asRunPanel.append(header);

  const note = document.createElement('p');
  note.className = 'as-run-note';
  note.textContent = 'What the running system reported. It does not say a job is implemented as designed, or approved.';
  asRunPanel.append(note);

  if (asRun.loading) { const loading = document.createElement('p'); loading.className = 'as-run-message'; loading.setAttribute('role', 'status'); loading.textContent = 'Reading the last ' + asRun.days + (asRun.days === 1 ? ' day' : ' days') + '…'; asRunPanel.append(loading); }
  if (asRun.error) {
    const problem = document.createElement('p');
    problem.className = 'as-run-message as-run-error'; problem.setAttribute('role', 'alert');
    problem.textContent = asRun.error;
    if (asRun.errorAccount) { const account = document.createElement('a'); account.className = 'as-run-account'; account.href = './workspace#account'; account.textContent = 'Open Account'; problem.append(' ', account); }
    const retry = document.createElement('button'); retry.className = 'bt q'; retry.type = 'button'; retry.textContent = 'Try again'; retry.onclick = loadAsRun;
    problem.append(' ', retry);
    asRunPanel.append(problem);
  }
  const overlay = asRun.overlay;
  if (overlay) {
    asRunLegend.hidden = false;
    asRunLegend.textContent = overlay.legend;
    asRunLegend.title = overlay.window.from ? 'From ' + overlay.window.from + ' to ' + overlay.window.to : '';
    const summary = document.createElement('p');
    summary.className = 'as-run-summary';
    summary.textContent = overlay.cases + (overlay.cases === 1 ? ' case · ' : ' cases · ') + overlay.legend;
    asRunPanel.append(summary);

    if (overlay.drift.unknownJobs.length || overlay.drift.neverRan.length) {
      const drift = document.createElement('section');
      drift.className = 'as-run-section';
      const title = document.createElement('h3'); title.textContent = 'Drift';
      const list = document.createElement('ul'); list.className = 'as-run-drift';
      for (const item of overlay.drift.unknownJobs) list.append(asRunDriftItem('unknown', item));
      drift.append(title, list);
      const silent = overlay.drift.neverRan;
      if (silent.length) {
        const quiet = document.createElement('ul'); quiet.className = 'as-run-drift';
        for (const item of silent) quiet.append(asRunDriftItem('never', item));
        // A long silence is one fact, not twenty: it opens when someone wants the names.
        if (silent.length > 4) {
          const more = document.createElement('details'); more.className = 'as-run-more';
          const summary = document.createElement('summary');
          summary.textContent = silent.length + ' jobs ran not once in this window';
          more.append(summary, quiet);
          drift.append(more);
        } else drift.append(quiet);
      }
      asRunPanel.append(drift);
    }

    const cases = document.createElement('section');
    cases.className = 'as-run-section';
    const casesTitle = document.createElement('h3');
    casesTitle.textContent = asRun.cases.length ? 'Recent cases' : 'No cases in this window';
    cases.append(casesTitle);
    const list = document.createElement('ul'); list.className = 'as-run-cases';
    for (const item of asRun.cases) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'bt q as-run-case'; button.type = 'button';
      button.setAttribute('aria-pressed', String(asRun.caseId === item.caseId));
      const when = document.createElement('b'); when.textContent = new Date(item.startTime).toLocaleString();
      const detail = document.createElement('small');
      detail.textContent = item.steps + (item.steps === 1 ? ' step · ' : ' steps · ') + item.duration + (item.failures ? ' · ' + item.failures + ' failed' : '');
      button.append(when, detail);
      button.title = item.caseId;
      button.onclick = () => asRun.caseId === item.caseId ? (asRun.caseId = null, asRun.replay = null, renderAsRun(), paintAsRun()) : replayAsRunCase(item.caseId);
      row.append(button);
      if (asRun.caseId === item.caseId && asRun.replay) {
        const path = document.createElement('ol');
        path.className = 'as-run-path';
        for (const step of asRun.replay.steps) {
          const stepRow = document.createElement('li');
          stepRow.textContent = (step.known ? (job(step.jobId)?.name || step.jobId) : step.jobId) + ' · ' + durationLabel(step.latencyMs) + (step.exitId ? ' → ' + step.exitId : '') + (step.level === 'ERROR' ? ' · error' : '') + (step.known ? '' : ' · not on this board');
          if (!step.known) stepRow.className = 'as-run-unknown-step';
          path.append(stepRow);
        }
        const total = document.createElement('p');
        total.className = 'as-run-total';
        total.textContent = 'Total ' + durationLabel(asRun.replay.totalMs) + ' · ' + asRun.replay.steps.length + ' steps' + (asRun.replay.failures ? ' · ' + asRun.replay.failures + ' failed' : '');
        row.append(total, path);
      }
      list.append(row);
    }
    cases.append(list);
    asRunPanel.append(cases);
  } else { asRunLegend.hidden = true; }
  if (asRun.status) { const status = document.createElement('p'); status.className = 'as-run-message'; status.setAttribute('role', 'status'); status.textContent = asRun.status; asRunPanel.append(status); }
}

const asRunTimeline = timeline;
timeline = function () { asRunTimeline(); if (asRun.open) requestAnimationFrame(() => requestAnimationFrame(paintAsRun)); };
const asRunRender = render;
render = function () { asRunRender(); if (asRun.open && asRun.board !== state.name) closeAsRun(); };
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !asRun.open || event.defaultPrevented) return;
  if (event.target.closest?.('input,textarea,select,button,[contenteditable],[role=dialog]')) return;
  if ($('#veil')?.classList.contains('show')) return;
  closeAsRun();
});
