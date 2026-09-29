import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, memoize } from "../mcp.js";
import { Store } from "../store.js";
import { langfuseRegistrations, projectRegistrations } from "../registration.js";
import { saveAssessmentRequest, updateAssessmentDelivery } from "../assessment-store.js";
import { forgetCredentials, hostedStore, writeCredentials } from "../hosted.js";
import { collectState, formatRecommendations, homeScreen, recommend, rightNow, rightNowHeading, type StavesState } from "../next-steps.js";
import { VERSION } from "../version.js";

/** A project with nothing waiting: every rule from 1 to 10 is satisfied. */
function quiet(patch: Partial<StavesState> = {}): StavesState {
  return {
    mode: "local", root: "/repo",
    registered: { claude: true, cursor: true, codex: true },
    skills: { claude: true, codex: true },
    instructionsCurrent: true, stalePackages: [], account: "no-credential", accountConnected: false,
    agentsInstalled: ["claude"], boards: ["orders"],
    queued: [], failed: [], pendingProposals: [], langfuse: "unset",
    base: { url: "http://localhost:5178/b/local", live: true },
    ...patch,
  };
}

const titles = (state: StavesState) => recommend(state).map(item => `${item.priority}:${item.audience}`);
const only = (state: StavesState) => {
  const list = recommend(state);
  assert.ok(list.length, "a rule was expected to fire");
  return list;
};

test("nothing waiting leaves one recommendation: what to ask for", () => {
  const list = recommend(quiet());
  assert.equal(list.length, 1);
  assert.equal(list[0].priority, 11);
  assert.equal(list[0].audience, "both");
  assert.match(list[0].why, /what has drifted/);
  assert.match(list[0].why, /brief me/);
  assert.equal(list[0].command, undefined);
});

test("rule 1: an unregistered project is told to init or connect", () => {
  const list = only(quiet({ registered: { claude: false, cursor: false, codex: false } }));
  assert.equal(list[0].priority, 1);
  assert.equal(list[0].audience, "human");
  assert.equal(list[0].command, "npx @staves/cli init");
  assert.match(list[0].why, /npx @staves\/cli connect/);
  assert.equal(list.filter(item => item.priority === 3).length, 0, "nothing registered is rule 1, not one rule per client");
});

test("rule 1: a machine already signed in is told to connect, and init second", () => {
  const bare = { registered: { claude: false, cursor: false, codex: false } };
  const list = only(quiet({ ...bare, machineCredential: true }));
  assert.equal(list[0].priority, 1);
  assert.equal(list[0].audience, "human");
  assert.equal(list[0].command, "npx @staves/cli connect");
  assert.match(list[0].why, /This machine already has a Staves account connection/);
  assert.match(list[0].why, /npx @staves\/cli init/, "the local project is still offered");
  assert.ok(list[0].why.indexOf("connect this project to it") < list[0].why.indexOf("npx @staves/cli init"),
    "connect leads and init follows");
  // Nothing stored anywhere is a first run, and init leads that one.
  for (const machineCredential of [false, undefined]) {
    const first = only(quiet({ ...bare, machineCredential }))[0];
    assert.equal(first.command, "npx @staves/cli init", String(machineCredential));
    assert.equal(first.title, "Register Staves in this project");
  }
});

test("rule 1 reads the credentials this machine holds, not this project's registration", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-machine-credential-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = process.env.STAVES_HOME_DIR;
  process.env.STAVES_HOME_DIR = root;
  t.after(() => { if (home === undefined) delete process.env.STAVES_HOME_DIR; else process.env.STAVES_HOME_DIR = home; });
  const input = { store: new Store(join(root, ".staves")), root, env: {}, registrations: [], agents: [] };

  const fresh = await collectState(input);
  assert.equal(fresh.machineCredential, false, "nothing is stored on this machine");
  assert.equal(recommend(fresh)[0].command, "npx @staves/cli init");

  // A credential written by some other project, under a connection name this project never sees.
  await writeCredentials({ url: "https://staves.example", token: "sta_live", email: "a@b.c" }, "other-project");
  const signedIn = await collectState(input);
  assert.equal(signedIn.machineCredential, true);
  assert.equal(signedIn.account, "no-credential", "this project is registered for nothing; that is unchanged");
  assert.equal(recommend(signedIn)[0].command, "npx @staves/cli connect");
  assert.match(recommend(signedIn)[0].why, /already has a Staves account connection/);

  // The default credentials file counts exactly as much as a named connection.
  await forgetCredentials("other-project");
  assert.equal((await collectState(input)).machineCredential, false, "a forgotten connection is gone");
  await writeCredentials({ url: "https://staves.example", token: "sta_live", email: "a@b.c" });
  assert.equal((await collectState(input)).machineCredential, true);
  await forgetCredentials();
});

test("an unregistered project gets rule 1 alone, not rule 2", () => {
  const list = only(quiet({
    registered: { claude: false, cursor: false, codex: false },
    stalePackages: ["@staves/cli@0.0.1"], instructionsCurrent: false,
  }));
  assert.equal(list.length, 1, "rule 2 is noise here: setup refuses to run before init, and rule 1 already covers it");
  assert.equal(list[0].priority, 1);
});

test("rule 2: a stale pin and an old managed block both route to setup", () => {
  const pinned = only(quiet({ stalePackages: ["@staves/cli@0.0.1"] }));
  assert.equal(pinned[0].priority, 2);
  assert.equal(pinned[0].command, "npx @staves/cli setup");
  assert.match(pinned[0].why, /@staves\/cli@0\.0\.1/);
  assert.match(pinned[0].why, new RegExp(VERSION.replace(/\./g, "\\.")));

  const drifted = only(quiet({ instructionsCurrent: false }));
  assert.equal(drifted[0].priority, 2);
  assert.match(drifted[0].why, /CLAUDE\.md/);

  const both = only(quiet({ stalePackages: ["staves"], instructionsCurrent: false }));
  assert.equal(both.filter(item => item.priority === 2).length, 1, "one line, not two, for one command");
});

test("rule 3: an installed agent whose own client file has no entry is named", () => {
  const list = only(quiet({ registered: { claude: true, cursor: true, codex: false }, agentsInstalled: ["claude", "codex"] }));
  assert.equal(list[0].priority, 3);
  assert.match(list[0].title, /Codex/);
  assert.match(list[0].why, /\.codex\/config\.toml/);
  assert.equal(list[0].command, "npx @staves/cli setup");

  const claude = only(quiet({ registered: { claude: false, cursor: true, codex: true }, agentsInstalled: ["claude"] }));
  assert.match(claude[0].why, /\.mcp\.json/);

  const absent = recommend(quiet({ registered: { claude: true, cursor: true, codex: false }, agentsInstalled: ["claude"] }));
  assert.equal(absent.filter(item => item.priority === 3).length, 0, "an agent that is not installed needs no registration");
});

test("rule 4: a missing credential and a refused one are one command but two problems", () => {
  const missing = only(quiet({ mode: "hosted", account: "no-credential" }));
  assert.equal(missing[0].priority, 4);
  assert.equal(missing[0].command, "npx @staves/cli connect");
  assert.match(missing[0].why, /no credential for it is stored on this machine/);

  const refused = only(quiet({ mode: "hosted", account: "unreachable", accountReason: "Your connection has expired." }));
  assert.equal(refused[0].command, "npx @staves/cli connect");
  assert.equal(refused[0].why, "The stored credential did not open the account: Your connection has expired. Run npx @staves/cli connect to replace it, or check the service URL.");
  assert.doesNotMatch(refused[0].why, /no credential for it is stored/, "a credential that exists is not a credential that is missing");

  const forged = only(quiet({ mode: "hosted", account: "unreachable", accountReason: "hi\n✗ credential fine" }));
  assert.ok(!forged[0].why.includes("\n"), forged[0].why);

  assert.equal(recommend(quiet({ mode: "hosted", account: "connected", accountConnected: true })).filter(item => item.priority === 4).length, 0);
});

// Rule 4's other half: the account opens, and the connection still cannot make a board here. The
// person is in a terminal, so the answer has to be a thing to run, not a page to go and find.
test("rule 4: a connected hosted project that cannot create its board is given the way to one", () => {
  const hosted = { mode: "hosted" as const, root: "/repo/sample-project", account: "connected" as const, accountConnected: true, boards: ["orders"], base: { url: "https://staves.io", live: true } };
  const why = "The connection can read but cannot create a board for this project. The approval page can create one, or raise the allowance under Account → Coding agents.";

  const spent = only(quiet({ ...hosted, allowance: { permission: "contribute", remaining: 0 } }));
  assert.deepEqual(spent.slice(0, 2).map(item => `${item.priority}:${item.audience}`), ["4:human", "4:agent"]);
  assert.equal(spent[0].title, "Give this connection a board");
  assert.equal(spent[0].command, "npx @staves/cli connect");
  assert.equal(spent[0].why, why);
  assert.equal(spent[0].url, "https://staves.io/workspace#account");
  assert.equal(spent[1].title, "Ask the person for a board");
  assert.equal(spent[1].tool, "staves_access");
  assert.equal(spent[1].why, why);

  const readOnly = only(quiet({ ...hosted, allowance: { permission: "read", remaining: 0 } }));
  assert.equal(readOnly[0].title, "Give this connection a board", "read-only is the same dead end, differently spelled");

  // A connection with room to create is not stuck, and neither is one that already has this
  // project's board — whatever its allowance says.
  assert.equal(recommend(quiet({ ...hosted, allowance: { permission: "contribute", remaining: 1 } })).filter(item => item.priority === 4).length, 0);
  assert.equal(recommend(quiet({ ...hosted, boards: ["orders", "sample-project"], allowance: { permission: "read", remaining: 0 } })).filter(item => item.priority === 4).length, 0);
  assert.equal(recommend(quiet({ ...hosted, root: "/repo/Fenn Ology!", boards: ["fenn-ology"], allowance: { permission: "read", remaining: 0 } })).filter(item => item.priority === 4).length, 0, "the board id is the directory name as ids are written");
  // An allowance nobody could read is not an allowance of zero.
  assert.equal(recommend(quiet({ ...hosted })).filter(item => item.priority === 4).length, 0);
  // Rule 4's first half still owns an account that will not open: the two never fire together.
  const unreachable = only(quiet({ ...hosted, account: "no-credential", accountConnected: false, allowance: { permission: "read", remaining: 0 } }));
  assert.equal(unreachable.filter(item => item.priority === 4).length, 1);
  assert.equal(unreachable[0].title, "Connect this machine to your Staves account");
});

test("rule 5: no boards asks the person and tells the agent where to start", () => {
  const list = only(quiet({ boards: [] }));
  assert.deepEqual(list.map(item => item.audience), ["human", "agent"]);
  assert.match(list[0].title, /run staves/);
  assert.equal(list[0].command, undefined, "asking your agent is not a shell command");
  assert.equal(list[1].tool, "staves_start");
  assert.match(list[1].title, /read the repository/i);
});

test("rule 6: a queued assessment names the listener command and the agent's tool", () => {
  const list = only(quiet({ queued: [{ board: "orders", id: "01ABC", intent: "assess" }] }));
  assert.deepEqual(list.map(item => item.priority), [6, 6]);
  assert.equal(list[0].command, "npx @staves/cli listen --agent claude --board orders --once");
  assert.match(list[0].why, /queued does not mean running/i);
  assert.equal(list[1].audience, "agent");
  assert.equal(list[1].tool, "staves_requests");
  assert.match(list[1].why, /staves_request_status/);

  const codexOnly = only(quiet({ agentsInstalled: ["codex"], queued: [{ board: "orders", id: "01ABC", intent: "assess" }] }));
  assert.match(codexOnly[0].command ?? "", /--agent codex/);
  const none = only(quiet({ agentsInstalled: [], queued: [{ board: "orders", id: "01ABC", intent: "assess" }] }));
  assert.match(none[0].command ?? "", /--agent claude/, "with no agent installed the example still has to name one");
});

test("rule 7: a queued conversation goes to the interactive agent, never the listener", () => {
  const list = only(quiet({ queued: [{ board: "orders", id: "01XYZ", intent: "discuss" }] }));
  assert.deepEqual(list.map(item => item.priority), [7, 7]);
  assert.equal(list[0].audience, "human");
  assert.match(list[0].title, /resume staves/);
  assert.equal(list[0].command, undefined);
  assert.equal(list[1].tool, "staves_requests");
  assert.match(list[1].why, /staves_brief/);
  assert.equal(recommend(quiet({ queued: [{ board: "orders", id: "01XYZ", intent: "discuss" }] })).filter(item => item.priority === 6).length, 0);
});

test("rule 8: a failed request names its id and its note", () => {
  const list = only(quiet({ failed: [{ board: "orders", id: "01BAD", note: "the agent returned jobs outside the request scope" }] }));
  assert.equal(list[0].priority, 8);
  assert.match(list[0].title, /01BAD/);
  assert.match(list[0].why, /outside the request scope/);
  assert.match(list[0].why, /queue/i);
  assert.equal(list[0].command, undefined);

  const silent = only(quiet({ failed: [{ board: "orders", id: "01BAD" }] }));
  assert.match(silent[0].why, /no note/i);
});

test("rule 9: proposals are reviewed in the terminal locally and on the board when hosted", () => {
  const local = only(quiet({ pendingProposals: [{ board: "orders", count: 2 }] }));
  assert.equal(local[0].priority, 9);
  assert.equal(local[0].command, "npx @staves/cli review orders");
  assert.match(local[0].title, /2/);

  const hosted = only(quiet({ mode: "hosted", account: "connected", accountConnected: true, pendingProposals: [{ board: "orders", count: 1 }] }));
  assert.equal(hosted[0].command, undefined);
  assert.match(hosted[0].why, /board/);
});

test("rule 10: langfuse in the shell alone, and a board connected with no keys at all", () => {
  const shell = only(quiet({ langfuse: "shell-only" }));
  assert.equal(shell[0].priority, 10);
  assert.match(shell[0].why, /env block/);
  assert.match(shell[0].why, /staves setup preserves it/);

  const board = only(quiet({ langfuse: "board-connected" }));
  assert.equal(board[0].priority, 10);
  assert.match(board[0].why, /LANGFUSE_\*/);

  assert.equal(recommend(quiet({ langfuse: "mcp-env" })).filter(item => item.priority === 10).length, 0);
  assert.equal(recommend(quiet({ langfuse: "unset" })).filter(item => item.priority === 10).length, 0);
});

test("rule 10: a connected hosted project whose agent has Langfuse keys, and whose runs staves.io does not show, is told how to show them", () => {
  const hosted = { mode: "hosted", account: "connected", accountConnected: true } as const;
  const share = (state: StavesState) => recommend(state).find(item => item.title === "Show this project's runs on staves.io");
  for (const langfuse of ["mcp-env", "shell-only"] as const) {
    const found = share(quiet({ ...hosted, langfuse, hostedRuns: false }));
    assert.ok(found, langfuse);
    assert.equal(found.audience, "human");
    assert.equal(found.priority, 10);
    assert.equal(found.command, "npx @staves/cli connect --share-runs");
    assert.doesNotMatch(found.why, /token|MCP/);
  }
  // Already shown, not known, not hosted, not connected, or no keys to hand over: nothing to say.
  assert.equal(share(quiet({ ...hosted, langfuse: "mcp-env", hostedRuns: true })), undefined);
  assert.equal(share(quiet({ ...hosted, langfuse: "mcp-env" })), undefined, "a gateway that could not say is not a gateway that said no");
  assert.equal(share(quiet({ langfuse: "mcp-env", hostedRuns: false })), undefined);
  assert.equal(share(quiet({ ...hosted, account: "unreachable", accountConnected: false, langfuse: "mcp-env", hostedRuns: false })), undefined);
  for (const langfuse of ["unset", "board-connected"] as const) assert.equal(share(quiet({ ...hosted, langfuse, hostedRuns: false })), undefined, langfuse);
});

test("collectState asks the account whether it shows this connection's runs only when there are keys to hand over", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-hosted-runs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = process.env.STAVES_HOME_DIR;
  process.env.STAVES_HOME_DIR = root;
  t.after(() => { if (home === undefined) delete process.env.STAVES_HOME_DIR; else process.env.STAVES_HOME_DIR = home; });
  const credentials = { url: "https://staves.example", token: "sta_token", email: "a@b.c" };
  await writeCredentials(credentials, "abc");
  const hosted = { label: ".mcp.json", file: "x", client: "claude" as const, state: "present" as const, serverArgs: ["-y", `@staves/cli@${VERSION}`, "mcp", "--hosted", "--connection", "abc"], env: { LANGFUSE_PUBLIC_KEY: "pk-lf-a", LANGFUSE_SECRET_KEY: "sk-lf-b" } };
  let runs: () => Response = () => Response.json({ projectId: null });
  let asked = 0;
  const gateway: typeof globalThis.fetch = async url => {
    const target = String(url);
    if (target.endsWith("/auth/cli/exchange")) return Response.json({ email: "a@b.c", user_id: "u", boards: ["orders"], permission: "contribute", createLimit: 1, createdCount: 0 });
    if (target.endsWith("/cli-api/boards")) return Response.json({ boards: [{ name: "orders", updated_at: "2026-09-16T00:00:00Z" }] });
    if (target.includes("/cli-api/board?")) return Response.json({ entries: [{ seq: 1, id: "e1", v: 1, at: "2026-09-16T00:00:00Z", by: "human", op: { t: "board", id: "orders", title: "Orders" } }], revision: 0 });
    if (target.endsWith("/cli-api/langfuse")) { asked++; return runs(); }
    throw new Error("unexpected " + target);
  };
  const collect = (registration = hosted, env: NodeJS.ProcessEnv = {}) => collectState({ store: () => hostedStore(credentials, gateway), root, env, registrations: [registration], agents: [] });
  const none = await collect();
  assert.equal(none.langfuse, "mcp-env");
  assert.equal(none.hostedRuns, false);
  assert.ok(recommend(none).some(item => item.command === "npx @staves/cli connect --share-runs"));
  runs = () => Response.json({ projectId: "project-1" });
  assert.equal((await collect()).hostedRuns, true);
  // A service that cannot hold keys is not a gap in what was read, and is not a reason to recommend anything.
  runs = () => Response.json({ error: "Storing Langfuse keys is not configured on this service." }, { status: 503 });
  const unavailable = await collect();
  assert.equal(unavailable.hostedRuns, undefined);
  assert.equal(unavailable.partial, undefined, unavailable.partialReason);
  asked = 0;
  const keyless = await collect({ ...hosted, env: {} as never });
  assert.equal(keyless.hostedRuns, undefined);
  assert.equal(asked, 0, "no keys, no question");
});

test("several triggers come back in rule order, and the fallback stays away", () => {
  const state = quiet({
    stalePackages: ["staves"], langfuse: "shell-only", boards: [],
    pendingProposals: [{ board: "orders", count: 1 }],
    failed: [{ board: "orders", id: "01BAD", note: "timed out" }],
    queued: [{ board: "orders", id: "01ABC", intent: "assess" }, { board: "orders", id: "01XYZ", intent: "discuss" }],
  });
  assert.deepEqual(titles(state), ["2:human", "5:human", "5:agent", "6:human", "6:agent", "7:human", "7:agent", "8:human", "9:human", "10:human"]);
  assert.deepEqual(recommend(state).map(item => item.priority), [...recommend(state).map(item => item.priority)].sort((a, b) => a - b));
});

test("the terminal sees human and both, the agent sees agent and both", () => {
  const busy = recommend(quiet({ queued: [{ board: "orders", id: "01ABC", intent: "assess" }] }));
  const human = formatRecommendations(busy, "human");
  assert.equal(human[0], "Recommended next");
  assert.ok(human.some(line => line.includes("npx @staves/cli listen")), human.join("\n"));
  assert.ok(!human.some(line => line.includes("staves_requests")), human.join("\n"));

  const agent = formatRecommendations(busy, "agent");
  assert.ok(agent.some(line => line.trim() === "staves_requests"), agent.join("\n"));
  assert.ok(!agent.some(line => line.includes("npx @staves/cli listen")), agent.join("\n"));

  const shared = formatRecommendations(recommend(quiet()), "agent");
  assert.ok(shared.some(line => line.includes("what has drifted")), "a both recommendation reaches either audience");
  assert.equal(formatRecommendations(busy, "human", 1).filter(line => /^ {2}\d+\./.test(line)).length, 1);
});

test("Right now names every board with the link that opens it, and omits what is empty", () => {
  assert.deepEqual(rightNow(quiet()), ["· orders  http://localhost:5178/b/local?board=orders"]);
  const busy = rightNow(quiet({
    boards: ["orders", "returns"],
    queued: [{ board: "orders", id: "a", intent: "assess" }, { board: "orders", id: "b", intent: "discuss" }],
    failed: [{ board: "returns", id: "c", note: "timed out" }],
    pendingProposals: [{ board: "orders", count: 3 }],
  }));
  assert.equal(busy.length, 5);
  assert.equal(busy[0], "· orders  http://localhost:5178/b/local?board=orders");
  assert.equal(busy[1], "· returns  http://localhost:5178/b/local?board=returns");
  assert.match(busy[2], /2 queued requests: 1 assess, 1 discuss/);
  assert.match(busy[3], /1 failed request: c on returns — timed out/);
  assert.match(busy[4], /3 proposals waiting on orders/);
  // Only so many boards are worth naming on one screen; the rest are counted.
  const many = rightNow(quiet({ boards: ["a", "b", "c", "d", "e", "f", "g", "h"] }), { boards: 6 });
  assert.equal(many.length, 7);
  assert.equal(many[6], "· …and 2 more");
});

test("capping the boards never costs the queued, failed and waiting lines", () => {
  const busy = quiet({
    boards: ["a", "b", "c", "d", "e"],
    queued: [{ board: "a", id: "q1", intent: "assess" }],
    failed: [{ board: "b", id: "f1", note: "the agent stopped" }],
    pendingProposals: [{ board: "a", count: 2 }],
  });
  const lines = rightNow(busy, { boards: 3 });
  const boards = lines.filter(line => line.includes("?board="));
  assert.ok(boards.length <= 3, lines.join("\n"));
  assert.equal(lines.filter(line => line.startsWith("· …and ")).length, 1);
  // The cap is on the board lines. What is waiting is the reason to read this block at all.
  assert.ok(lines.some(line => line.includes("1 queued request")), lines.join("\n"));
  assert.ok(lines.some(line => line.includes("1 failed request")), lines.join("\n"));
  assert.ok(lines.some(line => line.includes("2 proposals waiting")), lines.join("\n"));
});

test("a base nobody is serving is still named, with the command that starts it", () => {
  const lines = rightNow(quiet({ base: { url: "http://localhost:5178/b/local", live: false, hint: "start it with npx @staves/cli open" } }));
  assert.equal(lines[0], "· orders  http://localhost:5178/b/local?board=orders");
  assert.equal(lines[1], "· Boards open at http://localhost:5178/b/local once the local server runs (npx @staves/cli open)");
  // A hosted account is always reachable; there is nothing to start.
  assert.equal(rightNow(quiet({ mode: "hosted", base: { url: "https://staves.io", live: true } })).length, 1);
});

test("a recommendation that names a board carries the link to it", () => {
  const list = recommend(quiet({
    queued: [{ board: "orders", id: "01ABC", intent: "assess" }],
    failed: [{ board: "returns", id: "02DEF", note: "the agent stopped" }],
    pendingProposals: [{ board: "orders", count: 2 }],
  }));
  const at = (priority: number) => list.find(item => item.priority === priority && item.audience === "human");
  assert.equal(at(6)?.url, "http://localhost:5178/b/local?board=orders");
  assert.equal(at(8)?.url, "http://localhost:5178/b/local?board=returns");
  assert.equal(at(9)?.url, "http://localhost:5178/b/local?board=orders");
  assert.equal(recommend(quiet())[0].url, undefined, "a recommendation about no board names none");

  const lines = formatRecommendations(list, "human", 1);
  assert.equal(lines[3], "     npx @staves/cli listen --agent claude --board orders --once");
  assert.equal(lines[4], "     http://localhost:5178/b/local?board=orders", lines.join("\n"));
  // A recommendation with no command still carries its link.
  const discuss = formatRecommendations(recommend(quiet({ queued: [{ board: "orders", id: "z", intent: "discuss" }] })), "human", 1);
  assert.equal(discuss[discuss.length - 1], "     http://localhost:5178/b/local?board=orders", discuss.join("\n"));
});

test("the home screen is the title, what is set up, what is waiting and what to do", () => {
  const screen = homeScreen(quiet({ queued: [{ board: "orders", id: "01ABC", intent: "assess" }] }), ["✓ .mcp.json: npx -y @staves/cli mcp"]);
  assert.match(screen, new RegExp(`^staves ${VERSION.replace(/\./g, "\\.")} · /repo · local\\n`));
  assert.match(screen, /\nSet up\n✓ \.mcp\.json/);
  assert.match(screen, /\nRight now\n· orders {2}http:\/\/localhost:5178\/b\/local\?board=orders/);
  assert.match(screen, /\nRecommended next\n  1\. /);
  assert.match(screen, /\nMore: npx @staves\/cli help\n/);
  assert.ok(screen.trimEnd().endsWith("Guide: https://staves.io/docs/connect/"), screen);
});

test("collectState reads the project's files, the store and the shell", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-next-steps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, ".staves"));
  await store.append("orders", [
    { t: "board", id: "orders", title: "Orders" },
    { t: "track", track: { id: "p", name: "Person", kind: "person" } },
    { t: "job", job: { id: "a", name: "Take the order", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
  ], "human:j");
  await store.append("orders", [{ t: "updateJob", id: "a", patch: { outcome: "Order taken" } }], "agent:claude", true);
  const request = await saveAssessmentRequest(store, "orders", { intent: "assess", rationale: "check it", jobIds: ["a"] }, "human:j");
  const failing = await saveAssessmentRequest(store, "orders", { intent: "assess", rationale: "and this", jobIds: ["a"] }, "human:j");
  await updateAssessmentDelivery(store, "orders", failing.id, { status: "claimed" }, "agent:claude");
  await updateAssessmentDelivery(store, "orders", failing.id, { status: "failed", note: "the agent stopped" }, "agent:claude");

  await writeFile(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { staves: { command: "npx", args: ["-y", "@staves/cli@0.0.1", "mcp", "--dir", join(root, ".staves")] } } }));
  await mkdir(join(root, ".claude", "skills", "staves"), { recursive: true });
  await writeFile(join(root, ".claude", "skills", "staves", "SKILL.md"), "the skill");

  const state = await collectState({
    store, root, registrations: await projectRegistrations(root),
    env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, agents: ["claude"],
    instructions: "## Staves\n\nwhatever this version writes",
  });
  assert.equal(state.mode, "local");
  assert.equal(state.root, root);
  assert.deepEqual(state.registered, { claude: true, cursor: false, codex: false });
  assert.deepEqual(state.skills, { claude: true, codex: false });
  assert.equal(state.instructionsCurrent, false, "no CLAUDE.md at all is not a current managed block");
  assert.deepEqual(state.stalePackages, ["@staves/cli@0.0.1"]);
  assert.deepEqual(state.boards, ["orders"]);
  assert.deepEqual(state.queued, [{ board: "orders", id: request.id, intent: "assess" }]);
  assert.deepEqual(state.failed, [{ board: "orders", id: failing.id, note: "the agent stopped" }]);
  assert.deepEqual(state.pendingProposals, [{ board: "orders", count: 1 }]);
  assert.equal(state.langfuse, "shell-only");

  const withKeys = await collectState({
    store, root, registrations: [{ label: ".mcp.json", file: "x", client: "claude", state: "present", serverArgs: ["-y", `@staves/cli@${VERSION}`, "mcp"], env: { LANGFUSE_SECRET_KEY: "sk" } }],
    env: {}, agents: [],
  });
  assert.equal(withKeys.langfuse, "mcp-env");
  assert.deepEqual(withKeys.stalePackages, []);

  // Codex launches the server from its own file, so keys there count as much as keys in .mcp.json.
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), [
    `[mcp_servers.staves]`, `command = "npx"`, `args = ["-y", "@staves/cli@${VERSION}", "mcp", "--dir", ${JSON.stringify(join(root, ".staves"))}]`,
    `[mcp_servers.staves.env]`, `LANGFUSE_PUBLIC_KEY = "pk-codex"`, `LANGFUSE_SECRET_KEY = "sk-codex"`, "",
  ].join("\n"));
  const inCodex = await collectState({ store, root, registrations: await projectRegistrations(root), env: {}, agents: [] });
  assert.equal(inCodex.langfuse, "mcp-env", "keys in .codex/config.toml are keys the server will see");
  assert.deepEqual(langfuseRegistrations(await projectRegistrations(root)), [".codex/config.toml"]);
  await rm(join(root, ".codex"), { recursive: true, force: true });

  const quietShell = await collectState({ store, root, registrations: [], env: {}, agents: [] });
  assert.equal(quietShell.langfuse, "unset");
  await store.append("orders", [{ t: "setContext", context: { langfuse: { baseUrl: "https://cloud.langfuse.com", projectId: "p1" } } }], "human:j");
  assert.equal((await collectState({ store, root, registrations: [], env: {}, agents: [] })).langfuse, "board-connected");
});

test("a store that never answers costs one line, inside the budget", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hung = { list: () => new Promise<string[]>(() => {}), board: () => new Promise(() => {}) } as unknown as Store;
  // AbortSignal.timeout does not hold the event loop open, and a store that never answers holds nothing
  // either; Node 20's runner then cancels the file. A real hung request keeps the loop alive on its socket.
  const alive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(alive));

  const began = Date.now();
  const state = await collectState({ store: hung, root, registrations: [], env: {}, agents: [] }, { signal: AbortSignal.timeout(120) });
  assert.ok(Date.now() - began < 2000, "the budget, not the store, decided when to stop");
  assert.equal(state.partial, true);
  assert.match(state.partialReason ?? "", /the boards — not read within the time budget/);
  assert.deepEqual(state.boards, []);
  assert.match(homeScreen(state, []), /· Account state incomplete: the boards — not read within the time budget/);
  assert.match(rightNowHeading(state), /^Right now \(partial\): the boards —/);
  assert.equal(rightNowHeading(quiet()), "Right now");
});

test("a hosted account that will not open is never answered with local boards", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-hosted-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = process.env.STAVES_HOME_DIR;
  process.env.STAVES_HOME_DIR = root;
  t.after(() => { if (home === undefined) delete process.env.STAVES_HOME_DIR; else process.env.STAVES_HOME_DIR = home; });
  const local = new Store(join(root, ".staves"));
  await local.append("mine", [{ t: "board", id: "mine", title: "Local only" }], "human:j");
  // A credential this machine does hold, for an account that will not honour it.
  await writeCredentials({ url: "https://staves.example", token: "sta_expired", email: "a@b.c" }, "abc");
  const hosted = { label: ".mcp.json", file: "x", client: "claude" as const, state: "present" as const, serverArgs: ["-y", `@staves/cli@${VERSION}`, "mcp", "--hosted", "--connection", "abc"] };

  const refusing: typeof globalThis.fetch = () => Promise.reject(new Error("socket hang up"));
  const state = await collectState({
    store: () => hostedStore({ url: "https://staves.example", token: "sta_expired", email: "a@b.c" }, refusing),
    root, env: {}, registrations: [hosted],
    agents: () => { throw new Error("PATH could not be read"); },
  });
  assert.equal(state.mode, "hosted");
  assert.equal(state.account, "unreachable", "the credential exists; the account refused it");
  assert.equal(state.accountConnected, false);
  assert.equal(state.accountReason, "Could not reach https://staves.example. Check the address and your connection.");
  assert.deepEqual(state.boards, [], "the local .staves is not the account");
  assert.deepEqual(state.agentsInstalled, [], "a PATH probe that throws is an empty list, not a crash");
  assert.equal(state.partial, true);
  // The first thing that went wrong is the reason; agent detection runs before the account opens.
  assert.match(state.partialReason ?? "", /the installed agents — PATH could not be read/);

  const connect = recommend(state).find(item => item.priority === 4);
  assert.equal(connect?.command, "npx @staves/cli connect");
  assert.match(connect?.why ?? "", /^The stored credential did not open the account: Could not reach https:\/\/staves\.example\. Check the address and your connection\. Run npx @staves\/cli connect/);

  // The same registration with no credential at all is the other half of rule 4.
  await forgetCredentials("abc");
  const bare = await collectState({ store: () => hostedStore({ url: "https://staves.example", token: "sta_expired", email: "a@b.c" }, refusing), root, env: {}, registrations: [hosted], agents: [] });
  assert.equal(bare.account, "no-credential");
  assert.match(recommend(bare).find(item => item.priority === 4)?.why ?? "", /no credential for it is stored on this machine/);
});

test("rule 8 bounds an agent's note itself, whoever assembled the state", () => {
  const forged = "done\naccept: 7 by human:root" + "x".repeat(400);
  const list = recommend(quiet({ failed: [{ board: "orders\nrogue", id: "01BAD\n02", note: forged }] }));
  assert.equal(list[0].priority, 8);
  for (const line of [list[0].title, list[0].why]) {
    assert.ok(!line.includes("\n"), line);
    assert.ok(line.length < 400, line);
  }
});

const cli = resolve("dist/cli.js");
/** The home screen is what a person sees; a pipe is not a person, so force the terminal's answer. */
function run(args: string[], cwd: string, tty: boolean) {
  const script = `process.stdout.isTTY = ${tty}; await import(${JSON.stringify(pathToFileURL(cli).href)});`;
  // Under -e node's argv has no script path, so a filler stands where cli.js would: argv[1].
  const command = tty ? ["--input-type=module", "-e", script, "(home screen)", ...args] : [cli, ...args];
  return new Promise<{ code: number | null; output: string }>(done => {
    const child = spawn(process.execPath, command, { cwd, env: { ...process.env, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", STAVES_HOME_DIR: cwd }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => output += chunk);
    child.stderr.on("data", chunk => output += chunk);
    child.on("close", code => done({ code, output }));
  });
}

test("the bare command recommends; help still lists every command", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-home-screen-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const home = await run([], root, true);
  assert.equal(home.code, 0, home.output);
  assert.match(home.output, /^staves .* · local\n/);
  assert.match(home.output, /\nSet up\n/);
  assert.match(home.output, /· \.mcp\.json: no staves entry/);
  assert.match(home.output, /\nRight now\n/);
  assert.match(home.output, /No boards yet/);
  assert.match(home.output, /\nRecommended next\n/);
  assert.match(home.output, /npx @staves\/cli init/);
  assert.match(home.output, /More: npx @staves\/cli help/);
  assert.ok(home.output.trimEnd().endsWith("Guide: https://staves.io/docs/connect/"), home.output);
  assert.doesNotMatch(home.output, /draw the work\n/, "the home screen is not the help text");

  const help = await run(["help"], root, true);
  assert.match(help.output, /draw the work/);
  assert.match(help.output, /npx @staves\/cli doctor/);
  assert.match(help.output, /npx @staves\/cli review \[board\]/);
  assert.doesNotMatch(help.output, /\nRight now\n/);

  const piped = await run([], root, false);
  assert.match(piped.output, /draw the work/, "without a terminal the bare command is still the help");
  assert.doesNotMatch(piped.output, /\nRecommended next\n/);
});

test("doctor ends with the same recommendations, and then the guide", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-doctor-next-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await run(["doctor"], root, false);
  assert.match(report.output, /\nRecommended next\n/);
  assert.ok(report.output.indexOf("Project registrations") < report.output.indexOf("Recommended next"), report.output);
  assert.match(report.output, /npx @staves\/cli init/);
  assert.doesNotMatch(report.output, /Account state incomplete/, "a local project with nothing to read is not partial");
  assert.ok(report.output.trimEnd().endsWith("Guide: https://staves.io/docs/connect/"), report.output);
});

test("doctor names every board with the link that opens it", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-doctor-boards-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(join(root, ".staves"));
  await store.append("orders", [{ t: "board", id: "orders", title: "Orders" }], "human:j");
  const report = await run(["doctor"], root, false);
  assert.match(report.output, /\n· orders {2}http:\/\/localhost:5178\/b\/local\?board=orders\n/, report.output);
  // Nothing is serving this project, so the link is printed beside what makes it answer.
  assert.match(report.output, /· Boards open at http:\/\/localhost:5178\/b\/local once the local server runs \(npx @staves\/cli open\)/);
  assert.doesNotMatch(report.output, /· Boards: orders/, "a board name alone is not somewhere to go");
});

test("doctor says so when the account it was asked about never answered", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-doctor-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Port 1 refuses at once: a real hosted registration whose account cannot be opened.
  const url = "http://127.0.0.1:1";
  await writeFile(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { staves: { command: "npx", args: ["-y", `@staves/cli@${VERSION}`, "mcp", "--hosted", "--connection", "abc"] } } }));
  await mkdir(join(root, ".staves", "connections"), { recursive: true });
  await writeFile(join(root, ".staves", "connections", "abc.json"), JSON.stringify({ url, token: "sta_" + "e".repeat(43), email: "a@b.c" }));

  const report = await run(["doctor"], root, false);
  assert.match(report.output, new RegExp(`· Account state incomplete: the account — Could not reach ${url.replace(/[.]/g, "\\.")}`), report.output);
  assert.ok(report.output.indexOf("Account state incomplete") < report.output.indexOf("Recommended next"), report.output);
  assert.match(report.output, /The stored credential did not open the account/);
  assert.match(report.output, /npx @staves\/cli connect/);
});

test("staves_help opens with what is waiting and what the agent can do about it", async t => {
  const dir = await mkdtemp(join(tmpdir(), "staves-help-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, ".staves"));
  // A server holds the collected state for thirty seconds, so reading it again after the board
  // changes means a new session — which is what a reconnecting agent gets.
  const help = async () => {
    const server = buildServer(store, "test-agent", "http://localhost:5192/");
    const client = new Client({ name: "next-steps-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try { return ((await client.callTool({ name: "staves_help", arguments: {} })).content as { text: string }[]).map(part => part.text).join("\n"); }
    finally { await client.close(); await server.close(); }
  };

  const empty = await help();
  assert.match(empty, /^Right now\n/, empty);
  assert.match(empty, /No boards yet/);
  assert.match(empty, /\nRecommended next\n/);
  assert.match(empty, /Read the repository, then staves_start/);
  assert.ok(empty.indexOf("Recommended next") < empty.indexOf("Tools:"), "the catalogue stays below the state");
  assert.ok(empty.slice(0, empty.indexOf("Recommended next")).split("\n").filter(line => line.startsWith("· ")).length <= 3, "Right now stays short");
  assert.doesNotMatch(empty, /once the local server runs/, "the server answering this call is serving the boards");

  await store.append("orders", [
    { t: "board", id: "orders", title: "Orders" },
    { t: "track", track: { id: "p", name: "Person", kind: "person" } },
    { t: "job", job: { id: "a", name: "Take the order", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
  ], "human:j");
  await saveAssessmentRequest(store, "orders", { intent: "assess", rationale: "look at it", jobIds: ["a"] }, "human:j");
  // More boards than the agent's screen will name: the cap is on the board lines alone.
  for (const name of ["returns", "refunds", "shipping", "billing"]) {
    await store.append(name, [{ t: "board", id: name, title: name }], "human:j");
  }
  const waiting = await help();
  const head = waiting.slice(0, waiting.indexOf("Tools:"));
  const rightNowBlock = waiting.slice(0, waiting.indexOf("Recommended next")).split("\n").filter(line => line.startsWith("· "));
  assert.ok(rightNowBlock.filter(line => line.includes("?board=")).length <= 3, rightNowBlock.join("\n"));
  assert.match(waiting, /· orders {2}http:\/\/localhost:5192\/\?board=orders/);
  assert.ok(rightNowBlock.some(line => line.startsWith("· …and ")), rightNowBlock.join("\n"));
  assert.match(waiting, /1 queued request: 1 assess — queued does not mean running/);
  assert.match(waiting, /Claim the queued assessment/);
  assert.ok(head.includes("staves_requests"), head);
  assert.doesNotMatch(head, /npx @staves\/cli listen/, "the agent is given a tool, not a terminal command");
});

test("the state behind staves_help is collected once per half-minute, not once per call", async () => {
  let collected = 0, clock = 1_000_000;
  const cached = memoize(30_000, async () => `state ${++collected}`, () => clock);
  assert.equal(await cached(), "state 1");
  clock += 29_999;
  assert.equal(await cached(), "state 1", "a second call inside the window reuses the first collection");
  assert.equal(collected, 1);
  clock += 1;
  assert.equal(await cached(), "state 2", "past the window it collects again");
  assert.equal(collected, 2);
  // Two calls before the first resolves must still be one collection.
  const both = await Promise.all([cached(), cached()]);
  assert.deepEqual(both, ["state 2", "state 2"]);
  assert.equal(collected, 2);
  // A failed collection is not the answer for the next half-minute.
  let fail = true;
  const flaky = memoize(30_000, async () => { if (fail) throw new Error("no"); return "recovered"; }, () => clock);
  await assert.rejects(flaky(), /no/);
  fail = false;
  assert.equal(await flaky(), "recovered");
});

test("a workspace served to someone else gets the catalogue without recommendations about this machine", async t => {
  const dir = await mkdtemp(join(tmpdir(), "staves-help-remote-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = buildServer(new Store(join(dir, ".staves")), "test-agent", "https://host.example/b/abc/", { recommendations: false });
  const client = new Client({ name: "remote-help-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const help = ((await client.callTool({ name: "staves_help", arguments: {} })).content as { text: string }[]).map(part => part.text).join("\n");
  assert.doesNotMatch(help, /Right now/, help.slice(0, 400));
  assert.doesNotMatch(help, /Recommended next/);
  assert.match(help, /Tools:/, "the catalogue is still the point of the tool");
  assert.match(help, /staves_start/);
});
