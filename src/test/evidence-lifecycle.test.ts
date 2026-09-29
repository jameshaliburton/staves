import test from "node:test";
import assert from "node:assert/strict";
import { emptyBoard, type ExecutionEvidence } from "../model.js";
import { validateEvidenceOperation } from "../evidence-lifecycle.js";
import { executionEvidenceKey } from "../langfuse.js";
import { fold, type Entry } from "../ops.js";

const evidence: ExecutionEvidence = {
  provider: "langfuse", baseUrl: "https://cloud.langfuse.com", projectId: "p", traceId: "t", observationId: "o",
  observedAt: "2026-09-14T08:00:00Z", fetchedAt: "2026-09-14T09:00:00Z", status: "observed",
  mapping: { method: "proposed", boardId: "b", jobId: "j", rationale: "Supplies the review packet" },
};
function board() {
  const b = emptyBoard("b");
  b.context = { langfuse: { baseUrl: evidence.baseUrl!, projectId: "p" } };
  b.jobs = [{ id: "j", name: "Review packet", track: "person", status: "draft", provenance: { source: "human", by: "human" }, inputs: [], outputs: [] }];
  return b;
}

test("untagged associations require actual review and cannot claim a reviewer", () => {
  const b = board(); const op = { t: "addExecutionEvidence" as const, id: "j", evidence };
  assert.throws(() => validateEvidenceOperation(b, op, "agent:codex"), /human review/);
  assert.doesNotThrow(() => validateEvidenceOperation(b, op, "agent:codex", true));
  assert.doesNotThrow(() => validateEvidenceOperation(b, op, "human:J"));
  assert.throws(() => validateEvidenceOperation(b, { ...op, evidence: { ...evidence, mapping: { ...evidence.mapping!, method: "reviewed", reviewedBy: "human:J" } } }, "agent:codex"), /stamped/);
});

test("fold stamps the actual acceptance actor and time for legacy and new evidence proposals", () => {
  const b = board();
  const entries: Entry[] = [
    { seq: 1, by: "agent:codex", at: "2026-09-14T09:01:00Z", pending: true, op: { t: "addExecutionEvidence", id: "j", evidence } },
    { seq: 2, by: "human:J", at: "2026-09-14T10:00:00Z", op: { t: "accept", seq: 1 } },
  ];
  const result = fold(entries, b).jobs[0].executionEvidence![0];
  assert.equal(result.mapping?.method, "reviewed");
  assert.equal(result.mapping?.reviewedBy, "human:J");
  assert.equal(result.mapping?.reviewedAt, entries[1].at);
  assert.equal(evidence.mapping?.method, "proposed");
});

test("refresh lineage is exact, monotonic, and does not overwrite a captured context", () => {
  const b = board(); b.jobs[0].executionEvidence = [structuredClone(evidence)];
  const next = { ...evidence, fetchedAt: "2026-09-14T11:00:00Z", supersedes: executionEvidenceKey(evidence), durationMs: 500 };
  const op = { t: "addExecutionEvidence" as const, id: "j", evidence: next };
  assert.doesNotThrow(() => validateEvidenceOperation(b, op, "human"));
  for (const patch of [{ traceId: "wrong" }, { fetchedAt: evidence.fetchedAt }, { baseUrl: "https://other.test" }]) {
    assert.throws(() => validateEvidenceOperation(b, { ...op, evidence: { ...next, ...patch } }, "human"));
  }
  const result = fold([{ seq: 1, by: "human", at: "2026-09-14T11:00:00Z", op }], b);
  assert.equal(result.jobs[0].executionEvidence!.length, 2);
  assert.equal(result.jobs[0].executionEvidence![0].durationMs, undefined);
  assert.throws(() => validateEvidenceOperation(result, { ...op, evidence: { ...next, fetchedAt: "2026-09-14T12:00:00Z" } }, "human"), /latest capture/);
});

test("retraction retains the exact reference and reviewer provenance", () => {
  const b = board(); b.jobs[0].executionEvidence = [structuredClone(evidence)];
  const op = { t: "retractExecutionEvidence" as const, id: "j", key: executionEvidenceKey(evidence), reason: "Wrong association" };
  validateEvidenceOperation(b, op, "human:J");
  const result = fold([{ seq: 1, by: "human:J", at: "2026-09-14T11:00:00Z", op }], b);
  const retained = result.jobs[0].executionEvidence![0];
  assert.equal(retained.traceId, evidence.traceId);
  assert.deepEqual(retained.retraction, { by: "human:J", at: "2026-09-14T11:00:00Z", reason: "Wrong association" });
  assert.equal(executionEvidenceKey(retained), op.key);
  assert.throws(() => validateEvidenceOperation(result, op, "human:J"), /already retracted/);
  assert.equal(b.jobs[0].executionEvidence![0].retraction, undefined);
});


test("bulk job operations cannot introduce or remove lifecycle evidence", () => {
  const b = board();
  assert.throws(() => validateEvidenceOperation(b, { t: "updateJob", id: "j", patch: { executionEvidence: [evidence] } }, "agent:codex"), /bulk job edits/);
  b.jobs[0].executionEvidence = [evidence];
  assert.throws(() => validateEvidenceOperation(b, { t: "updateJob", id: "j", patch: { executionEvidence: [] } }, "human"), /bulk job edits/);
  assert.throws(() => validateEvidenceOperation(b, { t: "updateJob", id: "j", patch: { executionEvidence: undefined } }, "human"), /bulk job edits/);
  assert.doesNotThrow(() => validateEvidenceOperation(b, { t: "updateJob", id: "j", patch: { executionEvidence: structuredClone(b.jobs[0].executionEvidence) } }, "human"));
});

test("legacy captures can refresh into explicit source provenance", () => {
  const b = board();
  const legacy = { ...evidence, baseUrl: undefined, fetchedAt: undefined, mapping: undefined };
  b.jobs[0].executionEvidence = [legacy];
  const next = { ...evidence, mapping: { method: "instrumented" as const, boardId: "b", jobId: "j" }, supersedes: executionEvidenceKey(legacy) };
  assert.doesNotThrow(() => validateEvidenceOperation(b, { t: "addExecutionEvidence", id: "j", evidence: next }, "agent:codex"));
});
