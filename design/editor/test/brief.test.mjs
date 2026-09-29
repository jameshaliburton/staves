import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../brief.js', import.meta.url), 'utf8');
function fixture(save = async () => {}, board = {}) {
  const nodes = new Map();
  const panel = {
    dataset: {}, isConnected: true,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '' });
      return nodes.get(selector);
    },
    querySelectorAll() { return [...nodes.values()]; },
    remove() {},
  };
  const host = { querySelector: () => ({ nextSibling: {} }), insertBefore() {} };
  const calls = [];
  const state = { name: 'board-a', board: { id: 'board-a', context: { purpose: 'Help customers', stakes: ['trust'] }, ...board } };
  const context = vm.createContext({ state, document: { createElement: () => panel }, $: () => host, render() {}, checkedOp: save, talkWithStaves: (...args) => calls.push(args) });
  vm.runInContext(source, context);
  return { context, state, panel, nodes, calls };
}
test('brief leaves unknowns unanswered and discussion only prefills a focused request', () => {
  const f = fixture();
  assert.equal(f.panel.open, false);
  assert.equal(f.nodes.get('.brief-summary').textContent, 'Help customers');
  assert.match(f.nodes.get('summary').title, /Not yet recorded: Improvement sought, Success criteria/);
  assert.equal(f.nodes.get('[name="success"]').value, '');
  vm.runInContext('discussBoardBrief()', f.context);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'board');
  assert.match(f.calls[0][1], /one focused question/);
});
test('draft survives board renders and is saved only by explicit submit', async () => {
  const writes = [];
  const f = fixture(async ops => writes.push(ops));
  const input = f.nodes.get('[name="improvement"]');
  input.value = 'Reduce waiting';
  input.oninput();
  vm.runInContext('paintBoardBrief()', f.context);
  assert.equal(input.value, 'Reduce waiting');
  assert.equal(writes.length, 0);
  await f.nodes.get('form').onsubmit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].t, 'setContext');
  assert.equal(writes[0][0].context.improvement, 'Reduce waiting');
  assert.equal(writes[0][0].context.success, '');
  assert.equal(f.nodes.get('.brief-status').textContent, 'Brief saved');
});
test('failed save keeps the draft and exposes an accessible retryable error', async () => {
  const f = fixture(async () => { throw new Error('Board is offline'); });
  const input = f.nodes.get('[name="success"]');
  input.value = 'A reply within a day';
  input.oninput();
  await f.nodes.get('form').onsubmit({ preventDefault() {} });
  assert.equal(f.nodes.get('.brief-error').textContent, 'Board is offline');
  assert.match(f.panel.innerHTML, /role="alert"/);
  assert.equal(input.disabled, false);
  vm.runInContext('paintBoardBrief()', f.context);
  assert.equal(input.value, 'A reply within a day');
});

test('a board an agent drew shows its goal as the purpose, not "not yet recorded"', () => {
  // staves_start records the purpose as the board's goal; only this panel ever writes
  // context.purpose. Reading the key alone made every described board — which is most of them —
  // claim it had no purpose while the purpose sat in the header above it.
  const f = fixture(async () => {}, { context: {}, goal: 'The supplier is paid once, and told why when they are not.' });
  assert.equal(f.nodes.get('.brief-summary').textContent, 'The supplier is paid once, and told why when they are not.');
  assert.equal(f.nodes.get('[name="purpose"]').value, 'The supplier is paid once, and told why when they are not.');
  assert.doesNotMatch(f.nodes.get('summary').title || '', /Purpose/, 'purpose is recorded, so it is not an unknown');
});

test('an edited purpose wins over the goal it was derived from', async () => {
  const writes = [];
  const f = fixture(async ops => writes.push(ops), { context: { purpose: 'What we decided it is for' }, goal: 'What the agent first called it' });
  assert.equal(f.nodes.get('.brief-summary').textContent, 'What we decided it is for');
  // And Save still writes both, so the header and the brief stay one answer.
  await f.nodes.get('form').onsubmit({ preventDefault() {} });
  const [ops] = writes;
  assert.equal(ops.find(o => o.t === 'setContext').context.purpose, 'What we decided it is for');
  assert.equal(ops.find(o => o.t === 'board').goal, 'What we decided it is for');
});
