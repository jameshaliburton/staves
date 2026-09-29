import type { Board, Job } from "./model.js";
import type { Entry, Op } from "./ops.js";
import { handoverBasis } from "./handover.js";

/** Captured authoring state, not deployment approval or an execution permission. */
export interface ProposalBasis {
  version: 1;
  snapshot: string;
}

/** A suggestion or proposal no longer matches the work it was made against. */
export class StaleSuggestionError extends Error {}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
}

/** Capture only the state this operation reads or replaces. Never manufacture this on migration. */
export function captureProposalBasis(board: Board, op: Op): ProposalBasis {
  const job = (id: string) => board.jobs.find(x => x.id === id) ?? null;
  const entity = (key: "tracks" | "artifacts" | "regions" | "questions" | "comments", id: string) => board[key].find(x => x.id === id) ?? null;
  const jobScope = (id: string, next: Partial<Job>) => {
    const current = job(id);
    const versions = [current, next].filter((value): value is Partial<Job> => value !== null);
    const ids = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))].sort();
    const roles = ids(versions.flatMap(value => [value.track, value.gate?.ruleOwner, value.gate?.accountable === "rule" ? undefined : value.gate?.accountable]));
    const destinations = ids(versions.flatMap(value => [value.loop?.to, ...(value.exits ?? []).map(exit => exit.target === "stop" ? undefined : exit.target)]));
    const artifacts = ids(versions.flatMap(value => [...(value.inputs ?? []), ...(value.outputs ?? []), ...(value.prerequisites?.inputs ?? [])]));
    return { job: current, roles: roles.map(id => [id, entity("tracks", id)]), destinations: destinations.map(id => [id, job(id)]), artifacts: artifacts.map(id => [id, entity("artifacts", id)]) };
  };
  let scope: unknown;
  switch (op.t) {
    case "updateJob": scope = jobScope(op.id, op.patch); break;
    case "confirm": case "confirmField": scope = job(op.id); break;
    case "job": scope = jobScope(op.job.id, op.job); break;
    case "addExecutionEvidence": scope = [job(op.id), board.context?.langfuse]; break;
    case "removeJob": case "uncollect": scope = [job(op.id), board.jobs.filter(j => j.parent === op.id)]; break;
    case "split": scope = [job(op.id), op.tasks.map(t => job(t.id))]; break;
    case "collect": case "reorder": scope = board.jobs; break;
    case "track": scope = entity("tracks", op.track.id); break;
    case "removeTrack": scope = entity("tracks", op.id); break;
    case "artifact": scope = entity("artifacts", op.artifact.id); break;
    case "region": scope = entity("regions", op.region.id); break;
    case "regionMembers": case "removeRegion": scope = entity("regions", op.id); break;
    case "ask": scope = entity("questions", op.question.id); break;
    case "issue": scope = entity("questions", op.id); break;
    case "answer": {
      const question = board.questions.find(q => q.id === op.id);
      scope = [question ?? null, question?.about ? job(question.about) : null]; break;
    }
    case "comment": scope = entity("comments", op.comment.id); break;
    case "removeComment": scope = entity("comments", op.id); break;
    case "board": scope = [board.id, board.title, op.goal === undefined ? null : board.goal, op.origin === undefined ? null : board.origin]; break;
    case "setVocabulary": scope = [board.vocabulary ?? null, op.vocabulary.concepts.flatMap(c => c.links ?? []).map(link => [link, link.kind === "job" ? job(link.id) : entity(link.kind === "track" ? "tracks" : "artifacts", link.id)])]; break;
    case "setGoal": scope = board.goal ?? null; break;
    case "setVolume": scope = board.perWeek ?? null; break;
    case "setIntent": scope = board.intent ?? null; break;
    case "setContext": scope = Object.fromEntries(Object.keys(op.context).map(key => [key, board.context?.[key as keyof NonNullable<Board["context"]>] ?? null])); break;
    case "handover": scope = handoverBasis(board); break;
    default: scope = board;
  }
  return { version: 1, snapshot: canonical(scope) };
}

type Scope = { job: unknown; roles: [string, unknown][]; destinations: [string, unknown][]; artifacts: [string, unknown][] };
const isScope = (value: unknown): value is Scope => !!value && typeof value === "object" && "job" in value
  && (["roles", "destinations", "artifacts"] as const).every(key => { const list = (value as Record<string, unknown>)[key]; return Array.isArray(list) && list.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string"); });

/** Job bases: the job itself and dependencies that existed must match; a dependency absent at capture may since have been added. */
function dependenciesAppeared(captured: string, current: string): boolean {
  let before: unknown, after: unknown;
  try { before = JSON.parse(captured); after = JSON.parse(current); } catch { return false; }
  if (!isScope(before) || !isScope(after) || canonical(before.job) !== canonical(after.job)) return false;
  return (["roles", "destinations", "artifacts"] as const).every(key => before[key].length === after[key].length
    && before[key].every(([id, was], index) => after[key][index][0] === id && (was === null || canonical(was) === canonical(after[key][index][1]))));
}

function basisHolds(board: Board, op: Op, basis: ProposalBasis | undefined): boolean {
  if (!basis || basis.version !== 1) return false;
  const current = captureProposalBasis(board, op).snapshot;
  return basis.snapshot === current || ((op.t === "job" || op.t === "updateJob") && dependenciesAppeared(basis.snapshot, current));
}

/** Validate against applied state immediately before the decision is persisted. */
export function validateProposalDecision(entries: Entry[], op: Extract<Op, { t: "accept" | "reject" }>, board: Board): void {
  const proposal = entries.find(entry => entry.seq === op.seq && entry.pending);
  // Old logs contain harmless decisions targeting absent/non-proposal local sequences.
  if (!proposal) return;
  if (entries.some(entry => !entry.pending && (entry.op.t === "accept" || entry.op.t === "reject") && entry.op.seq === op.seq)) {
    throw new Error("This proposal has already been decided.");
  }
  if (op.t === "reject") return;
  if (proposal.op.t === "handover" && handoverBasis(board) !== proposal.op.basis) {
    throw new Error("The board changed. Analyze this transfer again before accepting.");
  }
  if (proposal.proposalBasis && !basisHolds(board, proposal.op, proposal.proposalBasis)) {
    throw new StaleSuggestionError("This proposal is stale: the affected work changed. Review it and propose the change again.");
  }
}

/** Pin conversational cards to the board supplied to the model. */
export function captureCardPreconditions<T extends { ops: Op[] }>(board: Board, cards: T[]): (T & { preconditions: ProposalBasis[] })[] {
  return cards.map(card => ({ ...card, preconditions: card.ops.map(op => captureProposalBasis(board, op)) }));
}

/** Check the whole batch against one pre-application snapshot. */
export function validateOperationPreconditions(board: Board, ops: Op[], bases?: ProposalBasis[]): void {
  if (bases === undefined) return;
  if (!Array.isArray(bases) || bases.length !== ops.length) throw new Error("Suggestion preconditions must match every operation.");
  for (const [index, op] of ops.entries()) {
    if (!basisHolds(board, op, bases[index])) {
      throw new StaleSuggestionError("This suggestion is stale: the affected work changed. Review it and ask for the change again.");
    }
  }
}
