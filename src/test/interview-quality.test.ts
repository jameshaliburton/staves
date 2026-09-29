import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { cardsFromModel, modelFlow } from '../interviewer.js';

const ops: Op[] = [
  { t: 'board', id: 'bids', title: 'Collect vendor bids', goal: 'Procurement can weigh design bids' },
  { t: 'setContext', context: { purpose: 'Procurement can weigh design bids', stance: 'to-be' } },
  { t: 'track', track: { id: 'procurement', name: 'Procurement', kind: 'person' } },
  { t: 'track', track: { id: 'design', name: 'Design team', kind: 'person' } },
  { t: 'job', job: { id: 'invite', name: 'Vendors invited to bid', track: 'design', status: 'draft', provenance: { source: 'agent', by: 'test' }, inputs: [], outputs: [] } },
];
const board = fold(ops.map((op, i): Entry => ({ op, seq: i + 1, by: 'test', at: '2026-09-08' })));

test('model receives goal, to-be stance, actual parent IDs and complete later clauses together with adaptive interview guidance', async () => {
  const said = "I'll email the brief and likely schedule a call to discuss it.";
  await modelFlow(board, [], said, async (system, user) => {
    assert.match(system, /For a to-be workflow, explore what the person wants to happen/);
    assert.match(system, /Do not paraphrase every message/);
    assert.match(system, /If they already describe a next step, use it/);
    assert.match(system, /'likely', 'usually' and conditional paths are not universal rules/);
    assert.match(system, /Copy the parent reference, never paraphrase it/);
    assert.doesNotMatch(system, /Always: reflect|Probes, in order of preference/);
    assert.match(user, /"stance":"to-be"/);
    assert.match(user, /"id":"invite","name":"Vendors invited to bid"/);
    assert.ok(user.includes(said));
    assert.match(user, /Prefer the next meaningful outcome or responsibility handoff/);
    return JSON.stringify({ reply: 'What needs to reach procurement so they can compare the bids?', cards: [] });
  });
});

test('a task proposed with its parent inherits that parent role rather than the first board role', () => {
  const cards = cardsFromModel([
    { type: 'job', name: 'Vendors understand the brief', who: 'Design team', quote: 'We discuss the brief together' },
    { type: 'task', name: 'Answer vendor questions', job: 'Vendors understand the brief', quote: 'We answer their questions' },
  ], board);
  const parent = cards[0].ops.find(op => op.t === 'job');
  const task = cards[1].ops.find(op => op.t === 'job');
  assert.ok(parent?.t === 'job' && task?.t === 'job');
  assert.equal(task.job.parent, parent.job.id);
  assert.equal(task.job.track, 'design');
  assert.equal(board.jobs.length, 1, 'proposals do not mutate the board');
});

test('exact parent references work but a paraphrased or missing parent stays unresolved', () => {
  const candidate = { type: 'task', name: 'Discuss the brief', quote: 'We usually discuss the brief', detail: 'Usually, when vendors continue', confidence: 'said' };
  const valid = cardsFromModel([{ ...candidate, job: 'invite' }], board)[0];
  assert.equal(valid.detail, candidate.detail);
  assert.equal(valid.ops[0].t, 'job');
  if (valid.ops[0].t === 'job') assert.equal(valid.ops[0].job.rationale, candidate.quote);
  for (const job of ['Discuss brief with vendors', undefined]) {
    const invalid = cardsFromModel([{ ...candidate, job }], board)[0];
    assert.deepEqual(invalid.ops, []);
    assert.match(invalid.warning ?? '', /Choose the job/);
  }
});

test('automation discovery receives existing effort and expertise evidence instead of asking from a script', async () => {
  const withEvidence = structuredClone(board);
  Object.assign(withEvidence.jobs[0], { minutes: 20, perWeek: 3, rationale: 'Requires design procurement experience', tools: [{ name: 'Vendor portal', reach: 'screen' }], doneWhen: ['Brief is understood'] });
  await modelFlow(withEvidence, [], 'The waiting is the problem, not writing the invitation.', async (system, user) => {
    assert.match(system, /COVERAGE OBJECTIVES \(not questions, not an ordered script\)/);
    assert.match(system, /Active effort separately from elapsed time and waiting/);
    assert.match(system, /tacit cues/);
    assert.match(system, /checking effort/);
    assert.match(system, /bounded autonomous action/);
    assert.match(system, /One answer may cover several objectives; do not ask again/);
    assert.match(system, /not automatically agent-suitable/);
    assert.match(user, /"minutes":20,"perWeek":3/);
    assert.match(user, /Requires design procurement experience/);
    assert.match(user, /Vendor portal/);
    return JSON.stringify({ reply: 'Where does the invitation wait for someone to act?', cards: [] });
  });
});
