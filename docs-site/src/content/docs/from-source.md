---
title: "Run Staves from source"
description: "Only for working on Staves itself. Not needed to connect an agent."
---
This is only for working on Staves itself, or running a build newer than the published package. **To point your coding agent at a board you need none of it** — see [Bring in a coding agent](/docs/connect/), which needs nothing but Node.js.

## Run the editor from source

Get a source checkout from the project owner. You need Node.js 20 or later and npm. From that checkout:

```sh
npm install
npm run build
node design/editor/serve.mjs
```

Open `http://localhost:5192/workspace`. Keep the terminal running; Ctrl+C stops it.

## Where that editor saves work

It stores boards in `/tmp/staves-full-editor` as JSONL logs. Back them up: temporary storage gets cleared. Hosted boards are separate and do not sync either way. The CLI’s project-local mode uses a different store again, on port 5178.

## Pointing an agent at a source build

As above, except the command is your checkout rather than `npx`, and it names a directory instead of an account:

```sh
{ "mcpServers": { "staves": { "command": "node", "args": ["/absolute/path/to/staves/dist/cli.js", "mcp", "--dir", "/tmp/staves-full-editor"] } } }
```

Point it at the *same* directory the editor uses, or the agent draws on boards you cannot see. Rebuild after changing source, and reload the agent’s MCP connections.

## A model for the local interview

The local launcher uses an installed, signed-in Codex CLI. Check `codex login status` and restart Staves after signing in. The provider selector described under Account exists in the hosted beta only.
