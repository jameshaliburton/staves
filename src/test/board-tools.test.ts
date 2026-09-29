import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { cardsFromModel } from '../interviewer.js';

/**
 * Staves can make every change it can name.
 *
 * From a real conversation: it identified the exact missing link — "the menu also needs the profile
 * first" — was asked "can't you draw it?", and answered "that one's a board edit on your side". It had
 * also created a duplicate role, been told immediately, and replied "merge them there". Both were true:
 * no card type connected two existing jobs or merged two roles, and the edit protocol forbade touching
 * inputs and outputs, which is the only way a handoff exists.
 *
 * The board could always do it. The vocabulary could not ask. These are the words it was missing.
 */

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => { const b = fold(entries(ops)) as any; b.__findings = []; return b; };
const mine = { provenance: { source: 'human' }, status: 'draft' } as const;
const job = (id: string, name: string, track = 'p', over: Record<string, unknown> = {}): Op => ({
  t: 'job', job: { id, name, track, trigger: 'hand', inputs: [], outputs: [], ...mine, ...over },
} as Op);

const board: Op[] = [
  { t: 'board', id: 'b', title: 'Gym platform', goal: 'Tailor training week by week' },
  { t: 'track', track: { id: 'p', name: 'Platform', kind: 'system' } },
  { t: 'track', track: { id: 'owner', name: 'Platform owner', kind: 'person' } },
  { t: 'track', track: { id: 'me', name: 'Me', kind: 'person' } },
  job('profile', 'Capture profile and goals'),
  job('menu', 'Choose a base program'),
  job('other', 'Tailor next week', 'owner'),
];

const cards = (c: Record<string, unknown>[], said: string, b = at(board)) => cardsFromModel(c as any, b, said);
const opsOf = (card: any) => card?.ops ?? [];

test('staves draws a handoff between two jobs that already exist', () => {
  const said = 'they create their profile before they ever see the menu, so the profile feeds into it';
  const [card] = cards([{ type: 'connect', from: 'profile', to: 'menu', passes: 'their profile and goals', quote: said, confidence: 'said' }], said);
  assert.ok(card, 'the card exists at all — this is the one that did not');
  assert.equal(card.warning, undefined);
  const ops = opsOf(card);
  assert.ok(ops.some((o: any) => o.t === 'artifact' && o.artifact.name === 'their profile and goals'), 'what passes between them is a thing on the board');
  const patched = ops.filter((o: any) => o.t === 'updateJob');
  assert.deepEqual(patched.map((o: any) => o.id).sort(), ['menu', 'profile'], 'both ends are wired');
  assert.ok(patched.find((o: any) => o.id === 'menu').patch.inputs.length, 'the downstream job receives it');
});

test('a second handoff out of the same job reuses what it already produces', () => {
  const b = at([...board, { t: 'artifact', artifact: { id: 'a1', name: 'the profile', kind: 'record' } } as Op,
    { t: 'updateJob', id: 'profile', patch: { outputs: ['a1'] } } as unknown as Op]);
  const said = 'the profile feeds the menu too';
  const [card] = cards([{ type: 'connect', from: 'profile', to: 'menu', passes: 'the profile', quote: said, confidence: 'said' }], said, b);
  assert.ok(!opsOf(card).some((o: any) => o.t === 'artifact'), 'no second copy of the same thing');
  assert.deepEqual(opsOf(card).map((o: any) => o.id), ['menu']);
});

test('connecting two jobs that are already connected says so instead of doing it twice', () => {
  const b = at([...board, { t: 'artifact', artifact: { id: 'a1', name: 'the profile', kind: 'record' } } as Op,
    { t: 'updateJob', id: 'profile', patch: { outputs: ['a1'] } } as unknown as Op,
    { t: 'updateJob', id: 'menu', patch: { inputs: ['a1'] } } as unknown as Op]);
  const said = 'the profile feeds the menu';
  const [card] = cards([{ type: 'connect', from: 'profile', to: 'menu', quote: said, confidence: 'said' }], said, b);
  assert.match(card.warning!, /already connected/);
  assert.deepEqual(opsOf(card), []);
});

test('two roles that are the same person merge, and the work moves before the row goes', () => {
  const said = 'actually merge Platform owner into Me, they are the same person';
  const [card] = cards([{ type: 'mergeRoles', from: 'owner', into: 'me', quote: said, confidence: 'said' }], said);
  const ops = opsOf(card);
  const moved = ops.filter((o: any) => o.t === 'updateJob');
  const removed = ops.findIndex((o: any) => o.t === 'removeTrack');
  assert.deepEqual(moved.map((o: any) => o.id), ['other'], 'the work on the absorbed role moves across');
  assert.equal(moved[0].patch.track, 'me');
  assert.ok(removed > ops.indexOf(moved[0]), 'nothing is orphaned: the row goes last');
});

test('a role is renamed and retyped in place', () => {
  const said = 'rename Platform owner to Product owner, and it is a person not a system';
  const [card] = cards([{ type: 'role', target: 'owner', name: 'Product owner', kind: 'person', quote: said, confidence: 'said' }], said);
  const [op] = opsOf(card) as any[];
  assert.equal(op.t, 'track');
  assert.equal(op.track.id, 'owner', 'the same row, not a new one');
  assert.equal(op.track.name, 'Product owner');
});

test('a change the person asked for in their own words is made, not queued', () => {
  const said = 'connect the profile to the menu, it feeds it';
  const [card] = cards([{ type: 'connect', from: 'profile', to: 'menu', quote: said, confidence: 'said' }], said);
  assert.notEqual(card.auto, false, 'approving your own sentence is the product arguing with you');

  const merge = cards([{ type: 'mergeRoles', from: 'owner', into: 'me', quote: 'merge Platform owner into Me', confidence: 'said' }],
    'merge Platform owner into Me')[0];
  assert.notEqual(merge.auto, false);
});

test('a change staves thought of still waits, and removal always waits', () => {
  const said = 'we run diligence on mid-market deals';
  const guessed = cards([{ type: 'mergeRoles', from: 'owner', into: 'me', quote: '', confidence: 'implied' }], said)[0];
  assert.equal(guessed.auto, false, 'its own idea about who someone is waits for them');

  const b = at([...board]);
  const removal = cards([{ type: 'remove', target: 'other', name: 'Tailor next week', quote: 'remove Tailor next week', confidence: 'said' }],
    'remove Tailor next week', b)[0];
  if (removal) assert.equal(removal.auto, false, 'mishearing costs most here');
});

test('a musing is drawn, but never recorded as something they said', () => {
  // the words are in their message, so the old test passed it off as testimony; it asserts nothing
  const said = 'i guess maybe the profile should feed the menu?';
  const [card] = cards([{ type: 'connect', from: 'profile', to: 'menu', quote: said, confidence: 'said' }], said);
  assert.equal(card.confidence, 'implied', 'a question mark is not a decision');
  assert.ok(card.ops.length, 'it is still worth drawing — as staves\u2019 reading of what they were circling');
});

test('naming a job that is not there asks rather than guesses', () => {
  const said = 'connect the intake to the menu';
  const [card] = cards([{ type: 'connect', from: 'nothing-like-this', to: 'menu', quote: said, confidence: 'said' }], said);
  assert.match(card.warning!, /Name both jobs/);
  assert.deepEqual(opsOf(card), []);
});
