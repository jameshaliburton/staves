import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { fold, migrate, type Entry } from "../ops.js";

async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-proposals-"));
  try {
    const store = new Store(dir);
    await store.append("work", ["j", "other"].map(id => ({ t: "job" as const, job: { id, name: id, track: "t", inputs: [], outputs: [], status: "draft" as const, provenance: { source: "human" as const } } })), "human");
    await run(store);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("stale proposal rejects before persistence and shared fold also rejects it", () => fixture(async s => {
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Agent proposal" } }], "agent", true);
  const proposal = (await s.proposals("work"))[0];
  assert.equal(proposal.proposalBasis?.version, 1);
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Human correction" } }], "human");
  const before = await readFile(s.file("work"), "utf8");
  await assert.rejects(s.append("work", [{ t: "accept", seq: proposal.seq }], "human"), /stale/);
  assert.equal(await readFile(s.file("work"), "utf8"), before);
  assert.equal((await s.board("work")).jobs[0].name, "Human correction");
  const entries = await s.entries("work");
  assert.throws(() => fold([...entries, { seq: 5, at: "now", by: "human", op: { t: "accept", seq: proposal.seq } }]), /stale/);
}));

test("unrelated edits permit scoped acceptance, applied at the decision", () => fixture(async s => {
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Proposal" } }], "agent", true);
  await s.append("work", [{ t: "updateJob", id: "other", patch: { name: "Other correction" } }, { t: "setGoal", goal: "New goal" }], "human");
  const entries = await s.entries("work");
  assert.equal(fold(entries).jobs[0].name, "j");
  await s.append("work", [{ t: "accept", seq: 3 }], "human");
  const board = await s.board("work");
  assert.equal(board.jobs[0].name, "Proposal");
  assert.equal(board.jobs[1].name, "Other correction");
  assert.equal(board.goal, "New goal");
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Later human change" } }], "human");
  assert.equal((await s.board("work")).jobs[0].name, "Later human change");
}));

test("pinned inherited work has a captured proposal basis", () => fixture(async s => {
  await s.append("work", [{ t: "board", id: "work", title: "Work" }], "human");
  await s.branch("work", "alt", "Alternative");
  await s.append("alt", [{ t: "updateJob", id: "j", patch: { name: "Proposal" } }], "agent", true);
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Source change" } }], "human");
  await s.append("alt", [{ t: "accept", seq: 3 }], "human");
  assert.equal((await s.board("alt")).jobs[0].name, "Proposal");
  await s.append("alt", [{ t: "updateJob", id: "j", patch: { name: "Second proposal" } }], "agent", true);
  await s.append("alt", [{ t: "updateJob", id: "j", patch: { name: "Alternative correction" } }], "human");
  await assert.rejects(s.append("alt", [{ t: "accept", seq: 5 }], "human"), /stale/);
}));

test("stale proposals can be rejected, decisions cannot be repeated or proposed", () => fixture(async s => {
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Proposal" } }], "agent", true);
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Human" } }], "human");
  await s.append("work", [{ t: "reject", seq: 3 }], "human");
  assert.equal((await s.proposals("work")).length, 0);
  await assert.rejects(s.append("work", [{ t: "accept", seq: 3 }], "human"), /already been decided/);
  await assert.rejects(s.append("work", [{ t: "reject", seq: 3 }], "human"), /already been decided/);
  await assert.rejects(s.append("work", [{ t: "accept", seq: 3 }], "agent", true), /cannot themselves/);
  const entries = await s.entries("work");
  assert.throws(() => fold([...entries, { seq: 6, at: "now", by: "human", op: { t: "accept", seq: 3 } }]), /already been decided/);
}));

test("same-batch corrections stale an acceptance without partial writes", () => fixture(async s => {
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Proposal" } }], "agent", true);
  const before = await readFile(s.file("work"), "utf8");
  await assert.rejects(s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Human" } }, { t: "accept", seq: 3 }], "human"), /stale/);
  assert.equal(await readFile(s.file("work"), "utf8"), before);
}));

test("legacy logs preserve replay and migration never invents captured state", () => {
  const entries: Entry[] = [
    { seq: 1, at: "then", by: "agent", pending: true, op: { t: "setGoal", goal: "Proposal" } },
    { seq: 2, at: "then", by: "human", op: { t: "setGoal", goal: "Human" } },
    { seq: 3, at: "then", by: "human", op: { t: "accept", seq: 1 } },
  ];
  assert.equal(fold(entries).goal, "Human");
  assert.equal(migrate(entries[0]).proposalBasis, undefined);
});

test("past acceptance on an unpinned legacy alternative remains readable after source edits", () => fixture(async s => {
  await s.append("work", [{ t: "board", id: "work", title: "Work" }], "human");
  await s.append("legacy", [{ t: "base", board: "work" }, { t: "board", id: "legacy", title: "Legacy" }], "human");
  await s.append("legacy", [{ t: "updateJob", id: "j", patch: { name: "Alternative" } }], "agent", true);
  await s.append("legacy", [{ t: "accept", seq: 3 }], "human");
  await s.append("work", [{ t: "updateJob", id: "j", patch: { name: "Changed source" } }], "human");
  assert.equal((await s.board("legacy")).jobs[0].name, "Alternative");
  await s.append("legacy", [{ t: "updateJob", id: "j", patch: { name: "Second proposal" } }], "agent", true);
  await s.append("legacy", [{ t: "updateJob", id: "j", patch: { name: "New human decision" } }], "human");
  await assert.rejects(s.append("legacy", [{ t: "accept", seq: 5 }], "human"), /stale/);
}));
