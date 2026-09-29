import { z } from "zod";
import type { Board, LangfuseConnection } from "./model.js";
import { langfuseIdentifier, langfuseReader, langfuseRecord, langfuseTimestamp, validateLangfuseConnection } from "./langfuse.js";

/**
 * staves — as run.
 *
 * Production observations read back in board vocabulary: how often a job ran, how long it took,
 * how often it failed, which exit the work took and where it went next. Measurement beside design:
 * nothing here claims a job is implemented, and nothing here carries a prompt, an input or an output.
 * Every number is returned with the window it covers and the bound of the scan that produced it.
 */

export type ObservationLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

/** One observation, reduced to what the board can say. Never a copy of trace contents. */
export interface RunObservation {
  id: string;
  traceId: string;
  /** staves.case when set, else the trace id: one unit of work. */
  caseId: string;
  jobId: string;
  /** staves.exit: the id of the job the work went to next, or "stop". Exits have no ids of their own. */
  exitId?: string;
  revision?: string;
  startTime: string;
  endTime?: string;
  latencyMs: number;
  level: ObservationLevel;
  statusMessage?: string;
  name?: string;
  type?: string;
  parentObservationId?: string;
}

export interface RunWindow { from: string; to: string }

export interface ObservationScan {
  observations: RunObservation[];
  window: RunWindow;
  /** observations the filtered query returned: the bound on every number derived from this scan */
  scanned: number;
  /** the scan hit its page limit with more still to read; older observations in the window were not read */
  truncated: boolean;
}

export interface ReadObservationsRequest {
  boardId: string;
  fromStartTime?: string;
  toStartTime?: string;
  /** pages of 100; 20 pages = 2,000 observations */
  maxPages?: number;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

const stavesKeys = ["staves.board_id", "staves.job_id", "staves.exit", "staves.case", "staves.design_revision"] as const;
type StavesKey = (typeof stavesKeys)[number];
const levels: ObservationLevel[] = ["DEBUG", "DEFAULT", "WARNING", "ERROR"];
const pageSize = 100;

function fields(value: unknown): Record<string, unknown> {
  return value == null || typeof value !== "object" || Array.isArray(value) ? {} : (value as Record<string, unknown>);
}

/** Metadata arrives flat from an SDK and nested under attributes from OpenTelemetry. Read both. */
function stavesMetadata(metadata: unknown): Partial<Record<StavesKey, string>> {
  const flat = fields(metadata);
  const nested = fields(flat.attributes);
  const out: Partial<Record<StavesKey, string>> = {};
  for (const key of stavesKeys) {
    const value = flat[key] ?? nested[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 200);
  }
  return out;
}

function text(value: unknown, limit = 200): string | undefined {
  return typeof value === "string" && value ? value.slice(0, limit) : undefined;
}

function observationFrom(row: Record<string, unknown>, boardId: string): RunObservation | undefined {
  const staves = stavesMetadata(row.metadata);
  // Attribution is explicit on both sides: this board, and a job of it. Nothing is inferred here.
  if (staves["staves.board_id"] !== boardId || !staves["staves.job_id"]) return undefined;
  const id = langfuseIdentifier.parse(row.id), traceId = langfuseIdentifier.parse(row.traceId);
  const startTime = langfuseTimestamp.parse(row.startTime);
  const endTime = row.endTime == null ? undefined : langfuseTimestamp.parse(row.endTime);
  // Langfuse reports `latency` in seconds (verified live: latency 1.2 for a 1200 ms span); everything
  // here is milliseconds, so it is scaled once at the boundary.
  const reported = typeof row.latency === "number" && Number.isFinite(row.latency) && row.latency >= 0 ? row.latency * 1000 : undefined;
  const measured = endTime === undefined ? undefined : Date.parse(endTime) - Date.parse(startTime);
  const level = levels.find(known => known === row.level) ?? "DEFAULT";
  return {
    id, traceId, caseId: staves["staves.case"] ?? traceId, jobId: staves["staves.job_id"],
    ...(staves["staves.exit"] ? { exitId: staves["staves.exit"] } : {}),
    ...(staves["staves.design_revision"] ? { revision: staves["staves.design_revision"] } : {}),
    startTime, ...(endTime ? { endTime } : {}),
    latencyMs: Math.max(0, reported ?? measured ?? 0), level,
    ...(text(row.statusMessage) ? { statusMessage: text(row.statusMessage) } : {}),
    ...(text(row.name) ? { name: text(row.name) } : {}),
    ...(text(row.type) ? { type: text(row.type) } : {}),
    ...(text(row.parentObservationId) ? { parentObservationId: text(row.parentObservationId) } : {}),
  };
}

/** Scan the window newest-first for observations instrumented to this board.
 *
 * The board filter is applied by the server. Verified by the controller against the live project on
 * 15 Sep 2026: 34 of the project's 35 observations came back for this board, and both "=" and
 * "contains" are accepted on this column. "=" is the one sent, because "contains" also matches a board
 * id that is merely a prefix of another, which would inflate `scanned` with another board's work.
 * The client-side board guard below stays as the safety net: a filter that silently matched nothing
 * would otherwise read as "this board never ran". Reuses the credential reader; adds no second fetch path.
 */
export async function readObservations(connectionInput: LangfuseConnection, request: ReadObservationsRequest): Promise<ObservationScan> {
  const connection = validateLangfuseConnection(connectionInput);
  const boardId = langfuseIdentifier.parse(request.boardId);
  const maxPages = z.number().int().min(1).max(50).parse(request.maxPages ?? 20);
  const read = langfuseReader(connection.baseUrl, { fetch: request.fetchImpl, env: request.env, now: request.now });
  const projects = await read("/api/public/projects");
  if (!Array.isArray(projects.data) || projects.data.length !== 1 || langfuseRecord(projects.data[0]).id !== connection.projectId) {
    throw new Error("Langfuse credentials do not match the board's project; use a project-scoped key");
  }
  const to = langfuseTimestamp.parse(request.toStartTime ?? (request.now ?? (() => new Date()))().toISOString());
  const from = langfuseTimestamp.parse(request.fromStartTime ?? new Date(Date.parse(to) - 7 * 86_400_000).toISOString());
  if (Date.parse(from) >= Date.parse(to)) throw new Error("Observation time range must start before it ends");

  const filter = JSON.stringify([{ type: "stringObject", column: "metadata", key: "staves.board_id", operator: "=", value: boardId }]);
  const observations: RunObservation[] = [];
  let scanned = 0, truncated = false, cursor: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ fields: "core,basic,metadata", limit: String(pageSize), fromStartTime: from, toStartTime: to, filter });
    if (cursor !== undefined) params.set("cursor", cursor);
    const response = await read(`/api/public/v2/observations?${params}`);
    if (!Array.isArray(response.data) || response.data.length > pageSize) throw new Error("Invalid Langfuse observation page");
    if (response.data.length === 0) break;
    scanned += response.data.length;
    for (const value of response.data) {
      const row = langfuseRecord(value);
      if (row.projectId !== connection.projectId) throw new Error("Langfuse observation project does not match");
      const observation = observationFrom(row, boardId);
      if (observation) observations.push(observation);
    }
    const next = langfuseRecord(response.meta ?? {}).cursor;
    if (typeof next !== "string" || !next) break;
    cursor = z.string().min(1).max(4096).parse(next);
    if (page === maxPages) truncated = true;
  }
  return { observations, window: { from, to }, scanned, truncated };
}

/* ---------- aggregation: pure, over what the scan returned ---------- */

export interface JobRuns {
  runs: number;
  failures: number;
  p50Ms: number;
  p95Ms: number;
  firstSeen: string;
  lastSeen: string;
}

export interface RunAggregate {
  window: RunWindow;
  scanned: number;
  truncated: boolean;
  jobs: Record<string, JobRuns>;
  /** per job, how often each recorded exit was taken: a job id, or "stop" */
  exits: Record<string, Record<string, number>>;
  handoffs: Record<string, Record<string, number>>;
  /** both directions: ids the board does not have, and jobs the board has that did not run */
  drift: { unknownJobs: Record<string, number>; neverRan: string[] };
  cases: number;
}

/** Nearest rank: every percentile is a duration something actually took, never an interpolation. */
function percentile(ascending: number[], share: number): number {
  if (ascending.length === 0) return 0;
  return ascending[Math.min(ascending.length, Math.max(1, Math.ceil(share * ascending.length))) - 1];
}

function tally(counts: Record<string, Record<string, number>>, outer: string, inner: string): void {
  const row = counts[outer] ?? (counts[outer] = {});
  row[inner] = (row[inner] ?? 0) + 1;
}

/** Read the board in run terms. Measurement beside design: a job with runs is not thereby
 * implemented as designed, and a job with none is not thereby missing — both are questions. */
export function aggregateRuns(scan: ObservationScan, board: Board): RunAggregate {
  const active = board.jobs.filter(job => !job.removed).map(job => job.id);
  const known = new Set(active);
  const jobs: Record<string, JobRuns> = {}, exits: Record<string, Record<string, number>> = {};
  const handoffs: Record<string, Record<string, number>> = {}, unknownJobs: Record<string, number> = {};
  const latencies = new Map<string, number[]>();
  const cases = new Map<string, RunObservation[]>();

  for (const observation of scan.observations) {
    const inCase = cases.get(observation.caseId);
    if (inCase === undefined) cases.set(observation.caseId, [observation]); else inCase.push(observation);
    if (!known.has(observation.jobId)) { unknownJobs[observation.jobId] = (unknownJobs[observation.jobId] ?? 0) + 1; continue; }
    const seen = jobs[observation.jobId];
    jobs[observation.jobId] = seen === undefined
      ? { runs: 1, failures: observation.level === "ERROR" ? 1 : 0, p50Ms: 0, p95Ms: 0, firstSeen: observation.startTime, lastSeen: observation.startTime }
      : { ...seen, runs: seen.runs + 1, failures: seen.failures + (observation.level === "ERROR" ? 1 : 0),
          firstSeen: Date.parse(observation.startTime) < Date.parse(seen.firstSeen) ? observation.startTime : seen.firstSeen,
          lastSeen: Date.parse(observation.startTime) > Date.parse(seen.lastSeen) ? observation.startTime : seen.lastSeen };
    const durations = latencies.get(observation.jobId);
    if (durations === undefined) latencies.set(observation.jobId, [observation.latencyMs]); else durations.push(observation.latencyMs);
    if (observation.exitId) tally(exits, observation.jobId, observation.exitId);
  }
  for (const [jobId, durations] of latencies) {
    const ascending = [...durations].sort((a, b) => a - b);
    jobs[jobId] = { ...jobs[jobId], p50Ms: percentile(ascending, 0.5), p95Ms: percentile(ascending, 0.95) };
  }

  // One case is one unit of work. Within it, the steps a person would name, in the order they happened.
  for (const observations of cases.values()) {
    for (const step of stepsOf(observations)) {
      const to = step.exitId ?? step.next;
      if (to === undefined || to === "stop" || to === step.jobId) continue;
      // A step the board cannot name breaks the chain: what happened across it is not known,
      // and an edge drawn over it would be an edge the work never took. Drift reports it instead.
      if (!known.has(step.jobId) || !known.has(to)) continue;
      handoffs[step.jobId] = handoffs[step.jobId] ?? {};
      handoffs[step.jobId][to] = (handoffs[step.jobId][to] ?? 0) + 1;
    }
  }

  return { window: scan.window, scanned: scan.scanned, truncated: scan.truncated, jobs, exits, handoffs,
    drift: { unknownJobs, neverRan: active.filter(id => jobs[id] === undefined) }, cases: cases.size };
}

/** The window a runs request asked for: whole days from 1 to 90, a week when unreadable. One rule for
 * the local daemon and the hosted gateway, so the same URL reads the same window on both. */
export function runDays(value: string | null): number {
  const requested = Math.round(Number(value ?? 7));
  return Number.isFinite(requested) ? Math.min(90, Math.max(1, requested)) : 7;
}

export interface RecentCase {
  caseId: string;
  startTime: string;
  endTime: string;
  steps: number;
  failures: number;
  totalMs: number;
}

/** The window's cases, newest first: one unit of work each, with the bound of what was scanned.
 * Ids only — a case carries no prompt, input or output back to the board. */
export function recentCases(observations: RunObservation[], limit = 20): RecentCase[] {
  const seen = new Map<string, Omit<RecentCase, "totalMs">>();
  for (const observation of observations) {
    const end = observation.endTime ?? observation.startTime;
    const item = seen.get(observation.caseId);
    if (item === undefined) { seen.set(observation.caseId, { caseId: observation.caseId, startTime: observation.startTime, endTime: end, steps: 1, failures: observation.level === "ERROR" ? 1 : 0 }); continue; }
    item.steps += 1;
    if (observation.level === "ERROR") item.failures += 1;
    if (Date.parse(observation.startTime) < Date.parse(item.startTime)) item.startTime = observation.startTime;
    if (Date.parse(end) > Date.parse(item.endTime)) item.endTime = end;
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)).slice(0, limit)
    .map(item => ({ ...item, totalMs: Math.max(0, Date.parse(item.endTime) - Date.parse(item.startTime)) }));
}

/* ---------- one case, replayed as a path through the board ---------- */

export interface ReplayStep {
  jobId: string;
  /** the board has this job today; an unknown id is kept, never dropped, and never invented */
  known: boolean;
  startTime: string;
  endTime?: string;
  latencyMs: number;
  level: ObservationLevel;
  exitId?: string;
}

export interface RunReplay {
  caseId: string;
  traceIds: string[];
  steps: ReplayStep[];
  /** first start to last end, or to the last start while it is still running */
  totalMs: number;
  failures: number;
}

/** One unit of work, in the order it happened. The id is a staves.case or a trace id. */
export function replayRun(observations: RunObservation[], caseId: string, board: Board): RunReplay {
  const known = new Set(board.jobs.filter(job => !job.removed).map(job => job.id));
  const matched = observations.filter(observation => observation.caseId === caseId || observation.traceId === caseId)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const steps = matched.map(observation => ({ jobId: observation.jobId, known: known.has(observation.jobId),
    startTime: observation.startTime, ...(observation.endTime ? { endTime: observation.endTime } : {}),
    latencyMs: observation.latencyMs, level: observation.level, ...(observation.exitId ? { exitId: observation.exitId } : {}) }));
  const starts = matched.map(observation => Date.parse(observation.startTime));
  const ends = matched.map(observation => Date.parse(observation.endTime ?? observation.startTime));
  const traceIds: string[] = [];
  for (const observation of matched) if (!traceIds.includes(observation.traceId)) traceIds.push(observation.traceId);
  return { caseId, traceIds, steps,
    totalMs: matched.length === 0 ? 0 : Math.max(0, Math.max(...ends) - Math.min(...starts)),
    failures: matched.filter(observation => observation.level === "ERROR").length };
}

/** Every step of one case in start order — unknown job ids included, so the caller can see that the
 * chain was broken — consecutive repeats collapsed into one step, each carrying where the work went
 * next: the recorded exit, else the job that followed. */
function stepsOf(observations: RunObservation[]): { jobId: string; exitId?: string; next?: string }[] {
  const ordered = [...observations]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const collapsed: RunObservation[] = [];
  for (const observation of ordered) {
    const last = collapsed[collapsed.length - 1];
    if (last === undefined || last.jobId !== observation.jobId) collapsed.push(observation);
    // A repeat is the same step again. The last exit recorded across the repeats is the one that
    // counts; an earlier one is kept only when no later attempt recorded any.
    else collapsed[collapsed.length - 1] = observation.exitId || !last.exitId ? observation : { ...observation, exitId: last.exitId };
  }
  return collapsed.map((observation, index) => ({ jobId: observation.jobId,
    ...(observation.exitId ? { exitId: observation.exitId } : {}),
    ...(index + 1 < collapsed.length ? { next: collapsed[index + 1].jobId } : {}) }));
}
