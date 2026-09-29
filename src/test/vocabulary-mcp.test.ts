import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../mcp.js";
import { Store } from "../store.js";
import { workflowExport } from "../export.js";
import type { DomainVocabulary } from "../vocabulary.js";

const vocabulary: DomainVocabulary = { version: 1, namespace: "purchasing", concepts: [{ id: "vendor", name: "Vendor", definition: "An organization providing goods", status: "inferred", links: [{ kind: "job", id: "review" }], sources: [{ kind: "interview", note: "private reported words" }, { kind: "repository", note: "Reviewed schema", ref: "private-schema.ts" }], mappings: [{ kind: "repository", ref: "private-vendor.ts", note: "Reported implementation association" }] }] };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "staves-vocabulary-mcp-"));
  const store = new Store(dir);
  await store.append("workflow", [
    { t: "board", id: "workflow", title: "Review suppliers" },
    { t: "track", track: { id: "human", name: "Reviewer", kind: "person" } },
    { t: "job", job: { id: "review", name: "Review request", track: "human", inputs: [], outputs: [], status: "confirmed", provenance: { source: "human", by: "reviewer" } } },
  ], "human");
  const server = buildServer(store, "test-agent", "https://staves.example/");
  const client = new Client({ name: "vocabulary-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return { store, client, cleanup: async () => { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); } };
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse((result.content as { text: string }[])[0].text) as { basis: string; vocabulary: DomainVocabulary | null; core: { version: number }; status?: string };
}

test("vocabulary MCP works without integration, reads without writes and only proposes agent changes", async () => {
  const { store, client, cleanup } = await fixture();
  try {
    const before = await store.entries("workflow");
    const context = payload(await client.callTool({ name: "staves_vocabulary", arguments: { board: "workflow" } }));
    assert.equal(context.vocabulary, null); assert.equal(context.core.version, 1);
    assert.deepEqual(await store.entries("workflow"), before);
    const result = await client.callTool({ name: "staves_vocabulary_propose", arguments: { board: "workflow", basis: context.basis, vocabulary } });
    assert.ok(!result.isError, JSON.stringify(result)); assert.equal(payload(result).status, "pending-human-review");
    assert.equal((await store.board("workflow")).vocabulary, undefined);
    const proposals = await store.proposals("workflow");
    assert.equal(proposals.length, 1); assert.equal(proposals[0].op.t, "setVocabulary");
    await store.append("workflow", [{ t: "accept", seq: proposals[0].seq }], "human");
    assert.deepEqual((await store.board("workflow")).vocabulary, vocabulary);
    const interview = await client.callTool({ name: "staves_interview", arguments: { board: "workflow" } });
    assert.match(JSON.stringify(interview), /DOMAIN VOCABULARY/);
    assert.match(JSON.stringify(interview), /An organization providing goods/);
    const stale = await client.callTool({ name: "staves_vocabulary_propose", arguments: { board: "workflow", basis: context.basis, vocabulary } });
    assert.ok(stale.isError); assert.match(JSON.stringify(stale), /vocabulary changed/);
  } finally { await cleanup(); }
});

test("vocabulary MCP rejects nonexistent workflow references without recording a proposal", async () => {
  const { store, client, cleanup } = await fixture();
  try {
    const invalid = structuredClone(vocabulary); invalid.concepts[0].links = [{ kind: "job", id: "missing" }];
    const result = await client.callTool({ name: "staves_vocabulary_propose", arguments: { board: "workflow", basis: "null", vocabulary: invalid } });
    assert.ok(result.isError); assert.equal((await store.proposals("workflow")).length, 0);
  } finally { await cleanup(); }
});

test("structured exports retain vocabulary identities but omit source material by default", async () => {
  const { store, cleanup } = await fixture();
  try {
    await store.append("workflow", [{ t: "setVocabulary", vocabulary }], "human");
    const board = await store.board("workflow");
    const packet = workflowExport(board, 4);
    assert.equal(packet.board.vocabulary?.namespace, "purchasing");
    assert.equal(packet.board.vocabulary?.concepts[0].id, "vendor");
    assert.doesNotMatch(JSON.stringify(packet), /private reported words|private-schema|private-vendor/);
    const sources = workflowExport(board, 4, { includeSources: true });
    assert.match(JSON.stringify(sources), /private-schema|private-vendor/);
    assert.doesNotMatch(JSON.stringify(sources), /private reported words/);
    assert.deepEqual(board.vocabulary, vocabulary);
  } finally { await cleanup(); }
});
