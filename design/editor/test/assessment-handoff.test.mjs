import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffHarness } from './handoff-harness.mjs';

test('opening a handoff requires no setup decisions or saved request', () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  assert.equal(h.requests.length, 0);
  assert.equal(h.draft().scope, 'all');
  assert.match(h.dialogs[0].innerHTML, /Copy to coding agent/);
  assert.doesNotMatch(h.dialogs[0].innerHTML, /Assess feasibility|Queue|of 3|unknowns|source references/);
});

test('copy creates a discussion handoff for this board and copies the server prompt', async () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  await h.context.copyAgentHandoff();
  assert.equal(h.requests[0].url, './agent-handoff?board=review-board');
  assert.equal(h.requests[0].body.jobIds, undefined);
  assert.equal(h.requests[0].body.page, 'https://staves.example/?board=review-board');
  assert.deepEqual(h.copies, ['Read this board; discuss what to build.']);
  assert.equal(h.draft().data.requestId, 'request-1');
  assert.doesNotMatch(h.get('#handoff-delivery').innerHTML, /Received by/);
  await h.context.copyAgentHandoff();
  assert.equal(h.requests.filter(r => r.url.startsWith('./agent-handoff')).length, 1);
});

test('selected scope travels without silently defaulting back to the whole board', async () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  h.draft().scope = 'selected'; h.draft().ids.add('b');
  await h.context.copyAgentHandoff();
  assert.deepEqual(h.requests[0].body.jobIds, ['b']);
});

test('empty selected scope blocks copy and preserves selection', async () => {
  const h = handoffHarness(); h.context.openHandoffExport(); h.draft().scope = 'selected';
  await h.context.copyAgentHandoff();
  assert.equal(h.requests.length, 0);
  assert.match(h.get('#handoff-error').textContent, /Choose at least one/);
});

test('clipboard denial exposes a selectable prompt and retry reuses the saved request', async () => {
  const h = handoffHarness({ copyFails: true }); h.context.openHandoffExport();
  await h.context.copyAgentHandoff();
  assert.equal(h.get('#handoff-prompt-text').value, 'Read this board; discuss what to build.');
  assert.equal(h.get('#handoff-prompt-text').selected, true);
  assert.equal(h.draft().copied, false);
  await h.context.copyAgentHandoff();
  assert.equal(h.requests.filter(r => r.url.startsWith('./agent-handoff')).length, 1);
});

test('failed preparation stays actionable without success or duplicate clicks', async () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  let resolve;
  h.context.fetch = async () => new Promise(r => { resolve = r; });
  const copying = h.context.copyAgentHandoff();
  assert.equal(h.draft().busy, true);
  await h.context.copyAgentHandoff();
  resolve({ ok: false, text: async () => 'Board unavailable' }); await copying;
  assert.equal(h.draft().busy, false);
  assert.equal(h.copies.length, 0);
  assert.match(h.get('#handoff-error').textContent, /Board unavailable/);
});

test('closing during preparation never overwrites the clipboard', async () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  let resolve;
  h.context.fetch = async () => new Promise(r => { resolve = r; });
  const copying = h.context.copyAgentHandoff(); h.dialogs[0].close();
  resolve({ ok: true, json: async () => ({ prompt: 'Late', requestId: 'late', board: 'review-board' }) });
  await copying;
  assert.equal(h.copies.length, 0);
});

test('export is a separate read-only action', async () => {
  const h = handoffHarness(); h.context.openWorkflowExport();
  assert.match(h.dialogs[0].innerHTML, /Export workflow/);
  await h.context.prepareWorkflowExport();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /^\.\/handoff-export/);
  assert.equal(h.requests[0].body.purpose, 'workshop');
});


test('reopening checks the current board before copying and passes the prior request for safe reuse', async () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  await h.context.copyAgentHandoff();
  h.dialogs[0].close();
  h.context.openHandoffExport();
  assert.equal(h.draft().data, null);
  await h.context.copyAgentHandoff();
  const posts = h.requests.filter(r => r.url.startsWith('./agent-handoff'));
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.requestId, 'request-1');
});

test('server errors display the message without JSON syntax', async () => {
  const h = handoffHarness(); h.context.openHandoffExport();
  h.context.fetch = async () => ({ ok: false, text: async () => JSON.stringify({ error: 'This board is unavailable.' }) });
  await h.context.copyAgentHandoff();
  assert.equal(h.get('#handoff-error').textContent, 'This board is unavailable.');
});
