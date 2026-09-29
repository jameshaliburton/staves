import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { AgentHandoffError, createAgentHandoff } from "../agent-handoff.js";
import { updateAssessmentDelivery } from "../assessment-store.js";

async function setup(t: { after(fn: () => Promise<void>): void }): Promise<Store> {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-agent-handoff-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("work", [
    { t: "board", id: "work", title: "Review workflow", goal: "Make the review reliable" },
    { t: "track", track: { id: "reviewer", name: "Reviewer", kind: "person" } },
    { t: "job", job: { id: "collect", name: "Collect evidence", track: "reviewer", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
    { t: "job", job: { id: "decide", name: "Decide the outcome", track: "reviewer", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
  ], "J");
  return store;
}


test("creates a scoped discussion request and prompt with the exact MCP read and claim sequence", async t => {
  const store = await setup(t);
  const result = await createAgentHandoff(store, "work", {
    jobIds: ["collect"],
    page: "https://staves.io/?board=work",
    intention: "Work out what the review should produce",
    draft: "I am unsure where the decision belongs.",
  }, { hosted: true });

  assert.equal(result.board, "work");
  assert.equal(result.title, "Review workflow");
  assert.equal(result.revision, 4);
  assert.match(result.prompt, /https:\/\/staves\.io\/\?board=work/);
  assert.match(result.prompt, /staves_brief/);
  assert.match(result.prompt, /staves_assessment.*board.*work.*id/s);
  assert.match(result.prompt, /staves_requests.*board.*work/s);
  assert.match(result.prompt, /staves_request_status.*status.*claimed/s);
  assert.match(result.prompt, /what the review should produce/);
  assert.match(result.prompt, /collect \(Collect evidence\)/);
  assert.doesNotMatch(result.prompt, /THEN INTERVIEW ME/);
  assert.match(result.prompt, /does not authorize.*application code.*yet/i);
  assert.match(result.prompt, /Build a working prototype/);
  assert.match(result.prompt, /Connect an existing project/);
  assert.match(result.prompt, /Refine the spec/);
  assert.match(result.prompt, /Assess feasibility and gaps/);
  assert.match(result.prompt, /Compare the existing code with the spec/);
  assert.match(result.prompt, /Implement the jobs I choose/);
  assert.match(result.prompt, /Test concrete workflow scenarios/);
  assert.match(result.prompt, /Review the workflow from each role/);
  assert.match(result.prompt, /Update this board with findings and progress/);
  assert.doesNotMatch(result.prompt, /recommend this when no code exists/);
  assert.match(result.prompt, /staves_assess.*intent.*implement/s);
  assert.match(result.prompt, /same board.*same selected scope/i);
  assert.match(result.prompt, /staves_git_context/);
  assert.match(result.prompt, /staves_development_link/);
  assert.match(result.prompt, /staves_assessment_return/);
  assert.match(result.prompt, /no automatic background rebuild/i);
  assert.match(result.prompt, /unresolved/i);

  const saved = await store.entries("work");
  assert.equal(saved.filter(entry => entry.op.t === "comment" && entry.op.comment.assessment?.kind === "request").length, 1);
  const request = (await import("../assessment-store.js")).getAssessment(store, "work", result.requestId);
  assert.equal((await request).request.intent, "discuss");
  assert.deepEqual((await request).request.packet.request.jobIds, ["collect"]);
});

test("reuses only a matching discussion scope when a request id is supplied", async t => {
  const store = await setup(t);
  const first = await createAgentHandoff(store, "work", { jobIds: ["collect"], intention: "Clarify the evidence" });
  const before = (await store.entries("work")).length;

  const reused = await createAgentHandoff(store, "work", { jobIds: ["collect"], requestId: first.requestId, intention: "Retry copying" });
  assert.equal(reused.requestId, first.requestId);
  assert.equal((await store.entries("work")).length, before);
  await assert.rejects(createAgentHandoff(store, "work", { jobIds: ["decide"], requestId: first.requestId }), /scope/i);
  await assert.rejects(createAgentHandoff(store, "work", { requestId: "missing" }), /not found/i);
});

test("rejects unknown ids, malformed pages, and implementation requests", async t => {
  const store = await setup(t);
  await assert.rejects(createAgentHandoff(store, "work", { jobIds: ["missing"] }), /not available/i);
  await assert.rejects(createAgentHandoff(store, "work", { page: "javascript:alert(1)" }), /http/i);
  await assert.rejects(createAgentHandoff(store, "work", { page: "https://user:pass@example.com/work" }), /credential/i);
  await assert.rejects(createAgentHandoff(store, "unknown", {}), /board/i);
});

test("hosted prompts omit local filesystem setup and use the hosted origin by default", async t => {
  const store = await setup(t);
  const result = await createAgentHandoff(store, "work", {}, { hosted: true, defaultPage: "https://staves.io/workspace?board=work" });
  assert.match(result.prompt, /https:\/\/staves\.io\/workspace\?board=work/);
  assert.doesNotMatch(result.prompt, /\.staves\/work\.jsonl/);
  assert.doesNotMatch(result.prompt, /\bcd /);
});

test("rejects a readable board with no live jobs", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-agent-handoff-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("empty", [{ t: "board", id: "empty", title: "Empty workflow" }], "J");
  await assert.rejects(createAgentHandoff(store, "empty", {}), error => error instanceof AgentHandoffError && error.status === 400 && /no live jobs/i.test(error.message));
});

test("uses the storage board name in MCP instructions when the board id differs", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-agent-handoff-alias-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.append("stored-name", [
    { t: "board", id: "canonical-id", title: "Aliased workflow" },
    { t: "track", track: { id: "reviewer", name: "Reviewer", kind: "person" } },
    { t: "job", job: { id: "job", name: "Do the work", track: "reviewer", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
  ], "J");
  const result = await createAgentHandoff(store, "stored-name", {});
  assert.match(result.prompt, /staves_brief with board "stored-name"/);
  assert.match(result.prompt, /staves_assessment with board "stored-name"/);
  assert.doesNotMatch(result.prompt, /staves_brief with board "canonical-id"/);
});

test("reuses across delivery log entries but creates a fresh request after a design change", async t => {
  const store = await setup(t);
  const first = await createAgentHandoff(store, "work", { jobIds: ["collect"] });
  await updateAssessmentDelivery(store, "work", first.requestId, { status: "claimed" }, "agent");
  const reused = await createAgentHandoff(store, "work", { jobIds: ["collect"], requestId: first.requestId });
  assert.equal(reused.requestId, first.requestId);

  await store.append("work", [{ t: "updateJob", id: "collect", patch: { outcome: "A reviewed evidence packet" } }], "J");
  const fresh = await createAgentHandoff(store, "work", { jobIds: ["collect"], requestId: first.requestId });
  assert.notEqual(fresh.requestId, first.requestId);
  assert.equal((await store.entries("work")).filter(entry => entry.op.t === "comment" && entry.op.comment.assessment?.kind === "request").length, 2);
});

test("respects an explicit build intention without pretending the discussion request authorizes code", async t => {
  const store = await setup(t);
  const result = await createAgentHandoff(store, "work", { intention: "Build a prototype for this review workflow" });
  assert.match(result.prompt, /already explicitly asks to build or prototype.*proceed without asking/i);
  assert.match(result.prompt, /create a new staves_assess request with intent \"implement\"/);
  assert.match(result.prompt, /does not authorize application code yet/i);
});
