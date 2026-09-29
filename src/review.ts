import { listAssessmentRequests } from "./assessment-store.js";
import { isHumanEvidenceActor } from "./evidence-lifecycle.js";
import { fold, pending, type Op } from "./ops.js";
import type { AssessmentDeliveryStatus } from "./model.js";
import type { DetectedAgent, RunnerAgent } from "./agent-runner.js";
import type { Store } from "./store.js";

/** An agent's unapplied change, waiting for a person. */
export interface ReviewProposal { seq: number; by: string; at: string; summary: string }
/** What a person asked an agent for, and how far it got. Queued is not running. */
export interface ReviewRequest { id: string; intent: "assess" | "implement" | "discuss"; status: AssessmentDeliveryStatus; note?: string; revision: number; returns: number }
export interface ReviewList { proposals: ReviewProposal[]; requests: ReviewRequest[] }

/** Everything on this surface is agent-authored. A newline or an escape byte in a job name would
 * forge a row — a second "Accept:" line, or an attribution reading human: — on the one screen whose
 * job is saying truthfully who proposed what, and a bidi override (U+202E) reorders a row visually
 * in a bidi-aware terminal to the same end. Strip the C0/DEL/C1 controls and the Unicode bidi,
 * zero-width and format controls, then flatten to one bounded line before it reaches a terminal. */
export function sanitize(text: string, max: number): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

const NAME = 120, TEXT = 200, LINE = 240;

/** One line a person can decide from without opening the board. */
export function summarizeOp(op: Op, name: (id: string) => string): string {
  const say = (value: string) => sanitize(value, NAME);
  const of = (id: string) => sanitize(name(id), NAME);
  const fields = (patch: object) => say(Object.keys(patch).join(", "));
  const line = (): string => {
    switch (op.t) {
      case "job": return `describe job "${say(op.job.name)}"`;
      case "updateJob": return `update "${of(op.id)}" (${fields(op.patch)})`;
      case "removeJob": return `remove job "${of(op.id)}"`;
      case "split": return `split "${of(op.id)}" into ${op.tasks.map(task => `"${say(task.name)}"`).join(", ")}`;
      case "collect": return `collect ${op.into.length} job(s) under "${say(op.name)}"`;
      case "uncollect": return `uncollect "${of(op.id)}"`;
      case "reorder": return `reorder "${of(op.id)}"`;
      case "confirm": case "confirmField": return `confirm "${of(op.id)}"`;
      case "track": return `performer "${say(op.track.name)}" (${say(op.track.kind)})`;
      case "removeTrack": return `remove performer ${say(op.id)}`;
      case "artifact": return `handoff "${say(op.artifact.name)}" (${say(op.artifact.kind)})`;
      case "region": return `region "${say(op.region.name)}"`;
      case "regionMembers": case "removeRegion": return `change region ${say(op.id)}`;
      case "ask": return `ask "${sanitize(op.question.text, TEXT)}"`;
      case "answer": return `answer question ${say(op.id)}`;
      case "issue": return `mark question ${say(op.id)} ${say(op.status)}`;
      case "comment": return `comment on ${op.comment.about === "board" ? "the board" : `"${of(op.comment.about)}"`}`;
      case "removeComment": return `remove comment ${say(op.id)}`;
      case "board": return `retitle the board "${say(op.title)}"`;
      case "setGoal": return "set the board goal";
      case "setVolume": return `set volume to ${op.perWeek} per week`;
      case "setIntent": return op.intent ? `set the improvement intent to ${say(op.intent.primary)}` : "clear the improvement intent";
      case "setContext": return `set board context (${fields(op.context)})`;
      case "setVocabulary": return `change the shared vocabulary (${op.vocabulary.concepts.length} concept(s))`;
      case "addExecutionEvidence": return `link Langfuse evidence to "${of(op.id)}"`;
      case "retractExecutionEvidence": return `retract Langfuse evidence from "${of(op.id)}"`;
      case "handover": return "transfer work between performers";
      default: return say(op.t);
    }
  };
  // A bound on the whole row as well as on each field: no single op shape can widen the table.
  return sanitize(line(), LINE);
}

/** Everything on one board that is waiting for a person: unapplied proposals and request state. */
export async function listReview(store: Store, board: string): Promise<ReviewList> {
  const entries = await store.entries(board);
  if (!entries.length) throw new Error(`No board named "${board}".`);
  const folded = fold(entries);
  const named = new Map(folded.jobs.map(job => [job.id, job.name] as const));
  for (const track of folded.tracks) named.set(track.id, track.name);
  for (const artifact of folded.artifacts) named.set(artifact.id, artifact.name);
  const name = (id: string) => named.get(id) ?? id;
  const returns = new Map<string, number>();
  for (const comment of folded.comments) {
    const record = comment.assessment;
    if (record?.kind === "return") returns.set(record.requestId, (returns.get(record.requestId) ?? 0) + 1);
  }
  return {
    proposals: pending(entries).map(entry => ({ seq: entry.seq, by: sanitize(entry.by, NAME), at: sanitize(entry.at, NAME), summary: summarizeOp(entry.op, name) })),
    requests: (await listAssessmentRequests(store, board)).map(({ request, delivery }) => ({
      id: sanitize(request.id, NAME), intent: request.intent, status: delivery.status,
      note: delivery.note === undefined ? undefined : sanitize(delivery.note, NAME),
      revision: request.source.revision, returns: returns.get(request.id) ?? 0,
    })),
  };
}

/** A decision is a person's act. The actor is recorded, never inferred from who proposed. */
export async function decideProposal(store: Store, board: string, seq: number, decision: "accept" | "reject", actor: string, reason?: string): Promise<void> {
  if (!isHumanEvidenceActor(actor)) throw new Error("Only a person can accept or reject a proposal; this actor is an agent.");
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("Give the sequence number of the proposal, as npx @staves/cli review prints it.");
  const why = reason?.trim();
  if (decision === "reject" && !why) throw new Error(`Say why with --reason "..." so the agent can act on the rejection.`);
  if (!pending(await store.entries(board)).some(entry => entry.seq === seq)) {
    throw new Error(`No open proposal at ${seq} on "${board}". Run npx @staves/cli review ${board} for the list.`);
  }
  await store.append(board, [decision === "accept" ? { t: "accept", seq, by: actor } : { t: "reject", seq, by: actor, why }], actor);
}

const columns = (rows: string[][]): string[] => {
  const widths = rows[0].map((_cell, index) => Math.max(...rows.map(row => row[index].length)));
  return rows.map(row => row.map((cell, index) => index === row.length - 1 ? cell : cell.padEnd(widths[index])).join("  ").trimEnd());
};

/** Readable on a terminal, with the command that acts on each line. Every cell is sanitized here
 * too: this is the last point before the text is printed, and it must hold whatever reaches it. */
export function formatReview(board: string, list: ReviewList, url?: string): string {
  const safe = sanitize(board, NAME);
  // Nothing waiting is the commonest answer here, and the board is still where a person is going.
  if (!list.proposals.length && !list.requests.length) return `Nothing to review on "${safe}". Proposals appear here when an agent suggests a change it may not apply itself.${url ? ` · ${url}` : ""}`;
  const cell = (value: string | number, max = NAME) => sanitize(String(value), max);
  // The board itself, between its name and its counts: deciding from the terminal is quicker with
  // the page one click away, and a caller with no base to name simply does not name one.
  const out: string[] = [[safe, ...(url ? [url] : []), `${list.proposals.length} proposal(s)`, `${list.requests.length} request(s)`].join(" · ")];
  if (list.proposals.length) {
    out.push("", "Proposals (an agent's change, not yet on the board)");
    out.push(...columns([["  SEQ", "BY", "WHEN", "WHAT"], ...list.proposals.map(proposal =>
      [`  ${cell(proposal.seq)}`, cell(proposal.by), cell(proposal.at).slice(0, 16).replace("T", " "), cell(proposal.summary, LINE)])]));
    const first = cell(list.proposals[0].seq);
    out.push("", `  Accept: npx @staves/cli accept ${first} ${safe}`, `  Reject: npx @staves/cli reject ${first} ${safe} --reason "..."`);
  }
  if (list.requests.length) {
    out.push("", "Requests (what you asked an agent for; queued does not mean running)");
    out.push(...columns([["  ID", "INTENT", "STATUS", "REV", "RETURNS", "NOTE"], ...list.requests.map(request =>
      [`  ${cell(request.id)}`, cell(request.intent), cell(request.status), cell(request.revision), cell(request.returns), cell(request.note ?? "")])]));
    if (list.requests.some(request => request.status === "queued" && request.intent === "assess")) {
      out.push("", `  Deliver queued assessments: npx @staves/cli listen --board ${safe} --once`);
    }
    if (list.requests.some(request => request.status === "queued" && request.intent !== "assess")) {
      out.push("", "  Conversation and implementation requests need your interactive agent; open the project and say \"resume staves\".");
    }
  }
  return out.join("\n");
}

/** Name the board when the workspace leaves no doubt; otherwise say which names exist. */
export function resolveBoard(board: string | undefined, boards: string[]): string {
  if (board !== undefined) {
    if (boards.length && !boards.includes(board)) throw new Error(`No board named "${board}". Boards: ${[...boards].sort().join(", ")}.`);
    return board;
  }
  if (!boards.length) throw new Error("no boards here yet. Run npx @staves/cli init, or ask your agent to describe this repository.");
  if (boards.length > 1) throw new Error(`this workspace has ${boards.length} boards (${[...boards].sort().join(", ")}). Choose one with --board <name>.`);
  return boards[0];
}

export interface ListenInput { agent?: string; board?: string; agentBin?: string; detected: DetectedAgent[]; boards: string[] }
export interface ListenResolution { agent: RunnerAgent; agentBin?: string; board: string }

const isRunnerAgent = (value: string | undefined): value is RunnerAgent => value === "claude" || value === "codex";

/** The one agent installed, or nothing to go on. Never guess between two. */
function onlyAgent(detected: DetectedAgent[]): RunnerAgent {
  if (!detected.length) throw new Error("no local coding agent found (claude or codex). Install one and sign in, or pass --agent-bin.");
  if (detected.length > 1) throw new Error(`several coding agents found (${detected.map(found => found.agent).join(", ")}). Choose one with --agent claude or --agent codex.`);
  return detected[0].agent;
}

/** Only ask for a flag the terminal cannot work out. */
export function resolveListen(input: ListenInput): ListenResolution {
  if (input.agent !== undefined && !isRunnerAgent(input.agent)) throw new Error("--agent must be claude or codex.");
  const named = isRunnerAgent(input.agent) ? input.agent : undefined;
  if (named === undefined && input.agentBin !== undefined) throw new Error("--agent-bin needs --agent claude or --agent codex so staves knows how to call it.");
  const agent = named ?? onlyAgent(input.detected);
  return { agent, agentBin: input.agentBin ?? input.detected.find(found => found.agent === agent)?.bin, board: resolveBoard(input.board, input.boards) };
}
