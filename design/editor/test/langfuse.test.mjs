import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../langfuse.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL, render() {}, paintWorkEditor() {} });
vm.runInContext(source, context);
test('Langfuse public connection accepts cloud, self-hosted origins and localhost', () => {
  for (const baseUrl of ['https://cloud.langfuse.com', 'https://example.org', 'http://localhost:3000', 'http://127.0.0.1:3000']) {
    assert.equal(context.langfuseConnection({baseUrl, projectId:'project-1'}).baseUrl, baseUrl);
  }
});
test('Langfuse public connection rejects executable URLs, credentials and ambiguous IDs', () => {
  for (const baseUrl of ['https://example.org/langfuse', 'javascript:alert(1)', 'http://example.org', 'https://secret@example.org', 'https://example.org?key=secret', 'https://example.org#key', 'file:///tmp/a']) {
    assert.equal(context.langfuseConnection({baseUrl, projectId:'project-1'}), null);
  }
  for (const projectId of ['../admin', 'project/trace', '<script>', 'a?b', '']) {
    assert.equal(context.langfuseConnection({baseUrl:'https://cloud.langfuse.com', projectId}), null);
  }
});

function evidencePanel({ connected = false, evidence = [] } = {}) {
  const node = () => ({
    textContent: '', children: [],
    append(...children) { this.children.push(...children); },
    setAttribute() {},
  });
  const sidebar = node();
  const item = { id: 'review', name: 'Review request', executionEvidence: evidence };
  const context = vm.createContext({
    URL, render() {}, paintWorkEditor() {},
    state: { board: { context: connected ? { langfuse: { baseUrl: 'https://cloud.langfuse.com', projectId: 'project-1' } } : {}, jobs: [item] }, sel: item.id },
    job: () => item,
    eb: label => Object.assign(node(), { textContent: label }),
    document: { createElement: node, getElementById: id => id === 'sb' ? sidebar : null, querySelector: () => null },
  });
  vm.runInContext(source, context);
  context.paintLangfuse();
  const text = element => [element.textContent, element.href ?? "", ...element.children.map(text)].join(' ');
  return text(sidebar);
}

test('a saved reference with nothing fetched is connected but unverified', () => {
  const text = evidencePanel({ connected: true });
  assert.match(text, /Connected · access not verified/);
  assert.match(text, /staves_langfuse_probe/);
  assert.match(text, /does not independently verify the source or check current access/);
  assert.match(text, /No execution evidence linked/);
  assert.match(text, /does not mean the job has not run/);
});

test('once evidence has been fetched the reference is described without claiming it fetches', () => {
  const text = evidencePanel({ connected: true, evidence: [{ provider: 'langfuse', projectId: 'project-1', traceId: 'trace-1' }] });
  assert.match(text, /Project reference saved/);
  assert.match(text, /does not fetch evidence/);
  assert.doesNotMatch(text, /access not verified/);
});

test('missing reference and attached evidence remain distinct states', () => {
  const missing = evidencePanel();
  assert.match(missing, /staves_langfuse_connect/);
  assert.match(missing, /MCP server/);
  const text = evidencePanel({ connected: true, evidence: [{ provider: 'langfuse', projectId: 'project-1', traceId: 'trace-1', status: 'error' }] });
  assert.match(text, /Execution error observed/);
  assert.match(text, /Open trace in Langfuse/);
  assert.match(text, /do not establish that this job achieved its outcome/);
  assert.doesNotMatch(text, /No execution evidence linked/);
});


test('historical links retain their captured origin and retractions retain provenance', () => {
  const text = evidencePanel({ connected: true, evidence: [{
    provider: 'langfuse', baseUrl: 'https://original.example', projectId: 'old-project', traceId: 'trace-1',
    fetchedAt: '2026-09-14T11:00:00Z', fetchedBy: 'agent:codex', status: 'observed',
    mapping: {method: 'reviewed', reviewedBy: 'human:J'},
    retraction: {by: 'human:J', reason: 'Wrong association'},
  }] });
  assert.match(text, /https:\/\/original.example\/project\/old-project\/traces\/trace-1/);
  assert.match(text, /Reference retracted/);
  assert.match(text, /Fetched 2026-09-14T11:00:00Z by agent:codex/);
  assert.match(text, /Association reviewed by human:J/);
  assert.match(text, /Wrong association/);
  assert.doesNotMatch(text, /Retract reference/);
});

// On staves.io the account holds keys per Langfuse project. A board with no connection is offered each
// project by name, whether or not a job is selected; with none saved, it is pointed at Account → Runs.
const projectOne = { projectId: 'project-1', projectName: 'Vendor onboarding', baseUrl: 'https://cloud.langfuse.com', label: 'vendor', publicKeyHint: 'pk-lf-…6666', verifiedAt: '2026-09-16T10:00:00.000Z', boards: [] };
const account = { configured: true, projects: [projectOne, { ...projectOne, projectId: 'project-2', projectName: null }] };
test('a board with no connection is offered each Langfuse project the account has keys for', () => {
  const offers = (board, settings) => JSON.parse(JSON.stringify(context.langfuseAccountOffers(board, settings)));
  assert.deepEqual(offers({ context: {}, jobs: [] }, account), { kind: 'projects', offers: [
    { label: 'Show runs from Vendor onboarding', projectId: 'project-1' }, { label: 'Show runs from project-2', projectId: 'project-2' },
  ] });
  assert.equal(offers({ context: {}, jobs: [] }, { configured: true, projects: [{ ...projectOne, projectName: 'x'.repeat(90) }] }).offers[0].label.length, 'Show runs from '.length + 60);
  assert.deepEqual(offers({ context: {}, jobs: [] }, { configured: true, projects: [] }), { kind: 'keys', text: 'Add Langfuse keys under Account → Runs', href: './workspace#account' });
  assert.deepEqual(offers({ context: {}, jobs: [] }, { configured: true, projects: [{ ...projectOne, baseUrl: 'javascript:alert(1)' }, projectOne] }).offers.map(o => o.projectId), ['project-1'], 'an unusable project is skipped, not offered');
  for (const [board, settings] of [
    [{ context: { langfuse: { baseUrl: 'https://cloud.langfuse.com', projectId: 'project-2' } }, jobs: [] }, account],
    [{ context: {}, jobs: [] }, { configured: false, projects: [] }],
    [{ context: {}, jobs: [] }, null],
    [{ context: {}, jobs: [] }, { configured: true, baseUrl: 'https://cloud.langfuse.com', projectId: 'project-1' }],
    [{ context: {}, jobs: [] }, { error: 'Storing Langfuse keys is not configured on this service.' }],
    [{ context: {}, jobs: [] }, { configured: true, projects: [{ ...projectOne, projectId: '../admin' }] }],
    [{ context: {}, jobs: [{ id: 'j', executionEvidence: [{ provider: 'langfuse' }] }] }, account],
    [null, account],
  ]) assert.equal(context.langfuseAccountOffers(board, settings), null, JSON.stringify([board, settings]));
});

function hostedBoard({ settings, selected = null, answer = [200, { board: 'flow', projectId: 'project-1' }] }) {
  const node = tag => ({ tag, textContent: '', children: [], dataset: {}, append(...children) { this.children.push(...children); }, setAttribute() {}, remove() { this.removed = true; } });
  const header = node('div'), buttons = [], requests = [], toasts = [];
  let loads = 0, offer = null;
  const hosted = vm.createContext({
    URL, render() {}, paintWorkEditor() {},
    state: { name: 'flow', board: { context: {}, jobs: [] }, sel: selected },
    job: () => null,
    eb: (label, icon, handler) => { const button = Object.assign(node('button'), { textContent: label, onclick: handler }); buttons.push(button); return button; },
    load: async () => { loads++; }, toast: text => toasts.push(text),
    AbortSignal,
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
      const [status, body] = url === '/workspace-api/langfuse' ? [200, settings] : answer;
      return { ok: status < 400, status, json: async () => body };
    },
    document: {
      createElement: tag => { const made = node(tag); if (tag === 'span') offer = made; return made; },
      getElementById: id => (id === 'langfuse-account-offer' ? offer : null),
      querySelector: selector => (selector === 'meta[name="staves-account"]' ? {} : selector === '#tl > .ph' ? header : null),
    },
  });
  vm.runInContext(source, hosted);
  return { hosted, header, buttons, requests, toasts, get loads() { return loads; }, get offer() { return offer; } };
}

test('the offer shows with no job selected, and choosing a project asks the server to attach it', async () => {
  const view = hostedBoard({ settings: account });
  view.hosted.paintLangfuse();
  await new Promise(resolve => setImmediate(resolve));
  const connect = view.buttons.find(button => button.textContent === 'Show runs from Vendor onboarding');
  assert.ok(connect, 'painted without a selected job');
  assert.ok(view.header.children.includes(view.offer), 'in the timeline header');
  await connect.onclick();
  assert.deepEqual(view.requests.at(-1), { url: '/workspace-api/board-langfuse', method: 'POST', body: { board: 'flow', projectId: 'project-1' } });
  assert.equal(view.loads, 1, 'the board reloads to pick up its new connection');
  const refused = hostedBoard({ settings: account, answer: [400, { error: 'No Langfuse keys for that project.' }] });
  refused.hosted.paintLangfuse();
  await new Promise(resolve => setImmediate(resolve));
  const again = refused.buttons.find(button => button.textContent === 'Show runs from Vendor onboarding');
  await again.onclick();
  assert.deepEqual(refused.toasts, ['No Langfuse keys for that project.']);
  assert.equal(again.disabled, false);
  assert.equal(refused.loads, 0);
});

test('with no keys saved the board points at Account → Runs instead', async () => {
  const view = hostedBoard({ settings: { configured: true, projects: [] } });
  view.hosted.paintLangfuse();
  await new Promise(resolve => setImmediate(resolve));
  const link = view.offer.children[0];
  assert.equal(link.tag, 'a'); assert.equal(link.href, './workspace#account'); assert.equal(link.textContent, 'Add Langfuse keys under Account → Runs');
  assert.ok(!view.buttons.some(button => /^Show runs from/.test(button.textContent)));
});

test('a local board never asks the hosted account for keys', () => {
  let asked = false;
  const node = () => ({ textContent: '', children: [], append(...children) { this.children.push(...children); }, setAttribute() {} });
  const item = { id: 'review', name: 'Review request', executionEvidence: [] };
  const local = vm.createContext({
    URL, render() {}, paintWorkEditor() {}, state: { board: { context: {}, jobs: [item] }, sel: item.id }, job: () => item,
    eb: label => Object.assign(node(), { textContent: label }), fetch: async () => { asked = true; return { ok: false }; },
    AbortSignal, document: { createElement: node, getElementById: id => id === 'sb' ? node() : null, querySelector: () => null },
  });
  vm.runInContext(source, local);
  local.paintLangfuse();
  assert.equal(asked, false);
});

test('Board options offers the account projects by name, and hands manual entry to the reference sheet', async () => {
  const view = hostedBoard({ settings: account });
  const sheets = [];let manual = 0, closed = 0;
  view.hosted.sheet = (title, fields, onDone) => sheets.push({ title, fields, onDone });
  view.hosted.closeSheet = () => { closed++; };
  view.hosted.editLangfuseConnection = note => { manual++; view.hosted.lastNote = note; };
  view.hosted.paintLangfuse();
  await new Promise(resolve => setImmediate(resolve));
  view.hosted.chooseLangfuseProject();
  assert.equal(sheets.length, 1, 'one sheet, not a header button');
  const [field] = sheets[0].fields;
  assert.equal(JSON.stringify(field[5].map(option => [option[0], option[2]])), JSON.stringify([['project-1', 'Vendor onboarding'], ['project-2', 'project-2'], ['manual', 'Enter a project reference by hand']]));
  await sheets[0].onDone({ project: 'project-1' });
  assert.equal(JSON.stringify(view.requests.at(-1)), JSON.stringify({ url: '/workspace-api/board-langfuse', method: 'POST', body: { board: 'flow', projectId: 'project-1' } }));
  assert.equal(view.loads, 1);
  await sheets[0].onDone({ project: 'manual' });
  assert.equal(manual, 1);assert.equal(closed, 1, 'the choice closes before the reference sheet opens');
});

test('with no keys saved the menu opens the reference sheet and says where keys live', async () => {
  const view = hostedBoard({ settings: { configured: true, projects: [] } });
  let note;
  view.hosted.editLangfuseConnection = value => { note = value; };
  view.hosted.paintLangfuse();
  await new Promise(resolve => setImmediate(resolve));
  view.hosted.chooseLangfuseProject();
  assert.match(note, /Account → Runs/);
  const local = hostedBoard({ settings: null });
  local.hosted.editLangfuseConnection = value => { note = value; };
  local.hosted.chooseLangfuseProject();
  assert.equal(note, null, 'nothing to say about an account this service does not have');
});
