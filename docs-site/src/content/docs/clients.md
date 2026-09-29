---
title: "Per client"
description: "Use your project's connection reference with MCP or the immediate CLI fallback."
---

`npx @staves/cli connect` registers Claude Code in `.mcp.json`, Cursor in `.cursor/mcp.json`, Codex in `.codex/config.toml`, and Gemini CLI in `.gemini/settings.json`. Each registration includes the connection reference so different projects keep their own credentials. `npx @staves/cli init` writes the same four files for local boards, with `--dir` instead of a connection.

An `env` table already on the `staves` entry — Langfuse keys, typically — is preserved when `setup` rewrites the rest of it.

For clients configured outside the project, use the exact snippet printed by `connect`, including `--connection CONNECTION_ID`. A typical registration runs:

```sh
npx -y @staves/cli mcp --hosted --connection CONNECTION_ID
```

The connection ID is a local reference, not a secret. The credential stays in your user directory. Client configuration and approval requirements still apply.

After setup, activate Staves in the client you use:

- **Claude Code:** approve or reconnect Staves in `/mcp`.
- **Codex:** trust the project and restart the MCP connection or session; check `/mcp`.
- **Gemini CLI:** run `/mcp reload` to load the registration.
- **Cursor:** enable Staves in MCP settings. Cursor CLI shares the configuration; inspect it with `/mcp list`.

Have the agent call `staves_brief` for your board through its native tools. That verifies native access; writing configuration or passing `doctor` alone does not. The agent should then show a short bullet list of what it can do with the board: build, discuss, connect a project, assess gaps, compare code, test scenarios, review roles, and report progress.

A plain terminal can use the same tools through the CLI. This also keeps work moving when a coding client still needs MCP activation:

```sh
npx @staves/cli tool staves_interview --hosted --connection CONNECTION_ID --input '{}'
```

No MCP reload is required for this fallback. The same tool arguments work through MCP and CLI. Run from the project directory, `--connection` can be left off: `connect` records the connection reference in `.staves/config.json`, which is where the command in `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` finds it. Those three files name no connection, so they can be committed; `.staves/config.json` is this machine's.

Interviewing requires only the agent conversation and the Staves tools. Describing an existing implementation additionally requires the agent to have repository access. This release uses local CLI/stdio connections; it does not add a public remote MCP endpoint.
