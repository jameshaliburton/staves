import test from "node:test";
import assert from "node:assert/strict";
import { emptyBoard, type Board, type Job } from "../model.js";
import { walkThrough, type WalkthroughCase } from "../walkthrough.js";

const job = (id: string, inputs: string[] = [], outputs: string[] = [], patch: Partial<Job> = {}): Job => ({
  id, name: id, track: "team", inputs, outputs, prerequisites: { kind: "all", inputs },
  status: "draft", provenance: { source: "human" }, ...patch,
});
function board(jobs: Job[]): Board {
  return { ...emptyBoard("orders"), jobs, artifacts: [...new Set(jobs.flatMap(j => [...j.inputs, ...j.outputs]))].map(id => ({ id, name: id, kind: "data" })) };
}
const example: WalkthroughCase = { name: "Normal order", initialArtifacts: [] };

test("an unrelated completed entrance cannot hide a disconnected control cycle", () => {
  const design = board([job("start"), job("a", [], [], { exits: [{ condition: "next", target: "b" }] }), job("b", [], [], { exits: [{ condition: "next", target: "a" }] })]);
  const run = walkThrough(design, { ...example, exitChoices: { a: "next", b: "next" } });
  assert.equal(run.status, "unresolved");
  assert.deepEqual(run.steps.map(step => step.jobId), ["start"]);
  assert.deepEqual(run.questions.map(question => question.jobId), ["a", "b"]);
});

test("normal path releases outputs only after the producer and retains independent immutable inputs", () => {
  const design = board([job("fulfil", ["approved"], ["receipt"]), job("approve", [], ["approved"])]);
  const run = walkThrough(design, example);
  assert.equal(run.status, "complete");
  assert.deepEqual(run.steps.map(s => [s.jobId, s.round]), [["approve", 1], ["fulfil", 2]]);
  assert.deepEqual(run.steps[0].availableBefore, []);
  assert.deepEqual(run.steps[1].availableBefore, ["approved"]);
  assert.deepEqual(run.availableArtifacts, ["approved", "receipt"]);
  design.jobs[0].name = "Changed later";
  assert.equal(run.snapshot.jobs[0].name, "fulfil");
  run.case.initialArtifacts.push("receipt");
  assert.deepEqual(example.initialArtifacts, []);
});

test("all and any joins differ for the same available input and never invent absent inputs", () => {
  const design = board([job("all", ["email", "phone"]), job("any", ["email", "phone"], [], { prerequisites: { kind: "any", inputs: ["email", "phone"] } })]);
  const run = walkThrough(design, { ...example, initialArtifacts: ["email"] });
  assert.equal(run.status, "waiting");
  assert.deepEqual(run.steps.map(s => s.jobId), ["any"]);
  assert.equal(run.waits[0].jobId, "all");
  assert.match(run.waits[0].reason, /phone/);
});

test("parallel jobs share eligibility round and their all join waits for both outputs", () => {
  const run = walkThrough(board([job("join", ["payment", "stock"]), job("pay", [], ["payment"]), job("reserve", [], ["stock"])]), example);
  assert.deepEqual(run.steps.map(s => [s.jobId, s.round]), [["pay", 1], ["reserve", 1], ["join", 2]]);
  assert.deepEqual(run.steps[1].availableBefore, []);
});

test("missing conditional facts and old prerequisite absence are unresolved with no fabricated output", () => {
  const design = board([job("approve", [], ["approved"], { prerequisites: { kind: "conditional", inputs: [], condition: "owner responded" } }), job("legacy", [], ["legacy-output"], { prerequisites: undefined })]);
  const run = walkThrough(design, example);
  assert.equal(run.status, "unresolved");
  assert.deepEqual(run.steps, []);
  assert.deepEqual(run.availableArtifacts, []);
  assert.equal(run.questions.length, 2);
  const noResponse = walkThrough(board([design.jobs[0]]), { ...example, conditions: { "owner responded": false } });
  assert.equal(noResponse.status, "waiting");
  assert.deepEqual(noResponse.outcomes, []);
});

test("exclusive exits execute only the selected destination even when both branches have empty inputs", () => {
  const design = board([job("decide", [], [], { exits: [{ condition: "accepted", target: "ship" }, { condition: "declined", target: "cancel" }] }), job("ship"), job("cancel")]);
  const chosen = walkThrough(design, { ...example, exitChoices: { decide: "accepted" } });
  assert.deepEqual(chosen.steps.map(s => s.jobId), ["decide", "ship"]);
  assert.equal(chosen.status, "complete");
  const missing = walkThrough(design, example);
  assert.equal(missing.status, "unresolved");
  assert.deepEqual(missing.steps, []);
  const contradiction = walkThrough(design, { ...example, exitChoices: { decide: "accepted" }, conditions: { accepted: false } });
  assert.equal(contradiction.status, "unresolved");
});

test("unknown exception targets and implicit exit cycles stop visibly", () => {
  const unknown = walkThrough(board([job("decide", [], ["result"], { exits: [{ condition: "error" }] })]), { ...example, exitChoices: { decide: "error" } });
  assert.equal(unknown.status, "unresolved");
  assert.deepEqual(unknown.availableArtifacts, []);
  const self = walkThrough(board([job("retry", [], [], { exits: [{ condition: "again", target: "retry" }] })]), { ...example, exitChoices: { retry: "again" } });
  // A graph with no activated entrance cannot silently execute its cycle.
  assert.deepEqual(self.steps, []);
  assert.equal(self.status, "unresolved");
});

test("explicit bounded self retry records attempts and follows a declared limit destination", () => {
  const design = board([job("request", [], [], { loop: { to: "request", limit: 2, then: "escalate" } }), job("escalate", [], [], { outcome: "Owner receives the unanswered request" })]);
  const run = walkThrough(design, { ...example, loopChoices: { request: true } });
  assert.equal(run.status, "complete");
  assert.deepEqual(run.steps.map(s => s.jobId), ["request", "request", "request", "escalate"]);
  assert.deepEqual(run.steps.slice(0, 3).map(s => s.loop?.action), ["repeat", "repeat", "limit"]);
  assert.deepEqual(run.steps.slice(0, 3).map(s => s.occurrence), [1, 2, 3]);
});

test("unknown retry limits and narrative destinations remain questions; technical ceiling is labelled separately", () => {
  const unbounded = board([job("request", [], [], { loop: { to: "request", then: "stop" } })]);
  assert.equal(walkThrough(unbounded, { ...example, loopChoices: { request: true } }).status, "unresolved");
  const narrative = board([job("request", [], [], { loop: { to: "request", limit: 0, then: "ask somebody" } })]);
  assert.equal(walkThrough(narrative, { ...example, loopChoices: { request: true } }).status, "unresolved");
  const bounded = board([job("request", [], [], { loop: { to: "request", limit: 20, then: "stop" } })]);
  const run = walkThrough(bounded, { ...example, loopChoices: { request: true } }, { maxSteps: 3 });
  assert.equal(run.status, "engine-limit");
  assert.equal(run.steps.length, 3);
  assert.match(run.questions[0].reason, /technical engine limit/);
  assert.deepEqual(run.outcomes, []);
});

test("retracted assumptions remain recorded but cannot satisfy a condition", () => {
  const design = board([job("send", [], [], { prerequisites: { kind: "conditional", inputs: [], condition: "approved" } })]);
  const caseWithAssumption: WalkthroughCase = { ...example, assumptions: [{ id: "assume-approval", note: "For this case only", status: "active", condition: "approved", value: true }] };
  assert.equal(walkThrough(design, caseWithAssumption).status, "complete");
  const retracted = structuredClone(caseWithAssumption);
  retracted.assumptions![0].status = "retracted";
  const run = walkThrough(design, retracted);
  assert.equal(run.status, "unresolved");
  assert.equal(run.assumptions[0].status, "retracted");
  assert.equal(design.jobs[0].prerequisites?.kind, "conditional");
  assert.equal(caseWithAssumption.assumptions![0].status, "active");
});

test("runs are reproducible and reject invalid case artifacts or engine budgets", () => {
  const design = board([job("start")]);
  assert.deepEqual(walkThrough(design, example), walkThrough(design, example));
  assert.throws(() => walkThrough(design, { ...example, initialArtifacts: ["invented"] }), /declared artifacts/);
  assert.throws(() => walkThrough(design, example, { maxSteps: 0 }), /maxSteps/);
});
