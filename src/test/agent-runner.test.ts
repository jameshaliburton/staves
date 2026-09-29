import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store.js";
import { saveAssessmentRequest, getAssessment, updateAssessmentDelivery } from "../assessment-store.js";
import { runAgentListener, agentRunnerPrompt, executeLocalAgent, detectAgents } from "../agent-runner.js";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const project = await mkdtemp(join(tmpdir(), "staves-listener-test-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const store = new Store(join(project, ".staves"));
  await store.append("work", [{ t: "board", id: "work", title: "Review" }, { t: "track", track: { id: "p", name: "Person", kind: "person" } }, { t: "job", job: { id: "a", name: "Review evidence", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }], "J");
  return { store, project, board: "work", agent: "codex" as const, once: true, boardUrl: "http://localhost:5178/b/local?board=work" };
}
const result = { repositoryAccess: "available", jobs: [{ jobId: "a", conclusion: "conditional", reason: "Needs source review", references: [{ kind: "file", ref: "src/review.ts:1" }] }], limitations: ["Static review only"] };

test("listener claims assess, returns pinned reports, leaves discussion and implementation queued", async t => {
  const options = await setup(t), controller = new AbortController();
  const assess = await saveAssessmentRequest(options.store, "work", { rationale: "Assess" }, "J");
  const discuss = await saveAssessmentRequest(options.store, "work", { intent: "discuss", rationale: "Why this gate?" }, "J");
  const implement = await saveAssessmentRequest(options.store, "work", { intent: "implement" }, "J");
  const status: string[] = [];
  let calls = 0, polls = 0;
  await runAgentListener({ ...options, once: false, signal: controller.signal, onStatus: message => status.push(message) }, {
    actor: "test-listener", sleep: async () => { if (++polls === 2) controller.abort(); },
    execute: async invocation => { calls++; assert.equal(invocation.project, await realpath(options.project)); assert.match(invocation.prompt, /Do not edit files/); return result; },
  });
  assert.equal(calls, 1);
  const saved = await getAssessment(options.store, "work", assess.id);
  assert.equal(saved.delivery.status, "completed");
  assert.equal(saved.delivery.actor, "test-listener");
  assert.equal(saved.returns.length, 1);
  assert.equal(saved.request.source.revision, assess.source.revision);
  assert.deepEqual(saved.returns[0].result.tests, []);
  assert.match(saved.returns[0].result.limitations.join(" "), /independently verified/);
  for (const request of [discuss, implement]) assert.equal((await getAssessment(options.store, "work", request.id)).delivery.status, "queued");
  // Said once across repeated polls, and only about the conversation.
  assert.deepEqual(status.filter(message => message.includes(discuss.id)), [`Request ${discuss.id} is a conversation; it needs your interactive agent with Staves MCP. Left queued.`]);
  // An implement request is skipped, but silently skipping it looks the same as losing it.
  assert.deepEqual(status.filter(message => message.includes(implement.id)), [`Request ${implement.id} asks for implementation; this listener never changes code. Left queued.`]);
  // A person watching the listener is told where the answer landed, not only that it did.
  assert.deepEqual(status.filter(message => message.startsWith("Returned ")), [`Returned ${assess.id} to Staves. → http://localhost:5178/b/local?board=work`]);
});

test("a failed request says where to look at what failed", async t => {
  const options = await setup(t);
  const request = await saveAssessmentRequest(options.store, "work", { rationale: "Assess" }, "J");
  const status: string[] = [];
  await runAgentListener({ ...options, onStatus: message => status.push(message) }, { execute: async () => { throw new Error("no agent here"); } });
  assert.deepEqual(status.filter(message => message.startsWith("Failed ")).map(line => line.endsWith(" → http://localhost:5178/b/local?board=work")), [true], status.join("\n"));
  assert.equal((await getAssessment(options.store, "work", request.id)).delivery.status, "failed");
  // Without a base there is nothing to point at, and the line says only what it knows.
  const quiet: string[] = [];
  const second = await saveAssessmentRequest(options.store, "work", { rationale: "Assess again" }, "J");
  await runAgentListener({ ...options, boardUrl: undefined, onStatus: message => quiet.push(message) }, { execute: async () => { throw new Error("no agent here"); } });
  assert.ok(quiet.some(line => line === `Failed ${second.id}: Local agent did not return a valid report. Check CLI installation, sign-in, permissions and account limits. Request is retained; resume interactively or queue a new request.`), quiet.join("\n"));
});

test("a report outside the requested job scope fails the request", async t => {
  const options = await setup(t);
  await options.store.append("work", [{ t: "job", job: { id: "b", name: "Send the answer", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } }], "J");
  const request = await saveAssessmentRequest(options.store, "work", { jobIds: ["a"] }, "J");
  await runAgentListener(options, { execute: async () => ({ ...result, jobs: [{ ...result.jobs[0], jobId: "b" }] }) });
  const saved = await getAssessment(options.store, "work", request.id);
  assert.equal(saved.delivery.status, "failed");
  assert.equal(saved.delivery.note, "Agent reported jobs outside the request scope.");
  assert.equal(saved.returns.length, 0);
});

test("a board-scoped report about a job that is not on the board fails the request", async t => {
  const options = await setup(t);
  const request = await saveAssessmentRequest(options.store, "work", {}, "J");
  await runAgentListener(options, { execute: async () => ({ ...result, jobs: [{ ...result.jobs[0], jobId: "invented" }] }) });
  const saved = await getAssessment(options.store, "work", request.id);
  assert.equal(saved.delivery.status, "failed");
  assert.equal(saved.delivery.note, "Agent reported jobs outside the request scope.");
  assert.equal(saved.returns.length, 0);
});

test("agent detection reads the injected PATH and the bundled codex locations", async t => {
  const home = await mkdtemp(join(tmpdir(), "staves-detect-home-"));
  const bin = await mkdtemp(join(tmpdir(), "staves-detect-path-"));
  // An empty stand-in for /Applications, so a Codex installed on this machine cannot answer for the test.
  const applications = await mkdtemp(join(tmpdir(), "staves-detect-apps-"));
  t.after(() => Promise.all([home, bin, applications].map(directory => rm(directory, { recursive: true, force: true }))));
  const { mkdir, writeFile, chmod } = await import("node:fs/promises");
  await writeFile(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
  await chmod(join(bin, "claude"), 0o755);
  await writeFile(join(bin, "codex"), "#!/bin/sh\n", { mode: 0o644 });
  await chmod(join(bin, "codex"), 0o644);
  assert.deepEqual(await detectAgents({ env: { PATH: bin, HOME: home }, platform: "darwin", applications }), [{ agent: "claude", bin: join(bin, "claude") }]);
  await mkdir(join(home, ".codex", "bin"), { recursive: true });
  await writeFile(join(home, ".codex", "bin", "codex"), "#!/bin/sh\n", { mode: 0o755 });
  await chmod(join(home, ".codex", "bin", "codex"), 0o755);
  assert.deepEqual(await detectAgents({ env: { PATH: bin, HOME: home }, platform: "darwin", applications }), [
    { agent: "claude", bin: join(bin, "claude") },
    { agent: "codex", bin: join(home, ".codex", "bin", "codex") },
  ]);
  // The bundled locations are a macOS convention; elsewhere only PATH counts.
  assert.deepEqual(await detectAgents({ env: { PATH: bin, HOME: home }, platform: "linux", applications }), [{ agent: "claude", bin: join(bin, "claude") }]);
});

test("failed execution persists failure and never retries on later polls", async t => {
  const options = await setup(t), controller = new AbortController();
  const request = await saveAssessmentRequest(options.store, "work", {}, "J");
  let calls = 0, polls = 0;
  await runAgentListener({ ...options, once: false, signal: controller.signal }, { execute: async () => { calls++; throw new Error("secret provider payload"); }, sleep: async () => { if (++polls === 2) controller.abort(); } });
  assert.equal(calls, 1);
  const saved = await getAssessment(options.store, "work", request.id);
  assert.equal(saved.delivery.status, "failed");
  assert.doesNotMatch(saved.delivery.note ?? "", /secret provider/);
});

test("claimed work belongs to its existing agent and cannot run twice", async t => {
  const options = await setup(t);
  const request = await saveAssessmentRequest(options.store, "work", {}, "J");
  await updateAssessmentDelivery(options.store, "work", request.id, { status: "claimed" }, "another-agent");
  await runAgentListener(options, { execute: async () => { assert.fail("must not execute claimed work"); } });
  assert.equal((await getAssessment(options.store, "work", request.id)).delivery.actor, "another-agent");
});

test("implementation claims are rejected and packet stays data", async t => {
  const options = await setup(t);
  const request = await saveAssessmentRequest(options.store, "work", { rationale: "$(touch injected)" }, "J");
  assert.match(agentRunnerPrompt(request), /untrusted design data/);
  await runAgentListener(options, { execute: async () => ({ ...result, jobs: [{ ...result.jobs[0], conclusion: "reported-implemented" }] }) });
  assert.equal((await getAssessment(options.store, "work", request.id)).delivery.status, "failed");
});

test("missing executable fails safely without a real model call", async t => {
  const options = await setup(t);
  await assert.rejects(executeLocalAgent({ agent: "codex", agentBin: join(options.project, "missing-cli"), project: options.project, prompt: "test", timeoutMs: 2000 }), /Install its CLI and sign in/);
});

test("project and board lock rejects concurrent independent listeners", async t => {
  const options = await setup(t);
  await saveAssessmentRequest(options.store, "work", {}, "J");
  let finish!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const first = runAgentListener(options, { execute: async () => { started(); await new Promise<void>(resolve => { finish = resolve; }); return result; } });
  await ready;
  await assert.rejects(runAgentListener({ ...options, store: new Store(options.store.dir) }, { execute: async () => result }), /already running|Another listener/);
  finish(); await first;
  // Graceful completion released the OS-local lock.
  await runAgentListener(options, { execute: async () => { assert.fail("completed work must not rerun"); } });
});

test("stale process lock is recovered without reusing the dead actor", async t => {
  const { createHash } = await import("node:crypto");
  const { writeFile } = await import("node:fs/promises");
  const options = await setup(t);
  const project = await realpath(options.project);
  const key = createHash("sha256").update(`${project}\0work`).digest("hex");
  const lock = join(tmpdir(), `staves-listener-${key}.lock`);
  await writeFile(lock, "2147483647", { mode: 0o600 });
  t.after(() => rm(lock, { force: true }));
  const request = await saveAssessmentRequest(options.store, "work", {}, "J");
  await runAgentListener(options, { execute: async () => result });
  assert.equal((await getAssessment(options.store, "work", request.id)).delivery.status, "completed");
});
