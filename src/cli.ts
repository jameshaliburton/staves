#!/usr/bin/env node
import { HUMAN_READABLE_FLOW } from "./protocol.js";
import { connectThroughBrowser } from "./device-connect.js";
import { detectAgents, runAgentListener } from "./agent-runner.js";
import { decideProposal, formatReview, listReview, resolveBoard, resolveListen } from "./review.js";
import { AGENT_BOOTSTRAP } from "./agent-bootstrap.js";
import { installSkill, managedBlock, managedInstructions, registerCodex, readOptional } from "./agent-setup.js";
import { agentLangfuseKeys, entryArgs, shareRunsQuestion, langfuseRegistrations, packageToken, projectRegistrations, readForReport, reportRegistration, stavesEntry, table, userRegistrations, type Registration } from "./registration.js";
import { collectState, formatRecommendations, homeScreen, incompleteLine, recommend } from "./next-steps.js";
import { captureGitContext } from "./git-context.js";
import { saveDevelopmentLink } from "./development-store.js";
import { promises as fs, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import path from "node:path";
import { Store, findStavesDir } from "./store.js";
import { renderSVG } from "./render.js";
import { serveHttp } from "./server.js";
import { brief } from "./brief.js";
import { lint } from "./derive.js";
import { serveMcp, buildServer, AGENT_INTERVIEW } from "./mcp.js";
import { stale } from "./stale.js";
import { exportBoard, exportFromStore, exportOptionsSchema, formatExport, isBoardFormat, type ExportFormat } from "./export.js";
import { VERSION } from "./version.js";
import { pairHandoff, exchange, findConnection, forgetCredentials, hostedStore, readCredentials, runsProject, shareRuns, writeCredentials, credentialsPath, HostedAuthError } from "./hosted.js";
import { boardUrl, guideUrl, resolveBase, workspaceUrl, LOCAL_BASE, type BaseLink } from "./links.js";
import { projectConnection, recordProjectConnection } from "./project-config.js";

const argv = process.argv.slice(2);
const dirFlag = argv.indexOf("--dir");
const explicitDir = dirFlag >= 0 ? argv.splice(dirFlag, 2)[1] : undefined;
const [cmd, ...args] = argv;
const dir = explicitDir ? path.resolve(explicitDir) : findStavesDir();
const store = new Store(dir);
/** A hosted command's connection: the one named, or the one this project was connected with. */
const connectionFor = async (args: string[]) => option(args, "connection") ?? await projectConnection(dir);

/** A skill is instructions; MCP is capability. The server carries the tools, this carries the
 * judgement about when and how to use them — the half an agent otherwise has to infer, and the
 * half people were asking for when they said they wanted a skill rather than a server. */
const SKILL_MD = `---
name: staves
description: Use when describing how work happens in this project — who does what, what passes between them, where it stalls — or when asked to run, resume, review or hand off a Staves board. Also use before changing code that a board already describes.
---

# Staves

${AGENT_BOOTSTRAP}

Staves draws the work of this project as a board: people, agents, systems and outside parties on
tracks, with jobs between the handoffs. You already have its tools; they start with \`staves_\`.

## Interview here and draw as we talk

When asked to talk through work or a new idea, call \`staves_interview\`. You are the interviewer;
no second model, provider key or repository is required. Record reported words separately from
inference with \`staves_interview_record\`, then save draft tracks, artifacts and jobs in coherent batches at useful conversational pauses.
Share the exact board URL early and at pauses/completion. Mark planned behavior as planned and
preserve confirmed work through proposals. Save working, partial or ready for human review with
\`staves_interview_progress\`. If MCP needs reloading, use the same tools immediately via
\`npx @staves/cli tool staves_interview --hosted --connection <id> --input '{}'\`.

## Resume the explicit design conversation

When a browser handoff supplies a board, scope, working intention and draft, read the saved board
and comments for that scope first. Keep the workflow goal, working intention, questions, accepted
design and implementation reports distinct. Ask before changing the person's working intention;
propose agent-authored changes for human review. A handoff to continue talking does not authorize
implementation. Return the exact board link; phones show a read-only companion, while modelling
and design review happen on desktop or here in the coding agent.

## Keep development in the project's Git workflow

For an assessment or implementation request, fetch its original packet with \`staves_assessment\`.
Inspect the actual project checkout with \`staves_git_context\` and attach the sanitized repository,
branch/worktree, full HEAD and base commit, and dirty state with \`staves_development_link\` using
that request ID. Use the repository's existing branch, worktree and PR conventions. Exploring a
design does not require a code branch; assessment does not authorize implementation.
After explicit implementation, return scoped file/commit/PR and test references with
\`staves_assessment_return\`. Record PR state only after checking it, with the check time and
merge commit when merged. Staves retains this as a report, not independent provider verification.
Use a new development link to capture a changed checkout. Never overwrite earlier references or
claim uncommitted work is represented by HEAD. \`staves_design_history\` shows the relationship
between designs, assessments, cases and development reports. Human design acceptance, Git merge
and deployment remain separate decisions.

## Connect design to Langfuse execution evidence

For an instrumented system, connect its Langfuse project with \`staves_langfuse_connect\`
using only its public base URL and project id. Several workflows may share that project.
Use existing LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL environment
configuration in the agent process; never put credentials in tool arguments or on the board.
Call \`staves_langfuse_instrumentation\` for each job being implemented. Attach its
\`staves.board_id\`, \`staves.job_id\` and \`staves.design_revision\` metadata directly
to the corresponding Langfuse observations using the project's existing SDK. Preserve the
revision that the implementation represents until its design changes.
Use \`staves_langfuse_evidence\` to attach an explicitly mapped trace/observation reference
and bounded execution summary. Inspect detailed traces in Langfuse. Never import raw prompts,
inputs or outputs. One job may span several traces; internal spans are not automatically jobs.
Missing telemetry means not observed. Technical success proves neither the intended outcome
nor human approval; evidence never marks a description confirmed or implementation complete.
Start new ideas through the interview as usual, then add instrumentation during implementation.

## Say what it can do, before being asked

On first use in a session, tell the person what is available rather than making them discover it.
\`staves_list\` names the boards. Then: describe a workflow from the code and draw it; \`staves_brief\`
for one prose read of who does what and what is unanswered; \`staves_stale\` for jobs whose code moved
since they were described; \`staves_issues\` and \`staves_review\` for findings; \`staves_scenario\` to
create a pinned alternative and redesign a flow (hosted creation uses the connection allowance); \`staves_export\` for markdown, JSON, SVG, PDF or a
scoped prompt built as a handoff to another agent; \`staves_hats\` to review as each role in turn;
\`staves_volume\` for instances per week; \`staves_comments\` to pick up what the person left on the board.

Give them a link, not just a list: the guides are at https://staves.io/docs/ and
https://staves.io/docs/reference/tools/ is every tool with what it takes and what it gives back.

## Scope before describing

A repository usually holds several workflows. If they named one, describe only that, on its own
board. If they did not, find where a request from outside arrives — HTTP routes, queue consumers,
CLI commands, schedules, webhooks — and ask which one they mean. Never one board for a whole
platform; one board per workflow, named by its outcome.

## Describe work, not code

Write each job so a stranger could do it by hand and get the same result and the same failures. Name
it in the language of the work, not the system: "Reach out to approved vendors", not "POST /vendors".
For every tool a job uses, say what comes back and what does not. Cite the files you read. Mark
unfinished implementation as planned or in progress rather than describing intent as if it were
behaviour. Where the code cannot tell you something, use \`staves_ask\` instead of guessing — an open
question on the board is worth more than a confident invention.

${HUMAN_READABLE_FLOW}

## Reading before writing

Before changing code in a project that has a board, read \`staves_brief\`. After changing code under a
described job, re-describe that job. When the person asks what changed, \`staves_stale\` lists what
moved underneath.

## What not to do

Do not present a board as a live trace of production; it is a description. Do not silently redraw
work someone confirmed — propose it. Do not answer a question on the board with a guess.

## Where to send them to read more

Hand over the link rather than paraphrasing a guide. Each of these answers one question:

| When they ask | Send them to |
| --- | --- |
| What is this for? | https://staves.io/docs/start/ |
| How do I start one? | https://staves.io/docs/first-board/ |
| What am I looking at? | https://staves.io/docs/reference/reading-a-board/ |
| What can you actually do? | https://staves.io/docs/reference/tools/ |
| Get more out of this skill | https://staves.io/docs/how-to/working-with-the-skill/ |
| Describe this repository | https://staves.io/docs/how-to/describe-a-repo/ |
| Pick it back up later | https://staves.io/docs/how-to/resume/ |
| Review what we drew | https://staves.io/docs/how-to/review/ |
| Try a change safely | https://staves.io/docs/how-to/scenarios/ |
| Hand it to someone else | https://staves.io/docs/how-to/handoff/ |
| It is not working | https://staves.io/docs/troubleshooting/ |
`;

/** Every unmarked block this CLI has ever written, newest first. A project that has not been set
 * up since before the markers existed still has one of these, and setup must recognise it rather
 * than appending a second block beside it. */
const LEGACY_BLOCKS = [`
## staves

This project keeps boards of its work in \`.staves/\`. A board shows jobs on tracks (people, agents, systems, outside parties) with the handoffs between them.
Say "run staves" and the agent describes the project as work and draws it; "resume staves" picks the board back up and re-describes what the code changed under. Slash commands: /mcp__staves__describe, /mcp__staves__resume, /mcp__staves__review.
Before working on a system that has a board, read staves_brief first. Where you cannot tell something from the code, use staves_ask rather than guessing.
The guides are at https://staves.io/docs/ — start there, or https://staves.io/docs/reference/tools/ for every tool and when to reach for it.
`, `
## staves

This project keeps boards of its work in \`.staves/\`. A board shows jobs on tracks (people, agents, systems, outside parties) with the handoffs between them.
Say "run staves" and the agent describes the project as work and draws it; "resume staves" picks the board back up and re-describes what the code changed under. Slash commands: /mcp__staves__describe, /mcp__staves__resume, /mcp__staves__review.
Before working on a system that has a board, read staves_brief first. Where you cannot tell something from the code, use staves_ask rather than guessing.
`];


/** The exact skill and instruction text a registration writes. Doctor compares what is on disk
 * against this, so the two can never drift apart. */
async function generatedText(serverArgs: string[]): Promise<{ skill: string; instructions: string }> {
  const hosted = serverArgs.includes("--hosted");
  const connection = hosted ? serverArgs[serverArgs.indexOf("--connection") + 1] : undefined;
  const boardDir = serverArgs.includes("--dir") ? serverArgs[serverArgs.indexOf("--dir") + 1] : dir;
  // The connection reference stays in .staves/config.json on this machine, never in these files: they are
  // meant to be committed, and the CLI finds the connection from the project directory.
  const fallback = `npx -y @staves/cli@${VERSION} tool staves_interview ${hosted ? "--hosted" : `--dir ${JSON.stringify(boardDir)}`} --input '{}'`;
  const location = hosted
    ? `Boards are saved to the connected Staves account. This project keeps only a connection reference, in .staves/config.json on this machine; it does not store board data in .staves/.`
    : `Boards are saved locally in ${boardDir}. No Staves account or Langfuse integration is required.`;
  // An agent that reads only this block must still be able to hand a person somewhere to look.
  // The account's own address when there is one; otherwise the page the local server draws.
  const account = hosted ? (await readCredentials(connection))?.url ?? "https://staves.io" : undefined;
  const where = account ? `Boards: ${workspaceUrl(account)}` : `Boards: ${LOCAL_BASE} — npx @staves/cli open starts the local server`;
  const links = `${where}\nGuide: ${guideUrl(account)}`;
  const skill = SKILL_MD.replace("npx @staves/cli tool staves_interview --hosted --connection <id> --input '{}'", fallback)
    + `\n## This project\n\n${location}\n\n${links}\n\nImmediate tool access: \`${fallback}\`. Replace staves_interview with any Staves tool and supply its JSON input.\n`;
  const instructions = `## Staves\n\n${location}\n\n${links}\n\n${AGENT_BOOTSTRAP}\n\nUse immediately: \`${fallback}\`. Every MCP tool is available through this CLI with the same JSON arguments.\nDetailed modelling guidance: .claude/skills/staves/SKILL.md (Claude Code) or .agents/skills/staves/SKILL.md (Codex and others). Read it before your first Staves write.\n`;
  return { skill, instructions };
}

/** Project-scoped registration; clients retain their own trust and approval controls. */
async function registerAgents(root: string, serverArgs: string[]) {
  const { skill, instructions } = await generatedText(serverArgs);
  if (serverArgs.includes("--hosted") && serverArgs.includes("--connection")) await recordProjectConnection(dir, serverArgs[serverArgs.indexOf("--connection") + 1]);
  for (const relative of [".mcp.json", ".cursor/mcp.json", ".gemini/settings.json"]) {
    const file = path.join(root, relative);
    const existing = await readOptional(file);
    const config: Record<string, unknown> = existing ? JSON.parse(existing) : {};
    const servers = { ...(config.mcpServers as Record<string, unknown> ?? {}) };
    // The env block holds the credentials the server is launched with; everything else is ours to replace.
    const env = table(servers.staves)?.env;
    servers.staves = { ...(env && typeof env === "object" ? { env } : {}), command: "npx", args: serverArgs };
    config.mcpServers = servers;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n");
  }
  await registerCodex(root, serverArgs);
  for (const base of [".claude", ".agents"]) {
    const skillDir = path.join(root, base, "skills", "staves");
    await fs.mkdir(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    if (!await installSkill(skillPath, skill)) console.error(`staves: preserved custom ${skillPath}; current guidance is in ${skillPath}.generated.md and project instructions.`);
  }
  for (const name of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
    const file = path.join(root, name);
    await fs.writeFile(file, managedInstructions(await readOptional(file), instructions, LEGACY_BLOCKS));
  }
  return { desktop: JSON.stringify({ mcpServers: { staves: { command: "npx", args: serverArgs } } }, null, 2) };
}

/** The instruction text this version would write, which is what doctor and the home screen
 * compare the managed block against. Without a registration, what init would have written. */
const generatedInstructions = async (projectArgs?: string[]) =>
  (await generatedText(projectArgs ?? ["-y", `@staves/cli@${VERSION}`, "mcp", "--dir", dir])).instructions;

/** The boards this project's registration actually points at. A hosted registration whose account
 * cannot be opened throws: answering it with the local .staves would present this machine's own
 * boards as the account's, and hide the expired token that is the real thing to fix. */
async function registeredStore(registrations: Registration[]): Promise<Store> {
  const hostedArgs = registrations.find(item => item.serverArgs?.includes("--hosted"))?.serverArgs;
  if (!hostedArgs) return store;
  const connection = hostedArgs.includes("--connection") ? hostedArgs[hostedArgs.indexOf("--connection") + 1] : undefined;
  const credentials = await readCredentials(connection);
  if (!credentials) throw new Error("this machine is not connected. Run: npx @staves/cli connect");
  return hostedStore(credentials);
}

/** Where this project's boards open: the account it is registered against, or the local daemon —
 * and whether anything is answering there, which is the difference between a link and a wish. */
async function projectBase(registrations: Registration[]): Promise<BaseLink> {
  const hostedArgs = registrations.find(item => item.serverArgs?.includes("--hosted"))?.serverArgs;
  if (!hostedArgs) return resolveBase({ dir });
  const connection = hostedArgs.includes("--connection") ? hostedArgs[hostedArgs.indexOf("--connection") + 1] : undefined;
  return resolveBase({ dir, credentials: await readCredentials(connection) });
}

/** A remaining allowance of zero is where a person gets stuck: the number says no and nothing says
 * what to do about it. The approval page can make this project a board, and the account page raises
 * the allowance — so the zero is always followed by the way past it. */
function allowanceHint(permission: "read" | "contribute", remaining: number, base: string): string[] {
  if (permission !== "contribute" || remaining !== 0) return [];
  return [`  · to create boards from this project: rerun npx @staves/cli connect and tick "Create a new board for this project", or raise the allowance at ${workspaceUrl(base)}#account`];
}

/** The one "what next" engine, asked the way the terminal asks it: eight seconds for the lot, and
 * every source read lazily so a hung account costs one line rather than the screen. */
async function terminalState(root: string, registrations: Registration[]) {
  return collectState({
    store: () => registeredStore(registrations), root, registrations, env: process.env,
    agents: async () => (await detectAgents()).map(found => found.agent),
    instructions: await generatedInstructions(registrations.find(item => item.serverArgs)?.serverArgs),
    base: () => projectBase(registrations),
  }, { signal: AbortSignal.timeout(8000) });
}

/** No arguments, in a terminal: where you are, what is set up, what is waiting, what to do next. */
async function home(root: string): Promise<void> {
  const registrations = await projectRegistrations(root);
  const setup: string[] = [];
  for (const item of registrations) await reportRegistration(item, "project", line => setup.push(line));
  console.log(homeScreen(await terminalState(root, registrations), setup));
}

/** One screen naming every file that decides whether the server starts, and what is wrong in it. */
async function doctor(root: string, args: string[]): Promise<void> {
  const say = (line: string) => { console.log(line); if (line.includes("✗")) process.exitCode = 1; };
  // Stale but working — an old pin, an older managed block, a skill whose update nobody has read.
  // Nothing here stops the server starting, so only a CI gate that asked for it calls it a failure.
  const strict = args.includes("--strict");
  const note = (line: string) => { console.log(line); if (strict) process.exitCode = 1; };
  const project = await projectRegistrations(root);
  const projectArgs = project.find(item => item.serverArgs)?.serverArgs;
  const hostedArgs = project.find(item => item.serverArgs?.includes("--hosted"))?.serverArgs;
  const registered = hostedArgs?.includes("--connection") ? hostedArgs[hostedArgs.indexOf("--connection") + 1] : undefined;
  const recorded = await projectConnection(dir);
  const connection = option(args, "connection") ?? registered ?? recorded;
  const hosted = args.includes("--hosted") || !!hostedArgs || !!connection;
  console.log(`staves ${VERSION} · ${root} · ${hosted ? "hosted" : "local"}\n`);
  console.log("Project registrations");
  for (const item of project) await reportRegistration(item, "project", say, note);
  console.log("· Client activation is not verified. Claude Code: approve in /mcp. Cursor: reload MCP in Settings. Codex: trust the project and restart the connection/session; check /mcp. Gemini CLI: run /mcp reload to reload the project settings.");

  console.log("\nUser-level registrations (outside this project)");
  for (const item of await userRegistrations(root)) await reportRegistration(item, "user", say, note);

  if (hostedArgs) {
    if (!recorded) say(`✗ .staves/config.json has no connection reference, so the managed block's command cannot find the account — run staves setup`);
    else if (registered && recorded !== registered) say(`✗ .staves/config.json names connection ${recorded}, but the registration uses ${registered} — run staves setup`);
    else say(`✓ .staves/config.json holds this project's connection reference`);
  }
  console.log("\nSkills and instructions");
  for (const base of [".claude", ".agents"]) {
    const label = `${base}/skills/staves/SKILL.md`;
    const file = path.join(root, base, "skills", "staves", "SKILL.md");
    if (!existsSync(file)) say(projectArgs ? `✗ ${label} is missing — run staves setup` : `· ${label} is not installed`);
    else if (existsSync(file + ".generated.md")) note(`· ${label} is customised; this version's text is beside it in SKILL.md.generated.md`);
    else say(`✓ ${label}`);
  }
  const { instructions } = await generatedText(projectArgs ?? ["-y", `@staves/cli@${VERSION}`, "mcp", "--dir", dir]);
  for (const name of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
    const read = await readForReport(path.join(root, name));
    if ("reason" in read) { say(`✗ ${name}: cannot be read (${read.reason})`); continue; }
    const block = managedBlock(read.text);
    if (block === null) say(projectArgs ? `✗ ${name} has no staves managed block — run staves setup` : `· ${name} has no staves managed block`);
    else if (/--connection\s+\S/.test(block)) note(`· ${name} managed block names a connection; it belongs in .staves/config.json, so the file can be committed — run staves setup`);
    else if (block !== instructions.trim()) note(`· ${name} managed block is from an older version — run staves setup`);
    else say(`✓ ${name} managed block matches ${VERSION}`);
  }

  // Collected once, before the boards are printed: the links below and the recommendations at the
  // end are then about the same project, read at the same moment.
  const state = await terminalState(root, project);
  const opens = (board: string) => `· ${board}  ${boardUrl(state.base.url, board)}`;

  console.log("\nBoards");
  if (hosted) {
    const credentials = await readCredentials(connection);
    if (!credentials) say("✗ Connection credential missing. Run staves connect in this project.");
    else {
      try {
        const access = await exchange(credentials.url, credentials.token);
        say(`✓ Staves access verified · ${access.permission} · ${access.boards === null ? "all boards" : (access.boards ?? []).join(", ") || "no existing boards"}`);
        const remaining = access.permission === "contribute" ? Math.max(0, access.createLimit - access.createdCount) : 0;
        console.log(`· Board creation remaining: ${remaining}`);
        for (const line of allowanceHint(access.permission, remaining, state.base.url)) console.log(line);
        console.log(`· Connection: ${connection ?? "legacy default"}`);
      } catch (error) { say(`✗ Staves access failed: ${error instanceof HostedAuthError ? error.message : "Cannot reach Staves; check the service URL and network."}`); }
      for (const board of state.boards) console.log(opens(board));
      console.log(`· Workspace: ${workspaceUrl(state.base.url)}`);
    }
  } else {
    say(`${existsSync(dir) ? "✓" : "·"} Local board directory: ${dir}`);
    let boards: string[] = [];
    try { if (existsSync(dir)) boards = await store.list(); }
    catch (error) { say(`✗ Local board directory cannot be listed (${(error as NodeJS.ErrnoException).code ?? String(error)})`); }
    if (!boards.length) console.log("· No boards yet. Ask your agent to interview you about one workflow.");
    else for (const board of boards) console.log(opens(board));
    if (!state.base.live) console.log(`· Boards open at ${state.base.url} once the local server runs (npx @staves/cli open)`);
  }
  console.log(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
    ? "· Langfuse: LANGFUSE_* present in this shell; the MCP server sees its launcher's environment — verify with staves_langfuse_probe"
    : "· Langfuse: not set in this shell (optional)");
  // Whichever client launches the server is the one whose file has to hold the keys, so name it.
  const langfuseFiles = langfuseRegistrations(project);
  if (langfuseFiles.length) console.log(`✓ Langfuse keys configured for the MCP server in ${langfuseFiles.join(", ")}`);
  // An unregistered project is a fault, not a note. What to do about it is rule 1, printed below.
  if (!projectArgs) process.exitCode = 1;
  // The same rules the home screen prints, from the same state, and the same admission when that
  // state is only part of the answer. A recommendation is never a fault, so neither sets exitCode.
  for (const line of incompleteLine(state)) console.log("\n" + line);
  const next = formatRecommendations(recommend(state), "human");
  if (next.length) console.log("\n" + next.join("\n"));
  console.log(`\nGuide: ${guideUrl(state.base.url)}`);
}

/** After a connection succeeds: the coding agent already has Langfuse keys for this project, so offer
 * to show its runs on staves.io with them — asked in a terminal, only with --share-runs otherwise,
 * never with --no-share-runs. The keys go to the gateway once and are never printed. The connection
 * already stands, so anything that goes wrong here is one line. */
async function offerRuns(args: string[], credentials: { url: string; token: string }, root: string, permission: "read" | "contribute"): Promise<void> {
  if (args.includes("--no-share-runs")) return;
  const explicit = args.includes("--share-runs");
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  if (!explicit && (!interactive || permission !== "contribute")) return;
  const found = agentLangfuseKeys(process.env, await projectRegistrations(root));
  const account = `${workspaceUrl(credentials.url)}#account`;
  if (!found) {
    if (explicit) console.log(`staves: runs not shown: no Langfuse keys in this shell or this project's MCP registration. Add them under Account → Runs at ${account}`);
    return;
  }
  // Asked once: a project whose runs the account already shows is not asked again on every reconnect.
  if (!explicit && await runsProject(credentials).catch(() => null)) return;
  if (!explicit && !await confirm(shareRunsQuestion(credentials.url, found.keys))) return;
  try {
    const shared = await shareRuns(credentials, found.keys);
    const boards = shared.boards.length === 1 ? "1 board" : `${shared.boards.length} boards`;
    console.log(`runs: ${shared.projectName ?? shared.projectId} · ${boards} will show As run  ${workspaceUrl(credentials.url)}`);
  } catch (error) {
    // Gateway refusals are fixed sentences; nothing here carries the keys. One line, whatever it says.
    const reason = error instanceof HostedAuthError ? error.message : "Could not reach Staves.";
    console.log(`staves: runs not shown: ${reason.replace(/\s+/g, " ").trim()}`);
  }
}

/** The connection this machine already holds for this server, if the gateway still accepts it. */
async function workingConnection(url: string): Promise<{ connection: string; credentials: { url: string; token: string }; permission: "read" | "contribute" } | null> {
  const connection = await findConnection(url);
  const credentials = connection ? await readCredentials(connection) : null;
  if (!connection || !credentials) return null;
  try { return { connection, credentials: { url, token: credentials.token }, permission: (await exchange(url, credentials.token)).permission }; }
  catch { return null; }
}

/** A yes-by-default question in a terminal. */
async function confirm(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return ["", "y", "yes"].includes((await prompt.question(question)).trim().toLowerCase()); }
  finally { prompt.close(); }
}

/** Explicit token paths remain available for CI; ordinary connection uses browser approval. */
async function tokenFrom(args: string[], url: string): Promise<string> {
  const flagged = option(args, "token") ?? args.find(a => a.startsWith("sta_"));
  if (flagged) return flagged.trim();
  if (process.env.STAVES_TOKEN) return process.env.STAVES_TOKEN.trim();
  if (args.includes("--token-stdin")) {
    let piped = "";
    for await (const chunk of process.stdin) piped += chunk;
    if (!piped.trim()) throw new Error("No token received on stdin.");
    return piped.trim();
  }
  // Without a terminal there is no browser to open, but the printed URL still works from any
  // signed-in machine, so keep polling rather than refusing to connect.
  const openBrowser = !!process.stdin.isTTY && !!process.stdout.isTTY && !args.includes("--no-browser");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  try {
    return await connectThroughBrowser({ url, name: path.basename(process.cwd()), signal: controller.signal, openBrowser,
      onOpen: approvalUrl => {
        const approval = new URLSearchParams(new URL(approvalUrl).hash.slice(1)).get("approval") ?? "";
        console.log(`Approve this project's access in your browser. Check code: ${approval.slice(4, 10).toUpperCase()}\n${approvalUrl}`);
        if (!openBrowser) console.log("Open this URL on any signed-in browser, or set STAVES_TOKEN / use --token-stdin for non-interactive use.");
        console.log("Waiting for approval…");
      },
    });
  } finally { process.removeListener("SIGINT", stop); }
}

function option(args: string[], name: string): string | undefined {
  const equals = args.find(arg => arg.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`--${name} requires a value`);
  return args[index + 1];
}

/** Positional words, with the value of every flag the command takes removed. */
function words(args: string[], valued: string[]): string[] {
  return args.filter((arg, index) => !arg.startsWith("--") && !valued.some(name => args[index - 1] === `--${name}`));
}

/** Where the boards this command acts on are drawn, on the same reading of the flags as the store. */
async function commandBase(args: string[]): Promise<BaseLink> {
  if (!args.includes("--hosted") && !option(args, "connection")) return resolveBase({ dir });
  return resolveBase({ dir, credentials: await readCredentials(await connectionFor(args)) });
}

/** The boards this command acts on: this project's, or an account connection's. */
async function commandStore(args: string[]): Promise<Store> {
  if (!args.includes("--hosted") && !option(args, "connection")) return store;
  const credentials = await readCredentials(await connectionFor(args));
  if (!credentials) throw new Error("this machine is not connected. Run: npx @staves/cli connect");
  return hostedStore(credentials);
}

/** A decision is this person's act, recorded under their name on this machine. */
const reviewer = () => `human:${userInfo().username}`;

async function main() {
  // A pipe is not a person: without a terminal the bare command stays the full help, as scripts expect.
  if (cmd === undefined && process.stdout.isTTY) return home(path.resolve(dir, ".."));
  switch (cmd) {
    case "--version": case "-v": case "version":
      console.log(VERSION);
      break;
    case "git": {
      const git = await captureGitContext(option(args, "repo") ?? process.cwd(), { baseRef: option(args, "base") });
      const board = args[0]?.startsWith("--") ? undefined : args[0];
      if (!board) { console.log(JSON.stringify(git, null, 2)); break; }
      let targetStore = store;
      if (args.includes("--hosted")) {
        const credentials = await readCredentials(await connectionFor(args));
        if (!credentials) throw new Error("Not connected. Run staves connect first.");
        targetStore = await hostedStore(credentials);
      }
      console.log(JSON.stringify(await saveDevelopmentLink(targetStore, board, { git, requestId: option(args, "request"), note: option(args, "note") }, "agent:cli"), null, 2));
      break;
    }
    case "init": {
      // Run from a subdirectory, init adopts the repository's existing .staves; say so.
      if (existsSync(dir)) console.log(`staves: this repository is already initialised at ${path.resolve(dir, "..")}; refreshing it`);
      await fs.mkdir(dir, { recursive: true });
      const cfgPath = path.join(dir, "config.json");
      if (!existsSync(cfgPath)) await fs.writeFile(cfgPath, JSON.stringify({ version: VERSION, board: path.basename(path.resolve(dir, "..")).replace(/[^a-z0-9-]/gi, "-").toLowerCase(), roots: ["."], ignore: ["node_modules", "dist", ".git"] }, null, 2) + "\n");
      await fs.mkdir(dir, { recursive: true });
      const root = path.dirname(dir);
      const serverArgs = ["-y", `@staves/cli@${VERSION}`, "mcp", "--dir", dir];
      const { desktop: snippetDesktop } = await registerAgents(root, serverArgs);
      console.log(`staves: created ${path.relative(root, dir) || ".staves"}/ and registered the MCP server for
  Claude Code   .mcp.json  ·  skill at .claude/skills/staves/SKILL.md
  Cursor        .cursor/mcp.json
  Gemini CLI    .gemini/settings.json · instructions at GEMINI.md
  Claude Desktop — add to claude_desktop_config.json:
${snippetDesktop.split("\n").map((l) => "    " + l).join("\n")}
  Codex         .codex/config.toml · skill at .agents/skills/staves/SKILL.md

Claude Code will ask once to approve this project's MCP server (it shows as "pending approval" in /mcp until you do).
Cursor loads the project MCP settings after you reload MCP in Settings.
Codex loads this project's configuration after you trust the project. Restart its MCP connection or session.
Gemini CLI loads the project settings from .gemini/settings.json; run /mcp reload to activate them.
Configuration written does not mean a client has loaded it; check /mcp in your client.
Use now: npx -y @staves/cli@${VERSION} tool staves_interview --dir ${JSON.stringify(dir)} --input '{}'

Open the board:  npx @staves/cli web   (New board for a hosted-style workspace, or open the local board)
Then, in your agent, say:  run staves
(or /mcp__staves__describe — the server carries its own instructions, so that is the whole prompt)

The board draws itself at http://localhost:5178 while the agent works (the MCP server serves it; nothing else to run).
To look without an agent: npx @staves/cli serve

Guide: ${guideUrl()}`);
      break;
    }
    case "setup": {
      const root = path.dirname(dir);
      const config: unknown = JSON.parse(await readOptional(path.join(root, ".mcp.json")) || "{}");
      const previous = entryArgs(stavesEntry(config));
      if (!previous) {
        throw new Error("No Staves project registration. Run staves init for local boards, or staves connect for a Staves account.");
      }
      // A registration written before the rename names `staves`, which npm does not serve; rewrite it.
      const token = packageToken(previous);
      const serverArgs = token && !token.local && (token.name === "@staves/cli" || token.name === "staves")
        ? previous.map((value, index) => index === token.index ? `@staves/cli@${VERSION}` : value)
        : previous;
      await registerAgents(root, serverArgs);
      console.log(`staves: project clients and generated instructions updated to ${VERSION}. Existing connection retained.\nClaude Code: approve in /mcp. Cursor: reload MCP in Settings. Codex: trust the project, then restart its connection/session. Gemini CLI: run /mcp reload to activate project settings.\nRun staves doctor to verify account access; /mcp in your client confirms tool activation.\nGuide: ${guideUrl()}`);
      break;
    }
    case "connect": {
      const url = (option(args, "url") ?? "https://staves.io").replace(/\/$/, "");
      const handoff = option(args, "handoff");
      // Here only to share runs, on a machine already connected: use that connection rather than approving
      // (and storing) a second one. A handoff or a token given outright is still what connects.
      const given = handoff || option(args, "token") || args.some(arg => arg.startsWith("sta_")) || process.env.STAVES_TOKEN || args.includes("--token-stdin");
      if (!given && args.includes("--share-runs") && !args.includes("--no-share-runs")) {
        const held = await workingConnection(url);
        if (held) {
          console.log(`staves: using connection ${held.connection}`);
          await offerRuns(args, held.credentials, path.resolve(dir, ".."), held.permission);
          break;
        }
      }
      const token = handoff ? await pairHandoff(url, handoff) : await tokenFrom(args, url);
      // Every way this can end without a connection says where the guide is: a person stuck here
      // has no board, no tools and nothing else on screen to go on.
      const guide = `Guide: ${guideUrl(url)}`;
      if (!token) { console.error("staves: no token given. Generate one in Staves under Account → Coding agents."); console.error(guide); process.exit(1); }
      let session;
      try { session = await exchange(url, token); }
      catch (error) { console.error(`staves: ${error instanceof HostedAuthError ? error.message : String(error)}`); console.error(guide); process.exit(1); }
      // One account on one server is one connection: reconnecting must not litter ~/.staves.
      const existing = await findConnection(url, session.email);
      const connection = existing ?? randomUUID();
      if (existing) console.log(`staves: reusing connection ${existing}`);
      await writeCredentials({ url, token, email: session.email, boards: session.boards ?? null }, connection);
      const root = path.resolve(dir, "..");
      console.log(`staves: registering in ${root}`);
      const serverArgs = ["-y", `@staves/cli@${VERSION}`, "mcp", "--hosted", "--connection", connection];
      const { desktop } = await registerAgents(root, serverArgs);
      let boards: string[] = [];
      try { boards = await (await hostedStore({ url, token, email: session.email })).list(); }
      catch (error) { console.error(`staves: connected, but listing boards failed: ${error instanceof Error ? error.message : String(error)}. Run staves doctor.`); console.error(guide); }
      const scope = session.boards ?? null;
      const reach = scope === null ? "every board, including ones you make later"
        : scope.length ? scope.join(", ")
        : "no existing boards";
      // One board in scope is one place this agent writes — usually the board the approval page
      // just made for this project. Name the link rather than leaving it to be looked up.
      const only = scope?.length === 1 ? `\n  board: ${scope[0]}  ${boardUrl(url, scope[0])}` : "";
      const remaining = session.permission === "contribute" ? Math.max(0, session.createLimit - session.createdCount) : 0;
      console.log(`staves: connected as ${session.email}
  token stored in ${credentialsPath(connection)} (this file is the credential; the repo never holds it)
  boards in your account: ${boards.length ? boards.join(", ") : "none accessible yet"}${only}
  this connection may open: ${reach}
  permission: ${session.permission}; creation allowance remaining: ${remaining}${allowanceHint(session.permission, remaining, url).map(line => "\n" + line).join("")}
  connection reference: ${connection}

registered the MCP server for
  Claude Code   .mcp.json  ·  skill at .claude/skills/staves/SKILL.md
  Cursor        .cursor/mcp.json
  Gemini CLI    .gemini/settings.json · instructions at GEMINI.md
  Claude Desktop — add to claude_desktop_config.json:
${desktop.split("\n").map((l) => "    " + l).join("\n")}
  Codex         .codex/config.toml · skill at .agents/skills/staves/SKILL.md

Use immediately, without an MCP reload:
  npx -y @staves/cli@${VERSION} tool staves_interview --hosted --connection ${connection} --input '{}'
  npx -y @staves/cli@${VERSION} tool staves_access --hosted --connection ${connection} --input '{}'
The tool command accepts every MCP tool with the same JSON arguments. Read staves_interview,
then conduct the conversation yourself and save the graph with staves_track, staves_artifact
and staves_describe_many after meaningful answers. No provider key required.

Claude Code: approve this project's server in /mcp. Cursor: reload MCP in Settings. Codex: trust the project, then restart the connection/session. Gemini CLI: run /mcp reload to activate project settings.
Configuration written does not establish that the client loaded the tools. Check /mcp.
Reload your agent's MCP connections to use the registered tools directly, then say: interview me with staves

What you can ask it for, once it reconnects:
  run staves            read this repo and draw one workflow as a board
  resume staves         pick a board back up and re-describe what the code changed under
  what has drifted      jobs whose source moved since they were described
  what is wrong here    findings: jargon, structure, work reached from two places
  brief me              one prose read of who does what, and what is unanswered
  export a handoff      markdown, JSON, SVG, PDF, or a scoped prompt for another agent
  review as each role   every chair in turn, commenting on what it owns

Guides: ${url}/docs/connect/
Your boards are at ${url}/workspace — the agent writes straight to them.
To sign this machine out:  npx @staves/cli disconnect --connection ${connection}`);
      await offerRuns(args, { url, token }, root, session.permission);
      break;
    }
    case "disconnect": {
      console.log(await forgetCredentials(option(args, "connection"))
        ? "staves: signed this machine out. Revoke the token itself in Staves under Account → Coding agents."
        : "staves: this machine was not connected.");
      break;
    }
    case "listen": {
      const source = await commandStore(args);
      const { agent, agentBin, board } = resolveListen({
        agent: option(args, "agent"), board: option(args, "board"), agentBin: option(args, "agent-bin"),
        detected: await detectAgents(), boards: await source.list(),
      });
      const project = path.resolve(option(args, "project") ?? process.cwd());
      const base = await commandBase(args);
      const page = boardUrl(base.url, board);
      console.log(`Board: ${board} · ${page}`);
      console.log(`Agent: ${agent} (${agentBin ?? `no path found; staves will call "${agent}" from PATH`})`);
      console.log(`Project: ${project}`);
      console.log("Requests that need a conversation stay queued for your interactive agent.");
      console.log(`Guide: ${guideUrl(base.url)}`);
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try {
        await runAgentListener({ store: source, board, agent, project, boardUrl: page,
          agentBin, signal: controller.signal, once: args.includes("--once"), onStatus: message => console.log(message) });
      } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
      break;
    }
    case "review": {
      const source = await commandStore(args);
      const board = resolveBoard(words(args, ["connection"])[0], await source.list());
      console.log(formatReview(board, await listReview(source, board), boardUrl((await commandBase(args)).url, board)));
      break;
    }
    case "accept": case "reject": {
      // The gateway stamps every appended entry with the agent connection's name and refuses these
      // operations outright (api/agent.mjs allowed set and normalizeEntries). A decision written
      // from here would be attributed to an agent, which is the one thing a review must not do.
      if (args.includes("--hosted") || option(args, "connection")) throw new Error("hosted boards are reviewed in the web app until the gateway accepts human review from the CLI");
      const [rawSeq, named] = words(args, ["connection", "reason"]);
      const seq = Number(rawSeq);
      if (!rawSeq || !Number.isSafeInteger(seq)) throw new Error(`Usage: npx @staves/cli ${cmd} <seq> [board]${cmd === "reject" ? ` --reason "..."` : ""} — the seq is the SEQ column of npx @staves/cli review.`);
      const board = resolveBoard(named, await store.list());
      const reason = option(args, "reason"), by = reviewer();
      await decideProposal(store, board, seq, cmd, by, reason);
      // Hosted review is refused above, so this is always the local board's own page.
      const at = boardUrl((await resolveBase({ dir })).url, board);
      console.log(cmd === "accept"
        ? `Accepted proposal ${seq} on ${board} as ${by}. It is on the board now. · ${at}`
        : `Rejected proposal ${seq} on ${board} as ${by}: ${reason?.trim()} · ${at}`);
      break;
    }
    case "mcp": {
      const connection = await connectionFor(args);
      const rest = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--connection");
      const name = rest.find((a) => !/^\d+$/.test(a)) ?? "agent";
      if (args.includes("--hosted")) {
        const credentials = await readCredentials(connection);
        if (!credentials) { console.error("staves: this machine is not connected. Run: npx @staves/cli connect"); process.exit(1); }
        const { serveHostedMcp } = await import("./mcp.js");
        // The board editor is served at the site root; /workspace is the list of boards, which is not
        // where the agent should send someone who just had one drawn.
        await serveHostedMcp(await hostedStore(credentials), name, credentials.url);
        break;
      }
      await serveMcp(store, name, Number(rest.find((a) => /^\d+$/.test(a)) ?? 5178));
      break;
    }
    case "interview": {
      console.log(AGENT_INTERVIEW);
      break;
    }
    case "tool": {
      const name = args[0];
      if (!name || !name.startsWith("staves_")) throw new Error("usage: staves tool staves_TOOL --input '{...}' [--hosted --connection ID]");
      const input: unknown = JSON.parse(option(args, "input") ?? "{}");
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("--input must be a JSON object");
      let toolStore = store;
      let url = "http://localhost:5178";
      if (args.includes("--hosted")) {
        const credentials = await readCredentials(await connectionFor(args));
        if (!credentials) throw new Error("Not connected. Run staves connect first.");
        toolStore = await hostedStore(credentials);
        url = credentials.url;
      } else {
        const { ensureDaemon } = await import("./daemon.js");
        const { RemoteStore } = await import("./remote.js");
        url = await ensureDaemon(store.dir, 5178, message => console.error(message));
        toolStore = new RemoteStore(url, "coding-agent") as unknown as Store;
      }
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
      const server = buildServer(toolStore, "coding-agent", url);
      const client = new Client({ name: "staves-cli", version: VERSION });
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const result = await client.callTool({ name, arguments: input as Record<string, unknown> });
        console.log(JSON.stringify(result));
        if (result.isError) process.exitCode = 1;
      } finally { await client.close(); await server.close(); }
      break;
    }
    case "daemon": {
      const { runDaemon } = await import("./daemon.js");
      await runDaemon(dir, Number(args.find((a) => /^\d+$/.test(a)) ?? 5178), args.includes("--idle") ? 15 * 60_000 : 0);
      break;
    }
    case "open": {
      const { ensureDaemon } = await import("./daemon.js");
      const url = await ensureDaemon(dir, 5178, (m) => console.error(m));
      const boards = await store.list();
      const target = boards.length ? `${url}/?board=${boards[0]}` : url.replace(/\/b\/local$/, "/");
      console.log(target);
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      try { (await import("node:child_process")).spawn(opener, [target], { detached: true, stdio: "ignore" }).unref(); } catch {}
      break;
    }
    case "status":
    case "doctor": {
      await doctor(path.resolve(dir, ".."), args);
      break;
    }
    case "gym": { // score the interviewer against simulated stakeholders (rule engine; with a key, the model)
      const { gymReport } = await import("./gym.js"); const { byKey } = await import("./interviewer.js");
      const key = process.env.ANTHROPIC_API_KEY; const r = await gymReport(key ? byKey(key) : undefined);
      console.log(r.text); if (args.includes("--transcripts")) for (const row of r.rows) console.log(`\n— ${row.persona} —\n` + row.transcript.map((l) => `${l.who}: ${l.text}`).join("\n"));
      break;
    }
    case "host": {
      const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 8787);
      const pub = args.find((a) => a.startsWith("http")) ?? process.env.STAVES_PUBLIC_URL ?? `http://localhost:${port}`;
      const { host } = await import("./host.js");
      await host({ root: explicitDir ?? path.join(process.cwd(), ".staves-host"), port, publicUrl: pub.replace(/\/$/, ""), local: args.includes("--local") ? dir : undefined });
      break;
    }
    case "web": { // the same web service, locally: workspaces under ~/.staves, plus this project's board as "local"
      const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 5178);
      const { host } = await import("./host.js");
      const { writeLock, liveIdle } = await import("./daemon.js");
      const root = path.join(process.env.HOME ?? process.cwd(), ".staves");
      const srv = await host({ root, port, publicUrl: `http://localhost:${port}`, local: dir });
      const actual = `http://localhost:${(srv.address() as any).port}`;
      writeLock(dir, actual);
      if (args.includes("--idle")) liveIdle(dir, 15 * 60_000);
      const target = `${actual}/`;
      console.log(target);
      if (!args.includes("--no-open")) { const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"; try { (await import("node:child_process")).spawn(opener, [target], { detached: true, stdio: "ignore" }).unref(); } catch {} }
      await new Promise(() => {});
    }
    case "scenario": {
      const [base, name, ...title] = args;
      if (!base || !name) return console.error("usage: staves scenario <base> <name> [title]");
      await store.branch(base, name, title.join(" ") || name);
      // A new board nobody can find is a new board nobody reads. Name where it opens.
      const at = boardUrl((await resolveBase({ dir })).url, name);
      console.log(`scenario ${name} branched from ${base} · ${at}`);
      break;
    }
    case "brief": {
      const name = args[0] ?? (await store.list())[0];
      if (!name) return console.error("no boards yet");
      process.stdout.write(brief(await store.board(name)));
      break;
    }
    case "export": {
      const name = args.find(a => !a.startsWith("--"));
      if (!name) throw new Error("usage: staves export <board> --format=markdown|prompt|json|svg|n8n|staves|mermaid|bpmn --purpose=feasibility|prototype|existing-system|workshop [--jobs=id,id] [--unknowns=ask-first|mark-assumptions] [--constraints=…] [--include-sources]");
      const value = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
      const format = value("format") ?? "markdown";
      // The whole board, in the open Staves format or drawn from it; scope and purpose do not apply.
      if (isBoardFormat(format)) { process.stdout.write(exportBoard(await store.board(name), format)); break; }
      if (!["markdown", "prompt", "json", "svg", "n8n"].includes(format)) throw new Error("Choose markdown, prompt, json, svg, n8n, staves, mermaid or bpmn.");
      const options = exportOptionsSchema.parse({ purpose: value("purpose"), unknowns: value("unknowns"), constraints: value("constraints"), jobIds: value("jobs")?.split(",").filter(Boolean), includeSources: args.includes("--include-sources") });
      process.stdout.write(formatExport(await exportFromStore(store, name, options), format as ExportFormat));
      break;
    }
    case "svg": {
      const name = args[0] ?? (await store.list())[0];
      if (!name) return console.error("no boards yet");
      process.stdout.write(renderSVG(await store.board(name)));
      break;
    }
    case "pdf": {
      const name = args.find((a) => !a.startsWith("--")) ?? (await store.list())[0];
      if (!name) return console.error("no boards yet");
      const paper = (args.find((a) => a.startsWith("--paper=")) ?? "--paper=A3").slice(8);
      const svg = renderSVG(await store.board(name));
      const tmp = path.join(dir, `${name}.print.html`);
      await fs.writeFile(tmp, `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${paper} landscape;margin:12mm}html,body{margin:0;background:#fff}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`);
      const outFile = path.join(dir, `${name}.pdf`);
      const candidates = ["google-chrome", "chromium", "chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
      const { spawnSync } = await import("node:child_process");
      for (const c of candidates) {
        const r = spawnSync(c, ["--headless", "--disable-gpu", `--print-to-pdf=${outFile}`, "--no-pdf-header-footer", tmp], { stdio: "ignore" });
        if (r.status === 0 && existsSync(outFile)) { console.log(`staves: ${outFile} (${paper} landscape)`); return; }
      }
      console.log(`staves: no headless Chrome found. Open ${tmp} in a browser and print to PDF (${paper} landscape).`);
      break;
    }
    case "lint": {
      const name = args.find((a) => !a.startsWith("--")) ?? (await store.list())[0];
      if (!name) return console.error("no boards yet");
      const b = await store.board(name);
      if (args.includes("--stale")) {
        const st = stale(b, dir);
        for (const x of st) console.log(`stale ${b.jobs.find((j) => j.id === x.job)?.name}: ${x.commits ? `${x.commits} commit(s) touched` : "uncommitted changes in"} ${x.files.join(", ")}`);
        const blind = b.jobs.filter((j) => !j.removed && j.kind !== "ghost" && j.kind !== "outside" && (!j.sources?.length || !j.provenance.commit));
        if (blind.length) console.log(`cannot tell for ${blind.length} job(s) without sources: ${blind.map((j) => j.name).join(", ")}`);
        if (st.length) process.exitCode = 1; else if (!blind.length) console.log("nothing stale; every job carries sources");
        break;
      }
      for (const f of lint(b)) console.log(`${f.severity.padEnd(5)} ${f.message}`);
      break;
    }
    case "serve": { // foreground daemon
      const { runDaemon } = await import("./daemon.js");
      await runDaemon(dir, Number(args.find((a) => /^\d+$/.test(a)) ?? 5178));
      break;
    }
    case "serve-legacy": {
      const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 5178);
      const url = await serveHttp(store, port, console.log);
      if (!url) console.error(`port ${port} is taken — is staves already serving? (npx @staves/cli serve ${port + 1})`);
      break;
    }
    case "help":
    default:
      console.log(`staves ${VERSION} — draw the work

Run npx @staves/cli with no command in a terminal for the home screen: what is registered, what is
waiting on the boards, and the three next steps. Without a terminal that prints this help instead.

Set up
  npx @staves/cli init                                create .staves/, register the MCP server for Claude Code, Cursor and Codex, install the skill, add a managed block to CLAUDE.md and AGENTS.md; Gemini CLI also gets GEMINI.md and .gemini/settings.json
  npx @staves/cli connect [--url URL]                 approve account access in your browser, then register this project's agents; the approval page can create the project's board
  npx @staves/cli connect --no-browser                print the approval URL and check code instead of opening a browser (headless, SSH, containers)
  npx @staves/cli connect --token sta_…               use an existing token instead of browser approval (STAVES_TOKEN does the same)
  npx @staves/cli connect --token-stdin               read an existing token from stdin, leaving nothing in shell history
  npx @staves/cli connect --handoff CODE --url URL    redeem a temporary web handoff
  npx @staves/cli connect --share-runs                also show this project's runs on staves.io with the Langfuse keys your coding agent already has (asked in a terminal; this flag for scripts; an already-connected machine reuses its connection)
  npx @staves/cli connect --no-share-runs             connect without offering to show runs
  npx @staves/cli setup                               refresh client registration and generated instructions; keep the connection
  npx @staves/cli disconnect [--connection ID]        forget the stored token on this machine
  npx @staves/cli doctor [--strict]                   one screen: what is running, what is registered, what is wrong; --strict also fails on stale-but-working registrations; exits 1 when something is broken
  npx @staves/cli status                              alias for doctor

Work with an agent
  npx @staves/cli mcp [--dir .staves] [name] [port] [--hosted --connection ID]   the MCP server on stdio (a thin client to the daemon; starts it if needed)
  npx @staves/cli tool staves_TOOL --input '{}' [--hosted --connection ID]       call any MCP tool now, without waiting for an MCP reload
  npx @staves/cli interview                           print instructions for an agent-led interview
  npx @staves/cli listen [--agent claude|codex] [--board ID] [--once] [--agent-bin PATH] [--hosted --connection ID]   deliver queued assessments to a local agent in the foreground; --agent and --board only when there is more than one; conversations and implementation stay queued
  npx @staves/cli review [board] [--hosted --connection ID]   what is waiting for you: agent proposals, and how far each request got
  npx @staves/cli accept <seq> [board]                        put an agent's proposal on the board as human:<you> — local boards only; hosted boards are reviewed in the web app
  npx @staves/cli reject <seq> [board] --reason "..."         turn a proposal down with a reason the agent can act on — local boards only

Open a board
  npx @staves/cli open                                start the daemon if needed and open the board in a browser
  npx @staves/cli serve [port]                        serve the board at http://localhost:5178 in the foreground (the MCP server also serves it; use this when no agent is running)
  npx @staves/cli web [port] [--no-open] [--idle]     the web service, locally: New board → one line → your agent draws it here
  npx @staves/cli host [port] [https://public.url] [--dir workspaces]   hosted mode: workspaces behind tokens, remote MCP at /mcp/<token>, boards at /b/<token>/

Read and hand off
  npx @staves/cli brief [board]                       print the board as prose for an agent
  npx @staves/cli export <board> --format=markdown|prompt|json|svg|n8n  prepare a scoped design handoff
  npx @staves/cli svg [board]                         print the board as SVG (print it, frame it)
  npx @staves/cli pdf [board] [--paper=A3]            the board as a PDF via headless Chrome, or a print-ready HTML if none
  npx @staves/cli lint [board] [--stale]              the findings; --stale lists jobs whose code moved since described (exit 1 if any)
  npx @staves/cli scenario <base> <name> [title]      branch a scenario to redesign in
  npx @staves/cli git [board] --repo PATH --base REF [--request ID] [--hosted]   capture Git or link it to a design
  npx @staves/cli help                                this list
  npx @staves/cli --version                           the installed version

Add --dir PATH to any command to use a board directory other than this repository's .staves.
Add --debug to any command to print the stack instead of one line.

In the board, press ? for gestures, keys and what the marks mean.
For an agent: the staves_help tool, or the resource staves://protocol.

Start: npx @staves/cli connect   (or init for local boards)
Guide: ${guideUrl()}
`);
  }
}
main().catch((error) => {
  // An expected failure is one line the person can act on; --debug is what asks for the stack.
  if (error instanceof Error && !process.argv.includes("--debug")) console.error(`staves: ${error.message}`);
  else console.error(error);
  process.exit(1);
});
