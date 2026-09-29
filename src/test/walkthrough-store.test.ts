import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { Store } from "../store.js";
import { saveWalkthrough, getWalkthrough, listWalkthroughs } from "../walkthrough-store.js";
import { normalizeWalkthroughRecord, protectWalkthroughHistory } from "../walkthrough-record.js";
import { workflowExport } from "../export.js";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp("/tmp/staves-walkthrough-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("work", [
    { t: "board", id: "work", title: "Review" },
    { t: "track", track: { id: "reviewer", name: "Reviewer", kind: "person" } },
    { t: "job", job: { id: "review", name: "Review evidence", track: "reviewer", inputs: [], outputs: [], prerequisites: { kind: "all", inputs: [] }, provenance: { source: "human" }, status: "confirmed" } },
  ], "J");
  return store;
}

const example = { name: "Normal case", initialArtifacts: [] };

test("saved walkthroughs retain reproducible inputs and source without recursive comments", async t => {
  const store = await setup(t);
  const first = await saveWalkthrough(store, "work", example, "J");
  const second = await saveWalkthrough(store, "work", { ...example, name: "Second case" }, "J");
  assert.equal(first.sourceRevision, 3);
  assert.equal(first.actor, "J");
  assert.deepEqual(second.result.snapshot.comments, []);
  assert.equal(first.result.status, "complete");
  assert.deepEqual(first.result.steps.map(step => step.jobId), ["review"]);
  const saved = await getWalkthrough(store, "work", first.id);
  assert.equal(saved.status, "current");
  assert.deepEqual(saved.run, JSON.parse(JSON.stringify(first)));
  assert.equal((await listWalkthroughs(store, "work")).length, 2);
  const packet = workflowExport(await store.board("work"), 5);
  assert.ok(packet.board.comments.every(comment => !comment.walkthrough));
});

test("semantic changes stale saved runs without rewriting their original case or snapshot", async t => {
  const store = await setup(t);
  const run = await saveWalkthrough(store, "work", example, "J");
  await store.append("work", [{ t: "comment", comment: { id: "note", about: "board", by: "J", text: "Review note" } }], "J");
  assert.equal((await getWalkthrough(store, "work", run.id)).status, "current");
  await store.append("work", [{ t: "updateJob", id: "review", patch: { outcome: "Revised outcome" } }], "J");
  const stale = await getWalkthrough(store, "work", run.id);
  assert.equal(stale.status, "stale");
  assert.equal(stale.requiresReconciliation, true);
  assert.equal(stale.run.result.snapshot.jobs[0].outcome, undefined);
  assert.deepEqual(stale.run.result.case, example);
});

test("ingestion recomputes spoofed results and source metadata and rejects raced design", async t => {
  const store = await setup(t);
  const run = await saveWalkthrough(store, "work", example, "J");
  const spoofed = structuredClone(run);
  spoofed.actor = "spoofed";
  spoofed.sourceRevision = 999;
  spoofed.result.steps = [];
  spoofed.result.outcomes = [];
  spoofed.result.status = "waiting";
  const board = await store.board("work");
  const normalized = normalizeWalkthroughRecord(board, spoofed, "trusted-agent", "2026-09-14T12:00:00Z", 4, 2);
  assert.equal(normalized.actor, "trusted-agent");
  assert.equal(normalized.sourceRevision, 4);
  assert.equal(normalized.omittedPendingProposals, 2);
  assert.equal(normalized.result.status, "complete");
  assert.equal(normalized.result.steps.length, 1);
  board.jobs[0].outcome = "Changed during request";
  assert.throws(() => normalizeWalkthroughRecord(board, spoofed, "agent", "2026-09-14T12:00:00Z", 5), /design changed/);
});

test("history guard protects removal, undo, comment replacement and tombstoned run identity", async t => {
  const store = await setup(t);
  const run = await saveWalkthrough(store, "work", example, "J");
  const board = await store.board("work");
  const entries = await store.entries("work");
  const comment = board.comments.find(value => value.walkthrough?.id === run.id)!;
  assert.throws(() => protectWalkthroughHistory(board, entries, { t: "removeComment", id: comment.id }), /immutable/);
  assert.throws(() => protectWalkthroughHistory(board, entries, { t: "revert", of: "prior", entity: "comment", id: comment.id, prior: null }), /immutable/);
  assert.throws(() => protectWalkthroughHistory(board, entries, { t: "comment", comment: { ...comment, walkthrough: undefined, text: "replaced" } }), /immutable/);
  board.comments = [];
  assert.throws(() => protectWalkthroughHistory(board, entries, { t: "comment", comment: { ...comment, id: "another-comment" } }), /identity/);
});

test("pending proposals are omitted explicitly and invalid requests leave no run", async t => {
  const store = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "review", patch: { name: "Pending name" } }], "agent", true);
  const run = await saveWalkthrough(store, "work", example, "J");
  assert.equal(run.omittedPendingProposals, 1);
  assert.equal(run.result.snapshot.jobs[0].name, "Review evidence");
  await assert.rejects(saveWalkthrough(store, "missing", example, "J"), /does not exist/);
  await assert.rejects(saveWalkthrough(store, "work", example, ""), /actor/);
  await assert.rejects(saveWalkthrough(store, "work", { ...example, loopChoices: { nonexistent: true } }, "J"), /active top-level/);
  await assert.rejects(saveWalkthrough(store, "work", example, "J", 0), /maxSteps/);
  await assert.rejects(getWalkthrough(store, "work", "missing"), /not found/);
  assert.equal((await listWalkthroughs(store, "work")).length, 1);
});


test("saving a preview refuses a changed design but tolerates intervening discussion", async t => {
  const store = await setup(t);
  const { walkthroughBasis } = await import("../walkthrough-record.js");
  const basis = walkthroughBasis(await store.board("work"));
  await store.append("work", [{ t: "comment", comment: { id: "discussion", about: "board", by: "human", text: "Reviewing this scenario" } }], "human");
  await saveWalkthrough(store, "work", example, "human", undefined, basis);
  await store.append("work", [{ t: "updateJob", id: "review", patch: { name: "A changed design" } }], "human");
  const before = (await store.entries("work")).length;
  await assert.rejects(saveWalkthrough(store, "work", example, "human", undefined, basis), /changed since this preview/);
  assert.equal((await store.entries("work")).length, before);
});
