import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, type Op } from "../ops.js";
import { lint, loads, scorecard } from "../derive.js";
import { renderSVG } from "../render.js";

function board(extra: Op[] = []) {
  const ops: Op[] = [
    { t: "board", id: "trust", title: "Two entrances" },
    { t: "track", track: { id: "p", name: "Practitioner", kind: "person" } },
    { t: "track", track: { id: "s", name: "Lookup", kind: "system" } },
    ...["a", "b"].map((id): Op => ({ t: "artifact", artifact: { id, name: id, kind: "message" } })),
    ...["a", "b"].map((id): Op => ({ t: "job", job: { id, name: `Ask ${id}`, track: "p", inputs: [], outputs: [id], provenance: { source: "human" }, status: "draft" } })),
    { t: "job", job: { id: "lookup", name: "Find the owner", track: "s", inputs: ["a", "b"], outputs: [], beneficiary: "The shopper", provenance: { source: "human" }, status: "draft" } },
    ...extra,
  ];
  return fold(ops.map((op, seq) => ({ op, seq: seq + 1, at: "", by: "human" })));
}

test("two entrances prompt for semantics instead of asserting an all-input join", () => {
  const finding = lint(board()).find((f) => f.rule === "two-entrances");
  assert.ok(finding, "fixture must exercise the reported shape");
  assert.doesNotMatch(finding.message, /waits for all/);
  assert.match(finding.message, /Are all required.*any one sufficient/);
});

test("explicit beneficiaries are respected without a vocabulary whitelist", () => {
  for (const beneficiary of ["The shopper", "Marisol", "Dispatch coordinators"]) {
    assert.ok(!lint(board([{ t: "updateJob", id: "lookup", patch: { beneficiary } }])).some((f) => f.rule === "machinery-at-top"));
  }
  const finding = lint(board([{ t: "updateJob", id: "lookup", patch: { beneficiary: " " } }])).find((f) => f.rule === "machinery-at-top");
  assert.equal(finding?.severity, "info");
  assert.match(finding!.message, /no beneficiary recorded/);
});

test("unknown effort remains visible, while a known subtotal can establish overload", () => {
  const b = board([
    { t: "setVolume", perWeek: 40 },
    { t: "updateJob", id: "a", patch: { minutes: 30 } },
    { t: "track", track: { id: "p", name: "Practitioner", kind: "person", capacityHoursPerWeek: 10 } },
  ]);
  assert.equal(scorecard(b).humanHours, 20);
  assert.deepEqual(scorecard(b).humanHoursUnknown, ["b"]);
  assert.deepEqual(loads(b)[0].unknownJobs, ["b"]);
  assert.equal(loads(b)[0].over, true);
  assert.match(lint(b).find((f) => f.rule === "over-capacity")!.message, /specified inputs alone/);
  assert.match(renderSVG(b), /Effort incomplete/);
});

test("zero is a supplied estimate; missing frequency and invalid durations remain unknown", () => {
  const b = board([
    { t: "updateJob", id: "a", patch: { minutes: 0, perWeek: 0 } },
    { t: "updateJob", id: "b", patch: { minutes: 20 } },
  ]);
  assert.deepEqual(scorecard(b).humanHoursUnknown, ["b"]);
  b.jobs.find((j) => j.id === "b")!.minutes = -1;
  b.perWeek = 2;
  assert.deepEqual(scorecard(b).humanHoursUnknown, ["b"]);
});

test("alternative comparison includes rules, outcomes and authority changes", async () => {
  const { diff } = await import("../derive.js");
  const original = board();
  const alternative = structuredClone(original);
  const job = alternative.jobs.find((j) => j.id === "lookup")!;
  job.prerequisites = { kind: "any", inputs: ["a", "b"] };
  job.outcome = "A sourced answer";
  job.gate = { rule: "Evidence checked", accountable: "p" };
  const changes = diff(original, alternative).changed;
  assert.deepEqual(changes[0].fields.map((field) => field.field).sort(), ["gate", "outcome", "prerequisites"]);
  assert.equal(changes[0].fields.find((field) => field.field === "outcome")!.before, null);
});

test("alternative comparison exposes performer changes and changed handoff meaning", async () => {
  const { diff } = await import("../derive.js");
  const original = board();
  const alternative = structuredClone(original);
  alternative.tracks[0].kind = "agent";
  alternative.artifacts[0].name = "Automatically approved request";
  alternative.goal = "Handle routine cases automatically";
  const changes = diff(original, alternative);
  assert.equal(changes.tracksChanged[0].before.kind, "person");
  assert.equal(changes.tracksChanged[0].after?.kind, "agent");
  assert.equal(changes.artifactsChanged[0].after?.name, "Automatically approved request");
  assert.equal(changes.contextChanged[0].field, "goal");
});
