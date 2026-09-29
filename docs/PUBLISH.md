# Release the open package

The public source repository is [jameshaliburton/staves](https://github.com/jameshaliburton/staves). The npm package is **`@staves/cli`**, licensed Apache-2.0. Version **0.45.0** is the first public source release; the Staves format retains its independent draft version.

## Prepare a release

Review the changes, update the package version and lockfile together, and ensure the release tag matches `package.json`. From a clean checkout:

```sh
npm ci
npm test
npm run check:boundary -- --pack
```

Inspect the package contents as well as the source diff. Never include local board data, connection credentials, private operations or cloud implementation code.

The release workflow is `.github/workflows/release.yml`. It builds and tests the package, checks its boundary and builds the standalone artifact before publishing. Read the workflow before tagging; it is the source of truth for the exact release steps.

## Standalone artifact

To build `staves.html` locally after `npm run build`:

```sh
npx esbuild dist/standalone.js --bundle --format=iife --platform=browser --minify --outfile=/tmp/standalone.js
node scripts/compose.cjs
```

This artifact uses the legacy generated `app2` shell. It is not the full `design/editor/` app. Check it separately when changing that surface.

## Publish

Pushing a `v*` tag triggers the release workflow. A tag push is a publishing action, not a preview. For the first public source release the matching tag is `v0.45.0`.

CI publishing is intended to include npm provenance. Before pushing the tag, verify that the repository is public, workflow permissions allow an identity token, and npm publishing authorization is configured for the workflow. A workflow file alone does not establish that npm trust or credentials are configured. Verify the resulting npm package and provenance after publication.

Keep release permissions restricted. Do not put registry tokens in source or release notes. Manual publishing, when necessary, must use the same tested package contents and a deliberately authorized registry identity.

## Hosted integration

The private `staves-cloud` repository consumes this source through a submodule pinned to a release tag. Update and validate that dependency in the private repository separately. An npm release does not deploy staves.io, migrate its database or establish compatibility with an untested hosted revision.
