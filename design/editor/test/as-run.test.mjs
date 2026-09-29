import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../as-run.js', import.meta.url), 'utf8');
const context = vm.createContext({});
// The paint values are arithmetic over one window; everything below the marker touches the page.
vm.runInContext(source.slice(0, source.indexOf('/* The mode:')), context);
// The helpers run in their own realm; compare what they produced, not which realm produced it.
const plain = value => JSON.parse(JSON.stringify(value));
const runOverlay = (aggregate, board) => plain(context.runOverlay(aggregate, board));
const caseListFrom = aggregate => plain(context.caseListFrom(aggregate));

const board = {
  jobs: [
    { id: 'submit', name: 'Request a new vendor', inputs: [], outputs: [] },
    { id: 'check', name: 'Check the intake packet', inputs: [], outputs: [] },
    { id: 'approve', name: 'Approve activation', inputs: [], outputs: [] },
    { id: 'notify', name: 'Tell the business owner', inputs: [], outputs: [] },
    { id: 'register', name: 'Vendor register', kind: 'store', inputs: [], outputs: [] },
    { id: 'security-queue', name: 'Await security capacity', kind: 'queue', inputs: [], outputs: [] },
    { id: 'renewal-watch', name: 'Renewal follow-up', kind: 'ghost', inputs: [], outputs: [] },
    { id: 'supply', name: 'Supply evidence', kind: 'outside', inputs: [], outputs: [] },
    { id: 'watch-payment', name: 'Watch the first payment', kind: 'watch', inputs: [], outputs: [] },
    { id: 'extract-fields', name: 'Extract required fields', parent: 'check', inputs: [], outputs: [] },
    { id: 'gone', name: 'Removed job', removed: true, inputs: [], outputs: [] },
  ],
};
const aggregate = {
  window: { from: '2026-09-08T10:00:00.000Z', to: '2026-09-15T10:00:00.000Z' },
  days: 7, scanned: 35, truncated: false, cases: 6,
  jobs: {
    submit: { runs: 6, failures: 0, p50Ms: 400, p95Ms: 800, firstSeen: '2026-09-15T09:00:00.000Z', lastSeen: '2026-09-15T09:30:00.000Z' },
    check: { runs: 8, failures: 2, p50Ms: 1500, p95Ms: 4000, firstSeen: '2026-09-15T09:00:00.000Z', lastSeen: '2026-09-15T09:31:00.000Z' },
    approve: { runs: 2, failures: 0, p50Ms: 60_000, p95Ms: 90_000, firstSeen: '2026-09-15T09:00:00.000Z', lastSeen: '2026-09-15T09:20:00.000Z' },
  },
  exits: { check: { assemble: 6, 'ask-missing': 2 } },
  handoffs: { submit: { check: 6 }, check: { approve: 2 } },
  drift: { unknownJobs: { assemble: 6, tell: 6 }, neverRan: ['notify', 'register', 'security-queue', 'renewal-watch', 'supply', 'watch-payment', 'extract-fields'] },
  recentCases: [
    { caseId: 'case-2', startTime: '2026-09-15T08:00:00.000Z', endTime: '2026-09-15T08:00:03.000Z', steps: 5, failures: 1, totalMs: 3000 },
    { caseId: 'case-1', startTime: '2026-09-15T09:00:00.000Z', endTime: '2026-09-15T09:00:06.500Z', steps: 4, failures: 0, totalMs: 6500 },
  ],
};

test('a job that ran carries its count and its p50; a job that never ran is dimmed', () => {
  const overlay = runOverlay(aggregate, board);
  assert.deepEqual(overlay.nodes.submit, { runs: 6, failures: 0, p50Ms: 400, p50: '400ms', p95: '800ms', ran: true, dim: false, lastSeen: '2026-09-15T09:30:00.000Z', exits: [] });
  assert.equal(overlay.nodes.check.p50, '1.5s');
  assert.equal(overlay.nodes.check.failures, 2);
  assert.equal(overlay.nodes.notify.runs, 0);
  assert.equal(overlay.nodes.notify.dim, true);
  assert.equal(overlay.nodes.gone, undefined);
});

test('work that cannot run on its own is never dimmed and never reported as drift', () => {
  const overlay = runOverlay(aggregate, board);
  for (const id of ['register', 'security-queue', 'renewal-watch', 'supply', 'watch-payment']) {
    assert.equal(overlay.nodes[id].ran, false, id);
    assert.equal(overlay.nodes[id].dim, false, id);
  }
  assert.deepEqual(overlay.drift.neverRan, [{ jobId: 'notify', name: 'Tell the business owner' }]);
});

test('drift names both directions with the counts behind it', () => {
  const overlay = runOverlay(aggregate, board);
  assert.deepEqual(overlay.drift.unknownJobs, [{ jobId: 'assemble', count: 6 }, { jobId: 'tell', count: 6 }]);
});

test('an exit is counted per destination, most taken first', () => {
  const overlay = runOverlay(aggregate, board);
  assert.deepEqual(overlay.nodes.check.exits, [{ to: 'assemble', count: 6 }, { to: 'ask-missing', count: 2 }]);
});

test('a handoff taken more often is drawn heavier, against the busiest in the window', () => {
  const overlay = runOverlay(aggregate, board);
  assert.deepEqual(overlay.edges, [{ from: 'submit', to: 'check', count: 6, weight: 4 }, { from: 'check', to: 'approve', count: 2, weight: 2 }]);
});

test('the legend carries the window and the bound of the scan', () => {
  assert.equal(runOverlay(aggregate, board).legend, '7 days · scanned 35 · complete');
  assert.equal(runOverlay({ ...aggregate, days: 1, truncated: true }, board).legend, '1 day · scanned 35 · truncated');
});

test('the case list is newest first and says what each case cost', () => {
  const cases = caseListFrom(aggregate);
  assert.deepEqual(cases.map(item => item.caseId), ['case-1', 'case-2']);
  assert.deepEqual(cases[0], { caseId: 'case-1', startTime: '2026-09-15T09:00:00.000Z', steps: 4, failures: 0, totalMs: 6500, duration: '6.5s' });
  assert.equal(cases[1].failures, 1);
});

test('at most twenty cases are offered, and an empty window offers none', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ caseId: 'case-' + index, startTime: new Date(Date.parse('2026-09-15T09:00:00.000Z') + index * 1000).toISOString(), endTime: '2026-09-15T10:00:00.000Z', steps: 1, failures: 0, totalMs: 1000 }));
  assert.equal(caseListFrom({ ...aggregate, recentCases: many }).length, 20);
  assert.equal(caseListFrom({ ...aggregate, recentCases: many })[0].caseId, 'case-29');
  assert.deepEqual(caseListFrom({}), []);
  assert.deepEqual(caseListFrom(null), []);
});

test('an empty window paints nothing and still says what it covered', () => {
  const empty = { window: aggregate.window, days: 30, scanned: 0, truncated: false, cases: 0, jobs: {}, exits: {}, handoffs: {}, drift: { unknownJobs: {}, neverRan: [] } };
  const overlay = runOverlay(empty, board);
  assert.deepEqual(overlay.edges, []);
  assert.equal(overlay.legend, '30 days · scanned 0 · complete');
  assert.equal(overlay.nodes.submit.runs, 0);
  assert.deepEqual(overlay.drift.neverRan, []);
});

test('durations are read as a person says them', () => {
  assert.equal(context.durationLabel(0), '0ms');
  assert.equal(context.durationLabel(940), '940ms');
  assert.equal(context.durationLabel(1500), '1.5s');
  assert.equal(context.durationLabel(59_400), '59.4s');
  assert.equal(context.durationLabel(200_000), '3m 20s');
});

test('the board is dimmed only once a window has actually arrived', () => {
  const classes = state => plain(context.overlayClasses(state));
  assert.deepEqual(classes({ open: false, overlay: null, error: '' }), { 'as-run-open': false, 'as-run-painted': false });
  // Opened, still fetching: nothing is dimmed behind a panel that has no numbers yet.
  assert.deepEqual(classes({ open: true, overlay: null, error: '', loading: true }), { 'as-run-open': true, 'as-run-painted': false });
  // Refused, hosted or keyless: the message is the whole of it.
  assert.deepEqual(classes({ open: true, overlay: null, error: 'As run needs Langfuse keys on this machine.' }), { 'as-run-open': true, 'as-run-painted': false });
  assert.deepEqual(classes({ open: true, overlay: { nodes: {} }, error: '' }), { 'as-run-open': true, 'as-run-painted': true });
  assert.deepEqual(classes(null), { 'as-run-open': false, 'as-run-painted': false });
});

test('one drift row asks one question, however often it is clicked', () => {
  assert.equal(context.asRunQuestionId('unknown', 'assemble'), 'as-run-unknown-assemble');
  assert.equal(context.asRunQuestionId('never', 'notify'), 'as-run-never-notify');
  // Two rows about different things stay two questions; the same row stays one.
  assert.notEqual(context.asRunQuestionId('unknown', 'assemble'), context.asRunQuestionId('never', 'assemble'));
  assert.equal(context.asRunQuestionId('unknown', 'assemble'), context.asRunQuestionId('unknown', 'assemble'));
});

// On staves.io the keys live in the account, so the refusals a person fixes there carry the way to it.
test('a refusal the account can fix links to Account; any other says only what went wrong', () => {
  const problem = (payload, fallback) => plain(context.asRunProblem(payload, fallback));
  const mismatch = "This board's Langfuse project does not match the keys in your account. Update them under Account → Langfuse.";
  assert.deepEqual(problem({ error: mismatch, account: '/workspace#account' }, 'Could not read runs.'), { message: mismatch, account: true });
  assert.deepEqual(problem({ error: 'Langfuse request failed (HTTP 500)' }, 'Could not read runs.'), { message: 'Langfuse request failed (HTTP 500)', account: false });
  assert.deepEqual(problem({}, 'Could not read runs.'), { message: 'Could not read runs.', account: false });
  assert.deepEqual(problem(null, 'Could not read runs.'), { message: 'Could not read runs.', account: false });
  // The link is the page's own; a payload never chooses where it goes.
  assert.deepEqual(problem({ error: 'x', account: 'https://evil.example' }, 'y'), { message: 'x', account: false });
});
