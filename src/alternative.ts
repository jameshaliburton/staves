import { validateVocabulary } from "./vocabulary.js";
import type { Board, Job } from "./model.js";
import { validatePrerequisites } from "./flow.js";

export interface AlternativeChange {
  entity: "board" | "job" | "track" | "artifact" | "region";
  id: string;
  field: string;
  before: unknown;
  after: unknown;
}
export interface AlternativeConflict extends AlternativeChange { current: unknown }
export interface AlternativePreview {
  sourceBoard: string;
  alternativeBoard: string;
  baselineId: string;
  /** Exact canonical review token, not a cryptographic signature or authorization. */
  basis: string;
  changes: AlternativeChange[];
  conflicts: AlternativeConflict[];
  problems: string[];
  canAccept: boolean;
}
const runtime = new Set(["status", "confirmedFields", "provenance", "implementation", "executionEvidence", "sources", "movedFrom"]);
const contextRuntime = new Set(["langfuse", "agentProgress"]);
type RecordValue = Record<string, unknown>;
function record(value: object): RecordValue { return value as RecordValue; }
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function designJob(job: Job): RecordValue { return Object.fromEntries(Object.entries(job).filter(([key]) => !runtime.has(key))); }
function designContext(board: Board): RecordValue { return Object.fromEntries(Object.entries(board.context ?? {}).filter(([key]) => !contextRuntime.has(key))); }
function design(board: Board): RecordValue {
  return {
    vocabulary: board.vocabulary, goal: board.goal, perWeek: board.perWeek, intent: board.intent, context: designContext(board),
    jobs: board.jobs.map(designJob).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    tracks: [...board.tracks].sort((a, b) => a.id.localeCompare(b.id)),
    artifacts: [...board.artifacts].sort((a, b) => a.id.localeCompare(b.id)),
    regions: [...board.regions].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
function assertLineage(source: Board, alternative: Board, baseline: Board): void {
  if (!alternative.baseline?.pinned || source.baseline?.pinned === false) throw new Error("Acceptance requires an immutable pinned alternative and a non-legacy source.");
  if (source.id !== alternative.baseline.sourceBoard || baseline.id !== source.id || source.id === alternative.id || baseline.base || (baseline.baseline && !equal(baseline.baseline, alternative.baseline))) throw new Error("The alternative does not belong to this source baseline.");
}
function referenceProblems(board: Board): string[] {
  const problems: string[] = [];
  if (board.vocabulary) try { validateVocabulary(board.vocabulary, board); } catch (error) { problems.push(String(error)); }
  const jobs = new Set(board.jobs.filter(j => !j.removed).map(j => j.id));
  const tracks = new Set(board.tracks.filter(t => !t.removed).map(t => t.id));
  const artifacts = new Set(board.artifacts.map(a => a.id));
  for (const job of board.jobs.filter(j => !j.removed)) {
    for (const id of [job.track, job.gate?.accountable === "rule" ? undefined : job.gate?.accountable, job.gate?.ruleOwner].filter((id): id is string => !!id)) if (!tracks.has(id)) problems.push(`Job ${job.id} references missing performer ${id}.`);
    for (const id of [...job.inputs, ...job.outputs]) if (!artifacts.has(id)) problems.push(`Job ${job.id} references missing artifact ${id}.`);
    for (const id of [job.parent, job.loop?.to, job.correctionTo, ...(job.exits ?? []).map(exit => exit.target === "stop" ? undefined : exit.target)].filter((id): id is string => !!id)) if (!jobs.has(id)) problems.push(`Job ${job.id} references missing job ${id}.`);
    if (job.prerequisites) try { validatePrerequisites(job.prerequisites, { board, job }); } catch (error) { problems.push(`Job ${job.id}: ${String(error)}`); }
    const ancestors = new Set([job.id]);
    let parent = job.parent;
    while (parent) {
      if (ancestors.has(parent)) { problems.push(`Job ${job.id} has a cyclic parent relationship.`); break; }
      ancestors.add(parent); parent = board.jobs.find(j => j.id === parent)?.parent;
    }
  }
  for (const region of board.regions.filter(r => !r.removed)) for (const id of region.members) if (!jobs.has(id)) problems.push(`Region ${region.id} references missing job ${id}.`);
  return [...new Set(problems)].sort();
}
function prepare(source: Board, alternative: Board, baseline: Board): { preview: AlternativePreview; merged: Board } {
  assertLineage(source, alternative, baseline);
  const merged = structuredClone(source);
  const changes: AlternativeChange[] = [], conflicts: AlternativeConflict[] = [];
  function mergeFields(entity: AlternativeChange["entity"], id: string, before: RecordValue, after: RecordValue, current: RecordValue, target: RecordValue): void {
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (equal(before[field], after[field])) continue;
      const change = { entity, id, field, before: structuredClone(before[field]), after: structuredClone(after[field]) };
      changes.push(change);
      if (!equal(current[field], before[field]) && !equal(current[field], after[field])) { conflicts.push({ ...change, current: structuredClone(current[field]) }); continue; }
      if (after[field] === undefined) delete target[field]; else target[field] = structuredClone(after[field]);
    }
  }
  mergeFields("board", source.id, { vocabulary: baseline.vocabulary, goal: baseline.goal, perWeek: baseline.perWeek, intent: baseline.intent }, { vocabulary: alternative.vocabulary, goal: alternative.goal, perWeek: alternative.perWeek, intent: alternative.intent }, record(source), record(merged));
  const context = { ...(merged.context ?? {}) };
  mergeFields("board", source.id, designContext(baseline), designContext(alternative), designContext(source), record(context));
  if (Object.keys(context).length) merged.context = context;
  else delete merged.context;
  for (const [collection, entity] of [["tracks", "track"], ["artifacts", "artifact"], ["jobs", "job"], ["regions", "region"]] as const) {
    const before = new Map(baseline[collection].map(item => [item.id, entity === "job" ? designJob(item as Job) : record(item)]));
    const after = new Map(alternative[collection].map(item => [item.id, entity === "job" ? designJob(item as Job) : record(item)]));
    const list = merged[collection] as { id: string }[];
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id), next = after.get(id);
      if (equal(old, next)) continue;
      const index = list.findIndex(item => item.id === id), existing = list[index];
      const current = existing ? (entity === "job" ? designJob(existing as Job) : record(existing)) : undefined;
      if (!old || !next || !current || (old.removed !== next.removed && next.removed === true) || (current.removed === true && old.removed !== true)) {
        const change: AlternativeChange = { entity, id, field: "*", before: structuredClone(old), after: structuredClone(next) };
        changes.push(change);
        if (!equal(current, old) && !equal(current, next)) { conflicts.push({ ...change, current: structuredClone(current) }); continue; }
        if (equal(current, next)) continue;
        if (!next) {
          if (entity === "artifact") list.splice(index, 1);
          else record(existing).removed = true;
        } else {
          const addition = structuredClone(next);
          if (entity === "job") {
            if (existing) {
              for (const key of runtime) if (record(existing)[key] !== undefined) addition[key] = structuredClone(record(existing)[key]);
            }
            if (!existing) Object.assign(addition, { status: "draft", provenance: { source: "human" } });
          }
          if (index < 0) list.push(addition as { id: string }); else list[index] = addition as { id: string };
        }
      } else {
        const priorChanges = changes.length;
        mergeFields(entity, id, old, next, current, record(existing));
        if (entity === "job") {
          const changedFields = changes.slice(priorChanges).filter(change => !equal(current[change.field], change.after)).map(change => change.field);
          if (changedFields.length) {
            const job = existing as Job;
            job.status = "draft";
            if (job.confirmedFields) job.confirmedFields = job.confirmedFields.filter(field => !changedFields.includes(field));
          }
        }
      }
    }
  }
  const priorProblems = new Set(referenceProblems(source));
  const problems = referenceProblems(merged).filter(problem => !priorProblems.has(problem));
  const basis = canonical({ source: design(source), alternative: design(alternative), baseline: design(baseline), lineage: alternative.baseline });
  return { merged, preview: { sourceBoard: source.id, alternativeBoard: alternative.id, baselineId: alternative.baseline!.pinned ? alternative.baseline!.id : "", basis, changes, conflicts, problems, canAccept: conflicts.length === 0 && problems.length === 0 } };
}

/** The caller must load the immutable baseline from storage, never from a client payload. */
export function previewAlternative(source: Board, alternative: Board, baseline: Board): AlternativePreview {
  return prepare(source, alternative, baseline).preview;
}

/** Call inside the source write lock and reload both designs before checking the review token. */
export function acceptAlternative(source: Board, alternative: Board, baseline: Board, expectedBasis: string): Board {
  const { preview, merged } = prepare(source, alternative, baseline);
  if (preview.basis !== expectedBasis) throw new Error("The source or alternative design changed. Review the comparison again.");
  if (!preview.canAccept) throw new Error("The alternative has conflicts or invalid references. Reconcile it before acceptance.");
  return merged;
}
