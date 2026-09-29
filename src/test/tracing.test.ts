import test from 'node:test';
import assert from 'node:assert/strict';
import { traced, traceConfig, type TraceConfig } from '../tracing.js';

const config: TraceConfig = { baseUrl: 'https://cloud.langfuse.com', publicKey: 'pk', secretKey: 'sk' };
const settled = () => new Promise(r => setImmediate(r));

function recorder() {
  const calls: { url: string; body: any; headers: any }[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('a turn is traced with its prompt, its answer, and which board it was about', async () => {
  const { calls, fetchImpl } = recorder();
  // content: 'full' is stated, never assumed — an earlier version of this test asserted the words were
  // there without asking for them, which is the mistake the default now makes impossible
  const complete = traced(async () => 'the answer', { name: 'interview', board: 'diligence', model: 'claude', content: 'full' }, { config, fetch: fetchImpl });
  assert.equal(await complete('the craft', 'what happens next?'), 'the answer');
  await settled();
  assert.equal(calls.length, 1);
  const [trace, generation] = calls[0].body.batch;
  assert.equal(trace.body.metadata.board, 'diligence');
  assert.equal(generation.body.output, 'the answer');
  assert.deepEqual(generation.body.input.map((m: any) => m.content), ['the craft', 'what happens next?']);
  assert.equal(generation.body.traceId, trace.body.id, 'the generation hangs off its own trace');
});

test('a failed turn is the one you most want to look at, so it is traced and then rethrown', async () => {
  const { calls, fetchImpl } = recorder();
  const complete = traced(async () => { throw new Error('the model refused'); }, { name: 'interview' }, { config, fetch: fetchImpl });
  await assert.rejects(complete('s', 'u'), /the model refused/);
  await settled();
  const [, generation] = calls[0].body.batch;
  assert.equal(generation.body.level, 'ERROR');
  assert.equal(generation.body.statusMessage, 'the model refused');
});

test('a turn never fails, slows or reads differently because tracing did', async () => {
  const dead = (async () => { throw new Error('network is down'); }) as unknown as typeof fetch;
  const complete = traced(async () => 'still fine', { name: 'interview' }, { config, fetch: dead });
  assert.equal(await complete('s', 'u'), 'still fine');
  await settled();
});

test('streaming reaches the person at the same moment it would have', async () => {
  const { fetchImpl } = recorder();
  const chunks: string[] = [];
  const complete = traced(async (_s, _u, onText) => { onText?.('half '); onText?.('a sentence'); return 'half a sentence'; },
    { name: 'interview' }, { config, fetch: fetchImpl });
  assert.equal(await complete('s', 'u', t => chunks.push(t)), 'half a sentence');
  assert.deepEqual(chunks, ['half ', 'a sentence'], 'the callback is passed straight through, not buffered');
});

test('without keys nothing is wrapped and nothing is sent', async () => {
  const { calls, fetchImpl } = recorder();
  const inner: Parameters<typeof traced>[0] = async () => 'untouched';
  const complete = traced(inner, { name: 'interview' }, { config: null, fetch: fetchImpl });
  assert.equal(complete, inner, 'the original function is handed back, not a wrapper that does nothing');
  assert.equal(await complete('s', 'u'), 'untouched');
  await settled();
  assert.equal(calls.length, 0);
});

test('configuration requires both keys and refuses a plaintext host', () => {
  assert.equal(traceConfig({} as NodeJS.ProcessEnv), null);
  assert.equal(traceConfig({ LANGFUSE_PUBLIC_KEY: 'pk' } as NodeJS.ProcessEnv), null, 'half a credential is not a credential');
  assert.equal(traceConfig({ LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk', LANGFUSE_BASE_URL: 'http://example.com' } as NodeJS.ProcessEnv), null,
    'conversations do not travel in the clear');
  const ok = traceConfig({ LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' } as NodeJS.ProcessEnv);
  assert.equal(ok?.baseUrl, 'https://cloud.langfuse.com');
  const local = traceConfig({ LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk', LANGFUSE_BASE_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv);
  assert.equal(local?.baseUrl, 'http://localhost:3000', 'a Langfuse someone runs themselves is not a plaintext hop');
});

test('the board travels by name, and its contents do not travel twice', async () => {
  const { calls, fetchImpl } = recorder();
  const complete = traced(async () => 'ok', { name: 'interview', board: 'diligence' }, { config, fetch: fetchImpl });
  await complete('s', 'u');
  await settled();
  const [trace] = calls[0].body.batch;
  assert.deepEqual(Object.keys(trace.body.metadata), ['board']);
});

/* ---- who gets their words recorded, and who does not ---- */

test('metadata is the default: recording somebody’s words is opted into, never out of', async () => {
  const { calls, fetchImpl } = recorder();
  const complete = traced(async () => 'the answer', { name: 'interview', board: 'acme' }, { config, fetch: fetchImpl });
  await complete('the craft', 'what my team actually does all day');
  await settled();
  const [trace, generation] = calls[0].body.batch;
  assert.equal(generation.body.input, undefined, 'their words do not travel');
  assert.equal(generation.body.output, undefined, 'nor the reply about them');
  assert.ok(trace.body.tags.includes('metadata-only'), 'and the trace says which kind it is');
});

test('metadata still carries enough to diagnose a turn without carrying the turn', async () => {
  const { calls, fetchImpl } = recorder();
  const complete = traced(async () => 'a short reply', { name: 'interview:job', board: 'acme', model: 'anthropic:claude', tags: ['understand'] }, { config, fetch: fetchImpl });
  await complete('system prompt here', 'user text here');
  await settled();
  const [trace, generation] = calls[0].body.batch;
  assert.equal(trace.body.metadata.board, 'acme');
  assert.equal(generation.body.model, 'anthropic:claude');
  assert.equal(generation.body.metadata.promptChars, 'system prompt here'.length + 'user text here'.length);
  assert.equal(generation.body.metadata.replyChars, 'a short reply'.length);
  assert.ok(generation.body.startTime && generation.body.endTime);
});

test('a failure is visible from everybody, because one nobody can see is one nobody fixes', async () => {
  const { calls, fetchImpl } = recorder();
  const complete = traced(async () => { throw new Error('429 rate limited'); }, { name: 'interview', board: 'acme' }, { config, fetch: fetchImpl });
  await assert.rejects(complete('s', 'their private workflow'));
  await settled();
  const [, generation] = calls[0].body.batch;
  assert.equal(generation.body.level, 'ERROR');
  assert.equal(generation.body.statusMessage, '429 rate limited', 'what staves did is not what they said');
  assert.equal(generation.body.input, undefined, 'a failure is not a reason to take their words');
});

test('an owner’s own turn is recorded in full, which is the point of tracing at all', async () => {
  const { calls, fetchImpl } = recorder();
  const complete = traced(async () => 'the answer', { name: 'interview', board: 'mine', content: 'full' }, { config, fetch: fetchImpl });
  await complete('the craft', 'what happens next?');
  await settled();
  const [trace, generation] = calls[0].body.batch;
  assert.deepEqual(generation.body.input.map((m: any) => m.content), ['the craft', 'what happens next?']);
  assert.equal(generation.body.output, 'the answer');
  assert.ok(trace.body.tags.includes('content'));
});
