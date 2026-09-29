import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { authorship, jobAuthorship, inferred, guesses, classAuthorship } from '../authorship.js';

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => fold(entries(ops));

const base: Op[] = [
  { t: 'board', id: 'b', title: 'Investment case', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'tax', name: 'Tax adviser', kind: 'outside' } },
];

const job = (over: any = {}): Op => ({
  t: 'job',
  job: {
    id: 'j1', name: 'Draft the tax memo', track: 'tax', trigger: 'hand', inputs: [], outputs: [],
    status: 'draft', provenance: { source: 'agent' }, ...over,
  },
} as Op);

const described = { outcome: 'a memo the IC can decide on', beneficiary: 'the deal lead', doneWhen: ['signed'] };

test('a board staves drafted is mostly mine, and says so', () => {
  const b = at([...base, job(described)]);
  const a = authorship(b);
  assert.ok(a.known > 0, 'the board knows things');
  assert.ok(a.percent < 50, 'but almost none of it came from the person');
});

test('blanks are neither yours nor mine — the denominator is only what is written down', () => {
  const bare = at(base);
  const a = authorship(bare);
  // the goal answers what the work is for; nothing else on an empty board is known
  assert.equal(a.known, 1);
  assert.equal(a.yours, 1);
  assert.equal(a.percent, 100, 'one thing is known and the person said it');
});

test('confirming a field moves it from mine to yours, and the number with it', () => {
  const ops: Op[] = [...base, job(described)];
  const before = jobAuthorship(at(ops), at(ops).jobs[0]);
  const after = at([...ops, { t: 'confirmField', id: 'j1', field: 'outcome' } as Op]);
  const now = jobAuthorship(after, after.jobs[0]);
  assert.equal(now.known, before.known, 'confirming adds no new knowledge');
  assert.equal(now.yours, before.yours + 1, 'it only changes whose it is');
  assert.ok(now.percent > before.percent);
});

test('a job is drawn as a guess on majority, not purity', () => {
  const ops: Op[] = [...base, job(described)];
  const drafted = at(ops);
  assert.equal(inferred(drafted, drafted.jobs[0]), true, 'staves supplied all of it');

  // one field agreed is not enough to call the card the person's account
  const one = at([...ops, { t: 'confirmField', id: 'j1', field: 'outcome' } as Op]);
  assert.equal(inferred(one, one.jobs[0]), true);

  const most = at([...ops,
    { t: 'confirmField', id: 'j1', field: 'outcome' } as Op,
    { t: 'confirmField', id: 'j1', field: 'beneficiary' } as Op,
    { t: 'confirmField', id: 'j1', field: 'doneWhen' } as Op,
  ]);
  assert.equal(inferred(most, most.jobs[0]), false, 'now the card is theirs');
});

test('an empty job is a blank, not a fabrication', () => {
  const b = at([...base, job()]);
  assert.equal(inferred(b, b.jobs[0]), false, 'hatching blanks would make an empty board look invented');
});

test('the guesses are the things staves supplied and the person has not agreed to', () => {
  const b = at([...base, job(described)]);
  const ids = guesses(b).map(g => g.id);
  assert.ok(ids.includes('j1:outcome'));
  assert.ok(!ids.includes('brief:purpose'), 'the person set the goal');
  const agreed = at([...base, job(described), { t: 'confirmField', id: 'j1', field: 'outcome' } as Op]);
  assert.ok(!guesses(agreed).map(g => g.id).includes('j1:outcome'), 'agreeing takes it off the list');
});

test('completeness and authorship are independent — a full board can be entirely a stranger’s guess', () => {
  const full = at([...base, job({ ...described, provenance: { source: 'agent' } })]);
  const a = authorship(full);
  assert.ok(a.known >= 4, 'the job is described');
  assert.equal(a.yours, 1, 'and only the board goal came from the person');
});

test('the five classes carry the split, and roles are counted off the tracks', () => {
  const ops: Op[] = [
    { t: 'board', id: 'b', title: 'Commercial diligence', goal: 'Decide whether to invest' },
    { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person', provenance: { source: 'human' } } },
    { t: 'track', track: { id: 'tax', name: 'Tax adviser', kind: 'outside', provenance: { source: 'agent' } } },
    job({ id: 'mine', track: 'tax', provenance: { source: 'agent' }, ...described }),
    job({ id: 'theirs', name: 'Pull the data room', track: 'deal', provenance: { source: 'human' }, ...described }),
  ] as Op[];
  const c = classAuthorship(at(ops));
  assert.equal(c.roles.known, 2);
  assert.equal(c.roles.yours, 1, 'one track the person put there, one staves drafted');
  assert.equal(c.brief.yours, 1, 'the goal came from the person');
  assert.ok(c.jobs.known > c.jobs.yours, 'a drafted job leaves the class part mine');
  assert.equal(c.exceptions.known, 0, 'nothing has been said about going wrong, and a blank is not a guess');
});

test('a role described before provenance was recorded is read as the person’s', () => {
  const c = classAuthorship(at([
    { t: 'board', id: 'b', title: 'Old board' },
    { t: 'track', track: { id: 't', name: 'Deal team', kind: 'person' } },
  ] as Op[]));
  assert.equal(c.roles.yours, 1, 'until staves could draft a role, every role on a board was theirs');
});
