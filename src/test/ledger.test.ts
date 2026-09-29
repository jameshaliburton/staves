import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { ledger, settlementBasis } from '../ledger.js';

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-16T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const base: Op[] = [
  { t: 'board', id: 'b', title: 'Investment case', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
  { t: 'track', track: { id: 'tax', name: 'Tax advisor', kind: 'outside' } },
];
const at = (ops: Op[]) => fold(entries(ops));
const classOf = (ops: Op[], name: string) => ledger(at(ops)).find(item => item.class === name)!;

test('a class nobody has touched is untouched, and one with work in it is open', () => {
  assert.equal(classOf([base[0]], 'roles').state, 'untouched');
  assert.equal(classOf(base, 'roles').state, 'open', 'two roles exist but nobody has said that is all of them');
});

test('closing a class records who closed it and what they were going by', () => {
  const closed = classOf([...base, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: "that's all of them", basis: settlementBasis(at(base), 'roles') }], 'roles');
  assert.equal(closed.state, 'closed');
  assert.equal(closed.by, 'human');
  assert.equal(closed.quote, "that's all of them");
});

test("Staves may close with judgment, and the ledger says it was Staves, not the person", () => {
  const closed = classOf([...base, { t: 'settle', class: 'roles', settled: true, by: 'staves', quote: 'you listed both and moved on', basis: settlementBasis(at(base), 'roles') }], 'roles');
  assert.equal(closed.state, 'closed');
  assert.equal(closed.by, 'staves', 'a tick nobody gave must never read as the person’s word');
});

test('a class reopens by itself when the thing it was about changes', () => {
  const settled: Op[] = [...base, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: "that's all", basis: settlementBasis(at(base), 'roles') }];
  assert.equal(classOf(settled, 'roles').state, 'closed');
  const ninth: Op[] = [...settled, { t: 'track', track: { id: 'legal', name: 'External legal counsel', kind: 'outside' } }];
  const item = classOf(ninth, 'roles');
  assert.equal(item.state, 'open', 'a new role lapses the closure without anyone bookkeeping it');
  assert.equal(item.lapsed, true, 'and the interviewer can say why it is open again');
});

test('removing a role also lapses it, and the person can reopen by hand', () => {
  const settled: Op[] = [...base, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: 'all', basis: settlementBasis(at(base), 'roles') }];
  assert.equal(classOf([...settled, { t: 'removeTrack', id: 'tax' }], 'roles').state, 'open');
  assert.equal(classOf([...settled, { t: 'settle', class: 'roles', settled: false, by: 'human' }], 'roles').state, 'open', 'reopening is one op');
});

test('the brief settles on what it is for and what must not happen; changing that reopens it', () => {
  const withBrief: Op[] = [...base, { t: 'setContext', context: { purpose: 'due diligence', forWhom: 'inside', mustNot: 'send an unreviewed memo' } }];
  assert.equal(classOf(withBrief, 'brief').state, 'open');
  const settled: Op[] = [...withBrief, { t: 'settle', class: 'brief', settled: true, by: 'human', quote: 'yes that is it', basis: settlementBasis(at(withBrief), 'brief') }];
  assert.equal(classOf(settled, 'brief').state, 'closed');
  assert.equal(classOf([...settled, { t: 'setContext', context: { mustNot: 'send a memo the committee has not seen' } }], 'brief').state, 'open');
});

test('every class the interviewer is expected to close is on the ledger', () => {
  assert.deepEqual(ledger(at(base)).map(item => item.class), ['brief', 'roles', 'jobs', 'handoffs', 'exceptions']);
});

import { interviewFlow } from '../interviewer.js';
import { ledgerLine } from '../ledger.js';

test('the interviewer is told what is settled, and is forbidden to re-ask it', async () => {
  const settled = at([...base, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: "that's all of them", basis: settlementBasis(at(base), 'roles') }]);
  (settled as any).__findings = [];
  let sent = { system: '', user: '' };
  await interviewFlow(settled, [{ who: 'person', text: 'we send the memo out' }], 'what next?',
    async (system: string, user: string) => { sent = { system, user }; return JSON.stringify({ reply: 'ok', cards: [] }); }, {});
  assert.match(sent.user, /roles: SETTLED/, 'the state travels with every turn, not in the model’s memory');
  assert.match(sent.user, /that's all of them/, 'with the words it was settled on');
  assert.match(sent.user, /exceptions: UNTOUCHED/, 'and what has not been touched at all');
  assert.match(sent.system, /settled|WHAT IS SETTLED/i, 'the craft tells it what a settled class means');
});

test('a lapsed class tells the interviewer why it is open again', () => {
  const settled: Op[] = [...base, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: 'all', basis: settlementBasis(at(base), 'roles') }];
  const line = ledgerLine(at([...settled, { t: 'track', track: { id: 'legal', name: 'Legal', kind: 'outside' } }]));
  assert.match(line, /roles: OPEN .* it was settled, then this changed/);
});

test('Staves closing it reads as Staves in the prompt, never as the person', () => {
  const line = ledgerLine(at([...base, { t: 'settle', class: 'roles', settled: true, by: 'staves', quote: 'you listed both and moved on', basis: settlementBasis(at(base), 'roles') }]));
  assert.match(line, /settled by Staves/);
});

import { cardsFromModel } from '../interviewer.js';

test('a settle card from the model lands as Staves’ judgment, with the person’s words when it has them', () => {
  const b = at(base);
  const [own] = cardsFromModel([{ type: 'settle', name: 'roles', quote: "that's all of them", settledBy: 'person' }], b, "that's all of them");
  assert.deepEqual(own.ops, [{ t: 'settle', class: 'roles', settled: true, by: 'human', quote: "that's all of them", basis: settlementBasis(b, 'roles') }]);

  const [judged] = cardsFromModel([{ type: 'settle', name: 'roles', quote: 'you listed both and moved on' }], b, 'anything else?');
  assert.equal((judged.ops[0] as any).by, 'staves', 'unclaimed closure is Staves’ own judgment');
  assert.equal(judged.confidence, 'implied', 'so it shows as an assumption the person can undo');

  assert.deepEqual(cardsFromModel([{ type: 'settle', name: 'nonsense', quote: 'x' }], b, 'x')[0]?.ops ?? [], [], 'a class staves does not keep is not settled');
});

test('depth reports what the board can prove, and names the gap rather than scoring it', () => {
  const withRoles = at(base);
  const roles = ledger(withRoles).find(i => i.class === 'roles')!;
  assert.equal(roles.depth, 1, 'roles exist but nothing is done by them');
  assert.match(roles.gap!, /no work against them/);

  const working: Op[] = [...base,
    { t: 'job', job: { id: 'j1', name: 'Draft tax memo', track: 'tax', trigger: 'hand', inputs: [], outputs: [], outcome: 'a memo', beneficiary: 'the deal team', doneWhen: ['signed off'], status: 'draft', provenance: { source: 'human' } } },
    { t: 'job', job: { id: 'j2', name: 'Review the memo', track: 'deal', trigger: 'hand', inputs: [], outputs: [], outcome: 'a decision', beneficiary: 'the committee', doneWhen: ['minuted'], status: 'draft', provenance: { source: 'human' } } },
  ];
  const full = ledger(at(working));
  assert.equal(full.find(i => i.class === 'roles')!.depth, 2, 'every role now has work');
  assert.equal(full.find(i => i.class === 'jobs')!.depth, 2, 'and every job says what it achieves, for whom, and when it is done');

  const thin: Op[] = [...base, { t: 'job', job: { id: 'j3', name: 'Do the thing', track: 'tax', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } }];
  const thinJobs = ledger(at(thin)).find(i => i.class === 'jobs')!;
  assert.equal(thinJobs.depth, 1);
  assert.match(thinJobs.gap!, /outcome|for whom|done/i, 'says which part is missing');

  assert.equal(ledger(at([base[0]])).find(i => i.class === 'roles')!.depth, 0);
});

test('depth and closure are independent: a class can be settled and still thin', () => {
  const settledThin: Op[] = [...base, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: "that's all", basis: settlementBasis(at(base), 'roles') }];
  const item = ledger(at(settledThin)).find(i => i.class === 'roles')!;
  assert.equal(item.state, 'closed', 'the person said that is all of them');
  assert.equal(item.depth, 1, 'which does not make the roles well supported');
});

test('the interviewer is told where the map is thin, in the same five lines', () => {
  const line = ledgerLine(at(base));
  assert.match(line, /no work against them/, 'so it can ask about the thin part instead of the settled one');
});

test('a turn says which classes it touched, so the strip can light them honestly', async () => {
  const b = at(base);
  (b as any).__findings = [];
  const turn = await interviewFlow(b, [{ who: 'person', text: 'the tax adviser sends the memo back' }], 'who else is involved?',
    async () => JSON.stringify({ reply: 'Are those all the roles?', topics: ['roles', 'handoffs', 'nonsense'], cards: [] }), {});
  assert.deepEqual(turn.topics, ['roles', 'handoffs'], 'only classes the ledger keeps, in the order given');

  const quiet = await interviewFlow(b, [], 'hello', async () => JSON.stringify({ reply: 'Hello', cards: [] }), {});
  assert.deepEqual(quiet.topics, [], 'a turn that names none claims none');
});
