import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const feedback = readFileSync(new URL('../feedback.js', import.meta.url), 'utf8');
function feedbackClient(response) {
  const context = vm.createContext({
    document: { readyState: 'loading' },
    addEventListener() {},
    fetch: async () => response,
  });
  vm.runInContext(feedback.replace('  async function mount()', '  globalThis.checkHosted = isHosted; globalThis.receipt = feedbackReceipt;\n  async function mount()'), context);
  return context;
}
test('local HTML fallback does not enable hosted feedback', async () => {
  assert.equal(await feedbackClient(new Response('<html>Local board</html>')).checkHosted(), false);
  assert.equal(await feedbackClient(Response.json({ id: 'local' })).checkHosted(), false);
  assert.equal(await feedbackClient(Response.json({ hosted: true, id: 'account' })).checkHosted(), true);
});
test('feedback requires a successful structured receipt', async () => {
  const { receipt } = feedbackClient(null);
  for (const response of [new Response('<html>Local board</html>'), Response.json({}), Response.json({ ok: false }), Response.json({ ok: true }, { status: 500 })]) {
    await assert.rejects(receipt(response), /not confirmed as sent/);
  }
  assert.equal((await receipt(Response.json({ ok: true, screenshot: false }))).ok, true);
});
test('local workspace documentation navigates to the public docs site', () => {
  const html = readFileSync(new URL('../home.html', import.meta.url), 'utf8');
  assert.match(html, /href="https:\/\/staves.io\/docs\/"/);
  const source = readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  const redirect = source.match(/location\.replace\([^;]+;/)[0];
  for (const [hosted, hash, expected] of [[false, '#docs', 'https://staves.io/docs/'], [false, '#docs/connect', 'https://staves.io/docs/connect/'], [true, '#docs/connect', '/docs/connect/']]) {
    let actual;
    vm.runInNewContext(redirect, { isHostedWorkspace: hosted, deep: hash.split('/')[1], location: { replace: value => { actual = value; } } });
    assert.equal(actual, expected);
  }
});
test('default local model status gives actionable setup without promising Codex authentication', () => {
  const source = readFileSync(new URL('../home.js', import.meta.url), 'utf8');
  const nodes = new Map(['#account-model-state', '#account-model-note', '#account-last-check', '#account-version'].map(id => [id, { dataset: {} }]));
  const status = source.slice(source.indexOf('function paintAccountStatus()'), source.indexOf('const colors='));
  vm.runInNewContext(status + '\npaintAccountStatus();', { workspaceStatus: { model: { status: 'unavailable' } }, statusChecked: new Date(), document: { querySelector: id => nodes.get(id) } });
  assert.equal(nodes.get('#account-model-state').textContent, 'Interview model status unavailable');
  assert.match(nodes.get('#account-model-note').textContent, /configuration below/);
  assert.match(nodes.get('#account-model-note').textContent, /sampling support or a model provider configured on the board/);
  assert.doesNotMatch(nodes.get('#account-model-note').textContent, /sign.in|restart/i);
  assert.match(source, /id="config-section"/);
});
