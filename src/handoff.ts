import type { Board, Job } from "./model.js";

/**
 * One thing to paste.
 *
 * The old flow asked a person to hold three screens in their head at once: a settings page telling
 * them to run `npx @staves/cli init` in a terminal, a connect sheet repeating it, and a handoff prompt
 * that carried the board's URL but no way to reach it — closing with "if MCP is unavailable, help me
 * connect it", which hands the agent a problem and no instructions. Somebody in a fresh project, which
 * is exactly when none of it is set up, got the confusing half of all three.
 *
 * The thing nobody was using: **the coding agent can run the command itself.** It has a terminal, it is
 * standing in the project, and it is already being asked to do work there. So there is no reason to
 * make a person relay a shell command between two windows. One paste, and the agent bootstraps.
 *
 * So this builds a prompt that is complete on its own: how to connect if it is not connected, which
 * board out of all of them, where that board lives, what the conversation was about, and what the
 * agent is and is not allowed to do. What it contains changes with what is already true — an agent
 * that is connected should not be told to set itself up, and being told to anyway is how a person
 * learns to skim the instructions.
 */

export interface HandoffFacts {
  /** the board's id, which is what every command needs to name it */
  board: string;
  /** where the log lives, so a local agent knows which project it is standing in */
  dir?: string;
  /** the page this board is served from, for a person following along */
  url?: string;
  /** agents already connected and writing to this board, by name */
  connected: string[];
  /** a hosted workspace connects differently from a local one */
  hosted?: boolean;
  /** the job the conversation is scoped to, or "board" */
  scope?: string;
  /** what the person said they wanted to work on */
  intention?: string;
  /** what they had typed and not sent */
  draft?: string;
}

export interface Handoff {
  /** the whole thing, ready to paste into a coding agent */
  prompt: string;
  /** true when nothing is connected yet and the prompt therefore carries setup */
  needsSetup: boolean;
  /** what is connected right now, for the interface to say so plainly */
  connected: string[];
  /** the everyday commands, worth showing once a connection exists */
  commands: { label: string; command: string; what: string }[];
}

const CLI = "npx @staves/cli";
const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\"'\"'") + "'";

/** What someone reaches for once the connection works. Not setup — the day-to-day. */
export function commandsFor(facts: HandoffFacts): Handoff["commands"] {
  const b = ` --board ${facts.board}`;
  return [
    { label: "Check the connection", command: `${CLI} doctor`, what: "what is registered, and whether this board can be reached" },
    { label: "Read the board", command: `${CLI} brief${b}`, what: "the workflow as prose, without opening the app" },
    { label: "Deliver queued work", command: `${CLI} listen --agent claude${b} --once`, what: "pick up requests this conversation has queued" },
    { label: "Reconnect", command: facts.hosted ? `${CLI} connect` : `${CLI} init`, what: "register again after moving the project or changing agent" },
  ];
}

/**
 * How to reach this board, for any prompt that asks an agent to do something with it.
 *
 * Shared rather than written twice: the export from Share & hand off carried the board's contents and
 * no way to write back to it, closing with "if Staves MCP is available" — the same conditional with no
 * instructions that made the other flow confusing. An agent holding a workflow it cannot reach can
 * only describe it back at you.
 */
export function connectionBlock(facts: HandoffFacts): string {
  return [
    facts.connected.length
      ? `ALREADY CONNECTED: ${facts.connected.join(", ")}. These are sessions seen on the board; they may not be this session. Call staves_brief with board "${facts.board}" first. If this session can read the board, skip setup. Otherwise use the setup below.`
      : "FIRST, CONNECT. Run these commands in the destination project — run it yourself rather than asking me to.",
    ...(facts.hosted ? ["connect prints an approval URL and waits. Show me that URL so I can approve access in my signed-in browser; keep the command running until approval completes."] : []),
    [
      ...(facts.dir ? [`    cd ${shellQuote(facts.dir)}`] : []),
      `    ${CLI} ${facts.hosted ? "connect" : "init"}`,
      `    ${CLI} doctor`,
    ].join("\n"),
    `${facts.hosted ? "connect" : "init"} registers the Staves MCP server for Claude Code, Cursor, Codex and Gemini CLI. doctor checks registration and account access. Activate or reconnect Staves MCP in this coding-agent session, then call staves_brief with board "${facts.board}" to verify access. If that board cannot be read, say so and stop rather than guessing.`,
    "NATIVE MCP FIRST. Identify the coding client you are running in and use its native Staves tools when available. Configuration files and a successful doctor or CLI call do not prove that this session has loaded MCP. Verify native access by actually calling staves_brief from this session's MCP tools. If activation needs a user action, give only the action for this client: Claude Code — open /mcp and approve or reconnect Staves; Codex app — restart from MCP settings after trusting the project, then check /mcp (restart a terminal Codex session if needed); Gemini CLI — use /mcp reload; Cursor — enable Staves in MCP settings, or inspect /mcp list in Cursor CLI. Preserve the board and handoff request across that step. Never silently treat CLI fallback as completed native setup.",
    "TERMINAL ACCESS. A plain shell uses the Staves CLI rather than hosting agent tools. The CLI exposes the same Staves tools through npx @staves/cli tool <tool-name> --input '<JSON arguments>' with this board's --dir or --hosted --connection options. If native tools cannot load yet, explain the exact remaining activation step; CLI access may keep work moving, but label it as CLI access. Do not ask me to choose a transport or perform setup you can do yourself.",
    [
      "THE BOARD",
      `    id:    ${facts.board}`,
      ...(facts.dir ? [`    lives: ${facts.dir}/.staves/${facts.board}.jsonl`] : []),
      ...(facts.url ? [`    page:  ${facts.url}`] : []),
    ].join("\n"),
  ].join("\n\n");
}

export function handoff(board: Board, facts: HandoffFacts): Handoff {
  const needsSetup = facts.connected.length === 0;
  const job: Job | undefined = facts.scope && facts.scope !== "board" ? board.jobs.find(j => j.id === facts.scope && !j.removed) : undefined;
  const scopeLine = job ? `${facts.scope} (${job.name})` : "board (the whole workflow)";

  return {
    needsSetup, connected: facts.connected, commands: commandsFor(facts),
    prompt: [
      "Continue a design conversation with me on my Staves board.",
      connectionBlock(facts),
      `    scope: ${scopeLine}`,
      `WHAT I AM TRYING TO DO\n    ${facts.intention?.trim() || "Not set — ask me what I want to work on before proposing anything."}`,
      ...(facts.draft?.trim() ? [`WHAT I WAS PART WAY THROUGH TYPING\n    ${facts.draft.trim()}`] : []),
      `READ BEFORE REPLYING. Call staves_brief for this board, and read the saved conversation for the scope above. Keep three things apart and do not let them blur: the workflow's goal, what I said I want to work on, and the questions nobody has answered. If you cannot reach the board, say so — do not describe it from this prompt.`,
      `THEN INTERVIEW ME. Start from my draft if there is one. One consequential question at a time. Where something is unknown, leave it unknown and say so rather than filling it in quietly. When you change the board, make coherent batches I can review, and never quietly drop existing jobs, tasks, evidence or decisions I have already made.`,
      `WHAT THIS DOES NOT AUTHORIZE. Designing the workflow with me, and writing to this board. Not writing application code, not running migrations, not deploying, not dispatching implementation work. If the design implies code, tell me and wait.`,
    ].join("\n\n"),
  };
}
