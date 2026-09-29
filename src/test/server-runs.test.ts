import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { boardHandler } from "../server.js";
import { Store } from "../store.js";

const connection = { baseUrl: "https://cloud.langfuse.com", projectId: "project-1" };
const observation = (over: Record<string, unknown>) => ({
  projectId: "project-1", traceId: "trace-1", type: "SPAN", level: "DEFAULT",
  startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:00:01.000Z", latency: 1, ...over,
});
const tagged = (id: string, jobId: string, over: Record<string, unknown> = {}, meta: Record<string, string> = {}) =>
  observation({ id, metadata: { "staves.board_id": "flow", "staves.job_id": jobId, ...meta }, ...over });

const rows = [
  tagged("o-1", "submit", { startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:00:01.000Z" }, { "staves.case": "case-1" }),
  tagged("o-2", "check", { startTime: "2026-09-15T09:00:02.000Z", endTime: "2026-09-15T09:00:02.400Z", latency: 0.4 }, { "staves.case": "case-1", "staves.exit": "assemble" }),
  tagged("o-3", "assemble", { startTime: "2026-09-15T09:00:03.000Z", endTime: "2026-09-15T09:00:04.000Z", level: "ERROR", latency: 0.9 }, { "staves.case": "case-1" }),
  tagged("o-4", "invented", { traceId: "trace-2", startTime: "2026-09-14T09:00:00.000Z", endTime: "2026-09-14T09:00:01.000Z" }, { "staves.case": "case-2" }),
  observation({ id: "o-5", metadata: { "staves.board_id": "other", "staves.job_id": "submit" } }),
];

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-as-run-"));
  const store = new Store(dir);
  await store.append("flow", [
    { t: "board", id: "flow", title: "Flow" },
    { t: "job", job: { id: "submit", name: "Submit", track: "human", inputs: [], outputs: [], status: "draft", provenance: { source: "human" } } },
    { t: "job", job: { id: "check", name: "Check", track: "agent", inputs: [], outputs: [], status: "draft", provenance: { source: "human" } } },
    { t: "job", job: { id: "assemble", name: "Assemble", track: "agent", inputs: [], outputs: [], status: "draft", provenance: { source: "human" } } },
    { t: "job", job: { id: "register", name: "Register", track: "agent", kind: "store", inputs: [], outputs: [], status: "draft", provenance: { source: "human" } } },
  ], "human");
  store.watch = () => () => {};
  return { dir, store, handler: boardHandler(store) };
}

async function call(handler: ReturnType<typeof boardHandler>, target: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const parts: string[] = [];
  let status = 200;
  const req = { url: target, method: "GET" } as unknown as IncomingMessage;
  const res = { set statusCode(value: number) { status = value; }, get statusCode() { return status; }, setHeader() {}, end: (value?: string) => { if (value) parts.push(value); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status, body: JSON.parse(parts.join("") || "{}") as Record<string, unknown> };
}

async function withLangfuse<T>(run: () => Promise<T>, keys = { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test" }): Promise<T> {
  const originalFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return Response.json(url.pathname === "/api/public/projects" ? { data: [{ id: "project-1" }] } : { data: rows });
  }) as typeof fetch;
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.LANGFUSE_HOST;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  Object.assign(process.env, keys);
  try { return await run(); } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
}

test("the runs route reads one window in board vocabulary and names its bound", async () => {
  const { dir, store, handler } = await fixture();
  try {
    await store.append("flow", [{ t: "setContext", context: { langfuse: connection } }], "human");
    const { status, body } = await withLangfuse(() => call(handler, "/langfuse-runs?board=flow&days=30"));
    assert.equal(status, 200);
    assert.equal(body.days, 30);
    assert.equal(body.scanned, rows.length);
    assert.equal(body.truncated, false);
    assert.equal(body.cases, 2);
    const jobs = body.jobs as Record<string, { runs: number; failures: number; p50Ms: number }>;
    assert.equal(jobs.submit.runs, 1);
    assert.equal(jobs.assemble.failures, 1);
    assert.equal(jobs.check.p50Ms, 400);
    assert.deepEqual(body.exits, { check: { assemble: 1 } });
    assert.deepEqual(body.handoffs, { submit: { check: 1 }, check: { assemble: 1 } });
    const drift = body.drift as { unknownJobs: Record<string, number>; neverRan: string[] };
    assert.deepEqual(drift.unknownJobs, { invented: 1 });
    assert.deepEqual(drift.neverRan, ["register"]);
    const cases = body.recentCases as { caseId: string; steps: number; failures: number; totalMs: number }[];
    assert.deepEqual(cases.map(item => item.caseId), ["case-1", "case-2"]);
    assert.deepEqual(cases[0], { caseId: "case-1", startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:00:04.000Z", steps: 3, failures: 1, totalMs: 4000 });
    // Nothing of the trace itself travels: no prompts, inputs, outputs or free metadata.
    assert.doesNotMatch(JSON.stringify(body), /o-1|trace-1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("one case replays as a path, and a missing case id is refused", async () => {
  const { dir, store, handler } = await fixture();
  try {
    await store.append("flow", [{ t: "setContext", context: { langfuse: connection } }], "human");
    const replay = await withLangfuse(() => call(handler, "/langfuse-run?board=flow&case=case-1"));
    assert.equal(replay.status, 200);
    assert.equal(replay.body.caseId, "case-1");
    assert.equal(replay.body.totalMs, 4000);
    assert.equal(replay.body.failures, 1);
    assert.deepEqual((replay.body.steps as { jobId: string; known: boolean }[]).map(step => step.jobId), ["submit", "check", "assemble"]);
    const missing = await withLangfuse(() => call(handler, "/langfuse-run?board=flow"));
    assert.equal(missing.status, 400);
    assert.match(String(missing.body.error), /Choose a case/);
    const oversized = await withLangfuse(() => call(handler, "/langfuse-run?board=flow&case=" + "c".repeat(201)));
    assert.equal(oversized.status, 400);
    assert.match(String(oversized.body.error), /up to 200 characters/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an unconnected board and a keyless process each answer with the existing message", async () => {
  const { dir, store, handler } = await fixture();
  try {
    const unconnected = await withLangfuse(() => call(handler, "/langfuse-runs?board=flow"));
    assert.equal(unconnected.status, 400);
    assert.match(String(unconnected.body.error), /Connect a Langfuse project first with staves_langfuse_connect/);
    await store.append("flow", [{ t: "setContext", context: { langfuse: connection } }], "human");
    const keyless = await withLangfuse(() => call(handler, "/langfuse-runs?board=flow"), {} as { LANGFUSE_PUBLIC_KEY: string; LANGFUSE_SECRET_KEY: string });
    assert.equal(keyless.status, 400);
    assert.match(String(keyless.body.error), /Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY/);
    // The daemon inherits the environment of whatever started it, so the message says whose.
    assert.match(String(keyless.body.error), /process serving this board/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
