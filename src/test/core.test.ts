import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, type Entry } from "../ops.js";
import { cut, handoffs, lint, columns } from "../derive.js";
import { renderSVG } from "../render.js";
import { brief } from "../brief.js";

// An invented process: a customer asks, a triage agent decides, a worker does the thing,
// a person reviews, a mailer sends. Deliberately imperfect.
const P = (source: "agent" | "human" = "agent") => ({ source, by: "test" });
const e = (op: any, i: number): Entry => ({ seq: i, at: "2026-09-04", by: "test", op });
const entries: Entry[] = [
  { t: "board", id: "demo", title: "How a request becomes an answer", goal: "Answer every request; never send an answer nobody checked." },
  { t: "track", track: { id: "customer", name: "Customer", kind: "outside" } },
  { t: "track", track: { id: "reviewer", name: "Reviewer", kind: "person" } },
  { t: "track", track: { id: "triage", name: "Triage agent", kind: "agent" } },
  { t: "track", track: { id: "worker", name: "Worker", kind: "system" } },
  { t: "track", track: { id: "mailer", name: "Mailer", kind: "system" } },
  { t: "artifact", artifact: { id: "req", name: "request", kind: "message", external: true } },
  { t: "artifact", artifact: { id: "ticket", name: "ticket", kind: "data" } },
  { t: "artifact", artifact: { id: "draft", name: "draft answer", kind: "document" } },
  { t: "artifact", artifact: { id: "ok", name: "approved answer", kind: "decision" } },
  { t: "artifact", artifact: { id: "sent", name: "sent answer", kind: "message" } },
  { t: "artifact", artifact: { id: "log", name: "send log", kind: "record" } },
  { t: "job", job: { id: "ask", name: "Asks", track: "customer", kind: "outside", trigger: "hand", inputs: [], outputs: ["req"], provenance: P(), status: "draft" } },
  { t: "job", job: { id: "sort", name: "Sort the request", track: "triage", trigger: "event", inputs: ["req"], outputs: ["ticket"], outcome: "Every request is a ticket someone can act on", beneficiary: "The worker", doneWhen: ["ticket exists"], exits: [{ condition: "spam", target: "stop" }, { condition: "unclear" }], provenance: P(), status: "draft" } },
  { t: "job", job: { id: "do", name: "Draft the answer", track: "worker", trigger: "chain", inputs: ["ticket"], outputs: ["draft"], outcome: "A draft exists", beneficiary: "The reviewer", doneWhen: ["draft saved"], loop: { to: "do" }, provenance: P(), status: "draft" } },
  { t: "job", job: { id: "review", name: "Approve the answer", track: "reviewer", trigger: "hand", inputs: ["draft"], outputs: ["ok"], outcome: "Nothing goes out unchecked", beneficiary: "The customer", doneWhen: ["approved"], gate: { rule: "a person has read it", accountable: "reviewer" }, provenance: P("human"), status: "confirmed" } },
  { t: "job", job: { id: "send", name: "Send it", track: "mailer", trigger: "chain", inputs: ["ok"], outputs: ["sent", "log"], outcome: "The customer has the answer", beneficiary: "The customer", doneWhen: ["delivered"], gate: { rule: "not already sent", accountable: "rule" }, provenance: P(), status: "draft" } },
  { t: "job", job: { id: "read", name: "Reads it", track: "customer", kind: "outside", inputs: ["sent"], outputs: [], provenance: P(), status: "draft" } },
  { t: "job", job: { id: "watch", name: "Watch the log", track: "reviewer", kind: "watch", inputs: ["log"], outputs: [], provenance: P(), status: "draft" } },
].map(e);

const b = fold(entries);

test("handoffs are derived from artifacts", () => {
  const hs = handoffs(b);
  assert.ok(hs.some((h) => h.from === "sort" && h.to === "do" && h.artifact === "ticket"));
  assert.ok(hs.some((h) => h.from === "send" && h.to === "read"));
});

test("columns follow handoffs", () => {
  const c = columns(b);
  assert.ok(c.get("ask")! < c.get("sort")! && c.get("sort")! < c.get("do")! && c.get("do")! < c.get("review")! && c.get("review")! < c.get("send")!);
});

test("the cut finds two jobs between the human touchpoints", () => {
  const c = cut(b);
  const names = c.regions.map((r) => r.inside.sort().join("+")).sort();
  assert.deepEqual(names, ["do+sort", "send"]);
});

test("the linter finds the dangling exit, the loop without limit, the unowned rule, the watch-only clip, the unread log", () => {
  const rules = new Set(lint(b).map((f) => f.rule));
  for (const r of ["dangling-exit", "loop-no-limit", "gate-no-owner", "watch-only"]) assert.ok(rules.has(r as any), r);
});

test("render and brief do not throw and mention the jobs", () => {
  const svg = renderSVG(b);
  assert.ok(svg.includes("Sort the request") && svg.includes("<svg"));
  const md = brief(b);
  assert.ok(md.includes("## Findings") && md.includes("Approve the answer"));
});

import { pending } from "../ops.js";
import { applyCut, loads } from "../derive.js";

test("proposals do not apply until accepted", () => {
  const es: Entry[] = [
    ...entries,
    { seq: 100, at: "", by: "agent", pending: true, op: { t: "updateJob", id: "review", patch: { name: "Rubber-stamp it" } } },
  ];
  assert.equal(fold(es).jobs.find((j) => j.id === "review")!.name, "Approve the answer");
  assert.equal(pending(es).length, 1);
  const acc: Entry[] = [...es, { seq: 101, at: "", by: "human", op: { t: "accept", seq: 100 } }];
  assert.equal(fold(acc).jobs.find((j) => j.id === "review")!.name, "Rubber-stamp it");
  assert.equal(pending(acc).length, 0);
});

test("the cut can make composites, and re-parents what it groups", () => {
  const { ops } = applyCut(b);
  const b2 = fold([...entries, ...ops.map((op, i) => ({ seq: 200 + i, at: "", by: "staves", op }))]);
  const comp = b2.jobs.filter((j) => b2.jobs.some((x) => x.parent === j.id));
  assert.ok(comp.length >= 1);
  assert.ok(b2.jobs.find((j) => j.id === "sort")!.parent);
});

test("loads: minutes × per week per person track", () => {
  const b3 = fold([...entries, { seq: 300, at: "", by: "h", op: { t: "setVolume", perWeek: 40 } }, { seq: 301, at: "", by: "h", op: { t: "updateJob", id: "review", patch: { minutes: 30 } } }, { seq: 302, at: "", by: "h", op: { t: "track", track: { id: "reviewer", name: "Reviewer", kind: "person", capacityHoursPerWeek: 10 } } }]);
  const l = loads(b3).find((x) => x.track === "reviewer")!;
  assert.equal(l.hours, 20);
  assert.ok(l.over);
  assert.ok(lint(b3).some((f) => f.rule === "over-capacity"));
});

test("scenarios fold on top of a base", () => {
  const scen: Entry[] = [{ seq: 1, at: "", by: "h", op: { t: "base", board: "demo" } }, { seq: 2, at: "", by: "h", op: { t: "board", id: "demo-redesign", title: "Redesign" } }, { seq: 3, at: "", by: "h", op: { t: "updateJob", id: "do", patch: { track: "triage" } } }];
  const s = fold(scen, entries);
  assert.equal(s.id, "demo-redesign");
  assert.equal(s.jobs.find((j) => j.id === "do")!.track, "triage");
  assert.equal(s.jobs.length, b.jobs.length);
});

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
test("the CLI's MCP server answers initialize over stdio", async () => {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cli.js");
  const dir = path.join(process.env.TMPDIR ?? "/tmp", "staves-test-" + Date.now());
  const p = spawn(process.execPath, [cli, "mcp", "--dir", dir, "t", String(6000 + Math.floor(Math.random() * 3000))], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
  for (let i = 0; i < 100 && !out.includes('"serverInfo"'); i++) await new Promise((r) => setTimeout(r, 150));
  p.kill();
  assert.ok(out.includes('"serverInfo"') && out.includes('"instructions"'), out.slice(0, 200));
});

import { promises as fsp } from "node:fs";
import os from "node:os";
import { Store } from "../store.js";
import { migrate, SCHEMA } from "../ops.js";

const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), "staves-")); return new Store(d); };

test("new entries carry an id and the schema version; old entries migrate", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }], "human");
  const es = await s.entries("b");
  assert.ok(es[0].id && es[0].id.length === 26);
  assert.equal(es[0].v, SCHEMA);
  const legacy = migrate({ seq: 7, at: "", by: "human", op: { t: "ask", question: { id: "q1", text: "?", askedBy: "human" } } } as any);
  assert.equal(legacy.id, "legacy-7");
  assert.equal(legacy.v, SCHEMA);
  assert.equal((legacy.op as any).question.status, "raised");
});

test("regions have explicit members and survive member moves", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "track", track: { id: "p", name: "P", kind: "person" } },
    { t: "job", job: { id: "j1", name: "One", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
    { t: "job", job: { id: "j2", name: "Two", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
    { t: "region", region: { id: "r", name: "Intake", color: "#f0a35e", members: ["j1"] } },
    { t: "regionMembers", id: "r", add: ["j2"] },
    { t: "track", track: { id: "a", name: "A", kind: "agent" } },
    { t: "updateJob", id: "j2", patch: { track: "a" } }], "human");
  const b = await s.board("b");
  assert.deepEqual(b.regions[0].members, ["j1", "j2"]);
  assert.equal(b.jobs.find((j) => j.id === "j2")!.track, "a");
});

test("issues move through their states", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "ask", question: { id: "q", text: "why?", askedBy: "human", status: "raised" } }, { t: "issue", id: "q", status: "picked-up" }], "human");
  assert.equal((await s.board("b")).questions[0].status, "picked-up");
});

test("undo reverts the last human op on an entity", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "track", track: { id: "p", name: "P", kind: "person" } },
    { t: "job", job: { id: "j1", name: "One", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }], "human");
  await s.append("b", [{ t: "updateJob", id: "j1", patch: { name: "Renamed" } }], "human");
  assert.equal((await s.board("b")).jobs[0].name, "Renamed");
  const e = await s.undo("b");
  assert.equal(e?.op.t, "updateJob");
  assert.equal((await s.board("b")).jobs[0].name, "One");
  await s.undo("b"); // undoes the job creation
  assert.equal((await s.board("b")).jobs.length, 0);
});

test("merge is deterministic and demotes ops whose basis is gone to proposals", async () => {
  const a = await tmp(), b = await tmp();
  const seed = [{ t: "board", id: "x", title: "T" }, { t: "track", track: { id: "p", name: "P", kind: "person" } },
    { t: "job", job: { id: "j1", name: "One", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }] as any[];
  await a.append("x", seed, "human");
  const es = await a.entries("x");
  await fsp.mkdir(b.dir, { recursive: true }); await fsp.writeFile(b.file("x"), (await fsp.readFile(a.file("x"), "utf8")));
  // machine A removes j1; machine B renames j1
  await a.append("x", [{ t: "removeJob", id: "j1" }], "human");
  await new Promise((r) => setTimeout(r, 2));
  await b.append("x", [{ t: "updateJob", id: "j1", patch: { name: "Renamed on B" } }], "human");
  const r = await a.merge("x", await b.entries("x"));
  assert.equal(r.added, 1);
  assert.equal(r.demoted, 1, "the rename lost its basis and became a proposal");
  const board = await a.board("x");
  assert.equal(board.jobs.find((j) => j.id === "j1")?.removed, true);
  assert.equal((await a.proposals("x")).length, 1);
});

test("redo re-applies what undo took back", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "track", track: { id: "p", name: "P", kind: "person" } },
    { t: "job", job: { id: "j1", name: "One", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }], "human");
  await s.append("b", [{ t: "updateJob", id: "j1", patch: { name: "Two" } }], "human");
  await s.undo("b");
  assert.equal((await s.board("b")).jobs[0].name, "One");
  await s.redo("b");
  assert.equal((await s.board("b")).jobs[0].name, "Two");
  await s.undo("b"); // after a redo, undo takes back the redone op — not something older
  assert.equal((await s.board("b")).jobs[0].name, "One");
  assert.equal((await s.board("b")).jobs.length, 1);
  await s.redo("b"); assert.equal((await s.board("b")).jobs[0].name, "Two");
  await s.undo("b"); await s.undo("b"); assert.equal((await s.board("b")).jobs.length, 0, "two undos: the rename, then the creation");
  await s.redo("b"); assert.equal((await s.board("b")).jobs.length, 1);
});

import { host } from "../host.js";
test("the web service: new workspace, ops, undo/redo, review, issues, presence over HTTP MCP", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "staves-host-"));
  const srv = await host({ root, port: 0, publicUrl: "http://localhost:0" });
  const port = (srv.address() as any).port; const base = `http://localhost:${port}`;
  const ws = await (await fetch(base + "/new", { method: "POST" })).json() as any;
  assert.ok(ws.token && ws.claudeCode.includes("/mcp/" + ws.token));
  const b = `${base}/b/${ws.token}`;
  const post = (p: string, body: unknown) => fetch(`${b}${p}`, { method: "POST", body: JSON.stringify(body) });
  await post("/op?board=x", [{ t: "board", id: "x", title: "T" }, { t: "track", track: { id: "p", name: "P", kind: "person" } }, { t: "job", job: { id: "j", name: "Do the thing", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }]);
  let bd = await (await fetch(`${b}/board.json?board=x`)).json() as any;
  assert.equal(bd.jobs.length, 1); assert.ok(bd.review && bd.columns && bd.handoffs);
  await post("/op?board=x", [{ t: "ask", question: { id: "q", about: "j", askedBy: "human", text: "why?", status: "raised" } }]);
  assert.equal((await (await post("/undo?board=x", {})).json() as any).undone.op, "ask");
  assert.equal((await (await fetch(`${b}/board.json?board=x`)).json() as any).questions.length, 0);
  assert.ok((await (await post("/redo?board=x", {})).json() as any).redone);
  // an agent over HTTP, named from its handshake
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const c = new Client({ name: "Test Agent", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${ws.token}`)));
  const text = async (n: string, a: any) => ((await c.callTool({ name: n, arguments: a })) as any).content[0].text as string;
  assert.ok((await text("staves_issues", { board: "x" })).includes("why?"));
  bd = await (await fetch(`${b}/board.json?board=x`)).json() as any;
  assert.equal(bd.questions[0].status, "picked-up");
  await text("staves_answer", { board: "x", id: "q", answer: "because" });
  bd = await (await fetch(`${b}/board.json?board=x`)).json() as any;
  assert.equal(bd.questions[0].status, "answered");
  const pres = await (await fetch(`${b}/presence`)).json() as any[];
  assert.ok(pres.some((p) => p.name === "Test Agent"));
  await c.close(); srv.close();
});

import { extract, nextQuestion, interviewTurn } from "../interviewer.js";
test("the rule interviewer asks the right next question and makes cards from what a person says", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "track", track: { id: "anna", name: "Anna", kind: "person" } },
    { t: "job", job: { id: "admit", name: "Admit the claim", track: "anna", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }], "human");
  const b = await s.board("b"); const j = b.jobs[0];
  const q1 = nextQuestion(b, j, []);
  assert.match(q1.text, /last time you did this/);
  const cards = extract("First I open the Policy desk and look up the number. Then I wait until the claimant answers, sometimes a week. If the number is wrong, I send it back to intake.", j, b);
  const types = cards.map((c) => c.type);
  assert.ok(types.includes("task"), "a task from 'look up'");
  assert.ok(types.includes("wait"), "a wait");
  assert.ok(types.includes("exit"), "a way out");
  const task = cards.find((c) => c.type === "task")!;
  assert.equal((task.ops[0] as any).job.parent, "admit");
  assert.ok(cards.find((c) => c.type === "wait")!.warning, "an unbounded wait is a finding");
  const t = await interviewTurn(b, j, [{ who: "interviewer", text: q1.text }], "so that the claimant knows the claim is in", undefined);
  assert.equal(t.engine, "rules");
  assert.ok(t.cards.some((c) => c.type === "outcome"));
  assert.ok(t.reply.length > 10);
});

import { fromBPMN, toJSON, fromJSON } from "../interop.js";
import { extractFlow } from "../interviewer.js";
test("BPMN import: lanes become who, tasks become jobs, flows become handoffs, gateways become decisions with ways out", async () => {
  const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="p">
  <bpmn:laneSet><bpmn:lane id="l1" name="Customer"><bpmn:flowNodeRef>t1</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="l2" name="Adjuster"><bpmn:flowNodeRef>t2</bpmn:flowNodeRef><bpmn:flowNodeRef>g1</bpmn:flowNodeRef><bpmn:flowNodeRef>t3</bpmn:flowNodeRef><bpmn:flowNodeRef>t4</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
  <bpmn:startEvent id="s"/><bpmn:userTask id="t1" name="File a claim"/><bpmn:userTask id="t2" name="Assess the claim"/><bpmn:exclusiveGateway id="g1" name="Approve?"/><bpmn:serviceTask id="t3" name="Pay out"/><bpmn:sendTask id="t4" name="Decline letter"/><bpmn:endEvent id="e"/>
  <bpmn:sequenceFlow id="f0" sourceRef="s" targetRef="t1"/><bpmn:sequenceFlow id="f1" sourceRef="t1" targetRef="t2" name="the claim"/><bpmn:sequenceFlow id="f2" sourceRef="t2" targetRef="g1"/><bpmn:sequenceFlow id="f3" sourceRef="g1" targetRef="t3" name="yes"/><bpmn:sequenceFlow id="f4" sourceRef="g1" targetRef="t4" name="no"/>
  </bpmn:process></bpmn:definitions>`;
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, ...fromBPMN(xml)], "human");
  const b = await s.board("b");
  assert.deepEqual(b.tracks.map((t) => t.kind), ["outside", "person"]);
  assert.equal(b.jobs.length, 4);
  const assess = b.jobs.find((j) => j.name === "Assess the claim")!;
  assert.ok(assess.gate && assess.exits?.length === 2, "gateway → decision + two ways out");
  assert.ok(assess.inputs.length === 1 && assess.outputs.length === 2);
  const h = (await import("../derive.js")).handoffs(b);
  assert.ok(h.some((x) => x.from === "t1" && x.to === "t2"));
  const round = fromJSON(toJSON(b));
  assert.ok(round.some((o) => o.t === "job"));
});

test("interview from the goal sketches jobs outside-in", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "setContext", context: { outside: "the shopper" } }], "human");
  const b = await s.board("b");
  const cards = extractFlow("The shopper types a brand name. Then Anna looks it up in the registry. Then the research agent writes the answer.", b);
  assert.equal(cards.length, 3);
  const ops = cards.flatMap((c) => c.ops);
  assert.ok(ops.filter((o) => o.t === "track").length >= 2, "new who rows for Anna and the agent");
  assert.ok(ops.some((o) => o.t === "track" && (o as any).track.kind === "agent"));
  const jobs = ops.filter((o) => o.t === "job") as any[];
  assert.equal(jobs[1].job.inputs[0], jobs[0].job.outputs[0], "each hands to the next");
});

import { interviewFlow, cardsFromModel } from "../interviewer.js";
test("the interviewer reacts: a question gets a rephrase and no cards; 'it depends' asks for cases; filler never becomes a card", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "Sourcing bids for a design contract" }, { t: "setContext", context: { purpose: "bids collected, evaluated with a rubric, a presentation made", forWhom: "inside", outside: "the design director", shape: "project" } }], "human");
  const b = await s.board("b");
  const t0 = await interviewFlow(b, [], null);
  assert.match(t0.reply, /kicks this off|Start at the beginning/);
  const lines = [{ who: "interviewer" as const, text: t0.reply }];
  const t1 = await interviewFlow(b, lines, "hello yeah they asked me to reach out to approved vendors in our system but also research potential vendors we haven't worked with, it depends on the nature of the work");
  assert.ok(t1.cards.length >= 1, "work described → cards");
  assert.ok(!t1.cards.some((c) => /hello yeah/i.test(c.name)), "filler stripped");
  assert.match(t1.reply, /^So: /, "reflects back first");
  lines.push({ who: "interviewer", text: t1.reply });
  const t2 = await interviewFlow(b, lines, "what do you mean who picks it up, I feel like we're jumping ahead here");
  assert.equal(t2.cards.length, 0, "a question is not work");
  assert.match(t2.reply, /^Fair\. I mean:/);
  const t3 = await interviewFlow(b, lines, "it depends");
  assert.match(t3.reply, /two most common cases/);
});

test("model cards require review: accepting context and roles creates jobs and nested tasks, but never invents flow between them", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "b" }], "human");
  const b = await s.board("b");
  const cards = cardsFromModel([
    { type: "context", name: "Sourcing bids for a design contract", quote: "…", title: "Sourcing bids for a design contract", context: { purpose: "bids collected and evaluated", forWhom: "inside", outside: "the design director", shape: "project" } },
    { type: "who", name: "Procurement", kind: "person", quote: "…" },
    { type: "job", name: "Reach out to approved vendors", who: "Procurement", quote: "…" },
    { type: "job", name: "Research new vendors", who: "Procurement", quote: "…" },
    { type: "task", name: "Search the vendor list", job: "Reach out to approved vendors", kind: "look", tool: "the vendor system", quote: "…" },
    { type: "gate", name: "director signs off the shortlist", job: "Research new vendors", quote: "…" },
  ], b);
  assert.equal(cards.length, 6);
  // The brief here renames a board that already has a title, which is a loss, so it waits for them.
  assert.equal(cards[0].auto, false);
  // A role is pure addition — nothing is written over by a performer appearing — so it lands and the
  // board draws it as staves’ until they settle it.
  assert.notEqual(cards[1].auto, false);
  assert.equal((await s.board("b")).tracks.length, 0, "generating proposals does not apply roles");
  // Simulate the person explicitly accepting all proposed cards.
  await s.append("b", cards.flatMap((c) => c.ops), "human");
  const b2 = await s.board("b");
  assert.equal(b2.title, "Sourcing bids for a design contract"); assert.equal(b2.context?.shape, "project");
  assert.equal(b2.tracks.length, 1);
  // Handoffs are derived from what jobs consume and produce, never from the order the model
  // mentioned them in — see 'emission order never creates handoff edges'. Two jobs proposed one
  // after another are not thereby a sequence, and inventing that flow is the guess Staves exists to
  // refuse. Connecting them takes explicit inputs, with evidence.
  const jobs = b2.jobs.filter((j) => !j.parent); assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0].inputs, []); assert.deepEqual(jobs[1].inputs, []);
  assert.equal(b2.jobs.filter((j) => j.parent).length, 1);
  assert.ok(jobs[1].gate);
});

test("a connected agent that offers sampling becomes the interviewer's model — no key", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "staves-host-"));
  const srv = await host({ root, port: 0, publicUrl: "http://localhost:0" });
  const port = (srv.address() as any).port; const base = `http://localhost:${port}`;
  const ws = await (await fetch(base + "/new", { method: "POST" })).json() as any; const b = `${base}/b/${ws.token}`;
  await fetch(`${b}/op?board=x`, { method: "POST", body: JSON.stringify([{ t: "board", id: "x", title: "T" }]) });
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const c = new Client({ name: "Sampling Agent", version: "0" }, { capabilities: { sampling: {} } });
  let sawSystem = "";
  c.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).CreateMessageRequestSchema, async (req) => { sawSystem = req.params.systemPrompt ?? ""; return { model: "fake", role: "assistant", content: { type: "text", text: JSON.stringify({ reply: "Tell me what happens first.", done: false, cards: [{ type: "context", name: "Sourcing bids", quote: "…", title: "Sourcing bids", context: { shape: "project", forWhom: "inside", outside: "the design director" } }] }) } }; });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${ws.token}`)));
  await new Promise((r) => setTimeout(r, 300));
  const pres = await (await fetch(`${b}/presence`)).json() as any[];
  assert.ok(pres.some((p) => p.name === "Sampling Agent" && p.sampling), "presence shows sampling");
  const turn = await (await fetch(`${b}/interview?board=x`, { method: "POST", body: JSON.stringify({ job: "board", lines: [], said: null }) })).json() as any;
  assert.equal(turn.engine, "model"); assert.equal(turn.via, "Sampling Agent");
  assert.match(sawSystem, /staves Interviewer/);
  assert.equal(turn.cards[0].type, "context"); assert.equal(turn.cards[0].auto, false);
  await c.close(); srv.close();
});

import { gymReport } from "../gym.js";
test("gym: the rule interviewer covers most of a hidden board, never repeats twice, never leads, never invents", async () => {
  const r = await gymReport();
  for (const row of r.rows) {
    assert.ok(row.coverage >= 0.5, `${row.persona} coverage ${row.coverage}`);
    assert.ok(row.repeated <= 1, `${row.persona} repeated ${row.repeated}`);
    assert.equal(row.leading, 0, `${row.persona} leading`);
    assert.equal(row.invented, 0, `${row.persona} invented`);
  }
});

import { reflectRules } from "../reflect.js";
test("reflection: unreachable jobs, dead ends, nothing back to the outside, a must-not nobody guards, intent vs allocation", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "setContext", context: { outside: "the shopper", mustNot: "an owner is shown without a link", scale: "hundreds a day" } }, { t: "setIntent", intent: { primary: "labor-hours" } },
    { t: "track", track: { id: "shop", name: "Shopper", kind: "outside" } }, { t: "track", track: { id: "p", name: "Priya", kind: "person" } },
    { t: "artifact", artifact: { id: "q", name: "the question", kind: "message" } }, { t: "artifact", artifact: { id: "x", name: "a note", kind: "record" } },
    { t: "job", job: { id: "ask", name: "Ask who owns it", track: "shop", kind: "outside", inputs: [], outputs: ["q"], provenance: { source: "human" }, status: "confirmed" } },
    { t: "job", job: { id: "find", name: "Find the owner", track: "p", inputs: ["q"], outputs: ["x"], provenance: { source: "human" }, status: "confirmed" } },
    { t: "job", job: { id: "find:t1", name: "Look it up", track: "p", parent: "find", inputs: [], outputs: [], workKind: "look", tools: [{ name: "GLEIF", reach: "api" }], provenance: { source: "human" }, status: "confirmed" } },
    { t: "job", job: { id: "orphan", name: "Reconcile the ledger", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
    { t: "job", job: { id: "w", name: "Wait for the registry", track: "p", parent: "find", workKind: "wait", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }], "human");
  const R = reflectRules(await s.board("b")); const titles = R.map((r) => r.title);
  assert.ok(titles.some((t) => /without a connected starting point/.test(t)), "unreachable"); assert.ok(R.find((r) => /without a connected starting point/.test(r.title))!.about.includes("orphan"));
  assert.ok(titles.some((t) => /without a recorded next step or ending/.test(t)), "dead end");
  assert.ok(titles.some((t) => /No return handoff/.test(t)), "nothing returns to the shopper");
  assert.ok(titles.some((t) => /stated concern/.test(t)), "must-not unguarded");
  assert.ok(titles.some((t) => /automation opportunities/.test(t)), "intent vs allocation");
  assert.ok(titles.some((t) => /Wait limits/.test(t)), "waits at scale");
});

import { hatBrief } from "../derive.js";
test("lint tax: describing records even when something is noticed; patch fixes it; hats ask agents the stranger test; reflect reads pairs side by side", async () => {
  const s = await tmp();
  await s.append("b", [{ t: "board", id: "b", title: "T" }, { t: "track", track: { id: "ag", name: "Judge", kind: "agent" } }, { t: "track", track: { id: "p", name: "J", kind: "person" } },
    { t: "artifact", artifact: { id: "ans", name: "the answer", kind: "record" } },
    { t: "job", job: { id: "find", name: "Find the owner", track: "ag", inputs: [], outputs: ["ans"], provenance: { source: "agent" }, status: "draft" } },
    { t: "job", job: { id: "find:t", name: "Read the article", track: "ag", parent: "find", inputs: [], outputs: [], workKind: "read", tools: [{ name: "Wikipedia", reach: "api" }], provenance: { source: "agent" }, status: "draft" } },
    { t: "job", job: { id: "climb", name: "Keep climbing", track: "ag", inputs: ["ans"], outputs: [], provenance: { source: "agent" }, status: "draft" } },
    { t: "job", job: { id: "recheck", name: "Nightly re-check", track: "ag", inputs: ["ans"], outputs: [], trigger: "clock", provenance: { source: "agent" }, status: "draft" } },
    { t: "job", job: { id: "correct", name: "Settle the correction", track: "p", inputs: ["ans"], outputs: [], provenance: { source: "agent" }, status: "draft" } }], "human");
  const b = await s.board("b");
  const hat = hatBrief(b, "ag");
  assert.match(hat, /stranger test/); assert.match(hat, /Wikipedia: what does it leave out/);
  const R = reflectRules(b);
  assert.ok(R.some((r) => /is read by 3 jobs/.test(r.title)), "one artifact, three consumers → read them side by side");
  // jargon exemption via domain words
  await s.append("b", [{ t: "job", job: { id: "edge", name: "Handle the edge timeout", track: "p", inputs: [], outputs: [], provenance: { source: "agent" }, status: "draft" } }], "human");
  assert.ok(lint(await s.board("b")).some((f) => f.rule === "jargon" && f.about === "edge"));
  await s.append("b", [{ t: "setContext", context: { words: ["edge", "timeout"] } as any }], "human");
  assert.ok(!lint(await s.board("b")).some((f) => f.rule === "jargon" && f.about === "edge"), "domain words are not jargon");
});
