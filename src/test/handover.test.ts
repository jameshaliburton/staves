import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store.js";
import { handoverPlan } from "../handover.js";
import type { Job } from "../model.js";

const job = (id: string, patch: Partial<Job> = {}): Job => ({ id, name: id, track: "human", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed", ...patch });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "staves-transfer-"));
  const store = new Store(dir);
  await store.append("test", [
    { t: "track", track: { id: "human", name: "Reviewer", kind: "person" } },
    { t: "track", track: { id: "other", name: "Manager", kind: "person" } },
    { t: "track", track: { id: "agent", name: "Researcher", kind: "agent" } },
    ...[job("root"), job("read", { parent: "root" }), job("decide", { parent: "root", workKind: "decide" }), job("screen", { parent: "root", tools: [{ name: "Legacy", reach: "screen" }] }), job("other-task", { parent: "root", track: "other" })].map(j => ({ t: "job" as const, job: j }))
  ], "human");
  return { store, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("transfer is one proposal; accept, undo, redo restore all affected tasks", async () => {
  const { store, cleanup } = await fixture();
  try {
    const before = await store.board("test");
    const { plan, seq } = await store.proposeHandover("test", "root", "agent");
    assert.deepEqual(plan.moves, ["root", "read"]);
    assert.deepEqual(plan.stays, ["decide", "screen", "other-task"]);
    assert.deepEqual(await store.board("test"), before);
    await store.append("test", [{ t: "accept", seq }], "human");
    const after = await store.board("test");
    assert.equal(after.jobs.find(j => j.id === "read")?.track, "agent");
    assert.equal(after.jobs.find(j => j.id === "read")?.movedFrom, undefined);
    assert.equal(after.jobs.find(j => j.id === "read")?.status, "draft");
    assert.equal(after.jobs.find(j => j.id === "decide")?.track, "human");
    await store.undo("test"); assert.deepEqual(await store.board("test"), before);
    await store.redo("test"); assert.deepEqual(await store.board("test"), after);
    await store.undo("test"); assert.deepEqual(await store.board("test"), before);
  } finally { await cleanup(); }
});

test("reject leaves board unchanged; stale proposals cannot be accepted", async () => {
  const { store, cleanup } = await fixture();
  try {
    const before = await store.board("test");
    const first = await store.proposeHandover("test", "root", "agent");
    await store.append("test", [{ t: "reject", seq: first.seq }], "human");
    assert.deepEqual(await store.board("test"), before);
    await assert.rejects(store.append("test", [{ t: "accept", seq: first.seq }], "human"), /already been decided/);
    const second = await store.proposeHandover("test", "root", "agent");
    await store.append("test", [{ t: "updateJob", id: "read", patch: { name: "Changed" } }], "human");
    await assert.rejects(store.append("test", [{ t: "accept", seq: second.seq }], "human"), /board changed/);
    assert.equal((await store.board("test")).jobs.find(j => j.id === "root")?.track, "human");
  } finally { await cleanup(); }
});

test("root decision splits structurally and undo removes both new entities", async () => {
  const { store, cleanup } = await fixture();
  try {
    await store.append("test", [{ t: "updateJob", id: "root", patch: { gate: { rule: "Approve", accountable: "human" }, exits: [{ condition: "No", target: "stop" }] } }], "human");
    const before = await store.board("test");
    const { seq } = await store.proposeHandover("test", "root", "agent");
    await store.append("test", [{ t: "accept", seq }], "human");
    const after = await store.board("test");
    assert.equal(after.jobs.find(j => j.id === "root")?.gate, undefined);
    assert.equal(after.jobs.find(j => j.id === "root-human-decision")?.gate?.accountable, "human");
    assert.equal(after.artifacts.length, 1);
    await store.undo("test"); assert.deepEqual(await store.board("test"), before);
  } finally { await cleanup(); }
});

test("unreachable tools block transfer; reverse moves only matching agent tasks", async () => {
  const { store, cleanup } = await fixture();
  try {
    const board = await store.board("test");
    board.jobs[1].tools = [{ name: "Private API", reach: "none" }];
    assert.equal(handoverPlan(board, "root", "agent").ops.length, 0);
    board.jobs[0].track = "agent"; board.jobs[1].track = "agent";
    const reverse = handoverPlan(board, "root", "human");
    assert.deepEqual(reverse.moves, ["root", "read"]);
    assert.equal(reverse.blocks.length, 0);
  } finally { await cleanup(); }
});

test("discussion does not stale a proposal; undo refuses to overwrite subsequent agent edits", async () => {
  const { store, cleanup } = await fixture();
  try {
    const { seq } = await store.proposeHandover("test", "root", "agent");
    await store.append("test", [{ t: "comment", comment: { id: "discussion", about: "root", by: "human", text: "Can this keep its review step?" } }], "human");
    await store.append("test", [{ t: "accept", seq }], "human");
    await store.append("test", [{ t: "updateJob", id: "read", patch: { outcome: "New implementation evidence" } }], "agent");
    await assert.rejects(store.undo("test"), /changed since this action/);
    assert.equal((await store.board("test")).jobs.find(j => j.id === "read")?.outcome, "New implementation evidence");
  } finally { await cleanup(); }
});


test("analysis asks for examples and explicit checks without inventing automatic starts", async () => {
  const { store, cleanup } = await fixture();
  try {
    await store.append("test", [{ t: "updateJob", id: "root", patch: { trigger: "hand", doneWhen: ["Result available"], movedFrom: "old-role" } }], "human");
    const { plan, seq } = await store.proposeHandover("test", "root", "agent");
    assert.ok(plan.needs.some(n => n.includes("root: give one example")));
    assert.ok(plan.needs.some(n => n.includes("root: define a check")));
    assert.ok(plan.changes.some(n => n.includes("manual start is retained")));
    await store.append("test", [{ t: "accept", seq }], "human");
    const root = (await store.board("test")).jobs.find(j => j.id === "root")!;
    assert.equal(root.trigger, "hand");
    assert.equal(root.movedFrom, undefined);
    assert.equal(root.status, "draft");
  } finally { await cleanup(); }
});

test("transfer preserves task promotion, requested start and relative placement atomically", async () => {
  const { store, cleanup } = await fixture();
  try {
    const before = await store.board("test");
    const placement = { parent: null, trigger: "chain" as const, before: "root" };
    const preview = handoverPlan(before, "read", "agent", placement);
    const { seq } = await store.proposeHandover("test", "read", "agent", preview.basis, placement);
    assert.deepEqual(await store.board("test"), before);
    await store.append("test", [{ t: "accept", seq }], "human");
    const moved = (await store.board("test")).jobs.find(j => j.id === "read")!;
    assert.equal(moved.parent, undefined);
    assert.equal(moved.trigger, "chain");
    assert.equal(moved.order, -0.5);
    assert.equal(moved.track, "agent");
    assert.ok(preview.changes.some(change => change.includes("start changes to chain")));
    await store.undo("test");
    assert.deepEqual(await store.board("test"), before);
  } finally { await cleanup(); }
});

test("relative placement adopts the reference parent and rejects cyclic placement", async () => {
  const { store, cleanup } = await fixture();
  try {
    const before = await store.board("test");
    const { seq } = await store.proposeHandover("test", "read", "agent", undefined, { after: "decide" });
    await store.append("test", [{ t: "accept", seq }], "human");
    const moved = (await store.board("test")).jobs.find(j => j.id === "read")!;
    assert.equal(moved.parent, "root");
    assert.equal(moved.order, 2.5);
    assert.ok(handoverPlan(before, "root", "agent", { parent: "read" }).blocks.length);
    assert.ok(handoverPlan(before, "root", "agent", { before: "read" }).blocks.length);
  } finally { await cleanup(); }
});
