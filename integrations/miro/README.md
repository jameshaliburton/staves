# Miro importer — developer adapter

This adapter turns a Staves JSON handoff into editable Miro shapes and attached connectors. It preserves track membership, task parent labels, stable job IDs, revision, open questions and decision annotations. The returned `mapping` maps Staves IDs to destination IDs.

It is not an installed app or an authenticated direct-export service. It has not been verified against a live Miro account. The SDK contract follows the official [shape](https://developers.miro.com/docs/websdk-reference-shape) and [connector](https://developers.miro.com/docs/websdk-reference-connector) APIs.

1. Create and install a [Miro Web SDK app](https://developers.miro.com/docs/build-your-first-hello-world-app) in a development team, with board read/write access.
2. Include `import.ts` and its shared `../figma/model.ts` parser in the app build.
3. On an explicit user import action, read the downloaded JSON file and call:

```ts
await importToMiro(await file.text(), miro.board, message => {
  status.textContent = message;
});
```

Each invocation adds a separate snapshot. Review the destination before importing. If import fails, the adapter attempts to remove items created by that invocation and reports incomplete cleanup. No existing board objects are modified. Keep the accompanying JSON: full job semantics, discussion and resolved questions remain there; the visual adapter does not make every field visible or sync edits back.
