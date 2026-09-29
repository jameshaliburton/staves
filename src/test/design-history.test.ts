import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { designHistory } from "../design-history.js";
import { saveAssessmentRequest, saveAssessmentReturn } from "../assessment-store.js";
import { saveWalkthrough } from "../walkthrough-store.js";
import type { Entry } from "../ops.js";
import { previewAlternative } from "../alternative.js";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("work", [
    { t: "board", id: "work", title: "Review work" },
    { t: "track", track: { id: "person", name: "Reviewer", kind: "person" } },
    { t: "job", job: { id: "review", name: "Review", track: "person", inputs: [], outputs: [], provenance: { source: "human" }, status: "draft" } },
  ], "human");
  return store;
}

test("family contains siblings and descendants, excludes unrelated boards and preserves capture identity", async t => {
  const store = await setup(t);
  await store.branch("work", "first", "First");
  await store.branch("work", "second", "Second");
  await store.branch("first", "nested", "Nested");
  await store.append("unrelated", [{ t: "board", id: "unrelated", title: "Other" }], "human");
  const history = await designHistory(store, "nested");
  assert.equal(history.selectedBoard, "nested");
  assert.deepEqual(history.nodes.map(node => node.id), ["first", "nested", "second", "work"]);
  const first = history.nodes.find(node => node.id === "first")!;
  assert.equal(first.baseline?.sourceBoard, "work");
  assert.ok(first.baseline?.pinned && first.baseline.sourceRevision.startsWith("3:"));
  assert.equal(first.parentAvailable, true);
  assert.deepEqual(history.warnings, []);
});

test("inaccessible parents are not read and do not prevent pinned alternatives from rendering", async t => {
  const store = await setup(t);
  await store.branch("work", "first", "First");
  await store.branch("work", "second", "Second");
  const reads: string[] = [];
  const scoped = { list: async () => ["first", "second"], entries: async (name: string) => { reads.push(name); assert.notEqual(name, "work"); return store.entries(name); } };
  const history = await designHistory(scoped, "first");
  assert.deepEqual(reads.sort(), ["first", "second"]);
  assert.deepEqual(history.nodes.map(node => node.id), ["first", "second"]);
  assert.ok(history.nodes.every(node => node.availability === "available" && node.parentAvailable === false));
  await assert.rejects(designHistory(scoped, "work"), /not accessible/);
});

test("missing and cyclic legacy lineage remains bounded and unavailable", async () => {
  const log = (id: string, parent: string): Entry[] => [{ seq: 1, by: "human", at: "2026-09-14", op: { t: "board", id, title: id } }, { seq: 2, by: "human", at: "2026-09-14", op: { t: "base", board: parent } }];
  const logs = new Map([["a", log("a", "b")], ["b", log("b", "a")], ["missing", log("missing", "secret")]]);
  const store = { list: async () => [...logs.keys()], entries: async (name: string) => { assert.ok(logs.has(name)); return logs.get(name)!; } };
  const cyclic = await designHistory(store, "a");
  assert.ok(cyclic.nodes.every(node => node.availability === "unavailable"));
  assert.ok(cyclic.warnings.some(warning => warning.includes("cyclic")));
  const missing = await designHistory(store, "missing");
  assert.equal(missing.nodes[0].availability, "unavailable");
  assert.equal(missing.nodes[0].parentAvailable, false);
});

test("assessment and model-check history stays on original board and revisions with separate report freshness", async t => {
  const store = await setup(t);
  const request = await saveAssessmentRequest(store, "work", {}, "human");
  await saveAssessmentReturn(store, "work", request.id, { requestId: request.id, repositoryAccess: "unavailable", jobs: [{ jobId: "review", conclusion: "unknown", reason: "No repo" }], tests: [], limitations: ["No repo"] }, "agent");
  const run = await saveWalkthrough(store, "work", { name: "Happy path", initialArtifacts: [] }, "human");
  await store.branch("work", "alternative", "Alternative");
  await store.append("work", [{ t: "updateJob", id: "review", patch: { outcome: "Changed" } }], "human");
  const history = await designHistory(store, "alternative");
  const source = history.nodes.find(node => node.id === "work")!;
  assert.equal(source.assessments[0].sourceRevision, 3);
  assert.equal(source.assessments[0].status, "stale");
  assert.equal(source.assessments[0].returns[0].statusAtReceipt, "current");
  assert.equal(source.assessments[0].returns[0].status, "stale");
  assert.equal(source.assessments[0].returns[0].evidence, "agent-report");
  assert.equal(source.walkthroughs[0].sourceRevision, run.sourceRevision);
  assert.equal(source.walkthroughs[0].status, "stale");
  assert.equal(source.walkthroughs[0].evidence, "model-check");
  assert.deepEqual(history.nodes.find(node => node.id === "alternative")!.assessments, []);
  assert.deepEqual(history.nodes.find(node => node.id === "alternative")!.walkthroughs, []);
});

test("design acceptance records actual sequence actor and source alternative without implying Git merge", async t => {
  const store = await setup(t);
  await store.branch("work", "alternative", "Alternative");
  await store.append("alternative", [{ t: "updateJob", id: "review", patch: { outcome: "New outcome" } }], "human");
  const source = await store.board("work"), alternative = await store.board("alternative"), baseline = await store.baseline("alternative");
  const preview = previewAlternative(source, alternative, baseline!);
  await store.append("work", [{ t: "acceptAlternative", alternative, baseline: baseline!, expectedBasis: preview.basis }], "human:J");
  const node = (await designHistory(store, "work")).nodes.find(node => node.id === "work")!;
  assert.equal(node.acceptances[0].seq, 4);
  assert.equal(node.acceptances[0].actor, "human:J");
  assert.equal(node.acceptances[0].alternativeBoard, "alternative");
  assert.ok(node.acceptances[0].at);
});

test("development reports remain original-board events and preserve explicitly reported PR state", async t => {
  const store = await setup(t);
  await store.append("work", [{ t: "comment", comment: { id: "dev", by: "agent", about: "board", text: "Development report", development: {
    id: "dev-report", recordedBy: "agent", recordedAt: "2026-09-14T12:00:00Z", designRevision: 3, evidence: "development-report",
    options: { git: { source: "local-git", observedAt: "2026-09-14T12:00:00Z", repository: { origin: "https://github.com/example/repo" }, branch: "feature/review", head: "a".repeat(40), unborn: false, worktree: true, dirty: { tracked: 0, untracked: 0, isDirty: false } }, pullRequest: { url: "https://github.com/example/repo/pull/1", state: "open", checkedAt: "2026-09-14T12:00:00Z" }, note: "Agent reported" },
  } } }], "agent");
  await store.branch("work", "alternative", "Alternative");
  const history = await designHistory(store, "alternative");
  assert.deepEqual(history.nodes.find(node => node.id === "alternative")!.development, []);
  const report = history.nodes.find(node => node.id === "work")!.development[0];
  assert.equal(report.designRevision, 3);
  assert.equal(report.evidence, "development-report");
  assert.equal(report.options.pullRequest?.state, "open");
  assert.equal(report.options.git.branch, "feature/review");
});
