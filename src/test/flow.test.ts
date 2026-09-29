import test from "node:test";
import assert from "node:assert/strict";
import { assessPrerequisites, validatePrerequisites, type Prerequisites } from "../flow.js";

test("legacy absence and explicit unknown never infer synchronization or readiness", () => {
  for (const available of [[], ["a"], ["a", "b"]]) {
    assert.equal(assessPrerequisites(undefined, available).status, "unresolved");
    assert.equal(assessPrerequisites({ kind: "unknown", inputs: ["a", "b"] }, available).status, "unresolved");
  }
});

test("the same handoffs produce distinct declared all and any behavior", () => {
  const all: Prerequisites = { kind: "all", inputs: ["a", "b"] };
  const any: Prerequisites = { kind: "any", inputs: ["a", "b"] };
  assert.equal(assessPrerequisites(all, ["a"]).status, "waiting");
  assert.equal(assessPrerequisites(any, ["a"]).status, "ready");
  assert.equal(assessPrerequisites(all, ["a", "b"]).status, "ready");
  assert.equal(assessPrerequisites(any, ["unrelated"]).status, "waiting");
  assert.deepEqual(assessPrerequisites(all, ["a"]).missingInputs, ["b"]);
});

test("conditional starts distinguish unknown, false, missing artifact and satisfied conditions", () => {
  const rule: Prerequisites = { kind: "conditional", inputs: ["a"], condition: "approved" };
  assert.equal(assessPrerequisites(rule, ["a"]).status, "unresolved");
  assert.equal(assessPrerequisites(rule, ["a"], { approved: false }).status, "waiting");
  assert.equal(assessPrerequisites(rule, [], { approved: true }).status, "waiting");
  assert.equal(assessPrerequisites(rule, ["a"], { approved: true }).status, "ready");
  assert.match(assessPrerequisites(rule, []).reasons[0], /approved/);
  assert.equal(assessPrerequisites({ kind: "conditional", inputs: [], condition: "toString" }, []).status, "unresolved");
});

test("an explicitly declared start needs no artifacts; an empty alternative list is invalid", () => {
  assert.equal(assessPrerequisites({ kind: "all", inputs: [] }, []).status, "ready");
  assert.equal(assessPrerequisites({ kind: "conditional", inputs: [], condition: "scheduled" }, [], { scheduled: true }).status, "ready");
  assert.throws(() => validatePrerequisites({ kind: "any", inputs: [] }), /at least one/);
});

test("ingestion rejects malformed declarations rather than assigning default semantics", () => {
  const malformed: unknown[] = [
    null, undefined, [], "all", {}, { kind: "all" }, { kind: "some", inputs: [] },
    { kind: { toString: () => "all" }, inputs: [] },
    { kind: "all", inputs: [1] }, { kind: "all", inputs: [""] },
    { kind: "all", inputs: [" "] }, { kind: "all", inputs: ["a", "a"] },
    { kind: "all", inputs: [], condition: "extra" },
    { kind: "conditional", inputs: [] }, { kind: "conditional", inputs: [], condition: " " },
    { kind: "unknown", inputs: [], extra: true },
  ];
  for (const value of malformed) assert.throws(() => validatePrerequisites(value));
});

test("reference checks distinguish unknown artifacts from artifacts absent from this job", () => {
  const context = {
    board: { artifacts: [{ id: "a", name: "A", kind: "data" as const }, { id: "b", name: "B", kind: "data" as const }] },
    job: { inputs: ["a"] },
  };
  assert.deepEqual(validatePrerequisites({ kind: "all", inputs: ["a"] }, context), { kind: "all", inputs: ["a"] });
  assert.throws(() => validatePrerequisites({ kind: "all", inputs: ["missing"] }, context), /unknown artifact/);
  assert.throws(() => validatePrerequisites({ kind: "all", inputs: ["b"] }, context), /not a job input/);
  assert.throws(() => validatePrerequisites({ kind: "unknown", inputs: ["missing"] }, context), /unknown artifact/);
});

test("assessment is deterministic and does not mutate declarations or facts", () => {
  const rule: Prerequisites = { kind: "conditional", inputs: ["a", "b"], condition: "approved" };
  const available = ["b"];
  const conditions = { approved: true };
  const before = JSON.stringify({ rule, available, conditions });
  const first = assessPrerequisites(rule, available, conditions);
  assert.deepEqual(first, assessPrerequisites(rule, new Set(available), conditions));
  assert.equal(JSON.stringify({ rule, available, conditions }), before);
  const validated = validatePrerequisites(rule);
  validated.inputs.push("other");
  assert.deepEqual(rule.inputs, ["a", "b"]);
});
