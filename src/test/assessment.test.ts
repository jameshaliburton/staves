import test from "node:test";
import assert from "node:assert/strict";
import { emptyBoard, type Board } from "../model.js";
import { createAssessmentRequest, assessReturn, agentReturnSchema, type AgentReturn } from "../assessment.js";

function fixture(): Board {
  const board = emptyBoard("workflow", "Decide");
  board.tracks = [{ id: "person", name: "Reviewer", kind: "person" }];
  board.artifacts = [{ id: "result", name: "Result", kind: "document" }];
  board.jobs = [
    { id: "a", name: "Prepare", track: "person", inputs: [], outputs: ["result"], provenance: { source: "human" }, status: "confirmed", instructions: [{ path: "secret.md", text: "Private raw instruction", summary: "Review sources" }] },
    { id: "child", name: "Check", parent: "a", track: "person", inputs: [], outputs: [], provenance: { source: "human" }, status: "draft" },
    { id: "b", name: "Receive", track: "person", inputs: ["result"], outputs: [], provenance: { source: "human" }, status: "draft" },
  ];
  return board;
}
const options = { id: "request-1", capturedBy: "J", capturedAt: "2026-09-14T10:00:00Z", jobIds: ["a"] };
const report: AgentReturn = { requestId: "request-1", reportedBy: "coding-agent", reportedAt: "2026-09-14T11:00:00Z", repositoryAccess: "available", jobs: [{ jobId: "a", conclusion: "conditional", reason: "Needs an adapter", references: [{ kind: "file", ref: "src/adapter.ts" }] }], tests: [{ jobIds: ["a"], scope: "Adapter integration", status: "not-run" }], limitations: ["Production credentials unavailable"] };

test("rule owners are captured and changes to their responsibilities stale the assessment", () => {
  const board = fixture();
  board.tracks.push({ id: "owner", name: "Policy owner", kind: "person" });
  board.jobs[0].gate = { rule: "Follow policy", accountable: "rule", ruleOwner: "owner" };
  const request = createAssessmentRequest(board, 12, options);
  assert.equal(request.packet.board.tracks.find(track => track.id === "owner")?.name, "Policy owner");
  board.tracks.find(track => track.id === "owner")!.kind = "system";
  assert.equal(assessReturn(request, board, report).status, "stale");
  board.tracks = board.tracks.filter(track => track.id !== "owner");
  assert.equal(assessReturn(request, board, report).status, "stale");
});

test("assessment captures selected descendants and boundaries without instruction text", () => {
  const board = fixture();
  const request = createAssessmentRequest(board, 12, { ...options, cases: [{ name: "Normal", initialArtifacts: [] }] });
  assert.equal(request.intent, "assess");
  assert.equal(request.source.revision, 12);
  assert.deepEqual(request.packet.board.jobs.map(job => job.id), ["a", "child"]);
  assert.equal(request.packet.boundaries[0].targetId, "b");
  assert.ok(!JSON.stringify(request).includes("Private raw instruction"));
  assert.ok(!JSON.stringify(request).includes("secret.md"));
  board.jobs[0].name = "Later edit";
  assert.equal(request.packet.board.jobs[0].name, "Prepare");
});

test("only scoped semantic changes make a return stale, and preserve the original snapshot", () => {
  const board = fixture();
  const request = createAssessmentRequest(board, 12, options);
  board.jobs[2].outcome = "Unrelated receive outcome";
  board.comments.push({ id: "return-record", about: "a", by: "agent", text: "Assessment submitted" });
  assert.equal(assessReturn(request, board, report).status, "current");
  board.jobs[1].outcome = "Changed child outcome";
  const result = assessReturn(request, board, report);
  assert.equal(result.status, "stale");
  assert.equal(result.requiresReconciliation, true);
  assert.equal(result.request.source.revision, 12);
  assert.equal(result.request.packet.board.jobs[1].outcome, undefined);
  assert.equal(result.verifiedExecution, false);
});

test("removed scoped jobs and changed dependency boundaries require reconciliation", () => {
  const board = fixture();
  const request = createAssessmentRequest(board, 12, options);
  board.jobs[2].inputs = [];
  assert.equal(assessReturn(request, board, report).status, "stale");
  board.jobs[0].removed = true;
  assert.equal(assessReturn(request, board, report).status, "stale");
});

test("reports validate scope and payload and distinguish not-run from pass", () => {
  const board = fixture();
  const request = createAssessmentRequest(board, 12, options);
  assert.equal(assessReturn(request, board, report).result.tests[0].status, "not-run");
  assert.throws(() => assessReturn(request, board, { ...report, requestId: "different" }), /original/);
  assert.throws(() => assessReturn(request, board, { ...report, jobs: [{ ...report.jobs[0], jobId: "b" }] }), /scope/);
  assert.equal(agentReturnSchema.safeParse({ ...report, tests: [{ ...report.tests[0], status: "pass" }] }).success, false);
  assert.equal(agentReturnSchema.safeParse({ ...report, executableActions: ["deploy"] }).success, false);
  assert.equal(agentReturnSchema.safeParse({ ...report, jobs: [{ ...report.jobs[0], conclusion: "implemented" }] }).success, false);
});

test("missing repository access is explicitly unknown and not tested", () => {
  assert.equal(agentReturnSchema.safeParse({ ...report, repositoryAccess: "unavailable" }).success, false);
  const unknown = { ...report, repositoryAccess: "unavailable", jobs: [{ jobId: "a", conclusion: "unknown", reason: "Cannot inspect repository" }], limitations: ["No repository access"] };
  assert.equal(agentReturnSchema.safeParse(unknown).success, true);
  assert.equal(agentReturnSchema.safeParse({ ...unknown, limitations: [] }).success, false);
});

test("explicit implementation reports never change board implementation or confirmation", () => {
  const board = fixture();
  const before = structuredClone(board);
  const request = createAssessmentRequest(board, 12, options);
  const implemented = { ...report, jobs: [{ jobId: "a", conclusion: "reported-implemented", reason: "Adapter added", references: [{ kind: "commit", ref: "abc123" }] }], tests: [{ jobIds: ["a"], scope: "Adapter unit tests", status: "pass", reference: "ci/run/42" }] };
  assert.throws(() => assessReturn(request, board, implemented), /not requested/);
  const explicit = createAssessmentRequest(board, 12, { ...options, intent: "implement" });
  const result = assessReturn(explicit, board, implemented);
  assert.equal(result.result.jobs[0].conclusion, "reported-implemented");
  assert.equal(result.evidence, "agent-report");
  assert.equal(result.verifiedExecution, false);
  assert.deepEqual(board, before);
});

test("baseline identity and concrete cases are captured and validated", () => {
  const board = fixture();
  board.baseline = { pinned: true, id: "baseline-1", name: "Today", sourceBoard: "workflow", sourceRevision: "10", capturedAt: options.capturedAt, capturedBy: "J" };
  const request = createAssessmentRequest(board, 12, options);
  board.baseline.id = "baseline-2";
  assert.equal(request.source.baseline?.pinned && request.source.baseline.id, "baseline-1");
  assert.equal(assessReturn(request, board, report).status, "stale");
  assert.throws(() => createAssessmentRequest(board, 12, { ...options, cases: [{ name: "Unknown artifact", initialArtifacts: ["missing"] }] }), /scope/);
  assert.throws(() => createAssessmentRequest(board, 12, { ...options, cases: [{ name: "Other job", initialArtifacts: [], loopChoices: { b: true } }] }), /scope/);
});

test("withdrawn captured evidence stales a report without rewriting its original basis", () => {
  const board = fixture();
  board.jobs[0].executionEvidence = [{ provider: "langfuse", projectId: "project", traceId: "trace", observationId: "observation", observedAt: options.capturedAt, status: "observed" }];
  const request = createAssessmentRequest(board, 12, options);
  board.jobs[0].executionEvidence!.push({ provider: "langfuse", projectId: "project", traceId: "other", observationId: "new", observedAt: options.capturedAt, status: "observed" });
  assert.equal(assessReturn(request, board, report).status, "current");
  board.jobs[0].executionEvidence![0].retraction = { by: "human", at: options.capturedAt, reason: "Wrong case" };
  assert.equal(assessReturn(request, board, report).status, "stale");
  assert.equal(request.packet.board.jobs[0].executionEvidence?.[0].retraction, undefined);
});
