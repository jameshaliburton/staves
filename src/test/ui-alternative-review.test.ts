import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { APP2_JS } from '../app2.js';

function fixture(canAccept = true) {
  const nodes = new Map<string, Record<string, unknown>>();
  const $ = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, { style: {}, disabled: false, isConnected: true, textContent: '', classList: { remove: () => {} } });
    return nodes.get(selector)!;
  };
  const requests: { url: string; body?: string }[] = [];
  const review = { sourceBoard: 'source', basis: 'reviewed-basis', changes: [{ entity: 'job', id: 'j', field: 'name', before: 'Old', after: '<script>New</script>' }], conflicts: [], problems: [], canAccept };
  const context = vm.createContext({ $, state: { name: 'alt' }, location: { href: '' }, encodeURIComponent, toast: () => {}, esc: (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), fetch: async (url: string, init?: { body: string }) => { requests.push({ url, body: init?.body }); return { ok: true, json: async () => init ? { sourceBoard: 'source' } : review }; }, sheet: (_title: string, _fields: unknown, onDone: () => Promise<void>) => { context.save = onDone; $('.sheet').onsubmit = async () => onDone(); } });
  vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('let alternativeReviewLoading'), APP2_JS.indexOf('async function branch()')), context);
  return { context, requests, review, $ };
}
test('generated editor JavaScript parses', () => { assert.doesNotThrow(() => new vm.Script(APP2_JS)); });
test('review loads only; explicit acceptance submits the exact reviewed basis and navigates source', async () => {
  const f = fixture();
  await vm.runInContext('reviewAlternative()', f.context);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body, undefined);
  assert.equal(f.$('#sh-ok').textContent, 'Accept intended design');
  assert.equal(f.$('#sh-ok').disabled, false);
  await f.context.save();
  assert.deepEqual(JSON.parse(f.requests[1].body!), { basis: 'reviewed-basis' });
  assert.equal(f.context.location.href, './?board=source');
});
test('conflicts disable acceptance and callback refuses direct invocation', async () => {
  const f = fixture(false);
  await vm.runInContext('reviewAlternative()', f.context);
  assert.equal(f.$('#sh-ok').disabled, true);
  await assert.rejects(f.context.save(), /Resolve/);
  assert.equal(f.requests.length, 1);
});
test('comparison escapes values, names scope and preserves implementation distinction', () => {
  const f = fixture();
  f.context.review = f.review;
  const html = vm.runInContext('alternativeReviewContent(review)', f.context);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /does not implement or deploy/);
  assert.match(html, /Pinned baseline/);
});
test('no-op comparison has no acceptance action', async () => {
  const f = fixture(); f.review.changes = [];
  await vm.runInContext('reviewAlternative()', f.context);
  assert.equal(f.$('#sh-ok').disabled, true);
  await assert.rejects(f.context.save(), /Resolve/);
});
test('review dialog uses bounded body scrolling and shared accessible sheet', async () => {
  const f = fixture(); await vm.runInContext('reviewAlternative()', f.context);
  assert.equal((f.$('.sheet').style as Record<string, string>).maxHeight, 'calc(100dvh - 48px)');
  assert.equal((f.$('.sb').style as Record<string, string>).overflowY, 'auto');
  assert.match(APP2_JS, /role="dialog" aria-modal="true"/);
});
