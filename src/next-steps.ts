import { existsSync } from "node:fs";
import path from "node:path";
import { managedBlock } from "./agent-setup.js";
import { anyCredentials, readCredentials, type Session } from "./hosted.js";
import { listReview, sanitize } from "./review.js";
import { langfuseRegistrations, readForReport, stalePackage, type Registration } from "./registration.js";
import { boardUrl, guideUrl, workspaceUrl, LOCAL_BASE, type BaseLink } from "./links.js";
import type { RunnerAgent } from "./agent-runner.js";
import type { Store } from "./store.js";
import { VERSION } from "./version.js";

/** What Staves can see about this project right now: the files that decide whether the server
 * starts, the boards behind them, and the work waiting on either side of the handoff. One shape,
 * so the person in the terminal and the agent over MCP are never told two different things. */
export interface StavesState {
  mode: "local" | "hosted";
  root: string;
  registered: { claude: boolean; cursor: boolean; codex: boolean };
  skills: { claude: boolean; codex: boolean };
  instructionsCurrent: boolean;
  stalePackages: string[];
  /** A credential on disk and a credential the account still honours are different things, and
   * they need different advice. `accountConnected` is `account === "connected"`, derived once. */
  account: "connected" | "no-credential" | "unreachable";
  /** What the account said instead of opening, when `account` is "unreachable". */
  accountReason?: string;
  accountConnected: boolean;
  /** Whether this machine holds a Staves account credential at all, for any server — which this
   * project's own `account` cannot say, because an unregistered project points at nothing. It is
   * the difference between a first run and a second project on a machine already signed in. */
  machineCredential?: boolean;
  /** What a hosted connection may do, as the account answers it now: read or contribute, and how
   * many boards are left to create. Undefined for a local project, and whenever the account could
   * not be asked — a connection nobody could reach is not a connection that refused. */
  allowance?: { permission: "read" | "contribute"; remaining: number };
  agentsInstalled: RunnerAgent[];
  /** Where these boards open, and whether anything is serving them. Every screen built from a
   * state can then hand over a link, rather than describing a board nobody can reach. */
  base: BaseLink;
  boards: string[];
  queued: { board: string; id: string; intent: "assess" | "discuss" | "implement" }[];
  failed: { board: string; id: string; note?: string }[];
  pendingProposals: { board: string; count: number }[];
  /** Where the MCP server would find its Langfuse credentials. `board-connected` is the awkward
   * case: a board names a Langfuse project and nothing anywhere holds the keys to read it. */
  langfuse: "unset" | "shell-only" | "mcp-env" | "board-connected";
  /** Whether staves.io already shows this hosted connection's runs, as the account answers it now.
   * Asked only when the coding agent has keys to hand over; undefined whenever it was not, or could not be, asked. */
  hostedRuns?: boolean;
  /** Set when a source could not be read in time, or at all. What is above is what was readable;
   * it is never guessed at and never filled in from somewhere else. */
  partial?: boolean;
  /** Why, in one clause, so a screen can say so rather than quietly understate the work waiting. */
  partialReason?: string;
}

export interface Recommendation { audience: "human" | "agent" | "both"; priority: number; title: string; why: string; command?: string; tool?: string; url?: string }

/** A value, or the work of getting one. Opening an account or probing PATH can fail or hang, and
 * both belong inside the budget rather than in every caller's own try/catch. */
export type Source<T> = T | (() => T | Promise<T>);

export interface CollectStateInput {
  /** The boards this project's registration points at. A hosted project whose account cannot be
   * opened must fail here: substituting the local `.staves` would report someone else's boards. */
  store: Source<Store>;
  root: string;
  registrations: Registration[];
  env: NodeJS.ProcessEnv;
  agents: Source<RunnerAgent[]>;
  /** The instruction text a registration would write now. Without it currency cannot be judged, so
   * a managed block is taken at face value — an MCP server has no business regenerating the text. */
  instructions?: string;
  /** Boards opened to find queued requests and proposals. Every board is named either way. */
  boardLimit?: number;
  /** Where the boards open. A caller that already knows (the MCP server is serving them) says so;
   * otherwise src/links.ts resolveBase asks the daemon lock. Unreadable is not fatal: the base a
   * local project would use is still the truthful answer, with `live` false. */
  base?: Source<BaseLink>;
}

export interface CollectStateOptions {
  /** One wall-clock budget for the whole collection. `boardLimit` bounds how many reads happen;
   * only this bounds how long they take. */
  signal?: AbortSignal;
}

const LATE = "not read within the time budget";

/** Stores and the gateway take no AbortSignal of their own, so each call is raced against the
 * deadline instead: the in-flight request is abandoned, not cancelled, and the screen goes on. */
function race<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error(LATE));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** Nothing a store can do — a hung socket, an expired token, a directory that will not list — is
 * worth more than one line saying so. The first thing that goes wrong is the reason reported. */
function budget(signal?: AbortSignal) {
  let reason: string | undefined;
  return {
    get reason() { return reason; },
    async guard<T>(what: string, work: () => Promise<T>, fallback: T): Promise<T> {
      // A gateway writes part of these messages, and they end up on a terminal line.
      const note = (why: string) => { reason ??= sanitize(`${what} — ${why}`, REASON); };
      if (signal?.aborted) { note(LATE); return fallback; }
      try { return signal ? await race(work(), signal) : await work(); }
      catch (error) { note(error instanceof Error ? error.message : String(error)); return fallback; }
    },
  };
}

// A Source<T> is never itself a function in this codebase: T is a Store or an array of agent names.
const from = <T>(value: Source<T>): Promise<T> =>
  Promise.resolve(typeof value === "function" ? (value as () => T | Promise<T>)() : value);

/** Nothing said where the boards open and nothing could be asked: the link a local project would
 * use, admitted as not live, is still more use than no link at all. */
const OFFLINE: BaseLink = { url: LOCAL_BASE, live: false, hint: "start it with npx @staves/cli open" };

const CLIENT_FILE = { claude: ".mcp.json", cursor: ".cursor/mcp.json", codex: ".codex/config.toml" } as const;
const AGENT_CLIENT = { claude: "Claude Code", codex: "Codex" } as const;
const NAME = 120, REASON = 200;

/** What a person can ask their agent for once a board exists. The same list the connect screen
 * prints, so the two never drift into describing different products. */
export const ASK_FOR = [
  "run staves", "resume staves", "what has drifted", "what is wrong here", "brief me",
  "export a handoff", "review as each role",
];

export async function collectState(input: CollectStateInput, options: CollectStateOptions = {}): Promise<StavesState> {
  const { root, registrations, env } = input;
  const limit = input.boardLimit ?? 8;
  const spend = budget(options.signal);
  const entry = (client: keyof typeof CLIENT_FILE) => registrations.find(item => item.client === client);
  const hostedArgs = registrations.find(item => item.serverArgs?.includes("--hosted"))?.serverArgs;
  const connection = hostedArgs?.includes("--connection") ? hostedArgs[hostedArgs.indexOf("--connection") + 1] : undefined;

  const stalePackages: string[] = [];
  for (const item of registrations) {
    const spec = stalePackage(item.serverArgs);
    if (spec && !stalePackages.includes(spec)) stalePackages.push(spec);
  }

  let instructionsCurrent = true;
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const read = await readForReport(path.join(root, name));
    const block = "reason" in read ? null : managedBlock(read.text);
    if (block === null || (input.instructions !== undefined && block !== input.instructions.trim())) instructionsCurrent = false;
  }

  const agents = await spend.guard("the installed agents", () => from(input.agents), [] as RunnerAgent[]);
  const base = input.base === undefined ? OFFLINE
    : await spend.guard("where the boards open", () => from(input.base as Source<BaseLink>), OFFLINE);
  // An account that cannot be opened has no boards here. It is never answered with local ones, and
  // why it would not open is kept apart from the budget's first reason, which may be about anything.
  let accountReason: string | undefined;
  const source = await spend.guard("the account", async () => {
    try { return await from(input.store); }
    catch (error) { accountReason = error instanceof Error ? error.message : String(error); throw error; }
  }, undefined);
  if (!source) accountReason = sanitize(accountReason ?? `the account did not answer within the time budget`, REASON);
  const boards = source ? await spend.guard("the boards", () => source.list(), [] as string[]) : [];
  // The same exchange doctor performs, through the store that is already open: what this connection
  // may do belongs in the state, or advice about creating a board is advice it cannot act on.
  const scoped = source as (Store & { access?: () => Promise<Session> }) | undefined;
  const grant = hostedArgs && scoped?.access
    ? await spend.guard("the creation allowance", () => scoped.access!(), undefined)
    : undefined;
  const allowance: StavesState["allowance"] = grant
    ? { permission: grant.permission, remaining: grant.permission === "contribute" ? Math.max(0, grant.createLimit - grant.createdCount) : 0 }
    : undefined;
  const queued: StavesState["queued"] = [];
  const failed: StavesState["failed"] = [];
  const pendingProposals: StavesState["pendingProposals"] = [];
  for (const board of boards.slice(0, limit)) {
    if (!source) break;
    // A board that cannot be read is one board missing from a summary, never the end of the screen.
    const list = await spend.guard(`board "${board}"`, () => listReview(source, board), undefined);
    if (!list) continue;
    if (list.proposals.length) pendingProposals.push({ board, count: list.proposals.length });
    for (const request of list.requests) {
      if (request.status === "queued") queued.push({ board, id: request.id, intent: request.intent });
      else if (request.status === "failed") failed.push({ board, id: request.id, note: request.note });
    }
  }

  // Any of the three project registrations can carry the keys: whichever client the person uses is
  // the one launching the server, so keys in .codex/config.toml count exactly as much as in .mcp.json.
  let langfuse: StavesState["langfuse"] = langfuseRegistrations(registrations).length ? "mcp-env"
    : env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY ? "shell-only" : "unset";
  // Only worth the reads when nothing holds the keys, and only the first few: one instrumented
  // board is enough to say the keys are missing, and this runs on every help request.
  if (langfuse === "unset" && source) {
    for (const board of boards.slice(0, Math.min(limit, 3))) {
      const read = await spend.guard(`board "${board}"`, () => source.board(board), undefined);
      if (read?.context?.langfuse) { langfuse = "board-connected"; break; }
    }
  }

  // Whether staves.io shows this connection's runs is worth asking only when there are keys to hand
  // over. A service that cannot hold keys, or does not answer, is no answer — not a gap in the state.
  const runsSource = source as (Store & { runsProject?: () => Promise<string | null> }) | undefined;
  let hostedRuns: boolean | undefined;
  if (hostedArgs && runsSource?.runsProject && (langfuse === "mcp-env" || langfuse === "shell-only") && !options.signal?.aborted) {
    try {
      const asked = runsSource.runsProject();
      hostedRuns = (await (options.signal ? race(asked, options.signal) : asked)) !== null;
    } catch { hostedRuns = undefined; }
  }

  const reason = spend.reason;
  const account =!await readCredentials(connection) ? "no-credential" : source ? "connected" : "unreachable";
  // A credential for this project's own connection is already one; only the empty case has to look
  // any wider, and it is the only case where the answer changes what a person is told to run.
  const machineCredential = account !== "no-credential" || await anyCredentials();
  return {
    mode: hostedArgs ? "hosted" : "local", root, machineCredential,
    registered: { claude: !!entry("claude")?.serverArgs, cursor: !!entry("cursor")?.serverArgs, codex: !!entry("codex")?.serverArgs },
    skills: { claude: existsSync(path.join(root, ".claude", "skills", "staves", "SKILL.md")), codex: existsSync(path.join(root, ".agents", "skills", "staves", "SKILL.md")) },
    instructionsCurrent, stalePackages, account, accountConnected: account === "connected", base,
    ...(account === "unreachable" ? { accountReason } : {}),
    ...(allowance ? { allowance } : {}),
    agentsInstalled: agents, boards, queued, failed, pendingProposals, langfuse,
    ...(hostedRuns === undefined ? {} : { hostedRuns }),
    ...(reason ? { partial: true, partialReason: reason } : {}),
  };
}

const count = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** The board a rule is about, as somewhere a person can open. A rule that names no board has none. */
const at = (state: StavesState, board: string) => boardUrl(state.base.url, board);

/** The board id the approval page would give this project: its directory name, as board ids are
 * written. A scope already holding it has the board this project needs, whatever the allowance. */
const projectBoard = (root: string) => path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The next move, from the state alone: no clock, no network, no opinion about who is asking.
 * The rules are in the order they are meant to be read, and the list is sorted by that order. */
export function recommend(state: StavesState): Recommendation[] {
  const out: Recommendation[] = [];
  const registered = state.registered.claude || state.registered.cursor || state.registered.codex;

  if (!registered) {
    // Both roads lead to a registered project, and which one to take is not a matter of taste: a
    // machine already signed in has an account to connect this project to, and init would set up a
    // second, local one beside it. Lead with the command that uses what is already there.
    out.push(state.machineCredential
      ? { audience: "human", priority: 1, title: "Connect this project to your Staves account",
          why: "Nothing here names a staves MCP server, so no coding agent can see its tools. This machine already has a Staves account connection, so connect this project to it. To keep this project's boards on this machine instead, run npx @staves/cli init.",
          command: "npx @staves/cli connect" }
      : { audience: "human", priority: 1, title: "Register Staves in this project",
          why: "Nothing here names a staves MCP server, so no coding agent can see its tools. For a Staves account, run npx @staves/cli connect instead.",
          command: "npx @staves/cli init" });
  }

  // Nothing registered at all is rule 1; setup refuses to run before init, and rule 1 already covers
  // it, so rules 2 and 3 both wait for a project-level registration to exist.
  if (registered && (state.stalePackages.length || !state.instructionsCurrent)) {
    const why = [
      state.stalePackages.length ? `Registered as ${state.stalePackages.join(", ")}; this CLI is ${VERSION}.` : "",
      state.instructionsCurrent ? "" : "The managed block in CLAUDE.md or AGENTS.md is missing or from an older version.",
    ].filter(Boolean).join(" ");
    out.push({ audience: "human", priority: 2, title: "Refresh this project's registration", why, command: "npx @staves/cli setup" });
  }

  if (registered) {
    for (const agent of ["claude", "codex"] as const) {
      if (!state.agentsInstalled.includes(agent) || state.registered[agent]) continue;
      out.push({ audience: "human", priority: 3, title: `Register Staves for ${AGENT_CLIENT[agent]}`,
        why: `${AGENT_CLIENT[agent]} is installed on this machine, but ${CLIENT_FILE[agent]} has no staves entry.`,
        command: "npx @staves/cli setup" });
    }
  }

  if (state.mode === "hosted" && state.account !== "connected") {
    // A missing credential and a credential the account refused are one command but two problems.
    const refused = sanitize(state.accountReason ?? "the account did not answer", REASON).replace(/\.$/, "");
    out.push({ audience: "human", priority: 4, title: "Connect this machine to your Staves account",
      why: state.account === "no-credential"
        ? "This project is registered for a hosted connection, but no credential for it is stored on this machine."
        : `The stored credential did not open the account: ${refused}. Run npx @staves/cli connect to replace it, or check the service URL.`,
      command: "npx @staves/cli connect" });
  }

  // Rule 4's other half, one step further on: the account opens, and the connection still cannot
  // make the board this project needs. The two never fire together — that one wants an account
  // that will not open, this one an account that does — so they share the number rather than
  // renumbering every rule below it. Left out entirely when the allowance could not be read.
  if (state.mode === "hosted" && state.accountConnected && state.allowance
      && (state.allowance.permission === "read" || state.allowance.remaining === 0)
      && !state.boards.includes(projectBoard(state.root))) {
    const why = "The connection can read but cannot create a board for this project. The approval page can create one, or raise the allowance under Account → Coding agents.";
    out.push({ audience: "human", priority: 4, title: "Give this connection a board", why, command: "npx @staves/cli connect", url: `${workspaceUrl(state.base.url)}#account` });
    out.push({ audience: "agent", priority: 4, title: "Ask the person for a board", why, tool: "staves_access" });
  }

  if (!state.boards.length) {
    out.push({ audience: "human", priority: 5, title: "Ask your agent: run staves",
      why: "No boards yet. Your coding agent reads the repository and draws one workflow as a board." });
    out.push({ audience: "agent", priority: 5, title: "Read the repository, then staves_start",
      why: "No boards yet. Scope one workflow with the person, then draw it: staves_start, the tracks, the artifacts, then staves_describe_many.",
      tool: "staves_start" });
  }

  const assess = state.queued.filter(request => request.intent === "assess");
  if (assess.length) {
    const board = assess[0].board;
    out.push({ audience: "human", priority: 6, title: `Deliver ${count(assess.length, "queued assessment")}`,
      why: `Queued does not mean running. ${board} is waiting for a local agent to claim ${assess.length === 1 ? "it" : "them"}.`,
      command: `npx @staves/cli listen --agent ${state.agentsInstalled[0] ?? "claude"} --board ${board} --once`, url: at(state, board) });
    out.push({ audience: "agent", priority: 6, title: "Claim the queued assessment",
      why: `${count(assess.length, "assessment")} queued on ${board}. staves_requests claims one; staves_request_status says how far it got.`,
      tool: "staves_requests" });
  }

  const discuss = state.queued.filter(request => request.intent === "discuss");
  if (discuss.length) {
    out.push({ audience: "human", priority: 7, title: "Open the project in your coding agent and say: resume staves",
      why: `${count(discuss.length, "conversation request")} on ${discuss[0].board}. A conversation needs your interactive agent; the listener leaves it queued.`,
      url: at(state, discuss[0].board) });
    out.push({ audience: "agent", priority: 7, title: "Pick up the conversation request",
      why: `Request ${discuss[0].id} on ${discuss[0].board} is a conversation. Claim it with staves_requests, then read the saved conversation with staves_brief.`,
      tool: "staves_requests" });
  }

  if (state.failed.length) {
    const first = state.failed[0];
    const more = state.failed.length > 1 ? ` ${state.failed.length - 1} other request(s) also failed.` : "";
    // The note is whatever an agent wrote. Bounded here, so the invariant does not rest on a caller.
    out.push({ audience: "human", priority: 8, title: `Fix what failed: request ${sanitize(first.id, NAME)}`,
      why: `${sanitize(first.board, NAME)} says: ${first.note ? sanitize(first.note, NAME) : "no note was recorded"}. Read the note, fix the cause, then queue the request again from the board.${more}`,
      url: at(state, first.board) });
  }

  if (state.pendingProposals.length) {
    const first = state.pendingProposals[0];
    out.push({ audience: "human", priority: 9, title: `${count(first.count, "proposal")} waiting for you on ${first.board}`,
      why: state.mode === "hosted"
        ? "An agent's change is not on the board until a person accepts it. Review it on the board in Staves."
        : "An agent's change is not on the board until a person accepts it.",
      command: state.mode === "hosted" ? undefined : `npx @staves/cli review ${first.board}`, url: at(state, first.board) });
  }

  // The keys are already on this machine and the account is connected: one command shows the runs
  // on staves.io, without anyone copying a key into a browser.
  if (state.mode === "hosted" && state.accountConnected && (state.langfuse === "mcp-env" || state.langfuse === "shell-only") && state.hostedRuns === false) {
    out.push({ audience: "human", priority: 10, title: "Show this project's runs on staves.io",
      why: "Your coding agent has Langfuse keys for this project, but staves.io is not showing its runs yet. Connect again to hand them over; they are checked with Langfuse and stored encrypted.",
      command: "npx @staves/cli connect --share-runs" });
  }

  if (state.langfuse === "shell-only") {
    out.push({ audience: "human", priority: 10, title: "Give the MCP server the Langfuse keys",
      why: "LANGFUSE_* is set in this shell, but the MCP server sees its launcher's environment. Put LANGFUSE_* in the env block of the staves entry in .mcp.json; staves setup preserves it." });
  } else if (state.langfuse === "board-connected") {
    out.push({ audience: "human", priority: 10, title: "Set LANGFUSE_* for the MCP server",
      why: "A board names a Langfuse project, but no LANGFUSE_* keys are set for the staves MCP server. Put them in the env block of the staves entry in .mcp.json." });
  }

  if (!out.length) {
    out.push({ audience: "both", priority: 11, title: "Ask for a read",
      why: `Nothing is waiting. Ask for: ${ASK_FOR.join(" · ")}.` });
  }
  return out;
}

/** The one line that admits a screen is only part of the answer. Every terminal screen built from
 * a state prints it, so doctor and the home screen cannot say different things about the same gap. */
export function incompleteLine(state: StavesState): string[] {
  return state.partial ? [`· Account state incomplete: ${state.partialReason ?? "a source could not be read"}`] : [];
}

/** The heading above `rightNow`, which says so when what follows is only part of the answer. */
export function rightNowHeading(state: StavesState): string {
  return state.partial ? `Right now (partial): ${state.partialReason ?? "a source could not be read"}` : "Right now";
}

/** How many boards are worth naming on one screen. Only the board lines are ever capped: what is
 * queued, what failed and what waits for a person are the reason to read this block at all. */
export interface RightNowOptions { boards?: number }

/** What is waiting, in as few lines as it takes. Empty categories are not lines. Each board is its
 * own line so it can carry the link that opens it: a name alone is not somewhere a person can go. */
export function rightNow(state: StavesState, options: RightNowOptions = {}): string[] {
  const safe = (value: string) => sanitize(value, NAME);
  const named = state.boards.slice(0, options.boards ?? 6);
  const rest = state.boards.length - named.length;
  const lines = named.length
    ? [...named.map(board => `· ${safe(board)}  ${boardUrl(state.base.url, board)}`), ...(rest > 0 ? [`· …and ${rest} more`] : [])]
    : ["· No boards yet. Your coding agent draws the first one."];
  // A link nobody is answering is not a dead end if the command that revives it is on the line.
  if (!state.base.live) lines.push(`· Boards open at ${state.base.url} once the local server runs (npx @staves/cli open)`);
  if (state.queued.length) {
    const kinds = (["assess", "discuss", "implement"] as const)
      .map(intent => ({ intent, n: state.queued.filter(request => request.intent === intent).length }))
      .filter(kind => kind.n).map(kind => `${kind.n} ${kind.intent}`);
    lines.push(`· ${count(state.queued.length, "queued request")}: ${kinds.join(", ")} — queued does not mean running`);
  }
  if (state.failed.length) {
    const first = state.failed[0];
    lines.push(`· ${count(state.failed.length, "failed request")}: ${safe(first.id)} on ${safe(first.board)} — ${safe(first.note ?? "no note recorded")}`);
  }
  if (state.pendingProposals.length) {
    const first = state.pendingProposals[0], more = state.pendingProposals.length - 1;
    lines.push(`· ${count(first.count, "proposal")} waiting on ${safe(first.board)}${more > 0 ? `, and ${more} other board(s)` : ""}`);
  }
  return lines;
}

/** The same recommendations, addressed to whoever is reading. An agent gets tool names because
 * that is what it can act on; a person gets the command, because that is what they can run. */
export function formatRecommendations(all: Recommendation[], audience: "human" | "agent", limit = 3): string[] {
  const picked = all.filter(item => item.audience === audience || item.audience === "both").slice(0, limit);
  if (!picked.length) return [];
  const lines = ["Recommended next"];
  picked.forEach((item, index) => {
    lines.push(`  ${index + 1}. ${item.title}`, `     ${item.why}`);
    const action = audience === "agent" ? item.tool ?? item.command : item.command;
    if (action) lines.push(`     ${action}`);
    // The board this is about, under the thing to run: the command acts, the link shows.
    if (item.url) lines.push(`     ${item.url}`);
  });
  return lines;
}

/** The whole terminal home screen: where you are, what is set up, what is waiting, what to do. */
export function homeScreen(state: StavesState, setup: string[]): string {
  const next = formatRecommendations(recommend(state), "human");
  return [
    `staves ${VERSION} · ${state.root} · ${state.mode}`,
    "", "Set up", ...setup,
    "", "Right now", ...rightNow(state), ...incompleteLine(state),
    ...(next.length ? ["", ...next] : []),
    "", "More: npx @staves/cli help",
    `Guide: ${guideUrl(state.base.url)}`,
  ].join("\n");
}
