// Read one real observation through MCP into an isolated proposal, then remove the fixture.
// node --env-file=.env.local scripts/verify-langfuse-import.mjs PROJECT TRACE OBSERVATION [--platform-fixture]
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../dist/store.js';
import { buildServer } from '../dist/mcp.js';

const [projectId, traceId, observationId, mode] = process.argv.slice(2);
if (![projectId, traceId, observationId].every(value => /^[A-Za-z0-9_-]+$/.test(value || '')) || (mode && mode !== '--platform-fixture')) {
  throw new Error('Supply PROJECT TRACE OBSERVATION and optionally --platform-fixture for an explicitly synthetic Staves trace.');
}
// This explicit test-only switch is not an application credential fallback.
if (mode === '--platform-fixture') {
  for (const name of ['PUBLIC_KEY', 'SECRET_KEY', 'BASE_URL']) {
    const value = process.env[`STAVES_LANGFUSE_${name}`];
    if (!value) throw new Error('Platform fixture credentials are incomplete.');
    process.env[`LANGFUSE_${name}`] = value;
  }
}
const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
const dir = await mkdtemp(join(tmpdir(), 'staves-live-import-'));
const store = new Store(dir);
const server = buildServer(store, 'agent:acceptance', 'http://localhost/');
const client = new Client({ name: 'staves-live-import-acceptance', version: '1' });
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`Acceptance failed at ${name}: ${result.content?.find(item => item.type === 'text')?.text || 'tool error'}`);
  const text = result.content.find(item => item.type === 'text').text;
  return name === 'staves_langfuse_connect' ? text : JSON.parse(text);
}
try {
  await store.append('acceptance', [
    { t: 'board', id: 'acceptance', title: 'Isolated evidence import acceptance' },
    { t: 'track', track: { id: 'system', name: 'Test system', kind: 'system' } },
    { t: 'job', job: { id: 'capture', name: 'Test observation import', track: 'system', inputs: [], outputs: [], status: 'draft', provenance: { source: 'agent', by: 'acceptance' }, implementation: { state: 'planned' } } },
  ], 'agent:acceptance');
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  await call('staves_langfuse_connect', { board: 'acceptance', baseUrl, projectId });
  const before = (await store.board('acceptance')).jobs[0];
  const result = await call('staves_langfuse_evidence', {
    board: 'acceptance', job: 'capture', traceId, observationId,
    associationRationale: 'Isolated integration acceptance fixture only; this observation is not evidence of a customer workflow or of this job being implemented.',
  });
  assert.equal(result.status, 'pending-human-review');
  assert.equal(result.evidence.mapping.method, 'proposed');
  assert.equal(result.evidence.mapping.reviewedBy, undefined);
  assert.deepEqual((await store.board('acceptance')).jobs[0], before);
  const proposals = await store.proposals('acceptance');
  assert.ok(proposals.length > 0);
  const retained = { entries: await store.entries('acceptance'), proposals };
  const saved = JSON.stringify(retained);
  for (const key of ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']) {
    assert.ok(process.env[key] && !saved.includes(process.env[key]), 'Credentials must not be retained');
  }
  const forbidden = new Set(['input', 'output', 'metadata', 'statusMessage']);
  function checkPayload(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `Raw payload field retained: ${key}`);
      checkPayload(child);
    }
  }
  checkPayload(result.evidence);
  checkPayload(retained);
  console.log(JSON.stringify({ passed: true, fixture: mode === '--platform-fixture' ? 'synthetic-platform-trace' : 'selected-observation', projectId, traceId, observationId, mapping: result.evidence.mapping.method, status: result.status, jobUnchanged: true, rawPayloadExcluded: true, credentialsExcluded: true, proposals: proposals.length, traceUrl: result.traceUrl }));
} finally {
  await client.close().catch(() => {});
  await server.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
