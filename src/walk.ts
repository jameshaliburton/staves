import type { Board } from "./model.js";
import { columns, handoffs } from "./derive.js";
import { readiness, type Answer, type Ask } from "./readiness.js";

/**
 * Walking the flow: the same questions, in the order the work happens, standing on the board.
 *
 * A list of outstanding questions was never the wrong data — it was the wrong shape and the wrong
 * place. Scrolling twenty-one rows in a panel is proofreading a map by reading a list of its street
 * names: you cannot tell from a row that the thing it is about sits on an outside track with nothing
 * downstream of it, which is usually the whole problem with it.
 *
 * So the questions get the board's own order. Each hop is one job, lit where it sits, with the single
 * most consequential thing staves does not know about it. Answering draws the next piece and moves
 * along. Nobody triages, because a process supplies its own order — it is how you would walk someone
 * through their work out loud, and it builds and verifies in the same motion.
 *
 * Jobs staves has nothing consequential to ask about are not hops. A walk that stops at every card to
 * ask nothing is a tour of its own thoroughness.
 */

export interface Hop {
  /** the job this hop stands on */
  job: string;
  name: string;
  /** what staves wants to know here, in full — a truncated question is not a question */
  question: string;
  /** what it is about, for a person reading ahead */
  about: string;
  /** 1-based, for "hop 4 of 13" */
  index: number;
}

export interface Walk {
  hops: Hop[];
  total: number;
  /** jobs passed over because nothing consequential is outstanding about them */
  settled: number;
}

/**
 * The order the work happens in, derived from what passes between jobs rather than from when anybody
 * mentioned them. columns() breaks its cycles using description order, which is right for laying a
 * canvas out and wrong here: the point of walking a flow is that conversation order is not workflow
 * order, and someone who remembers the first step last should still be walked from the beginning.
 */
function flowOrder(b: Board): (id: string) => number {
  const preds = new Map<string, string[]>();
  for (const h of handoffs(b)) preds.set(h.to, [...(preds.get(h.to) ?? []), h.from]);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    // a loop has no beginning; treat the job as reachable from where we already are rather than hang
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(0, ...(preds.get(id) ?? []).map(p => of(p) + 1));
    visiting.delete(id); depth.set(id, d);
    return d;
  };
  return of;
}

/**
 * Within one job, the order a person would actually be asked. What the work leaves behind comes
 * before who receives it, which comes before how you know it is finished. What the team calls it is
 * asked last: it is a real question, but opening a hop with "is that what you call it?" is a question
 * about staves' vocabulary rather than about their work.
 */
const FIELD_ORDER = ["outcome", "beneficiary", "doneWhen", "trigger", "exits", "name"];
const rank = (a: Answer) => { const i = FIELD_ORDER.indexOf(a.id.slice(a.id.indexOf(":") + 1)); return i < 0 ? FIELD_ORDER.length : i; };

export function walk(b: Board, ask: Ask = "working"): Walk {
  const col = columns(b);
  const depth = flowOrder(b);
  const jobs = b.jobs.filter(j => !j.removed && !j.parent)
    .sort((x, y) => depth(x.id) - depth(y.id) || (col.get(x.id) ?? 0) - (col.get(y.id) ?? 0));

  const answers = readiness(b, ask).answers.filter(a => a.asks.includes(ask));
  const outstanding = (id: string): Answer | undefined => {
    const own = answers.filter(a => a.id.startsWith(id + ":") && !a.got)
      .sort((x, y) => rank(x) - rank(y));
    // what would change what someone builds comes first; curiosity is not a reason to stop a walk
    return own.find(a => a.weight === "changes") ?? own[0];
  };

  const hops: Hop[] = [];
  let settled = 0;
  for (const j of jobs) {
    const want = outstanding(j.id);
    if (!want) { settled++; continue; }
    hops.push({ job: j.id, name: j.name, question: want.question, about: want.about, index: hops.length + 1 });
  }
  return { hops, total: hops.length, settled };
}
