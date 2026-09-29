import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { readiness } from '../readiness.js';

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-16T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => fold(entries(ops));
const base: Op[] = [
  { t: 'board', id: 'b', title: 'Investment case', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
  { t: 'track', track: { id: 'tax', name: 'Tax advisor', kind: 'outside' } },
];
const job = (over: Partial<Parameters<typeof jobOp>[0]> = {}) => jobOp(over as any);
function jobOp(over: any): Op {
  return { t: 'job', job: { id: 'j1', name: 'Draft the tax memo', track: 'tax', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' }, ...over } };
}
const find = (b: any, id: string) => readiness(b).answers.find(a => a.id === id)!;

test('the denominator is the interview’s own question list, not the workflow', () => {
  const r = readiness(at(base));
  // three brief answers and one about going wrong; no jobs described yet, so nothing else is owed
  assert.deepEqual(r.answers.map(a => a.id), ['brief:purpose', 'brief:forWhom', 'brief:mustNot', 'board:exceptions']);
  assert.equal(r.need, 4);
  assert.equal(r.have, 1, 'the board goal answers what the work is for, and nothing else is known');
  assert.equal(r.percent, 25);
});

test('a working description owes exactly the four fields ops.ts requires before a job stops being a draft', () => {
  const r = readiness(at([...base, job()]));
  const mine = r.answers.filter(a => a.id.startsWith('j1:') && a.asks.includes('working')).map(a => a.id.split(':')[1]);
  assert.deepEqual(mine, ['name', 'outcome', 'beneficiary', 'doneWhen'], 'the same four, so one part of the system cannot drift from the other');
});

test('the ask is a choice, and it is what keeps the number honest as a board grows', () => {
  const many = [...base, ...Array.from({ length: 12 }, (_, i) => ({
    t: 'job', job: { id: 'j' + i, name: 'Step ' + i, track: 'tax', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } },
  } as Op))];
  const r = readiness(at(many));
  assert.ok(r.counts.outline.need < r.counts.working.need, 'an outline asks for less than a working description');
  assert.ok(r.counts.working.need < r.counts.build.need, 'and a working description asks for less than something a builder can act on');
  assert.equal(r.ask, 'working', 'the default is unchanged, so nobody’s number moves without them choosing');
  assert.equal(r.need, r.counts.working.need, 'the headline figures are the ask they name');
});

test('every answer says which asks want it, so switching needs no round trip', () => {
  const r = readiness(at([...base, job()]));
  for (const a of r.answers) assert.ok(a.asks.length > 0, a.id + ' belongs to at least one ask');
  const outline = r.answers.filter(a => a.asks.includes('outline'));
  assert.ok(!outline.some(a => a.id.endsWith(':doneWhen')),
    'an outline does not ask when a job is finished; that is a working description');
  assert.ok(r.answers.some(a => a.id.endsWith(':trigger') && a.asks.join() === 'build'),
    'what starts a job is only owed when someone has to act on it without you');
});

test('answering moves the number, and the number is only have over need', () => {
  const thin = readiness(at([...base, job()]));
  const full = readiness(at([...base, job({ outcome: 'a memo', beneficiary: 'the committee', doneWhen: ['signed off'] })]));
  assert.equal(full.have, thin.have + 3);
  assert.equal(full.percent, Math.round((full.have / full.need) * 100));
});

test('an answer says how it was got, and confirming it is not the same as saying it', () => {
  assert.equal(find(at([...base, job({ outcome: 'a memo' })]), 'j1:outcome').by, 'said');
  assert.equal(find(at([...base, job({ outcome: 'a memo', provenance: { source: 'derived' } })]), 'j1:outcome').by, 'derived',
    'read out of the code is not the same as told to us');
  assert.equal(find(at([...base, job({ confirmedFields: ['name'] })]), 'j1:name').by, 'confirmed');
});

test('a question nobody is waiting on is curiosity, not fieldwork', () => {
  // nothing consumes this job's output and it runs twice a year
  const rare = readiness(at([...base, job({ outputs: ['a1'], perWeek: 0.04 })]));
  assert.ok(rare.idle.length, 'it is still missing, but staves can say so without insisting');
  assert.ok(rare.wanted.every(a => !a.id.startsWith('j1:')), 'and it is not on the list of things that would change anything');

  // once another job takes what it produces, the same gaps start to matter
  const feeding = readiness(at([...base, job({ outputs: ['a1'], perWeek: 0.04 }),
    { t: 'job', job: { id: 'j2', name: 'Review the memo', track: 'deal', trigger: 'chain', inputs: ['a1'], outputs: [], status: 'draft', provenance: { source: 'human' } } }]));
  assert.ok(feeding.wanted.some(a => a.id.startsWith('j1:')), 'something downstream now turns on it');
});

test('the last job in the line is the deliverable, not a curiosity', () => {
  // nothing consumes the memo because the memo is the point; that must not read as "nobody is waiting"
  const r = readiness(at([...base, job({ outputs: ['a-memo'], outcome: 'a memo the committee can read' })]));
  assert.ok(r.wanted.some(a => a.id === 'j1:doneWhen'), 'a terminal job is the workflow’s output, so its gaps still change what gets built');
  assert.equal(r.idle.length, 0);
});

test('the brief and the way out always matter, however rare the work', () => {
  const r = readiness(at([...base, job({ outputs: ['a1'], perWeek: 0.04 })]));
  assert.ok(r.wanted.some(a => a.id === 'brief:mustNot'));
  assert.ok(r.wanted.some(a => a.id === 'board:exceptions'));
  assert.ok(r.idle.every(a => a.weight === 'curious'));
});

test('every missing answer carries the question that would get it', () => {
  const r = readiness(at([...base, job()]));
  for (const a of [...r.wanted, ...r.idle]) {
    assert.ok(a.question.length > 0, a.id + ' must be askable');
    assert.equal(a.got, false);
  }
  assert.match(find(at([...base, job()]), 'j1:doneWhen').question, /Draft the tax memo/, 'and names the work in their words');
});

test('the number never travels to the model', async () => {
  const mod: Record<string, unknown> = await import('../readiness.js');
  assert.ok(!Object.keys(mod).some(k => /line|prompt|craft/i.test(k)),
    'a percentage on screen is checkable; a percentage in a sentence is a claim the model will get wrong');
});

import { CRAFT } from '../interviewer.js';

test('the craft draws the line between interest and praise, and keeps the count off the model', () => {
  assert.match(CRAFT, /Interest points at the work; praise points at the person/,
    'staves may say what it noticed; it may not say whether your work is good');
  assert.match(CRAFT, /you never state that count or a percentage/,
    'the gauge is the interface’s to show, never the model’s to claim');
});

import { mostlyInferred } from '../ledger.js';

test('a board cannot certify its own inference', () => {
  const drafted: Op[] = [{ t: 'board', id: 'b', title: 'T' },
    { t: 'track', track: { id: 't1', name: 'A', kind: 'person', provenance: { source: 'agent', by: 'interviewer' } } },
    { t: 'track', track: { id: 't2', name: 'B', kind: 'person', provenance: { source: 'agent', by: 'interviewer' } } }];
  assert.equal(mostlyInferred(at(drafted), 'roles'), true, 'roles staves drafted are staves’ reading, not theirs');

  const closedByStaves = at([...drafted, { t: 'settle', class: 'roles', settled: true, by: 'staves', quote: 'you listed both' }]);
  assert.equal(closedByStaves.settled?.roles, undefined,
    'staves may draft, and staves may close with judgment, but never both on the same class');

  const closedByPerson = at([...drafted, { t: 'settle', class: 'roles', settled: true, by: 'human', quote: 'yes, those two' }]);
  assert.equal(closedByPerson.settled?.roles?.settled, true, 'the person can close anything they like');
});

test('staves can still close a class the person described', () => {
  const theirs: Op[] = [{ t: 'board', id: 'b', title: 'T' },
    { t: 'track', track: { id: 't1', name: 'A', kind: 'person', provenance: { source: 'human' } } },
    { t: 'track', track: { id: 't2', name: 'B', kind: 'person', provenance: { source: 'human' } } }];
  const b = at([...theirs, { t: 'settle', class: 'roles', settled: true, by: 'staves', quote: 'you listed both and moved on' }]);
  assert.equal(b.settled?.roles?.settled, true, 'judgment about their words is still judgment staves may offer');
  assert.equal(b.settled?.roles?.by, 'staves', 'and it still reads as staves’, never as theirs');
});

test('work described before provenance existed is read as the person’s', () => {
  const old: Op[] = [{ t: 'board', id: 'b', title: 'T' },
    { t: 'track', track: { id: 't1', name: 'A', kind: 'person' } }];
  assert.equal(mostlyInferred(at(old), 'roles'), false,
    'an absent record is not evidence that staves wrote it');
});
