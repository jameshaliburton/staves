---
title: The Staves format
description: The open format behind every board — work shared by people, agents and systems, and where each fact came from.
---

Every Staves board is a document in the **Staves format**: an open format for work shared by
people, agents and systems — who does what, what passes between them, where a person decides,
and how we know.

It is separate from the Staves app. Any tool can read or write it, and it is licensed under
Apache-2.0.

## What a board holds

- **Tracks.** Who performs the work: a role people fill, an AI agent, a system, or someone
  outside the work's control.
- **Jobs and tasks.** Work done for someone, with an outcome they would name. Jobs break down
  into tasks.
- **Artifacts.** What passes between jobs. A handoff exists only where something actually
  passes, so you cannot draw an arrow that carries nothing.
- **Triggers, exits and loops.** How work starts, the ways out, and repetition.
- **Gates.** Decisions the work cannot pass without, and the track that answers for each one.
- **Tools.** What each performer uses, and whether an agent can actually reach it.

## Where each fact came from

Each field can record its source: an interview, something a person drew, a document, the code,
an execution trace, or an inference to confirm. When sources disagree, for example when the
code refunds automatically but the support lead says every refund is checked, the board keeps
both claims until a person settles it.

## As it is, or as it should be

A board is either a description of work that exists today (**Mirror**) or a design for work
that should exist (**Design**). A design can point at the description it changes, and mark
what it adds, moves or removes.

## Status

Version 0.1 is a draft for comment. The specification, JSON Schema and mappings to MCP, A2A,
OpenTelemetry, BPMN and W3C PROV will be published with the public source repository.
