import { z } from "zod";
import { connectionBlock } from "./handoff.js";
import { getAssessment, saveAssessmentRequest } from "./assessment-store.js";
import { createAssessmentRequest, type AssessmentRequest } from "./assessment.js";
import type { Store } from "./store.js";

const pageSchema = z.string().trim().max(2048).refine(value => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "Page must be an http(s) URL without credentials.");

export const agentHandoffInputSchema = z.object({
  jobIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
  page: pageSchema.optional(),
  intention: z.string().trim().max(4000).optional(),
  draft: z.string().trim().max(4000).optional(),
  requestId: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((value, context) => {
  if (value.jobIds && new Set(value.jobIds).size !== value.jobIds.length) context.addIssue({ code: "custom", path: ["jobIds"], message: "Choose each job only once." });
});

export type AgentHandoffInput = z.input<typeof agentHandoffInputSchema>;

export interface AgentHandoffOptions {
  hosted?: boolean;
  dir?: string;
  connected?: string[];
  defaultPage?: string;
}

export interface AgentHandoffResult {
  prompt: string;
  requestId: string;
  board: string;
  title: string;
  revision: number;
}

export class AgentHandoffError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AgentHandoffError";
  }
}

function scopeKey(jobIds: string[] | undefined): string {
  return jobIds ? [...jobIds].sort().join("\u0000") : "*";
}

function requestScope(request: AssessmentRequest): string[] | undefined {
  return request.packet.request.jobIds;
}

function validateScope(board: Awaited<ReturnType<Store["board"]>>, jobIds: string[] | undefined): void {
  const live = new Set(board.jobs.filter(job => !job.removed).map(job => job.id));
  if (!live.size) throw new AgentHandoffError("This board has no live jobs to hand off.");
  if (!jobIds) return;
  const missing = jobIds.find(id => !live.has(id));
  if (missing) throw new AgentHandoffError(`Job ${missing} is not available on this board.`);
}

function currentDesignMatches(board: Awaited<ReturnType<Store["board"]>>, revision: number, request: AssessmentRequest): boolean {
  try {
    const current = createAssessmentRequest(board, revision, {
      id: request.id,
      capturedBy: request.capturedBy,
      capturedAt: request.capturedAt,
      intent: "discuss",
      jobIds: request.packet.request.jobIds,
      includeSources: request.packet.request.includeSources,
      rationale: request.rationale,
      constraints: request.constraints,
      ...(request.cases ? { cases: request.cases } : {}),
    });
    return current.basis === request.basis;
  } catch {
    return false;
  }
}

function pageFor(board: string, input: AgentHandoffInput, options: AgentHandoffOptions): string | undefined {
  if (input.page) return input.page;
  if (options.defaultPage) return options.defaultPage;
  if (options.hosted) return `https://staves.io/?board=${encodeURIComponent(board)}`;
  return undefined;
}

function promptFor(
  boardName: string,
  request: AssessmentRequest,
  board: Awaited<ReturnType<Store["board"]>>,
  input: AgentHandoffInput,
  options: AgentHandoffOptions,
  page: string | undefined,
): string {
  const selected = request.packet.board.jobs;
  const scope = request.packet.request.jobIds?.length
    ? request.packet.request.jobIds.map(id => `${id} (${selected.find(job => job.id === id)?.name ?? "job"})`).join(", ")
    : "the whole board";
  const connection = connectionBlock({
    board: boardName,
    dir: options.dir,
    url: page,
    hosted: options.hosted,
    connected: options.connected ?? [],
    scope: request.packet.request.jobIds?.join(",") ?? "board",
    intention: input.intention,
    draft: input.draft,
  });
  return [
    "Connect to my Staves board and help me use it in my coding project.",
    connection,
    `BOARD PAGE\n    ${page ?? "The local board page was not supplied; use the board connection above."}`,
    `HANDOFF REQUEST\n    id: ${request.id}\n    board: ${boardName}\n    title: ${board.title}\n    revision: ${request.source.revision}\n    scope: ${scope}`,
    `MY INTENTION\n    ${input.intention || request.rationale || "Continue from this workflow and choose the next step."}`,
    ...(input.draft ? [`WHAT I WAS PART WAY THROUGH TYPING\n    ${input.draft}`] : []),
    "READ BEFORE REPLYING. First call staves_brief with board \"" + boardName + "\". Then call staves_assessment with board \"" + boardName + "\" and id \"" + request.id + "\" to read this saved handoff and its scope.",
    "Inspect the request inbox with staves_requests for board \"" + boardName + "\". After identifying this request, claim its delivery with staves_request_status using board \"" + boardName + "\", id \"" + request.id + "\", status \"claimed\". The inbox read and the status update are separate MCP calls.",
    `Work within ${scope}. Keep the selected scope intact, distinguish the board's evidence from my intention and from unresolved facts, and leave unknowns as explicit questions. You may help shape the design conversation and record its outcome on this board when I ask; do not widen the request silently.`,
    "FIRST RESPONSE AFTER VERIFIED ACCESS. Reply with a concise, contextual bullet list of the useful next actions, then follow my stated intention: \n- Build a working prototype from this spec when no code exists; label prototype assumptions and keep human gates visible.\n- Refine the spec or discuss it, leaving unresolved facts explicit.\n- Connect an existing project, asking for the actual application directory if it is unclear.\n- Assess feasibility and gaps.\n- Compare the existing code with the spec.\n- Implement the jobs I choose, after the implementation handoff below.\n- Test concrete workflow scenarios.\n- Review the workflow from each role.\n- Update this board with findings and progress when I ask.\nIf my stated intention already explicitly asks to build or prototype, treat that as my choice and proceed without asking me to choose again. Do not default to any one action.",
    "IMPLEMENTATION HANDOFF. This initial handoff does not authorize application code yet. If I choose build or prototype after the read, create a new staves_assess request with intent \"implement\" for this same board and the same selected scope before changing code; leave this discussion request intact. Use staves_git_context against the actual destination project directory, staves_development_link to attach the observed project snapshot, and staves_assessment_return with file and test references after the work. Keep the same board id and never create a duplicate board.",
    "PROJECT AND SYNC BOUNDARIES. The local directory in the connection instructions is where the Staves board store lives; it may not be the destination application. Choose or create the actual app directory using its repository conventions, while retaining access to this board. For a hosted board, connect from the actual destination project and do not create another board. State separately whether access was verified through native Staves MCP tools or through the CLI; do not conflate a CLI connection with native MCP availability, and do not present a setup menu after access is verified. Before code changes, reread staves_brief, staves_assessment and the current board; after changes, report code and test references back to this board. There is no automatic background rebuild or hidden live sync. If the live board cannot be reached, say so rather than answering from this prompt as though you had read it.",
  ].join("\n\n");
}

export async function createAgentHandoff(
  store: Store,
  boardName: string,
  rawInput: unknown,
  options: AgentHandoffOptions = {},
): Promise<AgentHandoffResult> {
  const input = agentHandoffInputSchema.parse(rawInput);
  if (!/^[a-zA-Z0-9_-]+$/.test(boardName)) throw new AgentHandoffError("Invalid board name.");
  const boards = await store.list();
  if (!boards.includes(boardName)) throw new AgentHandoffError("Board does not exist.", 404);
  const board = await store.board(boardName);
  validateScope(board, input.jobIds);
  const page = pageFor(boardName, input, options);
  if (page) pageSchema.parse(page);

  let request: AssessmentRequest;
  if (input.requestId) {
    let saved;
    try { saved = await getAssessment(store, boardName, input.requestId); }
    catch (error) { throw new AgentHandoffError(error instanceof Error ? error.message : "Assessment request not found.", 404); }
    if (saved.request.intent !== "discuss") throw new AgentHandoffError("The supplied request is not a discussion handoff.");
    if (scopeKey(requestScope(saved.request)) !== scopeKey(input.jobIds)) throw new AgentHandoffError("The supplied request does not match this board or handoff scope.");
    const revision = (await store.entries(boardName)).at(-1)?.seq ?? 0;
    request = currentDesignMatches(board, revision, saved.request)
      ? saved.request
      : await saveAssessmentRequest(store, boardName, {
        intent: "discuss",
        jobIds: input.jobIds,
        rationale: input.intention || "Continue from this workflow and choose the next step.",
      }, "human");
  } else {
    request = await saveAssessmentRequest(store, boardName, {
      intent: "discuss",
      jobIds: input.jobIds,
      rationale: input.intention || "Continue from this workflow and choose the next step.",
    }, "human");
  }
  return {
    prompt: promptFor(boardName, request, board, input, options, page),
    requestId: request.id,
    board: boardName,
    title: board.title,
    revision: request.source.revision,
  };
}
