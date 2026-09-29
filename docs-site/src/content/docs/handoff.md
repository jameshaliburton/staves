---
title: "Share and hand off"
description: "Carry the human intent into implementation or a workshop."
---
There are two ways a board leaves the editor: to a coding agent that keeps working on it, or as a copy.

## To your coding agent

Choose **Coding agent** in the board header. Pick the whole workflow or the jobs you want, then **Copy to coding agent** and paste into your agent's chat. The request is saved on the board with its revision and scope, and the dialog shows **Received by** the agent once it claims it. If the agent is not connected yet, the pasted text tells it how to connect.

This is a live connection: what the agent writes lands on the board. A continuation to talk does not authorize code changes; if you choose to build, the agent opens a separate implementation request on the same board first.

## As a copy

**Board options → Export…** downloads a **Brief** (Markdown), a **Map** (SVG) or the **Data** (JSON). Under **More export options** you can include source references, or download an n8n planning canvas — notes to plan from, not executable automation.

An export identifies its source revision and preserves roles, tasks, human decisions and open questions. Nothing you do to the copy comes back to the board.

**MCP:** ask your coding agent to call `staves_export` for a scoped prompt, Markdown, JSON or SVG. See [Hand work off](/docs/how-to/handoff/).

**Figma Design and Miro:** development importers are included in this repository under `integrations/figma` and `integrations/miro`. They require destination installation and live verification. FigJam and two-way synchronization are not available.
