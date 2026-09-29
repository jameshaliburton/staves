---
title: "The skill in your project"
description: "What gets written into your repo, and why a skill is not a replacement for the server."
---
Along with the MCP configuration, `connect` and `init` write a skill into your project at `.claude/skills/staves/SKILL.md` and `.agents/skills/staves/SKILL.md`. Your client discovers the skill after project trust and any required reload; MCP activation may still need approval. Delete the file and nothing else changes.

## What it is for

The server gives an agent the tools. The skill gives it the judgement about when and how to use them: scope one workflow rather than a whole platform, describe work in the language of the work rather than the system, cite the files you read, and ask a question on the board rather than inventing an answer. That guidance used to live inside the server, where an agent met it late and a person never saw it at all.

## A skill is not a replacement for the server

This is the thing most often asked, so it is worth being exact about. A skill is instructions. A server is capability. The skill tells an agent how to work and still calls the tools underneath — so it helps an agent that can already reach Staves, and does nothing for one that cannot.

A coding agent with terminal access can also call every tool using `staves tool`, without waiting for an MCP reload. The skill explains how to interview in that conversation and save the graph incrementally.

## If you would rather write your own

Edit the file to suit your project. Existing custom skill files are preserved by `connect` and `init`. Current interview instructions are also available through `staves_interview`.

## Updating an existing installation

Generated MCP configurations pin the installed package version. Run `npx @staves/cli@latest setup` from the project to refresh registration and generated instructions while preserving its connection. Then reload MCP. Running `npx @staves/cli@latest` does not rewrite an already running MCP process.

The updated guidance covers coherent interview batches, explicit conversation scope and intention, Git-linked assessment returns, and optional Langfuse evidence. Existing custom skill files remain untouched. Compare their guidance with this documentation; current interview instructions remain available through `staves_interview`.

Unmodified generated skills are upgraded safely. Customized skills are preserved, with updated generated guidance provided separately for comparison. Run `staves doctor` to distinguish saved configuration from verified account access; it cannot certify that your client has activated its MCP tools.
