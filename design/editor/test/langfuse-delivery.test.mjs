import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../langfuse.js', import.meta.url), 'utf8');

// Exercise the tracking state machine (langfuseTracking, stopLangfuseTracking, pollLangfuseDelivery,
// langfuseAgentRequest) without paintLangfuse's DOM rebuild, which is covered by langfuse.test.mjs.
// langfuseTracking is a top-level `let`, which vm.createContext does not expose as a sandbox property,
// so it is read and seeded by running small expressions in the same context instead of poking `context`.
function harness(overrides = {}) {
  const context = vm.createContext({
    state: { name: 'board-1' },
    paintLangfuse: () => {},
    AbortSignal,
    document: { querySelector: () => null, createElement: () => ({ setAttribute() {}, append() {} }), getElementById: () => null },
    ...overrides,
  });
  const start = source.indexOf('let langfuseTracking');
  const end = source.indexOf('function paintLangfuse(');
  assert.ok(start >= 0 && end > start, 'langfuse.js must define the tracking state machine before paintLangfuse');
  vm.runInContext(source.slice(start, end), context);
  return {
    context,
    setTracking: value => vm.runInContext('langfuseTracking = ' + JSON.stringify(value) + ';', context),
    getTracking: () => vm.runInContext('langfuseTracking', context),
  };
}

test('polling a claimed request keeps the timer running and records the snapshot', async () => {
  const paints = [];
  const h = harness({
    paintLangfuse: () => paints.push('paint'),
    fetch: async () => ({ ok: true, json: async () => ({ request: { source: { revision: 1 } }, delivery: { status: 'claimed', actor: 'agent:claude' }, returns: [] }) }),
  });
  h.setTracking({ itemId: 'a', board: 'board-1', requestId: 'req-1', snapshot: null, timer: 123 });
  await h.context.pollLangfuseDelivery();
  assert.equal(h.getTracking().snapshot.delivery.status, 'claimed');
  assert.equal(h.getTracking().timer, 123, 'a non-terminal state must not stop polling');
  assert.equal(paints.length, 1);
});

test('reaching a completed or failed state clears the poll timer', async () => {
  let cleared = null;
  const h = harness({
    clearInterval: id => { cleared = id; },
    fetch: async () => ({ ok: true, json: async () => ({ request: { source: { revision: 2 } }, delivery: { status: 'completed' }, returns: [] }) }),
  });
  h.setTracking({ itemId: 'a', board: 'board-1', requestId: 'req-1', snapshot: null, timer: 42 });
  await h.context.pollLangfuseDelivery();
  assert.equal(cleared, 42);
  assert.equal(h.getTracking().timer, null);
});

test('a failed refresh keeps the tracked request but records the error for display', async () => {
  const h = harness({ fetch: async () => ({ ok: false, text: async () => 'Board not found' }) });
  h.setTracking({ itemId: 'a', board: 'board-1', requestId: 'req-1', snapshot: null, timer: 5 });
  await h.context.pollLangfuseDelivery();
  assert.match(h.getTracking().snapshot.error, /Board not found/);
});

test('a response for a superseded request is ignored', async () => {
  let resolveFetch;
  const h = harness({ fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  h.setTracking({ itemId: 'a', board: 'board-1', requestId: 'req-1', snapshot: null, timer: 1 });
  const pending = h.context.pollLangfuseDelivery();
  h.setTracking({ itemId: 'b', board: 'board-1', requestId: 'req-2', snapshot: null, timer: 2 });
  resolveFetch({ ok: true, json: async () => ({ request: { source: { revision: 1 } }, delivery: { status: 'claimed' }, returns: [] }) });
  await pending;
  assert.equal(h.getTracking().requestId, 'req-2');
  assert.equal(h.getTracking().snapshot, null, 'the stale response must not overwrite the newer request');
});

test('starting a new evidence request paints immediately and polls every 5 seconds', async () => {
  const timers = [];
  const posts = [];
  const h = harness({
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    fetch: async (url, options) => {
      if (options) { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'req-9' }) }; }
      return { ok: true, json: async () => ({ request: { source: { revision: 1 } }, delivery: { status: 'queued' }, returns: [] }) };
    },
  });
  await h.context.langfuseAgentRequest({ id: 'job-1', name: 'Ship it' });
  assert.equal(posts[0].intent, 'assess');
  assert.deepEqual(posts[0].jobIds, ['job-1']);
  assert.equal(h.getTracking().requestId, 'req-9');
  assert.equal(h.getTracking().itemId, 'job-1');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000);
});

test('a second request replaces tracking for the earlier one', async () => {
  const cleared = [];
  const h = harness({
    setInterval: () => 'timer-id',
    clearInterval: id => cleared.push(id),
    fetch: async (url, options) => options ? { ok: true, json: async () => ({ id: 'req-2' }) } : { ok: true, json: async () => ({ request: { source: { revision: 1 } }, delivery: { status: 'queued' }, returns: [] }) },
  });
  h.setTracking({ itemId: 'a', board: 'board-1', requestId: 'req-1', snapshot: null, timer: 'timer-id' });
  await h.context.langfuseAgentRequest({ id: 'b', name: 'Next job' });
  assert.equal(h.getTracking().requestId, 'req-2');
  assert.ok(cleared.includes('timer-id'));
});
