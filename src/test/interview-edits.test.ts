import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { cardsFromModel, interviewTurn, modelFlow } from '../interviewer.js';

const ops: Op[] = [
  { t: 'board', id: 'reflection', title: 'Find useful music', goal: 'Discover new music' },
  { t: 'track', track: { id: 'listener', name: 'Listener', kind: 'person' } },
  { t: 'track', track: { id: 'curator', name: 'Curator', kind: 'agent' } },
  { t: 'job', job: { id: 'discover', name: 'Discover music', track: 'listener', status: 'draft', provenance: { source: 'agent', by: 'test' }, inputs: ['taste'], outputs: ['playlist'], outcome: 'Hear unfamiliar music' } },
  { t: 'job', job: { id: 'sample', name: 'Sample a track', parent: 'discover', track: 'listener', status: 'draft', provenance: { source: 'agent', by: 'test' }, inputs: [], outputs: [] } },
];
const entries = ops.map((op, seq): Entry => ({ op, seq: seq + 1, by: 'test', at: '2026-09-08' }));
const board = fold(structuredClone(entries));
const modelCard = (type: string, target: string, quote: string, patch = {}) => ({ type, target, quote, patch, confidence: 'said', name: 'Refine discovery' });

for (const type of ['update', 'replace']) test(`${type} preserves node identity, children and connections while allowing a valid role change`, () => {
  const quote = 'Actually replace Discover music with Find unfamiliar genres and assign it to the curator.';
  const card = cardsFromModel([modelCard(type, 'discover', quote, { name: 'Find unfamiliar genres', outcome: 'Find a new genre', beneficiary: 'Listener', rationale: 'Broaden discovery', track: 'curator', id: 'hijack', parent: 'sample', inputs: [], outputs: [] })], board, quote)[0];
  const result = fold([...structuredClone(entries), ...card.ops.map((op, i): Entry => ({ op, seq: entries.length + i + 1, by: 'test', at: '2026-09-08' }))]);
  const updated = result.jobs.find(j => j.id === 'discover')!;
  assert.equal(updated.name, 'Find unfamiliar genres');
  assert.equal(updated.track, 'curator');
  assert.deepEqual(updated.inputs, ['taste']);
  assert.deepEqual(updated.outputs, ['playlist']);
  assert.equal(updated.parent, undefined);
  assert.equal(result.jobs.find(j => j.id === 'sample')?.parent, 'discover');
  assert.equal(result.jobs.length, 2);
});

test('edits require exact existing target IDs and valid existing roles', () => {
  const quote = 'Rename Discover music to Discover genres.';
  for (const type of ['update', 'replace', 'remove']) {
    assert.equal(cardsFromModel([modelCard(type, 'unknown', quote, { name: 'Discover genres' })], board, quote).length, 0);
    assert.equal(cardsFromModel([modelCard(type, 'Discover music', quote, { name: 'Discover genres' })], board, quote).length, 0);
  }
  assert.equal(cardsFromModel([modelCard('update', 'discover', quote, { track: 'missing' })], board, quote).length, 0);
});

test('questions, inferences, negations and fabricated correction quotes do not execute', () => {
  for (const quote of ['Should we remove Sample a track?', 'Maybe remove Sample a track', "Don't remove Sample a track", 'What if we replace Sample a track']) {
    assert.deepEqual(cardsFromModel([modelCard('remove', 'sample', quote)], board, quote)[0].ops, []);
  }
  for (const confidence of ['implied', 'asked']) {
    const quote = 'Remove Sample a track';
    assert.deepEqual(cardsFromModel([{ ...modelCard('remove', 'sample', quote), confidence }], board, quote)[0].ops, []);
  }
  assert.deepEqual(cardsFromModel([modelCard('remove', 'sample', 'remove Sample a track')], board, 'Should we remove Sample a track')[0].ops, []);
  assert.deepEqual(cardsFromModel([modelCard('replace', 'discover', 'Replace Discover music', { name: 'Something else' })], board, 'I enjoy jazz.')[0].ops, []);
});

test('remove targets only explicitly named existing work and discloses child task removal', () => {
  const quote = 'Remove Sample a track';
  assert.deepEqual(cardsFromModel([modelCard('remove', 'sample', quote)], board, quote)[0].ops, [{ t: 'removeJob', id: 'sample' }]);
  const parentQuote = 'Remove Discover music';
  assert.deepEqual(cardsFromModel([modelCard('remove', 'discover', parentQuote)], board, parentQuote)[0].ops, []);
  const withTasks = 'Remove Discover music and its tasks';
  const card = cardsFromModel([modelCard('remove', 'discover', withTasks)], board, withTasks)[0];
  assert.deepEqual(card.ops, [{ t: 'removeJob', id: 'discover' }]);
  assert.match(card.warning ?? '', /1 tasks/);
});

test('board and selected-job model turns receive reflective instructions and parse corrections', async () => {
  const quote = 'Rename Sample a track to Listen to a preview';
  const complete = async (system: string, user: string) => {
    assert.match(system, /zoom out/);
    assert.match(system, /EXACT_EXISTING_JOB_OR_TASK_ID/);
    assert.match(user, /"id":"curator"/);
    return JSON.stringify({ reply: 'The preview now captures this step.', cards: [modelCard('update', 'sample', quote, { name: 'Listen to a preview' })] });
  };
  for (const turn of [await modelFlow(board, [], quote, complete), await interviewTurn(board, board.jobs[0], [], quote, complete)]) {
    assert.deepEqual(turn.cards[0].ops, [{ t: 'updateJob', id: 'sample', patch: { name: 'Listen to a preview' } }]);
  }
  const outsideScope = await interviewTurn(board, board.jobs[1], [], 'Rename Discover music', async () => JSON.stringify({ cards: [modelCard('update', 'discover', 'Rename Discover music', { name: 'New goal' })] }));
  assert.deepEqual(outsideScope.cards, []);
});

const semanticBoard = () => {
  const b = structuredClone(board);
  b.artifacts.push({ id: 'taste', name: 'Taste profile', kind: 'record' }, { id: 'request', name: 'Listener request', kind: 'record' }, { id: 'other', name: 'Other record', kind: 'record' });
  b.jobs[0].inputs = ['taste', 'request'];
  b.jobs[0].prerequisites = { kind: 'all', inputs: ['taste', 'request'] };
  b.jobs[0].gate = { rule: 'Listener approves the result', accountable: 'listener' };
  return b;
};

test('a reviewed correction changes all inputs to alternatives without changing handoffs', async () => {
  const b = semanticBoard();
  const quote = 'Actually either input is enough to start Discover music; change the prerequisites.';
  const turn = await interviewTurn(b, b.jobs[0], [], quote, async (_system, user) => {
    assert.match(user, /"prerequisites":\{"kind":"all"/);
    return JSON.stringify({ cards: [modelCard('update', 'discover', quote, { prerequisites: { kind: 'any', inputs: ['taste', 'request'] } })] });
  });
  const card = turn.cards[0];
  assert.equal(card.quote, quote);
  assert.equal(card.auto, false);
  assert.deepEqual(b.jobs[0].prerequisites, { kind: 'all', inputs: ['taste', 'request'] }, 'producing a proposal does not apply it');
  const op = card.ops[0];
  assert.equal(op.t, 'updateJob');
  if (op.t !== 'updateJob') return;
  assert.equal(op.id, 'discover');
  assert.deepEqual(op.patch.prerequisites, { kind: 'any', inputs: ['taste', 'request'] });
  assert.equal(op.patch.inputs, undefined);
  assert.equal(op.patch.outputs, undefined);
});

test('authority, exceptions and acceptance corrections retain human evidence and selected scope', async () => {
  const b = semanticBoard();
  const quote = 'Change the approval rule so the Curator is accountable. Add an exit for missing music to Sample a track. Add a check that the preview plays.';
  const patch = { gate: { rule: 'Curator approves the result', accountable: 'curator' }, exits: [{ condition: 'missing music', target: 'sample' }], checks: [{ rule: 'The preview plays', onFail: 'Ask for another preview' }] };
  const complete = async () => JSON.stringify({ cards: [modelCard('replace', 'discover', quote, patch)] });
  const scoped = await interviewTurn(b, b.jobs[0], [], quote, complete);
  assert.deepEqual(scoped.cards[0].ops, [{ t: 'updateJob', id: 'discover', patch }]);
  assert.equal(scoped.cards[0].quote, quote);
  assert.equal(scoped.cards[0].auto, false);
  assert.deepEqual((await interviewTurn(b, b.jobs[1], [], quote, complete)).cards, []);
});

test('semantic corrections reject fabricated references and prerequisites outside current handoffs', () => {
  const b = semanticBoard();
  const quote = 'Change all inputs and the approval rule, and add an exit for failure.';
  const patches = [
    { prerequisites: { kind: 'all', inputs: ['invented'] } },
    { prerequisites: { kind: 'all', inputs: ['other'] } },
    { prerequisites: { kind: 'all', inputs: ['taste', 'taste'] } },
    { gate: { rule: 'Approve', accountable: 'invented' } },
    { gate: { rule: 'Approve', accountable: 'rule', ruleOwner: 'invented' } },
    { exits: [{ condition: 'failure', target: 'invented' }] },
  ];
  for (const patch of patches) assert.deepEqual(cardsFromModel([modelCard('update', 'discover', quote, patch)], b, quote), []);
});

test('hypothetical semantic changes and unrelated rename instructions never authorize execution', () => {
  const b = semanticBoard();
  for (const quote of ['What if we change the inputs so either is sufficient?', 'Maybe assign approval to the Curator', 'Do not change all prerequisites', 'Rename Discover music to Explore music']) {
    const card = cardsFromModel([modelCard('update', 'discover', quote, { prerequisites: { kind: 'any', inputs: ['taste', 'request'] } })], b, quote)[0];
    assert.deepEqual(card.ops, []);
    assert.equal(card.auto, false);
  }
});

test('explicit unresolved prerequisites and exit destinations remain unresolved', () => {
  const b = semanticBoard();
  const quote = 'Set the prerequisites to unknown and replace the failure exit with an unresolved destination.';
  const patch = { prerequisites: { kind: 'unknown', inputs: ['taste', 'request'] }, exits: [{ condition: 'failure' }] };
  assert.deepEqual(cardsFromModel([modelCard('update', 'discover', quote, patch)], b, quote)[0].ops, [{ t: 'updateJob', id: 'discover', patch }]);
});

test('the next conversation reads manual prerequisite and authority edits from the shared model', async () => {
  const b = semanticBoard();
  b.jobs[0].prerequisites = { kind: 'conditional', inputs: ['request'], condition: 'Listener has opted in' };
  b.jobs[0].gate = { rule: 'Curator proposes; listener approves', accountable: 'listener' };
  await modelFlow(b, [], 'Explain how this starts now', async (_system, user) => {
    assert.match(user, /"kind":"conditional","inputs":\["request"\],"condition":"Listener has opted in"/);
    assert.match(user, /Curator proposes; listener approves/);
    return JSON.stringify({ reply: 'The request and listener consent are required.', cards: [] });
  });
});

test('conditional corrections require a declared condition and preserve the input subset', () => {
  const b = semanticBoard();
  const quote = 'Change the prerequisites to require the Listener request only when the listener has opted in.';
  const prerequisites = { kind: 'conditional', inputs: ['request'], condition: 'Listener has opted in' };
  const card = cardsFromModel([modelCard('update', 'discover', quote, { prerequisites })], b, quote)[0];
  assert.deepEqual(card.ops, [{ t: 'updateJob', id: 'discover', patch: { prerequisites } }]);
  assert.deepEqual(b.jobs[0].inputs, ['taste', 'request']);
  assert.deepEqual(cardsFromModel([modelCard('update', 'discover', quote, { prerequisites: { kind: 'conditional', inputs: ['request'] } })], b, quote), []);
});

test('adding a check and exit retains earlier audit and recovery requirements', () => {
  const b = semanticBoard();
  b.jobs[0].checks = [{ rule: 'Record an audit entry', onFail: 'Hold for review' }];
  b.jobs[0].exits = [{ condition: 'Listener cancels', target: 'stop', share: 0.1 }];
  const quote = 'Add a check that the preview plays and add an exit for missing music to Sample a track.';
  const added = { checks: [{ rule: 'The preview plays' }], exits: [{ condition: 'missing music', target: 'sample' }] };
  const card = cardsFromModel([modelCard('replace', 'discover', quote, added)], b, quote)[0];
  assert.deepEqual(card.ops, [{ t: 'updateJob', id: 'discover', patch: {
    checks: [...b.jobs[0].checks, ...added.checks], exits: [...b.jobs[0].exits, ...added.exits],
  } }]);
  assert.equal(b.jobs[0].checks.length, 1, 'the additive proposal still awaits review');
});

test('an explicit replacement can remove old checks and exits while an unrelated replacement cannot', () => {
  const b = semanticBoard();
  b.jobs[0].checks = [{ rule: 'Record an audit entry' }];
  b.jobs[0].exits = [{ condition: 'Listener cancels', target: 'stop' }];
  const quote = 'Replace the checks with a preview check and replace the exits with a missing music exit to Sample a track.';
  const patch = { checks: [{ rule: 'The preview plays' }], exits: [{ condition: 'missing music', target: 'sample' }] };
  assert.deepEqual(cardsFromModel([modelCard('update', 'discover', quote, patch)], b, quote)[0].ops, [{ t: 'updateJob', id: 'discover', patch }]);
  const mixed = 'Replace the exits with a missing music exit to Sample a track and add a check that the preview plays.';
  assert.deepEqual(cardsFromModel([modelCard('update', 'discover', mixed, patch)], b, mixed)[0].ops, [{ t: 'updateJob', id: 'discover', patch: {
    ...patch, checks: [...b.jobs[0].checks, ...patch.checks],
  } }]);
});

test('add-only model arrays cannot clear existing checks or duplicate their unchanged entries', () => {
  const b = semanticBoard();
  b.jobs[0].checks = [{ rule: 'Record an audit entry' }];
  const quote = 'Add a check that the preview plays.';
  for (const checks of [[], b.jobs[0].checks]) {
    assert.deepEqual(cardsFromModel([modelCard('update', 'discover', quote, { checks })], b, quote)[0].ops, [{ t: 'updateJob', id: 'discover', patch: { checks: b.jobs[0].checks } }]);
  }
  const remove = 'Remove all checks.';
  assert.deepEqual(cardsFromModel([modelCard('update', 'discover', remove, { checks: [] })], b, remove)[0].ops, [{ t: 'updateJob', id: 'discover', patch: { checks: [] } }]);
});
