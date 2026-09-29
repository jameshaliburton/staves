import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { cardsFromModel } from '../interviewer.js';

/**
 * A draft lands on the board. Anything that would take something away does not.
 *
 * Staves was barred from applying its own inferences, which was right while there was nowhere to see
 * that something had been inferred: the review queue stood in for a drawing that did not exist. The
 * board draws it now — hatched, counted as staves' in the readout, settleable where it sits — so the
 * queue has stopped earning its place for additive work, and a drafted map that never reaches the
 * board is not a draft of anything.
 *
 * The line that replaces it: you cannot misread a thing that was never written down, but you can lose
 * a thing that was.
 */

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => { const b = fold(entries(ops)) as any; b.__findings = []; return b; };
const base: Op[] = [
  { t: 'board', id: 'b', title: 'Commercial diligence', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
];
const said = 'we run commercial diligence on mid-market acquisitions';

const cards = (c: Record<string, unknown>[], b = at(base)) => cardsFromModel(c as any, b, said);

test('a drafted job lands on the board instead of queueing for approval', () => {
  const [card] = cards([{ type: 'job', name: 'Draft the tax memo', who: 'Tax adviser', quote: '', confidence: 'implied' }]);
  assert.ok(card, 'the card exists');
  assert.notEqual(card.auto, false, 'a draft that cannot reach the board is not a draft of anything');
  assert.ok(card.ops.length, 'and it carries the change with it');
});

test('a drafted role lands too — a job cannot arrive without somewhere to sit', () => {
  const [card] = cards([{ type: 'who', name: 'Tax adviser', kind: 'outside', quote: '', confidence: 'implied' }]);
  assert.notEqual(card?.auto, false);
});

test('the brief staves drafts lands, and the agenda says it was mine', () => {
  const [card] = cards([{ type: 'context', name: 'the brief', quote: '', confidence: 'implied', context: { purpose: 'Decide whether to invest' } }]);
  assert.notEqual(card?.auto, false);
});

test('removing something already on the board still needs the person', () => {
  const b = at([...base, { t: 'job', job: { id: 'j1', name: 'Chase the answers', track: 'deal', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } } as Op]);
  const [card] = cards([{ type: 'remove', target: 'j1', name: 'Chase the answers', quote: 'remove Chase the answers', confidence: 'said' }], b);
  assert.ok(card, 'the card reaches the person');
  assert.equal(card.auto, false, 'no amount of hatching brings back a job staves decided to delete');
});

test('changing something already written down still needs the person', () => {
  const b = at([...base, { t: 'job', job: { id: 'j1', name: 'Chase the answers', track: 'deal', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } } as Op]);
  for (const type of ['update', 'replace']) {
    const [card] = cards([{ type, target: 'j1', name: 'Chase the answers', quote: 'actually rename Chase the answers', confidence: 'said', patch: { name: 'Chase them twice' } }], b);
    assert.ok(card, type + ' reaches the person');
    assert.equal(card.auto, false, type + ' must not apply itself');
  }
});

test('staves still cannot close a class it drafted, and settling never applies itself', () => {
  const [card] = cards([{ type: 'settle', name: 'jobs', quote: '', confidence: 'implied' }]);
  assert.equal(card?.auto, false);
});

test('a question is not a change, and carries none', () => {
  const [card] = cards([{ type: 'job', name: 'Something I am about to ask about', who: 'Deal team', quote: '', confidence: 'asked' }]);
  assert.equal(card?.auto, false);
  assert.equal(card?.ops.length, 0, 'an asked card has nothing to apply');
});

test('a brief that writes over one the person already gave still needs them', () => {
  const b = at([{ t: 'board', id: 'b', title: 'Commercial diligence', goal: 'Decide whether to invest' },
    { t: 'setContext', context: { purpose: 'Decide whether to invest', forWhom: 'inside' } } as Op]);
  const [card] = cards([{ type: 'context', name: 'the brief', quote: '', confidence: 'implied',
    title: 'Vendor onboarding', context: { purpose: 'Onboard vendors faster' } }], b);
  assert.equal(card?.auto, false, 'renaming someone\u2019s board out from under them is a loss, not an addition');
});

test('a brief that fills blanks lands like any other draft', () => {
  const b = at([{ t: 'board', id: 'b', title: 'Untitled' } as Op]);
  const [card] = cards([{ type: 'context', name: 'the brief', quote: '', confidence: 'implied',
    context: { forWhom: 'inside' } }], b);
  assert.notEqual(card?.auto, false);
});

test('drafting is what you get unless you ask for the opposite', async () => {
  const { normalizeDraftStance } = await import('../interviewer.js');
  assert.equal(normalizeDraftStance(undefined), 'draft', 'correcting is faster than answering');
  assert.equal(normalizeDraftStance(null), 'draft');
  assert.equal(normalizeDraftStance('nonsense'), 'draft');
  assert.equal(normalizeDraftStance('ask'), 'ask', 'and turning it off has to still work');
});

test('a draft that has not been examined is not finished work', async () => {
  const { DRAFT_PROTOCOL } = await import('../interviewer.js');
  // drafting without then questioning what you drafted is a stranger's guess wearing someone's workflow
  assert.match(DRAFT_PROTOCOL.draft, /INTERROGATE YOUR OWN DRAFT/);
  assert.match(DRAFT_PROTOCOL.draft, /assumption you are least sure of/);
  assert.match(DRAFT_PROTOCOL.draft, /one assumption at a time/, 'never ask them to audit the whole thing at once');
  assert.ok(!/INTERROGATE/.test(DRAFT_PROTOCOL.ask), 'nothing was drafted, so there is nothing of its own to question');
});
