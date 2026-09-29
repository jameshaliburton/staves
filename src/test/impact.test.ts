import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBoard, type Job } from "../model.js";
import { investigateImpact } from "../impact.js";
const job = (id: string, fields: Partial<Job> = {}): Job => ({ id, name: id, track: "ops", inputs: [], outputs: [], status: "draft", provenance: { source: "human" }, ...fields });
function fixture() {
  const b = emptyBoard("procurement");
  b.tracks = [{ id: "ops", name: "Operations", kind: "person" }];
  b.artifacts = [{ id: "request", name: "Request", kind: "record" }, { id: "approval", name: "Approval", kind: "decision" }];
  b.jobs = [job("collect", { outputs: ["request"] }), job("approve", { inputs: ["request"], outputs: ["approval"], gate: { rule: "Approve eligible vendors", accountable: "ops" } }), job("provision", { inputs: ["approval"], prerequisites: { kind: "all", inputs: ["approval"] } }), job("pay", { inputs: ["approval"], loop: { to: "approve", limit: 2 } }), job("exception", { gate: { rule: "Approve exceptional terms", accountable: "ops" } }), job("register"), job("unrelated"), job("gone", { inputs: ["approval"], removed: true })];
  b.vocabulary = { version: 1, namespace: "procurement", concepts: [{ id: "vendor", name: "Vendor", definition: "The supplying organization", status: "confirmed", links: [{ kind: "job", id: "approve" }, { kind: "job", id: "register" }] }] };
  return b;
}
test("approval change finds upstream, multiple downstream paths, shared authority and a disconnected shared concept", () => {
  const b = fixture(); const before = structuredClone(b); const p = investigateImpact(b, { jobIds: ["approve"] });
  assert.deepEqual(p.jobs.map(j => j.id), ["approve", "collect", "provision", "pay", "exception", "register"]);
  assert.ok(p.jobs.find(j => j.id === "collect")?.reasons.includes("upstream"));
  assert.ok(p.jobs.find(j => j.id === "provision")?.reasons.includes("downstream"));
  assert.ok(p.jobs.find(j => j.id === "exception")?.reasons.includes("shared-authority"));
  assert.ok(p.jobs.find(j => j.id === "register")?.reasons.includes("shared-concept"));
  assert.ok(p.unknowns.some(s => s.includes("approve: prerequisite")));
  assert.match(p.repositoryQuestions.join(" "), /bypass, rejection, and recovery/);
  assert.match(p.basis, /no repository, test, or trace inspection/);
  assert.deepEqual(b, before);
});
test("a concept focus expands via explicit track and artifact associations without matching words", () => {
  const b = fixture(); b.vocabulary!.concepts[0].links = [{ kind: "artifact", id: "approval" }];
  const p = investigateImpact(b, { conceptIds: ["vendor"] });
  assert.ok(p.jobs.find(j => j.id === "pay")?.reasons.includes("focus"));
  assert.ok(!p.jobs.some(j => j.id === "register"));
  b.vocabulary!.concepts[0].links = [{ kind: "track", id: "ops" }];
  assert.equal(investigateImpact(b, { conceptIds: ["vendor"] }).jobs.length, 7);
});
test("missing or removed focus fails rather than silently investigating the wrong scope", () => {
  const b = fixture();
  assert.throws(() => investigateImpact(b, {}), /Choose/);
  assert.throws(() => investigateImpact(b, { jobIds: ["gone"] }), /Unknown/);
  assert.throws(() => investigateImpact(b, { conceptIds: ["missing"] }), /Unknown/);
});
test("linked boards and dangling exits are explicit unknowns, containment does not imply execution", () => {
  const b = fixture(); b.jobs.push(job("child", { parent: "approve", boardRef: "private", exits: [{ condition: "failed", target: "missing" }] }));
  const p = investigateImpact(b, { jobIds: ["child"] });
  assert.ok(p.jobs.some(j => j.id === "approve"));
  assert.ok(!p.jobs.find(j => j.id === "approve")?.reasons.includes("upstream"));
  assert.match(p.unknowns.join(" "), /linked board private was not read/);
  assert.match(p.unknowns.join(" "), /exit has no active destination/);
});
test("large impact packets signal omitted candidates and remain bounded", () => {
  const b = fixture(); for (let i = 0; i < 100; i++) b.jobs.push(job(`consumer-${i}`, { inputs: ["approval"] }));
  const p = investigateImpact(b, { jobIds: ["approve"] });
  assert.equal(p.jobs.length, 80); assert.ok(p.omitted.jobs > 0); assert.ok(p.unknowns.length <= 60);
});

test("focus near the end of a large board stays in the bounded packet", () => {
  const b = fixture(); for (let i = 0; i < 100; i++) b.jobs.unshift(job(`consumer-${i}`, { inputs: ["approval"] }));
  assert.equal(investigateImpact(b, { jobIds: ["approve"] }).jobs[0].id, "approve");
});

test("MCP impact reads only the authorized board and never appends operations", async () => {
  const { buildServer } = await import("../mcp.js");
  const calls: string[] = [];
  const store = { board: async (id: string) => { calls.push(id); if (id !== "procurement") throw new Error("denied"); return fixture(); }, append: async () => { throw new Error("must not write"); } };
  const server = buildServer(store as unknown as import("../store.js").Store, "agent", "http://localhost:5178");
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: object, extra: object) => Promise<{ content: { text: string }[] }> }> })._registeredTools.staves_impact;
  const result = await tool.handler({ board: "procurement", jobIds: ["approve"] }, {});
  assert.equal(JSON.parse(result.content[0].text).boardId, "procurement");
  assert.deepEqual(calls, ["procurement"]);
  await assert.rejects(tool.handler({ board: "private", jobIds: ["approve"] }, {}), /denied/);
});
