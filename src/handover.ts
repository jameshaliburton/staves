import type { Artifact, Board, Job } from "./model.js";
import type { Op } from "./ops.js";

export interface HandoverPlacement {
  parent?: string | null;
  trigger?: Job["trigger"];
  before?: string;
  after?: string;
}

export interface HandoverPlan {
  jobId: string;
  fromTrack: string;
  toTrack: string;
  moves: string[];
  stays: string[];
  blocks: string[];
  needs: string[];
  changes: string[];
  ops: Op[];
  basis: string;
}

/** Conservative structural revision: discussion may continue without invalidating a plan. */
export function handoverBasis(board: Board): string {
  return JSON.stringify({ jobs: board.jobs, tracks: board.tracks, artifacts: board.artifacts, regions: board.regions, goal: board.goal, context: board.context });
}

/** A design proposal based only on recorded facts. Never runs work or assumes tool access. */
export function handoverPlan(board: Board, jobId: string, toTrack: string, placement?: HandoverPlacement): HandoverPlan {
  const root = board.jobs.find(j => j.id === jobId && !j.removed);
  const destination = board.tracks.find(t => t.id === toTrack && !t.removed);
  const plan: HandoverPlan = { jobId, fromTrack: root?.track ?? "", toTrack, moves: [], stays: [], blocks: [], needs: [], changes: [], ops: [], basis: handoverBasis(board) };
  if (!root || !destination) { plan.blocks.push("The job or destination no longer exists."); return plan; }
  if (root.track === toTrack) { plan.blocks.push("This job is already on that track."); return plan; }
  const source = board.tracks.find(t => t.id === root.track);
  const automating = destination.kind === "agent";
  if (!((source?.kind === "person" && automating) || (source?.kind === "agent" && destination.kind === "person"))) {
    plan.blocks.push("Choose a human-to-agent or agent-to-human transfer."); return plan;
  }
  const members = new Set([root.id]);
  let changed = true;
  while (changed) { changed = false; for (const j of board.jobs) if (!j.removed && j.parent && members.has(j.parent) && !members.has(j.id)) { members.add(j.id); changed = true; } }
  const jobs = board.jobs.filter(j => members.has(j.id) && !j.removed);
  const updates: Job[] = [];
  const artifacts: Artifact[] = [];
  const isDecision = (j: Job) => Boolean(j.gate || j.workKind === "decide");
  for (const j of jobs) {
    if (j.track !== root.track) { plan.stays.push(j.id); continue; }
    const screen = j.tools?.some(t => t.reach === "screen");
    if (automating && j.tools?.some(t => t.reach === "none")) plan.blocks.push(`${j.name}: a required tool is recorded as unavailable to agents.`);
    if (automating && (isDecision(j) || screen)) {
      if (j.id !== root.id) { plan.stays.push(j.id); plan.changes.push(`${j.name} stays with ${source?.name ?? "the human role"}.`); continue; }
      if (screen || j.workKind === "decide" || jobs.length === 1) { plan.blocks.push(`${j.name}: separate the ${screen ? "screen interaction" : "human decision"} into its own task before moving this job.`); plan.stays.push(j.id); continue; }
      // Keep the original decision semantics on a distinct human task, connected by a real artifact.
      const decisionId = `${root.id}-human-decision`;
      const artifactId = `${root.id}-prepared-for-decision`;
      if (board.jobs.some(x => x.id === decisionId) || board.artifacts.some(x => x.id === artifactId)) { plan.blocks.push("A separate human decision already exists. Review it before moving this job."); continue; }
      const decision: Job = { ...structuredClone(root), id: decisionId, name: `Decide: ${root.name}`, track: root.track, parent: root.id, inputs: [artifactId], outputs: [...root.outputs], provenance: { source: "human" }, status: "draft" };
      delete decision.movedFrom;
      updates.push(decision);
      artifacts.push({ id: artifactId, name: `Prepared evidence for ${root.name}`, kind: "document" });
      const preparation = structuredClone(root);
      delete preparation.gate; delete preparation.exits; delete preparation.loop; delete preparation.workKind;
      preparation.name = `Prepare: ${root.name}`;
      preparation.outputs = [artifactId]; preparation.track = toTrack; delete preparation.movedFrom; preparation.status = "draft";
      updates.push(preparation); plan.moves.push(root.id); plan.stays.push(decisionId);
      plan.changes.push("Keep the decision with the human role and give the agent a preparation job that passes evidence to it.");
      continue;
    }
    const moved: Job = { ...structuredClone(j), track: toTrack, status: "draft" };
    delete moved.movedFrom;
    updates.push(moved);
    plan.moves.push(j.id);
    if (automating && !j.tools?.length) plan.needs.push(`${j.name}: confirm the tools and access this agent needs.`);
    if (automating && j.tools?.some(t => t.personal)) plan.needs.push(`${j.name}: replace or explicitly authorize personal tool access.`);
  }
  for (const id of plan.moves) {
    const j = board.jobs.find(x => x.id === id)!;
    if (automating && !j.examples?.length) plan.needs.push(`${j.name}: give one example of an input and what it became.`);
    if (automating && !j.checks?.length) plan.needs.push(`${j.name}: define a check that would catch an incorrect result.`);
    if (automating && (!j.trigger || j.trigger === "hand")) {
      plan.needs.push(`${j.name}: decide what starts the agent's work.`);
      plan.changes.push(`${j.name}: its ${j.trigger === "hand" ? "manual start" : "unspecified start"} is retained; moving it does not configure automatic execution.`);
    } else if (!automating && j.trigger && j.trigger !== "hand") {
      plan.needs.push(`${j.name}: confirm how a person receives work from its ${j.trigger} start.`);
      plan.changes.push(`${j.name}: the ${j.trigger} start is retained for review.`);
    }
  }
  if (!root.beneficiary) plan.needs.push("Describe who needs the result of this job.");
  if (!root.inputs.length || !root.outputs.length) plan.needs.push("Describe what this job receives and passes on.");
  if (jobs.length === 1) plan.needs.push("Add tasks to review which parts of this job could move.");
  plan.needs.push("Ask the coding assistant to check whether the proposed design can be implemented. This review uses the board description.");
  if (!automating) plan.needs.push("Review the time, access and instructions the human role will need.");
  if (plan.blocks.length) return plan;
  const movedRoot = updates.find(j => j.id === root.id);
  if (movedRoot && placement) {
    if (Object.hasOwn(placement, "parent")) {
      if (placement.parent === null) delete movedRoot.parent;
      else if (placement.parent !== undefined) {
        if (members.has(placement.parent) || !board.jobs.some(j => j.id === placement.parent && !j.removed)) {
          plan.blocks.push("Choose an existing job that is not inside the job being moved."); return plan;
        }
        movedRoot.parent = placement.parent;
      }
    }
    if (placement.trigger) movedRoot.trigger = placement.trigger;
    if (placement.before && placement.after) { plan.blocks.push("Choose either before or after for placement."); return plan; }
    const referenceId = placement.before ?? placement.after;
    if (referenceId) {
      const reference = board.jobs.find(j => j.id === referenceId && !j.removed);
      if (!reference || members.has(reference.id)) { plan.blocks.push("Choose a position beside a job outside the job being moved."); return plan; }
      const position = (j: Job) => j.order ?? board.jobs.indexOf(j);
      const siblings = board.jobs.filter(j => j.parent === reference.parent && j.id !== root.id && !j.removed).sort((a, b) => position(a) - position(b));
      const index = siblings.indexOf(reference);
      const low = placement.before ? (index > 0 ? position(siblings[index - 1]) : position(reference) - 1) : position(reference);
      const high = placement.before ? position(reference) : (index + 1 < siblings.length ? position(siblings[index + 1]) : position(reference) + 1);
      movedRoot.order = (low + high) / 2;
      if (reference.parent) movedRoot.parent = reference.parent; else delete movedRoot.parent;
    }
    if (placement.trigger && placement.trigger !== root.trigger) {
      plan.changes = plan.changes.filter(message => !message.startsWith(`${root.name}: its `));
      plan.changes.push(`${root.name}: start changes to ${placement.trigger} as requested by this move.`);
      plan.needs = plan.needs.filter(message => message !== `${root.name}: decide what starts the agent's work.`);
    }
  }
  plan.ops = [{ t: "handover", jobId, toTrack, ...(placement ? { placement } : {}), basis: plan.basis, before: { jobs: updates.map(j => board.jobs.find(x => x.id === j.id) ?? { id: j.id, absent: true }), artifacts: artifacts.map(a => ({ id: a.id, absent: true })) }, after: { jobs: updates, artifacts } }];
  return plan;
}
