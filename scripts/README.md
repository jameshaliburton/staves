# scripts

- `build_app2.py` — generates `src/app2.ts` (the served app: markup, CSS, and the app script). Run it, then `npm run build`. It reads `icons.json` (an inlined Phosphor subset) and takes the stylesheet from `build_v4.py`.
- `build_v4.py` — generates the design mock `workspace-v4.html` and, more importantly, holds the stylesheet the app uses.
- `compose.cjs` — bundles `dist/standalone.js` with the app into `staves.html`.

```bash
python3 scripts/build_v4.py && python3 scripts/build_app2.py && npm run build
npx esbuild dist/standalone.js --bundle --format=iife --platform=browser --minify --outfile=/tmp/standalone.js && node scripts/compose.cjs
```

## Hosted database checks

The database checks (`npm run test:database`) moved to `staves-cloud` with the migrations they test.

## Persistent editor preview

`npm run preview:editor` builds the application and serves the actual editor at `http://127.0.0.1:4325/?board=node-stress`. The illustrative dense workflow seeds only if absent. Edits and history live in ignored `.staves/visual-preview/`, rather than the operating system's temporary directory, and survive restarts. Set `STAVES_PREVIEW_PORT` to use another local port.

No integration is required. To explicitly load existing local environment configuration, build first and run `node --env-file=.env.local design/editor/preview.mjs`. This preview does not install a coding-agent companion. Do not delete `.staves/visual-preview/` to restart it; stop and rerun the process.
