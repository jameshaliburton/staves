import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { fold, type Entry, type Op } from "../ops.js";
import type { Board } from "../model.js";
import { documentHandoffs, importStavesDocument, passthroughOf, toStavesDocument, fromStavesDocument, type StavesDocument } from "../format.js";

const root = new URL("../../", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("spec/schema/board.schema.json", root), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats.default(ajv);
const validate = ajv.compile(schema);
const valid = (doc: unknown, label: string) => assert.ok(validate(doc), `${label}: ${ajv.errorsText(validate.errors, { separator: "\n" })}`);

const boardOf = (ops: Op[]): Board => fold(ops.map((op, i): Entry => ({ op, seq: i + 1, by: "test", at: "2026-09-23T10:00:00.000Z" })));
/** What a board looks like once read back: no tombstones, no inline instruction text, JSON-shaped. */
function expected(board: Board): Board {
  const b: Board = JSON.parse(JSON.stringify(board));
  b.tracks = b.tracks.filter(t => !t.removed);
  b.jobs = b.jobs.filter(j => !j.removed);
  b.regions = b.regions.filter(r => !r.removed);
  for (const j of b.jobs) for (const i of j.instructions ?? []) delete i.text;
  return b;
}
const roundTrip = (board: Board) => fromStavesDocument(JSON.parse(JSON.stringify(toStavesDocument(board))));

// Every field the model carries, with ids the format does not allow and a job that was removed.
const rich: Op[] = [
  { t: "board", id: "rich board", title: "Refunds", goal: "Every refund is right the first time", origin: "test" },
  { t: "setContext", context: { purpose: "Refunds", where: "code", stance: "to-be", langfuse: { baseUrl: "https://cloud.langfuse.com", projectId: "p1" } } },
  { t: "track", track: { id: "customer", name: "Customer", kind: "outside" } },
  { t: "track", track: { id: "agent refunds", name: "Refund agent", kind: "agent", meta: "Issues refunds", budgetSeconds: 30, provenance: { source: "agent", by: "claude-code", at: "2026-09-20T10:00:00Z", commit: "4be1c2e" } } },
  { t: "track", track: { id: "lead", name: "Support lead", kind: "person", capacityHoursPerWeek: 38, people: 2 } },
  { t: "track", track: { id: "gone", name: "Old team", kind: "person" } },
  { t: "removeTrack", id: "gone" },
  { t: "artifact", artifact: { id: "request", name: "Refund request", kind: "message", external: true, livesIn: "Zendesk", note: "Order number first" } },
  { t: "artifact", artifact: { id: "decision/1", name: "Decision", kind: "decision" } },
  { t: "job", job: { id: "ask", name: "Ask for a refund", track: "customer", kind: "outside", inputs: [], outputs: ["request"], provenance: { source: "human", by: "human:j" }, status: "draft" } },
  { t: "job", job: {
    id: "issue refund", name: "Issue the refund", track: "agent refunds", inputs: ["request"], outputs: ["decision/1"],
    outcome: "The customer has their money", beneficiary: "customer", doneWhen: ["money sent", "customer told"], rationale: "cheaper than a person",
    trigger: "event", triggerNote: "a request lands", prerequisites: { kind: "conditional", inputs: ["request"], condition: "order found" },
    exits: [{ condition: "above €200", target: "review", share: 0.1 }, { condition: "fraud", target: "stop" }, { condition: "unclear" }],
    gate: { rule: "nothing above €200 without a person", accountable: "lead" },
    loop: { to: "issue refund", limit: 3, then: "hand to a person" },
    examples: [{ in: "order 12, €40", out: "refunded", note: "happy path" }], checks: [{ rule: "order exists", onFail: "ask the customer" }],
    instructions: [{ path: "prompts/refund.md", summary: "the refund prompt", text: "You are a refund agent…" }],
    sources: [{ path: "src/refund.ts", symbol: "issue" }], tools: [{ name: "Payments API", reach: "api", does: "refunds an order", limits: "EUR only" }],
    minutes: 2, perWeek: 400, order: 1, workKind: "decide", implementation: { state: "implemented" },
    provenance: { source: "agent", by: "claude-code", confidence: 0.8, at: "2026-09-20T10:00:00Z", commit: "4be1c2e" }, status: "draft",
  } },
  { t: "job", job: { id: "check", name: "Check the order", parent: "issue refund", track: "agent refunds", inputs: ["request"], outputs: [], provenance: { source: "derived", by: "staves" }, status: "draft" } },
  { t: "job", job: { id: "review", name: "Review a large refund", track: "lead", kind: "ghost", inputs: ["decision/1"], outputs: [], provenance: { source: "confirmed", by: "human:lead" }, status: "confirmed", confirmedFields: ["outcome", "gate"], outcome: "A person has looked" } },
  { t: "job", job: { id: "old", name: "Fax the bank", track: "lead", inputs: [], outputs: [], provenance: { source: "human" }, status: "draft" } },
  { t: "removeJob", id: "old" },
  { t: "region", region: { id: "r1", name: "Money", members: ["issue refund"] } },
  { t: "ask", question: { id: "q1", about: "review", askedBy: "human", status: "raised", text: "Who covers holidays?" } },
  { t: "comment", comment: { id: "c1", about: "review", by: "human:j", text: "This is new" } },
];

const libraryBoards = async (): Promise<[string, Board][]> => {
  const library = await import(new URL("design/editor/library.mjs", root).href) as { examples: { id: string }[]; exampleOps: (id: string) => Op[] };
  return library.examples.map(e => [e.id, boardOf(library.exampleOps(e.id))]);
};

test("every example in the spec validates against the schema", () => {
  const dir = new URL("spec/examples/", root);
  const files = readdirSync(dir).filter(f => f.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) valid(JSON.parse(readFileSync(new URL(file, dir), "utf8")), file);
});

test("every export validates, and reads back as the board it came from", async () => {
  const boards: [string, Board][] = [["rich", boardOf(rich)], ...await libraryBoards()];
  assert.ok(boards.length > 3, "the library examples are fixtures too");
  for (const [name, board] of boards) {
    const doc = toStavesDocument(board);
    valid(JSON.parse(JSON.stringify(doc)), name);
    assert.deepEqual(roundTrip(board), expected(board), name);
  }
});

test("ids the format does not allow are renamed on the way out and restored on the way in", () => {
  const doc = toStavesDocument(boardOf(rich));
  assert.equal(doc.id, "rich-board");
  assert.ok(doc.tracks.some(t => t.id === "agent-refunds"));
  assert.ok(doc.artifacts.some(a => a.id === "decision-1"));
  const job = doc.jobs.find(j => j.name === "Issue the refund")!;
  assert.equal(job.id, "issue-refund");
  assert.equal(job.loop?.to, "issue-refund");
  assert.equal(job.gate?.accountable, "lead");
  const back = fromStavesDocument(doc);
  assert.equal(back.id, "rich board");
  assert.ok(back.jobs.some(j => j.id === "issue refund" && j.track === "agent refunds" && j.outputs[0] === "decision/1"));
});

test("the core says what the spec says: provenance, change, evidence, extensions", () => {
  const board = boardOf([...rich, { t: "addExecutionEvidence", id: "issue refund", evidence: { provider: "langfuse", projectId: "p1", traceId: "t1", observationId: "o1", observedAt: "2026-09-19T08:14:03Z", status: "observed", durationMs: 5400, mapping: { method: "reviewed", boardId: "rich board", jobId: "issue refund", reviewedBy: "role:engineer", reviewedAt: "2026-09-20T09:00:00Z" } } }]);
  const doc = toStavesDocument(board);
  assert.equal(doc.stance, "to-be");
  const issue = doc.jobs.find(j => j.id === "issue-refund")!;
  assert.deepEqual(issue.provenance?.["*"], { method: "code", by: "agent:claude-code", at: "2026-09-20T10:00:00Z", ref: "git:4be1c2e:src/refund.ts#issue", confidence: 0.8 });
  assert.deepEqual(issue.refs, [{ type: "code", path: "src/refund.ts", symbol: "issue" }, { type: "instructions", path: "prompts/refund.md" }]);
  assert.ok(!JSON.stringify(doc).includes("You are a refund agent"), "inline instruction text is not carried");
  assert.deepEqual(issue.evidence, [{ system: "langfuse", traceId: "t1", spanId: "o1", observedAt: "2026-09-19T08:14:03Z", status: "ok", durationMs: 5400, mapping: { method: "reviewed", by: "role:engineer", at: "2026-09-20T09:00:00Z" } }]);
  assert.deepEqual(issue.extensions?.["io.staves.measures"], { minutes: 2, perWeek: 400 });
  assert.deepEqual(issue.extensions?.["io.staves.detail"], { examples: [{ in: "order 12, €40", out: "refunded", note: "happy path" }], checks: [{ rule: "order exists", onFail: "ask the customer" }] });
  const review = doc.jobs.find(j => j.id === "review")!;
  assert.equal(review.change, "added");
  assert.equal(review.kind, undefined);
  assert.deepEqual(review.provenance, { "*": { method: "interview", by: "person:lead", confirmed: true }, outcome: { method: "interview", confirmed: true }, gate: { method: "interview", confirmed: true } });
  assert.equal(doc.jobs.find(j => j.id === "check")!.provenance?.["*"].method, "inferred");
  assert.ok(!doc.jobs.some(j => j.name === "Fax the bank"), "tombstones are not exported");
  assert.ok(!doc.tracks.some(t => t.name === "Old team"));
  valid(JSON.parse(JSON.stringify(doc)), "with evidence");
  assert.deepEqual(roundTrip(board), expected(board));
});

test("handoffs are derived with the spec's deterministic ids", () => {
  const doc = toStavesDocument(boardOf(rich));
  assert.deepEqual(doc.handoffs, documentHandoffs(doc));
  const ids = doc.handoffs!.map(h => h.id);
  assert.ok(ids.includes("ask>issue-refund@request"));
  assert.ok(ids.includes("issue-refund>review@decision-1"));
  assert.ok(ids.includes("issue-refund>review!0"));
  assert.ok(!ids.some(id => id.endsWith("~loop")), "a job looping on itself hands nothing to anyone");
  assert.equal(toStavesDocument(boardOf(rich), { handoffs: false }).handoffs, undefined);
});

test("a document from another tool reads in, and says what a board could not keep", () => {
  const example: StavesDocument = JSON.parse(readFileSync(new URL("spec/examples/support-triage.staves.json", root), "utf8"));
  const { board, notes } = importStavesDocument(example);
  assert.deepEqual(board.tracks.map(t => t.id), example.tracks.map(t => t.id));
  assert.deepEqual(board.jobs.map(j => j.id), example.jobs.map(j => j.id));
  const refund = board.jobs.find(j => j.id === "refund")!;
  assert.equal(refund.provenance.source, "agent", "the board-wide source applies where a job has none");
  assert.equal(board.jobs.find(j => j.id === "escalate")!.provenance.source, "confirmed");
  assert.deepEqual(board.jobs.find(j => j.id === "answer")!.sources, [{ path: "src/agents/triage.ts", symbol: "answer" }]);
  assert.equal(board.jobs.find(j => j.id === "answer")!.perWeek, 1200);
  const dispute = board.questions.find(q => q.about === "refund")!;
  assert.match(dispute.text, /Sources disagree about gate/);
  assert.match(dispute.text, /every refund is checked by a person/);
  assert.ok(notes.some(n => /dispute about gate became a question/.test(n)));
  assert.ok(notes.some(n => /evidence from systems other than Langfuse/.test(n)));
  const again = toStavesDocument(board);
  valid(JSON.parse(JSON.stringify(again)), "re-exported example");
  for (const j of example.jobs) {
    const out = again.jobs.find(x => x.id === j.id)!;
    for (const key of ["gate", "exits", "evidence", "refs", "tools", "provenance"] as const) assert.deepEqual(out[key], j[key], `${j.id}.${key}`);
    assert.deepEqual(out.extensions?.["io.staves.measures"], j.extensions?.["io.staves.measures"], `${j.id} measures`);
  }
  for (const t of example.tracks) assert.deepEqual(again.tracks.find(x => x.id === t.id)!.refs, t.refs, `${t.id}.refs`);
  assert.deepEqual(again.provenance, example.provenance);
});

// What a board has no field for is kept as written and put back: extensions it does not know, evidence
// from other systems, references it does not model, provenance finer than it records.
const foreign: StavesDocument = {
  $schema: "https://staves.io/spec/0.1/board.schema.json", staves: "0.1", id: "claims", title: "Claims", stance: "as-is",
  provenance: { "*": { method: "document", by: "tool:acme-mapper", ref: "https://acme.example/claims" } },
  refs: [{ type: "uri", uri: "https://acme.example/process/42" }],
  extensions: { "com.acme.review": { round: 2, reviewers: ["role:auditor"] } },
  tracks: [
    { id: "adjuster", name: "Adjuster", kind: "person", refs: [{ type: "role", uri: "https://hr.example/roles/adjuster" }], extensions: { "com.acme.org": { costCentre: "C-12" } } },
    { id: "scorer", name: "Fraud scorer", kind: "agent", refs: [{ type: "a2a-agent", uri: "https://agents.example/scorer.json" }], provenance: { "*": { method: "code", by: "agent:acme", ref: "git:abc1234" } } },
  ],
  artifacts: [
    { id: "claim", name: "Claim", kind: "document", provenance: { "*": { method: "document", by: "tool:acme-mapper" } }, extensions: { "com.acme.pii": { classes: ["name", "iban"] } } },
    { id: "score", name: "Fraud score", kind: "measure" },
  ],
  jobs: [
    { id: "score-claim", name: "Score the claim", track: "scorer", inputs: ["claim"], outputs: ["score"], status: "draft",
      provenance: { "*": { method: "trace", by: "tool:otel-import", at: "2026-09-20T08:00:00Z" }, trigger: { method: "code", by: "agent:acme", ref: "git:abc1234:src/score.ts#run" } },
      refs: [{ type: "mcp-tool", server: "fraud", name: "score" }, { type: "code", path: "src/score.ts", symbol: "run" }, { type: "onet-task", id: "13-2053.00" }],
      tools: [{ name: "Fraud API", reach: "api", refs: [{ type: "uri", uri: "https://api.example/fraud" }], extensions: { "com.acme.sla": { p99ms: 300 } } }],
      evidence: [{ system: "otel", traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", observedAt: "2026-09-19T08:14:03Z", status: "ok", mapping: { method: "instrumented" } },
        { system: "openinference", traceId: "t-2", graphNodeId: "score", observedAt: "2026-09-19T09:00:00Z", status: "error" }],
      extensions: { "com.acme.review": { flagged: true }, "io.staves.measures": { perWeek: 900 } } },
    { id: "decide", name: "Decide the claim", track: "adjuster", inputs: ["claim", "score"], outputs: [], status: "confirmed",
      gate: { rule: "a person decides every claim above €5,000", accountable: "adjuster" },
      provenance: { "*": { method: "interview", by: "role:adjuster", confirmed: true } } },
  ],
};
foreign.handoffs = documentHandoffs(foreign);

test("an unknown extension and everything else a board cannot hold round-trip unchanged", () => {
  valid(foreign, "foreign input");
  const { board } = importStavesDocument(JSON.parse(JSON.stringify(foreign)));
  const kept = passthroughOf(board);
  assert.deepEqual(kept?.board?.extensions, { "com.acme.review": { round: 2, reviewers: ["role:auditor"] } });
  assert.deepEqual(kept?.jobs?.["score-claim"]?.extensions, { "com.acme.review": { flagged: true } }, "only the namespaces Staves does not know");
  assert.equal(kept?.jobs?.["score-claim"]?.evidence?.length, 2);
  const out = JSON.parse(JSON.stringify(toStavesDocument(board)));
  valid(out, "foreign output");
  assert.deepEqual(out, foreign);
  // It survives a JSON copy of the board, which is how a board travels between processes.
  assert.deepEqual(JSON.parse(JSON.stringify(toStavesDocument(JSON.parse(JSON.stringify(board))))), foreign);
});

test("a part the board has since changed is written from the board, not from what was kept", () => {
  const board = fromStavesDocument(JSON.parse(JSON.stringify(foreign)));
  const job = board.jobs.find(j => j.id === "score-claim")!;
  job.sources = [{ path: "src/score-v2.ts" }];
  job.tools = [{ name: "Fraud API v2", reach: "mcp" }];
  const out = toStavesDocument(board).jobs.find(j => j.id === "score-claim")!;
  assert.deepEqual(out.refs, [{ type: "code", path: "src/score-v2.ts" }]);
  assert.deepEqual(out.tools, [{ name: "Fraud API v2", reach: "mcp" }]);
  assert.deepEqual(out.extensions?.["com.acme.review"], { flagged: true }, "unknown extensions still come back");
  assert.equal(out.evidence?.length, 2, "and so does other systems' evidence");
});

test("a document of another version is refused in words", () => {
  assert.throws(() => fromStavesDocument({ staves: "0.2", id: "x", title: "x", stance: "as-is", tracks: [], artifacts: [], jobs: [] }), /reads format 0\.1; the document is 0\.2/);
  assert.throws(() => fromStavesDocument({ id: "x" }), /no "staves" version/);
});
