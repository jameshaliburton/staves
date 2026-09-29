import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostedAuthError, credentialsPath, exchange, forgetCredentials, hostedStore, readCredentials, writeCredentials } from "../hosted.js";

const session = (over: Record<string, unknown> = {}) => ({
  email: "person@example.com", user_id: "user-1", boards: ["lookup"],
  permission: "contribute", createLimit: 1, createdCount: 0, ...over,
});

test("the CLI receives a grant, never account database credentials", async () => {
  const calls: unknown[] = [];
  const stub: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), redirect: init?.redirect });
    return Response.json(session({ access_token: "must-not-be-used", supabase_url: "https://private.invalid" }));
  };
  const result = await exchange("https://staves.io/", "sta_token", stub);
  assert.deepEqual(result, session());
  assert.deepEqual(calls, [{ url: "https://staves.io/auth/cli/exchange", body: { token: "sta_token" }, redirect: "error" }]);
});

test("connection validation reports refused, unavailable and obsolete gateways", async () => {
  await assert.rejects(exchange("https://staves.io", "bad", async () => Response.json({ error: "This token is not valid." }, { status: 401 })), /not valid/);
  await assert.rejects(exchange("https://nowhere.invalid", "bad", async () => { throw new Error("network"); }), /nowhere.invalid/);
  await assert.rejects(exchange("https://staves.io", "old", async () => Response.json({ access_token: "old-account-jwt" })), /usable connection/);
  let called = false;
  await assert.rejects(exchange("http://remote.invalid", "secret", async () => { called = true; return Response.json(session()); }), /HTTPS/);
  assert.equal(called, false);
});

test("temporary handoffs redeem once into a token without returning account sessions", async () => {
  const { pairHandoff } = await import("../hosted.js");
  const secret = "sta_" + "x".repeat(43);
  let used = false;
  const stub: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://staves.io/auth/cli/pair");
    assert.deepEqual(JSON.parse(String(init?.body)), { code: "sth_once" });
    if (used) return Response.json({ error: "Connection code expired or already used." }, { status: 401 });
    used = true; return Response.json({ token: secret });
  };
  assert.equal(await pairHandoff("https://staves.io", "sth_once", stub), secret);
  await assert.rejects(pairHandoff("https://staves.io", "sth_once", stub), /already used/);
});

test("every board operation uses the gateway token and revocation applies on the next call", async () => {
  const calls: string[] = [];
  let revoked = false;
  const stub: typeof fetch = async (url, init) => {
    const address = String(url); calls.push(address);
    if (address.endsWith("/auth/cli/exchange")) return Response.json(session());
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sta_scoped");
    assert.ok(address.startsWith("https://staves.io/cli-api/"));
    if (revoked) return Response.json({ error: "This token was revoked." }, { status: 401 });
    if (address.endsWith("/boards")) return Response.json({ boards: [{ name: "lookup", updated_at: "2026-09-14" }] });
    return Response.json({ entries: [], revision: -1 });
  };
  const store = await hostedStore({ url: "https://staves.io", token: "sta_scoped", email: "p@example.com" }, stub);
  assert.deepEqual(await store.list(), ["lookup"]);
  assert.equal((await store.board("lookup")).id, "lookup");
  assert.equal(await store.touchedAt("lookup"), "2026-09-14");
  revoked = true;
  await assert.rejects(store.list(), /revoked/);
  await assert.rejects(store.board("lookup"), /revoked/);
  assert.equal(calls.filter(address => address.endsWith("/auth/cli/exchange")).length, 1);
});

test("board writes preserve revision checks and server errors without retrying", async () => {
  const writes: unknown[] = [];
  const stub: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/auth/cli/exchange")) return Response.json(session());
    if (init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ error: "Workflow revision conflict" }, { status: 409 });
    }
    return Response.json({ entries: [], revision: -1 });
  };
  const store = await hostedStore({ url: "https://staves.io", token: "sta_scoped", email: "p@example.com" }, stub);
  await assert.rejects(store.append("lookup", [{ t: "board", id: "lookup", title: "Lookup" }], "agent"), /changed elsewhere/);
  assert.equal(writes.length, 1);
  assert.equal((writes[0] as { revision: number }).revision, -1);
  assert.equal((writes[0] as { mode: string }).mode, "append");
  await assert.rejects(store.deleteBoard("lookup"), /cannot delete/);
  await assert.rejects(store.board("../escape"), /Invalid board/);
});

test("the stored credential is the token alone, readable only by its owner", async t => {
  const realHome = process.env.HOME;
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "staves-home-"));
  process.env.HOME = sandbox;
  assert.ok(credentialsPath().startsWith(sandbox), "the test must not touch the real home directory");
  try {
    await t.test("round-trips, and never writes a session down", async () => {
      assert.equal(await readCredentials(), null);
      await writeCredentials({ url: "https://staves.io", token: "sta_token", email: "person@example.com" });
      assert.deepEqual(await readCredentials(), { url: "https://staves.io", token: "sta_token", email: "person@example.com" });
      const written = await fs.readFile(credentialsPath(), "utf8");
      assert.equal(written.includes("access_token"), false);
      assert.equal((await fs.stat(credentialsPath())).mode & 0o077, 0, "no group or world access");
    });
    await t.test("treats a damaged file as not connected rather than crashing", async () => {
      await fs.writeFile(credentialsPath(), "{ not json");
      assert.equal(await readCredentials(), null);
      await fs.writeFile(credentialsPath(), JSON.stringify({ url: "https://staves.io" }));
      assert.equal(await readCredentials(), null, "a file without a token is not a connection");
    });
    await t.test("disconnecting removes it and is safe to repeat", async () => {
      await writeCredentials({ url: "https://staves.io", token: "sta_token", email: "p@example.com" });
      assert.equal(await forgetCredentials(), true);
      assert.equal(await readCredentials(), null);
      assert.equal(await forgetCredentials(), false);
    });
  } finally {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test("the version written into people's MCP config is the one that gets published", async () => {
  // `staves init` and `staves connect` pin `staves@<VERSION>` in the config they write. If VERSION
  // and package.json disagree, npx resolves a version that was never published and the agent breaks
  // on someone else's machine, long after the mistake was made.
  const { VERSION } = await import("../version.js");
  const root = new URL("../../", import.meta.url);
  const pkg = JSON.parse(await fs.readFile(new URL("package.json", root), "utf8"));
  assert.equal(VERSION, pkg.version, "run `npm run build` — it regenerates src/version.ts from package.json");
});

test("the board link an agent is given actually opens a board", async () => {
  // The editor is served at the site root; /workspace lists boards. Handing an agent the list URL
  // sends every person it tells to the wrong page, and it looks like the board failed to draw.
  const cli = await fs.readFile(new URL("../../src/cli.ts", import.meta.url), "utf8");
  assert.match(cli, /serveHostedMcp\(await hostedStore\(credentials\), name, credentials\.url\)/);
  assert.doesNotMatch(cli, /serveHostedMcp\([^)]*\/workspace`\)/);
});

test("gateway scope refusals cover metadata and writes, without local allowlist assumptions", async () => {
  const stub: typeof fetch = async (url) => {
    if (String(url).endsWith("/auth/cli/exchange")) return Response.json(session({ boards: [] }));
    if (String(url).endsWith("/boards")) return Response.json({ boards: [] });
    return Response.json({ error: "This connection cannot access that board." }, { status: 403 });
  };
  const store = await hostedStore({ url: "https://staves.io", token: "sta_scoped", email: "p@example.com" }, stub);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.board("payroll"), /cannot access/);
  await assert.rejects(store.append("payroll", [{ t: "board", id: "payroll", title: "Payroll" }], "agent"), /cannot access/);
});

test("connection references cannot escape credential storage", () => {
  assert.match(credentialsPath("project-one"), /connections[/\\]project-one.json$/);
  assert.notEqual(credentialsPath("project-one"), credentialsPath("project-two"));
  assert.throws(() => credentialsPath("../secret"), /Invalid connection/);
});

test("the Langfuse hand-off posts the keys once with the connection token and returns only what the gateway stored", async () => {
  const { shareRuns, GatewayStore } = await import("../hosted.js");
  const keys = { publicKey: "pk-lf-abcd1234", secretKey: "sk-lf-secret-9999" };
  const calls: { url: string; method?: string; auth?: string; body?: unknown }[] = [];
  let answer: () => Response = () => Response.json({ projectId: "project-1", projectName: "Vendor onboarding", boards: ["flow"] });
  const stub: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method, auth: headers.get("authorization") ?? undefined, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return answer();
  };
  const credentials = { url: "https://staves.io", token: "sta_token", email: "person@example.com" };
  assert.deepEqual(await shareRuns(credentials, { ...keys, baseUrl: "https://us.cloud.langfuse.com" }, stub), { projectId: "project-1", projectName: "Vendor onboarding", boards: ["flow"] });
  assert.deepEqual(calls, [{ url: "https://staves.io/cli-api/langfuse", method: "POST", auth: "Bearer sta_token", body: { ...keys, baseUrl: "https://us.cloud.langfuse.com" } }]);
  calls.length = 0;
  await shareRuns(credentials, keys, stub);
  assert.equal("baseUrl" in (calls[0].body as object), false, "no base URL is sent when none was set, so the gateway's default applies");

  answer = () => Response.json({ error: "Langfuse did not accept these keys." }, { status: 400 });
  await assert.rejects(shareRuns(credentials, keys, stub), (error: Error) => error instanceof HostedAuthError && /did not accept/.test(error.message) && !error.message.includes(keys.secretKey));
  answer = () => Response.json({ projectId: 42 });
  await assert.rejects(shareRuns(credentials, keys, stub), /did not return/);

  calls.length = 0;
  answer = () => Response.json({ projectId: "project-1" });
  const store = new GatewayStore(credentials, "user-1", stub);
  assert.equal(await store.runsProject(), "project-1");
  assert.deepEqual(calls.map(call => [call.url, call.method ?? "GET", call.auth]), [["https://staves.io/cli-api/langfuse", "GET", "Bearer sta_token"]]);
  answer = () => Response.json({ projectId: null });
  assert.equal(await store.runsProject(), null);
  answer = () => Response.json({});
  await assert.rejects(store.runsProject(), /did not return/);
});

test("the coding agent's Langfuse keys are found in the shell first, then in this project's registrations", async () => {
  const { agentLangfuseKeys } = await import("../registration.js");
  const shell = { LANGFUSE_PUBLIC_KEY: "pk-lf-shell", LANGFUSE_SECRET_KEY: "sk-lf-shell", LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com" };
  const registered = (label: string, env: unknown) => ({ label, file: label, state: "present" as const, serverArgs: ["mcp"], env });
  const mcp = registered(".mcp.json", { LANGFUSE_PUBLIC_KEY: "pk-lf-mcp", LANGFUSE_SECRET_KEY: "sk-lf-mcp" });
  assert.deepEqual(agentLangfuseKeys(shell, [mcp]), { source: "this shell", keys: { publicKey: "pk-lf-shell", secretKey: "sk-lf-shell", baseUrl: "https://us.cloud.langfuse.com" } });
  assert.deepEqual(agentLangfuseKeys({}, [registered(".cursor/mcp.json", {}), mcp]), { source: ".mcp.json", keys: { publicKey: "pk-lf-mcp", secretKey: "sk-lf-mcp" } });
  // Half a pair, an unexpanded reference or an empty value is not a key anyone can use.
  assert.equal(agentLangfuseKeys({ LANGFUSE_PUBLIC_KEY: "pk-lf-shell" }, []), undefined);
  assert.equal(agentLangfuseKeys({}, [registered(".mcp.json", { LANGFUSE_PUBLIC_KEY: "${LANGFUSE_PUBLIC_KEY}", LANGFUSE_SECRET_KEY: "${LANGFUSE_SECRET_KEY}" })]), undefined);
  assert.equal(agentLangfuseKeys({ LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" }, [registered(".mcp.json", "not a table")]), undefined);
  assert.deepEqual(agentLangfuseKeys({}, [registered(".codex/config.toml", { LANGFUSE_PUBLIC_KEY: " pk-lf-codex ", LANGFUSE_SECRET_KEY: "sk-lf-codex", LANGFUSE_BASE_URL: "" })]), { source: ".codex/config.toml", keys: { publicKey: "pk-lf-codex", secretKey: "sk-lf-codex" } });
});

test("the agent's Langfuse server comes from LANGFUSE_BASE_URL, then LANGFUSE_HOST, then Langfuse Cloud, and the question names it", async () => {
  const { agentLangfuseKeys, shareRunsQuestion } = await import("../registration.js");
  const pair = { LANGFUSE_PUBLIC_KEY: "pk-lf-a", LANGFUSE_SECRET_KEY: "sk-lf-b" };
  const registered = (env: unknown) => ({ label: ".mcp.json", file: ".mcp.json", state: "present" as const, serverArgs: ["mcp"], env });
  assert.equal(agentLangfuseKeys({ ...pair, LANGFUSE_HOST: "https://eu.cloud.langfuse.com" }, [])?.keys.baseUrl, "https://eu.cloud.langfuse.com");
  assert.equal(agentLangfuseKeys({ ...pair, LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com", LANGFUSE_HOST: "https://eu.cloud.langfuse.com" }, [])?.keys.baseUrl, "https://us.cloud.langfuse.com");
  assert.equal(agentLangfuseKeys({ ...pair, LANGFUSE_BASE_URL: "", LANGFUSE_HOST: "https://eu.cloud.langfuse.com" }, [])?.keys.baseUrl, "https://eu.cloud.langfuse.com");
  assert.deepEqual(agentLangfuseKeys({}, [registered({ ...pair, LANGFUSE_HOST: "https://langfuse.example.com" })]), { source: ".mcp.json", keys: { publicKey: "pk-lf-a", secretKey: "sk-lf-b", baseUrl: "https://langfuse.example.com" } });
  assert.equal(agentLangfuseKeys({}, [registered({ ...pair, LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com", LANGFUSE_HOST: "https://langfuse.example.com" })])?.keys.baseUrl, "https://us.cloud.langfuse.com");
  assert.equal(shareRunsQuestion("https://staves.io", { publicKey: "pk-lf-a", secretKey: "sk-lf-b", baseUrl: "https://eu.cloud.langfuse.com" }), "Show this project's runs on staves.io using the Langfuse keys your coding agent already has (eu.cloud.langfuse.com)? [Y/n] ");
  assert.equal(shareRunsQuestion("https://staves.io", { publicKey: "pk-lf-a", secretKey: "sk-lf-b" }), "Show this project's runs on staves.io using the Langfuse keys your coding agent already has (cloud.langfuse.com)? [Y/n] ");
  assert.doesNotMatch(shareRunsQuestion("https://staves.io", { publicKey: "pk-lf-a", secretKey: "sk-lf-b" }), /pk-lf|sk-lf/);
});
