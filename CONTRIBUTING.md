# Contributing to Staves

Staves describes work shared by people, agents and systems. Contributions should preserve authorship, make uncertainty visible and keep human review distinct from execution evidence.

## Start here

Read [BOUNDARY.md](BOUNDARY.md) before adding, moving or importing files. Hosted infrastructure belongs in the separate private repository. Changes to what a board means start in `spec/` and include an entry in `spec/CHANGELOG.md`.

Use Node.js 20 or later and npm:

```sh
npm ci
npm test
npm run check:boundary -- --pack
npm run preview:editor
```

See [local setup](docs/LOCAL-SETUP.md) for persistent preview storage and agent configuration. `npm test` includes the build. The root package is `@staves/cli`; there is no separate package build to perform.

## Find the code

- `src/model.ts`, `src/ops.ts`, `src/store.ts`: types, operation folding and local persistence.
- `src/derive.ts`, `src/reflect.ts`: analysis and review.
- `src/mcp.ts`, `src/protocol.ts`, `src/interviewer.ts`: agent tools, modeling guidance and interviewing.
- `design/editor/`: the main editor and its tests.
- `src/test/`: TypeScript tests, compiled into `dist/test/`.
- `docs-site/`: the user documentation.

`src/app2.ts` is a legacy generated shell, also used by the standalone HTML artifact. Change its generator, `scripts/build_app2.py`, when working on that surface. It is not the main editor. See the [architecture](docs/ARCHITECTURE.md) for current seams and limitations.

## Pull requests

Keep a pull request focused. Explain the problem, resulting behavior and how you checked it. Include regression tests for behavior changes and screenshots for meaningful UI changes. Run the boundary check, including package contents. For interviewer changes, also run `node dist/cli.js gym` and describe any changed results.

Use the surrounding code's style. TypeScript is used under `src/`; the editor uses JavaScript modules. Do not introduce a framework or restructure unrelated code as part of a fix. Never add credentials, personal connection files, real customer data or private operations material.

Open an issue before substantial format or architecture changes so the design can be discussed. Bugs and proposals belong in [GitHub issues](https://github.com/jameshaliburton/staves/issues). Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Sign off your commits

Contributions are made under Apache-2.0. Each contribution commit must include a `Signed-off-by` trailer certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/): you have the right to submit the work under the project's license.

```sh
git commit -s -m "fix: describe the behavior corrected"
```

Use your own Git identity. Sign-off is a certification, not a cryptographic signature. If you forgot it on your latest unpushed commit, use `git commit --amend --no-edit -s`. Do not sign off on someone else's behalf.
