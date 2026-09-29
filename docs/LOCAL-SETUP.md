# Run Staves from source

You need Git, Node.js 20 or later, and npm. No Staves account is required for local boards.

```sh
git clone https://github.com/jameshaliburton/staves.git
cd staves
npm ci
npm test
npm run check:boundary -- --pack
npm run preview:editor
```

`npm test` builds the source first. The preview also builds before starting the main editor at **http://127.0.0.1:4325/?board=node-stress**. Keep the terminal running; Ctrl+C stops it. Choose another port with `STAVES_PREVIEW_PORT=4326 npm run preview:editor`.

## Persistent preview data

The preview stores boards in **`.staves/visual-preview/` inside this checkout**. It seeds a synthetic example only when that board does not exist, so restarting retains your changes. Back up that directory if you need its contents. These files are local data, not part of the source distribution or your hosted account.

To use the CLI from the source build:

```sh
npm run build
node dist/cli.js help
```

Rebuild after editing TypeScript. Reload your agent's MCP connection after changing the server code.

## Point an agent at the same boards

For a client that accepts a JSON MCP configuration:

```json
{
  "mcpServers": {
    "staves": {
      "command": "node",
      "args": [
        "/absolute/path/to/staves/dist/cli.js",
        "mcp",
        "--dir",
        "/absolute/path/to/staves/.staves/visual-preview"
      ]
    }
  }
}
```

Replace both paths with your checkout's absolute path. Client configuration syntax varies; see the [connection guide](https://staves.io/docs/connect/). The agent and editor must use the same board directory to see each other's work.

A coding agent can use its own model to interview you through the tools. The contributor preview does not configure a browser interview provider. A connected MCP client is not itself a promise of model availability in the browser.

## Other checks and surfaces

- `npm run test:editor` runs editor tests.
- `node dist/cli.js gym` runs the interviewer gym after a build.
- `npm run build:site` installs and builds the user documentation under `docs-site/`. This optional docs build requires Node.js 22.12 or later and npm 9.6.5 or later; the CLI runtime still supports Node.js 20 or later.
- The standalone HTML build uses the legacy shell; see [publishing](PUBLISH.md). Use the preview above when working on the main editor.
