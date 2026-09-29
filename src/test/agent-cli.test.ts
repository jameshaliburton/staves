import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { VERSION } from "../version.js";

const cli = resolve("dist/cli.js");
function run(args: string[], cwd: string, home: string, extra: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((done) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", STAVES_TOKEN: "", HOME: home, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => output += chunk);
    child.stderr.on("data", chunk => output += chunk);
    child.on("close", code => done({ code, output }));
  });
}

test("CLI redeems handoff, isolates project credentials and offers immediately callable tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-agent-cli-"));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(home); await mkdir(join(project, ".agents", "skills", "staves"), { recursive: true });
  await writeFile(join(project, ".agents", "skills", "staves", "SKILL.md"), "Custom instructions");
  let paired = 0, account = "person@example.com", boardsFail = false;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/cli/pair") { assert.equal(JSON.parse(body).code, "sth_test"); paired++; res.end(JSON.stringify({ token: "sta_" + "s".repeat(43) })); }
    else if (req.url === "/auth/cli/exchange") res.end(JSON.stringify({ email: account, user_id: "user", boards: [], permission: "contribute", createLimit: 1, createdCount: 0 }));
    else if (req.url === "/cli-api/boards") { if (boardsFail) { res.statusCode = 500; res.end(JSON.stringify({ error: "the board service is unavailable" })); } else res.end(JSON.stringify({ boards: [] })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const connected = await run(["connect", "--handoff", "sth_test", "--url", url], project, home);
    assert.equal(connected.code, 0, connected.output); assert.equal(paired, 1);
    assert.doesNotMatch(connected.output, /sta_s{43}/);
    assert.match(connected.output, /registering in \S*\/project\b/);
    const configText = await readFile(join(project, ".mcp.json"), "utf8");
    assert.doesNotMatch(configText, /sta_secret|sth_test/);
    const args: string[] = JSON.parse(configText).mcpServers.staves.args;
    const connection = args[args.indexOf("--connection") + 1]; assert.ok(connection);
    assert.equal(await readFile(join(project, ".agents", "skills", "staves", "SKILL.md"), "utf8"), "Custom instructions");
    assert.equal((await readdir(join(home, ".staves", "connections"))).length, 1);
    const codex = await readFile(join(project, ".codex", "config.toml"), "utf8");
    assert.match(codex, /\[mcp_servers.staves\]/); assert.ok(codex.includes(connection));
    const claude = await readFile(join(project, "CLAUDE.md"), "utf8");
    assert.match(claude, /connected Staves account/); assert.doesNotMatch(claude, /keeps boards of its work in/);
    assert.ok(claude.includes(`Boards: ${url}/workspace`), claude);
    assert.ok(claude.includes(`Guide: ${url}/docs/connect/`), claude);
    assert.ok(!claude.includes(connection), "the managed block can be committed: it names no connection");
    assert.ok(claude.includes(`tool staves_interview --hosted --input '{}'`), claude);
    for (const name of ["AGENTS.md", "GEMINI.md"]) assert.ok(!(await readFile(join(project, name), "utf8")).includes(connection), name);
    assert.equal(JSON.parse(await readFile(join(project, ".staves", "config.json"), "utf8")).connection, connection, "the reference lives in .staves/config.json");
    const status = await run(["doctor"], project, home);
    assert.equal(status.code, 0, status.output); assert.match(status.output, /Staves access verified/);
    assert.match(status.output, /✓ \.staves\/config\.json holds this project's connection reference/);
    assert.match(status.output, /✓ CLAUDE\.md managed block matches/);
    const implicit = await run(["tool", "staves_access", "--hosted", "--input", "{}"], project, home);
    assert.equal(implicit.code, 0, implicit.output); assert.match(implicit.output, /contribute/, "the block's command finds the connection from the project");
    assert.match(status.output, /Client activation is not verified/);
    assert.doesNotMatch(status.output, /sta_s{43}/);

    const refreshed = await run(["setup"], project, home);
    assert.equal(refreshed.code, 0, refreshed.output);
    assert.ok((await readFile(join(project, ".mcp.json"), "utf8")).includes(connection));
    assert.equal((await readdir(join(home, ".staves", "connections"))).length, 1);
    const tool = await run(["tool", "staves_interview", "--hosted", "--connection", connection, "--input", "{}"], project, home);
    assert.equal(tool.code, 0, tool.output); assert.match(tool.output, /staves_describe_many/);
    assert.doesNotMatch(tool.output, /sta_s{43}/);
    const access = await run(["tool", "staves_access", "--hosted", "--connection", connection], project, home);
    assert.equal(access.code, 0, access.output); assert.match(access.output, /remaining/); assert.match(access.output, /contribute/);
    const again = await run(["connect", "--handoff=sth_test", `--url=${url}`], project, home);
    assert.equal(again.code, 0, again.output);
    assert.ok(again.output.includes(`reusing connection ${connection}`), again.output);
    assert.equal((await readdir(join(home, ".staves", "connections"))).length, 1, "the same account on the same server is one connection");

    account = "someone-else@example.com"; boardsFail = true;
    const other = await run(["connect", "--handoff=sth_test", `--url=${url}`], project, home);
    assert.equal(other.code, 0, other.output);
    assert.match(other.output, /staves: connected, but listing boards failed: the board service is unavailable\. Run staves doctor\./);
    assert.ok(other.output.includes(`Guide: ${url}/docs/connect/`), other.output);
    assert.match(other.output, /connected as someone-else@example\.com/);
    assert.equal((await readdir(join(home, ".staves", "connections"))).length, 2, "a different account mints a new connection");
    boardsFail = false;
    const old = await run(["tool", "staves_interview", "--hosted", "--connection", connection], project, home);
    assert.equal(old.code, 0, old.output);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

// A connection scoped to one board — what the approval page hands back after creating a board for
// this project — has one place to write. The terminal has to come back naming it.
test("connect names the board a one-board connection writes to", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "staves-one-board-")));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(home); await mkdir(project);
  let scope: string[] | null = ["sample-project"];
  let createdCount = 0;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/cli/pair") res.end(JSON.stringify({ token: "sta_" + "s".repeat(43) }));
    else if (req.url === "/auth/cli/exchange") res.end(JSON.stringify({ email: "person@example.com", user_id: "user", boards: scope, permission: "contribute", createLimit: 1, createdCount }));
    else if (req.url === "/cli-api/boards") res.end(JSON.stringify({ boards: scope ?? [] }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const one = await run(["connect", "--handoff", "sth_test", "--url", url], project, home);
    assert.equal(one.code, 0, one.output);
    assert.ok(one.output.includes(`  board: sample-project  ${url}/?board=sample-project`), one.output);
    scope = ["sample-project", "billing"];
    const two = await run(["connect", "--handoff", "sth_test", "--url", url], project, home);
    assert.equal(two.code, 0, two.output);
    assert.doesNotMatch(two.output, /^ {2}board: /m, "two boards in scope is not one place to write");
    assert.doesNotMatch(two.output, /to create boards from this project/, "an allowance with room left needs no way out of it");

    // Nothing left to create is where a person gets stuck, so neither screen leaves the zero alone.
    createdCount = 1;
    const hint = `  · to create boards from this project: rerun npx @staves/cli connect and tick "Create a new board for this project", or raise the allowance at ${url}/workspace#account`;
    const spent = await run(["connect", "--handoff", "sth_test", "--url", url], project, home);
    assert.equal(spent.code, 0, spent.output);
    assert.ok(spent.output.includes(`creation allowance remaining: 0\n${hint}`), spent.output);
    const report = await run(["doctor"], project, home);
    assert.equal(report.code, 0, report.output);
    assert.ok(report.output.includes(`· Board creation remaining: 0\n${hint}`), report.output);
    // And the recommendation under it is the same way forward, not a restatement of the wall.
    assert.match(report.output, /Give this connection a board/);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

// The coding agent already has Langfuse keys; connect hands them to the account in one step, only when
// asked, and never shows them. The connection has succeeded by then, so a refusal is one line.
test("connect --share-runs hands the agent's Langfuse keys over, only when asked, and never prints them", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "staves-share-runs-")));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(home); await mkdir(project);
  const shellKeys = { LANGFUSE_PUBLIC_KEY: "pk-lf-shell-1234", LANGFUSE_SECRET_KEY: "sk-lf-shell-secret-5678", LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com" };
  const mcpKeys = { LANGFUSE_PUBLIC_KEY: "pk-lf-mcp-1234", LANGFUSE_SECRET_KEY: "sk-lf-mcp-secret-5678" }; // gitleaks:allow -- synthetic test credential
  let shared: { body: Record<string, unknown>; auth?: string }[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: { projectId: "project-1", projectName: "Vendor onboarding", boards: ["sample-project", "billing"] } };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/cli/pair") res.end(JSON.stringify({ token: "sta_" + "s".repeat(43) }));
    else if (req.url === "/auth/cli/exchange") res.end(JSON.stringify({ email: "person@example.com", user_id: "user", boards: ["sample-project"], permission: "contribute", createLimit: 1, createdCount: 0 }));
    else if (req.url === "/cli-api/boards") res.end(JSON.stringify({ boards: [] }));
    else if (req.url === "/cli-api/langfuse" && req.method === "POST") { shared.push({ body: JSON.parse(body), auth: req.headers.authorization }); res.statusCode = answer.status; res.end(JSON.stringify(answer.body)); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const connect = (...extra: string[]) => ["connect", "--handoff", "sth_test", "--url", url, ...extra];
  const secrets = [shellKeys.LANGFUSE_SECRET_KEY, shellKeys.LANGFUSE_PUBLIC_KEY, mcpKeys.LANGFUSE_SECRET_KEY, mcpKeys.LANGFUSE_PUBLIC_KEY];
  try {
    // Without a terminal there is no one to ask, so nothing is shared unless the flag says so.
    const unasked = await run(connect(), project, home, shellKeys);
    assert.equal(unasked.code, 0, unasked.output);
    assert.equal(shared.length, 0);
    assert.doesNotMatch(unasked.output, /^runs:/m);

    const fromShell = await run(connect("--share-runs"), project, home, shellKeys);
    assert.equal(fromShell.code, 0, fromShell.output);
    assert.deepEqual(shared, [{ body: { publicKey: shellKeys.LANGFUSE_PUBLIC_KEY, secretKey: shellKeys.LANGFUSE_SECRET_KEY, baseUrl: shellKeys.LANGFUSE_BASE_URL }, auth: "Bearer sta_" + "s".repeat(43) }]);
    assert.ok(fromShell.output.includes(`runs: Vendor onboarding · 2 boards will show As run  ${url}/workspace`), fromShell.output);
    for (const secret of secrets) assert.equal(fromShell.output.includes(secret), false, "the keys are never printed");
    assert.ok(fromShell.output.trimEnd().endsWith(`${url}/workspace`), "the runs line comes after the connection is reported");

    // The shell has nothing: the keys in this project's registered server are the agent's keys.
    shared = [];
    const config = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
    config.mcpServers.staves.env = mcpKeys;
    await writeFile(join(project, ".mcp.json"), JSON.stringify(config));
    answer = { status: 200, body: { projectId: "project-1", projectName: null, boards: ["sample-project"] } };
    const fromMcp = await run(connect("--share-runs"), project, home);
    assert.equal(fromMcp.code, 0, fromMcp.output);
    assert.deepEqual(shared.map(item => item.body), [{ publicKey: mcpKeys.LANGFUSE_PUBLIC_KEY, secretKey: mcpKeys.LANGFUSE_SECRET_KEY }]);
    assert.ok(fromMcp.output.includes(`runs: project-1 · 1 board will show As run  ${url}/workspace`), fromMcp.output);
    for (const secret of secrets) assert.equal(fromMcp.output.includes(secret), false);
    assert.ok((await readFile(join(project, ".mcp.json"), "utf8")).includes(mcpKeys.LANGFUSE_SECRET_KEY), "the registration keeps its env block");

    // --no-share-runs wins over everything.
    shared = [];
    const declined = await run(connect("--share-runs", "--no-share-runs"), project, home, shellKeys);
    assert.equal(declined.code, 0, declined.output);
    assert.equal(shared.length, 0);

    // A refusal is one line, and the connection still stands.
    answer = { status: 400, body: { error: "Langfuse did not accept these keys. Check that the public and secret key belong to the same project." } };
    const refused = await run(connect("--share-runs"), project, home, shellKeys);
    assert.equal(refused.code, 0, refused.output);
    assert.match(refused.output, /connected as person@example\.com/);
    const lines = refused.output.split("\n").filter(line => line.startsWith("staves: runs"));
    assert.deepEqual(lines, ["staves: runs not shown: Langfuse did not accept these keys. Check that the public and secret key belong to the same project."]);
    for (const secret of secrets) assert.equal(refused.output.includes(secret), false);

    // Asked for, with no keys anywhere: say where they were looked for, and where to add them instead.
    config.mcpServers.staves.env = {};
    await writeFile(join(project, ".mcp.json"), JSON.stringify(config));
    shared = [];
    const keyless = await run(connect("--share-runs"), project, home);
    assert.equal(keyless.code, 0, keyless.output);
    assert.equal(shared.length, 0);
    assert.ok(keyless.output.includes(`staves: runs not shown: no Langfuse keys in this shell or this project's MCP registration. Add them under Account → Runs at ${url}/workspace#account`), keyless.output);

    const help = await run(["help"], project, home);
    assert.match(help.output, /connect --share-runs/);
    assert.match(help.output, /connect --no-share-runs/);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

// Sharing runs from a project that is already connected must not approve, and store, a second connection.
test("connect --share-runs on a connected machine reuses its working connection; without one it asks for approval", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "staves-share-reuse-")));
  const home = join(root, "home"), fresh = join(root, "fresh"), project = join(root, "project");
  await mkdir(home); await mkdir(fresh); await mkdir(project);
  const shellKeys = { LANGFUSE_PUBLIC_KEY: "pk-lf-shell-1234", LANGFUSE_SECRET_KEY: "sk-lf-shell-secret-5678" };
  const seen: string[] = [];
  let revoked = false, shared = 0;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    seen.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/cli/pair") res.end(JSON.stringify({ token: "sta_" + "s".repeat(43) }));
    else if (req.url === "/auth/cli/exchange") {
      if (revoked) { res.statusCode = 401; res.end(JSON.stringify({ error: "This connection was revoked." })); }
      else res.end(JSON.stringify({ email: "person@example.com", user_id: "user", boards: ["shop"], permission: "contribute", createLimit: 1, createdCount: 0 }));
    }
    else if (req.url === "/cli-api/boards") res.end(JSON.stringify({ boards: ["shop"] }));
    else if (req.url === "/cli-api/langfuse" && req.method === "POST") { shared++; res.end(JSON.stringify({ projectId: "project-1", projectName: "Shop", boards: ["shop"] })); }
    else if (req.url === "/auth/cli/device") res.end(JSON.stringify({ device: "std_" + "a".repeat(43), approval: "stu_" + "b".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() }));
    else if (req.url === "/auth/cli/device/poll") res.end(JSON.stringify({ status: "denied" }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const devices = () => seen.filter(line => line === "POST /auth/cli/device").length;
  try {
    const first = await run(["connect", "--handoff", "sth_test", "--url", url, "--no-share-runs"], project, home);
    assert.equal(first.code, 0, first.output);
    const connection = /connection reference: (\S+)/.exec(first.output)?.[1];
    assert.ok(connection, first.output);
    const files = await readdir(join(home, ".staves", "connections"));

    seen.length = 0;
    const reused = await run(["connect", "--url", url, "--share-runs"], project, home, shellKeys);
    assert.equal(reused.code, 0, reused.output);
    assert.equal(devices(), 0, "no browser approval for a machine that is already connected");
    assert.equal(seen.filter(line => line === "POST /auth/cli/pair").length, 0);
    assert.ok(reused.output.includes(`using connection ${connection}`), reused.output);
    assert.equal(shared, 1);
    assert.ok(reused.output.includes(`runs: Shop · 1 board will show As run  ${url}/workspace`), reused.output);
    assert.doesNotMatch(reused.output, /registered the MCP server/, "straight to sharing runs");
    assert.deepEqual(await readdir(join(home, ".staves", "connections")), files, "no second credential");
    for (const secret of Object.values(shellKeys)) assert.equal(reused.output.includes(secret), false);

    // Without --share-runs, connecting again still asks the browser, as before.
    seen.length = 0;
    const plainConnect = await run(["connect", "--url", url], project, home, shellKeys);
    assert.equal(devices(), 1, plainConnect.output);

    // A connection that no longer works is no connection: approval, as for a machine never connected.
    seen.length = 0; revoked = true;
    const stale = await run(["connect", "--url", url, "--share-runs"], project, home, shellKeys);
    assert.equal(devices(), 1, stale.output);
    assert.doesNotMatch(stale.output, /using connection/);
    revoked = false;

    seen.length = 0;
    const never = await run(["connect", "--url", url, "--share-runs"], project, fresh, shellKeys);
    assert.equal(devices(), 1, never.output);
    assert.doesNotMatch(never.output, /using connection/);
    assert.equal(shared, 1, "nothing shared without a connection");
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

test("disconnect says where on Account the connection itself is revoked", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "staves-disconnect-")));
  const home = join(root, "home");
  await mkdir(join(home, ".staves", "connections"), { recursive: true });
  await writeFile(join(home, ".staves", "connections", "abc.json"), JSON.stringify({ url: "https://staves.io", token: "sta_" + "s".repeat(43), email: "person@example.com" }));
  try {
    const out = await run(["disconnect", "--connection", "abc"], root, home);
    assert.equal(out.code, 0, out.output);
    assert.match(out.output, /Revoke the token itself in Staves under Account → Coding agents\./);
    assert.doesNotMatch(out.output, /Agent connections/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local initialization and refresh never teach hosted storage or require account credentials", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "staves-local-cli-")));
  try {
    const result = await run(["init"], root, root);
    assert.equal(result.code, 0, result.output);
    assert.ok(result.output.trimEnd().endsWith("Guide: https://staves.io/docs/connect/"), result.output);
    const skill = await readFile(join(root, ".agents", "skills", "staves", "SKILL.md"), "utf8");
    assert.match(skill, /Boards are saved locally/);
    assert.ok(skill.includes("Boards: http://localhost:5178/b/local — npx @staves/cli open starts the local server"), skill.slice(-600));
    assert.ok(skill.includes("Guide: https://staves.io/docs/connect/"), skill.slice(-600));
    assert.doesNotMatch(skill, /--hosted|--connection <id>/);
    assert.match(await readFile(join(root, ".codex", "config.toml"), "utf8"), /--dir/);
    const gemini = JSON.parse(await readFile(join(root, ".gemini", "settings.json"), "utf8"));
    assert.deepEqual(gemini.mcpServers.staves.args, ["-y", `@staves/cli@${VERSION}`, "mcp", "--dir", join(root, ".staves")]);
    assert.match(await readFile(join(root, "GEMINI.md"), "utf8"), /Detailed modelling guidance/);
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    assert.match(claude, /Detailed modelling guidance: \.claude\/skills\/staves\/SKILL\.md \(Claude Code\) or \.agents\/skills\/staves\/SKILL\.md \(Codex and others\)\. Read it before your first Staves write\./);
    assert.doesNotMatch(claude, /Read the Staves skill for detailed modelling guidance/);
    // An agent reading only this file still knows where the boards are and how to connect.
    assert.ok(claude.includes("Boards: http://localhost:5178/b/local — npx @staves/cli open starts the local server"), claude);
    assert.ok(claude.includes("Guide: https://staves.io/docs/connect/"), claude);
    const refresh = await run(["setup"], root, root);
    assert.equal(refresh.code, 0, refresh.output);
    assert.ok(refresh.output.trimEnd().endsWith("Guide: https://staves.io/docs/connect/"), refresh.output);
    assert.equal(await readFile(join(root, ".agents", "skills", "staves", "SKILL.md"), "utf8"), skill);

    // Run from a subdirectory it must say which repository it is refreshing, not silently move in.
    const inner = join(root, "packages", "api");
    await mkdir(inner, { recursive: true });
    const nested = await run(["init"], inner, root);
    assert.equal(nested.code, 0, nested.output);
    assert.ok(nested.output.includes(`staves: this repository is already initialised at ${root}; refreshing it`), nested.output);
    assert.equal(await readFile(join(inner, ".mcp.json"), "utf8").catch(() => ""), "", "no second registration in the subdirectory");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("refreshing a registration keeps the MCP server's launch environment and upgrades a pre-rename package", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-env-cli-"));
  try {
    assert.equal((await run(["init"], root, root)).code, 0);
    const env = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" };
    for (const relative of [".mcp.json", join(".cursor", "mcp.json"), join(".gemini", "settings.json")]) {
      const file = join(root, relative);
      const config = JSON.parse(await readFile(file, "utf8"));
      config.mcpServers.staves = { env, command: "npx", args: ["-y", "staves", "mcp", "--dir", join(root, ".staves")] };
      config.mcpServers.other = { command: "other" };
      config.userSetting = { keep: true };
      await writeFile(file, JSON.stringify(config, null, 2) + "\n");
    }
    const codexFile = join(root, ".codex", "config.toml");
    await writeFile(codexFile, await readFile(codexFile, "utf8") + '\n[mcp_servers.staves.env]\nLANGFUSE_PUBLIC_KEY = "pk"\n');
    const refreshed = await run(["setup"], root, root);
    assert.equal(refreshed.code, 0, refreshed.output);
    for (const relative of [".mcp.json", join(".cursor", "mcp.json"), join(".gemini", "settings.json")]) {
      const config = JSON.parse(await readFile(join(root, relative), "utf8"));
      assert.deepEqual(config.mcpServers.staves.env, env, relative);
      assert.equal(config.mcpServers.other.command, "other", relative);
      assert.deepEqual(config.userSetting, { keep: true }, relative);
      assert.equal(config.mcpServers.staves.args[1], `@staves/cli@${VERSION}`, relative);
    }
    const codex = await readFile(codexFile, "utf8");
    assert.match(codex, /\[mcp_servers\.staves\.env\]\nLANGFUSE_PUBLIC_KEY = "pk"/);
    assert.ok(codex.includes(`"@staves/cli@${VERSION}"`), codex);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doctor names the file it inspected, the stale pin and the package npm does not serve", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-doctor-"));
  const home = join(root, "home"), elsewhere = join(root, "elsewhere"), project = join(root, "project");
  await mkdir(home); await mkdir(elsewhere); await mkdir(project);
  const inHome = { STAVES_HOME_DIR: home };
  try {
    const bare = await run(["doctor"], project, elsewhere, inHome);
    assert.equal(bare.code, 1, bare.output);
    // What to do about an unregistered project is rule 1 of the shared engine, printed once.
    assert.match(bare.output, /Recommended next\n {2}1\. Register Staves in this project/);
    assert.match(bare.output, /npx @staves\/cli connect/);
    assert.match(bare.output, /npx @staves\/cli init/);
    assert.match(bare.output, /\.mcp\.json: no staves entry/);
    assert.match(bare.output, /\.codex\/config\.toml: no staves entry/);
    assert.match(bare.output, /\.gemini\/settings\.json: no staves entry/);
    assert.match(bare.output, /· Langfuse: not set in this shell \(optional\)/);

    // A machine carrying a registration written before the rename: `staves` is not on npm.
    const stale = { mcpServers: { staves: { command: "npx", args: ["-y", "staves", "mcp", "--dir", join(home, ".staves")] } } };
    await writeFile(join(home, ".mcp.json"), JSON.stringify(stale, null, 2));
    await mkdir(join(home, ".gemini"), { recursive: true });
    await writeFile(join(home, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { staves: { command: "npx", args: ["-y", "staves", "mcp", "--dir", join(home, ".staves")] } } }, null, 2));
    const userLevel = await run(["doctor"], project, elsewhere, inHome);
    assert.match(userLevel.output, /User-level registrations \(outside this project\)/);
    assert.match(userLevel.output, /package "staves" is not @staves\/cli \(that package does not exist on npm\)/);
    assert.match(userLevel.output, /--dir .* does not exist/);
    assert.ok(userLevel.output.includes(`edit ${join(home, ".mcp.json")} or rerun staves init/connect in the project that wrote it`), userLevel.output);
    assert.match(userLevel.output, /~\/\.claude\.json/);
    assert.match(userLevel.output, /~\/\.gemini\/settings\.json/);
    assert.equal(userLevel.code, 1, userLevel.output);
    assert.deepEqual(JSON.parse(await readFile(join(home, ".mcp.json"), "utf8")), stale, "doctor never edits a user-level file");

    assert.equal((await run(["init"], project, elsewhere, inHome)).code, 0);
    const config = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
    config.mcpServers.staves.args[1] = "@staves/cli@0.0.1";
    config.mcpServers.staves.env = { LANGFUSE_PUBLIC_KEY: "pk" };
    await writeFile(join(project, ".mcp.json"), JSON.stringify(config, null, 2));
    const skill = join(project, ".claude", "skills", "staves", "SKILL.md");
    await writeFile(skill, "my own rules");
    await writeFile(skill + ".generated.md", "the current text");
    const report = await run(["doctor"], project, elsewhere, inHome);
    assert.match(report.output, new RegExp(`pinned @staves/cli@0\\.0\\.1, current is ${VERSION.replace(/\./g, "\\.")} — run staves setup`));
    assert.match(report.output, /fix with: staves setup/);
    assert.match(report.output, /\.claude\/skills\/staves\/SKILL\.md is customised/);
    assert.match(report.output, /✓ \.agents\/skills\/staves\/SKILL\.md/);
    assert.match(report.output, /✓ CLAUDE\.md managed block/);
    assert.match(report.output, /✓ GEMINI\.md managed block/);
    assert.match(report.output, /✓ Langfuse keys configured for the MCP server in \.mcp\.json/);
    assert.doesNotMatch(report.output, /Register Staves in this project/);
    assert.equal(report.code, 1, "the user-level package npm does not serve is still a fault");
    await rm(join(home, ".mcp.json"));
    await rm(join(home, ".gemini", "settings.json"));
    assert.equal((await run(["doctor"], project, elsewhere, inHome)).code, 0, "a stale pin alone is a note, not a fault");
    // A CI gate can ask for the stricter reading; the lines themselves do not change.
    const gate = await run(["doctor", "--strict"], project, elsewhere, inHome);
    assert.equal(gate.code, 1, gate.output);
    assert.match(gate.output, new RegExp(`pinned @staves/cli@0\\.0\\.1, current is ${VERSION.replace(/\./g, "\\.")} — run staves setup`));
    assert.doesNotMatch(gate.output, /✗/, "--strict fails on notes without inventing faults");

    // --hosted without --connection is the legacy default credential, not a missing one.
    const hosted = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
    hosted.mcpServers.staves.args = ["-y", `@staves/cli@${VERSION}`, "mcp", "--hosted"];
    await writeFile(join(project, ".mcp.json"), JSON.stringify(hosted, null, 2));
    const unconnected = await run(["doctor"], project, elsewhere, inHome);
    assert.match(unconnected.output, /✗ credential for --connection \(the legacy default\) missing — run staves connect/);
    await mkdir(join(home, ".staves"), { recursive: true });
    await writeFile(join(home, ".staves", "credentials.json"), JSON.stringify({ url: "http://127.0.0.1:1", token: "sta_token", email: "person@example.com" }));
    const legacy = await run(["doctor"], project, elsewhere, inHome);
    assert.doesNotMatch(legacy.output, /credential for --connection/, "the legacy default credential counts");
    await writeFile(join(project, ".mcp.json"), JSON.stringify(config, null, 2));

    const outdated = await readFile(join(project, "AGENTS.md"), "utf8");
    await writeFile(join(project, "AGENTS.md"), outdated.replace("Detailed modelling guidance", "Read the Staves skill"));
    const drifted = await run(["doctor"], project, elsewhere, inHome);
    assert.match(drifted.output, /· AGENTS\.md managed block is from an older version — run staves setup/);

    // The keys belong to whichever client launches the server. Only Codex's file has them here.
    const unkeyed = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
    delete unkeyed.mcpServers.staves.env;
    await writeFile(join(project, ".mcp.json"), JSON.stringify(unkeyed, null, 2));
    const codexFile = join(project, ".codex", "config.toml");
    await writeFile(codexFile, (await readFile(codexFile, "utf8")).trimEnd()
      + '\n\n[mcp_servers.staves.env]\nLANGFUSE_PUBLIC_KEY = "pk-codex"\nLANGFUSE_SECRET_KEY = "sk-codex"\n');
    const codexKeys = await run(["doctor"], project, elsewhere, inHome);
    assert.match(codexKeys.output, /✓ Langfuse keys configured for the MCP server in \.codex\/config\.toml/, codexKeys.output);
    assert.doesNotMatch(codexKeys.output, /for the MCP server in \.mcp\.json/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a hosted accept or reject refuses before it opens anything, and never reaches the gateway", async t => {
  const root = await mkdtemp(join(tmpdir(), "staves-hosted-review-"));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(join(home, ".staves", "connections"), { recursive: true });
  await mkdir(project);
  let requests = 0;
  const gateway = createServer((_req, res) => { requests++; res.statusCode = 500; res.end("{}"); });
  await new Promise<void>(done => gateway.listen(0, "127.0.0.1", done));
  const address = gateway.address(); assert.ok(address && typeof address !== "string");
  t.after(async () => { await new Promise<void>(done => gateway.close(() => done())); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(home, ".staves", "connections", "connection-1.json"),
    JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token: "sta_" + "t".repeat(43), email: "person@example.com" }));

  const refusal = "staves: hosted boards are reviewed in the web app until the gateway accepts human review from the CLI\n";
  for (const command of ["accept", "reject"]) {
    const explicit = await run([command, "3", "--hosted", "--connection", "connection-1", ...(command === "reject" ? ["--reason", "no"] : [])], project, home, { STAVES_HOME_DIR: home });
    assert.equal(explicit.code, 1, explicit.output);
    assert.equal(explicit.output, refusal, explicit.output);
    // --connection alone means the same board, so it must get the same answer.
    const implied = await run([command, "3", "--connection", "connection-1"], project, home, { STAVES_HOME_DIR: home });
    assert.equal(implied.code, 1, implied.output);
    assert.equal(implied.output, refusal, implied.output);
  }
  assert.equal(requests, 0, "a refused review must not have asked the gateway anything");
  assert.equal(await readFile(join(project, ".staves", "connection-1.jsonl"), "utf8").catch(() => ""), "", "nor written a board");
});

test("an expected failure is one line, and --debug is what asks for the stack", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-errors-"));
  try {
    const usage = await run(["export"], root, root);
    assert.equal(usage.code, 1, usage.output);
    assert.match(usage.output, /^staves: usage: staves export <board>/);
    assert.doesNotMatch(usage.output, /at .+:\d+:\d+/);
    const missing = await run(["tool", "staves_brief", "--input"], root, root);
    assert.equal(missing.code, 1, missing.output);
    assert.match(missing.output, /^staves: --input requires a value\n$/);
    const debugged = await run(["export", "--debug"], root, root);
    assert.equal(debugged.code, 1, debugged.output);
    assert.match(debugged.output, /Error: usage: staves export <board>/);
    assert.match(debugged.output, /at .+:\d+:\d+/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a terminal with no browser gets the approval URL, and a denial never becomes a stack trace", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-headless-"));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(home); await mkdir(project);
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/cli/device") res.end(JSON.stringify({ device: "std_" + "a".repeat(43), approval: "stu_" + "b".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() }));
    else if (req.url === "/auth/cli/device/poll") res.end(JSON.stringify({ status: "denied" }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const denied = await run(["connect", "--url", `http://127.0.0.1:${address.port}`], project, home);
    assert.equal(denied.code, 1, denied.output);
    assert.match(denied.output, /Check code: /);
    assert.match(denied.output, /#approval=stu_/);
    assert.match(denied.output, /Open this URL on any signed-in browser, or set STAVES_TOKEN \/ use --token-stdin for non-interactive use\./);
    assert.match(denied.output, /^staves: Connection denied in the browser\. No access was granted\.$/m);
    assert.doesNotMatch(denied.output, /at .+:\d+:\d+/);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

test("a file doctor cannot read is one line, not the end of the report", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-unreadable-"));
  const home = join(root, "home"), elsewhere = join(root, "elsewhere"), project = join(root, "project");
  await mkdir(home); await mkdir(elsewhere); await mkdir(project);
  const inHome = { STAVES_HOME_DIR: home };
  try {
    await mkdir(join(home, ".claude.json"));  // a directory where the config should be
    await writeFile(join(project, ".mcp.json"), '{"mcpServers": {"staves": {"command": "npx", "args": ["-y"');
    const broken = await run(["doctor"], project, elsewhere, inHome);
    assert.match(broken.output, /✗ \.mcp\.json: cannot be read \(invalid JSON\)/);
    assert.match(broken.output, /✗ ~\/\.claude\.json: cannot be read \([A-Z]+\)/);
    assert.match(broken.output, /✗ ~\/\.claude\.json projects\[.*\]: cannot be read \([A-Z]+\)/);
    assert.match(broken.output, /\nSkills and instructions\n/, "the report continues past a file it cannot read");
    assert.match(broken.output, /\nBoards\n/);
    assert.equal(broken.code, 1, broken.output);

    await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { staves: { command: "npx" } } }));
    const argless = await run(["doctor"], project, elsewhere, inHome);
    assert.match(argless.output, /✗ \.mcp\.json: the staves entry has no args list/);
    assert.equal(argless.code, 1, argless.output);

    // A developer pointed at their own checkout has not misspelled the published package.
    await rm(join(home, ".claude.json"), { recursive: true });
    assert.equal((await run(["init"], project, elsewhere, inHome)).code, 0);
    for (const spec of ["file:../staves", "link:/opt/staves", join(root, "checkout", "dist", "cli.js")]) {
      await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { staves: { command: "npx", args: ["-y", spec, "mcp", "--dir", project] } } }));
      const local = await run(["doctor"], project, elsewhere, inHome);
      assert.ok(local.output.includes(`· .mcp.json: local development registration (${spec}) — not the published package`), local.output);
      assert.doesNotMatch(local.output, /is not @staves\/cli/, spec);
      assert.doesNotMatch(local.output, /pinned/, spec);
      assert.doesNotMatch(local.output, /fix with: staves setup/, spec);
      assert.equal(local.code, 0, local.output);
    }
    // A registry name that is not ours is still the error it always was — a dot in the name, or an
    // extension-shaped one, does not make it a checkout.
    for (const [spec, name] of [["staves@0.9.0", "staves"], ["p5.js", "p5.js"], ["foo.mjs", "foo.mjs"]]) {
      await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { staves: { command: "npx", args: ["-y", spec, "mcp", "--dir", project] } } }));
      const renamed = await run(["doctor"], project, elsewhere, inHome);
      assert.ok(renamed.output.includes(`✗ package "${name}" is not @staves/cli (that package does not exist on npm)`), renamed.output);
      assert.doesNotMatch(renamed.output, /local development registration/, spec);
      assert.equal(renamed.code, 1, renamed.output);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("help names the flags a headless or failing run needs", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-help-"));
  try {
    const help = await run(["help"], root, root);
    assert.equal(help.code, 0, help.output);
    assert.match(help.output, /create \.staves\/, register the MCP server for Claude Code, Cursor and Codex, install the skill, add a managed block to CLAUDE\.md and AGENTS\.md/);
    assert.match(help.output, /--no-browser/);
    assert.match(help.output, /--debug/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a connect that gets nowhere still says where the guide is", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-connect-guide-"));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(home); await mkdir(project);
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader("content-type", "application/json");
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "That connection token is not valid." }));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const guide = `Guide: ${url}/docs/connect/`;
  try {
    // The account refused the token.
    const refused = await run(["connect", "--url", url, "--token", "sta_" + "z".repeat(43)], project, home);
    assert.equal(refused.code, 1, refused.output);
    assert.match(refused.output, /staves: That connection token is not valid\./);
    assert.ok(refused.output.includes(guide), refused.output);

    // Nothing to exchange in the first place.
    const none = await run(["connect", "--url", url], project, home, { STAVES_TOKEN: " " });
    assert.equal(none.code, 1, none.output);
    assert.match(none.output, /staves: no token given\./);
    assert.ok(none.output.includes(guide), none.output);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
});

/** The block the CLI wrote before it carried markers, exactly as it shipped. */
const OLDEST_BLOCK = `
## staves

This project keeps boards of its work in \`.staves/\`. A board shows jobs on tracks (people, agents, systems, outside parties) with the handoffs between them.
Say "run staves" and the agent describes the project as work and draws it; "resume staves" picks the board back up and re-describes what the code changed under. Slash commands: /mcp__staves__describe, /mcp__staves__resume, /mcp__staves__review.
Before working on a system that has a board, read staves_brief first. Where you cannot tell something from the code, use staves_ask rather than guessing.
`;

test("setup replaces an unmarked block from before the markers existed, and keeps what is not ours", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-legacy-block-"));
  try {
    assert.equal((await run(["init"], root, root)).code, 0);
    await writeFile(join(root, "CLAUDE.md"), `# My project\n\nMy own notes stay.\n${OLDEST_BLOCK}\nAnd these too.\n`);
    const refreshed = await run(["setup"], root, root);
    assert.equal(refreshed.code, 0, refreshed.output);
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    assert.doesNotMatch(claude, /Slash commands: \/mcp__staves__describe/, claude);
    assert.equal(claude.split("<!-- staves:generated:start -->").length - 1, 1, claude);
    assert.ok(claude.includes("Guide: https://staves.io/docs/connect/"), claude);
    assert.ok(claude.startsWith("# My project\n\nMy own notes stay.\n"), claude);
    assert.ok(claude.trimEnd().endsWith("And these too."), claude);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doctor flags a managed block that still names a connection, and a project config that lost its reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "staves-block-connection-"));
  const home = join(root, "home"), project = join(root, "project");
  await mkdir(join(home, ".staves", "connections"), { recursive: true }); await mkdir(join(project, ".staves"), { recursive: true });
  try {
    const connection = "abc-123";
    const args = ["-y", `@staves/cli@${VERSION}`, "mcp", "--hosted", "--connection", connection];
    await writeFile(join(home, ".staves", "connections", `${connection}.json`), JSON.stringify({ url: "http://127.0.0.1:9", token: "sta_" + "t".repeat(43), email: "a@b.c" }));
    await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { staves: { command: "npx", args } } }));
    await writeFile(join(project, ".staves", "config.json"), JSON.stringify({ board: "project" }));
    const old = `<!-- staves:generated:start -->\n## Staves\n\nUse immediately: \`npx -y @staves/cli tool staves_interview --hosted --connection ${connection} --input '{}'\`.\n<!-- staves:generated:end -->\n`;
    for (const name of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) await writeFile(join(project, name), `# Our rules\n\nKeep these.\n\n${old}`);
    const before = await run(["doctor"], project, home);
    assert.equal(before.code, 1, before.output);
    assert.match(before.output, /✗ \.staves\/config\.json has no connection reference/);
    assert.match(before.output, /CLAUDE\.md managed block names a connection; it belongs in \.staves\/config\.json/);
    const setup = await run(["setup"], project, home);
    assert.equal(setup.code, 0, setup.output);
    const config = JSON.parse(await readFile(join(project, ".staves", "config.json"), "utf8"));
    assert.deepEqual(config, { board: "project", connection }, "setup records the reference and keeps the rest of the config");
    for (const name of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
      const text = await readFile(join(project, name), "utf8");
      assert.ok(text.startsWith("# Our rules\n\nKeep these.\n"), name);
      assert.ok(!text.includes(connection), name);
    }
    const after = await run(["doctor"], project, home);
    assert.match(after.output, /✓ \.staves\/config\.json holds this project's connection reference/);
    assert.doesNotMatch(after.output, /names a connection/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
