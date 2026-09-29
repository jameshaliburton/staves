import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { openings } from '../openings.js';

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => fold(entries(ops));

const base: Op[] = [
  { t: 'board', id: 'b', title: 'Commercial diligence', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person', provenance: { source: 'human' } } },
  { t: 'track', track: { id: 'bot', name: 'Filing agent', kind: 'agent', provenance: { source: 'human' } } },
];

const mine = { provenance: { source: 'human' }, status: 'draft' } as const;
const job = (id: string, name: string, over: Record<string, unknown> = {}): Op => ({
  t: 'job', job: { id, name, track: 'deal', trigger: 'hand', inputs: [], outputs: [], ...mine, ...over },
} as Op);
const task = (id: string, parent: string, workKind: string): Op => ({
  t: 'job', job: { id, name: id, track: 'deal', parent, trigger: 'chain', inputs: [], outputs: [], workKind, ...mine },
} as Op);

const described = { outcome: 'a findings pack', beneficiary: 'the deal lead', doneWhen: ['the lead has read it'], minutes: 40, perWeek: 12 };

test('a job that never forms a view is named as needing no model at all', () => {
  const b = at([...base, job('j', 'Chase unanswered questions', described),
    task('t1', 'j', 'look'), task('t2', 'j', 'tell'), task('t3', 'j', 'move')]);
  const [o] = openings(b);
  assert.equal(o.kind, 'mechanical');
  assert.match(o.says, /does not need a model/);
  assert.ok(o.evidence.some(e => /40 minutes/.test(e)), 'it carries what the person said about volume');
});

test('an agent opening always names who still decides', () => {
  const b = at([...base, job('j', 'Draft the findings pack', described),
    task('t1', 'j', 'read'), task('t2', 'j', 'draft'), task('t3', 'j', 'match')]);
  const [o] = openings(b);
  assert.equal(o.kind, 'agent');
  assert.ok(o.keeps, 'an agent proposal without a check is not a proposal');
  assert.match(o.keeps!, /the deal lead/);
});

test('work that is mostly judgement is not offered to an agent', () => {
  const b = at([...base, job('j', 'Decide whether to proceed', described),
    task('t1', 'j', 'decide'), task('t2', 'j', 'decide'), task('t3', 'j', 'read')]);
  assert.deepEqual(openings(b), []);
});

test('a wait is named as a wait, and no software is offered for it', () => {
  const b = at([...base, job('j', 'Sit with the committee', { ...described, beneficiary: 'the deal team' }),
    task('t1', 'j', 'wait'), task('t2', 'j', 'wait')]);
  const [o] = openings(b);
  assert.equal(o.kind, 'waiting');
  assert.deepEqual(o.needs, [], 'there is nothing to connect it to');
});

test('nothing is offered about work staves made up', () => {
  const drafted = at([...base,
    { t: 'job', job: { id: 'j', name: 'Draft the findings pack', track: 'deal', trigger: 'hand', inputs: [], outputs: [], ...described, provenance: { source: 'agent' }, status: 'draft' } } as Op,
    task('t1', 'j', 'read'), task('t2', 'j', 'draft'), task('t3', 'j', 'match')]);
  assert.deepEqual(openings(drafted), [], 'an opening about a guess is a guess about a guess');
});

test('work already held by an agent is not offered again', () => {
  const b = at([...base, job('j', 'File the signed memo', { ...described, track: 'bot' }),
    task('t1', 'j', 'move'), task('t2', 'j', 'tell')]);
  assert.deepEqual(openings(b), []);
});

test('the waits sort last, so this does not read as a list of things to buy', () => {
  const b = at([...base,
    job('w', 'Sit with the committee', described), task('w1', 'w', 'wait'),
    job('a', 'Draft the findings pack', described), task('a1', 'a', 'read'), task('a2', 'a', 'draft'),
  ]);
  assert.deepEqual(openings(b).map(o => o.kind), ['agent', 'waiting']);
});
