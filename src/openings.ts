import type { Board, Job } from "./model.js";
import { inferred } from "./authorship.js";

/**
 * Where this work could be done differently.
 *
 * This is what describing a workflow was for, and it had been sitting behind item eight of a menu.
 * It is derived from the board rather than asked of a model, for two reasons: a model asked "what
 * could be automated here" will always find something, and an opening nobody can check against the
 * map is a sales pitch. Everything below points at jobs, tasks and waits that are already written
 * down, and carries the evidence it was drawn from.
 *
 * The three kinds are deliberately not all "use an agent". Naming the job that needs no model, and
 * the wait that no software fixes, is what makes the one that does need an agent worth believing.
 *
 * Nothing is offered on work staves invented. An opening derived from its own guess is a guess about
 * a guess, and it would arrive exactly when the person knows least about what they are looking at.
 */

export type OpeningKind = "agent" | "mechanical" | "waiting";

export interface Opening {
  id: string;
  kind: OpeningKind;
  /** the job it is about, by its own name */
  about: string;
  job: string;
  /** what could change, in one sentence, in the person's terms */
  says: string;
  /** what it would need that the board already has */
  needs: string[];
  /** what stays with a person, named — an agent proposal without a check is not a proposal */
  keeps?: string;
  /** what on the board this was read off */
  evidence: string[];
}

/** Work with no comprehension in it at all: fetching, matching, moving something, telling someone.
 *  A model adds nothing here, and saying so is what makes the next set believable. */
const NO_VIEW = new Set(["look", "match", "move", "tell"]);
/** Work a model can do a first pass at: everything above, plus reading something and drafting from it. */
const MODELABLE = new Set([...NO_VIEW, "read", "draft"]);
/** Work that is the reason a person is in the loop at all. */
const JUDGEMENT = new Set(["decide"]);

const live = (b: Board) => b.jobs.filter(j => !j.removed);
const top = (b: Board) => live(b).filter(j => !j.parent);
const kidsOf = (b: Board, id: string) => live(b).filter(j => j.parent === id);
const trackOf = (b: Board, j: Job) => b.tracks.find(t => t.id === j.track && !t.removed);

/** How often and how long, said only when the person actually said it. */
function volume(j: Job): string[] {
  const out: string[] = [];
  if (j.minutes) out.push(`${j.minutes} minutes each time`);
  if (j.perWeek) out.push(`${j.perWeek} a week`);
  return out;
}

export function openings(b: Board): Opening[] {
  const found: Opening[] = [];
  for (const j of top(b)) {
    // an opening about work staves made up is a guess about a guess
    if (inferred(b, j)) continue;
    const kids = kidsOf(b, j.id);
    const kinds = kids.map(k => k.workKind).filter(Boolean) as string[];
    const track = trackOf(b, j);
    const byHand = track?.kind === "person" || track?.kind === "outside";

    // nobody is working: elapsed time with no work attached to it
    const waits = kids.filter(k => k.workKind === "wait");
    if (waits.length && waits.length === kids.length) {
      found.push({
        id: `wait:${j.id}`, kind: "waiting", about: j.name, job: j.id,
        says: `Nothing is being done while “${j.name}” is in progress — it is elapsed time, not effort.`,
        needs: [], evidence: [`every step of it is a wait`, ...volume(j)],
      });
      continue;
    }

    if (!kinds.length || !byHand) continue;

    const noView = kinds.every(k => NO_VIEW.has(k));
    const anyJudgement = kinds.some(k => JUDGEMENT.has(k));

    if (noView && !anyJudgement) {
      // no view is formed anywhere in it, so there is nothing for a model to do
      found.push({
        id: `plain:${j.id}`, kind: "mechanical", about: j.name, job: j.id,
        says: `“${j.name}” never forms a view — it fetches, matches and moves. Plain software does this; it does not need a model.`,
        needs: (j.tools ?? []).map(t => t.name),
        evidence: [`${kids.length} step${kids.length === 1 ? "" : "s"}, none of them a judgement`, ...volume(j)],
      });
      continue;
    }

    // an agent could take the first pass where the mechanical work dominates and a person still signs
    const canModel = kinds.filter(k => MODELABLE.has(k)).length;
    if (canModel && canModel * 2 > kinds.length && !anyJudgement && j.beneficiary) {
      const inputs = (j.inputs ?? []).map(id => b.artifacts.find(a => a.id === id)?.name).filter(Boolean) as string[];
      found.push({
        id: `agent:${j.id}`, kind: "agent", about: j.name, job: j.id,
        says: `An agent could take the first pass at “${j.name}”, and ${j.beneficiary} would correct it rather than start from nothing.`,
        needs: inputs.length ? inputs : (j.tools ?? []).map(t => t.name),
        keeps: j.gate?.rule ? j.gate.rule : `${j.beneficiary} still decides whether it is good enough`,
        evidence: [`${canModel} of its ${kinds.length} steps are reading, matching or drafting`, ...volume(j)],
      });
    }
  }
  // the biggest claim last: a wait nobody can automate away outranks a job that can be, and saying so
  // is what stops this reading as a list of things to buy
  const order: Record<OpeningKind, number> = { agent: 0, mechanical: 1, waiting: 2 };
  return found.sort((x, y) => order[x.kind] - order[y.kind]);
}
