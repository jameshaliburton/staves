# Staves → Figma Design

A local development plugin that imports the **JSON handoff** from Share & hand off. It creates editable frames and text for roles, jobs, nested tasks and open questions. Stable IDs and the source revision are stored as plugin data. No network access is used.

## Install and use

1. From the repository root, run `node integrations/figma/build.mjs`.
2. In Figma Desktop, open a Design file. Under Plugins → Development, import `integrations/figma/manifest.json`.
3. Run **Staves workflow importer**, select a JSON handoff and click **Import editable workflow**.

Each import adds a new snapshot; it never overwrites an existing design. This plugin is for Figma Design, not FigJam. Connectors are editable static lines; they do not automatically follow cards. Epics and dependencies outside the selected scope are annotations. All supplied job fields remain in plugin data; not every field is visible. Changes do not sync back to Staves.

The parser and layout are tested locally; live Figma rendering still requires verification in an installed development plugin. Uses the official [Figma Plugin API](https://developers.figma.com/docs/plugins/).
