import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../editor.js', import.meta.url), 'utf8');
const start = source.indexOf('function nodeLanguage(');
const end = source.indexOf('// Shared viewport', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('work shapes come from explicit semantics, never names, outputs or proposal state', () => {
  assert.equal(context.nodeLanguage({ name: 'Approve document', outputs: ['Document'], status: 'draft' }).kind, 'action');
  assert.equal(context.nodeLanguage({ workKind: 'draft' }).kind, 'document');
  assert.equal(context.nodeLanguage({ workKind: 'read' }).kind, 'document');
  assert.equal(context.nodeLanguage({ workKind: 'wait' }).kind, 'wait');
  assert.equal(context.nodeLanguage({ workKind: 'decide' }).kind, 'decision');
  assert.equal(context.nodeLanguage({ workKind: 'wait', gate: { rule: 'Permission granted' } }).kind, 'decision');
  assert.equal(context.nodeLanguage({ loop: { to: 'earlier' } }).kind, 'action');
});
