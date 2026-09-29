import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../store.js';
import { captureCardPreconditions } from '../proposals.js';
import type { Op } from '../ops.js';

async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'staves-suggestions-'));
  try {
    const store = new Store(dir);
    await store.append('work', [
      { t: 'board', id: 'work', title: 'Investment case' },
      { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
    ], 'human');
    await run(store);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const roleOp: Op = { t: 'track', track: { id: 't-tax', name: 'Tax advisor', kind: 'outside' } };

test('a suggestion waits on the board as a proposal, carrying the words it came from', () => fixture(async store => {
  const [card] = captureCardPreconditions(await store.board('work'), [{ ops: [roleOp] }]);
  await store.append('work', card.ops, 'interviewer', true, card.preconditions,
    [{ name: 'Tax advisor', quote: 'we use a tax adviser', confidence: 'implied', type: 'who' }]);

  const board = await store.board('work');
  assert.equal(board.tracks.length, 1, 'a proposal is not on the board until someone accepts it');

  const [proposal] = await store.proposals('work');
  assert.ok(proposal, 'it is waiting, where a collaborator or an agent can see it');
  assert.equal(proposal.by, 'interviewer');
  assert.equal(proposal.suggestion?.name, 'Tax advisor');
  assert.equal(proposal.suggestion?.quote, 'we use a tax adviser', 'the evidence survives the round trip');
  assert.equal(proposal.suggestion?.confidence, 'implied');
  assert.ok(proposal.proposalBasis, 'and the basis, so a stale one is refused');
}));

test('accepting one puts it on the board; rejecting leaves it off and closes it', () => fixture(async store => {
  const [card] = captureCardPreconditions(await store.board('work'), [{ ops: [roleOp] }]);
  await store.append('work', card.ops, 'interviewer', true, card.preconditions, [{ name: 'Tax advisor', quote: 'we use a tax adviser' }]);
  const [waiting] = await store.proposals('work');

  await store.append('work', [{ t: 'accept', seq: waiting.seq }], 'human');
  assert.equal((await store.board('work')).tracks.some(t => t.id === 't-tax'), true, 'accepted work lands');
  assert.equal((await store.proposals('work')).length, 0, 'and stops waiting');

  const [second] = captureCardPreconditions(await store.board('work'), [{ ops: [{ t: 'track', track: { id: 't-legal', name: 'Legal', kind: 'outside' } }] as Op[] }]);
  await store.append('work', second.ops, 'interviewer', true, second.preconditions, [{ name: 'Legal', quote: 'and legal' }]);
  const [next] = await store.proposals('work');
  await store.append('work', [{ t: 'reject', seq: next.seq, why: 'not a separate role' }], 'human');
  assert.equal((await store.board('work')).tracks.some(t => t.id === 't-legal'), false, 'rejected work never lands');
  assert.equal((await store.proposals('work')).length, 0, 'and stops waiting too');
}));

test('a suggestion for work that has since changed is refused, not applied quietly', () => fixture(async store => {
  await store.append('work', [{ t: 'job', job: { id: 'j', name: 'Draft memo', track: 'deal', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } }], 'human');
  const [card] = captureCardPreconditions(await store.board('work'), [{ ops: [{ t: 'updateJob', id: 'j', patch: { outcome: 'a memo' } }] as Op[] }]);
  await store.append('work', [{ t: 'updateJob', id: 'j', patch: { name: 'Draft the tax memo' } }], 'human');
  await assert.rejects(
    () => store.append('work', card.ops, 'interviewer', true, card.preconditions, [{ name: 'Outcome', quote: 'a memo' }]),
    /stale|changed/i);
}));
