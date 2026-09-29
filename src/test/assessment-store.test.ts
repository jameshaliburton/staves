import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { saveAssessmentRequest, saveAssessmentReturn, getAssessment } from "../assessment-store.js";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-assessment-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("work", [
    { t: "board", id: "work", title: "Review" },
    { t: "track", track: { id: "reviewer", name: "Reviewer", kind: "person" } },
    { t: "job", job: { id: "review", name: "Review evidence", track: "reviewer", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
  ], "J");
  return store;
}
const payload = (requestId: string) => ({ requestId, reportedBy: "spoofed", reportedAt: "not-a-date", repositoryAccess: "unavailable", jobs: [{ jobId: "review", conclusion: "unknown", reason: "No repository access" }], tests: [{ jobIds: ["review"], scope: "Review integration", status: "not-run" }], limitations: ["Repository unavailable"] });

test("saved request pins original revision and return actor is authoritative", async t => {
  const store = await setup(t);
  const request = await saveAssessmentRequest(store, "work", { rationale: "Assess reliability" }, "J");
  assert.equal(request.source.revision, 3);
  assert.equal(request.capturedBy, "J");
  assert.equal(request.intent, "assess");
  const receipt = await saveAssessmentReturn(store, "work", request.id, payload(request.id), "trusted-agent");
  assert.equal(receipt.status, "current");
  assert.equal(receipt.result.reportedBy, "trusted-agent");
  assert.ok(Number.isFinite(Date.parse(receipt.result.reportedAt)));
  const saved = await getAssessment(store, "work", request.id);
  assert.deepEqual(saved.request, JSON.parse(JSON.stringify(request)));
  assert.equal(saved.returns[0].result.tests[0].status, "not-run");
  const board = await store.board("work");
  const record = board.comments.find(comment => comment.assessment?.kind === "return")?.assessment;
  assert.equal(record?.kind, "return");
  assert.ok(record && !("request" in record));
  assert.equal(board.jobs[0].status, "confirmed");
  assert.equal(board.jobs[0].implementation, undefined);
});

test("later design edits recalculate stale status while preserving receipt and original snapshot", async t => {
  const store = await setup(t);
  const request = await saveAssessmentRequest(store, "work", {}, "J");
  await saveAssessmentReturn(store, "work", request.id, payload(request.id), "agent");
  await store.append("work", [{ t: "job", job: { ...(await store.board("work")).jobs[0], outcome: "Changed outcome" } }], "J");
  const saved = await getAssessment(store, "work", request.id);
  assert.equal(saved.returns[0].status, "stale");
  assert.equal(saved.returns[0].statusAtReceipt, "current");
  assert.equal(saved.request.packet.board.jobs[0].outcome, undefined);
  const stale = await saveAssessmentReturn(store, "work", request.id, payload(request.id), "agent");
  assert.equal(stale.requiresReconciliation, true);
  assert.equal((await getAssessment(store, "work", request.id)).returns[1].statusAtReceipt, "stale");
  assert.equal((await store.board("work")).jobs[0].implementation, undefined);
});

test("missing requests and mismatched returns are rejected without adding records", async t => {
  const store = await setup(t);
  await assert.rejects(getAssessment(store, "work", "missing"), /not found/);
  await assert.rejects(saveAssessmentReturn(store, "work", "missing", payload("missing"), "agent"), /not found/);
  const request = await saveAssessmentRequest(store, "work", {}, "J");
  await assert.rejects(saveAssessmentReturn(store, "work", request.id, payload("wrong-request"), "agent"), /original/);
  assert.equal((await getAssessment(store, "work", request.id)).returns.length, 0);
});

test("duplicate active request identities are rejected explicitly", async t => {
  const store = await setup(t);
  const request = await saveAssessmentRequest(store, "work", {}, "J");
  const board = await store.board("work");
  board.comments.push({ ...board.comments[0], id: "duplicate" });
  // Simulate a legacy imported duplicate, even when normal append validation rejects it.
  const duplicateStore = { entries: async () => [{ seq: 1, at: "2026-09-14", by: "J", op: { t: "baseline", baseline: { pinned: true, id: "pin", name: "Baseline", sourceBoard: "work", sourceRevision: "1", capturedAt: "2026-09-14", capturedBy: "J" }, snapshot: board } }] } as unknown as Store;
  await assert.rejects(getAssessment(duplicateStore, "work", request.id), /Duplicate assessment/);
});


test("assessment identity cannot be removed or replaced and pending warnings survive ingestion", async t => {
  const store = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "review", patch: { name: "Proposed" } }], "agent", true);
  const request = await saveAssessmentRequest(store, "work", {}, "J");
  assert.equal(request.packet.omitted.pendingProposals, 1);
  assert.ok(request.packet.warnings.some(warning => warning.includes("unaccepted proposal")));
  await assert.rejects(store.append("work", [{ t: "removeComment", id: `assessment:${request.id}` }], "J"), /immutable/);
  await assert.rejects(store.append("work", [{ t: "revert", of: "old", entity: "comment", id: `assessment:${request.id}`, prior: null }], "J"), /immutable/);
  await assert.rejects(store.append("work", [{ t: "comment", comment: { id: "different", by: "J", about: "board", text: "Reused", assessment: { kind: "request", request } } }], "J"), /identity/);
});

test("return response uses committed freshness after an intervening edit", async t => {
  const store = await setup(t);
  const request = await saveAssessmentRequest(store, "work", {}, "J");
  const append = store.append.bind(store);
  let intervene = true;
  store.append = async (...args) => {
    if (intervene) { intervene = false; await append("work", [{ t: "updateJob", id: "review", patch: { name: "Changed during return" } }], "J"); }
    return append(...args);
  };
  const receipt = await saveAssessmentReturn(store, "work", request.id, payload(request.id), "agent");
  assert.equal(receipt.status, "stale");
  assert.equal(receipt.requiresReconciliation, true);
  assert.ok(!(await store.board("work")).comments.some(comment => comment.text.includes("(current)")));
});

test("agent inbox pins scope and enforces claim ownership and completion evidence", async t => {
  const store = await setup(t);
  const { listAssessmentRequests, updateAssessmentDelivery } = await import("../assessment-store.js");
  const request = await saveAssessmentRequest(store, "work", {}, "human");
  assert.equal((await listAssessmentRequests(store, "work"))[0].delivery.status, "queued");
  await assert.rejects(updateAssessmentDelivery(store, "work", request.id, { status: "running" }, "agent"), /transition/);
  await updateAssessmentDelivery(store, "work", request.id, { status: "claimed" }, "agent");
  await assert.rejects(updateAssessmentDelivery(store, "work", request.id, { status: "claimed" }, "other"), /transition/);
  await assert.rejects(updateAssessmentDelivery(store, "work", request.id, { status: "running" }, "other"), /claiming agent/);
  await updateAssessmentDelivery(store, "work", request.id, { status: "running" }, "agent");
  await assert.rejects(updateAssessmentDelivery(store, "work", request.id, { status: "completed" }, "agent"), /Record a result/);
  await saveAssessmentReturn(store, "work", request.id, payload(request.id), "agent");
  await updateAssessmentDelivery(store, "work", request.id, { status: "completed" }, "agent");
  assert.equal((await getAssessment(store, "work", request.id)).delivery.status, "completed");
  assert.equal((await listAssessmentRequests(store, "work"))[0].request.source.revision, 3);
  await assert.rejects(updateAssessmentDelivery(store, "work", request.id, { status: "running" }, "agent"), /transition/);
});

test("conversation-only requests require an outcome and preserve failures", async t => {
  const store = await setup(t);
  const { updateAssessmentDelivery } = await import("../assessment-store.js");
  const request = await saveAssessmentRequest(store, "work", { intent: "discuss", rationale: "Explain the selected workflow" }, "human");
  await updateAssessmentDelivery(store, "work", request.id, { status: "claimed" }, "agent");
  await updateAssessmentDelivery(store, "work", request.id, { status: "running" }, "agent");
  await assert.rejects(updateAssessmentDelivery(store, "work", request.id, { status: "completed" }, "agent"), /Summarize/);
  await updateAssessmentDelivery(store, "work", request.id, { status: "failed", note: "Project unavailable" }, "agent");
  const saved = await getAssessment(store, "work", request.id);
  assert.equal(saved.delivery.status, "failed");
  assert.equal(saved.delivery.note, "Project unavailable");
});

test("concurrent inbox claims have one winner", async t => {
  const store = await setup(t);
  const { updateAssessmentDelivery } = await import("../assessment-store.js");
  const request = await saveAssessmentRequest(store, "work", {}, "human");
  const claims = await Promise.allSettled(["one", "two"].map(actor => updateAssessmentDelivery(store, "work", request.id, { status: "claimed" }, actor)));
  assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(claims.filter(result => result.status === "rejected").length, 1);
});
