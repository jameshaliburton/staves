import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Store } from "../store.js";
import { boardHandler } from "../server.js";
import { previewAlternative } from "../alternative.js";
import { fold, type Op } from "../ops.js";

async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-acceptance-"));
  try {
    const store = new Store(dir);
    await store.append("source", [
      { t: "board", id: "source", title: "Current workflow" },
      { t: "setContext", context: { langfuse: { projectId: "p", baseUrl: "https://cloud.langfuse.com" } } },
      { t: "track", track: { id: "person", name: "Reviewer", kind: "person" } },
      { t: "job", job: { id: "j", name: "Review", outcome: "Old", track: "person", inputs: [], outputs: [], status: "confirmed", provenance: { source: "human" } } },
    ], "human");
    await store.branch("source", "alt", "Intended option");
    await store.append("alt", [{ t: "updateJob", id: "j", patch: { outcome: "Better" } }], "human");
    await run(store);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function acceptance(store: Store): Promise<Extract<Op, { t: "acceptAlternative" }>> {
  const source = await store.board("source"), alternative = await store.board("alt"), baseline = (await store.baseline("alt"))!;
  return { t: "acceptAlternative", alternative, baseline, expectedBasis: previewAlternative(source, alternative, baseline).basis };
}
async function request(store: Store, method: string, payload?: unknown, duringBody?: () => Promise<void>) {
  store.watch = () => () => {};
  const handler = boardHandler(store);
  const req = { method, url: "/alternative-review?board=alt", async *[Symbol.asyncIterator]() { if (duringBody) await duringBody(); if (payload) yield JSON.stringify(payload); } } as unknown as IncomingMessage;
  let body = "";
  const res = { statusCode: 200, setHeader() {}, end(value?: string) { body += value ?? ""; } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, body };
}

test("acceptance appends one atomic intended-design operation and replays independently", () => fixture(async store => {
  const op = await acceptance(store), length = (await store.entries("source")).length;
  await store.append("source", [op], "human");
  const accepted = await store.entries("source");
  assert.equal(accepted.length, length + 1);
  assert.equal(accepted.at(-1)?.op.t, "acceptAlternative");
  assert.equal((await store.board("source")).jobs[0].outcome, "Better");
  await store.append("alt", [{ t: "updateJob", id: "j", patch: { outcome: "Later alternative" } }], "human");
  await store.append("source", [{ t: "updateJob", id: "j", patch: { name: "Later source" } }], "human");
  assert.equal(fold(accepted).jobs[0].outcome, "Better");
  const fresh = new Store(store.dir);
  assert.equal((await fresh.board("source")).jobs[0].outcome, "Better");
  assert.equal((await fresh.board("source")).jobs[0].name, "Later source");
}));
test("runtime evidence arriving after review survives intended acceptance", () => fixture(async store => {
  const op = await acceptance(store);
  await store.append("source", [
    { t: "updateJob", id: "j", patch: { implementation: { state: "implemented", note: "Previous behavior" } } },
    { t: "addExecutionEvidence", id: "j", evidence: { provider: "langfuse", projectId: "p", traceId: "t", observedAt: "2026-09-14T01:00:00Z", status: "observed" } },
  ], "human");
  const before = await store.board("source");
  const accepted = await store.append("source", [op], "human");
  assert.deepEqual(accepted.jobs[0].implementation, before.jobs[0].implementation);
  assert.deepEqual(accepted.jobs[0].executionEvidence, before.jobs[0].executionEvidence);
  assert.equal(accepted.jobs[0].status, "draft");
}));
test("stale source review rejects the entire batch without writes", () => fixture(async store => {
  const op = await acceptance(store);
  await store.append("source", [{ t: "updateJob", id: "j", patch: { outcome: "Source correction" } }], "human");
  const entries = await store.entries("source");
  await assert.rejects(store.append("source", [{ t: "setGoal", goal: "Must not leak" }, op], "human"), /changed|separately/);
  assert.deepEqual(await store.entries("source"), entries);
}));
test("stale embedded alternative cannot bypass the persisted current design", () => fixture(async store => {
  const op = await acceptance(store);
  await store.append("alt", [{ t: "updateJob", id: "j", patch: { outcome: "Changed since review" } }], "human");
  const entries = await store.entries("source");
  await assert.rejects(store.append("source", [op], "human"), /changed|stale/);
  assert.deepEqual(await store.entries("source"), entries);
}));
test("HTTP review is read-only and explicit acceptance returns source link identity", () => fixture(async store => {
  const before = await store.entries("source");
  const review = await request(store, "GET");
  assert.equal(review.status, 200);
  assert.deepEqual(await store.entries("source"), before);
  const result = await request(store, "POST", { basis: JSON.parse(review.body).basis });
  assert.equal(result.status, 200, result.body);
  assert.deepEqual(JSON.parse(result.body), { sourceBoard: "source", status: "intended-design-accepted", implementationChanged: false });
  assert.equal((await store.board("source")).jobs[0].outcome, "Better");
}));
test("HTTP alternative edit during request body requires another review", () => fixture(async store => {
  const review = await request(store, "GET");
  const before = await store.entries("source");
  const result = await request(store, "POST", { basis: JSON.parse(review.body).basis }, async () => { await store.append("alt", [{ t: "updateJob", id: "j", patch: { name: "Intervening edit" } }], "human"); });
  assert.notEqual(result.status, 200);
  assert.deepEqual(await store.entries("source"), before);
}));
test("agent authors and proposed acceptance cannot acquire design acceptance authority", () => fixture(async store => {
  const op = await acceptance(store), before = await store.entries("source");
  await assert.rejects(store.append("source", [op], "agent:coder"), /human/);
  await assert.rejects(store.append("source", [op], "human", true), /human/);
  assert.deepEqual(await store.entries("source"), before);
}));
