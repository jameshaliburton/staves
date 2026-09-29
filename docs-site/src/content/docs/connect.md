---
title: "Bring in a coding agent"
description: "Connect your coding agent, model workflows, and work from your Staves board."
---
From the browser, you do not need these commands yourself: **New board → Use my coding agent**, or **Coding agent** on a board, gives you text to paste into your agent, and the agent runs them. See [Your first session](/docs/first-session/). This page is the same path by hand, for a terminal, CI, or when something needs fixing.

Three steps, from your project directory.

A board is one workflow drawn as the people, agents and systems in it, the jobs each one does, what passes between them, and where someone has to decide. Your coding agent draws it from your code.

1. `npx @staves/cli connect` — approve the project in your browser; the boards live in your Staves account.
2. `npx @staves/cli doctor` — one screen of what is registered, what is stale, and the command that fixes each line.
3. Open the project in Claude Code, Codex, Gemini CLI, or Cursor, activate Staves, and say **run staves**.

The approval page can create a board for the project, named after its directory; when the connection opens just that board, the terminal comes back with its link.

Working without an account? `npx @staves/cli init` keeps boards in `.staves/` next to the code, and everything below works the same.

The agent reads your code with its own model and draws one workflow as a board. No separate AI provider key is needed.

Local boards open at `http://localhost:5178/b/local`; `npx @staves/cli open` starts that server. Account boards are in your workspace on staves.io. Every tool that names a board prints its link; `staves_export` hands its document back verbatim.

Then ask for: *run staves*, *resume staves*, *brief me*, *what has drifted*, *what is wrong here*, *export a handoff*, *review as each role*.

## When something is off

`npx @staves/cli doctor` names the file or process behind every line, and prints the command that fixes it. It exits 1 when something is broken. Add `--strict` in CI to fail on stale-but-working registrations too.

The three things it catches most often:

- **The old package name.** `staves` was renamed to `@staves/cli`; the bare name does not exist on npm, so a registration pointing at it never starts. `npx @staves/cli setup` rewrites it.
- **An old version pin**, or a managed block in `CLAUDE.md`/`AGENTS.md` from an earlier release. Same fix: `npx @staves/cli setup`.
- **A missing credential** for a hosted connection. `npx @staves/cli connect` replaces it.

Configuration on disk does not mean your client has loaded it. Claude Code asks once to approve the project's MCP server (`/mcp`); Codex loads the configuration after you trust the project, and needs its connection or session restarted. Gemini CLI reloads with `/mcp reload`; Cursor exposes Staves in MCP settings and shares its registration with Cursor CLI. Ask the agent to call `staves_brief` through its native tools to verify access. Doctor reports registration and account access, not whether your agent has loaded its tools. See [Per client](/docs/clients/).

## When the connection cannot create a board

A connection is read only, or its lifetime creation allowance is spent. That is not a dead end.
`doctor` and the recommendations say the same two ways out: rerun `npx @staves/cli connect` and tick
**Create a new board for this project** on the approval page, or raise the allowance under
**Account → Coding agents**. Asked over MCP, `staves_access` returns the same sentence, and the
agent is told to repeat it rather than report a wall.

## Get requests from your board

A request queued on a board does not run itself. Something has to notice it and hand it to an agent:

```sh
npx @staves/cli listen --agent claude --board BOARD_ID
```

`--agent` takes `claude` or `codex`; both flags can be left off when there is one agent installed, or one board. Add `--hosted --connection CONNECTION_ID` for an account board, `--once` to drain the queue and stop, and `--agent-bin PATH` if the executable is somewhere unusual.

The listener runs a separate read-only agent process using your already-signed-in CLI. It does not attach to an open chat, and it never acts unattended. Conversation requests stay queued for your interactive agent: a read-only process cannot hold a conversation. Implementation requests stay queued too.

Queued means saved, not received. A claim marks receipt; completion records a response. Neither establishes that the design was accepted, that tests passed, or that anything was deployed.

## Decide from the terminal

```sh
npx @staves/cli review [board]              # proposals waiting, and how far each request got
npx @staves/cli accept <seq>                # put a proposal on the board
npx @staves/cli reject <seq> --reason "..." # turn it down, with a reason the agent can act on
```

`review` works on local and account boards and prints the board's link. `accept` and `reject` work on local boards only: the gateway attributes CLI writes to the agent connection, so a decision made here would be recorded as an agent's. Decide account boards in the web app.

## CI and headless

`connect` opens a browser and prints a 6-character check code. Confirm the code against the browser, approve, and the credential arrives on its own — there is nothing to copy. The request expires after ten minutes; denying it grants no access.

Where there is no browser:

```sh
STAVES_TOKEN=sta_... npx @staves/cli connect       # from the environment
npx @staves/cli connect --token-stdin              # piped in, nothing left in shell history
npx @staves/cli connect --token sta_...            # as an argument
npx @staves/cli connect --no-browser               # print the approval URL, open nothing
```

`--no-browser` still waits for approval, and the printed URL works from any signed-in browser, including one on another machine.

The credential is stored under `~/.staves/connections/`. The repository holds a connection reference, not the token. `npx @staves/cli disconnect --connection ID` forgets it on this machine; revoke the token itself under Account → Coding agents.

## Langfuse

Langfuse adds observations of real execution. It is optional: modelling, interviews and code-based assessments need none of it. The keys go in the environment of the process that launches the MCP server, which is not your shell. See [Langfuse](/docs/langfuse/).
