---
title: Use Staves without an account
description: What is open, where local boards live, and what changes when you connect to the hosted service.
---

Staves is **open core**. The format, analyzers, interview method, editor, MCP server and CLI are Apache-2.0 software. You can use them with your own coding agent or model key, without a Staves account.

## Start with your coding agent

You need Node.js 20 or later and a coding agent such as Claude Code, Codex, Gemini CLI or Cursor. In the project you want to describe:

```sh
npx -y @staves/cli init
npx -y @staves/cli doctor
```

Approve or reload the MCP connection in your agent, then say **run staves** and name one workflow to describe. Ask the agent to verify access through its native Staves tools; a successful registration alone does not mean the tools are loaded. Open the board with `npx -y @staves/cli open`.

The agent uses its existing model. The local editor does not automatically gain a browser interview model from the MCP connection.

## Choose where the board lives

| | Local project | Staves account |
| --- | --- | --- |
| Start | `npx @staves/cli init` in the project | `npx @staves/cli connect` in the project |
| Board storage | `.staves/*.jsonl` beside your code | Your Staves workspace |
| Open the board | `npx @staves/cli open` | The board link or [workspace](https://staves.io/workspace) |
| Agent model | Your existing coding agent | Your existing coding agent |
| Account needed | No | Yes |

Both paths use the same open format and tools. `init` registers the local MCP server for supported coding agents. `connect` registers a client of the hosted service; the account's gateway, sign-in, database and operations are private. Connecting is a choice, not a requirement for local use.

Local boards are project files. Decide with your team whether to commit them: they can travel and merge with the code, but a board may describe sensitive work. An account connection stores only a reference in the project; its credential stays on your machine. See [Bring in a coding agent](/docs/connect/) for client setup and verification.

## What you can use and extend

- The [Staves format](/docs/reference/format/) and its [JSON Schema](https://staves.io/spec/0.1/board.schema.json) describe tracks, jobs, handoffs, decisions and provenance. The format is versioned separately from the tool.
- The source includes the analyzers, interview engine, editor, renderer, CLI, MCP server and single-tenant local server. You can run the editor [from source](/docs/from-source/).
- Export and interop let you take a board out as data or a scoped handoff. Langfuse evidence is optional and uses keys you supply; see [execution evidence](/docs/langfuse/).

The hosted service adds account access and shared storage. The public repository's [open-core statement](https://github.com/jameshaliburton/staves/blob/main/OPEN-CORE.md) explains the product line; [BOUNDARY.md](https://github.com/jameshaliburton/staves/blob/main/BOUNDARY.md) records where code belongs. A change to what a board *is* starts in the public `spec/` directory.

## An open draft format

The format is **v0.1, draft for comment**, with breaking changes expected before 1.0. Staves itself is not yet a fully conforming consumer: disputes become open questions rather than round-tripping as competing claims, and preservation of unknown extensions, evidence, references and provenance is incomplete when saving through a Staves store. Do not rely on lossless interchange yet. See the [specification and conformance notice](https://github.com/jameshaliburton/staves/blob/main/spec/README.md).

Local and hosted boards are separate stores. Connecting to an account does not migrate existing local boards.
