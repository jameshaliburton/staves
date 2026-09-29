import type { Board, Job } from "./model.js";
import { assessPrerequisites, validatePrerequisites } from "./flow.js";

export interface CaseAssumption {
  id: string;
  note: string;
  status: "active" | "retracted";
  /** An explicit case condition, never a design fact. */
  condition?: string;
  value?: boolean;
}

export interface WalkthroughCase {
  name: string;
  initialArtifacts: string[];
  conditions?: Record<string, boolean>;
  /** Exactly one declared exit condition per decision job. */
  exitChoices?: Record<string, string>;
  /** Explicitly take a declared retry; false skips it. Missing is unresolved. */
  loopChoices?: Record<string, boolean>;
  assumptions?: CaseAssumption[];
}

export interface WalkthroughIssue {
  jobId?: string;
  reason: string;
}

export interface WalkthroughStep {
  index: number;
  /** Jobs in the same round were independently eligible before its outputs. */
  round: number;
  jobId: string;
  occurrence: number;
  availableBefore: string[];
  outputs: string[];
  exit?: { condition: string; target: string };
  loop?: { action: "repeat" | "limit" | "skip"; target?: string };
}

export interface WalkthroughResult {
  snapshot: Board;
  case: WalkthroughCase;
  status: "complete" | "waiting" | "unresolved" | "engine-limit";
  steps: WalkthroughStep[];
  questions: WalkthroughIssue[];
  waits: WalkthroughIssue[];
  outcomes: { jobId: string; kind: "modelled-completion" | "stop"; description?: string }[];
  availableArtifacts: string[];
  assumptions: CaseAssumption[];
  maxSteps: number;
}

/**
 * A deterministic assessment of declared work, not execution evidence. Artifacts
 * are persistent facts for this case, not consumable tokens. Jobs run once except
 * explicitly chosen, bounded self retries. Multi-job retry paths remain unresolved
 * until the model can declare which work and artifacts reset between attempts.
 */
export function walkThrough(board: Board, input: WalkthroughCase, options: { maxSteps?: number } = {}): WalkthroughResult {
  const snapshot = structuredClone(board);
  const example = structuredClone(input);
  const maxSteps = options.maxSteps ?? 200;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 10000) throw new Error("maxSteps must be an integer from 1 to 10000");
  if (typeof example.name !== "string" || !example.name.trim()) throw new Error("A walkthrough case needs a name");
  if (!Array.isArray(example.initialArtifacts) || example.initialArtifacts.some(id => typeof id !== "string" || !snapshot.artifacts.some(a => a.id === id))) {
    throw new Error("Case initialArtifacts must reference declared artifacts");
  }
  const conditions = { ...example.conditions };
  if (Object.values(conditions).some(value => typeof value !== "boolean")) throw new Error("Case conditions must be boolean facts");
  const result: WalkthroughResult = {
    snapshot, case: example, status: "complete", steps: [], questions: [], waits: [], outcomes: [],
    availableArtifacts: [], assumptions: structuredClone(example.assumptions ?? []), maxSteps,
  };
  for (const assumption of result.assumptions) {
    if (assumption.status !== "active" && assumption.status !== "retracted") throw new Error("Assumption status must be active or retracted");
    if (assumption.status === "retracted" || assumption.condition === undefined) continue;
    if (typeof assumption.value !== "boolean") throw new Error("A condition assumption needs a boolean value");
    if (Object.hasOwn(conditions, assumption.condition) && conditions[assumption.condition] !== assumption.value) {
      result.questions.push({ reason: `Assumption ${assumption.id} contradicts another value for condition "${assumption.condition}".` });
    } else Object.defineProperty(conditions, assumption.condition, { value: assumption.value, enumerable: true, configurable: true });
  }
  const jobs = snapshot.jobs.filter(job => !job.removed && !job.parent);
  const byId = new Map(jobs.map(job => [job.id, job]));
  const available = new Set(example.initialArtifacts);
  const executed = new Map<string, number>();
  const blocked = new Set<string>();
  const activated = new Set<string>();
  const controlled = new Set(jobs.flatMap(job => [
    ...(job.exits ?? []).flatMap(exit => exit.target && exit.target !== "stop" ? [exit.target] : []),
    ...(job.loop?.then && job.loop.then !== "stop" ? [job.loop.then] : []),
  ]));
  let repeats = new Set<string>();
  let round = 0;
  const question = (job: Job, reason: string) => { result.questions.push({ jobId: job.id, reason }); blocked.add(job.id); };
  const has = (record: Record<string, unknown> | undefined, key: string) => record !== undefined && Object.hasOwn(record, key);
  const targetExists = (target: string) => target === "stop" || byId.has(target);
  if (result.questions.length === 0) while (true) {
    const before = [...available];
    const ready: { job: Job; exit?: WalkthroughStep["exit"]; loop?: WalkthroughStep["loop"] }[] = [];
    result.waits = [];
    for (const job of jobs) {
      if (blocked.has(job.id) || (executed.has(job.id) && !repeats.has(job.id))) continue;
      if (controlled.has(job.id) && !activated.has(job.id)) continue;
      try {
        if (job.prerequisites) validatePrerequisites(job.prerequisites, { board: snapshot, job });
      } catch (error) { question(job, error instanceof Error ? error.message : String(error)); continue; }
      const assessment = assessPrerequisites(job.prerequisites, before, conditions);
      if (assessment.status === "unresolved") { question(job, assessment.reasons.join(" ")); continue; }
      if (assessment.status === "waiting") { result.waits.push({ jobId: job.id, reason: assessment.reasons.join(" ") }); continue; }
      if (job.outputs.some(id => !snapshot.artifacts.some(artifact => artifact.id === id))) { question(job, "An output references an unknown artifact."); continue; }
      let exit: WalkthroughStep["exit"];
      if (job.exits?.length) {
        if (!has(example.exitChoices, job.id)) { question(job, "Choose a declared exit condition for this case."); continue; }
        const matches = job.exits.filter(candidate => candidate.condition === example.exitChoices?.[job.id]);
        if (matches.length !== 1) { question(job, "The selected exit condition must identify exactly one declared exit."); continue; }
        const selected = matches[0];
        if (!selected.target || !targetExists(selected.target)) { question(job, "The selected exit destination is unresolved."); continue; }
        if (has(conditions, selected.condition) && !conditions[selected.condition]) { question(job, "The chosen exit contradicts the supplied condition value."); continue; }
        if (selected.target !== "stop" && (selected.target === job.id || executed.has(selected.target))) { question(job, "This exit revisits work without an explicit bounded retry."); continue; }
        exit = { condition: selected.condition, target: selected.target };
      } else if (job.gate) { question(job, "This decision has no declared exits."); continue; }
      let loop: WalkthroughStep["loop"];
      if (job.loop) {
        if (exit) { question(job, "The relationship between this exit and retry is unspecified."); continue; }
        if (!has(example.loopChoices, job.id) || typeof example.loopChoices?.[job.id] !== "boolean") { question(job, "Specify whether this case takes the declared retry."); continue; }
        if (!example.loopChoices[job.id]) loop = { action: "skip" };
        else {
          if (!Number.isInteger(job.loop.limit) || (job.loop.limit ?? -1) < 0) { question(job, "The retry has no explicit non-negative integer limit."); continue; }
          if (job.loop.to !== job.id) { question(job, "A multi-job retry needs explicit reset semantics; the path is unresolved."); continue; }
          const count = executed.get(job.id) ?? 0;
          if (count < (job.loop.limit ?? 0)) loop = { action: "repeat", target: job.id };
          else {
            if (!job.loop.then || !targetExists(job.loop.then) || job.loop.then === job.id) { question(job, "The retry limit is reached but its onward destination is unresolved; then must name an active job ID or stop."); continue; }
            loop = { action: "limit", target: job.loop.then };
          }
        }
      }
      ready.push({ job, exit, loop });
    }
    if (ready.length === 0) break;
    round++;
    repeats = new Set();
    for (const { job, exit, loop } of ready) {
      if (result.steps.length >= maxSteps) { result.status = "engine-limit"; result.questions.push({ reason: `The technical engine limit of ${maxSteps} steps was reached; this is not a modelled outcome.` }); break; }
      const occurrence = (executed.get(job.id) ?? 0) + 1;
      executed.set(job.id, occurrence);
      result.steps.push({ index: result.steps.length + 1, round, jobId: job.id, occurrence, availableBefore: [...before], outputs: [...job.outputs], ...(exit ? { exit } : {}), ...(loop ? { loop } : {}) });
      for (const id of job.outputs) available.add(id);
      const target = exit?.target ?? loop?.target;
      if (loop?.action === "repeat") repeats.add(job.id);
      else if (target === "stop") result.outcomes.push({ jobId: job.id, kind: "stop", description: job.outcome });
      else if (target) activated.add(target);
      else result.outcomes.push({ jobId: job.id, kind: "modelled-completion", description: job.outcome });
    }
    if (result.status === "engine-limit") break;
  }
  result.availableArtifacts = [...available];
  // Unselected branches are legitimate, but a disconnected control cycle has
  // no possible entrance. Work elsewhere must not hide that unresolved component.
  const reachable = new Set(jobs.filter(job => !controlled.has(job.id)).map(job => job.id));
  const frontier = [...reachable];
  for (let index = 0; index < frontier.length; index++) {
    const job = byId.get(frontier[index]);
    if (!job) continue;
    for (const target of [...(job.exits ?? []).map(exit => exit.target), job.loop?.then]) {
      if (target && byId.has(target) && !reachable.has(target)) { reachable.add(target); frontier.push(target); }
    }
  }
  for (const job of jobs) if (!reachable.has(job.id)) {
    result.questions.push({ jobId: job.id, reason: "No declared entrance can activate this control-flow component; it may be cyclic." });
  }
  if (jobs.length > 0 && result.steps.length === 0 && result.questions.length === 0 && result.waits.length === 0) {
    result.questions.push({ reason: "No declared entrance can activate this case; the control flow may be cyclic." });
  }
  if (result.status !== "engine-limit") result.status = result.questions.length ? "unresolved" : result.waits.length ? "waiting" : "complete";
  return result;
}
