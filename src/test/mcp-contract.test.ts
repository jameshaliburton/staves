import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../mcp.js";
import { Store } from "../store.js";
import type { ArtifactKind } from "../model.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "staves-mcp-contract-"));
  const store = new Store(dir);
  const server = buildServer(store, "test-agent", "http://localhost:5192/");
  const client = new Client({ name: "contract-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  await store.append("test", [{ t: "track", track: { id: "human", name: "Reviewer", kind: "person" } }, { t: "track", track: { id: "agent", name: "Assistant", kind: "agent" } }], "human");
  return { client, store, cleanup: async () => { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("MCP single and bulk descriptions preserve maturity, unknown starts and complete tool facts", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    const fields = { name: "Prepare the answer", track: "agent", implementation: { state: "in-progress", note: "Delivery remains planned" }, tools: [{ name: "Research", reach: "mcp", does: "Returns sources", limits: "No private sources" }], loop: { to: "single", limit: 2, then: "Ask reviewer" }, gate: { rule: "Sources agree", accountable: "rule", ruleOwner: "Reviewer" }, confidence: 0.7 };
    assert.ok(!(await client.callTool({ name: "staves_describe", arguments: { board: "test", id: "single", ...fields } })).isError);
    assert.ok(!(await client.callTool({ name: "staves_describe_many", arguments: { board: "test", jobs: [{ id: "bulk", ...fields }, { id: "future", name: "Deliver the answer", track: "agent", kind: "ghost", implementation: { state: "planned" } }] } })).isError);
    const board = await store.board("test");
    const single = board.jobs.find(j => j.id === "single")!, bulk = board.jobs.find(j => j.id === "bulk")!;
    assert.deepEqual(single.implementation, bulk.implementation); assert.deepEqual(single.tools, bulk.tools); assert.deepEqual(single.gate, bulk.gate); assert.deepEqual(single.loop, bulk.loop);
    assert.equal(bulk.trigger, undefined); assert.equal(bulk.provenance.confidence, 0.7); assert.ok(bulk.provenance.at); assert.equal(bulk.status, "draft");
    await client.callTool({ name: "staves_patch", arguments: { board: "test", id: "bulk", patch: { implementation: { state: "implemented", note: "Code reviewed; runtime unverified" } } } });
    const patched = (await store.board("test")).jobs.find(j => j.id === "bulk")!;
    assert.equal(patched.implementation?.state, "implemented"); assert.deepEqual(patched.tools, bulk.tools); assert.equal(patched.status, "draft");
  } finally { await cleanup(); }
});

test("the generated tool reference lists the arguments of every tool, grouped or not", async () => {
  const page = await readFile("docs-site/src/content/docs/reference/tools.md", "utf8");
  const dir = await mkdtemp(join(tmpdir(), "staves-tool-reference-"));
  try {
    const server = buildServer(new Store(dir), "docs", "https://staves.io");
    const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema?: { shape?: Record<string, unknown> } }> })._registeredTools;
    const sections = new Map(page.split(/^### /m).slice(1).map(section => [section.split("`")[1], section]));
    for (const [name, tool] of Object.entries(registered)) {
      const section = sections.get(name);
      assert.ok(section, `${name} is missing from the tool reference`);
      const args = Object.keys(tool.inputSchema?.shape ?? {});
      if (!args.length) { assert.match(section, /^Takes nothing\.$/m, `${name} takes nothing and should say so`); continue; }
      assert.match(section, /^\| Argument \| \| What it is \|$/m, `${name} takes arguments but lists none`);
      for (const arg of args) assert.ok(section.includes(`| \`${arg}\` |`), `${name} does not list ${arg}`);
    }
    await server.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("staves_artifact accepts every artifact kind the model defines", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    const kinds: ArtifactKind[] = ["document", "data", "decision", "message", "record", "instruction", "measure", "other"];
    for (const kind of kinds) {
      const result = await client.callTool({ name: "staves_artifact", arguments: { board: "test", id: kind, name: kind, kind } });
      assert.ok(!result.isError, `${kind} was refused: ${JSON.stringify(result.content)}`);
    }
    const board = await store.board("test");
    assert.deepEqual(kinds.map(kind => board.artifacts.find(a => a.id === kind)?.kind), kinds);
  } finally { await cleanup(); }
});

test("MCP handover analysis can be proposed atomically and rejects stale analysis", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    await client.callTool({ name: "staves_describe", arguments: { board: "test", id: "read", name: "Read the brief", track: "human" } });
    const result = await client.callTool({ name: "staves_handover", arguments: { board: "test", job: "read", toTrack: "agent" } });
    const content = result.content as { type: string; text: string }[];
    const plan = JSON.parse(content[0].text) as { basis: string };
    const handover = { job: "read", toTrack: "agent", basis: plan.basis };
    assert.ok(!(await client.callTool({ name: "staves_propose", arguments: { board: "test", handover } })).isError);
    const proposals = await store.proposals("test");
    assert.equal(proposals.length, 1); assert.equal(proposals[0].op.t, "handover");
    assert.equal((await store.board("test")).jobs[0].track, "human");
    await store.append("test", [{ t: "updateJob", id: "read", patch: { outcome: "A revised result" } }], "human");
    const stale = await client.callTool({ name: "staves_propose", arguments: { board: "test", handover } });
    assert.match((stale.content as { text: string }[])[0].text, /board changed/i);
    assert.equal((await store.proposals("test")).length, 1);
  } finally { await cleanup(); }
});

test("MCP export writes the whole board in the Staves format, and draws it, without writing the board", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    await store.append("test", [
      { t: "artifact", artifact: { id: "result", name: "Result", kind: "document" } },
      { t: "job", job: { id: "a", name: "Prepare", track: "agent", inputs: [], outputs: ["result"], status: "draft", provenance: { source: "agent", by: "test" } } },
      { t: "job", job: { id: "b", name: "Review the result", track: "human", inputs: ["result"], outputs: [], status: "confirmed", provenance: { source: "human", by: "test" } } },
    ], "human");
    const before = await store.entries("test");
    const say = async (format: string) => { const result = await client.callTool({ name: "staves_export", arguments: { board: "test", format } }); assert.ok(!result.isError, format); return (result.content as { text: string }[])[0].text; };
    const doc = JSON.parse(await say("staves"));
    assert.equal(doc.staves, "0.1");
    assert.equal(doc.$schema, "https://staves.io/spec/0.1/board.schema.json");
    assert.deepEqual(doc.handoffs.map((h: { id: string }) => h.id), ["a>b@result"]);
    assert.match(await say("mermaid"), /^flowchart LR/);
    assert.match(await say("bpmn"), /<bpmn:definitions /);
    assert.deepEqual(await store.entries("test"), before);
  } finally { await cleanup(); }
});

test('MCP handoff returns a scoped prototype contract without writing the board',async()=>{
 const {client,store,cleanup}=await fixture();
 try{
  await store.append('test',[{t:'job',job:{id:'a',name:'Review the result',track:'human',inputs:[],outputs:[],status:'confirmed',provenance:{source:'human',by:'test'}}}],'human');
  const before=await store.entries('test');
  const result=await client.callTool({name:'staves_export',arguments:{board:'test',purpose:'prototype',format:'json',jobIds:['a'],constraints:'Keep human approval'}});
  assert.ok(!result.isError);const content=result.content as {type:string;text?:string}[];
  const packet=JSON.parse(content[0].text!);assert.equal(packet.request.purpose,'prototype');assert.equal(packet.request.constraints,'Keep human approval');assert.equal(packet.board.jobs[0].id,'a');assert.equal(packet.source.revision,before.at(-1)?.seq);
  assert.deepEqual(await store.entries('test'),before);
 }finally{await cleanup();}
});

test("agent interview saves reported words, draft graph and honest linked progress", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    const instructions = await client.callTool({ name: "staves_interview", arguments: {} });
    assert.match(JSON.stringify(instructions), /no provider key or second model/);
    assert.match(JSON.stringify(instructions), /staves_describe_many/);
    const start = await client.callTool({ name: "staves_start", arguments: { board: "new-work", title: "Deliver an answer" } });
    assert.match(JSON.stringify(start), /http:\/\/localhost:5192\/\?board=new-work/);
    const early = await client.callTool({ name: "staves_interview_progress", arguments: { board: "new-work", state: "ready", summary: "Done" } });
    assert.match(JSON.stringify(early), /no draft jobs/);
    await client.callTool({ name: "staves_interview_record", arguments: { board: "new-work", quote: "A reviewer will check the answer.", interpretation: "A planned approval step" } });
    let board = await store.board("new-work");
    assert.equal(board.comments[0].by, "test-agent");
    assert.match(board.comments[0].text, /Reported words/);
    assert.match(board.comments[0].text, /Agent interpretation \(unconfirmed\)/);
    assert.equal(board.context?.agentProgress?.state, "working");
    await client.callTool({ name: "staves_track", arguments: { board: "new-work", id: "reviewer", name: "Reviewer", kind: "person" } });
    await client.callTool({ name: "staves_describe", arguments: { board: "new-work", id: "check", name: "Check the answer", track: "reviewer", implementation: { state: "planned" } } });
    await client.callTool({ name: "staves_interview_progress", arguments: { board: "new-work", state: "partial", summary: "Paused before deciding delivery" } });
    assert.equal((await store.board("new-work")).context?.agentProgress?.state, "partial");
    const ready = await client.callTool({ name: "staves_interview_progress", arguments: { board: "new-work", state: "ready", summary: "Draft review step; delivery still unresolved" } });
    assert.match(JSON.stringify(ready), /ready for human review/);
    board = await store.board("new-work");
    assert.equal(board.jobs[0].status, "draft");
    assert.equal(board.jobs[0].implementation?.state, "planned");
    assert.equal(board.context?.agentProgress?.state, "ready");
  } finally { await cleanup(); }
});

test("interview patch preserves confirmed work as a proposal", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    await store.append("test", [{ t: "job", job: { id: "confirmed", name: "Review the result", track: "human", inputs: [], outputs: [], status: "confirmed", provenance: { source: "human", by: "human" } } }], "human");
    const patch = await client.callTool({ name: "staves_patch", arguments: { board: "test", id: "confirmed", patch: { name: "Approve the result" } } });
    assert.match(JSON.stringify(patch), /Proposed changes/);
    assert.equal((await store.board("test")).jobs[0].name, "Review the result");
    assert.equal((await store.proposals("test")).length, 1);
  } finally { await cleanup(); }
});

test("MCP preserves explicit prerequisite semantics and rejects undeclared inputs", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    const result = await client.callTool({ name: "staves_describe", arguments: { board: "test", id: "choice", name: "Review a request", track: "agent", inputs: ["email", "form"], prerequisites: { kind: "any", inputs: ["email", "form"] } } });
    assert.ok(!result.isError);
    assert.deepEqual((await store.board("test")).jobs[0].prerequisites, { kind: "any", inputs: ["email", "form"] });
    const invalid = await client.callTool({ name: "staves_patch", arguments: { board: "test", id: "choice", patch: { prerequisites: { kind: "all", inputs: ["invented"] } } } });
    assert.ok(invalid.isError);
    assert.equal((await store.board("test")).jobs[0].prerequisites?.kind, "any");
  } finally { await cleanup(); }
});

test("agent assessment and case walkthrough preserve design authority and return references", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    await store.append("test", [{ t: "job", job: { id: "review", name: "Review the result", track: "human", inputs: [], outputs: [], prerequisites: { kind: "all", inputs: [] }, provenance: { source: "human" }, status: "confirmed" } }], "human");
    const response = await client.callTool({ name: "staves_assess", arguments: { board: "test", jobIds: ["review"] } });
    assert.ok(!response.isError, JSON.stringify(response));
    const { request } = JSON.parse((response.content as { text: string }[])[0].text);
    assert.equal(request.intent, "assess");
    const returned = await client.callTool({ name: "staves_assessment_return", arguments: { board: "test", result: { requestId: request.id, repositoryAccess: "unavailable", jobs: [{ jobId: "review", conclusion: "unknown", reason: "No repository in this session" }], tests: [], limitations: ["Repository access is unavailable"] } } });
    assert.ok(!returned.isError, JSON.stringify(returned));
    assert.equal((await store.board("test")).jobs[0].implementation, undefined);
    assert.equal((await store.board("test")).jobs[0].status, "confirmed");
    const path = await client.callTool({ name: "staves_walkthrough", arguments: { board: "test", case: { name: "A new result", initialArtifacts: [] } } });
    assert.ok(!path.isError, JSON.stringify(path));
    assert.equal(JSON.parse((path.content as { text: string }[])[0].text).steps[0].jobId, "review");
    await store.append("test", [{ t: "updateJob", id: "review", patch: { outcome: "An independently checked result" } }], "human");
    const read = await client.callTool({ name: "staves_assessment", arguments: { board: "test", id: request.id } });
    assert.equal(JSON.parse((read.content as { text: string }[])[0].text).returns[0].status, "stale");
  } finally { await cleanup(); }
});

test("MCP inbox preserves request identity and requires claimed execution before completion", async () => {
  const { client, cleanup } = await fixture();
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  try {
    await call("staves_describe", { board: "test", id: "read", name: "Read the brief", track: "human" });
    const created = await call("staves_assess", { board: "test", intent: "discuss", rationale: "Clarify who helps" });
    assert.ok(!created.isError);
    const packet = JSON.parse((created.content as {text:string}[])[0].text);
    const id = packet.request.id;
    assert.match(JSON.stringify(await call("staves_requests", {board:"test"})), /queued/);
    assert.ok((await call("staves_request_status", {board:"test",id,status:"completed"})).isError);
    assert.ok(!(await call("staves_request_status", {board:"test",id,status:"claimed"})).isError);
    assert.ok(!(await call("staves_request_status", {board:"test",id,status:"running"})).isError);
    assert.ok(!(await call("staves_request_status", {board:"test",id,status:"completed",note:"The user identified an operator as owner."})).isError);
    assert.match(JSON.stringify(await call("staves_requests", {board:"test"})), /completed/);
  } finally { await cleanup(); }
});

test("every board-scoped answer carries the board's link, once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "staves-mcp-links-"));
  const base = "http://localhost:5178/b/local", link = `${base}?board=test`;
  const server = buildServer(new Store(dir), "test-agent", base);
  const client = new Client({ name: "link-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const parts = async (name: string, args: Record<string, unknown>) =>
    ((await client.callTool({ name, arguments: args })).content as { text: string }[]).map(part => part.text);
  const say = async (name: string, args: Record<string, unknown>) => (await parts(name, args)).join("\n");
  try {
    // Prose that already names the board is left exactly as the handler wrote it.
    const started = await say("staves_start", { board: "test", title: "Test" });
    assert.equal(started.split(link).length - 1, 1, started);
    assert.doesNotMatch(started, /\nBoard: /, started.slice(0, 200));

    await client.callTool({ name: "staves_track", arguments: { board: "test", id: "p", name: "Person", kind: "person" } });
    await client.callTool({ name: "staves_describe", arguments: { board: "test", id: "a", name: "Read the brief", track: "p" } });
    for (const name of ["staves_brief", "staves_review"]) {
      const prose = await say(name, { board: "test" });
      assert.ok(prose.endsWith(`\nBoard: ${link}`), `${name}: ${JSON.stringify(prose.slice(-120))}`);
      assert.equal(prose.split(link).length - 1, 1, name);
    }

    // A JSON document gets the link as a field, beside the workspace it belongs to.
    const queued = await say("staves_assess", { board: "test", rationale: "Look at it" });
    const request = (JSON.parse(queued) as { request: { id: string }; boardUrl: string }).request.id;
    assert.equal((JSON.parse(queued) as { boardUrl: string }).boardUrl, link);
    assert.equal(queued.split('"boardUrl"').length - 1, 1, "a handler that already names the board is not given a second field");

    const claimed = JSON.parse(await say("staves_request_status", { board: "test", id: request, status: "claimed" })) as { boardUrl: string; workspaceUrl: string };
    assert.equal(claimed.boardUrl, link);
    assert.equal(claimed.workspaceUrl, base);

    // A list stays a list: the link comes beside it, not inside it.
    const inbox = await parts("staves_requests", { board: "test" });
    assert.ok(Array.isArray(JSON.parse(inbox[0])), inbox[0].slice(0, 80));
    assert.equal(inbox[inbox.length - 1], `Board: ${link}`, inbox.join(" | "));

    // An export is handed on as it came back; a line appended to an SVG is a broken SVG.
    const svg = await say("staves_export", { board: "test", format: "svg" });
    assert.ok(svg.trimEnd().endsWith("</svg>"), svg.slice(-80));

    // No board named, so no board to link: the workspace is what this connection can open.
    const access = JSON.parse(await say("staves_access", {})) as { workspaceUrl: string };
    assert.equal(access.workspaceUrl, base);

    const help = await say("staves_help", {});
    assert.ok(help.trimEnd().endsWith("Guide: https://staves.io/docs/connect/"), help.slice(-200));

    // "?board=a" sits inside "?board=ab". A board whose text quotes a sibling's link must still be
    // given its own, so the guard against a duplicate link has to match where the link ends.
    await client.callTool({ name: "staves_start", arguments: { board: "ab", title: "Sibling" } });
    await client.callTool({ name: "staves_start", arguments: { board: "a", title: `Split out of ${base}?board=ab` } });
    const brief = await say("staves_brief", { board: "a" });
    assert.ok(brief.includes(`${base}?board=ab`), brief.slice(0, 200));
    assert.ok(brief.endsWith(`\nBoard: ${base}?board=a`), JSON.stringify(brief.slice(-120)));
    const sibling = await say("staves_brief", { board: "ab" });
    assert.ok(sibling.endsWith(`\nBoard: ${base}?board=ab`), JSON.stringify(sibling.slice(-120)));
  } finally { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }
});

// A connection that cannot create a board is the state a person hits first on a hosted project, and
// an agent that reports it as a wall strands them in a terminal. The answer carries the way out.
test("staves_access answers an exhausted allowance and a read-only connection with the way forward", async () => {
  const dir = await mkdtemp(join(tmpdir(), "staves-mcp-access-"));
  const base = "https://staves.io";
  const account = "https://staves.io/workspace#account";
  const grant = { email: "person@example.com", user_id: "user", boards: ["orders"], permission: "contribute", createLimit: 1, createdCount: 1 };
  const store = Object.assign(new Store(dir), { access: async () => grant });
  const server = buildServer(store, "test-agent", base);
  const client = new Client({ name: "access-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const read = async () => JSON.parse(((await client.callTool({ name: "staves_access", arguments: {} })).content as { text: string }[]).map(part => part.text).join("\n")) as
    { permission: string; remaining: number; workspaceUrl: string; note: string; nextStep?: { tell: string; command: string; accountUrl: string } };
  try {
    const spent = await read();
    assert.equal(spent.remaining, 0);
    assert.equal(spent.workspaceUrl, "https://staves.io/workspace");
    assert.deepEqual(spent.nextStep, {
      tell: `Rerun npx @staves/cli connect in this project and tick "Create a new board for this project", or raise the allowance under Account → Coding agents at ${account}.`,
      command: "npx @staves/cli connect", accountUrl: account,
    });
    assert.ok(spent.note.endsWith("Tell the person the nextStep sentence verbatim; do not create a board."), spent.note);

    grant.permission = "read";
    const readOnly = await read();
    assert.equal(readOnly.remaining, 0);
    assert.deepEqual(readOnly.nextStep, {
      tell: `This connection is read-only. Rerun npx @staves/cli connect in this project and choose "Read and contribute" with a board, or change the connection under Account → Coding agents at ${account}.`,
      command: "npx @staves/cli connect", accountUrl: account,
    });

    // An allowance that is not spent has no next step to take, and no instruction about one.
    grant.permission = "contribute"; grant.createdCount = 0;
    const room = await read();
    assert.equal(room.remaining, 1);
    assert.equal(room.nextStep, undefined);
    assert.doesNotMatch(room.note, /nextStep/);
  } finally { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }
});
