import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { walk } from '../walk.js';

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => fold(entries(ops));

const base: Op[] = [
  { t: 'board', id: 'b', title: 'Commercial diligence', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
];
const mine = { provenance: { source: 'human' }, status: 'draft' } as const;
const art = (id: string, name: string): Op => ({ t: 'artifact', artifact: { id, name, kind: 'record' } } as Op);
const job = (id: string, name: string, over: Record<string, unknown> = {}): Op => ({
  t: 'job', job: { id, name, track: 'deal', trigger: 'hand', inputs: [], outputs: [], ...mine, ...over },
} as Op);
const full = { outcome: 'a thing', beneficiary: 'someone', doneWhen: ['it is done'] };

test('a walk follows the board’s own order, not the order things were described', () => {
  // described last to first, but chained first to last
  const b = at([...base, art('a1', 'the pack'), art('a2', 'the memo'),
    job('third', 'File it', { inputs: ['a2'] }),
    job('second', 'Write it', { inputs: ['a1'], outputs: ['a2'] }),
    job('first', 'Gather it', { outputs: ['a1'] }),
  ]);
  assert.deepEqual(walk(b).hops.map(h => h.name), ['Gather it', 'Write it', 'File it'],
    'a process supplies its own order, and that is the point of walking it');
});

test('a job with nothing consequential outstanding is not a hop', () => {
  const b = at([...base, job('done', 'Gather it', { ...full, confirmedFields: ['name'] }), job('open', 'Write it')]);
  const w = walk(b);
  assert.deepEqual(w.hops.map(h => h.name), ['Write it']);
  assert.equal(w.settled, 1, 'a walk that stops to ask nothing is a tour of its own thoroughness');
});

test('each hop carries one question, in full', () => {
  const b = at([...base, job('j', 'Draft the tax memo')]);
  const [hop] = walk(b).hops;
  assert.equal(hop.index, 1);
  assert.equal(hop.job, 'j');
  assert.match(hop.question, /Draft the tax memo/, 'it names the work it is about');
  assert.ok(hop.question.endsWith('?'), 'a truncated question is not a question');
});

test('what would change what someone builds is asked before what is merely interesting', () => {
  const b = at([...base, job('j', 'Draft the tax memo', { outcome: 'a memo' })]);
  const [hop] = walk(b).hops;
  // outcome is answered; the next consequential field is who waits on it
  assert.match(hop.question, /waiting/i);
});

test('an empty board asks for nothing and says so', () => {
  const w = walk(at(base));
  assert.deepEqual(w.hops, []);
  assert.equal(w.total, 0);
});
