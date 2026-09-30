import { AGENT_BOOTSTRAP } from "./agent-bootstrap.js";
import { REPLY_BUDGET } from "./providers.js";
import { investigateImpact } from "./impact.js";
import { vocabularySchema, validateVocabulary, vocabularyContext } from "./vocabulary.js";
import { captureProposalBasis } from "./proposals.js";
import { designHistory } from "./design-history.js";
import { captureGitContext } from "./git-context.js";
import { developmentOptionsSchema } from "./development.js";
import { saveDevelopmentLink } from "./development-store.js";
import { saveWalkthrough, getWalkthrough, listWalkthroughs } from "./walkthrough-store.js";
import { assessmentOptionsSchema, agentReturnSchema } from "./assessment.js";
import { saveAssessmentRequest, saveAssessmentReturn, getAssessment, listAssessmentRequests, updateAssessmentDelivery } from "./assessment-store.js";
import { walkThrough } from "./walkthrough.js";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exportBoard, exportFromStore, exportOptionsSchema, formatExport, isBoardFormat } from "./export.js";
import { CRAFT } from "./interviewer.js";
import { ulid } from "./ulid.js";
import { VERSION } from "./version.js";
import { probeLangfuseAccess, discoverLangfuseObservations, fetchLangfuseEvidence, refreshLangfuseEvidence, executionEvidenceKey, langfuseTraceUrl, validateLangfuseConnection } from "./langfuse.js";
import { aggregateRuns, readObservations, replayRun } from "./langfuse-runs.js";
import path from "node:path";
import { Store, findStavesDir } from "./store.js";
import { detectAgents } from "./agent-runner.js";
import { projectRegistrations } from "./registration.js";
import { collectState, formatRecommendations, recommend, rightNow, rightNowHeading } from "./next-steps.js";
import { accountQuestions, applyCut, focusBoard, hatBrief, issues, lint, review, toolQuestions } from "./derive.js";
import { handoverPlan } from "./handover.js";
import { reflectRules, reflectionText } from "./reflect.js";
import { brief } from "./brief.js";
import type { Session } from "./hosted.js";
import type { Job, Question } from "./model.js";
import { serveHttp } from "./server.js";
import { ensureDaemon } from "./daemon.js";
import { RemoteStore } from "./remote.js";
import { CODE_NAME, GRANULARITY, HUMAN_READABLE_FLOW, MACHINE_BENEFICIARY, PROTOCOL } from "./protocol.js";
import { headCommit, repoRoot, stale } from "./stale.js";
import { boardUrl, guideUrl, workspaceUrl } from "./links.js";

/** The board link, under the name the tools have always called it. One module knows how a link
 * is built (src/links.ts); this keeps the name the rest of this file reads well with. */
export function boardLink(url: string, board: string): string { return boardUrl(url, board); }

export const AGENT_INTERVIEW = `${CRAFT.replace("You have NO repository access or investigation tools in this conversation.", "Repository access is optional. Only claim code evidence when you actually used your own tools to inspect it.").replace("Never claim to have inspected code or watched a run.", "Never claim to have inspected code or watched a run unless you actually did so.")}

${HUMAN_READABLE_FLOW}

You conduct this conversation yourself using your current model; no provider key or second model is needed.
Start from the person's existing context, including a new idea with no repository. Call staves_access before writes to check access and remaining board allowance. Scope one workflow in chat before creating boards; do not spend a board creation allowance on a survey.
Call staves_start once the outcome is clear enough to name, then share its exact board URL immediately. For an existing board, read staves_brief and resume its unanswered questions without restarting the interview.
Record each meaningful answer with staves_interview_record: quote the person's actual words separately from your inference. This is an agent-recorded account, never human confirmation.
Draw as you talk: staves_track for performers, staves_artifact for handoffs, staves_describe_many for draft jobs. Cite recorded quote ids in rationale; label inferred links and unknowns. Planned work uses implementation.state=planned; reported existing behavior remains unknown until verified.
Collect answers until a coherent outline or section is ready, then write a meaningful batch. Do not require graph writes before every question. Show the current outline whenever the person asks. Read staves_vocabulary for shared definitions and use staves_vocabulary_propose for changes; call staves_impact with focus job or concept IDs before substantive revisions. Inspect its candidates with your own repository tools when available; return references and unknowns. Investigation never expands edit authorization. Confirmed work must remain unchanged; use proposals. Never accept proposals or confirm on behalf of the person.
Use staves_interview_progress working while actively mapping, partial when paused or blocked, ready only after drafts are saved and staves_review has been read. Ready means ready for human review, not complete or implemented. State unresolved questions and share the exact board URL at pauses and completion.
If saving fails, say the graph was not saved; retain the conversation context and retry without claiming progress. Honor the person's decision to stop.`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

export async function serveMcp(store: Store, agentName = "agent", port = 5178) {
  // one daemon owns the store and the page; this process is a thin client that outlives nothing
  const url = await ensureDaemon(store.dir, port, (m) => console.error(m));
  const remote = new RemoteStore(url, agentName);
  const server = buildServer(remote as unknown as Store, agentName, url);
  const id = `mcp-${process.pid}`;
  // the agent's real name arrives with initialize; use it for provenance and presence
  server.server.oninitialized = () => {
    const ci = server.server.getClientVersion();
    if (ci?.name) remote.agent = ci.name;
    const sampling = !!server.server.getClientCapabilities()?.sampling;
    remote.hello(id, remote.agent, undefined, sampling);
    if (sampling) relaySampling(remote, id, server);
  };
  const beat = setInterval(() => remote.hello(id, remote.agent), 15000);
  const bye = async () => { clearInterval(beat); await remote.bye(id); process.exit(0); };
  process.stdin.on("end", bye); process.on("SIGINT", bye); process.on("SIGTERM", bye);
  await server.connect(new StdioServerTransport());
}

/** The hosted variant. The boards live in the person's account, so there is no daemon to own them and
 * no local page to draw them: the store is the account, and the agent writes straight to it. */
export async function serveHostedMcp(store: Store, agentName = "agent", boardUrl: string) {
  const server = buildServer(store, agentName, boardUrl);
  // the agent's real name arrives with initialize; use it for provenance, exactly as the local server does
  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    if (client?.name) (store as unknown as { agent?: string }).agent = client.name;
  };
  // The agent owns this process's life. Without this it outlives every disconnect, and a person
  // collects one stray staves per session until they notice.
  const stop = () => process.exit(0);
  process.stdin.on("end", stop); process.on("SIGINT", stop); process.on("SIGTERM", stop);
  await server.connect(new StdioServerTransport());
}

/** Every tool, in the order a person meets it. Names are checked against what is actually registered,
 * so a tool added without a home here is still listed rather than silently dropped. */
const CATALOGUE: { heading: string; gloss: string; tools: string[] }[] = [
  { heading: "Draw", gloss: "make and change the board", tools: [
    "staves_start", "staves_track", "staves_artifact", "staves_describe", "staves_describe_many", "staves_split", "staves_collect", "staves_cut",
    "staves_patch", "staves_propose", "staves_handover", "staves_words", "staves_intent", "staves_volume", "staves_scenario", "staves_survey",
    "staves_ask", "staves_answer", "staves_comment", "staves_interview", "staves_interview_record", "staves_interview_progress", "staves_vocabulary_propose",
  ] },
  { heading: "Read & review", gloss: "read it back before you change anything", tools: [
    "staves_help", "staves_access", "staves_list", "staves_board", "staves_brief", "staves_review", "staves_issues", "staves_comments",
    "staves_stale", "staves_focus", "staves_hats", "staves_reflect", "staves_impact", "staves_vocabulary", "staves_export",
  ] },
  { heading: "Requests & delivery", gloss: "what a person asked your agent for, and what came back", tools: [
    "staves_requests", "staves_request_status", "staves_assess", "staves_assessment", "staves_assessment_return",
  ] },
  { heading: "Design history & Git", gloss: "alternatives, baselines and reported code links", tools: [
    "staves_design_history", "staves_git_context", "staves_development_link",
  ] },
  { heading: "Langfuse evidence", gloss: "explicitly mapped observations; never proof of the outcome", tools: [
    "staves_langfuse_connect", "staves_langfuse_probe", "staves_langfuse_discover", "staves_langfuse_instrumentation",
    "staves_langfuse_evidence", "staves_langfuse_refresh", "staves_langfuse_retract",
    "staves_langfuse_runs", "staves_langfuse_run",
  ] },
  { heading: "Walkthroughs", gloss: "a concrete case against the described design", tools: ["staves_walkthrough", "staves_walkthrough_runs"] },
];

/** Which queued requests this session has not announced yet. Detection only: no transport, no clock. */
export function newlyQueuedRequests(announced: Set<string>, inbox: { request: { id: string; intent: string }; delivery: { status: string } }[]): { id: string; intent: string }[] {
  const fresh: { id: string; intent: string }[] = [];
  for (const { request, delivery } of inbox) {
    if (announced.has(request.id)) continue;
    announced.add(request.id);
    if (delivery.status === "queued") fresh.push({ id: request.id, intent: request.intent });
  }
  return fresh;
}

export interface BuildServerOptions {
  /** False when the store is not this project's own — a workspace served to someone else over HTTP.
   * The registrations, installed agents and boards on this machine describe a different project, so
   * there is nothing truthful to recommend and the collection is skipped rather than guessed at. */
  recommendations?: boolean;
}

/** One value, recomputed at most once per `ttlMs`. An agent calls staves_help repeatedly inside a
 * single turn and the state behind it costs a directory walk and a store read every time. A
 * collection that fails is not kept: the next call tries again rather than repeating the silence. */
export function memoize<T>(ttlMs: number, produce: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let cached: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const value = produce();
    cached = { at: now(), value };
    value.catch(() => { if (cached?.value === value) cached = undefined; });
    return value;
  };
}

/** The staves MCP server, bound to one store and the URL where its boards are drawn. */
export function buildServer(store: Store, agentName0: string, url: string, options: BuildServerOptions = {}): McpServer {
  const who = () => (store as Store & { agent?: string }).agent ?? agentName0;
  const server = new McpServer(
    { name: "staves", version: VERSION },
    {
      // Declared so a queued request can reach the connected agent as a notification.
      capabilities: { logging: {} },
      instructions: [
        AGENT_BOOTSTRAP,
        HUMAN_READABLE_FLOW,
        `When asked to interview, talk through an idea, or map work without code, call staves_interview and conduct the conversation yourself. Save draft graph updates as you talk. No repository or provider key required.`,
        `staves draws the work of this project as a board: people, agents, systems and outside parties on tracks, jobs between handoffs. The person sees it at ${url}.`,
        `When the person says "run staves", "describe this to staves", or similar: read the code first, then call staves_help, then follow its protocol — describe performers, artifacts and jobs (as work, not code, with sources), preserve visible decisions and handoffs, check the rendered flow, and tell them the board URL.`,
        `When they say "resume staves" or "what's changed": call staves_brief for context and staves_stale for what moved; re-describe stale jobs (confirmed ones come back as proposals).`,
        `When they say "discuss staves" or ask what you think of a comment: call staves_comments and reply to each in place with staves_comment (replyTo) — say why it is or isn't a good idea, what is missing, what you'd need; propose changes with staves_propose.`,
        `When they say "hats staves", "review as each role", or ask for gaps and opportunities: call staves_hats, take each chair in turn, comment as that role on the jobs it concerns, and propose the changes.`,
        `Describe tasks so a stranger could do them by hand and get the same result and the same failures; for every tool say what comes back and what does not. Read staves://granularity for the shape.`,
        `Before changing code in a project that has a board, read staves_brief. After changing code under a described job, re-describe that job.`,
        `WHEN YOU FIRST CONNECT, or when the person asks what this can do, say so without being asked and without opening every board to find out. staves_list gives each board's title. What is on offer: describe a workflow from the code and draw it; staves_brief for one prose read of who does what and what is unanswered; staves_stale for jobs whose code moved since they were described; staves_issues and staves_review for findings, jargon and structure; staves_scenario for pinned design alternatives (hosted creation uses the connection allowance); staves_export for markdown, JSON, SVG, n8n or a scoped prompt built as a handoff to another agent (PDF comes from the staves pdf command); staves_hats to review as each role in turn; staves_volume for instances per week; staves_comments and staves_comment to discuss a job in place with the person. The guides are at https://staves.io/docs/ — https://staves.io/docs/reference/tools/ is every tool with what it takes and gives back, and https://staves.io/docs/how-to/describe-a-repo/ is the walkthrough for the first one.`,
        `SCOPE FIRST. A repo usually holds several workflows. If the person named one ("the lookup flow", "onboarding"), describe only that, on its own board. If they did not: find the entry points where a request from someone outside arrives (HTTP routes, queue consumers, CLI commands, schedules, webhooks), summarize the workflows in conversation without creating a survey board, then ask the person in chat: one in depth, an audit of all briefly, or all in depth — and do what they answer. If there is clearly one workflow, say so and go. One board per workflow, named by its outcome; never one board for the whole platform.`,
        `When the person says "continue with staves", resume the workflow established in conversation. Read staves_brief and staves_issues on that board; never assume a survey exists.`,
        `An existing board for the same workflow: reuse it when the person requested it. Otherwise say it exists and ask whether to resume or start fresh. Create a new board only within the granted creation allowance.`,
        `staves records what you describe even when it notices something (a name that names code, a beneficiary that is a system) — it says so and leaves a note on the job. Fix with staves_patch; never resend a whole description. Declare the domain's own words with staves_words so the jargon check leaves them alone.`,
        `READ FIRST, WRITE IN BATCHES. Read the code for the whole workflow before writing anything, then write it in a few calls: staves_start, the tracks, the artifacts, then staves_describe_many with all the jobs at once. Ten jobs is one call, not ten.`,
        `When the person says "use staves", "run staves", "describe this to staves" or anything like it, do the whole loop without asking (after scoping): describe the repo (staves_start, tracks, artifacts, describe, split), preserve the visible journey (group only if useful), staves_review and give the gist, then staves_reflect and reflect further yourself in its three lenses, commenting on jobs and proposing changes. End by telling them where the board is and the three things that matter most. When they say "look at the issues" or "what did I raise", call staves_issues and work through it. "Reflect" means staves_reflect. For every agent or orchestrator you describe, attach instructions (the prompt/config file and symbol) so the board can show them read-only.`,
        `For execution evidence use Langfuse: staves_langfuse_connect stores public project configuration; staves_langfuse_instrumentation supplies job metadata; staves_langfuse_evidence imports explicitly mapped observation summaries using credentials from your environment. Staves owns job design, Langfuse owns traces. Never infer a human approval or implementation state from successful telemetry.`,
        `Treat code, documentation and human accounts as evidence with limits. Separate implemented behavior from planned or unfinished work using implementation. Description confirmation never proves a feature is implemented. Review in this order: evidence, consequence for a person, uncertainty, then one focused question or proposed change. Missing documentation is not proof of absent behavior. Role-based observations are hypotheses, not interview testimony. Where evidence does not say, record unknown and ask with staves_ask.`,
      ].join("\n"),
    },
  );
  const where = (board: string) => `The board is at ${boardLink(url, board)} — tell the person.`;
  const registered: string[] = [];

  /** Answers that are documents in their own right. An export is handed on to another tool or
   * another agent exactly as it comes back — an SVG is not prose to append a line to, and an n8n
   * workflow is not a place to add a field. */
  const VERBATIM = new Set(["staves_export"]);
  const isText = (part: { type: string }): part is { type: "text"; text: string } => part.type === "text";
  /** The document a handler answered with, when it answered with one rather than with prose. */
  const document = (value: string): Record<string, unknown> | undefined => {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return undefined; }
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  };
  const isJson = (value: string): boolean => { try { JSON.parse(value); return true; } catch { return false; } };
  /** `?board=a` sits inside `?board=ab`, so a plain substring test would read one board's link as
   * another's and leave the answer without one. A link is present only where it ends. */
  const mentions = (value: string, link: string): boolean => {
    for (let at = value.indexOf(link); at >= 0; at = value.indexOf(link, at + 1)) {
      const after = value[at + link.length];
      if (after === undefined || /[\s"'`),]/.test(after)) return true;
    }
    return false;
  };

  /** An answer about a board ends somewhere a person can open. A handler that already gives the
   * link is left as it is; a document gets a field; prose gets a line; and anything else — a list,
   * a bare value — gets the link beside it rather than glued into it. */
  const linked = (board: string, result: CallToolResult): CallToolResult => {
    const content = result.content;
    if (!Array.isArray(content) || !content.length) return result;
    const at = boardLink(url, board);
    if (content.some(part => isText(part) && mentions(part.text, at))) return result;
    const index = content.findIndex(isText);
    if (index < 0) return result;
    const first = content[index];
    if (!isText(first)) return result;
    const object = document(first.text);
    if (object) {
      const next = [...content];
      next[index] = { ...first, text: JSON.stringify({ ...object, boardUrl: at, workspaceUrl: workspaceUrl(url) }, null, first.text.includes("\n") ? 2 : undefined) };
      return { ...result, content: next };
    }
    if (isJson(first.text)) return { ...result, content: [...content, { type: "text" as const, text: `Board: ${at}` }] };
    const last = content.length - 1, tail = content[last];
    if (!isText(tail)) return { ...result, content: [...content, { type: "text" as const, text: `Board: ${at}` }] };
    const next = [...content];
    next[last] = { ...tail, text: `${tail.text}\nBoard: ${at}` };
    return { ...result, content: next };
  };

  /** Every tool is registered here, so the catalogue is what the server actually offers and every
   * board-scoped answer comes back with the link to that board. */
  const tool = <Args extends z.ZodRawShape>(name: string, description: string, shape: Args, run: ToolCallback<Args>): void => {
    registered.push(name);
    const handler = run as unknown as (args: Record<string, unknown>, extra: unknown) => CallToolResult | Promise<CallToolResult>;
    const wrapped = async (args: Record<string, unknown>, extra: unknown): Promise<CallToolResult> => {
      const result = await handler(args, extra);
      const board = typeof args?.board === "string" ? args.board : undefined;
      return board === undefined || VERBATIM.has(name) ? result : linked(board, result);
    };
    server.tool(name, description, shape, wrapped as unknown as ToolCallback<Args>);
  };

  const touched = new Set<string>();
  const announced = new Set<string>();
  const hosted = typeof (store as Store & { access?: () => Promise<Session> }).access === "function";
  // Only a real .staves directory can be watched; an account or a daemon has to be asked.
  const watchable = store instanceof Store && !hosted;
  let stopWatching: (() => void) | undefined;
  /** A queued request sits on the board; nothing delivers it. Tell the connected agent it is there. */
  const announce = async () => {
    if (!server.isConnected()) return;
    // Nothing here may disturb the session: a notice about waiting work is never worth an error.
    try {
      for (const board of watchable ? await store.list().catch(() => [...touched]) : [...touched]) {
        const inbox = await listAssessmentRequests(store, board).catch(() => []);
        for (const request of newlyQueuedRequests(announced, inbox)) {
          await server.server.sendLoggingMessage({ level: "info", logger: "staves", data: `New Staves request ${request.id} on board ${board} (${request.intent}). Call staves_requests to claim it.` }).catch(() => {});
        }
      }
    } catch { /* A store that cannot be listed simply has nothing to announce. */ }
  };
  const watchRequests = () => {
    stopWatching?.();
    if (watchable) {
      let soon: ReturnType<typeof setTimeout> | undefined;
      stopWatching = store.watch(() => {
        if (soon) return;
        soon = setTimeout(() => { soon = undefined; void announce(); }, 250);
        soon.unref();
      });
    } else {
      // Ask instead, and only about the boards this session has touched.
      const timer = setInterval(() => void announce(), 30_000);
      timer.unref();
      stopWatching = () => clearInterval(timer);
    }
    void announce();
  };
  // A board directory that did not exist yet cannot be watched; re-arm when a new board is named.
  const remember = (board: string) => { const fresh = !touched.has(board); touched.add(board); if (fresh) watchRequests(); return board; };
  /** A board name arrives from a person or another agent and can simply be wrong. A read that answers
   * about an empty board hides the typo; creating one to satisfy a read would be worse. */
  const requireBoard = async (board: string) => {
    if (!(await store.has(board))) throw new Error(`No board named "${board}". Boards: ${(await store.list()).join(", ") || "none yet"}. Use staves_start to create one.`);
    remember(board);
  };

  server.resource("interview", "staves://interview", async () => ({ contents: [{ uri: "staves://interview", text: AGENT_INTERVIEW }] }));
  server.prompt("interview", "Interview here and draw draft work in the background; no repository or provider key required.", { board: z.string().optional() }, ({ board }) => ({ messages: [{ role: "user", content: { type: "text", text: `${AGENT_INTERVIEW}\n${board ? `Continue board ${board}: ${boardLink(url, board)}` : "Begin with the context already provided; ask one useful question if needed."}` } }] }));
  tool("staves_access", "Read this connection's current permission, accessible board selection and remaining creation allowance before writing. Does not create a board.", {}, async () => {
    const scopedStore = store as Store & { access?: () => Promise<Session> };
    // No board is named here, so there is none to link. The workspace is what this connection can
    // open, and it is the one link that answers "where is any of this".
    const workspace = workspaceUrl(url);
    if (!scopedStore.access) return text(JSON.stringify({ workspace: "local", workspaceUrl: workspace, note: "Local workspace: no hosted creation allowance applies. Scope the work with the person before creating boards; agent contributions do not confer human confirmation." }));
    const grant = await scopedStore.access();
    const remaining = grant.permission === "contribute" ? Math.max(0, grant.createLimit - grant.createdCount) : 0;
    // A connection that cannot create a board is not a dead end, and an agent that says it is has
    // stranded someone in a terminal. The approval page makes the board this project needs and the
    // same account page raises the allowance, so the way out is a sentence the agent can repeat.
    const accountUrl = `${workspace}#account`;
    const nextStep = grant.permission === "read"
      ? { tell: `This connection is read-only. Rerun npx @staves/cli connect in this project and choose "Read and contribute" with a board, or change the connection under Account → Coding agents at ${accountUrl}.`, command: "npx @staves/cli connect", accountUrl }
      : remaining === 0
        ? { tell: `Rerun npx @staves/cli connect in this project and tick "Create a new board for this project", or raise the allowance under Account → Coding agents at ${accountUrl}.`, command: "npx @staves/cli connect", accountUrl }
        : undefined;
    return text(JSON.stringify({ boards: grant.boards, permission: grant.permission, createLimit: grant.createLimit, createdCount: grant.createdCount, remaining, workspaceUrl: workspace, ...(nextStep ? { nextStep } : {}), note: `Created boards join this connection. A person must authorize any additional creation allowance. Human confirmation and proposal acceptance are not delegated.${nextStep ? " Tell the person the nextStep sentence verbatim; do not create a board." : ""}` }));
  });
  tool("staves_interview", "Get the interview craft and existing board context. You are the interviewer; use your current model and save drafts through these tools.", { board: z.string().optional() }, async ({ board }) => {
    const current = board ? await store.board(board) : undefined;
    return text(`${AGENT_INTERVIEW}\n\n${current && board ? `${brief(current)}\n\n${vocabularyContext(current)}\n${where(board)}` : "No board created yet. Scope the work in conversation, then staves_start and share its link."}`);
  });
  tool("staves_interview_record", "Save actual words reported by the person, separately from your interpretation. Agent-attributed evidence, not human confirmation. Build the corresponding draft graph at a coherent interview checkpoint; do not force a write before every question.", { board: z.string(), quote: z.string().min(1), interpretation: z.string().optional(), about: z.string().default("board") }, async ({ board, quote, interpretation, about }) => {
    const id = `interview:${ulid()}`;
    const at = new Date().toISOString();
    await store.append(board, [
      { t: "comment", comment: { id, about, by: who(), text: `Reported words (recorded by agent):\n${quote}${interpretation ? `\n\nAgent interpretation (unconfirmed):\n${interpretation}` : ""}`, at } },
      { t: "setContext", context: { agentProgress: { state: "working", summary: "Interview answer saved; draft mapping in progress.", updatedAt: at } } },
    ], who());
    return text(`Saved reported account ${id}. Cite this id in draft rationale; do not mark it human-confirmed. ${where(board)}`);
  });
  tool("staves_interview_progress", "Save honest progress: working, partial (paused or blocked), or ready for human review. Does not mark behavior implemented or confirm the description.", { board: z.string(), state: z.enum(["working", "partial", "ready"]), summary: z.string().min(1) }, async ({ board, state, summary }) => {
    const current = await store.board(board);
    if (state === "ready" && !current.jobs.some(job => !job.removed)) return text("Cannot mark ready for review: no draft jobs have been saved. Use partial and explain what is missing.");
    await store.append(board, [{ t: "setContext", context: { agentProgress: { state, summary, updatedAt: new Date().toISOString() } } }], who());
    return text(`Progress: ${state === "ready" ? "ready for human review" : state}. ${summary}\n${where(board)}${state === "ready" ? `\n\n${review(current)}` : ""}`);
  });

  tool("staves_langfuse_connect", "Connect this board to a Langfuse project using public configuration only. Credentials stay in the agent environment; never pass secrets here. Several boards may share one project.", { board: z.string(), baseUrl: z.string(), projectId: z.string() }, async ({ board, baseUrl, projectId }) => {
    const current = await store.board(board);
    const connection = validateLangfuseConnection({ baseUrl, projectId });
    if (current.context?.langfuse && JSON.stringify(validateLangfuseConnection(current.context.langfuse)) !== JSON.stringify(connection) && current.jobs.some(item => item.executionEvidence?.length)) throw new Error("This board has execution evidence. Keep its Langfuse connection or use a separate board for another project or host.");
    if (JSON.stringify(current.context?.langfuse) !== JSON.stringify(connection)) {
      await store.append(board, [{ t: "setContext", context: { langfuse: connection } }], who());
    }
    return text(`Langfuse project reference saved; access has not been checked and evidence has not been fetched. Configure LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL in the MCP server launch environment; do not send them as tool arguments. Run staves_langfuse_probe to verify access, then staves_langfuse_discover to find observations. Use staves_langfuse_instrumentation for job mapping. ${where(board)}`);
  });

  tool("staves_langfuse_probe", "Verify Langfuse project and observation access using the MCP process environment. Read-only; never supply secrets. Without a board, discover the project attached to the configured key.", { board: z.string().optional() }, async ({ board }) => {
    const connection = board ? (await store.board(board)).context?.langfuse : undefined;
    return text(JSON.stringify(await probeLangfuseAccess(connection), null, 2));
  });
  tool("staves_langfuse_discover", "Find one bounded page of observation metadata. No prompts/outputs or automatic associations. Use candidate IDs to import evidence; expand the time window for older runs.", {
    board: z.string(), fromStartTime: z.string().datetime().optional(), toStartTime: z.string().datetime().optional(), traceId: z.string().optional(), name: z.string().optional(), environment: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional(),
  }, async ({ board, ...query }) => {
    const connection = (await store.board(board)).context?.langfuse;
    if (!connection) throw new Error("Select a project with staves_langfuse_connect; use staves_langfuse_probe to discover and verify your configured project first.");
    return text(JSON.stringify(await discoverLangfuseObservations(connection, query), null, 2));
  });

  tool("staves_langfuse_instrumentation", "Get stable board/job metadata for direct Langfuse observation instrumentation. Read-only. One job may encompass many observations and traces; missing telemetry means not observed.", { board: z.string(), job: z.string() }, async ({ board, job }) => {
    const current = await store.board(board);
    const target = current.jobs.find(item => item.id === job && !item.removed);
    if (!target) throw new Error(`No job "${job}" on ${board}.`);
    if (!current.context?.langfuse) throw new Error("Connect a Langfuse project first with staves_langfuse_connect.");
    const revision = (await store.entries(board)).at(-1)?.seq ?? 0;
    const exitTargets = [...new Set((target.exits ?? []).map(exit => exit.target ?? "stop"))];
    const exitValue = exitTargets.length ? `one of: ${exitTargets.join(", ")}` : "<the id of the job the work went to next from a decision, or stop>";
    return text(JSON.stringify({
      connection: current.context.langfuse,
      metadata: {
        "staves.board_id": board,
        "staves.job_id": job,
        "staves.design_revision": String(revision),
        "staves.exit": exitValue,
        "staves.case": "<one id shared by every observation of the same unit of work; omit when one trace is one case>",
      },
      boardUrl: boardLink(url, board),
      guidance: "Attach these keys directly to each Langfuse observation representing this job, using the project's existing SDK and environment credentials. Capture this revision when implementing the design; retain it on subsequent runs until that design changes. Do not map every internal span to a separate job. Never copy prompts, inputs, outputs or secrets to Staves. Import evidence using staves_langfuse_evidence with its trace and observation ids. A technical success does not prove the intended outcome or human approval. Set staves.exit on the decision job's observation to the id of the job the work went to next (or stop), and staves.case on every observation of one unit of work when a trace is not one case. These let staves_langfuse_runs count exits and replay a case; they carry no prompt or output.",
    }, null, 2));
  });

  tool("staves_langfuse_evidence", "Read one Langfuse observation with local credentials. Tagged observations attach directly; untagged historical observations need associationRationale and become proposals for human review. No prompts or outputs are copied. At most 100 retained captures per job. Use refresh for later state of an existing capture.", {
    board: z.string(), job: z.string(), traceId: z.string(), observationId: z.string(),
    associationRationale: z.string().min(1).max(2000).optional(), implementationRef: z.string().min(1).max(2048).optional(),
    fromStartTime: z.string().datetime().optional(), toStartTime: z.string().datetime().optional(),
  }, async ({ board, job, traceId, observationId, associationRationale, implementationRef, fromStartTime, toStartTime }) => {
    const current = await store.board(board);
    const target = current.jobs.find(item => item.id === job && !item.removed);
    if (!target) throw new Error(`No job "${job}" on ${board}.`);
    if (!current.context?.langfuse) throw new Error("Connect a Langfuse project first with staves_langfuse_connect.");
    const connection = validateLangfuseConnection(current.context.langfuse);
    const existing = target.executionEvidence ?? [];
    const duplicate = [...existing].reverse().find(item => !item.retraction && item.projectId === connection.projectId && (item.baseUrl ?? connection.baseUrl) === connection.baseUrl && item.traceId === traceId && item.observationId === observationId);
    if (duplicate) return text(JSON.stringify({ status: "already-linked", key: executionEvidenceKey(duplicate), traceUrl: langfuseTraceUrl(connection, duplicate), guidance: "Use staves_langfuse_refresh with this capture key to fetch a later state.", boardUrl: boardLink(url, board) }));
    if (existing.length >= 100) throw new Error("This job already has 100 retained evidence captures.");
    const evidence = await fetchLangfuseEvidence(connection, { traceId, observationId, boardId: current.id, jobId: job, associationRationale, implementationRef, fetchedBy: who(), fromStartTime, toStartTime });
    await store.append(board, [{ t: "addExecutionEvidence", id: job, evidence }], who(), evidence.mapping?.method === "proposed");
    const saved = await store.board(board);
    const linked = saved.jobs.find(item => item.id === job)?.executionEvidence?.some(item => executionEvidenceKey(item) === executionEvidenceKey(evidence));
    return text(JSON.stringify({ status: linked ? "linked" : "pending-human-review", key: executionEvidenceKey(evidence), evidence, traceUrl: langfuseTraceUrl(connection, evidence), boardUrl: boardLink(url, board), guidance: "This is an agent-fetched observation, not independent source verification or proof of the intended outcome. Proposed historical associations must be reviewed on the board." }, null, 2));
  });

  tool("staves_langfuse_refresh", "Fetch a later state of one exact evidence capture, retaining its previous summary and mapping. Requires local Langfuse credentials. Never refreshes a retracted reference or changes its source. At most 100 retained captures per job.", {
    board: z.string(), job: z.string(), key: z.string(), fromStartTime: z.string().datetime().optional(), toStartTime: z.string().datetime().optional(),
  }, async ({ board, job, key, fromStartTime, toStartTime }) => {
    const current = await store.board(board);
    const prior = current.jobs.find(item => item.id === job && !item.removed)?.executionEvidence?.find(item => executionEvidenceKey(item) === key);
    if (!prior?.observationId) throw new Error("An existing observation capture is required for refresh.");
    if (!current.context?.langfuse) throw new Error("Connect the original Langfuse project before refreshing.");
    const evidence = await refreshLangfuseEvidence(current.context.langfuse, prior, { boardId: current.id, jobId: job, traceId: prior.traceId, observationId: prior.observationId, fetchedBy: who(), fromStartTime, toStartTime });
    await store.append(board, [{ t: "addExecutionEvidence", id: job, evidence }], who(), evidence.mapping?.method === "proposed");
    const saved = await store.board(board);
    const linked = saved.jobs.find(item => item.id === job)?.executionEvidence?.some(item => executionEvidenceKey(item) === executionEvidenceKey(evidence));
    return text(JSON.stringify({ status: linked ? "refreshed" : "pending-human-review", key: executionEvidenceKey(evidence), previousKey: key, evidence, boardUrl: boardLink(url, board), guidance: "Earlier capture retained. This observation does not establish job completion or case coverage." }, null, 2));
  });

  tool("staves_langfuse_retract", "Retract a selected evidence capture with a reason while retaining its history. This labels a copied reference; it does not revoke upstream access or delete Langfuse data.", { board: z.string(), job: z.string(), key: z.string(), reason: z.string().min(1).max(2000) }, async ({ board, job, key, reason }) => {
    await store.append(board, [{ t: "retractExecutionEvidence", id: job, key, reason }], who());
    const saved = await store.board(board);
    const retracted = saved.jobs.find(item => item.id === job)?.executionEvidence?.find(item => executionEvidenceKey(item) === key)?.retraction;
    return text(JSON.stringify({ status: retracted ? "retracted" : "pending-review", retraction: retracted, boardUrl: boardLink(url, board) }));
  });

  /** The window every as-run answer is bounded by, and the depth of the scan that produced it.
   * A replay needs them too: a case older than the window is not in the scan that finds it. */
  const asRun = { days: z.number().int().min(1).max(90).optional(), maxPages: z.number().int().min(1).max(50).optional() };
  /** The scan behind both tools: this board's connected project, read with the process credentials. */
  const scanRuns = async (board: string, days = 7, maxPages = 20) => {
    const current = await store.board(board);
    const connection = current.context?.langfuse;
    if (!connection) throw new Error("Select a project with staves_langfuse_connect; use staves_langfuse_probe to discover and verify your configured project first.");
    const toStartTime = new Date().toISOString();
    const fromStartTime = new Date(Date.parse(toStartTime) - days * 86_400_000).toISOString();
    return { board: current, scan: await readObservations(connection, { boardId: current.id, fromStartTime, toStartTime, maxPages }) };
  };

  tool("staves_langfuse_runs", "How a board's workflow actually ran in a window: per job the runs, failure count and duration percentiles; per decision the exits taken; per handoff how often the work went that way; and drift in both directions. Read-only, bounded, and carrying no prompt, input or output. Measurement beside the design, never approval of it.", {
    board: z.string(), ...asRun,
  }, async ({ board, days, maxPages }) => {
    const { board: current, scan } = await scanRuns(board, days, maxPages);
    return text(JSON.stringify({ ...aggregateRuns(scan, current), guidance: "Measurements, not approval. A job with runs is not thereby implemented as designed; a job with none is not thereby missing. Raise drift as staves_ask questions if the person should decide." }, null, 2));
  });

  tool("staves_langfuse_run", "Replay one unit of work as a path through the board: the steps in the order they happened, with what each took and which exit it left by. The case is a staves.case id or a trace id. A job the board no longer has is shown as unknown, never dropped.", {
    board: z.string(), case: z.string().min(1).max(200), ...asRun,
  }, async ({ board, case: caseId, days, maxPages }) => {
    const { board: current, scan } = await scanRuns(board, days, maxPages);
    return text(JSON.stringify(replayRun(scan.observations, caseId, current), null, 2));
  });

  server.resource("protocol", "staves://protocol", async () => ({ contents: [{ uri: "staves://protocol", text: PROTOCOL }] }));
  server.resource("granularity", "staves://granularity", async () => ({ contents: [{ uri: "staves://granularity", text: GRANULARITY }] }));

  const msg = (t: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }] });
  server.prompt("describe", "Describe this project's workflow to staves, as work not code, and draw the board.", { board: z.string().optional().describe("board id; default: the project name") }, ({ board }) =>
    msg(`Describe this repo's workflow to staves${board ? ` on the board "${board}"` : ""}. Work, not code. Before writing anything, read the routes, prompts, cron and queue config, migrations, and every place a person types or approves. Then: staves_start with the goal in one sentence; every performer with staves_track; what changes hands with staves_artifact; one staves_describe per job, named by what it achieves (three to five words; the sentence goes in outcome), with what starts it, what it takes and produces, what's different when it's done, who's waiting on it, what you'd check, and the files you read as sources. Give every exit a target and every loop a limit; where the code doesn't say, say unknown and use staves_ask. Keep consequential jobs and decisions visible. Group only when it improves readability; inspect the rendered board before reporting ready. Finish by telling me the board is at ${url}.`),
  );
  server.prompt("resume", "Pick the board back up: read the brief, find what changed since, re-describe what's stale.", { board: z.string().optional() }, ({ board }) =>
    msg(`Resume staves${board ? ` on "${board}"` : ""}. Read staves_brief first so you know the work as it was described and what is still open. Then run staves_stale; for each stale job, re-read its sources and re-describe it with the same id (confirmed jobs come back as proposals — that is fine). Answer any question you now can with staves_answer. Tell me what changed and what still waits on me at ${url}.`),
  );
  server.prompt("discuss", "Reply to the person's comments on the board: why it is or isn't a good idea, what is missing, what would be needed.", { board: z.string().optional() }, ({ board }) =>
    msg(`Read staves_brief${board ? ` for "${board}"` : ""}, then staves_comments. For each comment, reply in place with staves_comment (replyTo = its id): engage with the substance — is it a good idea, what breaks if we do it, what is missing from the description that would tell us, what you would need to check in the code. Where a comment calls for a change, make it a staves_propose so I can accept or reject it. Where it reveals something you described too coarsely, split the job into tasks the way a person would tell them and say what each tool actually returns and leaves out.`),
  );
  server.prompt("deepen", "Break a job down the way a person would tell it, with what every tool actually returns and leaves out.", { job: z.string().describe("job id or name") }, ({ job }) =>
    msg(`Read staves://granularity. Then take the staves job "${job}" and describe it so a competent stranger could do it by hand and get the same result, including the same failures: staves_split it into tasks in order, then staves_describe each with parent="${job}", answering for each — what arrives; what you open; what you look at (which part, how much, how far in); what you're looking for; what you do with it; when you stop; what you do when it isn't there, is ambiguous, or disagrees. On every tool: what comes back for this task (does) and what it does not return or does on failure (limits). "Unknown" is acceptable; missing is not. Then tell me what you found that a person would have wanted to know.`),
  );
  server.prompt("hats", "Wear each role's hat in turn and look for gaps and opportunities in the described work.", { board: z.string().optional() }, ({ board }) =>
    msg(`Read staves_brief${board ? ` for "${board}"` : ""}. Then call staves_hats and take each chair in turn — the outside parties first, then the people, then the agents, then the systems. From each chair, in first person, say: what I am waiting on and how long I would put up with it; what I need that nobody produces; what I am asked to decide without what I would need to decide it; what I check and what I cannot check; what I do that a stranger could do from the description; what I would refuse to hand to an agent and why; what I would never know went wrong. Record each observation as staves_comment on the job it concerns, with as = the role. Where an observation calls for a change — a missing check, a bounded wait, a gate with a name on it, a run of tasks an agent could take — make it a staves_propose so the person can accept it. End by telling me the three things that would matter most to the person on the outside.`),
  );
  server.prompt("plain", "Re-read every job as the person who does that work today; propose the names and outcomes they would use.", { board: z.string().optional() }, ({ board }) =>
    msg(`Read staves_brief${board ? ` for "${board}"` : ""}. Now take the chair of the person who does each job today — the adjuster, the requester, the analyst — and read its name, outcome and beneficiary aloud in their voice. Anywhere they would ask "what does that word mean?", or would not recognise it as their job, propose a rename with staves_propose: the name as they would say it (three to five words), the outcome as they would explain it to a new colleague, using the words of the goal, the outside parties and the things that change hands — never the words of the system. Do the same for the groups the cut made. Then tell me which names you changed and why, in one line each.`),
  );
  server.prompt("reflect", "Zoom out: check the board's logic, whether it can be done, and whether it serves its goal — then say what you'd change.", { board: z.string().optional() }, ({ board }) =>
    msg(`Call staves_reflect${board ? ` for "${board}"` : ""}, then read staves_brief. Think in three lenses — does the flow hold together, can each step actually be done by who it is assigned to with the tools named, does the whole thing deliver the stated outcome to the person it is for without the one thing that must not happen. For each real problem: add a comment on the job it concerns (staves_comment) saying what and why, and propose the change (staves_propose). Then tell me the three things that matter most, in plain words.`),
  );
  server.prompt("issues", "Pick up everything the person raised on the board and work through it.", { board: z.string().optional() }, ({ board }) =>
    msg(`Call staves_issues${board ? ` for "${board}"` : ""}. Work through it in order: for each question or comment, read the sources of the job it concerns, answer or reply in place, and where the code needs to change, say exactly what you would change in the code and propose the board change with staves_propose. For each finding, either fix the description (with sources) or explain why the finding is wrong. Finish with what you changed, what you propose, and what you need from the person.`),
  );
  server.prompt("analyse", "Describe the repo, then give the analysis in one read.", { board: z.string().optional() }, ({ board }) =>
    msg(`Describe this repo's workflow to staves${board ? ` on the board "${board}"` : ""} (follow staves_help), check the visible journey, then call staves_review and give me its gist in five lines: what the work is, who does it, where a person would be surprised, where an agent is trusted blind, and the three things to do first. For every agent or orchestrator, attach where its instructions live (instructions on staves_describe) so I can read them from the board.`),
  );
  server.prompt("review", "Before changing code: what the board says about the work you are about to touch.", { job: z.string().optional().describe("job id or name, if you know it") }, ({ job }) =>
    msg(`I'm about to change code. Read staves_brief and tell me which job${job ? ` — probably "${job}" —` : ""} the change touches, who is waiting on it, what its done-when says, and any gate or exit it affects. After the change, re-describe that job.`),
  );

  tool(
    "staves_start",
    "Start or reopen a board for one piece of work. Give it a title in the language of the work (\"How a lead becomes a sent proposal\"), the goal in one sentence (what it delivers, to whom, and the rule that must never be broken), and where this description comes from.",
    { board: z.string().describe("short id, e.g. lookup"), title: z.string(), goal: z.string().optional(), origin: z.string().optional() },
    async ({ board, title, goal, origin }) => {
      const existing = await store.entries(remember(board));
      const b = await store.append(board, [
        { t: "board", id: board, title, goal, origin },
        ...(existing.length ? [] : [{ t: "setContext" as const, context: { agentProgress: {
          state: "working" as const, summary: "Board created. Continue in your coding agent while it saves the draft.", updatedAt: new Date().toISOString(),
        } } }]),
      ], who());
      return text(`Board "${b.id}" saved; description may still be empty. ${where(board)}\n\n${PROTOCOL}`);
    },
  );

  tool(
    "staves_track",
    "Add a performer: a person (a role, not a name), an agent (say which model or prompt), a system (a service), or an outside party (a customer, a registry, a mail provider). One track per performer.",
    { board: z.string(), id: z.string(), name: z.string(), kind: z.enum(["person", "agent", "system", "outside"]), meta: z.string().optional().describe("one line: what this performer is for or what is unknown about it") },
    async ({ board, id, name, kind, meta }) => {
      await store.append(board, [{ t: "track", track: { id, name, kind, meta } }], who());
      return text(`Track "${name}" (${kind}) added.`);
    },
  );

  tool(
    "staves_artifact",
    "Name something that changes hands: a document, data, a decision, a message, a record. Mark it external if it enters from outside and nothing on the board produces it. Say where it lives if you know.",
    { board: z.string(), id: z.string(), name: z.string(), kind: z.enum(["document", "data", "decision", "message", "record", "instruction", "measure", "other"]).default("other"), external: z.boolean().optional(), livesIn: z.string().optional() },
    async ({ board, id, name, kind, external, livesIn }) => {
      await store.append(board, [{ t: "artifact", artifact: { id, name, kind, external, livesIn } }], who());
      return text(`Artifact "${name}" added.`);
    },
  );

  const descriptionFields = {
      id: z.string(),
      name: z.string(),
      track: z.string(),
      parent: z.string().optional().describe("job id, if this is a task inside a job"),
      kind: z.enum(["work", "queue", "store", "watch", "ghost", "outside"]).optional(),
      outcome: z.string().optional(),
      beneficiary: z.string().optional(),
      doneWhen: z.array(z.string()).optional(),
      rationale: z.string().optional(),
      trigger: z.enum(["hand", "ask", "event", "chain", "clock", "watch", "deadline", "always", "other"]).optional().describe("how it starts: hand (someone gets to it), ask (someone asks for it), event (something arrives), chain (the previous one ends), clock (a schedule), watch (a condition is met), deadline (time runs out), always (never stops), other (say it in triggerNote)"),
      triggerNote: z.string().optional().describe("the trigger in the person's words when none of the kinds fit"),
      inputs: z.array(z.string()).default([]),
      outputs: z.array(z.string()).default([]),
      prerequisites: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("all"), inputs: z.array(z.string()) }),
        z.object({ kind: z.literal("any"), inputs: z.array(z.string()) }),
        z.object({ kind: z.literal("unknown"), inputs: z.array(z.string()) }),
        z.object({ kind: z.literal("conditional"), inputs: z.array(z.string()), condition: z.string().min(1) }),
      ]).optional().describe("Explicit start rule over input artifact IDs. Omit when unresolved; never infer all from multiple handoffs. Conditional requires the named condition and all listed inputs."),
      exits: z.array(z.object({ condition: z.string(), target: z.string().optional(), share: z.number().optional() })).optional(),
      gate: z.object({ rule: z.string(), accountable: z.string().optional(), ruleOwner: z.string().optional() }).optional(),
      loop: z.object({ to: z.string(), limit: z.number().optional(), then: z.string().optional() }).optional(),
      tools: z.array(z.object({ name: z.string(), reach: z.enum(["api", "mcp", "screen", "none"]), personal: z.boolean().optional(), does: z.string().optional().describe("what it actually returns for this task, as a person would say it"), limits: z.string().optional().describe("what it leaves out or cuts off — characters, sections, results, time, sampling; say 'unknown' rather than omit") })).optional(),
      examples: z.array(z.object({ in: z.string(), out: z.string(), note: z.string().optional() })).optional().describe("one input as it arrived and what it became — give one for any task that transforms data"),
      checks: z.array(z.object({ rule: z.string(), onFail: z.string().optional() })).optional().describe("what this task checks, and what happens when a check fails"),
      sources: z.array(z.object({ path: z.string(), symbol: z.string().optional() })).optional().describe("where in the code this job lives: file paths (and symbols) you read to describe it"),
      instructions: z.array(z.object({ path: z.string(), symbol: z.string().optional(), summary: z.string().optional(), text: z.string().optional().describe("the instruction text itself, when the board cannot read the repo (hosted); keep it to what matters, ≤ 4000 chars") })).optional().describe("for agents and orchestrators: where their instructions live — the prompt, rubric, or config file (and symbol) — with a one-line summary of what it tells them to do. The board shows the text read-only from the repo."),
      minutes: z.number().optional().describe("performer minutes per instance, if known"),
      perWeek: z.number().optional().describe("instances per week at this job, if it differs from the board"),
      implementation: z.object({ state: z.enum(["unknown", "planned", "in-progress", "implemented"]), note: z.string().optional() }).optional().describe("Implementation maturity, separate from description confirmation. Missing means unknown; code references alone do not establish completeness."),
      confidence: z.number().min(0).max(1).optional(),
    };
  const descriptionSchema = z.object(descriptionFields);
  const recordDescription = async (a: z.infer<typeof descriptionSchema> & { board: string }) => {
      const { board, confidence, ...rest } = a;
      const cur = await store.board(remember(board));
      if (!cur.tracks.some((t) => t.id === rest.track))
        return text(`No track "${rest.track}". Tracks on this board: ${cur.tracks.map((t) => `${t.id} (${t.name})`).join(", ") || "none yet — add them with staves_track first"}.`);
      if (rest.parent && !cur.jobs.some((j) => j.id === rest.parent))
        return text(`No job "${rest.parent}" to be the parent. Describe it first, or leave parent out.`);
      if (rest.name.trim().split(/\s+/).length > 6 && rest.kind !== "ghost")
        return text(`"${rest.name}" is a sentence. Give the job a name of three to five words (what it achieves) and put the sentence in outcome.`);
      if (rest.gate && !rest.gate.accountable)
        return text(`The gate "${rest.gate.rule}" needs an accountable party: a person's track id, or "rule" plus ruleOwner. If the code does not say, use accountable: "rule" and ruleOwner: "unknown" — that becomes a finding, not a guess.`);
      const notes: string[] = [];
      const pushback = async (msg: string) => { notes.push(msg); await store.append(board, [{ t: "comment", comment: { id: `c:${Date.now()}${Math.random().toString(36).slice(2, 5)}`, about: rest.id, by: "staves", text: `noticed: ${msg}`, at: new Date().toISOString() } }], "staves"); };
      if (CODE_NAME.test(rest.name) && rest.kind !== "store" && rest.kind !== "queue")
        await pushback(`"${rest.name}" names code, not work. Name the job by what a person has when it is done — "Admit the claim", "Deliver the report", "Find the owner" — and keep the mechanics for rationale or sources. If nobody but another step is waiting on this, it is a task: give it a parent.`);
      if (rest.beneficiary && MACHINE_BENEFICIARY.test(rest.beneficiary) && !rest.parent)
        await pushback(`"${rest.beneficiary}" is a system, not a person. Who is the person or outside party on the far side of this — the one who has something when it's done? If the honest answer is "only the next step", this is a task inside a job: describe the job it belongs to, then this with parent.`);
      // artifacts the agent forgot to declare: create them, and ask
      const missing = [...new Set([...rest.inputs, ...rest.outputs])].filter((id) => !cur.artifacts.some((x) => x.id === id));
      const createOps = missing.flatMap((id) => [
        { t: "artifact" as const, artifact: { id, name: id.replace(/[-_]+/g, " "), kind: "other" as const } },
        { t: "ask" as const, question: { id: `q:art:${id}`, about: rest.id, askedBy: "staves" as const, text: `"${id}" was used before it was declared. What is it — a document, data, a decision, a message, a record — and where does it live?` } },
      ]);
      if (createOps.length) await store.append(board, createOps, "staves");
      const root = repoRoot(store.dir);
      const job: Job = {
        ...rest,
        exits: rest.exits as Job["exits"],
        provenance: { source: "agent", by: who(), confidence, at: new Date().toISOString(), commit: root ? headCommit(root) : undefined },
        status: "draft",
      };
      const qs = accountQuestions(job);
      const existing = (await store.board(board)).jobs.find((j) => j.id === job.id);
      const changesConfirmed = !!existing && existing.status === "confirmed";
      // a new job, or a change to a draft, applies; a change to something a person confirmed is a proposal
      const b = await store.append(board, [{ t: "job", job }], who(), changesConfirmed);
      const f = lint(b).filter((x) => x.about === job.id && x.rule !== "account-missing" && x.rule !== "orphan");
      const lines = [changesConfirmed ? `"${job.name}" is confirmed by a person; your change is recorded as a proposal and waits for them.` : `"${job.name}" recorded (draft, said by ${who()}).${notes.length ? ` Noticed (recorded anyway — fix with staves_patch, no need to resend): ${notes.map((n) => n.split(". ")[0]).join(" · ")}` : ""}`];
      if (missing.length) lines.push(`Declared on the fly, please describe with staves_artifact: ${missing.join(", ")}.`);
      if (qs.length) lines.push("", "Questions to clarify this description:", ...qs.map((q) => `- ${q}`));
      if (f.length) lines.push("", "Noticed:", ...f.map((x) => `- ${x.message}`));
      return text(lines.join("\n"));
    };
  tool(
    "staves_describe",
    [
      "Describe one job as work, not as code. A job is named by what a person has when it is done — someone is waiting on it, and that someone is a person or an outside party, never a system. If only another step waits on it, it is a task: give it a parent.",
      "Describe from the outside in: the people who ask and receive first, then the jobs between them, then machinery as tasks inside those jobs.",
      "Helpful for understanding the job: outcome (what is different when it's done), beneficiary (who is waiting on it and what they do with it), doneWhen (what you would check).",
      "You may submit without them; the job is kept as a draft and you get the questions back. Answer them by calling staves_describe again with the same id.",
      "Say what starts it: event (something arrives), chain (the previous job ends), clock (a schedule), hand (a person gets to it).",
      "List inputs and outputs by artifact id — handoffs are derived from these, never drawn.",
      "If the job decides something, give the gate: the rule in words, and who is accountable (a track id, or \"rule\" if a rule decides — then name the rule's owner if you can).",
      "Give every exit a target (a job id, or \"stop\"). An exit with no target is a finding, not an error — leave it if the code truly does not say.",
      "Loops: say where it goes back to and the limit; a loop without a limit is a finding.",
      "Tasks pass the stranger test: a competent stranger could do it by hand from the description and get the same result, including the same failures. Answer: what arrives; what you open; what you look at — which part, how much, how far in; what you're looking for; what you do with it; when you stop; what you do when it isn't there, is ambiguous, or disagrees. Put that narration in outcome/doneWhen/rationale.",
      "Tools: name them, how they are reached (api, mcp, screen, none), what comes back for this task (does: shape, portion, size, freshness, verbatim or summarised), and what it does not return or does when it fails (limits). 'Unknown' is a valid value; a missing one is a finding. Mark a person's own spreadsheet, file, or colleague as personal.",
      "Where you cannot tell from the code, say unknown in the field or ask with staves_ask. Do not infer.",
    ].join(" "),
    { board: z.string(), ...descriptionFields },
    recordDescription,
  );

  tool(
    "staves_cut",
    "Optional grouping that mutates the board. Groups execution steps between human touchpoints and joins; it may hide consequential automated boundaries. Use only after checking candidate groups against the human-readable journey, never as a routine finishing step or on confirmed work. Returns grouped regions and naming questions.",
    { board: z.string() },
    async ({ board }) => {
      const b = await store.board(board);
      const { ops, questions } = applyCut(b);
      if (!questions.length) return text("Nothing to cut: every job is already between two human touchpoints, or the board is empty.");
      await store.append(board, ops, "staves");
      return text(["The cut made these composite jobs (draft, derived). Name each with staves_describe using its id, keeping the same id:", ...questions.map((q) => `- ${q.about}: ${q.text}`)].join("\n"));
    },
  );

  tool("staves_ask", "Ask the person something you could not tell from the code. Attach it to the job it concerns.", { board: z.string(), about: z.string().optional(), text: z.string() }, async ({ board, about, text: t }) => {
    const q: Question = { id: `q:${Date.now()}`, about, askedBy: "agent", text: t, at: new Date().toISOString() };
    await store.append(board, [{ t: "ask", question: q }], who());
    return text(`Asked (${q.id}). A person answers on the board or with staves_answer.`);
  });

  tool("staves_answer", "Answer an open question. If you are an agent answering a person's question, say so with by=agent.", { board: z.string(), id: z.string(), answer: z.string(), by: z.enum(["agent", "human"]).default("agent") }, async ({ board, id, answer, by }) => {
    await store.append(board, [{ t: "answer", id, answer, by, who: by === "agent" ? who() : undefined }], by === "human" ? "human" : who());
    return text("Answered.");
  });

  tool("staves_board", "Read the board as JSON, with findings.", { board: z.string() }, async ({ board }) => {
    const b = await store.board(board);
    return text(JSON.stringify({ ...b, findings: lint(b) }, null, 2));
  });

  tool("staves_handover", "Analyze a proposed transfer between a human role and an agent track. Returns moves, retained human work, blockers, prerequisites, and one atomic design operation. Does not apply or execute anything. Call staves_propose with handover: {job, toTrack, basis} from this analysis for human review.", { board: z.string(), job: z.string(), toTrack: z.string() }, async ({ board, job, toTrack }) => text(JSON.stringify(handoverPlan(await store.board(board), job, toTrack))));

  tool("staves_export", "Prepare a versioned workflow handoff for feasibility, prototyping, implementation comparison or a workshop, or write the whole board out. Read-only. json, markdown, prompt, svg and n8n are scoped handoffs that preserve stable IDs, gates, questions and scope boundaries. staves is the whole board in the open Staves format (a .staves.json document, https://staves.io/spec/0.1/board.schema.json); mermaid and bpmn draw the whole board from it, and ignore purpose and scope. Does not execute workflows or send content to third-party apps.", { board: z.string(), ...exportOptionsSchema.shape, format: z.enum(["json", "markdown", "prompt", "svg", "n8n", "staves", "mermaid", "bpmn"]).default("markdown") }, async ({ board, format, ...options }) => text(isBoardFormat(format) ? exportBoard(await store.board(board), format) : formatExport(await exportFromStore(store, board, options), format)));
  tool("staves_brief", "Read the board as prose: who does what, the jobs with their accounts, the cut, the findings, and what is still open. Read this before working on the system it describes.", { board: z.string() }, async ({ board }) => { await requireBoard(board); return text(brief(await store.board(board))); });

  tool("staves_comment", "Leave a comment on a job, a track, an artifact, or the board. Comments are for discussion; facts about the work go in staves_describe. When speaking from a role's chair (staves_hats), say so with `as`.", { board: z.string(), about: z.string().default("board"), text: z.string(), replyTo: z.string().optional(), as: z.string().optional().describe("the role you are speaking as, e.g. 'the analyst'") }, async ({ board, about, text: t, replyTo, as }) => {
    const by = as ? `${who()} as ${as}` : who();
    await store.append(board, [{ t: "comment", comment: { id: `c:${Date.now()}`, about, by, text: t, replyTo, at: new Date().toISOString() } }], by);
    return text("Commented.");
  });

  tool("staves_survey", "Only when a person explicitly asks for a survey. Call staves_access first; a survey uses one board of your creation allowance. Record the workflows you can see, one line each — the entry point where a request from someone outside arrives, the outcome for the person it is for, and a rough size. This writes the 'survey' board (each workflow is a job that opens its own board) and asks the person how to proceed: one workflow, an audit of all of them briefly, or all of them in depth. Then follow their answer: 'describe:<id>' → describe that one in depth on its own board named <id>; 'audit' → for each workflow, its own board with 3–6 jobs, no tasks, then staves_review each and give a one-line verdict per workflow; 'all' → each in depth. If they answered on the web page, staves_issues shows the answer.", { workflows: z.array(z.object({ id: z.string().describe("slug; becomes the board name"), name: z.string().describe("the outcome for the person: 'a shopper learns who owns a brand'"), for: z.string().describe("who it is for"), entry: z.string().describe("where the request arrives: route, queue, command, schedule"), size: z.string().optional().describe("rough: '3 jobs', '~12 jobs, 2 agents'") })).min(1).max(30) }, async ({ workflows }) => {
    const ops: any[] = [{ t: "board", id: "survey", title: "The workflows in this repo", goal: "Pick one to describe, audit them all briefly, or describe all in depth." }, { t: "track", track: { id: "flows", name: "Workflows", kind: "outside", meta: "each opens its own board" } }];
    for (const w of workflows) ops.push({ t: "job", job: { id: w.id, name: w.name, track: "flows", trigger: "hand", inputs: [], outputs: [], beneficiary: w.for, rationale: `entry: ${w.entry}`, size: w.size, boardRef: w.id, kind: "outside", provenance: { source: "agent", by: who() }, status: "draft" } });
    ops.push({ t: "ask", question: { id: "q-scope", about: "board", askedBy: "agent", text: "How should staves proceed? Answer describe:<id> for one workflow, audit for all briefly, or all for all in depth.", status: "raised", at: new Date().toISOString() } });
    await store.append("survey", ops, who());
    return text(`Survey recorded: ${workflows.length} workflow${workflows.length > 1 ? "s" : ""} on the "survey" board (${url}?board=survey).\n${workflows.map((w) => `- ${w.id}: ${w.name} — for ${w.for} — arrives via ${w.entry}${w.size ? ` — ${w.size}` : ""}`).join("\n")}\n\nNow ask the person, in chat: which one to describe in depth, an audit of all of them briefly, or all in depth. If they already chose on the web page, staves_issues on "survey" shows the answer as describe:<id>, audit, or all. Then do it: one board per workflow, named by its id.`);
  });

  tool("staves_patch", "Change one or more fields on a job without resending the whole description. Use it to fix anything staves noticed (a name, a beneficiary), to add a tool fact, a check, a way out. Same fields as staves_describe; only what you pass changes.", { board: z.string(), id: z.string(), patch: descriptionSchema.omit({ id: true, confidence: true }).partial().extend({ parent: z.string().nullable().optional() }) }, async ({ board, id, patch }) => {
    const b = await store.board(board); const j = b.jobs.find((x) => x.id === id && !x.removed); if (!j) return text(`No job "${id}" on ${board}.`);
    await store.append(board, [{ t: "updateJob", id, patch: patch as Partial<Job> }], who(), j.status === "confirmed");
    return text(`${j.status === "confirmed" ? "Proposed changes to" : "Patched"} "${j.name}": ${Object.keys(patch).join(", ")}.`);
  });

  tool("staves_impact", "Investigate declared upstream/downstream paths, shared concepts and decision authority before a substantive revision. Read-only candidates and targeted repository questions; no code or trace verification, no expanded edit authorization. Only the requested board is read.", { board: z.string(), jobIds: z.array(z.string()).max(80).optional(), conceptIds: z.array(z.string()).max(30).optional() }, async ({ board, jobIds, conceptIds }) => text(JSON.stringify(investigateImpact(await store.board(board), { jobIds, conceptIds }), null, 2)));

  tool("staves_vocabulary", "Read the versioned core work contract and this board's domain concepts, definitions, aliases, relationships and implementation mappings. Read-only; Langfuse and repository access are optional. Domain definitions are design knowledge, not proof of implementation.", { board: z.string() }, async ({ board }) => {
    const current = await store.board(board);
    return text(JSON.stringify({
      schema: "staves.vocabulary-context", schemaVersion: 1,
      boardId: current.id,
      core: {
        version: 1,
        entities: { board: "One workflow and its goal", track: "A performer or accountable role", job: "A unit of work; parent links a task to its containing job", artifact: "Something produced or consumed by work" },
        relations: { inputs: "Artifacts needed by a job", outputs: "Artifacts produced by a job", prerequisites: "Explicit all, any, conditional or unknown input requirements", gate: "Decision rule and accountability", exits: "Conditional paths or stops", loop: "Bounded repetition and what follows exhaustion" },
        boundaries: ["Design approval, implementation claims and observed execution are separate.", "One job can map to many observations; one implementation can support multiple jobs."]
      },
      vocabulary: current.vocabulary ?? null,
      basis: JSON.stringify(current.vocabulary ?? null),
      guidance: "Preserve namespace and concept IDs. Ask about ambiguous synonyms; never silently merge concepts. Propose a complete vocabulary revision with staves_vocabulary_propose. No vocabulary or integration is required to model work."
    }, null, 2));
  });

  tool("staves_vocabulary_propose", "Propose a coherent domain vocabulary revision for human review. Read staves_vocabulary first and preserve all existing identities. Inferred meanings stay inferred; a proposal does not confirm a definition or verify code. Includes explicit workflow links and optional repository/API/Langfuse mappings; never provide credentials.", { board: z.string(), vocabulary: vocabularySchema, basis: z.string().describe("Exact basis returned by staves_vocabulary") }, async ({ board, vocabulary, basis }) => {
    const current = await store.board(board);
    if (basis !== JSON.stringify(current.vocabulary ?? null)) throw new Error("The vocabulary changed. Read staves_vocabulary and reconcile before proposing.");
    const op = { t: "setVocabulary" as const, vocabulary: validateVocabulary(vocabulary, current) };
    await store.append(board, [op], who(), true, [captureProposalBasis(current, op)]);
    return text(JSON.stringify({ status: "pending-human-review", boardUrl: boardLink(url, board), guidance: "The active vocabulary is unchanged. A person reviews this revision on the board." }, null, 2));
  });

  tool("staves_words", "Tell the board the words this domain actually uses, so the jargon check stops flagging them ('edge', 'authority', 'timeout' in a network product). Adds to the board's context.", { board: z.string(), words: z.array(z.string()).min(1).max(60) }, async ({ board, words }) => {
    const b = await store.board(board); const have = (b.context as any)?.words ?? [];
    await store.append(board, [{ t: "setContext", context: { words: [...new Set([...have, ...words.map((w) => w.toLowerCase())])] } as any }], who());
    return text(`Noted ${words.length} domain word${words.length > 1 ? "s" : ""}; the jargon check now leaves them alone.`);
  });

  tool("staves_describe_many", "Describe several jobs using the same fields, evidence and checks as staves_describe. Put parents before their tasks. Unknown implementation stays unknown.", { board: z.string(), jobs: z.array(descriptionSchema).min(1).max(60) }, async ({ board, jobs }) => {
    const results = [];
    for (const job of jobs) results.push((await recordDescription({ board, ...job })).content[0].text);
    return text(results.join("\n\n"));
  });

  tool("staves_review", "The analysis of a board in one read: where a person would be surprised, where an agent is trusted blind, where the description is not yet the person's, runs an agent could take, open questions, and the three things to do first. Call it right after describing, and give the person the gist.", { board: z.string() }, async ({ board }) => { await requireBoard(board); return text(review(await store.board(board))); });

  tool("staves_reflect", "Zoom out and look at the whole board against its goal, in three lenses: does it hold together (logical), can it be done (functional), does it serve the goal for the person it is for (goal). Use it on your own description after you have described a system, before you tell the person it is done — and whenever you are about to build something from the board. Returns the reflections and, for each, what would fix it. You are the model that can reflect further: read the brief, then add what you see in the same three lenses as comments on the board, citing jobs.", { board: z.string() }, async ({ board }) => {
    const b = await store.board(board);
    return text(reflectionText(reflectRules(b)) + "\n\nThose are the structural ones. Now read staves_brief and reflect yourself in the same three lenses; add what you find with staves_comment (about the job), and propose changes with staves_propose.");
  });

  tool("staves_issues", "Everything a person has raised on the board, as a work list: questions they asked, comments awaiting your reply, and the findings. Read this when they say 'look at the issues' or 'what did I raise'. Answer in place; propose changes rather than making them.", { board: z.string() }, async ({ board }) => {
    await requireBoard(board);
    const b = await store.board(board);
    const raised = b.questions.filter((q) => !q.answer && q.askedBy === "human" && (q.status ?? "raised") === "raised");
    if (raised.length) await store.append(board, raised.map((q) => ({ t: "issue" as const, id: q.id, status: "picked-up" as const })), who());
    return text(issues(b));
  });

  tool("staves_focus", "One job as its own board: its tasks laid out on their tracks, with what comes in and what goes out at the edges. Use it to describe or discuss one part of the flow on its own.", { board: z.string(), job: z.string() }, async ({ board, job }) => {
    const b = await store.board(board);
    const f = focusBoard(b, job);
    return text(brief(f) + `\n\nThe person can open this at ${url}?board=${board}&focus=${job}`);
  });

  tool("staves_hats", "The board from each role's chair: what they do, wait on, answer for, and what is unresolved around them. Read one, then look for what that person would notice — gaps (what they'd need and don't get; waits nobody bounds; decisions with no one behind them; checks nobody makes) and opportunities (work they do that a stranger could do from the description; handoffs that could disappear). Record each as staves_comment with `as` the role, and staves_propose where a change follows.", { board: z.string(), track: z.string().optional().describe("one track id; omit for all") }, async ({ board, track }) => {
    const b = await store.board(board);
    const ts = b.tracks.filter((t) => !t.removed && (!track || t.id === track));
    if (!ts.length) return text("No such track.");
    return text(ts.map((t) => hatBrief(b, t.id)).join("\n\n---\n\n"));
  });

  tool("staves_propose", "Propose a design change for human acceptance. For role transfers pass handover with the job, destination and basis returned by staves_handover. Nothing executes.", { board: z.string(), id: z.string().optional(), patch: descriptionSchema.omit({ id: true, confidence: true }).partial().extend({ parent: z.string().nullable().optional(), removed: z.boolean().optional() }).optional(), remove: z.boolean().optional(), why: z.string().optional(), handover: z.object({ job: z.string(), toTrack: z.string(), basis: z.string() }).optional() }, async ({ board, id, patch, remove, why, handover }) => {
    if (handover) {
      if (id || patch || remove) return text("Use either handover or a job patch, not both.");
      const plan = handoverPlan(await store.board(board), handover.job, handover.toTrack);
      if (plan.basis !== handover.basis) return text("The board changed. Call staves_handover again before proposing this move.");
      if (plan.blocks.length) return text("Resolve before proposing: " + plan.blocks.join("; "));
      await store.append(board, plan.ops, who(), true);
      return text("Role change proposed. A person can review and accept it on the board.");
    }
    if (!id || (!remove && !patch)) return text("Provide a job id and patch or remove, or a handover.");
    const ops = remove ? [{ t: "removeJob" as const, id }] : [{ t: "updateJob" as const, id, patch: (patch ?? {}) as Partial<Job> }];
    await store.append(board, ops, who(), true);
    if (why) await store.append(board, [{ t: "comment", comment: { id: `c:${Date.now()}`, about: id, by: who(), text: `Proposal: ${why}`, at: new Date().toISOString() } }], who());
    return text("Proposed. A person decides on the board.");
  });

  tool("staves_design_history", "Read accessible design alternatives, pinned baselines, acceptance events, scoped assessments, saved cases and reported Git/PR links. Design acceptance is separate from code merge and deployment.", { board: z.string() }, async ({ board }) => text(JSON.stringify(await designHistory(store, board), null, 2)));

  tool("staves_git_context", "Read the local repository's sanitized origin, current branch/worktree, full HEAD commit, dirty state and optional base commit. No network, branch creation or code changes. This captures local Git; it does not check PR, merge or deployment status. Pass the actual project directory when the MCP process runs elsewhere.", {
    directory: z.string().optional(), baseRef: z.string().optional(),
  }, async ({ directory, baseRef }) => text(JSON.stringify(await captureGitContext(directory ?? process.cwd(), { baseRef }), null, 2)));
  tool("staves_development_link", "Attach a Git snapshot and optional PR reference to this design or a saved assessment/implementation request. Use staves_git_context or inspect Git locally first. PR state is a timestamped report, never independently verified by Staves. New records preserve previous references; no branch is created, design accepted or code deployed.", {
    board: z.string(), options: developmentOptionsSchema,
  }, async ({ board, options }) => text(JSON.stringify(await saveDevelopmentLink(store, board, options, who()), null, 2)));

  tool("staves_requests", "Read the request inbox for one accessible board. Queued means saved, not received. Inspect the pinned request and its intent before claiming; do not execute implementation for an assessment or discussion.", { board: z.string() }, async ({ board }) => { await requireBoard(board); return text(JSON.stringify(await listAssessmentRequests(store, board), null, 2)); });
  tool("staves_request_status", "Claim a saved request or report running, completed or failed. This records delivery state, not verified implementation or human approval. Return evidence with staves_assessment_return.", { board: z.string(), id: z.string(), status: z.enum(["claimed", "running", "completed", "failed"]), note: z.string().max(2000).optional() }, async ({ board, id, ...update }) => { await requireBoard(board); return text(JSON.stringify(await updateAssessmentDelivery(store, board, id, update, who()), null, 2)); });

  tool("staves_assess", "Capture a scoped design request for your coding agent. Defaults to assessment only. Use implement only after the person explicitly requests implementation; this tool never executes code. Returns the pinned packet and board link.", {
    board: z.string(), ...assessmentOptionsSchema.omit({ id: true, capturedBy: true, capturedAt: true }).shape,
  }, async ({ board, ...options }) => {
    const request = await saveAssessmentRequest(store, remember(board), options, who());
    return text(JSON.stringify({ request, boardUrl: boardLink(url, board), guidance: "Inspect the local repository, then return scoped findings with staves_assessment_return. If repository access is unavailable, say so. Assessment does not authorize implementation or deployment." }, null, 2));
  });
  tool("staves_assessment", "Read the original assessment request and its agent reports. Freshness is recalculated against current design; reports never certify execution.", { board: z.string(), id: z.string() }, async ({ board, id }) => text(JSON.stringify(await getAssessment(store, board, id), null, 2)));
  tool("staves_assessment_return", "Return repository findings or explicitly requested implementation results against an existing request. Include scoped source/test references and limitations. Stale results are retained for reconciliation; no design or implementation status changes automatically.", {
    board: z.string(), result: agentReturnSchema.innerType().omit({ reportedBy: true, reportedAt: true }),
  }, async ({ board, result }) => text(JSON.stringify(await saveAssessmentReturn(store, board, result.requestId, result, who()), null, 2)));
  tool("staves_walkthrough", "Check a concrete case against explicit model prerequisites and chosen exits. Deterministic model assessment, not execution or quantitative simulation. Unknown rules stop visibly. Returns captured inputs and an inspectable path. Set save to retain this case against its captured design.", {
    board: z.string(), case: assessmentOptionsSchema.shape.cases.unwrap().element,
    maxSteps: z.number().int().min(1).max(10000).optional(), save: z.boolean().default(false),
  }, async ({ board, case: example, maxSteps, save }) => text(JSON.stringify(save ? await saveWalkthrough(store, board, example, who(), maxSteps) : walkThrough(await store.board(board), example, { maxSteps }), null, 2)));
  tool("staves_walkthrough_runs", "Read saved case walkthroughs with their original inputs and current design freshness. These are model checks, not execution evidence.", { board: z.string(), id: z.string().optional() }, async ({ board, id }) => text(JSON.stringify(id ? await getWalkthrough(store, board, id) : await listWalkthroughs(store, board), null, 2)));

  tool("staves_scenario", "Create an alternative from an immutable snapshot of a board. Hosted connections require source access and an unused creation allowance. The source can change without changing this baseline. Use an alternative to explore a redesign without touching what is described.", { base: z.string(), name: z.string(), title: z.string() }, async ({ base, name, title }) => {
    await store.branch(base, name, title, undefined, who());
    return text(`Alternative "${name}" captured from "${base}". Its baseline stays fixed when the source changes. Describe changes with board="${name}". ${where(name)}`);
  });

  tool("staves_intent", "What a redesign of this board is for: the one dimension it must improve, and what it must not make worse. Every scenario is scored against it.", { board: z.string(), primary: z.enum(["cycle-time", "labor-hours", "error-rate", "cost", "throughput", "risk"]), target: z.string().optional().describe("e.g. 'halve the analyst's hours per lookup'"), constraints: z.array(z.string()).optional().describe("e.g. 'no answer goes out unread by a person'") }, async ({ board, primary, target, constraints }) => {
    await store.append(board, [{ t: "setIntent", intent: { primary, target, constraints } }], who());
    return text("Intent set. Scenarios are scored against it on the board.");
  });

  tool("staves_volume", "Say how many instances per week enter the board (and, per job, minutes per instance via staves_describe) so load per person can be shown.", { board: z.string(), perWeek: z.number() }, async ({ board, perWeek }) => {
    await store.append(board, [{ t: "setVolume", perWeek }], who());
    return text("Volume set.");
  });

  tool("staves_split", "Break a job into tasks, in order. Each task is named by what it achieves; give it its own track if a different performer does it. Tasks can then get their own inputs, outputs, tools and gates with staves_describe (parent = the job).", { board: z.string(), id: z.string(), tasks: z.array(z.object({ id: z.string().optional(), name: z.string(), track: z.string().optional() })) }, async ({ board, id, tasks }) => {
    const cur = await store.board(board);
    if (!cur.jobs.some((j) => j.id === id)) return text(`No job "${id}".`);
    const t = tasks.map((x) => ({ id: x.id ?? `${id}:${x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: x.name, track: x.track }));
    await store.append(board, [{ t: "split", id, tasks: t }], who());
    return text(`"${id}" now has ${t.length} tasks: ${t.map((x) => x.id).join(", ")}. Describe each with staves_describe (parent="${id}") so they carry their own account and tools.`);
  });

  tool("staves_collect", "Gather several jobs or tasks into one job, named by its outcome, on the track of the performer who takes it over. Use this after the cut, or when proposing that an agent take a run of a person's tasks. A run that contains a person's decision keeps the decision outside.", { board: z.string(), id: z.string().optional(), name: z.string(), track: z.string(), into: z.array(z.string()).min(2) }, async ({ board, id, name, track, into }) => {
    const cur = await store.board(board);
    const bad = into.filter((x) => !cur.jobs.some((j) => j.id === x));
    if (bad.length) return text(`Unknown: ${bad.join(", ")}.`);
    if (!cur.tracks.some((t) => t.id === track)) return text(`No track "${track}".`);
    const gated = into.map((x) => cur.jobs.find((j) => j.id === x)!).filter((j) => j.gate && j.gate.accountable !== "rule" && cur.tracks.find((t) => t.id === j.gate!.accountable)?.kind === "person");
    const tk = cur.tracks.find((t) => t.id === track)!;
    if (gated.length && tk.kind === "agent") return text(`Refused: ${gated.map((j) => `"${j.name}"`).join(", ")} is where a person decides. Collect the rest and leave the decision on the person's track.`);
    const jid = id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const confirmedInside = into.some((x) => cur.jobs.find((j) => j.id === x)?.status === "confirmed");
    await store.append(board, [{ t: "collect", id: jid, name, track, into }], who(), confirmedInside);
    return text(confirmedInside ? `Proposed: collect ${into.length} into "${name}" on ${tk.name}. A person confirmed some of these, so they decide.` : `"${name}" made on ${tk.name} with ${into.length} inside. Now describe it: outcome, beneficiary, done-when.`);
  });

  tool("staves_comments", "Comments from people that await your reply. Reply to each with staves_comment (replyTo = its id): say why it is or isn't a good idea, what is missing, what you would need to know. Propose a change with staves_propose when a comment calls for one.", { board: z.string() }, async ({ board }) => {
    const b = await store.board(board);
    const waiting = b.comments.filter((c) => c.by === "human" && !b.comments.some((r) => r.replyTo === c.id));
    if (!waiting.length) return text("No comments await a reply.");
    const name = (id: string) => (id === "board" ? "the board" : b.jobs.find((j) => j.id === id)?.name ?? b.tracks.find((t) => t.id === id)?.name ?? id);
    return text(waiting.map((c) => `- [${c.id}] on "${name(c.about)}": ${c.text}`).join("\n"));
  });

  tool("staves_stale", "Which jobs have code changes since they were described. Re-describe each with staves_describe (same id): if a person confirmed it, your re-description lands as a proposal for them.", { board: z.string() }, async ({ board }) => {
    await requireBoard(board);
    const b = await store.board(board);
    const st = stale(b, store.dir);
    const jobs = b.jobs.filter((j) => !j.removed && j.kind !== "ghost" && j.kind !== "outside");
    const blind = jobs.filter((j) => !j.sources?.length || !j.provenance.commit);
    const lines: string[] = [];
    if (st.length) lines.push("Changed since described:", ...st.map((x) => `- ${x.job} ("${b.jobs.find((j) => j.id === x.job)?.name}"): ${x.commits ? `${x.commits} commit(s) touched` : "uncommitted changes in"} ${x.files.join(", ")}`));
    else lines.push(`Nothing has changed under the ${jobs.length - blind.length} job(s) that carry sources.`);
    if (blind.length) lines.push("", `Cannot tell for ${blind.length} job(s) — they have no sources, or were described before sources existed: ${blind.map((j) => j.id).join(", ")}. Re-describe them with sources so the board can notice when the code moves under them.`);
    if (!blind.length && !st.length) lines.push("No newer commits were found in the recorded sources. This does not verify completeness or runtime behavior.");
    return text(lines.join("\n"));
  });

  /** The same "what next" engine the terminal uses, asked as the agent. Reading a few small files
   * is never worth failing a help request, so a state that cannot be collected is simply absent. */
  const collectRightNow = async (): Promise<string[]> => {
    try {
      const root = path.dirname(findStavesDir());
      const state = await collectState({
        store, root, registrations: await projectRegistrations(root), env: process.env,
        agents: async () => (await detectAgents()).map(found => found.agent), boardLimit: 6,
        // This server is the thing serving them, so where the boards open is known, not probed for.
        base: { url, live: true },
      }, { signal: AbortSignal.timeout(5000) });
      const next = formatRecommendations(recommend(state), "agent");
      // Cap the boards, not the block: slicing the whole list would drop the queued, failed and
      // waiting lines the moment a project has three boards, on the one surface an agent reads them.
      return [rightNowHeading(state), ...rightNow(state, { boards: 3 }), ...(next.length ? ["", ...next] : []), ""];
    } catch { return []; }
  };
  const rightNowForAgent: () => Promise<string[]> = options.recommendations === false ? async () => [] : memoize(30_000, collectRightNow);

  tool("staves_help", "How staves works and how to use its tools, for an agent.", {}, async () => text([
    ...await rightNowForAgent(),
    PROTOCOL, "",
    "Read the code first, then call staves_help, then follow its protocol. Read the whole workflow before writing, then write in batches: staves_start, the tracks, the artifacts, then staves_describe_many with every job at once.",
    "Interview without code: call staves_interview; record reported words with staves_interview_record; draw drafts through describe tools; save working/partial/ready with staves_interview_progress.",
    "Changes to what a person confirmed come back as proposals; a person decides them on the board.",
    "Tools:",
    ...catalogue(),
    "", `The person sees the board at ${url}. Tell them.`,
    `Guide: ${guideUrl(url)}`,
  ].join("\n")));

  tool("staves_list", "List the boards in this project: what each one is called, its id, and where it is drawn.", {}, async () => {
    const names = await store.list();
    // Hosted boards are named by uuid, so an id alone tells nobody — and an agent asked to pick one
    // has to open every brief to find out. Read the title with the id.
    const titled = await Promise.all(names.slice(0, 60).map(async (b) => {
      try { return { id: b, title: (await store.board(b)).title }; } catch { return { id: b }; }
    }));
    const lines = titled.map(({ id, title }) => `${title && title !== id ? `${title} — ` : ""}${id} — ${boardLink(url, id)}`);
    if (names.length > titled.length) lines.push(`…and ${names.length - titled.length} more.`);
    return text(lines.join("\n") || "(no boards yet — start one with staves_start)");
  });

  const catalogue = () => {
    const placed = new Set(CATALOGUE.flatMap(group => group.tools));
    const groups = CATALOGUE.map(group => ({ ...group, tools: group.tools.filter(name => registered.includes(name)) }));
    const rest = registered.filter(name => !placed.has(name));
    if (rest.length) groups.push({ heading: "Other", gloss: "registered here but not yet catalogued", tools: rest });
    return groups.filter(group => group.tools.length).map(group => `${group.heading} — ${group.gloss}:\n  ${group.tools.join(" · ")}`);
  };

  const closed = server.server.onclose;
  server.server.onclose = () => { stopWatching?.(); stopWatching = undefined; closed?.(); };
  watchRequests();
  return server;
}

/** The daemon asks this process (over long-poll) to run the interviewer on the connected client's model. */
function relaySampling(remote: RemoteStore, id: string, server: McpServer) {
  const loop = async () => {
    while (true) {
      try {
        const r = await fetch(`${remote.base}/sample/next?session=${encodeURIComponent(id)}`);
        if (r.status === 204) continue;
        if (!r.ok) { await new Promise((z) => setTimeout(z, 2000)); continue; }
        const job = await r.json() as { id: string; system: string; user: string };
        let text = "";
        try { const m = await server.server.createMessage({ systemPrompt: job.system, messages: [{ role: "user", content: { type: "text", text: job.user } }], maxTokens: REPLY_BUDGET }); text = m.content.type === "text" ? m.content.text : ""; } catch (e: any) { text = ""; }
        await fetch(`${remote.base}/sample/done`, { method: "POST", body: JSON.stringify({ id: job.id, text }) });
      } catch { await new Promise((z) => setTimeout(z, 2000)); }
    }
  };
  loop();
}
