import { z } from "zod";
import type { Board } from "./model.js";
import type { Entry, Op } from "./ops.js";

const text = z.string().trim().min(1).max(2000);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/i, "Use a full commit ID");
const timestamp = text.refine(value => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const safeUrl = text.refine(value => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }, "Use an HTTPS repository or PR URL without credentials, query or fragment");
export const gitContextSchema = z.object({
  source: z.literal("local-git"), observedAt: timestamp,
  repository: z.object({ origin: text.nullable() }).strict(),
  branch: text.nullable(), head: commit.nullable(), unborn: z.boolean(), worktree: z.boolean(),
  dirty: z.object({ tracked: z.number().int().nonnegative(), untracked: z.number().int().nonnegative(), isDirty: z.boolean() }).strict(),
  base: z.object({ ref: text, commit, isAncestorOfHead: z.boolean().nullable() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.unborn !== (value.head === null)) ctx.addIssue({ code: "custom", message: "Unborn state must agree with HEAD" });
  if (value.dirty.isDirty !== (value.dirty.tracked + value.dirty.untracked > 0)) ctx.addIssue({ code: "custom", message: "Dirty state must agree with file counts" });
  const origin = value.repository.origin;
  if (origin && (!/^(https?|ssh|git):\/\//.test(origin) || /[?#]/.test(origin))) ctx.addIssue({ code: "custom", message: "Repository origin must be a sanitized network URL" });
  if (origin) try { const url = new URL(origin); if (url.username || url.password) ctx.addIssue({ code: "custom", message: "Repository origin must not contain credentials" }); } catch { ctx.addIssue({ code: "custom", message: "Invalid repository origin" }); }
});
export const developmentOptionsSchema = z.object({
  requestId: text.optional(),
  git: gitContextSchema,
  pullRequest: z.object({ url: safeUrl, state: z.enum(["unknown", "open", "closed", "merged"]).default("unknown"), headCommit: commit.optional(), mergeCommit: commit.optional(), checkedAt: timestamp.optional() }).strict().optional(),
  note: z.string().max(4000).default(""),
  supersedes: text.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.pullRequest && value.pullRequest.state !== "unknown" && !value.pullRequest.checkedAt) ctx.addIssue({ code: "custom", message: "A reported PR state needs its check time" });
  if (value.pullRequest?.state === "merged" && !value.pullRequest.mergeCommit) ctx.addIssue({ code: "custom", message: "A reported merge requires its commit" });
});
export type DevelopmentOptions = z.input<typeof developmentOptionsSchema>;
export interface DevelopmentRecord {
  id: string;
  recordedBy: string;
  recordedAt: string;
  designRevision: number;
  /** The gateway records this report; it has not independently checked Git or PR state. */
  evidence: "development-report";
  options: z.output<typeof developmentOptionsSchema>;
}

export function normalizeDevelopmentRecord(board: Board, record: DevelopmentRecord, actor: string, at: string, revision: number): DevelopmentRecord {
  if (!record?.id?.trim()) throw new Error("Development record identity is required.");
  const options = developmentOptionsSchema.parse(record.options);
  if (options.requestId && !board.comments.some(comment => comment.assessment?.kind === "request" && comment.assessment.request.id === options.requestId)) throw new Error("Development link requires an existing assessment or implementation request.");
  if (options.supersedes) {
    const prior = board.comments.find(comment => comment.development?.id === options.supersedes)?.development;
    if (!prior || prior.options.requestId !== options.requestId || prior.options.git.repository.origin !== options.git.repository.origin) throw new Error("A refreshed development link must retain its request and repository.");
    if (board.comments.some(comment => comment.development?.options.supersedes === options.supersedes)) throw new Error("Refresh the latest development link.");
    if (Date.parse(options.git.observedAt) <= Date.parse(prior.options.git.observedAt)) throw new Error("A refreshed Git observation must be newer.");
  }
  return { id: record.id, recordedBy: actor, recordedAt: at, designRevision: revision, evidence: "development-report", options };
}

export function protectDevelopmentHistory(board: Board, entries: Entry[], op: Op): void {
  const records = [...board.comments, ...entries.flatMap(entry => entry.op.t === "comment" ? [entry.op.comment] : entry.op.t === "baseline" ? entry.op.snapshot.comments : [])].filter(comment => comment.development);
  if ((op.t === "removeComment" || op.t === "revert" && op.entity === "comment") && records.some(comment => comment.id === op.id)) throw new Error("Development history is immutable. Add a new report or correction.");
  if (op.t === "comment" && (records.some(comment => comment.id === op.comment.id) || op.comment.development && records.some(comment => comment.development?.id === op.comment.development?.id))) throw new Error("Development record identity has already been used.");
}
