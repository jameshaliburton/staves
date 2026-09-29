import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { discussionTranscript, interviewFlow, interviewTurn, cardsFromModel } from '../interviewer.js';

const ops: Op[] = [
  { t: 'board', id: 'discussion', title: 'Answer a request', goal: 'Help the requester decide' },
  { t: 'track', track: { id: 'agent', name: 'Research agent', kind: 'agent' } },
  { t: 'job', job: { id: 'answer', name: 'Give an answer', track: 'agent', inputs: [], outputs: [], status: 'confirmed', provenance: { source: 'agent', by: 'test' }, implementation: { state: 'in-progress', note: 'Correction delivery not built' } } },
  { t: 'job', job: { id: 'verify', name: 'Verify citations', parent: 'answer', track: 'agent', inputs: [], outputs: [], status: 'draft', provenance: { source: 'agent', by: 'test' } } },
  { t: 'ask', question: { id: 'q', about: 'answer', text: 'Who receives a correction?', askedBy: 'human', status: 'raised', at: '2026-09-08' } },
];
const board = fold(ops.map((op, seq): Entry => ({ op, seq: seq + 1, by: 'test', at: '2026-09-08' })));

test('discussion includes the latest utterance once for browser and API callers', () => {
  const lines = [{ who: 'person' as const, text: 'I do not know yet.' }];
  assert.equal(discussionTranscript(lines, lines[0].text), 'person: I do not know yet.');
  assert.equal(discussionTranscript([], lines[0].text), 'person: I do not know yet.');
});

test('board and job discussions receive nested work, uncertainty and model access boundaries', async () => {
  const complete = async (system: string, user: string) => {
    assert.match(system, /NO repository access/);
    assert.match(system, /ONE high-value question/);
    assert.match(system, /never automatically sent/);
    assert.match(user, /Verify citations/);
    assert.match(user, /Correction delivery not built/);
    assert.match(user, /Who receives a correction/);
    assert.equal(user.split('person: Challenge this workflow').length, 2);
    return JSON.stringify({ reply: 'Who needs to hear when an answer changes?', cards: [] });
  };
  const lines = [{ who: 'person' as const, text: 'Challenge this workflow' }];
  assert.equal((await interviewFlow(board, lines, lines[0].text, complete)).engine, 'model');
  assert.equal((await interviewTurn(board, board.jobs[0], lines, lines[0].text, complete)).engine, 'model');
});

test('unresolved model cards cannot create work and context requires review', async () => {
  const raw = [{ type: 'job', name: 'Send a correction?', confidence: 'asked', quote: 'I do not know yet' }, { type: 'context', name: 'Goal', context: { purpose: 'Help someone decide' }, quote: 'Help someone decide' }];
  const cards = cardsFromModel(raw, board);
  assert.deepEqual(cards[0].ops, []);
  assert.equal(cards[1].auto, false);
  const response = await interviewTurn(board, board.jobs[0], [], 'I do not know yet', async () => JSON.stringify({ reply: 'What evidence would help?', cards: [{ type: 'task', name: 'Send correction?', confidence: 'asked' }] }));
  assert.deepEqual(response.cards[0].ops, []);
  assert.equal(response.cards[0].confidence, 'asked');
});

test('a complaint about repeated questions pauses both scopes without asking another question', async () => {
  let calls = 0;
  const complete = async () => { calls++; return JSON.stringify({ reply: 'One more question?', cards: [] }); };
  for (const said of ["I think we already went over that didn't we", "look we've gone over this already", 'Stop asking questions']) {
    const flow = await interviewFlow(board, [], said, complete);
    const job = await interviewTurn(board, board.jobs[0], [], said, complete);
    assert.equal(flow.done, true); assert.equal(job.done, true);
    assert.doesNotMatch(flow.reply, /\?/); assert.doesNotMatch(job.reply, /\?/);
  }
  assert.equal(calls, 0);
});

test('an already answered exact question is not presented again', async () => {
  const lines = [{ who: 'interviewer' as const, text: 'Who receives the correction?' }, { who: 'person' as const, text: 'The requester receives it.' }];
  const turn = await interviewFlow(board, lines, lines[1].text, async () => JSON.stringify({ reply: 'Who receives the correction?', cards: [] }));
  assert.equal(turn.done, true);
  assert.doesNotMatch(turn.reply, /Who receives/);
});

test('pending and dismissed suggestions reach the model and exact duplicates stay suppressed', async () => {
  const suggestions = [{ type: 'task', name: 'Send a correction', state: 'pending' as const, about: 'answer', quote: 'I send a correction' }];
  const complete = async (system: string, user: string) => {
    assert.match(user, /SUGGESTIONS ALREADY COLLECTED/);
    assert.match(user, /"state":"pending"/);
    assert.match(system, /BOARD conversation/);
    return JSON.stringify({ reply: 'We have a correction task drafted.', cards: [{ type: 'task', job: 'answer', name: 'Send a correction', quote: 'I send a correction' }] });
  };
  assert.equal((await interviewFlow(board, [], 'I send a correction', complete, { suggestions })).cards.length, 0);
});

test('board task cards require an explicit unambiguous parent and retain that parent on acceptance', () => {
  const missing = cardsFromModel([{ type: 'task', name: 'Email the requester', quote: 'Email them' }], board);
  assert.deepEqual(missing[0].ops, []);
  assert.match(missing[0].warning ?? '', /Choose the job/);
  const specific = cardsFromModel([{ type: 'task', job: 'answer', name: 'Email the requester', quote: 'Email them' }], board);
  const creation = specific[0].ops.find(op => op.t === 'job');
  assert.equal(creation?.t === 'job' && creation.job.parent, 'answer');
  assert.equal(cardsFromModel([{ type: 'task', job: 'answer', name: 'Verify citations' }], board).length, 0);
});

test('replacing an existing decision rule is disclosed on the card', () => {
  const withGate = structuredClone(board);
  withGate.jobs[0].gate = { rule: 'Human checks the evidence', accountable: 'agent' };
  const cards = cardsFromModel([{ type: 'gate', job: 'answer', name: 'Review all corrections' }], withGate);
  assert.match(cards[0].warning ?? '', /Replaces the current decision rule: Human checks the evidence/);
});
