import type { Prerequisites } from "./flow.js";
import type { BaselineMetadata, LegacyBaselineMetadata } from "./baseline.js";

/**
 * staves — the model.
 *
 * A board is one piece of work. Tracks are who does it. Jobs sit on tracks.
 * Handoffs are derived from what a job produces and what another consumes;
 * they are never drawn by hand. Gates are decisions with exits. Every fact
 * carries who said it. Nothing is inferred on ingestion: what is missing
 * becomes a question.
 */

export type Id = string;

export type TrackKind = "person" | "agent" | "system" | "outside";

export interface Track {
  id: Id;
  name: string;
  kind: TrackKind;
  /** one line: what this performer is for */
  meta?: string;
  /** hours per week per person (people) */
  capacityHoursPerWeek?: number;
  /** how many people staff this role (a team track); default 1 */
  people?: number;
  /** per-instance execution budget for a system track, in seconds (e.g. a serverless limit) */
  budgetSeconds?: number;
  /** who put this performer on the board. Absent on everything described before it was recorded, which
   *  is read as the person's, because until staves could draft roles they were all theirs. */
  provenance?: Provenance;
  removed?: boolean;
}

export type ArtifactKind = "document" | "data" | "decision" | "message" | "record" | "instruction" | "measure" | "other";

export interface Artifact {
  /** what the receiver needs from it: fields, state, what they check first */
  note?: string;
  id: Id;
  name: string;
  kind: ArtifactKind;
  /** enters the work from outside; nothing on the board produces it */
  external?: boolean;
  /** which tool or store it lives in, if known */
  livesIn?: string;
}

/** How a job starts. In a person's words:
 *  hand — when someone gets to it · ask — when someone asks for it · event — when something arrives · chain — when the previous one ends
 *  clock — on a schedule · watch — when a condition is met (a threshold, a change) · deadline — when time runs out · always — it never stops
 *  other — say it (triggerNote) */
export type Trigger = "hand" | "ask" | "event" | "chain" | "clock" | "watch" | "deadline" | "always" | "other";

export interface Exit {
  /** condition in the language of the work, e.g. "no source found" */
  condition: string;
  /** job id, or "stop" when the instance ends here. Missing = dangling. */
  target?: Id | "stop";
  /** rough share of instances, 0–1, if known */
  share?: number;
}

export interface Gate {
  /** the rule, in words: "no source, no claim" */
  rule: string;
  /** track id of the accountable party, or "rule" when a rule decides */
  accountable?: Id | "rule";
  /** for autonomous gates: who owns the rule */
  ruleOwner?: string;
}

export type ProvenanceSource = "agent" | "human" | "confirmed" | "derived";

export interface Provenance {
  source: ProvenanceSource;
  by?: string;
  confidence?: number;
  at?: string;
  /** the repo commit this was described at */
  commit?: string;
}

export type JobKind =
  | "work" // ordinary work on a track
  | "queue" // instances wait here between performers
  | "store" // an artifact's home, not a step
  | "watch" // a person can look but not act
  | "ghost" // not done today
  | "outside"; // outside our hands

/** Public project identity only. Credentials remain in the coding agent environment. */
export interface LangfuseConnection {
  baseUrl: string;
  projectId: string;
}

/** A bounded observation reference; never a copy of trace inputs or outputs. */
export interface ExecutionEvidence {
  provider: "langfuse";
  /** Immutable origin for new captures; legacy references use the board connection. */
  baseUrl?: string;
  fetchedAt?: string;
  fetchedBy?: string;
  mapping?: {
    method: "instrumented" | "proposed" | "reviewed";
    boardId: string;
    jobId: string;
    rationale?: string;
    reviewedBy?: string;
    reviewedAt?: string;
  };
  implementationRef?: string;
  /** Exact prior capture key; refresh appends rather than overwrites. */
  supersedes?: string;
  retraction?: { at: string; by: string; reason: string };
  projectId: string;
  traceId: string;
  observationId?: string;
  observedAt: string;
  designRevision?: string;
  environment?: string;
  status: "observed" | "error";
  durationMs?: number;
  name?: string;
}

export interface Job {
  id: Id;
  name: string;
  track: Id;
  /** composite parent, if this is a task inside a job */
  parent?: Id;
  kind?: JobKind;
  /** Implementation maturity is independent of description confirmation. Missing means unknown. */
  implementation?: { state: "unknown" | "planned" | "in-progress" | "implemented"; note?: string };
  /** Execution does not establish confirmation or implementation maturity. */
  executionEvidence?: ExecutionEvidence[];
  outcome?: string;
  beneficiary?: string;
  doneWhen?: string[];
  rationale?: string;
  trigger?: Trigger;
  /** the trigger in their words, when 'other' or when the choice needs a line */
  triggerNote?: string;
  prerequisites?: Prerequisites;
  inputs: Id[];
  outputs: Id[];
  exits?: Exit[];
  gate?: Gate;
  /** loop back: target job id and the limit, if any */
  loop?: { to: Id; limit?: number; then?: string };
  /** one input and what it became — the stranger test for data work */
  examples?: { in: string; out: string; note?: string }[];
  /** what this task checks, and what happens when a check fails */
  checks?: { rule: string; onFail?: string }[];
  /** the instructions this performer works from — a prompt, a rubric, a config — as a place in the repo, read-only */
  instructions?: { path: string; symbol?: string; summary?: string; text?: string }[];
  /** where in the code this job lives; the join between the board and the repo */
  sources?: { path: string; symbol?: string }[];
  /** the track this job was moved from, until a person confirms the move */
  movedFrom?: Id;
  /** this job is a whole board: focusing it opens that board (a survey's workflows, a nested system) */
  boardRef?: string;
  /** rough size, for a survey: jobs the workflow probably has */
  size?: string;
  /** the kind of work a task is, in a person's words: look up · read · match · draft · decide · tell · move · wait — or any tag */
  workKind?: string;
  /** explicit position among siblings; description order when absent */
  order?: number;
  /** tools used, with how they are reached */
  tools?: {
    name: string;
    reach: "api" | "mcp" | "screen" | "none";
    personal?: boolean;
    /** what the tool actually returns for this task, as a person would say it: "the article intro, not the sections" */
    does?: string;
    /** what it leaves out or cuts off: characters, pages, sections, time, sampling */
    limits?: string;
  }[];
  /** typical minutes of the performer's time per instance, if known */
  minutes?: number;
  /** instances per week arriving at this job, if known */
  perWeek?: number;
  provenance: Provenance;
  status: "draft" | "confirmed";
  /** fields a person has confirmed individually */
  confirmedFields?: string[];
  /** a correction loop: this job's output improves another job's instructions */
  correctionTo?: Id;
  /** tombstone: kept so anchors resolve; never drawn */
  removed?: boolean;
  /** what replaced it, if it was collected into another job */
  replacedBy?: Id;
}

export type AssessmentDeliveryStatus = "queued" | "claimed" | "running" | "completed" | "failed";
export interface AssessmentDelivery { status: AssessmentDeliveryStatus; actor: string; at: string; note?: string; }

export type AssessmentRecord =
  | { kind: "delivery"; requestId: string; delivery: AssessmentDelivery }
  | { kind: "request"; request: import("./assessment.js").AssessmentRequest }
  | { kind: "return"; requestId: string; result: import("./assessment.js").AgentReturn; statusAtReceipt: "current" | "stale"; receivedAt: string };

export interface Comment {
  designConversation?: import("./design-conversation.js").DesignConversation;
  development?: import("./development.js").DevelopmentRecord;
  id: Id;
  assessment?: AssessmentRecord;
  walkthrough?: import("./walkthrough-record.js").WalkthroughRun;
  /** entity id, or "board" */
  about: Id;
  by: string;
  text: string;
  at?: string;
  /** thread parent */
  replyTo?: Id;
}

/** A titled, coloured group with explicit members (jobs or tasks) spanning any tracks. A stage is a region that spans columns. */
export interface Region {
  id: Id;
  name: string;
  color?: string;
  members: Id[];
  removed?: boolean;
}

export interface Question {
  id: Id;
  /** entity id the question is about */
  about?: Id;
  askedBy: "agent" | "human" | "staves";
  /** raised → picked up → answered / proposed → done */
  status?: "raised" | "picked-up" | "answered" | "proposed" | "done";
  text: string;
  answer?: string;
  answeredBy?: string;
  at?: string;
}

export interface Board {
  /** Portable domain knowledge. Alternatives retain this namespace and concept identities. */
  vocabulary?: import("./vocabulary.js").DomainVocabulary;
  id: Id;
  title: string;
  goal?: string;
  origin?: string;
  tracks: Track[];
  artifacts: Artifact[];
  jobs: Job[];
  /** the context the board was started with; guides the interviewer, the review, and allocation */
  context?: { langfuse?: LangfuseConnection; agentProgress?: { state: "working" | "partial" | "ready"; summary: string; updatedAt: string }; purpose?: string; improvement?: string; success?: string; outside?: string; forWhom?: "outside" | "inside" | "me"; shape?: "flow" | "project" | "service"; stakes?: string[]; mustNot?: string; scale?: string; where?: "code" | "people" | "drawn"; notes?: string; words?: string[]; /** what confirming means here: as it is (true today) or as it should be (intended) */ stance?: "as-is" | "to-be" };
  questions: Question[];
  /** what the interview has settled, by class; the state itself is derived in ledger.ts */
  settled?: Partial<Record<import("./ledger.js").LedgerClass, import("./ledger.js").Settlement>>;
  regions: Region[];
  comments: Comment[];
  /** instances per week entering the board, if known */
  perWeek?: number;
  /** what a redesign is for: the dimension it must improve, and what it must not make worse */
  intent?: { primary: "cycle-time" | "labor-hours" | "error-rate" | "cost" | "throughput" | "risk"; target?: string; constraints?: string[] };
  /** scenario boards: the board this one branches from */
  base?: Id;
  baseline?: BaselineMetadata | LegacyBaselineMetadata;
}

export function emptyBoard(id: Id, title = id): Board {
  return { id, title, tracks: [], artifacts: [], jobs: [], questions: [], comments: [], regions: [] };
}
