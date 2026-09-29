// On a phone Staves is the marketing site, the documentation, and one board reached by a shared link.
// The board list went away: it offered a workspace nobody can work in. These cover the two pure parts —
// which of the two pages a URL gets, and what the board page may claim about queued requests — plus the
// desktop state the companion must not damage when the viewport narrows and widens again.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../mobile.js', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert.ok(start >= 0, name + ' must be defined in mobile.js');
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const braceStart = source.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

function load(names, extra = {}) {
  const context = vm.createContext({ escape, URL, desktopNotice: () => '<aside class="mobile-desktop"></aside>', ...extra });
  vm.runInContext(names.map(extractFunction).join('\n'), context);
  return context;
}

const { phoneRoute: route } = load(['phoneRoute']);
// vm objects carry the sandbox's own prototype, so the fields are compared rather than the object.
const phoneRoute = href => ({ ...route(href) });
const { statusBlock } = load(['statusBlock']);

test('a shared board link is the one thing a phone renders in full', () => {
  assert.deepEqual({ ...phoneRoute('https://staves.io/?board=node-stress') }, { view: 'board', board: 'node-stress' });
  assert.deepEqual({ ...phoneRoute('/?board=node-stress#anything') }, { view: 'board', board: 'node-stress' });
});

test('every workspace route on a phone is the desktop-only page', () => {
  for (const href of ['/workspace', '/workspace#boards', '/workspace#examples', '/workspace#account', '/', '/?review=1']) {
    assert.deepEqual({ ...phoneRoute(href) }, { view: 'desktop' }, href + ' must not render a board list');
  }
});

test('an empty or blank board parameter is not a board', () => {
  for (const href of ['/?board=', '/?board=%20%20']) assert.deepEqual({ ...phoneRoute(href) }, { view: 'desktop' });
});

test('the desktop-only page says it is desktop-only and offers the link to get there', () => {
  const { desktopOnlyMarkup } = load(['desktopOnlyMarkup']);
  const html = desktopOnlyMarkup();
  assert.match(html, /<h1>Staves is a desktop tool<\/h1>/);
  assert.match(html, /Your boards are waiting on a computer; this link will open the same workspace there\./);
  assert.match(html, /id="mobile-copy"/);
  assert.doesNotMatch(html, /mobile-search|mobile-boards/, 'the board list is gone, not hidden');
});

const request = (id, intent, status) => ({ request: { id, intent }, delivery: { status } });

test('the status block reports each request with its id, intent and delivery state', () => {
  const html = statusBlock(['queued', 'claimed', 'running', 'completed', 'failed'].map((status, i) => request('req-' + i, 'assess', status)), []);
  for (const status of ['queued', 'claimed', 'running', 'completed', 'failed']) assert.match(html, new RegExp('>' + status + '<'));
  for (let i = 0; i < 5; i++) assert.match(html, new RegExp('req-' + i));
  assert.match(html, /assess/);
});

test('the pending proposal count is singular, plural and zero without guessing', () => {
  assert.match(statusBlock([], [{}]), /1 pending proposal\b/);
  assert.match(statusBlock([], [{}, {}]), /2 pending proposals/);
  assert.match(statusBlock([], []), /0 pending proposals/);
});

test('an inbox that could not be read is reported as unread, not as empty', () => {
  const html = statusBlock(null, null);
  assert.match(html, /could not be read/);
  assert.doesNotMatch(html, /No agent requests/);
  assert.doesNotMatch(html, /0 pending proposals/);
});

test('a board with nothing queued says so rather than showing an empty list', () => {
  const html = statusBlock([], [{}]);
  assert.match(html, /No agent requests/);
});

test('a request with no recorded delivery is queued, and one with no intent is still listed', () => {
  const html = statusBlock([{ request: { id: 'req-1' } }], []);
  assert.match(html, /queued/);
  assert.match(html, /req-1/);
});

test('the status block escapes every value it takes from the payload', () => {
  const html = statusBlock([request('<img src=x>', '<script>', '"onload')], []);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
});

function summary(board, requests) {
  const context = load(['statusBlock', 'boardMarkup']);
  return context.boardMarkup(board, requests);
}

test('phone summary distinguishes confirmed description from unknown implementation and excludes resolved questions', () => {
  const html = summary({ title: 'A workflow', jobs: [{ id: 'a', name: 'Review', track: 'team', status: 'confirmed' }, { id: 'gone', removed: true, name: 'Removed' }], tracks: [{ id: 'team', name: 'Finance' }], questions: [{ text: 'Open question' }, { text: 'Resolved question', status: 'answered' }, { text: 'Closed question', status: 'done' }] }, []);
  assert.match(html, /1 jobs and tasks · 1 roles · 1 open questions/);
  assert.match(html, /<dt>Description<\/dt><dd>confirmed<\/dd><dt>Implementation<\/dt><dd>unknown/);
  assert.match(html, /Finance/); assert.match(html, /Open question/);
  assert.doesNotMatch(html, /Removed|Resolved question|Closed question/);
});

test('phone summary escapes user content and does not expose raw conversation records', () => {
  const html = summary({ title: '<img src=x onerror=alert(1)>', goal: 'A & B', jobs: [{ name: '<script>', outcome: '<iframe>', doneWhen: ['<svg>'] }], comments: [{ text: 'Private raw transcript' }] }, []);
  assert.doesNotMatch(html, /<img|<script|<iframe|<svg|Private raw transcript/);
  assert.match(html, /&lt;img/); assert.match(html, /A &amp; B/);
});

test('the status block sits above the brief, and reads its proposal count from the board payload', () => {
  const html = summary({ title: 'A workflow', goal: 'The goal', proposalsList: [{ seq: 1 }, { seq: 2 }] }, [request('req-1', 'assess', 'running')]);
  assert.ok(html.indexOf('mobile-status') < html.indexOf('mobile-goal'), 'requests come before the brief');
  assert.match(html, /2 pending proposals/);
  assert.match(html, /running/);
});

test('the board page keeps the read-only Continue on desktop action', () => {
  assert.match(summary({ title: 'A workflow' }, []), /mobile-desktop/);
});

test('the phone companion offers nothing to interact with beyond copying a link', () => {
  for (const control of ['<textarea', 'contenteditable', 'oninput', 'onchange']) {
    assert.equal(source.includes(control), false, control + ' is editing, which a phone does not do');
  }
  assert.equal(source.includes('mobile-search'), false, 'the board search went with the board list');
});

test('narrowing keeps desktop objects and existing inert state, closing dialogs without discarding their fields', () => {
  const dialog = { tagName: 'DIALOG', inert: false, open: true, value: 'Unsent form', close() { this.open = false; } };
  const editor = { tagName: 'DIV', inert: false, value: 'Unsent conversation' };
  const alreadyInert = { tagName: 'DIV', inert: true };
  const root = {};
  const context = vm.createContext({ document: { body: { children: [editor, alreadyInert, dialog, root] } }, root, previousInert: new Map(), pausedDialogs: new Set() });
  vm.runInContext(extractFunction('protectDesktop'), context);
  context.protectDesktop(); context.protectDesktop();
  assert.equal(editor.inert, true); assert.equal(editor.value, 'Unsent conversation');
  assert.equal(dialog.open, false); assert.equal(dialog.value, 'Unsent form');
  assert.equal(context.previousInert.get(editor), false); assert.equal(context.previousInert.get(alreadyInert), true);
  assert.equal(context.pausedDialogs.has(dialog), true);
});

test('returning to desktop restores prior focus, dialogs and inert state without rendering the editor again', () => {
  let focused = 0, opened = 0;
  const editor = { inert: true }, disabled = { inert: true };
  const context = vm.createContext({ phone: { matches: false }, generation: 0, root: { hidden: false }, previousInert: new Map([[editor, false], [disabled, true]]), pausedDialogs: new Set([{ isConnected: true, showModal() { opened++; } }]), previousFocus: { isConnected: true, focus() { focused++; } } });
  vm.runInContext(extractFunction('change'), context); context.change();
  assert.equal(editor.inert, false); assert.equal(disabled.inert, true); assert.equal(context.root.hidden, true);
  assert.equal(focused, 1); assert.equal(opened, 1); assert.equal(context.previousInert.size, 0);
});
