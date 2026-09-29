import type { Store } from "./store.js";
import type { Board } from "./model.js";
import { fold, pending } from "./ops.js";
import { ulid } from "./ulid.js";
import type { WalkthroughCase } from "./walkthrough.js";
import { createWalkthroughRun, walkthroughBasis, type WalkthroughRun } from "./walkthrough-record.js";
export type { WalkthroughRun } from "./walkthrough-record.js";

async function capture(store: Store, name: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid board name.");
  const entries = await store.entries(name);
  if (!entries.length) throw new Error("Board does not exist.");
  const legacy = entries.find(entry => entry.op.t === "base");
  const base = legacy?.op.t === "base" ? await store.board(legacy.op.board) : undefined;
  return { board: fold(entries, base), revision: entries.at(-1)?.seq ?? 0, omittedPendingProposals: pending(entries).length };
}

function originalRun(board: Board, id: string): WalkthroughRun {
  const matches = board.comments.flatMap(comment => comment.walkthrough?.id === id ? [comment.walkthrough] : []);
  if (!matches.length) throw new Error("Walkthrough run not found.");
  if (matches.length !== 1) throw new Error("Duplicate walkthrough run identities; reconcile history first.");
  return matches[0];
}

export interface SavedWalkthrough {
  run: WalkthroughRun;
  status: "current" | "stale";
  requiresReconciliation: boolean;
}

function receipt(board: Board, run: WalkthroughRun): SavedWalkthrough {
  const current = walkthroughBasis(board) === run.basis;
  return { run: structuredClone(run), status: current ? "current" : "stale", requiresReconciliation: !current };
}

/** Save a reproducible model check. This never certifies implementation or execution. */
export async function saveWalkthrough(store: Store, name: string, example: WalkthroughCase, actor: string, maxSteps?: number, expectedBasis?: string): Promise<WalkthroughRun> {
  const snapshot = await capture(store, name);
  if (expectedBasis !== undefined && expectedBasis !== walkthroughBasis(snapshot.board)) throw new Error("The design changed since this preview. Test the scenario again before saving.");
  const run = createWalkthroughRun(snapshot.board, snapshot.revision, example, actor, new Date().toISOString(), ulid(), maxSteps, snapshot.omittedPendingProposals);
  const saved = await store.append(name, [{ t: "comment", comment: {
    id: `walkthrough:${run.id}`, about: "board", by: actor, at: run.at,
    text: `Saved walkthrough: ${run.result.case.name}. This is a model check, not execution evidence.`,
    walkthrough: run,
  } }], actor);
  return structuredClone(originalRun(saved, run.id));
}

export async function getWalkthrough(store: Store, name: string, id: string): Promise<SavedWalkthrough> {
  const { board } = await capture(store, name);
  return receipt(board, originalRun(board, id));
}

export async function listWalkthroughs(store: Store, name: string): Promise<SavedWalkthrough[]> {
  const { board } = await capture(store, name);
  const ids = board.comments.flatMap(comment => comment.walkthrough ? [comment.walkthrough.id] : []);
  return [...new Set(ids)].map(id => receipt(board, originalRun(board, id)));
}
