import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AGENT_BOOTSTRAP } from "../agent-bootstrap.js";
import { buildServer, newlyQueuedRequests } from "../mcp.js";
import { Store } from "../store.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "staves-agent-contract-"));
  const store = new Store(dir);
  const server = buildServer(store, "test-agent", "http://localhost:5192/");
  const client = new Client({ name: "contract-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  await store.append("lookup", [{ t: "board", id: "lookup", title: "How a lookup is answered" }], "human");
  return { client, store, cleanup: async () => { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); } };
}

const say = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as { text: string }[]).map(part => part.text).join("\n");

test("a read of an unknown board names the boards that exist instead of inventing one", async () => {
  const { client, store, cleanup } = await fixture();
  try {
    for (const name of ["staves_brief", "staves_requests", "staves_review", "staves_issues", "staves_stale"]) {
      const result = await client.callTool({ name, arguments: { board: "lookupp" } });
      assert.ok(result.isError, `${name} accepted a board that does not exist`);
      assert.equal(say(result), `No board named "lookupp". Boards: lookup. Use staves_start to create one.`);
    }
    const status = await client.callTool({ name: "staves_request_status", arguments: { board: "lookupp", id: "whatever", status: "claimed" } });
    assert.ok(status.isError);
    assert.match(say(status), /No board named "lookupp"/);
    // The board that does exist still reads.
    assert.ok(!(await client.callTool({ name: "staves_brief", arguments: { board: "lookup" } })).isError);
    // A read never creates the board it could not find.
    assert.deepEqual(await store.list(), ["lookup"]);
  } finally { await cleanup(); }
});

test("staves_help catalogues every registered tool exactly once", async () => {
  const { client, cleanup } = await fixture();
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.length > 30);
    const help = say(await client.callTool({ name: "staves_help", arguments: {} }));
    const catalogue = help.slice(help.indexOf("Tools:"));
    assert.ok(catalogue.startsWith("Tools:"));
    for (const name of names) {
      const hits = catalogue.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
      assert.equal(hits.length, 1, `${name} appears ${hits.length} times in the catalogue`);
    }
    for (const heading of ["Draw", "Read & review", "Requests & delivery", "Design history & Git", "Langfuse evidence", "Walkthroughs"]) {
      assert.ok(catalogue.includes(heading), `catalogue is missing the ${heading} heading`);
    }
  } finally { await cleanup(); }
});

test("the survey tool and the connection instructions say the same thing about creating boards", async () => {
  const { client, cleanup } = await fixture();
  try {
    const survey = (await client.listTools()).tools.find(tool => tool.name === "staves_survey");
    assert.ok(survey?.description?.startsWith("Only when a person explicitly asks for a survey. Call staves_access first; a survey uses one board of your creation allowance."));
    const order = "read the code first, then call staves_help, then follow its protocol";
    assert.ok(client.getInstructions()?.includes(order), "the server instructions do not give the order");
    assert.ok(AGENT_BOOTSTRAP.includes(order), "the bootstrap does not give the order");
    assert.ok(AGENT_BOOTSTRAP.includes("A board name you were given may not exist: staves_brief on an unknown board fails with the list of boards; do not create a board to satisfy a read."));
  } finally { await cleanup(); }
});

test("a queued request is announced once, and only while it is queued", () => {
  const seen = new Set<string>();
  const entry = (id: string, status: string, intent = "assess") => ({ request: { id, intent }, delivery: { status } });
  assert.deepEqual(newlyQueuedRequests(seen, [entry("a", "queued"), entry("b", "completed"), entry("c", "queued", "discuss")]), [
    { id: "a", intent: "assess" }, { id: "c", intent: "discuss" },
  ]);
  assert.deepEqual(newlyQueuedRequests(seen, [entry("a", "queued"), entry("c", "claimed")]), []);
  assert.deepEqual(newlyQueuedRequests(seen, [entry("d", "queued")]), [{ id: "d", intent: "assess" }]);
  // A request first seen in flight is never announced when it later fails and is re-queued by a person.
  assert.deepEqual(newlyQueuedRequests(seen, [entry("b", "queued")]), []);
});


test("shared skill and MCP bootstrap introduce the complete action menu and native verification", () => {
  for (const action of ["Build a working prototype", "Discuss or refine", "Create and connect", "Assess feasibility", "Compare the implementation", "Implement selected", "test scenarios", "each role", "build progress"]) assert.ok(AGENT_BOOTSTRAP.includes(action), action);
  assert.match(AGENT_BOOTSTRAP, /Verify native access with an actual MCP tool call/);
  assert.match(AGENT_BOOTSTRAP, /same board/);
});
