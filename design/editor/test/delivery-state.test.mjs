import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');

function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, name + ' must be defined in onboarding.js');
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function loadHelpers() {
  const context = vm.createContext({});
  vm.runInContext(extractFunction(source, 'deliveryStateLabel') + '\n' + extractFunction(source, 'deliveryCommandText'), context);
  return context;
}

test('delivery state labels name each stage plainly', () => {
  const { deliveryStateLabel } = loadHelpers();
  assert.equal(deliveryStateLabel({ status: 'queued' }), 'Queued');
  assert.equal(deliveryStateLabel({ status: 'claimed', actor: 'agent:claude' }), 'Claimed by agent:claude');
  assert.equal(deliveryStateLabel({ status: 'running' }), 'Running');
  assert.equal(deliveryStateLabel({ status: 'completed' }), 'Completed');
  assert.equal(deliveryStateLabel({ status: 'failed' }), 'Failed');
});

test('delivery state labels append the delivery note when present', () => {
  const { deliveryStateLabel } = loadHelpers();
  assert.equal(deliveryStateLabel({ status: 'failed', note: 'Repository unavailable' }), 'Failed · Repository unavailable');
  assert.equal(deliveryStateLabel({ status: 'queued', note: '' }), 'Queued');
});

test('delivery state label falls back to an unknown agent when a claim omits an actor', () => {
  const { deliveryStateLabel } = loadHelpers();
  assert.equal(deliveryStateLabel({ status: 'claimed' }), 'Claimed by an unknown agent');
});

test('discuss command text tells the developer to resume staves in their interactive agent', () => {
  const { deliveryCommandText } = loadHelpers();
  const command = deliveryCommandText('discuss', 'board-1');
  assert.match(command.lead, /Claude Code or Codex/);
  assert.equal(command.command, 'resume staves');
  assert.match(command.note, /interactive agent/);
  assert.match(command.note, /not run in the background/);
});

test('assess command text runs the listener once for claude and mentions codex', () => {
  const { deliveryCommandText } = loadHelpers();
  const command = deliveryCommandText('assess', 'board-1');
  assert.match(command.lead, /terminal/);
  assert.equal(command.command, 'npx @staves/cli listen --agent claude --board board-1 --once');
  assert.match(command.note, /--agent codex/);
});

test('implement command text sends the person to their interactive agent, not the listener', () => {
  const { deliveryCommandText } = loadHelpers();
  const command = deliveryCommandText('implement', 'board-1');
  assert.equal(command.command, 'resume staves');
  assert.doesNotMatch(command.command, /listen/);
  assert.match(command.note, /does not claim implementation requests/);
});

