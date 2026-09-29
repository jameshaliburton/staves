import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../store.js';
import type { Op } from '../ops.js';

async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'staves-op-shape-'));
  try { await run(new Store(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}

// A job with no source cannot be read back: every claim says where it came from, and lint reads it on
// every board load. Refusing the write keeps one bad op from making the board unreadable.
test('a job written without provenance is refused, and the board stays readable', () => fixture(async store => {
  await store.append('work', [{ t: 'track', track: { id: 't', name: 'Tax advisor', kind: 'outside' } }], 'human');
  const nameless = { t: 'job', job: { id: 'j', name: 'Draft tax memo', track: 't', inputs: [], outputs: [] } } as unknown as Op;
  await assert.rejects(() => store.append('work', [nameless], 'human'), /where it came from|provenance/i);
  const board = await store.board('work');
  assert.equal(board.jobs.length, 0, 'the refused job never landed');
  assert.equal(board.tracks.length, 1, 'work written before it is untouched');
}));

test('a blank or non-text source is refused; the declared vocabulary is not policed here', () => fixture(async store => {
  await store.append('work', [{ t: 'track', track: { id: 't', name: 'Tax advisor', kind: 'outside' } }], 'human');
  const job = (provenance: unknown) => ({ t: 'job', job: { id: 'j', name: 'Draft tax memo', track: 't', inputs: [], outputs: [], provenance } } as unknown as Op);
  await assert.rejects(() => store.append('work', [job({ by: 'someone' })], 'human'), /where it came from/i);
  await assert.rejects(() => store.append('work', [job({ source: '  ' })], 'human'), /where it came from/i);
  await assert.rejects(() => store.append('work', [job({ source: 7 })], 'human'), /where it came from/i);
  assert.equal((await store.board('work')).jobs.length, 0);
  // Production writes these two today, cast past ProvenanceSource; they are stored, not refused.
  await store.append('work', [job({ source: 'interview', by: 'interview' })], 'human');
  assert.equal((await store.board('work')).jobs.length, 1);
}));

test('a job that says where it came from is accepted', () => fixture(async store => {
  await store.append('work', [
    { t: 'track', track: { id: 't', name: 'Tax advisor', kind: 'outside' } },
    { t: 'job', job: { id: 'j', name: 'Draft tax memo', track: 't', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } },
  ], 'human');
  assert.equal((await store.board('work')).jobs.length, 1);
}));
