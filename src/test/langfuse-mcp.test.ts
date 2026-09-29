import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../mcp.js";
import { Store } from "../store.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "staves-langfuse-mcp-"));
  const store = new Store(dir);
  await store.append("workflow", [
    { t: "board", id: "workflow", title: "Review a request" },
    { t: "setContext", context: { purpose: "Keep human accountability", words: ["review"] } },
    { t: "job", job: { id: "review", name: "Review request", track: "human", inputs: [], outputs: [], status: "confirmed", provenance: { source: "human", by: "reviewer" }, implementation: { state: "planned" } } },
    { t: "job", job: { id: "route", name: "Route request", track: "human", inputs: [], outputs: [], status: "confirmed", provenance: { source: "human", by: "reviewer" }, implementation: { state: "planned" }, exits: [{ condition: "source found", target: "assemble" }, { condition: "nothing found", target: "stop" }] } },
    { t: "job", job: { id: "assemble", name: "Assemble reply", track: "human", inputs: [], outputs: [], status: "confirmed", provenance: { source: "human", by: "reviewer" }, implementation: { state: "planned" } } },
  ], "human");
  const server = buildServer(store, "test-agent", "https://staves.example/");
  const client = new Client({ name: "langfuse-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return { store, client, cleanup: async () => { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("Langfuse connection preserves interview context and instrumentation captures a read-only design snapshot", async () => {
  const { store, client, cleanup } = await fixture();
  try {
    const connected = await client.callTool({ name: "staves_langfuse_connect", arguments: { board: "workflow", baseUrl: "https://cloud.langfuse.com", projectId: "project-one" } });
    assert.ok(!connected.isError, JSON.stringify(connected));
    const current = await store.board("workflow");
    assert.equal(current.context?.purpose, "Keep human accountability");
    assert.deepEqual(current.context?.words, ["review"]);
    const before = await store.entries("workflow");
    const instrument = await client.callTool({ name: "staves_langfuse_instrumentation", arguments: { board: "workflow", job: "review" } });
    assert.ok(!instrument.isError);
    const output = JSON.parse((instrument.content as { text: string }[])[0].text) as { metadata: Record<string, string>; boardUrl: string; guidance: string };
    assert.deepEqual(output.metadata, {
      "staves.board_id": "workflow",
      "staves.job_id": "review",
      "staves.design_revision": String(before.at(-1)?.seq),
      "staves.exit": "<the id of the job the work went to next from a decision, or stop>",
      "staves.case": "<one id shared by every observation of the same unit of work; omit when one trace is one case>",
    });
    assert.match(output.guidance, /Set staves\.exit on the decision job's observation to the id of the job the work went to next \(or stop\), and staves\.case on every observation of one unit of work when a trace is not one case\. These let staves_langfuse_runs count exits and replay a case; they carry no prompt or output\./);
    assert.equal(output.boardUrl, "https://staves.example/?board=workflow");
    assert.deepEqual(await store.entries("workflow"), before);

    const decisionInstrument = await client.callTool({ name: "staves_langfuse_instrumentation", arguments: { board: "workflow", job: "route" } });
    assert.ok(!decisionInstrument.isError);
    const decisionOutput = JSON.parse((decisionInstrument.content as { text: string }[])[0].text) as { metadata: Record<string, string> };
    assert.equal(decisionOutput.metadata["staves.exit"], "one of: assemble, stop");
    assert.equal(decisionOutput.metadata["staves.board_id"], "workflow");
    assert.equal(decisionOutput.metadata["staves.job_id"], "route");
    assert.equal(decisionOutput.metadata["staves.case"], "<one id shared by every observation of the same unit of work; omit when one trace is one case>");
    await client.callTool({ name: "staves_langfuse_connect", arguments: { board: "workflow", baseUrl: "https://cloud.langfuse.com", projectId: "project-one" } });
    assert.deepEqual(await store.entries("workflow"), before);
    const missing = await client.callTool({ name: "staves_langfuse_instrumentation", arguments: { board: "workflow", job: "missing" } });
    assert.ok(missing.isError);
  } finally { await cleanup(); }
});

test("Langfuse duplicate imports are idempotent without credentials and retain human status", async () => {
  const { store, client, cleanup } = await fixture();
  try {
    await client.callTool({ name: "staves_langfuse_connect", arguments: { board: "workflow", baseUrl: "https://cloud.langfuse.com", projectId: "project-one" } });
    await store.append("workflow", [{ t: "addExecutionEvidence", id: "review", evidence: { provider: "langfuse", projectId: "project-one", traceId: "trace-one", observationId: "observation-one", observedAt: "2026-09-14T10:00:00.000Z", status: "observed", designRevision: "3" } }], "test-agent");
    const before = await store.entries("workflow");
    const result = await client.callTool({ name: "staves_langfuse_evidence", arguments: { board: "workflow", job: "review", traceId: "trace-one", observationId: "observation-one" } });
    assert.ok(!result.isError, JSON.stringify(result));
    const duplicate = JSON.parse((result.content as { text: string }[])[0].text) as { status: string; key: string; traceUrl: string };
    assert.equal(duplicate.status, "already-linked");
    assert.equal(JSON.parse(duplicate.key)[4], "observation-one");
    assert.match(duplicate.traceUrl, /observation=observation-one/);
    assert.deepEqual(await store.entries("workflow"), before);
    const job = (await store.board("workflow")).jobs[0];
    assert.equal(job.status, "confirmed");
    assert.equal(job.provenance.source, "human");
    assert.equal(job.implementation?.state, "planned");
  } finally { await cleanup(); }
});

test("Langfuse observation import adds only evidence to a human-confirmed planned job", async () => {
  const { store, client, cleanup } = await fixture();
  const originalFetch = globalThis.fetch;
  const envKeys = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"] as const;
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
    globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).includes("/projects") ? { data: [{ id: "project-one" }] } : { data: [{ id: "observation-one", traceId: "trace-one", projectId: "project-one", startTime: "2026-09-14T10:00:00.000Z", endTime: "2026-09-14T10:00:01.500Z", level: "DEFAULT", metadata: { "staves.board_id": "workflow", "staves.job_id": "review", "staves.design_revision": "3" }, input: "private prompt", output: "private result" }] }), { headers: { "content-type": "application/json" } });
    await client.callTool({ name: "staves_langfuse_connect", arguments: { board: "workflow", baseUrl: "https://cloud.langfuse.com", projectId: "project-one" } });
    const before = (await store.board("workflow")).jobs[0];
    const result = await client.callTool({ name: "staves_langfuse_evidence", arguments: { board: "workflow", job: "review", traceId: "trace-one", observationId: "observation-one" } });
    assert.ok(!result.isError, JSON.stringify(result));
    const { executionEvidence, ...after } = (await store.board("workflow")).jobs[0];
    assert.deepEqual(after, before);
    assert.equal(executionEvidence?.length, 1);
    assert.equal(executionEvidence?.[0].durationMs, 1500);
    assert.equal(executionEvidence?.[0].designRevision, "3");
    assert.doesNotMatch(JSON.stringify(await store.entries("workflow")), /private prompt|private result|sk-test|pk-test/);
    const entries = await store.entries("workflow");
    await client.callTool({ name: "staves_langfuse_evidence", arguments: { board: "workflow", job: "review", traceId: "trace-one", observationId: "observation-one" } });
    assert.deepEqual(await store.entries("workflow"), entries);

    // A scoped gateway may demote a conflicting evidence replacement into a proposal.
    const append = store.append.bind(store);
    store.append = (board, ops, by, propose = false) => append(board, ops, by, propose || ops.some(op => op.t === "addExecutionEvidence"));
    globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).includes("/projects") ? { data: [{ id: "project-one" }] } : { data: [{ id: "observation-two", traceId: "trace-one", projectId: "project-one", startTime: "2026-09-14T10:01:00.000Z", level: "DEFAULT", metadata: { "staves.board_id": "workflow", "staves.job_id": "review" } }] }), { headers: { "content-type": "application/json" } });
    const pending = await client.callTool({ name: "staves_langfuse_evidence", arguments: { board: "workflow", job: "review", traceId: "trace-one", observationId: "observation-two" } });
    assert.ok(!pending.isError, JSON.stringify(pending));
    const pendingResult = JSON.parse((pending.content as { text: string }[])[0].text) as { status: string; evidence: { observationId: string } };
    assert.equal(pendingResult.status, "pending-human-review");
    assert.equal(pendingResult.evidence.observationId, "observation-two");
    assert.equal((await store.board("workflow")).jobs[0].executionEvidence?.length, 1);
    assert.equal((await store.proposals("workflow")).length, 1);

    store.append = append;
    globalThis.fetch = async (input) => {
      const request = new URL(String(input));
      if (request.pathname.endsWith("/projects")) return new Response(JSON.stringify({ data: [{ id: "project-one" }] }));
      const filter = request.searchParams.get("filter") ?? "";
      const id = filter.includes("observation-three") ? "observation-three" : "observation-four";
      return new Response(JSON.stringify({ data: [{ id, traceId: "trace-one", projectId: "project-one", startTime: "2026-09-14T10:02:00.000Z", level: "DEFAULT", metadata: { "staves.board_id": "workflow", "staves.job_id": "review" } }] }));
    };
    const concurrent = await Promise.all(["observation-three", "observation-four"].map(observationId => client.callTool({ name: "staves_langfuse_evidence", arguments: { board: "workflow", job: "review", traceId: "trace-one", observationId } })));
    for (const response of concurrent) assert.ok(!response.isError, JSON.stringify(response));
    assert.deepEqual((await store.board("workflow")).jobs[0].executionEvidence?.map(item => item.observationId).sort(), ["observation-four", "observation-one", "observation-three"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    await cleanup();
  }
});

/* ---------- as run: the window read back in board vocabulary ---------- */

const langfuseEnv = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"] as const;

/** Run one body with the credentials the reader expects, restoring whatever was there before. */
async function withCredentials(env: Partial<Record<(typeof langfuseEnv)[number], string>>, body: () => Promise<void>) {
  const saved = Object.fromEntries(langfuseEnv.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const key of langfuseEnv) delete process.env[key];
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    await body();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of langfuseEnv) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}

/** A board of three jobs already connected to a project, for the two cases below to have run against. */
async function asRunFixture() {
  const made = await fixture();
  const drawn = { track: "human" as const, inputs: [], outputs: [], status: "confirmed" as const, provenance: { source: "human" as const, by: "reviewer" }, implementation: { state: "planned" as const } };
  await made.store.append("workflow", [
    { t: "job", job: { id: "decide", name: "Decide", ...drawn } },
    { t: "job", job: { id: "publish", name: "Publish", ...drawn } },
    { t: "setContext", context: { langfuse: { baseUrl: "https://cloud.langfuse.com", projectId: "project-one" } } },
  ], "human");
  return made;
}

const observed = (over: Record<string, unknown>) => ({ projectId: "project-one", traceId: "trace-one", level: "DEFAULT", type: "SPAN", ...over });
/** Two cases: one that decided and stopped, one still on its way through a job the board lost. */
const ran = [
  observed({ id: "obs-1", startTime: "2026-09-14T10:00:00.000Z", endTime: "2026-09-14T10:00:02.000Z", latency: 2, name: "Review request", input: "private prompt",
    metadata: { "staves.board_id": "workflow", "staves.job_id": "review", "staves.case": "case-one", "staves.exit": "decide" } }),
  observed({ id: "obs-2", startTime: "2026-09-14T10:00:03.000Z", endTime: "2026-09-14T10:00:05.000Z", latency: 2, level: "ERROR",
    metadata: { attributes: { "staves.board_id": "workflow", "staves.job_id": "decide", "staves.case": "case-one", "staves.exit": "stop" } } }),
  observed({ id: "obs-3", traceId: "trace-two", startTime: "2026-09-14T11:00:00.000Z", endTime: "2026-09-14T11:00:01.000Z", latency: 1,
    metadata: { "staves.board_id": "workflow", "staves.job_id": "review" } }),
  observed({ id: "obs-4", traceId: "trace-two", startTime: "2026-09-14T11:00:01.000Z", latency: 0.01,
    metadata: { "staves.board_id": "workflow", "staves.job_id": "ghost" } }),
];

/** The projects check, then one page of observations, then the end of the scan. */
function servePages(rows: Record<string, unknown>[]) {
  const seen: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const at = new URL(String(input));
    seen.push(at);
    if (at.pathname === "/api/public/projects") return Response.json({ data: [{ id: "project-one" }] });
    const done = at.searchParams.get("cursor") !== null;
    return Response.json({ data: done ? [] : rows, meta: { cursor: done ? null : "1" } });
  }) as typeof fetch;
  return seen;
}

const answer = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;
const credentials = { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test", LANGFUSE_BASE_URL: "https://cloud.langfuse.com" };

test("as run counts a board's window in its own vocabulary, with the bound of the scan", async () => {
  const { client, cleanup } = await asRunFixture();
  try {
    await withCredentials(credentials, async () => {
      const seen = servePages(ran);
      const result = await client.callTool({ name: "staves_langfuse_runs", arguments: { board: "workflow", days: 1 } });
      assert.ok(!result.isError, JSON.stringify(result));
      const runs = answer(result) as unknown as {
        window: { from: string; to: string }; scanned: number; truncated: boolean; cases: number;
        jobs: Record<string, { runs: number; failures: number; p50Ms: number; p95Ms: number; firstSeen: string; lastSeen: string } | undefined>;
        exits: Record<string, Record<string, number>>; handoffs: Record<string, Record<string, number>>;
        drift: { unknownJobs: Record<string, number>; neverRan: string[] }; boardUrl: string; guidance: string;
      };
      assert.equal(Date.parse(runs.window.to) - Date.parse(runs.window.from), 86_400_000);
      assert.equal(runs.scanned, 4);
      assert.equal(runs.truncated, false);
      assert.equal(runs.cases, 2);
      assert.deepEqual(runs.jobs.review, { runs: 2, failures: 0, p50Ms: 1000, p95Ms: 2000, firstSeen: "2026-09-14T10:00:00.000Z", lastSeen: "2026-09-14T11:00:00.000Z" });
      assert.deepEqual(runs.jobs.decide, { runs: 1, failures: 1, p50Ms: 2000, p95Ms: 2000, firstSeen: "2026-09-14T10:00:03.000Z", lastSeen: "2026-09-14T10:00:03.000Z" });
      assert.equal(runs.jobs.publish, undefined);
      assert.deepEqual(runs.exits, { review: { decide: 1 }, decide: { stop: 1 } });
      assert.deepEqual(runs.handoffs, { review: { decide: 1 } });
      assert.deepEqual(runs.drift, { unknownJobs: { ghost: 1 }, neverRan: ["route", "assemble", "publish"] });
      assert.equal(runs.boardUrl, "https://staves.example/?board=workflow");
      assert.equal(runs.guidance, "Measurements, not approval. A job with runs is not thereby implemented as designed; a job with none is not thereby missing. Raise drift as staves_ask questions if the person should decide.");
      assert.doesNotMatch(JSON.stringify(runs), /private prompt|pk-test|sk-test/);
      assert.equal(seen[1].searchParams.get("fields"), "core,basic,metadata");
    });
  } finally { await cleanup(); }
});

test("as run replays one case as a path through the board", async () => {
  const { client, cleanup } = await asRunFixture();
  try {
    await withCredentials(credentials, async () => {
      servePages(ran);
      const result = await client.callTool({ name: "staves_langfuse_run", arguments: { board: "workflow", case: "case-one", days: 1 } });
      assert.ok(!result.isError, JSON.stringify(result));
      const replay = answer(result) as unknown as { caseId: string; traceIds: string[]; totalMs: number; failures: number; boardUrl: string; steps: { jobId: string; known: boolean; level: string; exitId?: string }[] };
      assert.equal(replay.caseId, "case-one");
      assert.deepEqual(replay.traceIds, ["trace-one"]);
      assert.deepEqual(replay.steps.map(step => [step.jobId, step.known, step.level, step.exitId ?? null]), [["review", true, "DEFAULT", "decide"], ["decide", true, "ERROR", "stop"]]);
      assert.equal(replay.totalMs, 5000);
      assert.equal(replay.failures, 1);
      assert.equal(replay.boardUrl, "https://staves.example/?board=workflow");

      // The trace id names the same unit of work where nothing set staves.case, and a job the
      // board no longer has is still shown — marked unknown rather than dropped.
      const byTrace = await client.callTool({ name: "staves_langfuse_run", arguments: { board: "workflow", case: "trace-two" } });
      assert.ok(!byTrace.isError, JSON.stringify(byTrace));
      const other = answer(byTrace) as unknown as { caseId: string; steps: { jobId: string; known: boolean }[] };
      assert.deepEqual(other.steps.map(step => [step.jobId, step.known]), [["review", true], ["ghost", false]]);
    });
  } finally { await cleanup(); }
});

test("as run says what is missing: no connected project, then no credentials", async () => {
  const { client, cleanup } = await fixture();
  try {
    await withCredentials({}, async () => {
      servePages(ran);
      for (const name of ["staves_langfuse_runs", "staves_langfuse_run"]) {
        const unconnected = await client.callTool({ name, arguments: { board: "workflow", case: "case-one" } });
        assert.ok(unconnected.isError, JSON.stringify(unconnected));
        assert.match(JSON.stringify(unconnected.content), /Select a project with staves_langfuse_connect; use staves_langfuse_probe to discover and verify your configured project first\./);
      }
      await client.callTool({ name: "staves_langfuse_connect", arguments: { board: "workflow", baseUrl: "https://cloud.langfuse.com", projectId: "project-one" } });
      const unconfigured = await client.callTool({ name: "staves_langfuse_runs", arguments: { board: "workflow" } });
      assert.ok(unconfigured.isError, JSON.stringify(unconfigured));
      assert.match(JSON.stringify(unconfigured.content), /Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the coding agent environment/);
    });
  } finally { await cleanup(); }
});

test("the catalogue offers both as-run tools as Langfuse evidence", async () => {
  const { client, cleanup } = await fixture();
  try {
    const help = await client.callTool({ name: "staves_help", arguments: {} });
    const printed = (help.content as { text: string }[]).map(part => part.text).join("\n");
    const group = (printed.split("\n").find(line => line.includes("staves_langfuse_connect")) ?? "").trim().split(" · ");
    assert.ok(group.includes("staves_langfuse_runs"), printed);
    assert.ok(group.includes("staves_langfuse_run"), printed);
    assert.equal(printed.includes("not yet catalogued"), false, printed);
  } finally { await cleanup(); }
});
