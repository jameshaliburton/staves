import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { basisOf, targetOf, type Op } from "../ops.js";
import type { ExecutionEvidence } from "../model.js";

const reference = (id: string): ExecutionEvidence => ({ provider: "langfuse", projectId: "project", traceId: "trace", observationId: id, observedAt: "2026-09-14T09:00:00.000Z", status: "observed" });
const add = (id: string): Op => ({ t: "addExecutionEvidence", id: "job", evidence: reference(id) });
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-evidence-op-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("board", [
    { t: "board", id: "board", title: "Board" },
    { t: "setContext", context: { langfuse: { baseUrl: "https://cloud.langfuse.com", projectId: "project" } } },
    { t: "job", job: { id: "job", name: "Human owned", track: "human", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed", confirmedFields: ["name"], implementation: { state: "planned" } } },
  ], "human");
  return store;
}

test("atomic concurrent evidence imports retain all observations and human design", async t => {
  const store = await fixture(t);
  const before = (await store.board("board")).jobs[0];
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.append("board", [add(`obs-${i}`)], "agent")));
  const after = (await store.board("board")).jobs[0];
  assert.equal(after.executionEvidence?.length, 12);
  const { executionEvidence: _references, ...design } = after;
  assert.deepEqual(design, before);
  await store.append("board", [add("obs-1")], "agent");
  assert.equal((await store.board("board")).jobs[0].executionEvidence?.length, 12);
  assert.deepEqual(basisOf(add("obs")), ["job"]);
  assert.deepEqual(targetOf(add("obs")), { entity: "job", id: "job" });
});

test("evidence operations remain unapplied until proposal acceptance", async t => {
  const store = await fixture(t);
  await store.append("board", [add("pending")], "agent", true);
  assert.equal((await store.board("board")).jobs[0].executionEvidence, undefined);
  const proposal = (await store.proposals("board"))[0];
  await store.append("board", [{ t: "accept", seq: proposal.seq }], "human");
  assert.equal((await store.board("board")).jobs[0].executionEvidence?.[0].observationId, "pending");
});

test("capacity is checked under the write lock and across operations in one batch", async t => {
  const store = await fixture(t);
  await store.append("board", Array.from({ length: 99 }, (_, i) => add(`obs-${i}`)), "agent");
  const result = await Promise.allSettled([store.append("board", [add("one")], "agent"), store.append("board", [add("two")], "agent")]);
  assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
  assert.equal((await store.board("board")).jobs[0].executionEvidence?.length, 100);
  await store.append("board", [add("one")], "agent");
  await assert.rejects(store.append("board", [add("new")], "agent"), /100/);
});

test("invalid project, missing jobs and private payloads fail before persistence", async t => {
  const store = await fixture(t);
  const length = (await store.entries("board")).length;
  await assert.rejects(store.append("board", [{ t: "addExecutionEvidence", id: "missing", evidence: reference("obs") }], "agent"), /active job/);
  await assert.rejects(store.append("board", [{ t: "addExecutionEvidence", id: "job", evidence: { ...reference("obs"), projectId: "other" } }], "agent"), /project/);
  const privateReference = { ...reference("obs"), input: "private" };
  await assert.rejects(store.append("board", [{ t: "addExecutionEvidence", id: "job", evidence: privateReference }], "agent"));
  assert.equal((await store.entries("board")).length, length);
  await store.append("board", [{ t: "removeJob", id: "job" }], "human");
  await assert.rejects(store.append("board", [add("obs")], "agent"), /active job/);
});
