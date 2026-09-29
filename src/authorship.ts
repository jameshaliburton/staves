import type { Board, Job } from "./model.js";
import { readiness, type Answer, type Ask } from "./readiness.js";
import { LEDGER_CLASSES, type LedgerClass } from "./ledger.js";

/**
 * How much of what is on the board came from the person, and how much staves made up.
 *
 * readiness.ts answers "how much does the interview still owe". This answers a different question
 * about the same list: of what is written down, whose is it. The two are independent — a board can
 * be complete and almost entirely invented, which is exactly the state that a percentage of
 * completeness would report as finished.
 *
 * It matters because staves is allowed to draft. Drafting is how a whole flow appears in two minutes
 * instead of an hour of questions, and the only thing that makes it honest is that every invented
 * line is visibly invented. So this is not a score: it is the split that lets the board be drawn in
 * two materials, and lets the person see at a glance which parts of their own workflow are still
 * a stranger's guess.
 *
 * Nothing new is stored. The provenance already exists — Job.provenance.source says who put the job
 * there, and Job.confirmedFields says which fields the person has since agreed to — so this reads
 * the board rather than keeping a second copy of the truth that could drift from it.
 */

export interface Authorship {
  /** answers the board actually has; the blanks are neither yours nor mine */
  known: number;
  /** of those, the ones the person said or confirmed */
  yours: number;
  /** 0–100, rounded. yours/known, nothing cleverer. 0 when nothing is known yet. */
  percent: number;
}

/** An answer is the person's when they said it or have since agreed to it. Everything staves
 *  derived stays mine until they do, however confident it was. */
export const isYours = (a: Answer): boolean => a.got && a.by !== "derived";

const tally = (answers: Answer[]): Authorship => {
  const known = answers.filter(a => a.got);
  const yours = known.filter(isYours).length;
  return { known: known.length, yours, percent: known.length ? Math.round((yours / known.length) * 100) : 0 };
};

const scoped = (b: Board, ask: Ask) => readiness(b, ask).answers.filter(a => a.asks.includes(ask));

/** The whole board, for the readout that sits beside the board's name. */
export function authorship(b: Board, ask: Ask = "working"): Authorship {
  return tally(scoped(b, ask));
}

/** One job, for how its card is drawn. */
export function jobAuthorship(b: Board, job: Job, ask: Ask = "working"): Authorship {
  return tally(scoped(b, ask).filter(a => a.id.startsWith(job.id + ":")));
}

/**
 * Which jobs are drawn as staves' guess rather than the person's account.
 *
 * The test is majority, not purity: a job the person named but never described is still mostly
 * mine, and drawing it solid because one field is theirs would be the flattering lie this whole
 * module exists to prevent. A job nothing is known about yet is not a guess — it is a blank, and
 * hatching blanks would make an empty board look like a fabrication.
 */
export function inferred(b: Board, job: Job, ask: Ask = "working"): boolean {
  const { known, yours } = jobAuthorship(b, job, ask);
  return known > 0 && yours * 2 < known;
}

/** Every answer staves supplied and the person has not agreed to, newest board order. What the
 *  person is being invited to correct — never phrased as work they owe. */
export function guesses(b: Board, ask: Ask = "working"): Answer[] {
  return scoped(b, ask).filter(a => a.got && a.by === "derived");
}

/**
 * The same split, shaped for the board to draw itself with.
 *
 * It travels with board.json rather than being recomputed in the client, because the majority rule
 * above is a judgement — "one confirmed field out of four is still mostly mine" — and a judgement
 * that exists in two places is a judgement that will eventually disagree with itself.
 */
export interface JobAuthorship extends Authorship {
  /** drawn as staves' guess rather than the person's account */
  inferred: boolean;
  /** the fields staves supplied, so a card can offer them back one at a time */
  fields: { field: string; question: string }[];
}

export interface BoardAuthorship extends Authorship {
  jobs: Record<string, JobAuthorship>;
  classes: Record<LedgerClass, Authorship>;
}

/**
 * The same split down the five classes the agenda has always been made of.
 *
 * The agenda is the mental model — brief, roles, jobs, handoffs, exceptions — and what a person wants
 * from it is not a list of outstanding questions. It is where they stand: which parts of their work
 * they have actually told staves about, and which parts staves has been filling in for them.
 *
 * Roles are counted off the tracks rather than the interview, because the interview never asks about
 * them. A track described before provenance was recorded is read as the person's, on the same grounds
 * as everywhere else: until staves could draft a role, every role on a board was theirs.
 */
const CLASS_OF: Record<string, "brief" | "jobs" | "handoffs" | "exceptions"> = {
  purpose: "brief", forWhom: "brief", mustNot: "brief",
  name: "jobs", outcome: "jobs", beneficiary: "jobs", doneWhen: "jobs",
  trigger: "handoffs", exits: "exceptions",
};

export function classAuthorship(b: Board, ask: Ask = "working"): Record<LedgerClass, Authorship> {
  const buckets: Record<LedgerClass, Answer[]> = { brief: [], roles: [], jobs: [], handoffs: [], exceptions: [] };
  for (const a of scoped(b, ask)) {
    if (a.id === "board:exceptions") { buckets.exceptions.push(a); continue; }
    const cls = CLASS_OF[a.id.slice(a.id.indexOf(":") + 1)];
    if (cls) buckets[cls].push(a);
  }
  const out = Object.fromEntries(LEDGER_CLASSES.map(c => [c, tally(buckets[c])])) as Record<LedgerClass, Authorship>;
  const tracks = b.tracks.filter(t => !t.removed);
  const theirs = tracks.filter(t => (t.provenance?.source ?? "human") !== "agent").length;
  out.roles = { known: tracks.length, yours: theirs, percent: tracks.length ? Math.round((theirs / tracks.length) * 100) : 0 };
  return out;
}

export function boardAuthorship(b: Board, ask: Ask = "working"): BoardAuthorship {
  const answers = scoped(b, ask);
  const jobs: Record<string, JobAuthorship> = {};
  for (const job of b.jobs.filter(j => !j.removed && !j.parent)) {
    const own = answers.filter(a => a.id.startsWith(job.id + ":"));
    jobs[job.id] = {
      ...tally(own),
      inferred: inferred(b, job, ask),
      fields: own.filter(a => a.got && a.by === "derived")
        .map(a => ({ field: a.id.slice(job.id.length + 1), question: a.question })),
    };
  }
  return { ...tally(answers), jobs, classes: classAuthorship(b, ask) };
}
