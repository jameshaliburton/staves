import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Store } from '../store.js';
import { boardHandler, liveFor } from '../server.js';
import { captureCardPreconditions, captureProposalBasis, StaleSuggestionError, validateOperationPreconditions } from '../proposals.js';
import type { Op } from '../ops.js';

async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'staves-card-basis-'));
  try {
    const store = new Store(dir);
    await store.append('work', ['j', 'other'].map(id => ({ t: 'job', job: { id, name: id, track: 't', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } })), 'human');
    await run(store);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('stale conversational batch refuses every write; unrelated work stays independent', () => fixture(async store => {
  const ops: Op[] = [{ t: 'updateJob', id: 'j', patch: { name: 'Suggestion' } }];
  const [card] = captureCardPreconditions(await store.board('work'), [{ ops }]);
  await store.append('work', [{ t: 'updateJob', id: 'other', patch: { name: 'Other edit' } }], 'human');
  await store.append('work', card.ops, 'human', false, card.preconditions);
  const [stale] = captureCardPreconditions(await store.board('work'), [{ ops }]);
  await store.append('work', [{ t: 'updateJob', id: 'j', patch: { name: 'Human edit' } }], 'human');
  const before = await readFile(store.file('work'), 'utf8');
  await assert.rejects(store.append('work', stale.ops, 'human', false, stale.preconditions), /stale/);
  await assert.rejects(store.append('work', stale.ops, 'human', false, []), /every operation/);
  assert.equal(await readFile(store.file('work'), 'utf8'), before);
}));

test('new job and subsequent update share the original pre-application snapshot', () => fixture(async store => {
  const ops: Op[] = [{ t: 'job', job: { id: 'new', name: 'New', track: 't', inputs: [], outputs: [], status: 'draft', provenance: { source: 'agent' } } }, { t: 'updateJob', id: 'new', patch: { outcome: 'Useful result' } }];
  const [card] = captureCardPreconditions(await store.board('work'), [{ ops }]);
  await store.append('work', ops, 'human', false, card.preconditions);
  assert.equal((await store.board('work')).jobs.find(j => j.id === 'new')?.outcome, 'Useful result');
}));

test('new accountable role and exit destination changes stale the captured edit', () => fixture(async store => {
  await store.append('work', [{ t: 'track', track: { id: 'reviewer', name: 'Reviewer', kind: 'person' } }], 'human');
  for (const [op, change] of [
    [{ t: 'updateJob', id: 'j', patch: { gate: { rule: 'Check it', accountable: 'reviewer' } } }, { t: 'track', track: { id: 'reviewer', name: 'Changed reviewer', kind: 'person' } }],
    [{ t: 'updateJob', id: 'j', patch: { gate: { rule: 'Check it', accountable: 'rule', ruleOwner: 'reviewer' } } }, { t: 'removeTrack', id: 'reviewer' }],
    [{ t: 'updateJob', id: 'j', patch: { exits: [{ condition: 'Next', target: 'other' }] } }, { t: 'updateJob', id: 'other', patch: { name: 'Different destination' } }],
  ] as [Op, Op][]) {
    const basis = captureProposalBasis(await store.board('work'), op);
    await store.append('work', [change], 'human');
    await assert.rejects(store.append('work', [op], 'human', false, [basis]), /stale/);
  }
}));

test('normal and streaming interview responses pin cards before intervening edits', () => fixture(async store => {
  store.watch = () => () => {};
  const handler = boardHandler(store);
  const live = liveFor(store.dir);
  for (const stream of [false, true]) {
    const before = await store.board('work');
    const model = async () => {
      await store.append('work', [{ t: 'updateJob', id: 'j', patch: { outcome: `Human ${stream}` } }], 'human');
      return JSON.stringify({ reply: 'Check this change.', cards: [{ type: 'outcome', name: 'Model outcome', quote: 'Outcome' }] });
    };
    live.samplers.set('test', { name: 'Test', complete: model, stream: model });
    const req = { url: `/interview?board=work${stream ? '&stream=1' : ''}`, method: 'POST', async *[Symbol.asyncIterator]() { yield JSON.stringify({ job: 'j', lines: [], said: 'The outcome changes.' }); } } as unknown as IncomingMessage;
    const parts: string[] = [];
    const res = { destroyed: false, setHeader() {}, flushHeaders() {}, write: (v: string) => parts.push(v), end: (v?: string) => { if (v) parts.push(v); } } as unknown as ServerResponse;
    await handler(req, res);
    const result = JSON.parse(parts.at(-1)!);
    assert.ok(result.cards.length);
    const card = result.cards[0];
    assert.deepEqual(card.preconditions, card.ops.map((op: Op) => captureProposalBasis(before, op)));
    await assert.rejects(store.append('work', card.ops, 'human', false, card.preconditions), /stale/);
  }
  live.samplers.clear();
}));

const newJob = (id: string, extra: Record<string, unknown> = {}): Op => ({ t: 'job', job: { id, name: id, track: 'role', inputs: [], outputs: ['record'], status: 'draft', provenance: { source: 'agent' }, ...extra } } as Op);
const trackOp: Op = { t: 'track', track: { id: 'role', name: 'Reviewer', kind: 'person' } };
const artifactOp: Op = { t: 'artifact', artifact: { id: 'record', name: 'Record', kind: 'record' } };

test('dependencies applied from earlier cards are not staleness for the job that needs them', () => fixture(async store => {
  const [role, record, job, task] = captureCardPreconditions(await store.board('work'), [{ ops: [trackOp] }, { ops: [artifactOp] }, { ops: [newJob('outcome')] }, { ops: [newJob('outcome:task', { parent: 'outcome', outputs: [] })] }]);
  for (const card of [role, record, job, task]) await store.append('work', card.ops, 'human', false, card.preconditions);
  const board = await store.board('work');
  assert.equal(board.jobs.find(j => j.id === 'outcome')?.track, 'role');
  assert.equal(board.jobs.find(j => j.id === 'outcome:task')?.parent, 'outcome');
}));

test('artifact then job, and a parent then its task, each pass alone', () => fixture(async store => {
  await store.append('work', [trackOp], 'human');
  const [record, job] = captureCardPreconditions(await store.board('work'), [{ ops: [artifactOp] }, { ops: [newJob('outcome')] }]);
  await store.append('work', record.ops, 'human', false, record.preconditions);
  await store.append('work', job.ops, 'human', false, job.preconditions);
  const [parent, task] = captureCardPreconditions(await store.board('work'), [{ ops: [newJob('parent', { outputs: [] })] }, { ops: [newJob('parent:task', { parent: 'parent', outputs: [], exits: [{ condition: 'Done', target: 'parent' }] })] }]);
  await store.append('work', parent.ops, 'human', false, parent.preconditions);
  await store.append('work', task.ops, 'human', false, task.preconditions);
  assert.equal((await store.board('work')).jobs.find(j => j.id === 'parent:task')?.parent, 'parent');
}));

test('a dependency that existed and changed, or the job itself changing, still rejects as a typed stale suggestion', () => fixture(async store => {
  await store.append('work', [trackOp], 'human');
  const [job, update] = captureCardPreconditions(await store.board('work'), [{ ops: [newJob('outcome', { outputs: [] })] }, { ops: [{ t: 'updateJob', id: 'j', patch: { track: 'role' } }] }]);
  await store.append('work', [{ t: 'track', track: { id: 'role', name: 'Renamed reviewer', kind: 'person' } }], 'human');
  await assert.rejects(store.append('work', job.ops, 'human', false, job.preconditions), StaleSuggestionError);
  await assert.rejects(store.append('work', update.ops, 'human', false, update.preconditions), StaleSuggestionError);
  const [created] = captureCardPreconditions(await store.board('work'), [{ ops: [newJob('fresh', { outputs: [] })] }]);
  await store.append('work', [newJob('fresh', { name: 'Someone else', outputs: [] })], 'human');
  await assert.rejects(store.append('work', created.ops, 'human', false, created.preconditions), /stale/);
}));

test('other operation kinds keep exact snapshot equality', () => {
  const empty = { id: 'b', title: 'B', tracks: [], artifacts: [], jobs: [], regions: [], questions: [], comments: [] } as unknown as Parameters<typeof captureProposalBasis>[0];
  const withRole = { ...empty, tracks: [{ id: 'role', name: 'Reviewer', kind: 'person' }] } as typeof empty;
  const [card] = captureCardPreconditions(empty, [{ ops: [trackOp] }]);
  assert.throws(() => validateOperationPreconditions(withRole, card.ops, card.preconditions), StaleSuggestionError);
  const [job] = captureCardPreconditions(empty, [{ ops: [newJob('outcome', { outputs: [] })] }]);
  assert.doesNotThrow(() => validateOperationPreconditions(withRole, job.ops, job.preconditions));
  assert.throws(() => validateOperationPreconditions(withRole, job.ops, [{ ...job.preconditions[0], snapshot: '{not json' }]), StaleSuggestionError);
});

test('a stale suggestion answers 409 with its sentence, not a 500 stack', () => fixture(async store => {
  store.watch = () => () => {};
  const handler = boardHandler(store);
  const [card] = captureCardPreconditions(await store.board('work'), [{ ops: [{ t: 'updateJob', id: 'j', patch: { name: 'Model' } }] }]);
  await store.append('work', [{ t: 'updateJob', id: 'j', patch: { name: 'Human' } }], 'human');
  const req = { url: '/op?board=work', method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield JSON.stringify(card); } } as unknown as IncomingMessage;
  let body = ''; const headers: Record<string, string> = {};
  const res = { statusCode: 200, setHeader: (k: string, v: string) => { headers[k] = v; }, end: (v?: string) => { body = v ?? ''; } } as unknown as ServerResponse;
  await handler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(headers['content-type'], 'application/json');
  assert.match(JSON.parse(body).error, /^This suggestion is stale/);
}));
