import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { partialReply } from '../interviewer.js';
import { boardHandler, liveFor } from '../server.js';
import { Store } from '../store.js';

test('partial reply decoding handles chunk boundaries without leaking JSON or cards', () => {
  assert.equal(partialReply('{"reply":"Hi\\nthere\\u002'), 'Hi\nthere');
  assert.equal(partialReply('{"reply":"Hi\\nthere\\u0021" ,"cards":[]}'), 'Hi\nthere!');
  assert.equal(partialReply('{"reply":"A \\uD83D'), 'A ');
  assert.equal(partialReply('{"reply":"A \\uD83D\\uDE00"}'), 'A 😀');
  assert.equal(partialReply('{"reply":"Say \\"hello\\""}'), 'Say "hello"');
  assert.equal(partialReply('{"cards":[]}'), '');
});

test('NDJSON delivers real reply updates before completion, preserves cards, and reports failures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'staves-interview-stream-'));
  const store = new Store(dir);
  try {
    await store.append('test', [{ t: 'board', id: 'test', title: 'Support', goal: 'Help a person' }], 'test');
    store.watch = () => () => {};
    const handler = boardHandler(store);
    const live = liveFor(dir);
    const parts: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started: () => void = () => {};
    const ready = new Promise<void>(resolve => { started = resolve; });
    live.samplers.set('test', { name: 'Test model', complete: async () => { throw new Error('Wrong transport'); }, stream: async (_system, _user, onText) => {
      onText?.('{"reply":"What'); onText?.('{"reply":"What happens next?'); started(); await gate;
      return '{"reply":"What happens next?","cards":[{"type":"who","name":"Helper","kind":"person","quote":"A helper"}]}';
    } });
    const req = { url: '/interview?board=test&stream=1', method: 'POST', async *[Symbol.asyncIterator]() { yield JSON.stringify({ job: 'board', lines: [], said: 'A helper assists.' }); } } as unknown as IncomingMessage;
    const headers = new Map<string, string>();
    const res = { destroyed: false, setHeader: (k: string, v: string) => headers.set(k, v), flushHeaders() {}, write: (v: string) => parts.push(v), end: (v?: string) => { if (v) parts.push(v); } } as unknown as ServerResponse;
    const request = handler(req, res);
    await ready;
    assert.match(headers.get('content-type') ?? '', /ndjson/);
    assert.deepEqual(parts.map(p => JSON.parse(p).type), ['status', 'reply', 'reply']);
    assert.equal(JSON.parse(parts[2]).text, 'What happens next?');
    release(); await request;
    const end = JSON.parse(parts.at(-1)!);
    assert.equal(end.type, 'complete'); assert.equal(end.via, 'Test model'); assert.equal(end.cards[0].name, 'Helper');
    assert.equal((await store.board('test')).tracks.length, 0, 'draft response never mutates board');
    live.samplers.set('test', { name: 'Failed model', complete: async () => '', stream: async () => { throw new Error('Connection interrupted'); } });
    parts.length = 0; await handler(req, res);
    assert.deepEqual(JSON.parse(parts.at(-1)!), { type: 'error', message: 'Connection interrupted' });
    assert.ok(!parts.some(p => JSON.parse(p).type === 'complete'), 'no fabricated rule-engine answer after a stream failure');
    live.samplers.clear();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
