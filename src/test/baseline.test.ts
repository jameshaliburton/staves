import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { fold, encode, type Entry } from "../ops.js";

async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-baseline-"));
  try { await run(new Store(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function seed(s: Store) {
  await s.append("source", [{ t: "board", id: "source", title: "Original" }, { t: "setContext", context: { purpose: "Retain purpose" } }, { t: "job", job: { id: "j", name: "Original work", track: "t", inputs: [], outputs: [], status: "draft", provenance: { source: "agent" } } }], "agent");
}
test("pinned alternatives survive source edits/deletion and branch again with independent copies", () => fixture(async s => {
  await seed(s);
  const alt = await s.branch("source", "alt", "Alternative", "Reviewed design");
  assert.equal(alt.baseline?.pinned, true);
  assert.equal(alt.baseline?.name, "Reviewed design");
  assert.equal(alt.jobs[0].status, "draft");
  const initial = await s.baseline("alt");
  await s.append("source", [{ t: "updateJob", id: "j", patch: { name: "Changed source" } }], "human");
  await s.deleteBoard("source");
  assert.deepEqual(await s.baseline("alt"), initial);
  assert.equal((await s.board("alt")).jobs[0].name, "Original work");
  await s.append("alt", [{ t: "updateJob", id: "j", patch: { name: "Changed alternative" } }], "human");
  const child = await s.branch("alt", "child", "Child");
  assert.equal(child.jobs[0].name, "Changed alternative");
  assert.equal(child.baseline?.sourceBoard, "alt");
  child.jobs[0].name = "Mutation";
  initial!.jobs[0].name = "Mutation";
  assert.equal((await s.board("child")).jobs[0].name, "Changed alternative");
  assert.equal((await s.baseline("alt"))!.jobs[0].name, "Original work");
}));
test("captures accepted source proposals but excludes pending proposals", () => fixture(async s => {
  await seed(s);
  await s.append("source", [{ t: "updateJob", id: "j", patch: { name: "Accepted" } }], "agent", true);
  await s.append("source", [{ t: "accept", seq: 4 }], "human");
  await s.append("source", [{ t: "updateJob", id: "j", patch: { name: "Pending" } }], "agent", true);
  assert.equal((await s.branch("source", "alt", "Alt")).jobs[0].name, "Accepted");
}));
test("undo and redo restore inherited entities without editing the baseline", () => fixture(async s => {
  await seed(s); await s.branch("source", "alt", "Alt");
  await s.append("alt", [{ t: "updateJob", id: "j", patch: { name: "Edited" } }], "human");
  await s.undo("alt"); assert.equal((await s.board("alt")).jobs[0].name, "Original work");
  await s.redo("alt"); assert.equal((await s.board("alt")).jobs[0].name, "Edited");
  assert.equal((await s.baseline("alt"))!.jobs[0].name, "Original work");
}));
test("context-only boards retain all materialized state", () => fixture(async s => {
  await s.append("source", [{ t: "board", id: "source", title: "Context" }, { t: "setContext", context: { purpose: "Purpose" } }, { t: "artifact", artifact: { id: "a", name: "Document", kind: "document" } }], "human");
  const b = await s.branch("source", "alt", "Alternative");
  assert.equal(b.context?.purpose, "Purpose"); assert.equal(b.artifacts.length, 1);
}));
test("initialization rejects missing source, existing destinations, replacement and repeated baselines", () => fixture(async s => {
  await assert.rejects(s.branch("missing", "alt", "Alt"), /Source/);
  await seed(s); await s.branch("source", "alt", "Alt");
  await assert.rejects(s.branch("source", "alt", "Alt"), /exists/);
  const pin = (await s.entries("alt"))[0];
  await assert.rejects(s.append("alt", [pin.op], "human"), /initialize/);
  await assert.rejects(s.append("alt", [{ t: "base", board: "source" }], "human"), /replaced/);
  assert.throws(() => fold([pin, { ...pin, seq: 2 }]), /initialization/);
  await assert.rejects(s.merge("alt", [{ ...pin, id: "different-id" }]), /replace/);
}));
test("legacy acceptance is scoped to source log and full cache contents include source", () => fixture(async s => {
  await seed(s);
  await s.append("source", [{ t: "updateJob", id: "j", patch: { name: "Source pending" } }], "agent", true);
  await s.append("legacy", [{ t: "base", board: "source" }, { t: "board", id: "legacy", title: "Legacy" }, { t: "setGoal", goal: "Goal" }, { t: "setGoal", goal: "Pending goal" }], "human");
  await s.append("legacy", [{ t: "accept", seq: 4 }], "human");
  assert.equal((await s.board("legacy")).jobs[0].name, "Original work");
  await s.append("source", [{ t: "accept", seq: 4 }], "human");
  assert.equal((await s.board("legacy")).jobs[0].name, "Source pending");
  assert.equal((await s.baseline("legacy"))?.baseline?.pinned, false);
  const entries = await s.entries("source");
  (entries[3].op as Extract<Entry["op"], { t: "updateJob" }>).patch.name = "Same length rewrite";
  await writeFile(s.file("source"), encode(entries));
  assert.equal((await s.board("legacy")).jobs[0].name, "Same length rewrite");
}));
test("concurrent branch creation admits one initializer", () => fixture(async s => {
  await seed(s);
  const results = await Promise.allSettled([s.branch("source", "alt", "One"), s.branch("source", "alt", "Two")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await s.entries("alt")).filter(e => e.op.t === "baseline").length, 1);
}));
test("nested legacy references resolve applied state and can be pinned", () => fixture(async s => {
  await seed(s);
  await s.append("legacy", [{ t: "base", board: "source" }, { t: "board", id: "legacy", title: "Legacy" }], "human");
  await s.append("nested", [{ t: "base", board: "legacy" }, { t: "board", id: "nested", title: "Nested" }], "human");
  assert.equal((await s.board("nested")).jobs[0].name, "Original work");
  await s.append("source", [{ t: "updateJob", id: "j", patch: { name: "Changed" } }], "human");
  assert.equal((await s.board("nested")).jobs[0].name, "Changed");
  assert.equal((await s.branch("nested", "pin", "Pinned")).jobs[0].name, "Changed");
}));
test("malformed and proposed snapshots and invalid pending semantics never enter the log", () => fixture(async s => {
  await seed(s); await s.branch("source", "alt", "Alt");
  const pin = (await s.entries("alt"))[0];
  await assert.rejects(s.append("new", [pin.op], "agent", true), /initialize/);
  assert.equal((await s.entries("new")).length, 0);
  if (pin.op.t !== "baseline") throw new Error("Missing pin");
  pin.op.snapshot.baseline = pin.op.baseline;
  await assert.rejects(s.append("new", [pin.op], "human"), /snapshot/);
  assert.equal((await s.entries("new")).length, 0);
  await assert.rejects(s.append("source", [{ t: "updateJob", id: "j", patch: { prerequisites: { kind: "all", inputs: ["missing"] } } }], "agent", true), /unknown artifact/);
  assert.equal((await s.entries("source")).length, 3);
}));
