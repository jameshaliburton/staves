import { validateVocabulary } from "./vocabulary.js";
import { mostlyInferred } from "./ledger.js";
import { isHumanEvidenceActor } from "./evidence-lifecycle.js";
import { acceptAlternative } from "./alternative.js";
import { executionEvidenceKey } from "./langfuse.js";
import { validateProposalDecision, type ProposalBasis } from "./proposals.js";
import { validatePrerequisites } from "./flow.js";
import { validateBaseline, type BaselineMetadata } from "./baseline.js";
import type { Artifact, Board, Comment, ExecutionEvidence, Id, Job, Question, Region, Track } from "./model.js";
import type { HandoverPlacement } from "./handover.js";
import { ulid } from "./ulid.js";
import { emptyBoard } from "./model.js";

/**
 * The board is an append-only log of operations. A snapshot is fold(ops).
 * Agents propose; people commit. In v0.1 every op applies immediately but
 * carries provenance, so the queue can be added later without changing the log.
 */
export interface HandoverSnapshot {
  jobs: (Job | { id: string; absent: true })[];
  artifacts: (Artifact | { id: string; absent: true })[];
}

export type Op =
  | { t: "setVocabulary"; vocabulary: import("./vocabulary.js").DomainVocabulary }
  | { t: "acceptAlternative"; alternative: Board; baseline: Board; expectedBasis: string }
  | { t: "baseline"; baseline: BaselineMetadata; snapshot: Board }
  | { t: "handover"; jobId: string; toTrack: string; placement?: HandoverPlacement; basis: string; before: HandoverSnapshot; after: HandoverSnapshot }
  | { t: "restoreHandover"; of: string; snapshot: HandoverSnapshot; inverse: HandoverSnapshot }
  | { t: "board"; id: Id; title: string; goal?: string; origin?: string }
  | { t: "setGoal"; goal: string }
  | { t: "track"; track: Track }
  | { t: "artifact"; artifact: Artifact }
  | { t: "job"; job: Job }
  | { t: "addExecutionEvidence"; id: Id; evidence: ExecutionEvidence }
  | { t: "retractExecutionEvidence"; id: Id; key: string; reason: string }
  | { t: "updateJob"; id: Id; patch: Partial<Job> }
  | { t: "removeJob"; id: Id; replacedBy?: Id }
  | { t: "confirmField"; id: Id; field: string; by?: string }
  | { t: "split"; id: Id; tasks: { id: Id; name: string; track?: Id }[] }
  | { t: "collect"; id: Id; name: string; track: Id; into: Id[] }
  | { t: "uncollect"; id: Id }
  | { t: "reorder"; id: Id; before?: Id; after?: Id }
  | { t: "removeTrack"; id: Id }
  | { t: "ask"; question: Question }
  | { t: "answer"; id: Id; answer: string; by: "agent" | "human"; who?: string }
  | { t: "confirm"; id: Id; by?: string }
  | { t: "comment"; comment: Comment }
  | { t: "removeComment"; id: Id }
  | { t: "setVolume"; perWeek: number }
  | { t: "setIntent"; intent: Board["intent"] }
  | { t: "base"; board: Id }
  | { t: "accept"; seq: number; by?: string }
  | { t: "reject"; seq: number; by?: string; why?: string }
  | { t: "setContext"; context: NonNullable<Board["context"]> }
  /** what the interview has settled, so a conversation that starts again does not start over */
  | { t: "settle"; class: import("./ledger.js").LedgerClass; settled: boolean; by: "human" | "staves"; quote?: string; basis?: string }
  | { t: "region"; region: Region }
  | { t: "regionMembers"; id: Id; add?: Id[]; remove?: Id[] }
  | { t: "removeRegion"; id: Id }
  | { t: "issue"; id: Id; status: NonNullable<Question["status"]>; by?: string }
  /** undo: restore an entity to the state it had before the entry `of` */
  | { t: "revert"; of: string; entity: "job" | "track" | "region" | "artifact" | "question" | "comment"; id: Id; prior: unknown | null; relatedJobs?: Job[]; expectedJobs?: Job[] };

/** Schema version written on every new entry. Migrations bring older entries up at fold time. */
export const SCHEMA = 2;

/** What a suggestion is, in the words it came from. A proposal records an op; this records why anyone
 *  should believe it — the person's own words, and how sure the interviewer was. It travels with the
 *  proposal so a collaborator, or a coding agent reading the board, sees the same card the author saw. */
export interface Suggestion {
  name: string;
  quote?: string;
  detail?: string;
  /** "said" their words outright, "implied" an assumption to review, "asked" an open question */
  confidence?: "said" | "implied" | "asked";
  /** the card kind the interview used: who, job, task, outcome, exit … */
  type?: string;
  warning?: string;
}

export interface Entry {
  seq: number;
  /** globally unique, time-ordered; the identity of the entry across machines (seq is only local order) */
  id?: string;
  /** schema version the entry was written with */
  v?: number;
  at: string;
  by: string;
  op: Op;
  /** a proposal: not part of the board until a person accepts it */
  pending?: boolean;
  /** Applied state captured when a new proposal was authored; absent on legacy logs. */
  proposalBasis?: ProposalBasis;
  /** the card this proposal came from, when a suggestion made it */
  suggestion?: Suggestion;
  /** ids of entities this op assumed existed; on merge, an op whose basis is gone becomes a proposal */
  basis?: Id[];
  /** set on merge: this op was demoted to a proposal because its basis had changed elsewhere */
  demoted?: boolean;
}

/** Bring an entry written by an older version up to the current schema. Idempotent. */
export function migrate(e: Entry): Entry {
  const v = e.v ?? 1;
  let out = e;
  if (v < 2) {
    // v1 → v2: entries have no id; questions have no status; there are no regions
    out = { ...out, id: out.id ?? `legacy-${out.seq}`, v: 2 };
    if (out.op.t === "ask" && !out.op.question.status) out = { ...out, op: { ...out.op, question: { ...out.op.question, status: "raised" } } };
  }
  return out;
}

/** Rule 2 at the write boundary: a job that cannot say where it came from is refused, not stored.
 *  Stored, every later read fails — lint reads provenance.source on each board load — so one bad op
 *  makes the board unreadable. The vocabulary itself is not policed here: production writes sources
 *  ("interview", "import") that ProvenanceSource does not declare. */
export function validateOpShape(op: Op): void {
  if (op.t !== "job") return;
  const source = (op.job as { provenance?: { source?: unknown } } | undefined)?.provenance?.source;
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("A job must say where it came from: give it a provenance.source.");
  }
}

/** The ids a structural op assumes exist. */
export function basisOf(op: Op): Id[] {
  switch (op.t) {
    case "addExecutionEvidence": case "retractExecutionEvidence": case "updateJob": case "removeJob": case "confirmField": case "split": case "uncollect": case "reorder": case "confirm": return [op.id];
    case "collect": return op.into;
    case "handover": return [op.jobId, op.toTrack];
    case "regionMembers": case "removeRegion": return [op.id];
    case "answer": case "issue": return [op.id];
    default: return [];
  }
}

/** Proposals: pending entries that have not been accepted or rejected. */
export function pending(entries: Entry[]): Entry[] {
  const decided = new Set<number>();
  for (const e of entries) if (e.op.t === "accept" || e.op.t === "reject") decided.add(e.op.seq);
  return entries.filter((e) => e.pending && !decided.has(e.seq));
}

export function fold(entries: Entry[], baseEntries?: Entry[] | Board): Board {
  entries = structuredClone(entries);
  if (baseEntries) baseEntries = structuredClone(baseEntries);
  const pins = entries.filter(e => e.op.t === "baseline");
  if (pins.length && (pins.length !== 1 || entries[0] !== pins[0] || pins[0].pending || entries.some(e => e.op.t === "base"))) throw new Error("Baseline must be the single immutable initialization operation.");
  let b: Board = baseEntries && !pins.length ? (Array.isArray(baseEntries) ? fold(baseEntries) : structuredClone(baseEntries)) : emptyBoard("board");
  const restore = (snapshot: HandoverSnapshot) => {
    for (const j of snapshot.jobs) { const i = b.jobs.findIndex(x => x.id === j.id); if ("absent" in j) { if (i >= 0) b.jobs.splice(i, 1); } else if (i >= 0) b.jobs[i] = structuredClone(j); else b.jobs.push(structuredClone(j)); }
    for (const a of snapshot.artifacts) { const i = b.artifacts.findIndex(x => x.id === a.id); if ("absent" in a) { if (i >= 0) b.artifacts.splice(i, 1); } else if (i >= 0) b.artifacts[i] = structuredClone(a); else b.artifacts.push(structuredClone(a)); }
  };
  const apply = (list: Entry[]) => {
  const accepted = new Set(list.filter(e => !e.pending && e.op.t === "accept").map(e => (e.op as Extract<Op, { t: "accept" }>).seq));
  for (const e of list) {
    if (e.pending && (e.proposalBasis || e.op.t === "handover" || e.op.t === "addExecutionEvidence" || !accepted.has(e.seq))) continue;
    let effective = e;
    if (e.op.t === "accept" || e.op.t === "reject") {
      const prior = list.slice(0, list.indexOf(e));
      const proposal = prior.find(x => x.seq === (e.op as Extract<Op, { t: "accept" | "reject" }>).seq && x.pending);
      // Legacy alternatives inherit a mutable source. Their past decisions must remain readable;
      // write boundaries validate new decisions against current state before persistence.
      if (proposal?.proposalBasis && b.baseline?.pinned !== false) validateProposalDecision(prior, e.op, b);
      if (e.op.t === "accept" && proposal && (proposal.proposalBasis || proposal.op.t === "addExecutionEvidence")) effective = proposal;
    }
    const op = effective.op;
    switch (op.t) {
      case "acceptAlternative": b = acceptAlternative(b, op.alternative, op.baseline, op.expectedBasis); break;
      case "handover": restore(op.after); break;
      case "restoreHandover": restore(op.snapshot); break;
      case "accept": {
        const proposal = list.find(x => x.seq === op.seq && x.pending && x.op.t === "handover");
        if (proposal?.op.t === "handover") restore(proposal.op.after);
        break;
      }
      case "reject":
        break;
      case "baseline":
        validateBaseline(op.snapshot, op.baseline);
        b = structuredClone(op.snapshot);
        b.base = op.baseline.sourceBoard;
        b.baseline = structuredClone(op.baseline);
        break;
      case "base":
        b.baseline = { pinned: false, sourceBoard: op.board, name: "Unpinned legacy baseline" };
        b.base = op.board;
        break;
      case "setVocabulary":
        b.vocabulary = validateVocabulary(op.vocabulary, b);
        break;
      case "setVolume":
        b.perWeek = op.perWeek;
        break;
      case "setIntent":
        b.intent = op.intent;
        break;
      case "setContext":
        b.context = { ...(b.context ?? {}), ...op.context };
        break;
      case "settle":
        // Staves may draft a class, and staves may close one with judgment, but not both: a board that
        // certifies its own inference reports green on work nobody confirmed. Reopening is always
        // allowed, and the person may close anything they like.
        if (op.settled && op.by === "staves" && mostlyInferred(b, op.class)) break;
        b.settled = { ...(b.settled ?? {}), [op.class]: { settled: op.settled, by: op.by, quote: op.quote, basis: op.basis, at: effective.at } };
        break;
      case "region": {
        const r = b.regions.find((x) => x.id === op.region.id);
        if (r) Object.assign(r, op.region); else b.regions.push({ ...op.region, members: [...(op.region.members ?? [])] });
        break;
      }
      case "regionMembers": {
        const r = b.regions.find((x) => x.id === op.id);
        if (r) { for (const m of op.add ?? []) if (!r.members.includes(m)) r.members.push(m); if (op.remove) r.members = r.members.filter((m) => !op.remove!.includes(m)); }
        break;
      }
      case "removeRegion": {
        const r = b.regions.find((x) => x.id === op.id);
        if (r) r.removed = true;
        break;
      }
      case "issue": {
        const q = b.questions.find((x) => x.id === op.id);
        if (q) q.status = op.status;
        break;
      }
      case "revert": {
        if (op.relatedJobs) restore({ jobs: op.relatedJobs, artifacts: [] });
        const list = (op.entity === "job" ? b.jobs : op.entity === "track" ? b.tracks : op.entity === "region" ? b.regions : op.entity === "question" ? b.questions : op.entity === "comment" ? b.comments : b.artifacts) as any[];
        const i = list.findIndex((x) => x.id === op.id);
        if (op.prior === null) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = structuredClone(op.prior);
        else list.push(structuredClone(op.prior));
        break;
      }
      case "comment":
        upsert(b.comments, op.comment);
        break;
      case "removeComment":
        b.comments = b.comments.filter((c) => c.id !== op.id);
        break;
      case "board":
        Object.assign(b, { id: op.id, title: op.title, ...(op.goal !== undefined ? { goal: op.goal } : {}), ...(op.origin !== undefined ? { origin: op.origin } : {}) });
        break;
      case "setGoal":
        b.goal = op.goal;
        break;
      case "track":
        upsert(b.tracks, op.track);
        break;
      case "artifact":
        upsert(b.artifacts, op.artifact);
        break;
      case "job":
        upsert(b.jobs, op.job);
        break;
      case "addExecutionEvidence": {
        const job = b.jobs.find(item => item.id === op.id && !item.removed);
        if (!job || b.context?.langfuse?.projectId !== op.evidence.projectId) break;
        const references = job.executionEvidence ?? [];
        if (!references.some(item => sameExecutionEvidence(item, op.evidence)) && references.length < 100) {
          const captured = structuredClone(op.evidence);
          if (captured.mapping?.method === "proposed" && isHumanEvidenceActor(e.by)) {
            captured.mapping = { ...captured.mapping, method: "reviewed", reviewedBy: e.by, reviewedAt: e.at };
          }
          job.executionEvidence = [...references, captured];
        }
        break;
      }
      case "retractExecutionEvidence": {
        const reference = b.jobs.find(item => item.id === op.id)?.executionEvidence?.find(item => executionEvidenceKey(item) === op.key);
        if (reference && !reference.retraction) reference.retraction = { at: e.at, by: e.by, reason: op.reason };
        break;
      }
      case "updateJob": {
        const j = b.jobs.find((x) => x.id === op.id);
        if (j) {
          if (op.patch.track && op.patch.track !== j.track) j.movedFrom = j.movedFrom ?? j.track;
          for (const [k, v] of Object.entries(op.patch)) { if (v === null || v === undefined) delete (j as any)[k]; else (j as any)[k] = v; }
          if (op.patch.track && op.patch.track === j.movedFrom) delete j.movedFrom;
        }
        break;
      }
      case "removeJob": {
        const j = b.jobs.find((x) => x.id === op.id);
        if (j) { j.removed = true; j.replacedBy = op.replacedBy; for (const k of b.jobs) if (k.parent === j.id) k.removed = true; }
        break;
      }
      case "removeTrack": {
        const t = b.tracks.find((x) => x.id === op.id);
        if (t) t.removed = true;
        break;
      }
      case "confirmField": {
        const j = b.jobs.find((x) => x.id === op.id);
        if (j) {
          j.confirmedFields = [...new Set([...(j.confirmedFields ?? []), op.field])];
          const all = ["name", "outcome", "beneficiary", "doneWhen"].every((f) => j.confirmedFields!.includes(f));
          if (all) { j.status = "confirmed"; j.provenance = { source: "confirmed", by: op.by ?? effective.by, at: effective.at, confidence: 1 }; }
        }
        break;
      }
      case "split": {
        const j = b.jobs.find((x) => x.id === op.id);
        const human = effective.by === "human";
        if (j) for (const t of op.tasks) upsert(b.jobs, { id: t.id, name: t.name, track: t.track ?? j.track, parent: j.id, inputs: [], outputs: [], provenance: { source: human ? "human" : "agent", by: effective.by, at: effective.at }, status: human ? "confirmed" : "draft" });
        break;
      }
      case "collect": {
        const kids = b.jobs.filter((x) => op.into.includes(x.id));
        const inputs = [...new Set(kids.flatMap((k) => k.inputs).filter((a) => !kids.some((k) => k.outputs.includes(a))))];
        const outputs = [...new Set(kids.flatMap((k) => k.outputs).filter((a) => !kids.some((k) => k.inputs.includes(a)) || b.jobs.some((x) => !op.into.includes(x.id) && x.inputs.includes(a))))];
        const humanC = effective.by === "human";
        upsert(b.jobs, { id: op.id, name: op.name, track: op.track, inputs, outputs, provenance: { source: humanC ? "human" : "agent", by: effective.by, at: effective.at }, status: humanC ? "confirmed" : "draft" });
        for (const k of kids) { k.parent = op.id; k.replacedBy = undefined; }
        break;
      }
      case "reorder": {
        const j = b.jobs.find((x) => x.id === op.id);
        const ref = b.jobs.find((x) => x.id === (op.before ?? op.after));
        if (j && ref) {
          const idx = (x: Job) => x.order ?? b.jobs.indexOf(x);
          const sibs = b.jobs.filter((x) => x.parent === ref.parent && x.id !== j.id && !x.removed).sort((a, c) => idx(a) - idx(c));
          const i = sibs.indexOf(ref);
          const lo = op.before ? (i > 0 ? idx(sibs[i - 1]) : idx(ref) - 1) : idx(ref);
          const hi = op.before ? idx(ref) : (i + 1 < sibs.length ? idx(sibs[i + 1]) : idx(ref) + 1);
          j.order = (lo + hi) / 2;
          j.parent = ref.parent;
        }
        break;
      }
      case "uncollect": {
        const j = b.jobs.find((x) => x.id === op.id);
        if (j) { for (const k of b.jobs) if (k.parent === j.id) k.parent = j.parent; j.removed = true; }
        break;
      }
      case "ask":
        upsert(b.questions, op.question);
        break;
      case "answer": {
        const q = b.questions.find((x) => x.id === op.id);
        if (q) {
          q.answer = op.answer;
          q.answeredBy = op.who ?? op.by;
          q.status = "answered";
          // a human answer about a job makes that job's account human-stated
          const j = q.about ? b.jobs.find((x) => x.id === q.about) : undefined;
          if (j && op.by === "human" && j.provenance.source === "agent") j.provenance = { source: "human", by: effective.by, at: effective.at };
        }
        break;
      }
      case "confirm": {
        const j = b.jobs.find((x) => x.id === op.id);
        if (j) {
          delete j.movedFrom;
          j.status = "confirmed";
          j.provenance = { source: "confirmed", by: op.by ?? effective.by, at: effective.at, confidence: 1 };
        }
        break;
      }
    }
  }
  };
  apply(entries);
  for (const job of b.jobs) {
    if (job.prerequisites !== undefined) validatePrerequisites(job.prerequisites, { board: b, job });
  }
  if (b.vocabulary) validateVocabulary(b.vocabulary, b);
  return b;
}

function upsert<T extends { id: Id }>(arr: T[], item: T) {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = { ...arr[i], ...item };
  else arr.push(item);
}

/** Serialise one entry per line. */
export function encode(entries: Entry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
}
export function decode(text: string): Entry[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Entry);
}

/** Which entity an op touches, for undo. */
export function targetOf(op: Op): { entity: "job" | "track" | "region" | "artifact" | "question" | "comment"; id: string } | null {
  switch (op.t) {
    case "job": return { entity: "job", id: op.job.id };
    case "addExecutionEvidence": case "retractExecutionEvidence": case "updateJob": case "removeJob": case "confirmField": case "confirm": case "split": case "uncollect": case "reorder": return { entity: "job", id: op.id };
    case "collect": return { entity: "job", id: op.id };
    case "track": return { entity: "track", id: op.track.id };
    case "removeTrack": return { entity: "track", id: op.id };
    case "region": return { entity: "region", id: op.region.id };
    case "regionMembers": case "removeRegion": return { entity: "region", id: op.id };
    case "artifact": return { entity: "artifact", id: op.artifact.id };
    case "ask": return { entity: "question", id: op.question.id };
    case "answer": case "issue": return { entity: "question", id: op.id };
    case "comment": return { entity: "comment", id: op.comment.id };
    case "removeComment": return { entity: "comment", id: op.id };
    default: return null;
  }
}

/** The reference identity is stable even when an observation's summary later changes. */
export function sameExecutionEvidence(a: ExecutionEvidence, b: ExecutionEvidence): boolean {
  return executionEvidenceKey(a) === executionEvidenceKey(b);
}
