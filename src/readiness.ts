import type { Board, Job } from "./model.js";

/**
 * How much of what the interview needs it actually has.
 *
 * This is deliberately NOT a measure of how well the workflow is understood. Nobody can know the
 * size of that denominator, and the craft forbids claiming it: "never a job count, turn count or
 * completeness percentage". What is countable is the interview's own question list — the answers
 * staves needs before a description can be acted on without coming back to the person. That
 * denominator is finite, defined here, and checkable by the person reading it.
 *
 * So the number is a statement about staves, not a grade on their work. It belongs in the
 * interface, where the person can open it and see every answer it is counting. It is deliberately
 * not given to the model: a number on screen is a fact they can check, a number in a sentence is
 * a claim the model will eventually get wrong. There is no readinessLine() here, and that is the point.
 *
 * The four fields a job needs are not invented: they are the fields ops.ts already requires before
 * a job stops being a draft. This counts the same things the rest of the system counts.
 */

/** Whether answering would change what anyone builds, or is only interesting. The difference is
 *  what earns staves the right to say "you can stop here" instead of nagging to 100%. */
export type Weight = "changes" | "curious";

/**
 * How much is being asked for. The denominator has to be a choice rather than a consequence of how big
 * the board got: the same four fields per job is 16 answers across three jobs and 104 across
 * twenty-five, and nobody answers a hundred questions. Naming the ask is what keeps the number honest
 * as a board grows, and what lets someone say "an outline is all I want" and be believed.
 */
export type Ask = "outline" | "working" | "build";
export const ASKS: Ask[] = ["outline", "working", "build"];
/** What each ask is for, in the fewest words that are still true. */
export const ASK_MEANS: Record<Ask, string> = {
  outline: "what the work is and who does what",
  working: "enough to talk about it and find the gaps",
  build: "enough for someone to act on without asking you again",
};
const FROM_OUTLINE: Ask[] = ["outline", "working", "build"];
const FROM_WORKING: Ask[] = ["working", "build"];
const BUILD_ONLY: Ask[] = ["build"];

export interface Answer {
  /** stable across turns, so the interface can keep a row in place while the board moves */
  id: string;
  /** what it is about, in the person's own words */
  about: string;
  /** what staves would ask to get it */
  question: string;
  got: boolean;
  /** how it was got: read from code, said in the conversation, or agreed by the person */
  by?: "derived" | "said" | "confirmed";
  weight: Weight;
  /** which asks want this answer at all; an outline does not care when a job is done */
  asks: Ask[];
}

export interface Readiness {
  /** the ask these top-level figures describe */
  ask: Ask;
  have: number;
  need: number;
  /** 0–100, rounded. have/need, nothing cleverer. */
  percent: number;
  /** the same sum for every ask, so switching one does not need another round trip */
  counts: Record<Ask, { have: number; need: number; percent: number }>;
  answers: Answer[];
  /** missing, and answering would change what someone builds */
  wanted: Answer[];
  /** missing, but nothing downstream turns on it — curiosity without a use */
  idle: Answer[];
}

const live = (b: Board) => b.jobs.filter(j => !j.removed && !j.parent);

/** A job earns "changes" when something waits on it. Nothing waits on it and it runs a few times a
 *  year, then wanting to know more about it is appetite, not fieldwork — say so rather than ask. */
function weightOf(b: Board, job: Job): Weight {
  const taken = new Set(live(b).flatMap(j => (j.id === job.id ? [] : j.inputs ?? [])));
  const consumed = (job.outputs ?? []).some(id => taken.has(id));
  const aimedAt = live(b).some(j => (j.exits ?? []).some(e => e.target === job.id));
  if (consumed || aimedAt) return "changes";
  // Only positive evidence demotes a question. Having no downstream consumer is not evidence of
  // unimportance — it usually means this is the last thing that happens, which makes it the
  // deliverable the whole workflow is for. Demote only when the person has told us it is rare.
  return job.perWeek !== undefined && job.perWeek < 1 ? "curious" : "changes";
}

const sourceOf = (job: Job, field: string): Answer["by"] =>
  job.confirmedFields?.includes(field) ? "confirmed" : job.provenance.source === "human" ? "said" : "derived";

function briefAnswers(b: Board): Answer[] {
  const c = b.context ?? {};
  // the brief always counts as "changes": nothing downstream is safe to build without it
  const rows: [string, string, boolean, Ask[]][] = [
    ["purpose", "What is this work for?", !!(b.goal || c.purpose), FROM_OUTLINE],
    ["forWhom", "Who is it for?", !!c.forWhom, FROM_OUTLINE],
    ["mustNot", "What must never happen, even if everything else goes right?", !!c.mustNot, FROM_WORKING],
  ];
  return rows.map(([field, question, got, asks]) => ({
    id: `brief:${field}`, about: "the brief", question, got, weight: "changes" as const, asks,
    ...(got ? { by: "said" as const } : {}),
  }));
}

function jobAnswers(b: Board, job: Job): Answer[] {
  const weight = weightOf(b, job);
  const name = job.name;
  const rows: [string, string, boolean, Ask[]][] = [
    ["name", `Is “${name}” what the team actually calls it?`, !!job.confirmedFields?.includes("name"), FROM_OUTLINE],
    ["outcome", `What does “${name}” leave behind when it is done well?`, !!job.outcome, FROM_OUTLINE],
    ["beneficiary", `Who is waiting on “${name}”?`, !!job.beneficiary, FROM_WORKING],
    ["doneWhen", `How do you know “${name}” is finished, and not just done?`, !!job.doneWhen?.length, FROM_WORKING],
    // a builder cannot start the work without knowing what starts it, or what to do when it fails
    ["trigger", `What has to happen before “${name}” can start?`, !!job.trigger && job.trigger !== "hand", BUILD_ONLY],
    ["exits", `What happens to “${name}” when it cannot be finished?`, !!job.exits?.length, BUILD_ONLY],
  ];
  return rows.map(([field, question, got, asks]) => ({
    id: `${job.id}:${field}`, about: name, question, got, weight, asks,
    ...(got ? { by: sourceOf(job, field) } : {}),
  }));
}

/** Every answer the interview needs, and which of them it has. Derived from the board, never stored. */
export function readiness(b: Board, ask: Ask = "working"): Readiness {
  const jobs = live(b);
  const exits = jobs.flatMap(j => j.exits ?? []);
  const answers: Answer[] = [
    ...briefAnswers(b),
    {
      id: "board:exceptions", about: "the whole workflow",
      question: "When something goes wrong here, what happens to the work?",
      got: exits.length > 0, weight: "changes", asks: FROM_WORKING,
      ...(exits.length ? { by: "said" as const } : {}),
    },
    ...jobs.flatMap(job => jobAnswers(b, job)),
  ];
  const sum = (which: Ask) => {
    const scoped = answers.filter(a => a.asks.includes(which));
    const got = scoped.filter(a => a.got).length;
    return { have: got, need: scoped.length, percent: scoped.length ? Math.round((got / scoped.length) * 100) : 0 };
  };
  const counts = Object.fromEntries(ASKS.map(a => [a, sum(a)])) as Record<Ask, { have: number; need: number; percent: number }>;
  const wanted = answers.filter(a => a.asks.includes(ask));
  const missing = wanted.filter(a => !a.got);
  return {
    ask, ...counts[ask], counts,
    // every answer travels, tagged with the asks that want it, so changing the ask needs no round trip
    answers,
    wanted: missing.filter(a => a.weight === "changes"),
    idle: missing.filter(a => a.weight === "curious"),
  };
}
