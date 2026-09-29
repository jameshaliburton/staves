import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { authorship, inferred } from '../authorship.js';

/**
 * The split has to survive the thing that actually fills the board.
 *
 * Every other test here builds ops by hand. This one asserts the contract the interviewer has to
 * keep, because the whole idea fails in either direction if it does not: mark a person's own account
 * as staves' guess and the board tells them their words were invented; mark a draft as theirs and the
 * hatching disappears exactly when it is doing its job.
 */

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => fold(entries(ops));
const base: Op[] = [
  { t: 'board', id: 'b', title: 'Commercial diligence', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'tax', name: 'Tax adviser', kind: 'outside' } },
];
const described = { outcome: 'a memo the committee can decide on', beneficiary: 'the deal lead', doneWhen: ['the adviser signs it'] };

/** What the interviewer emits for a card the person demonstrably spoke. */
const spoken = (id: string, name: string): Op => ({
  t: 'job', job: { id, name, track: 'tax', trigger: 'hand', inputs: [], outputs: [], ...described, provenance: { source: 'human' }, status: 'draft' },
} as Op);

/** What it emits for a card it drafted from work it recognises. */
const drafted = (id: string, name: string): Op => ({
  t: 'job', job: { id, name, track: 'tax', trigger: 'hand', inputs: [], outputs: [], ...described, provenance: { source: 'agent', by: 'interview' }, status: 'draft' },
} as Op);

test('a job the person described in their own words is theirs, and is not drawn as a guess', () => {
  const b = at([...base, spoken('j1', 'Draft the tax memo')]);
  assert.equal(inferred(b, b.jobs[0]), false, 'their account must never come back hatched');
  assert.equal(authorship(b).percent, 100);
});

test('a job staves drafted is staves’, and is drawn as a guess', () => {
  const b = at([...base, drafted('j1', 'Draft the tax memo')]);
  assert.equal(inferred(b, b.jobs[0]), true);
  assert.ok(authorship(b).percent < 50);
});

test('a mixed conversation reports the mix', () => {
  const b = at([...base, spoken('j1', 'Pull the data room together'), drafted('j2', 'Draft the tax memo'), drafted('j3', 'Review the memo')]);
  const a = authorship(b);
  assert.ok(a.percent > 0 && a.percent < 100, 'neither all theirs nor all mine: ' + a.yours + '/' + a.known);
  assert.deepEqual(b.jobs.map(j => inferred(b, j)), [false, true, true]);
});

test('“interview” was never a provenance source, and anything unrecognised counts as staves’', () => {
  // a log written while the interviewer stamped an invalid source still has to read safely: unknown
  // provenance is staves', never the person's, because the failure has to fall towards honesty
  const b = at([...base, { t: 'job', job: { id: 'j1', name: 'Draft the tax memo', track: 'tax', trigger: 'hand', inputs: [], outputs: [], ...described, provenance: { source: 'interview' }, status: 'draft' } } as unknown as Op]);
  assert.equal(inferred(b, b.jobs[0]), true);
});

/* ---- the same contract, through the real card pipeline rather than hand-written ops ---- */

test('the interviewer marks what they said as theirs and what it drafted as its own', async () => {
  const { cardsFromModel } = await import('../interviewer.js');
  const b = at(base) as any;
  b.__findings = [];

  const said = 'the adviser drafts the tax memo and the deal lead reads it';
  const [theirs] = cardsFromModel(
    [{ type: 'job', name: 'Draft the tax memo', who: 'Tax adviser', quote: said, confidence: 'said' }],
    b, said);
  const theirJob = theirs?.ops.find(o => o.t === 'job') as any;
  assert.equal(theirJob?.job.provenance.source, 'human', 'their own sentence is not staves’ guess');

  // a drafted card: staves' reading of familiar work, carrying no quote of theirs
  const [mine] = cardsFromModel(
    [{ type: 'job', name: 'File the signed memo', who: 'Document system', quote: '', confidence: 'implied' }],
    b, said);
  const myJob = mine?.ops.find(o => o.t === 'job') as any;
  assert.equal(myJob?.job.provenance.source, 'agent', 'what it filled in stays its own until they agree');
});

test('a quote the person never said cannot buy human provenance', async () => {
  const { cardsFromModel } = await import('../interviewer.js');
  const b = at(base) as any;
  b.__findings = [];
  const said = 'we run diligence on mid-market deals';
  const [card] = cardsFromModel(
    [{ type: 'job', name: 'Escalate to the partner', who: 'Deal team', quote: 'we always escalate to the partner on day three', confidence: 'said' }],
    b, said);
  const job = card?.ops.find(o => o.t === 'job') as any;
  if (job) assert.equal(job.job.provenance.source, 'agent', 'claiming they said it is not the same as them saying it');
});
