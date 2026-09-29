import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffHarness } from './handoff-harness.mjs';

async function copied() { const h = handoffHarness(); h.context.openHandoffExport(); await h.context.copyAgentHandoff(); await new Promise(resolve => setImmediate(resolve)); return h; }

test('a queued handoff tells the user to paste, never reports receipt', async () => {
  const h = await copied(); await h.context.refreshHandoffDelivery();
  assert.match(h.get('#handoff-delivery').innerHTML, /Waiting for your agent/);
  assert.doesNotMatch(h.get('#handoff-delivery').innerHTML, /Received by|is-received/);
});

test('only acknowledgment of this exact request reports receipt and stops polling', async () => {
  const h = await copied();
  h.context.fetch = async () => ({ ok: true, json: async () => ({ request: { id: 'request-1' }, delivery: { status: 'claimed', actor: 'agent:codex' } }) });
  await h.context.refreshHandoffDelivery();
  assert.match(h.get('#handoff-delivery').innerHTML, /Received by codex/);
  assert.equal(h.timers.at(-1).cleared, true);
});

test('an unrelated request cannot mark this handoff received', async () => {
  const h = await copied();
  h.context.fetch = async () => ({ ok: true, json: async () => ({ request: { id: 'other' }, delivery: { status: 'claimed', actor: 'agent:codex' } }) });
  await h.context.refreshHandoffDelivery();
  assert.doesNotMatch(h.get('#handoff-delivery').innerHTML, /Received by/);
});

test('refresh errors keep the copied prompt available and offer a retry', async () => {
  const h = await copied();
  h.context.fetch = async () => ({ ok: false, text: async () => 'Offline' });
  await h.context.refreshHandoffDelivery();
  assert.match(h.get('#handoff-delivery').innerHTML, /Check again/);
  assert.equal(h.draft().data.requestId, 'request-1');
});

test('closing the panel stops polling', async () => {
  const h = await copied(); h.dialogs[0].close();
  const before = h.requests.length;
  await h.context.refreshHandoffDelivery();
  assert.equal(h.requests.length, before);
  assert.equal(h.timers.at(-1).cleared, true);
});
