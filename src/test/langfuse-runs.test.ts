import test from "node:test";
import assert from "node:assert/strict";
import { aggregateRuns, readObservations, recentCases, replayRun, runDays } from "../langfuse-runs.js";
import type { ObservationScan, RunObservation } from "../langfuse-runs.js";
import { emptyBoard } from "../model.js";
import type { Board, Job } from "../model.js";

const connection = { baseUrl: "https://cloud.langfuse.com", projectId: "project-1" };
const env = { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "secret-test" };
const now = () => new Date("2026-09-15T12:00:00.000Z");

/** A flat-metadata span: the shape an SDK writes. */
const flat = {
  id: "obs-1", traceId: "trace-1", projectId: "project-1", name: "Prepare packet", type: "SPAN",
  startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:00:02.000Z", latency: 2,
  level: "DEFAULT", statusMessage: "ok", environment: "production", parentObservationId: "obs-0",
  metadata: { "staves.board_id": "board-1", "staves.job_id": "intake", "staves.design_revision": "42", "staves.case": "case-1", prompt: "secret prompt" },
  input: "sensitive input", output: "sensitive output",
};
/** The same facts nested under attributes: the shape OpenTelemetry writes. No latency field. */
const nested = {
  id: "obs-2", traceId: "trace-1", projectId: "project-1", name: "Decide", type: "SPAN",
  startTime: "2026-09-15T09:00:03.000Z", endTime: "2026-09-15T09:00:04.500Z", level: "ERROR",
  metadata: { attributes: { "staves.board_id": "board-1", "staves.job_id": "decide", "staves.exit": "publish", "staves.case": "case-1" } },
  output: "sensitive output",
};
const otherBoard = { ...flat, id: "obs-3", metadata: { "staves.board_id": "board-2", "staves.job_id": "intake" } };
const unattributed = { ...flat, id: "obs-4", metadata: { "staves.board_id": "board-1" } };

function pager(pages: Record<string, unknown>[][], project = "project-1") {
  const calls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === "/api/public/projects") return Response.json({ data: [{ id: project }] });
    const cursor = url.searchParams.get("cursor");
    const index = cursor === null ? 0 : Number(cursor);
    const data = pages[index] ?? [];
    return Response.json({ data, meta: { cursor: index + 1 < pages.length ? String(index + 1) : null } });
  };
  return { fetchImpl, calls };
}

test("a scan reads both metadata shapes and carries no prompt, input or output", async () => {
  const { fetchImpl, calls } = pager([[flat, nested, otherBoard, unattributed]]);
  const scan = await readObservations(connection, { boardId: "board-1", fetchImpl, env, now });
  assert.deepEqual(scan.observations, [
    { id: "obs-1", traceId: "trace-1", caseId: "case-1", jobId: "intake", revision: "42",
      startTime: flat.startTime, endTime: flat.endTime, latencyMs: 2000, level: "DEFAULT",
      statusMessage: "ok", name: "Prepare packet", type: "SPAN", parentObservationId: "obs-0" },
    { id: "obs-2", traceId: "trace-1", caseId: "case-1", jobId: "decide", exitId: "publish",
      startTime: nested.startTime, endTime: nested.endTime, latencyMs: 1500, level: "ERROR", name: "Decide", type: "SPAN" },
  ]);
  assert.equal(scan.scanned, 4);
  assert.equal(scan.truncated, false);
  assert.equal(scan.window.from, "2026-09-08T12:00:00.000Z");
  assert.equal(scan.window.to, "2026-09-15T12:00:00.000Z");
  const serialised = JSON.stringify(scan);
  for (const secret of ["secret prompt", "sensitive input", "sensitive output", "production"]) assert.equal(serialised.includes(secret), false);
  assert.equal(calls[1].pathname, "/api/public/v2/observations");
  assert.equal(calls[1].searchParams.get("fields"), "core,basic,metadata");
  assert.equal(calls[1].searchParams.get("limit"), "100");
  assert.equal(calls[1].searchParams.get("fromStartTime"), "2026-09-08T12:00:00.000Z");
});

/* The server does the board filter — verified by the controller against the live project on
 * 15 Sep 2026: 34 of the project's 35 observations, with both "=" and "contains" accepted on this
 * column. "=" is the one sent, because "contains" also matches a board id that is merely a prefix of
 * another. The client-side guard stays: a filter that silently matched nothing would read as "this
 * board never ran", the exact false signal this feature exists to avoid. */
test("the board filter goes on the wire exactly, and the scan still guards what comes back", async () => {
  const { fetchImpl, calls } = pager([[flat, otherBoard]]);
  const scan = await readObservations(connection, { boardId: "board-1", fetchImpl, env, now });
  assert.deepEqual(JSON.parse(calls[1].searchParams.get("filter") ?? "null"),
    [{ type: "stringObject", column: "metadata", key: "staves.board_id", operator: "=", value: "board-1" }]);
  assert.deepEqual(scan.observations.map(o => o.id), ["obs-1"]);
});

test("a scan is bounded by maxPages and reports that it was truncated", async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ ...flat, id: `obs-${i}` }));
  const { fetchImpl, calls } = pager([page, page, page, page]);
  const scan = await readObservations(connection, { boardId: "board-1", maxPages: 2, fetchImpl, env, now });
  assert.equal(scan.scanned, 200);
  assert.equal(scan.truncated, true);
  assert.equal(calls.length, 3);
  // Every page carries the filter, the later ones alongside the cursor.
  for (const call of calls.slice(1)) assert.match(call.searchParams.get("filter") ?? "", /staves\.board_id/);
  assert.equal(calls[2].searchParams.get("cursor"), "1");
  const whole = await readObservations(connection, { boardId: "board-1", maxPages: 9, fetchImpl: pager([page, page]).fetchImpl, env, now });
  assert.equal(whole.truncated, false);
});

test("a scan stops at the first empty page", async () => {
  const { fetchImpl, calls } = pager([[flat], [], [flat]]);
  const scan = await readObservations(connection, { boardId: "board-1", fetchImpl, env, now });
  assert.equal(scan.scanned, 1);
  assert.equal(scan.truncated, false);
  assert.equal(calls.length, 3);
});

test("the window is explicit, ordered, and the project must match the credentials", async () => {
  const { fetchImpl, calls } = pager([[flat]]);
  const scan = await readObservations(connection, { boardId: "board-1", fromStartTime: "2026-09-14T00:00:00.000Z", toStartTime: "2026-09-15T00:00:00.000Z", fetchImpl, env, now });
  assert.equal(scan.window.from, "2026-09-14T00:00:00.000Z");
  assert.equal(calls[1].searchParams.get("toStartTime"), "2026-09-15T00:00:00.000Z");
  await assert.rejects(readObservations(connection, { boardId: "board-1", fromStartTime: "2026-09-16T00:00:00.000Z", fetchImpl, env, now }), /before/);
  await assert.rejects(readObservations(connection, { boardId: "board-1", fetchImpl: pager([[flat]], "other-project").fetchImpl, env, now }), /project-scoped key/);
  await assert.rejects(readObservations(connection, { boardId: "board-1", fetchImpl: pager([[{ ...flat, projectId: "other" }]]).fetchImpl, env, now }), /does not match/);
});

test("credential and transport failures keep the existing messages and never echo the payload", async () => {
  const unauthorised: typeof fetch = async () => new Response("secret-test sensitive payload", { status: 401 });
  await assert.rejects(readObservations(connection, { boardId: "board-1", fetchImpl: unauthorised, env, now }),
    (error: Error) => error.message === "Langfuse request failed (HTTP 401)");
  await assert.rejects(readObservations(connection, { boardId: "board-1", fetchImpl: pager([[flat]]).fetchImpl, env: {}, now }), /LANGFUSE_PUBLIC_KEY/);
  await assert.rejects(readObservations({ ...connection, baseUrl: "https://attacker.test" }, { boardId: "board-1", fetchImpl: pager([[flat]]).fetchImpl, env, now }), /LANGFUSE_BASE_URL/);
});

test("staves keys that are not strings are ignored rather than coerced", async () => {
  const noJob = { ...flat, id: "obs-5", metadata: { "staves.board_id": "board-1", "staves.job_id": 7 } };
  const oddExit = { ...flat, id: "obs-6", metadata: { "staves.board_id": "board-1", "staves.job_id": "intake", "staves.exit": ["publish"] } };
  const scan = await readObservations(connection, { boardId: "board-1", fetchImpl: pager([[noJob, oddExit]]).fetchImpl, env, now });
  assert.deepEqual(scan.observations.map(o => o.id), ["obs-6"]);
  assert.equal(scan.observations[0].exitId, undefined);
  assert.equal(scan.scanned, 2);
});

test("a malformed page fails as a plain error, never as a raw type error", async () => {
  const plain = (error: Error) => error.constructor === Error && !(error instanceof TypeError);
  for (const body of [{ data: ["not an observation"] }, { data: [flat], meta: "not an object" }, { data: "not a page" }]) {
    const fetchImpl: typeof fetch = async (input) =>
      Response.json(new URL(String(input)).pathname === "/api/public/projects" ? { data: [{ id: "project-1" }] } : body);
    await assert.rejects(readObservations(connection, { boardId: "board-1", fetchImpl, env, now }), plain);
  }
});

/* ---------- aggregation: pure, over fixtures ---------- */

function job(id: string, extra: Partial<Job> = {}): Job {
  return { id, name: id, track: "hands", inputs: [], outputs: [], provenance: { source: "human" }, status: "confirmed", ...extra };
}
const board: Board = { ...emptyBoard("board-1", "Board 1"),
  jobs: [job("intake"), job("decide"), job("publish"), job("archive"), job("retired", { removed: true })] };

function run(jobId: string, startTime: string, extra: Partial<RunObservation> = {}): RunObservation {
  return { id: `${jobId}@${startTime}`, traceId: "trace-1", caseId: "case-a", jobId, startTime, latencyMs: 100, level: "DEFAULT", ...extra };
}
/** As the scan returns them: newest first, cases interleaved. */
function scanOf(observations: RunObservation[], extra: Partial<ObservationScan> = {}): ObservationScan {
  return { observations: [...observations].reverse(), window: { from: "2026-09-08T12:00:00.000Z", to: "2026-09-15T12:00:00.000Z" },
    scanned: observations.length, truncated: false, ...extra };
}

const threeCases = scanOf([
  run("intake", "2026-09-15T09:00:00.000Z", { latencyMs: 100 }),
  run("decide", "2026-09-15T09:00:01.000Z", { latencyMs: 300, exitId: "publish" }),
  run("publish", "2026-09-15T09:00:02.000Z", { latencyMs: 500 }),
  run("intake", "2026-09-15T09:10:00.000Z", { caseId: "case-b", latencyMs: 200 }),
  run("decide", "2026-09-15T09:10:01.000Z", { caseId: "case-b", latencyMs: 700, exitId: "stop", level: "ERROR" }),
  run("intake", "2026-09-15T09:20:00.000Z", { caseId: "case-c", latencyMs: 900 }),
  run("old-review", "2026-09-15T09:20:01.000Z", { caseId: "case-c" }),
  run("retired", "2026-09-15T09:20:02.000Z", { caseId: "case-c" }),
  run("publish", "2026-09-15T09:20:03.000Z", { caseId: "case-c", latencyMs: 1100 }),
]);

test("each job reports its runs, failures, percentiles and the first and last time it was seen", () => {
  const aggregate = aggregateRuns(threeCases, board);
  assert.deepEqual(aggregate.jobs.intake, { runs: 3, failures: 0, p50Ms: 200, p95Ms: 900,
    firstSeen: "2026-09-15T09:00:00.000Z", lastSeen: "2026-09-15T09:20:00.000Z" });
  assert.deepEqual(aggregate.jobs.decide, { runs: 2, failures: 1, p50Ms: 300, p95Ms: 700,
    firstSeen: "2026-09-15T09:00:01.000Z", lastSeen: "2026-09-15T09:10:01.000Z" });
  assert.deepEqual(aggregate.jobs.publish, { runs: 2, failures: 0, p50Ms: 500, p95Ms: 1100,
    firstSeen: "2026-09-15T09:00:02.000Z", lastSeen: "2026-09-15T09:20:03.000Z" });
  assert.equal(aggregate.jobs.archive, undefined);
  assert.equal(aggregate.cases, 3);
  assert.deepEqual(aggregate.window, threeCases.window);
  assert.equal(aggregate.scanned, 9);
  assert.equal(aggregate.truncated, false);
});

test("a single run is its own p50 and p95, and a bounded scan says so", () => {
  const aggregate = aggregateRuns(scanOf([run("intake", "2026-09-15T09:00:00.000Z", { latencyMs: 42 })], { scanned: 2000, truncated: true }), board);
  assert.deepEqual(aggregate.jobs.intake, { runs: 1, failures: 0, p50Ms: 42, p95Ms: 42,
    firstSeen: "2026-09-15T09:00:00.000Z", lastSeen: "2026-09-15T09:00:00.000Z" });
  assert.equal(aggregate.truncated, true);
  assert.equal(aggregate.scanned, 2000);
});

test("handoffs are counted inside a case in start order, and the recorded exit decides where the work went", () => {
  const aggregate = aggregateRuns(threeCases, board);
  // case-a and case-b both start intake → decide. case-c runs two jobs the board cannot name between
  // intake and publish, so what happened across them is not known and no edge is drawn over them.
  assert.equal(aggregate.handoffs.intake.publish, undefined);
  assert.deepEqual(aggregate.handoffs, { intake: { decide: 2 }, decide: { publish: 1 } });
  // decide's "stop" in case-b ends the case: recorded as an exit, never as a handoff.
  assert.deepEqual(aggregate.exits, { decide: { publish: 1, stop: 1 } });
});

test("a repeated job is one step, and an exit naming a job the board no longer has is counted but not drawn", () => {
  const aggregate = aggregateRuns(scanOf([
    run("intake", "2026-09-15T09:00:00.000Z"),
    run("intake", "2026-09-15T09:00:01.000Z"),
    run("decide", "2026-09-15T09:00:02.000Z", { exitId: "gone" }),
  ]), board);
  assert.deepEqual(aggregate.handoffs, { intake: { decide: 1 } });
  assert.deepEqual(aggregate.exits, { decide: { gone: 1 } });
  assert.equal(aggregate.jobs.intake.runs, 2);
});

/* ---------- one case, replayed as a path through the board ---------- */

const oneCase = [
  run("intake", "2026-09-15T09:00:00.000Z", { caseId: "case-x", traceId: "trace-x", endTime: "2026-09-15T09:00:01.000Z", latencyMs: 1000 }),
  run("old-review", "2026-09-15T09:00:02.000Z", { caseId: "case-x", traceId: "trace-y", endTime: "2026-09-15T09:00:03.500Z", latencyMs: 1500, level: "ERROR" }),
  run("publish", "2026-09-15T09:00:04.000Z", { caseId: "case-x", traceId: "trace-x", endTime: "2026-09-15T09:00:06.000Z", latencyMs: 2000, exitId: "stop" }),
].reverse();

test("a case replays in start order and keeps the step the board cannot name", () => {
  const replay = replayRun(oneCase, "case-x", board);
  assert.deepEqual(replay.steps, [
    { jobId: "intake", known: true, startTime: "2026-09-15T09:00:00.000Z", endTime: "2026-09-15T09:00:01.000Z", latencyMs: 1000, level: "DEFAULT" },
    { jobId: "old-review", known: false, startTime: "2026-09-15T09:00:02.000Z", endTime: "2026-09-15T09:00:03.500Z", latencyMs: 1500, level: "ERROR" },
    { jobId: "publish", known: true, startTime: "2026-09-15T09:00:04.000Z", endTime: "2026-09-15T09:00:06.000Z", latencyMs: 2000, level: "DEFAULT", exitId: "stop" },
  ]);
  assert.equal(replay.caseId, "case-x");
  assert.deepEqual(replay.traceIds, ["trace-x", "trace-y"]);
  assert.equal(replay.totalMs, 6000);
  assert.equal(replay.failures, 1);
});

test("a case can be asked for by trace id, and an unknown one replays as nothing", () => {
  assert.deepEqual(replayRun(oneCase, "trace-y", board).steps.map(step => step.jobId), ["old-review"]);
  const missing = replayRun(oneCase, "case-nothing", board);
  assert.deepEqual(missing, { caseId: "case-nothing", traceIds: [], steps: [], totalMs: 0, failures: 0 });
});

test("a case still running is timed from what it has, and a removed job is no longer known", () => {
  const running = replayRun([run("intake", "2026-09-15T09:00:00.000Z", { caseId: "case-y", latencyMs: 400 }),
    run("retired", "2026-09-15T09:00:05.000Z", { caseId: "case-y", latencyMs: 100 })], "case-y", board);
  assert.equal(running.totalMs, 5000);
  assert.deepEqual(running.steps.map(step => step.known), [true, false]);
});

test("drift runs both ways: job ids the board does not have, and board jobs that never ran", () => {
  const aggregate = aggregateRuns(threeCases, board);
  assert.deepEqual(aggregate.drift.unknownJobs, { "old-review": 1, retired: 1 });
  assert.deepEqual(aggregate.drift.neverRan, ["archive"]);
  const silent = aggregateRuns(scanOf([]), board);
  assert.deepEqual(silent.drift.neverRan, ["intake", "decide", "publish", "archive"]);
  assert.deepEqual(silent.jobs, {});
  assert.equal(silent.cases, 0);
});

// Shared by the local daemon and the hosted gateway, so both answer the same window the same way.
test("recent cases are newest first, carry what each cost, and stop at the limit", () => {
  const cases = recentCases(threeCases.observations);
  assert.deepEqual(cases.map(item => item.caseId), ["case-c", "case-b", "case-a"]);
  assert.deepEqual(cases[1], { caseId: "case-b", startTime: "2026-09-15T09:10:00.000Z", endTime: "2026-09-15T09:10:01.000Z", steps: 2, failures: 1, totalMs: 1000 });
  assert.deepEqual(recentCases(threeCases.observations, 1).map(item => item.caseId), ["case-c"]);
  assert.deepEqual(recentCases([]), []);
});

test("a window is a whole number of days from 1 to 90, and anything unreadable is a week", () => {
  assert.equal(runDays("30"), 30);
  assert.equal(runDays("0"), 1);
  assert.equal(runDays("500"), 90);
  assert.equal(runDays("2.6"), 3);
  assert.equal(runDays(null), 7);
  assert.equal(runDays("soon"), 7);
});
