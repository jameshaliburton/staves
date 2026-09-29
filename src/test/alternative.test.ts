import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBoard, type Board } from "../model.js";
import { acceptAlternative, previewAlternative } from "../alternative.js";

function fixture() {
  const source = emptyBoard("source", "Source name");
  source.tracks = [{ id: "person", name: "Person", kind: "person" }];
  source.artifacts = [{ id: "input", name: "Input", kind: "data", external: true }];
  source.jobs = [{ id: "j", name: "Work", track: "person", inputs: ["input"], outputs: [], prerequisites: { kind: "all", inputs: ["input"] }, status: "confirmed", confirmedFields: ["name", "outcome"], outcome: "Old", provenance: { source: "confirmed" }, implementation: { state: "implemented" } }];
  const baseline = structuredClone(source);
  const alternative: Board = { ...structuredClone(source), id: "alternative", title: "New option", base: source.id, baseline: { pinned: true, id: "pin", name: "Original", sourceBoard: source.id, sourceRevision: "3", capturedAt: "2026-09-14T00:00:00Z", capturedBy: "human" } };
  return { source, baseline, alternative };
}
function accept(source: Board, alternative: Board, baseline: Board) {
  return acceptAlternative(source, alternative, baseline, previewAlternative(source, alternative, baseline).basis);
}
test("no-op preserves source identity, metadata and confirmation", () => {
  const { source, alternative, baseline } = fixture();
  alternative.jobs[0].implementation = { state: "in-progress" };
  alternative.comments.push({ id: "c", about: "j", text: "Alternative comment", by: "agent" });
  assert.deepEqual(previewAlternative(source, alternative, baseline).changes, []);
  assert.deepEqual(accept(source, alternative, baseline), source);
});
test("semantic edits preserve concurrent runtime records and unrelated confirmation", () => {
  const { source, alternative, baseline } = fixture();
  alternative.jobs[0].outcome = "New";
  const review = previewAlternative(source, alternative, baseline);
  source.jobs[0].executionEvidence = [{ provider: "langfuse", projectId: "p", traceId: "trace", observedAt: "2026-09-14", status: "observed" }];
  source.comments.push({ id: "c", about: "j", by: "human", text: "Observed separately" });
  const result = acceptAlternative(source, alternative, baseline, review.basis);
  assert.equal(result.jobs[0].outcome, "New");
  assert.equal(result.jobs[0].implementation?.state, "implemented");
  assert.deepEqual(result.jobs[0].executionEvidence, source.jobs[0].executionEvidence);
  assert.deepEqual(result.comments, source.comments);
  assert.equal(result.jobs[0].status, "draft");
  assert.deepEqual(result.jobs[0].confirmedFields, ["name"]);
  assert.equal(source.jobs[0].outcome, "Old");
});
test("disjoint design fields merge; same-field disagreement conflicts", () => {
  const { source, alternative, baseline } = fixture();
  source.jobs[0].name = "Renamed";
  alternative.jobs[0].outcome = "New";
  assert.equal(accept(source, alternative, baseline).jobs[0].name, "Renamed");
  source.jobs[0].outcome = "Different";
  const preview = previewAlternative(source, alternative, baseline);
  assert.equal(preview.conflicts[0].field, "outcome");
  assert.throws(() => acceptAlternative(source, alternative, baseline, preview.basis), /conflicts/);
});
test("either design changing after review requires new review", () => {
  for (const side of ["source", "alternative"] as const) {
    const f = fixture(); const review = previewAlternative(f.source, f.alternative, f.baseline);
    f[side].jobs[0].name = "Changed";
    assert.throws(() => acceptAlternative(f.source, f.alternative, f.baseline, review.basis), /changed/);
  }
});
test("new jobs retain identity and design but never inherit claimed implementation", () => {
  const { source, alternative, baseline } = fixture();
  alternative.jobs.push({ ...structuredClone(alternative.jobs[0]), id: "new", name: "New" });
  const result = accept(source, alternative, baseline);
  assert.equal(result.jobs[1].id, "new");
  assert.equal(result.jobs[1].status, "draft");
  assert.equal(result.jobs[1].implementation, undefined);
  assert.equal(result.jobs[1].confirmedFields, undefined);
});
test("additions and deletion resolve references as one design; broken removals block", () => {
  const { source, alternative, baseline } = fixture();
  alternative.artifacts = [];
  assert.match(previewAlternative(source, alternative, baseline).problems.join(" "), /missing artifact/);
  alternative.jobs[0].inputs = [];
  alternative.jobs[0].prerequisites = { kind: "all", inputs: [] };
  assert.equal(accept(source, alternative, baseline).artifacts.length, 0);
  alternative.jobs[0].gate = { rule: "Review", accountable: "rule", ruleOwner: "missing" };
  assert.match(previewAlternative(source, alternative, baseline).problems.join(" "), /missing performer/);
});
test("removing a changed source job conflicts and removing unchanged jobs retains runtime history", () => {
  const { source, alternative, baseline } = fixture();
  alternative.jobs[0].removed = true;
  const result = accept(source, alternative, baseline);
  assert.equal(result.jobs[0].removed, true);
  assert.equal(result.jobs[0].implementation?.state, "implemented");
  source.jobs[0].outcome = "Concurrent new outcome";
  assert.equal(previewAlternative(source, alternative, baseline).canAccept, false);
});
test("source removals conflict with alternative edits; identical concurrent edits are safe", () => {
  const { source, alternative, baseline } = fixture();
  alternative.jobs[0].name = "Same";
  source.jobs[0].name = "Same";
  assert.equal(previewAlternative(source, alternative, baseline).canAccept, true);
  source.jobs[0].removed = true;
  assert.equal(previewAlternative(source, alternative, baseline).canAccept, false);
});
test("board intent/context edits retain source integration settings and clear optional fields", () => {
  const { source, alternative, baseline } = fixture();
  baseline.context = { purpose: "Before" }; source.context = { purpose: "Before", langfuse: { projectId: "p", baseUrl: "https://example.com" } };
  alternative.context = { purpose: "After", langfuse: { projectId: "other", baseUrl: "https://other.example" } };
  baseline.perWeek = source.perWeek = 10;
  const result = accept(source, alternative, baseline);
  assert.equal(result.context?.purpose, "After");
  assert.deepEqual(result.context?.langfuse, source.context.langfuse);
  assert.equal(result.perWeek, undefined);
});
test("legacy and wrong-source acceptance are rejected", () => {
  const { source, alternative, baseline } = fixture();
  assert.throws(() => previewAlternative({ ...source, id: "other" }, alternative, baseline), /belong/);
  alternative.baseline = { pinned: false, sourceBoard: source.id, name: "Legacy" };
  assert.throws(() => previewAlternative(source, alternative, baseline), /immutable/);
});
test("existing unknown references remain reviewable but new cycles are rejected", () => {
  const { source, alternative, baseline } = fixture();
  source.jobs[0].track = baseline.jobs[0].track = alternative.jobs[0].track = "unknown";
  assert.equal(previewAlternative(source, alternative, baseline).canAccept, true);
  alternative.jobs[0].parent = "j";
  assert.match(previewAlternative(source, alternative, baseline).problems.join(" "), /cyclic/);
});

test("stored baseline metadata decoration is allowed only for the matching pin", () => {
  const { source, alternative, baseline } = fixture();
  baseline.baseline = structuredClone(alternative.baseline);
  assert.equal(previewAlternative(source, alternative, baseline).canAccept, true);
  baseline.baseline = { ...baseline.baseline!, name: "Wrong pin" };
  assert.throws(() => previewAlternative(source, alternative, baseline), /belong/);
});
