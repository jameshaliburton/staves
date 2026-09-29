import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Store } from "../store.js";
import { saveAssessmentRequest, saveAssessmentReturn, updateAssessmentDelivery } from "../assessment-store.js";
import { decideProposal, listReview, resolveBoard, resolveListen, formatReview, sanitize } from "../review.js";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const project = await mkdtemp(join(tmpdir(), "staves-review-test-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const store = new Store(join(project, ".staves"));
  await store.append("work", [
    { t: "board", id: "work", title: "Review" },
    { t: "track", track: { id: "p", name: "Person", kind: "person" } },
    { t: "job", job: { id: "a", name: "Review evidence", track: "p", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed" } },
  ], "human:j");
  return { store, project };
}

test("listReview lists open proposals with a readable summary and skips decided ones", async t => {
  const { store } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  await store.append("work", [{ t: "track", track: { id: "s", name: "Ledger", kind: "system" } }], "agent:claude", true);
  const before = await listReview(store, "work");
  assert.equal(before.proposals.length, 2);
  assert.deepEqual(before.proposals.map(p => p.by), ["agent:claude", "agent:claude"]);
  assert.match(before.proposals[0].summary, /Review evidence/);
  assert.match(before.proposals[1].summary, /Ledger/);
  assert.ok(before.proposals[0].at);

  await decideProposal(store, "work", before.proposals[0].seq, "accept", "human:j");
  const after = await listReview(store, "work");
  assert.deepEqual(after.proposals.map(p => p.seq), [before.proposals[1].seq]);
  assert.equal((await store.board("work")).jobs.find(job => job.id === "a")?.outcome, "Evidence read");
});

test("listReview reports each request with its delivery status, note and number of returns", async t => {
  const { store } = await setup(t);
  const assess = await saveAssessmentRequest(store, "work", { rationale: "Assess" }, "human:j");
  const discuss = await saveAssessmentRequest(store, "work", { intent: "discuss", rationale: "Why?" }, "human:j");
  await updateAssessmentDelivery(store, "work", assess.id, { status: "claimed" }, "listener");
  await updateAssessmentDelivery(store, "work", assess.id, { status: "failed", note: "Agent reported jobs outside the request scope." }, "listener");
  await saveAssessmentReturn(store, "work", assess.id, {
    requestId: assess.id,
    repositoryAccess: "available",
    jobs: [{ jobId: "a", conclusion: "conditional", reason: "Needs source review", references: [{ kind: "file", ref: "src/review.ts:1" }] }],
    limitations: ["Static review only"],
  }, "agent:claude");

  const { requests } = await listReview(store, "work");
  assert.equal(requests.length, 2);
  const first = requests.find(request => request.id === assess.id)!;
  assert.equal(first.intent, "assess");
  assert.equal(first.status, "failed");
  assert.equal(first.note, "Agent reported jobs outside the request scope.");
  assert.equal(first.returns, 1);
  assert.equal(first.revision, assess.source.revision);
  const second = requests.find(request => request.id === discuss.id)!;
  assert.equal(second.intent, "discuss");
  assert.equal(second.status, "queued");
  assert.equal(second.returns, 0);
  assert.equal(second.note, undefined);
});

test("listReview refuses a board that does not exist", async t => {
  const { store } = await setup(t);
  await assert.rejects(() => listReview(store, "typo"), /No board named "typo"/);
});

test("decideProposal refuses a non-human actor, an unknown seq and a rejection with no reason", async t => {
  const { store } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const [proposal] = (await listReview(store, "work")).proposals;
  await assert.rejects(() => decideProposal(store, "work", proposal.seq, "accept", "agent:claude"), /Only a person/);
  await assert.rejects(() => decideProposal(store, "work", 999, "accept", "human:j"), /No open proposal at 999/);
  await assert.rejects(() => decideProposal(store, "work", proposal.seq, "reject", "human:j"), /reason/);
  assert.equal((await listReview(store, "work")).proposals.length, 1);
});

test("decideProposal records a rejection with its reason and leaves the board unchanged", async t => {
  const { store } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const [proposal] = (await listReview(store, "work")).proposals;
  await decideProposal(store, "work", proposal.seq, "reject", "human:j", "  The gate owner is wrong.  ");
  assert.deepEqual((await listReview(store, "work")).proposals, []);
  assert.equal((await store.board("work")).jobs.find(job => job.id === "a")?.outcome, undefined);
  const decision = (await store.entries("work")).at(-1)!;
  assert.equal(decision.by, "human:j");
  assert.deepEqual(decision.op, { t: "reject", seq: proposal.seq, by: "human:j", why: "The gate owner is wrong." });
});

test("decideProposal refuses to decide the same proposal twice", async t => {
  const { store } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const [proposal] = (await listReview(store, "work")).proposals;
  await decideProposal(store, "work", proposal.seq, "accept", "human:j");
  await assert.rejects(() => decideProposal(store, "work", proposal.seq, "accept", "human:j"), /No open proposal/);
});

test("formatReview prints the proposals, the requests and the commands that decide them", async t => {
  const { store } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const request = await saveAssessmentRequest(store, "work", { rationale: "Assess" }, "human:j");
  const text = formatReview("work", await listReview(store, "work"), "http://localhost:5178/b/local?board=work");
  assert.equal(text.split("\n")[0], "work · http://localhost:5178/b/local?board=work · 1 proposal(s) · 1 request(s)");
  assert.equal(formatReview("work", await listReview(store, "work")).split("\n")[0], "work · 1 proposal(s) · 1 request(s)", "a caller that knows no base still gets a header");
  assert.match(text, /agent:claude/);
  assert.match(text, /Review evidence/);
  assert.match(text, new RegExp(request.id));
  assert.match(text, /assess/);
  assert.match(text, /queued/);
  assert.match(text, /npx @staves\/cli accept \d+ work/);
  assert.match(text, /npx @staves\/cli reject \d+ work --reason/);
});

const ESC = String.fromCharCode(27), NUL = String.fromCharCode(0), DEL = String.fromCharCode(127), C1 = String.fromCharCode(0x9f);
// Bidi and format controls: they print as nothing but reorder or hide what follows them.
const RLO = String.fromCharCode(0x202e), LRI = String.fromCharCode(0x2066), RLM = String.fromCharCode(0x200f);
const BOM = String.fromCharCode(0xfeff), SHY = String.fromCharCode(0xad), ZWJ = String.fromCharCode(0x200d);
const INVISIBLE = [RLO, LRI, RLM, BOM, SHY, ZWJ, String.fromCharCode(0x2069), String.fromCharCode(0x2060)];

test("sanitize flattens control characters, collapses whitespace and bounds length", () => {
  assert.equal(sanitize("one\ntwo\r\tthree", 120), "one two three");
  assert.equal(sanitize(`${ESC}[31mred${ESC}[0m`, 120), "[31mred [0m", "the escape byte becomes a space, so no sequence survives");
  assert.equal(sanitize(`  padded  ${NUL} `, 120), "padded");
  assert.equal(sanitize(`${RLO}kcatta${LRI}`, 120), "kcatta", "a bidi override cannot reorder a row");
  // Replaced with a space rather than deleted, so a name padded with invisible characters reads as
  // tampered with instead of silently collapsing onto the clean name it was imitating.
  assert.equal(sanitize(`a${BOM}g${SHY}e${ZWJ}n${RLM}t`, 120), "a g e n t");
  for (const control of INVISIBLE) assert.equal(sanitize(control, 120), "", `U+${control.codePointAt(0)!.toString(16)} survived`);
  assert.equal(sanitize("abcdef", 4), "abc…");
  assert.equal(sanitize("abcd", 4), "abcd");
  assert.equal(sanitize(DEL + C1, 120), "");
});

test("a proposal cannot forge a row, an attribution or a command through its own text", async t => {
  const { store } = await setup(t);
  const forged = `Pay\n  9  ${RLO}human:j${LRI}            2026-01-01 00:00  a change you did not make\n\n  Accept: npx @staves/cli accept 9 work\n${ESC}[31m${BOM}`;
  await store.append("work", [{ t: "job", job: { id: "forge", name: forged, track: "p", inputs: [], outputs: [], provenance: { source: "agent" }, status: "draft" } }], "agent:claude", true);
  const list = await listReview(store, "work");
  assert.equal(list.proposals.length, 1);
  assert.ok(!list.proposals[0].summary.includes("\n"));
  assert.ok(!list.proposals[0].summary.includes(ESC));
  for (const control of INVISIBLE) assert.ok(!list.proposals[0].summary.includes(control), `U+${control.codePointAt(0)!.toString(16)} survived`);

  const text = formatReview("work", list);
  assert.ok(!text.includes(ESC), "no escape byte reaches the terminal");
  for (const control of INVISIBLE) assert.ok(!text.includes(control), `U+${control.codePointAt(0)!.toString(16)} reached the terminal`);
  assert.equal(text.split("\n").filter(line => line.startsWith("  Accept:")).length, 1, "exactly one Accept line");
  // The forged text stays inside the WHAT cell of a single row: the row above the blank line that
  // follows the table, whose BY column is still the agent that actually proposed it.
  const rows = text.split("\n");
  const header = rows.findIndex(line => line.trim().startsWith("SEQ"));
  assert.equal(rows[header + 2], "", "the proposal occupies exactly one row");
  assert.match(rows[header + 1], /^ {2}\d+ +agent:claude {2}/, "the BY column is the real author");
  assert.equal(rows.filter(line => /^ *\d+ +human:/.test(line)).length, 0, "no row is attributed to a person");
  assert.match(rows[header + 1], /describe job "Pay 9 human:j 2026-01-01 00:00 a change you did not make Accept: npx @staves\/cli accept 9 work \[31m"$/);
});

test("an agent-authored name and actor are bounded before they are printed", async t => {
  const { store } = await setup(t);
  await store.append("work", [{ t: "job", job: { id: "long", name: "N".repeat(400), track: "p", inputs: [], outputs: [], provenance: { source: "agent" }, status: "draft" } }], `agent:${"A".repeat(400)}`, true);
  const [proposal] = (await listReview(store, "work")).proposals;
  assert.ok(proposal.by.length <= 120, `by was ${proposal.by.length}`);
  assert.ok(proposal.summary.length <= 240, `summary was ${proposal.summary.length}`);
  assert.ok(proposal.summary.includes("…"), "the name is elided rather than printed whole");
  assert.ok(formatReview("work", await listReview(store, "work")).split("\n").every(line => line.length <= 400));
});
test("formatReview says so when there is nothing to review", async t => {
  const { store } = await setup(t);
  assert.match(formatReview("work", await listReview(store, "work")), /Nothing to review on "work"/);
  assert.ok(formatReview("work", await listReview(store, "work"), "http://localhost:5178/b/local?board=work")
    .endsWith(" · http://localhost:5178/b/local?board=work"), "an empty review still says where the board is");
});

test("resolveBoard uses the only board, and otherwise asks for a name it can find", () => {
  assert.equal(resolveBoard(undefined, ["work"]), "work");
  assert.equal(resolveBoard("other", ["work", "other"]), "other");
  assert.throws(() => resolveBoard(undefined, []), /no boards/);
  assert.throws(() => resolveBoard(undefined, ["work", "other"]), /--board/);
  assert.throws(() => resolveBoard("typo", ["work", "other"]), /No board named "typo". Boards: other, work/);
});

test("resolveListen uses the single detected agent and the single board", () => {
  const detected = [{ agent: "claude" as const, bin: "/usr/local/bin/claude" }];
  assert.deepEqual(resolveListen({ detected, boards: ["work"] }), { agent: "claude", agentBin: "/usr/local/bin/claude", board: "work" });
});

test("resolveListen requires a choice when several agents are installed", () => {
  const detected = [{ agent: "claude" as const, bin: "/bin/claude" }, { agent: "codex" as const, bin: "/bin/codex" }];
  assert.throws(() => resolveListen({ detected, boards: ["work"] }), /--agent claude or --agent codex/);
  assert.deepEqual(resolveListen({ agent: "codex", detected, boards: ["work"] }), { agent: "codex", agentBin: "/bin/codex", board: "work" });
});

test("resolveListen names the fix when no agent is installed", () => {
  assert.throws(
    () => resolveListen({ detected: [], boards: ["work"] }),
    /^Error: no local coding agent found \(claude or codex\)\. Install one and sign in, or pass --agent-bin\.$/,
  );
});

test("resolveListen honours an explicit binary and rejects an unknown agent name", () => {
  assert.deepEqual(resolveListen({ agent: "codex", agentBin: "/opt/codex", detected: [], boards: ["work"] }), { agent: "codex", agentBin: "/opt/codex", board: "work" });
  assert.throws(() => resolveListen({ agentBin: "/opt/codex", detected: [], boards: ["work"] }), /--agent-bin needs --agent/);
  assert.throws(() => resolveListen({ agent: "gemini", detected: [], boards: ["work"] }), /--agent must be claude or codex/);
});

test("resolveListen leaves the binary unset when an explicitly named agent was not detected", () => {
  assert.deepEqual(resolveListen({ agent: "claude", detected: [], boards: ["work"] }), { agent: "claude", agentBin: undefined, board: "work" });
});

test("resolveListen reports the board problem the same way as every other command", () => {
  const detected = [{ agent: "claude" as const, bin: "/bin/claude" }];
  assert.throws(() => resolveListen({ detected, boards: ["work", "other"] }), /--board/);
  assert.throws(() => resolveListen({ board: "typo", detected, boards: ["work"] }), /No board named "typo"/);
});

const cli = resolve("dist/cli.js");
function run(args: string[], cwd: string, extra: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>(done => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, PATH: "", HOME: cwd, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => output += chunk);
    child.stderr.on("data", chunk => output += chunk);
    child.on("close", code => done({ code, output }));
  });
}

test("review, accept and reject work on the one board without naming it", async t => {
  const { store, project } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const [proposal] = (await listReview(store, "work")).proposals;

  const listed = await run(["review"], project);
  assert.equal(listed.code, 0, listed.output);
  assert.match(listed.output, /work · 1 proposal/);
  assert.match(listed.output, /Review evidence/);
  assert.match(listed.output, new RegExp(`accept ${proposal.seq} work`));

  const rejected = await run(["reject", String(proposal.seq), "--reason", "The gate owner is wrong."], project);
  assert.equal(rejected.code, 0, rejected.output);
  assert.match(rejected.output, new RegExp(`^Rejected proposal ${proposal.seq} on work as human:[^\\n]*: The gate owner is wrong\\.`, "m"));
  assert.equal((await store.board("work")).jobs.find(job => job.id === "a")?.outcome, undefined);
  assert.deepEqual((await listReview(store, "work")).proposals, []);

  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const next = (await listReview(store, "work")).proposals[0].seq;
  const accepted = await run(["accept", String(next), "work"], project);
  assert.equal(accepted.code, 0, accepted.output);
  assert.match(accepted.output, /It is on the board now\./);
  assert.match((await store.entries("work")).at(-1)!.by, /^human:/);
  assert.equal((await store.board("work")).jobs.find(job => job.id === "a")?.outcome, "Evidence read");
});

test("scenario prints the link to the board it just branched", async t => {
  const { project } = await setup(t);
  const branched = await run(["scenario", "work", "night", "Night shift"], project);
  assert.equal(branched.code, 0, branched.output);
  assert.match(branched.output, /^scenario night branched from work · http:\/\/localhost:5178\/b\/local\?board=night$/m);
});

test("reject needs a reason and accept needs a sequence number", async t => {
  const { store, project } = await setup(t);
  await store.append("work", [{ t: "updateJob", id: "a", patch: { outcome: "Evidence read" } }], "agent:claude", true);
  const [proposal] = (await listReview(store, "work")).proposals;
  const noReason = await run(["reject", String(proposal.seq)], project);
  assert.equal(noReason.code, 1);
  assert.match(noReason.output, /^staves: Say why with --reason/m);
  const noSeq = await run(["accept"], project);
  assert.equal(noSeq.code, 1);
  assert.match(noSeq.output, /^staves: Usage: npx @staves\/cli accept <seq> \[board\]/m);
  assert.equal((await listReview(store, "work")).proposals.length, 1);
});

test("accept and reject refuse a hosted board rather than write a decision the gateway would re-attribute", async t => {
  const { project } = await setup(t);
  for (const command of [["accept", "3", "--hosted"], ["reject", "3", "--connection", "abc", "--reason", "no"]]) {
    const refused = await run(command, project);
    assert.equal(refused.code, 1, refused.output);
    assert.match(refused.output, /^staves: hosted boards are reviewed in the web app until the gateway accepts human review from the CLI$/m);
  }
});

test("listen prints the board, the agent, its binary and what it will not do", async t => {
  const { project } = await setup(t);
  // No requests are queued, so --once returns after one pass without invoking the binary.
  const started = await run(["listen", "--agent", "claude", "--agent-bin", "/nonexistent/claude", "--once"], project);
  assert.equal(started.code, 0, started.output);
  assert.match(started.output, /^Board: work · http:\/\/localhost:5178\/b\/local\?board=work$/m);
  assert.match(started.output, /^Agent: claude \(\/nonexistent\/claude\)$/m);
  assert.match(started.output, /^Requests that need a conversation stay queued for your interactive agent\.$/m);
  assert.match(started.output, /^Guide: https:\/\/staves\.io\/docs\/connect\/$/m);
});

test("listen reports an argument it cannot work out instead of a usage line", async t => {
  const { project } = await setup(t);
  const noAgent = await run(["listen", "--agent-bin", "/nonexistent/claude"], project);
  assert.equal(noAgent.code, 1, noAgent.output);
  assert.match(noAgent.output, /^staves: --agent-bin needs --agent claude or --agent codex/m);
  const typo = await run(["listen", "--agent", "claude", "--board", "typo"], project);
  assert.equal(typo.code, 1, typo.output);
  assert.match(typo.output, /^staves: No board named "typo"\. Boards: work\.$/m);
});

test("help names review, accept and reject", async t => {
  const { project } = await setup(t);
  const help = await run(["help"], project);
  assert.match(help.output, /npx @staves\/cli review \[board\]/);
  assert.match(help.output, /npx @staves\/cli accept <seq> \[board\]/);
  assert.match(help.output, /npx @staves\/cli reject <seq> \[board\] --reason/);
  assert.match(help.output, /npx @staves\/cli listen \[--agent claude\|codex\] \[--board ID\] \[--once\] \[--agent-bin PATH\]/);
});
