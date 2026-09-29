import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../shell.js', import.meta.url), 'utf8');
const modelLabel = source.slice(source.indexOf('function shellModelLabel()'), source.indexOf('function shellServerLabel()'));
function label({ hosted = true, saved = {}, model = null, storageError = false } = {}) {
  const context = { hostedShell: hosted, shellState: { details: { model } }, localStorage: { getItem(key) { if (storageError) throw new Error('Unavailable'); return saved[key] || null; } } };
  vm.runInNewContext(modelLabel + '\nresult = shellModelLabel();', context);
  return JSON.parse(JSON.stringify(context.result));
}

test('a browser key is configured even when the hosted server reports no model', () => {
  const result = label({ saved: { 'staves:key': 'fixture-key', 'staves:model': 'custom-model' }, model: { status: 'unavailable' } });
  assert.equal(result.text, 'custom-model configured');
  assert.equal(result.fix, undefined);
  assert.equal(result.go, './workspace#account');
  assert.doesNotMatch(JSON.stringify(result), /fixture-key|available|connected/);
});
test('a browser key uses a provider label without claiming a model was tested', () => {
  assert.equal(label({ saved: { 'staves:key': 'fixture-key', 'staves:provider': 'openai' } }).text, 'OpenAI configured');
});
test('a removed key reports no browser model and offers setup', () => {
  assert.equal(label({ saved: { 'staves:model': 'old-model' } }).fix, 'Add a key');
});
test('local server and MCP model status remain available without a browser key', () => {
  assert.equal(label({ hosted: false, model: { status: 'ready', name: 'Local Codex' } }).text, 'Local Codex available');
  assert.equal(label({ hosted: false }).text, 'Model not checked');
});
test('unreadable browser storage is not reported as a missing key', () => {
  assert.equal(label({ storageError: true }).text, 'Model settings unavailable');
});
test('saved settings and removal in another tab repaint the footer immediately', () => {
  const listeners = new Map();
  let paints = 0;
  const events = source.slice(source.indexOf("window.addEventListener('storage'"), source.indexOf('\n\nconst shellShare'));
  vm.runInNewContext(events, {
    window: { addEventListener: (name, callback) => listeners.set(name, callback) },
    paintShellStatus: () => paints++,
  });
  for (const key of ['staves:key', 'staves:provider', 'staves:model', null]) listeners.get('storage')({ key });
  assert.equal(paints, 4);
  listeners.get('storage')({ key: 'unrelated' });
  assert.equal(paints, 4);
  listeners.get('focus')();
  assert.equal(paints, 5);
});

// openShell navigates to ./workspace, so the in-board boards panel it once opened was unreachable —
// and it still called shellModelLabel() as though that returned a string. Dead code cannot be wrong in
// a way anyone notices, which is exactly why it was worth deleting rather than leaving to rot.
test('the unreachable in-board navigation dialog is gone, and openShell still leaves for the workspace', () => {
  for (const name of ['renderShell', 'shellDialog', 'shellPage', 'shell-dialog']) {
    assert.equal(source.includes(name), false, name + ' is reached from nothing and must not come back');
  }
  assert.match(source, /function openShell\(page\)\{location\.assign\('\.\/workspace#'/);
});

test('the styles only the deleted dialog used went with it, keeping the status bar focus ring', async () => {
  const css = await readFile(new URL('../shell.css', import.meta.url), 'utf8');
  for (const selector of ['#shell-dialog', '.shell-content', '.shell-caption', '.shell-board-list', '.shell-setting', '.shell-client']) {
    assert.equal(css.includes(selector), false, selector + ' styles nothing any more');
  }
  assert.match(css, /#shell-status button:focus-visible\{outline:2px solid var\(--acc\)/);
});
