import type { Board } from "./model.js";
import type { Entry, Op } from "./ops.js";
import { assessmentOptionsSchema } from "./assessment.js";
import { walkThrough, type WalkthroughCase, type WalkthroughResult } from "./walkthrough.js";

export interface WalkthroughRun {
  id: string;
  actor: string;
  at: string;
  sourceRevision: number;
  /** Versioned canonical design content, not a cryptographic signature. */
  basis: string;
  omittedPendingProposals: number;
  result: WalkthroughResult;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

/** Reports, conversation and observation receipts do not change model semantics. */
export function walkthroughBasis(board: Board): string {
  const design = structuredClone(board);
  design.comments = [];
  if (design.context) { delete design.context.agentProgress; delete design.context.langfuse; }
  for (const job of design.jobs) {
    delete job.implementation;
    delete job.executionEvidence;
    delete job.confirmedFields;
    job.status = "draft";
    job.provenance = { source: "derived" };
  }
  return `v1:${canonical(design)}`;
}

export function createWalkthroughRun(board: Board, revision: number, example: WalkthroughCase, actor: string, at: string, id: string, maxSteps?: number, omittedPendingProposals = 0): WalkthroughRun {
  if (!id?.trim() || !actor?.trim() || !Number.isFinite(Date.parse(at))) throw new Error("A walkthrough needs an ID, actor and timestamp.");
  if (!Number.isInteger(revision) || revision < 0) throw new Error("Invalid walkthrough source revision.");
  if (!Number.isInteger(omittedPendingProposals) || omittedPendingProposals < 0) throw new Error("Invalid omitted proposal count.");
  const parsed = assessmentOptionsSchema.shape.cases.unwrap().element.parse(example);
  const active = new Set(board.jobs.filter(job => !job.removed && !job.parent).map(job => job.id));
  if ([...Object.keys(parsed.exitChoices ?? {}), ...Object.keys(parsed.loopChoices ?? {})].some(job => !active.has(job))) throw new Error("Case choices must reference active top-level jobs.");
  const snapshot = structuredClone(board);
  // No recursive captures of earlier runs or assessment packets through comments.
  snapshot.comments = [];
  return { id, actor, at, sourceRevision: revision, basis: walkthroughBasis(snapshot), omittedPendingProposals, result: walkThrough(snapshot, parsed, { maxSteps }) };
}

/** Ingestion recomputes the path; caller-supplied outcomes confer no authority. */
export function normalizeWalkthroughRecord(board: Board, run: WalkthroughRun, actor: string, at: string, revision: number, omittedPendingProposals = 0): WalkthroughRun {
  if (!run?.result?.snapshot || run.result.snapshot.id !== board.id || typeof run.basis !== "string") throw new Error("Walkthrough must reference this board.");
  if (walkthroughBasis(board) !== run.basis) throw new Error("The design changed while this walkthrough was prepared. Run the case again.");
  return createWalkthroughRun(board, revision, run.result.case, actor, at, run.id, run.result.maxSteps, omittedPendingProposals);
}

/** Reserve run identities through removal, undo and imported baseline history. */
export function protectWalkthroughHistory(board: Board, entries: Entry[], op: Op): void {
  const records = [...board.comments, ...entries.flatMap(entry => entry.op.t === "comment" ? [entry.op.comment] : entry.op.t === "baseline" ? entry.op.snapshot.comments : [])].filter(comment => comment.walkthrough);
  if ((op.t === "removeComment" || (op.t === "revert" && op.entity === "comment")) && records.some(comment => comment.id === op.id)) throw new Error("Walkthrough history is immutable. Run a new case or add a correction.");
  if (op.t === "comment" && records.some(comment => comment.id === op.comment.id)) throw new Error("Walkthrough history is immutable. Save a new run.");
  if (op.t === "comment" && op.comment.walkthrough && records.some(comment => comment.walkthrough?.id === op.comment.walkthrough?.id)) throw new Error("Walkthrough identity has already been used. Save a new run.");
}
