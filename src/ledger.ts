import type { Board } from "./model.js";
import { handoffs } from "./derive.js";

/**
 * What the interview has settled, and what it has not.
 *
 * A conversation that starts again should not start over. Closure is therefore a fact on the board,
 * not something the model has to remember from a transcript: it survives a reload, a new device and a
 * conversation nobody can read back. Each closure is recorded against a basis — a snapshot of the very
 * thing it was about — so when a ninth role appears the closure lapses on its own. Nobody keeps a tick
 * honest by hand, and nothing silently stays settled after the ground moved.
 */
export const LEDGER_CLASSES = ["brief", "roles", "jobs", "handoffs", "exceptions"] as const;
export type LedgerClass = (typeof LEDGER_CLASSES)[number];

export interface Settlement {
  settled: boolean;
  /** who said so: the person's word, or Staves' judgment. A tick nobody gave never reads as theirs. */
  by: "human" | "staves";
  quote?: string;
  at?: string;
  basis?: string;
}

export interface LedgerItem {
  class: LedgerClass;
  state: "untouched" | "open" | "closed";
  /** 0 nothing here, 1 named but with gaps the board can name, 2 nothing outstanding. Never a score. */
  depth: 0 | 1 | 2;
  /** the gap itself, in the fewest words that are still true; absent at depth 2 */
  gap?: string;
  by?: Settlement["by"];
  quote?: string;
  at?: string;
  /** closed once, then the ground moved: the interviewer can say why it is open again */
  lapsed?: boolean;
  /** what the board holds for this class right now, in the fewest words that are still true */
  summary: string;
}

const live = (b: Board) => b.jobs.filter(j => !j.removed);
const roles = (b: Board) => b.tracks.filter(t => !t.removed);

/** The shape of one class, as the thing a closure is a claim about. Change it and the claim lapses. */
export function settlementBasis(b: Board, cls: LedgerClass): string {
  switch (cls) {
    case "brief": {
      const c = b.context ?? {};
      return JSON.stringify([b.goal ?? "", c.purpose ?? "", c.forWhom ?? "", c.outside ?? "", c.mustNot ?? ""]);
    }
    case "roles": return JSON.stringify(roles(b).map(t => t.id).sort());
    case "jobs": return JSON.stringify(live(b).filter(j => !j.parent).map(j => j.id).sort());
    case "handoffs": return JSON.stringify(handoffs(b).map(h => `${h.from}>${h.to}:${h.artifact ?? ""}`).sort());
    case "exceptions": return JSON.stringify(live(b).flatMap(j => (j.exits ?? []).map(e => `${j.id}:${e.condition ?? ""}>${e.target ?? ""}`)).sort());
  }
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** How well a class is supported, and what is missing. Depth is a statement about nameable gaps, never a
 *  percentage of the work understood — the interviewer refuses that claim and so does this. */
function depthOf(b: Board, cls: LedgerClass): { depth: 0 | 1 | 2; gap?: string } {
  const jobs = live(b);
  switch (cls) {
    case "brief": {
      const c = b.context ?? {};
      const missing = [!(b.goal || c.purpose) && "what it is for", !c.forWhom && "who it is for", !c.mustNot && "what must not happen"].filter(Boolean) as string[];
      if (missing.length === 3) return { depth: 0 };
      return missing.length ? { depth: 1, gap: "nothing said about " + missing.join(" or ") } : { depth: 2 };
    }
    case "roles": {
      const roleList = roles(b);
      if (!roleList.length) return { depth: 0 };
      const idle = roleList.filter(t => !jobs.some(j => j.track === t.id));
      return idle.length ? { depth: 1, gap: `${idle.length} of ${roleList.length} have no work against them` } : { depth: 2 };
    }
    case "jobs": {
      const top = jobs.filter(j => !j.parent);
      if (!top.length) return { depth: 0 };
      const thin = top.filter(j => !j.outcome || !j.beneficiary || !j.doneWhen?.length);
      return thin.length ? { depth: 1, gap: `${thin.length} of ${top.length} do not say what they achieve, for whom, or when they are done` } : { depth: 2 };
    }
    case "handoffs": {
      const passed = handoffs(b);
      if (!passed.length) return { depth: 0 };
      const taken = new Set(jobs.flatMap(j => j.inputs ?? []));
      const dropped = [...new Set(jobs.flatMap(j => j.outputs ?? []))].filter(id => !taken.has(id));
      return dropped.length ? { depth: 1, gap: `${plural(dropped.length, "output")} nobody takes` } : { depth: 2 };
    }
    case "exceptions": {
      const exits = jobs.flatMap(j => j.exits ?? []);
      if (!exits.length) return { depth: 0 };
      const nowhere = exits.filter(e => !e.target || (e.target !== "stop" && !jobs.some(j => j.id === e.target)));
      return nowhere.length ? { depth: 1, gap: `${plural(nowhere.length, "way out")} with nowhere to go` } : { depth: 2 };
    }
  }
}

function present(b: Board, cls: LedgerClass): { touched: boolean; summary: string } {
  switch (cls) {
    case "brief": {
      const c = b.context ?? {};
      const held = [b.goal || c.purpose ? "what it is for" : "", c.forWhom ? "who it is for" : "", c.mustNot ? "what must not happen" : ""].filter(Boolean);
      return { touched: held.length > 0, summary: held.length ? held.join(", ") : "nothing said yet" };
    }
    case "roles": { const n = roles(b).length; return { touched: n > 0, summary: n ? `${n} named` : "nobody named yet" }; }
    case "jobs": { const n = live(b).filter(j => !j.parent).length; return { touched: n > 0, summary: n ? `${n} named` : "no work named yet" }; }
    case "handoffs": { const n = handoffs(b).length; return { touched: n > 0, summary: n ? `${n} derived from what is passed` : "nothing changes hands yet" }; }
    case "exceptions": { const n = live(b).reduce((count, j) => count + (j.exits?.length ?? 0), 0); return { touched: n > 0, summary: n ? `${n} way${n === 1 ? "" : "s"} out` : "no way out described" }; }
  }
}

/**
 * Whether a class is mostly staves' own inference rather than anything the person supplied.
 *
 * This exists to stop the board certifying itself. Staves may draft, and staves may close a class with
 * judgment — but not both at once. If it drafted the roles and then closed "roles", the readiness count
 * would report green on work nobody ever confirmed, and the number would be worth nothing. Whoever
 * supplied the content, only the person can close a class they did not describe.
 *
 * Absent provenance reads as the person's: everything described before provenance was recorded was.
 */
export function mostlyInferred(b: Board, cls: LedgerClass): boolean {
  const inferred = (p?: { source?: string }) => p?.source === "agent";
  const share = (items: { provenance?: { source?: string } }[]) =>
    items.length > 0 && items.filter(i => inferred(i.provenance)).length * 2 > items.length;
  switch (cls) {
    case "roles": return share(roles(b));
    case "jobs": return share(live(b).filter(j => !j.parent));
    // exits and what is passed both live on jobs, so they are as inferred as the jobs carrying them
    case "exceptions": return share(live(b).filter(j => (j.exits ?? []).length));
    case "handoffs": return share(live(b).filter(j => (j.outputs ?? []).length || (j.inputs ?? []).length));
    // nothing records who wrote the brief yet, so it is never treated as staves' own
    case "brief": return false;
  }
}

/** The ledger as the conversation should see it: derived from the board, never a second source of truth. */
export function ledger(b: Board): LedgerItem[] {
  return LEDGER_CLASSES.map(cls => {
    const { touched, summary } = present(b, cls);
    const settlement = b.settled?.[cls];
    const held = settlement?.settled === true;
    const lapsed = held && settlement?.basis !== undefined && settlement.basis !== settlementBasis(b, cls);
    const state: LedgerItem["state"] = held && !lapsed ? "closed" : touched ? "open" : "untouched";
    const { depth, gap } = depthOf(b, cls);
    return {
      class: cls, state, summary, depth, ...(gap ? { gap } : {}),
      ...(state === "closed" ? { by: settlement!.by, quote: settlement!.quote, at: settlement!.at } : {}),
      ...(lapsed ? { lapsed: true } : {}),
      ...(mostlyInferred(b, cls) ? { inferred: true } : {}),
    };
  });
}

/** The five lines the interviewer is given, so it stops re-asking what is already answered. */
export function ledgerLine(b: Board): string {
  return ledger(b).map(item => {
    const who = item.by === "staves" ? "settled by Staves" : "closed by the person";
    return item.state === "closed"
      ? `${item.class}: SETTLED (${item.summary}; ${who}${item.quote ? `, going by "${item.quote}"` : ""})${item.gap ? ` — still thin: ${item.gap}` : ""}. Do not ask whether this is complete again; you may still ask about the thin part.`
      : `${item.class}: ${item.state.toUpperCase()} (${item.summary})${item.gap ? ` — ${item.gap}` : ""}${item.lapsed ? " — it was settled, then this changed; it is open again" : ""}`;
  }).join("\n");
}
