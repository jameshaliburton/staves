---
title: When a release is only half available
description: A source-based review of Staves' own release workflow, with the board and the question it leaves open.
---

A release can be downloadable before it is installable from npm. We used Staves to describe that handoff in **Staves' own public release workflow**, then recorded the recovery question on the board.

This example is for people already working with a coding agent. It shows what a small, source-based review produces: a readable description, evidence you can inspect, and a specific question to resolve.

![Staves board showing release automation making the app downloadable, then the package installable, with both routes leading to people using Staves. An open question asks who recovers if package publication fails.](/docs/examples/release-workflow.svg)

[Open the full board image](/docs/examples/release-workflow.svg) · [Download the draft board](/docs/examples/release-workflow.staves.json)

## What the source says

In the [v0.45.0 release workflow](https://github.com/jameshaliburton/staves/blob/f23c6ee70619f07e15eba63b50dd3ff607f1a583/.github/workflows/release.yml#L14-L31), a version tag starts validation, builds the downloadable app, creates its GitHub release, and **then** publishes the package to npm.

That order matters. If package publication fails after the GitHub release succeeds, the download can already be public while that package version is unavailable from npm. The workflow does not specify a recovery step or who owns restoring matching availability.

This is a possibility inferred from the code, **not an observed production incident**. We did not inspect a failed release run or claim that nobody has an operational recovery practice outside this file.

## What we put on the board

The model has two tracks: release automation and the people receiving the software. It separates two outcomes—making the app downloadable and making the package installable—and shows how either route reaches a person. The exit from the first release job records that package publication follows successful release creation.

The agent read the workflow, described it through Staves' MCP tools, and attached the source path to the two release jobs. Recipient behavior is marked as inferred and unknown; the descriptions remain drafts. The board preserves this open question:

> If npm publication fails after the GitHub release exists, who restores matching availability, and what tells people which installation route is ready?

Staves did not autonomously discover or fix this risk. The source review supplied the finding; the board makes its consequence, evidence and unresolved decision available for discussion.

## What was actually tested

The published `@staves/cli@0.45.0` package was used in an isolated local workspace. A real MCP client connected over stdio, checked access, read the protocol, saved the board, ran its review, and exported the SVG and draft `.staves.json` above. The local editor also opened the saved board in a browser. No hosted account or second model key was used.

This demonstrates that local modeling and export path. It does not validate every agent client's installation flow, production execution, or hosted signup. The [open format remains a draft](/docs/open-source/#an-open-draft-format), with documented round-trip limitations.

## Try one workflow from your project

[Set up Staves locally](/docs/open-source/), then ask your coding agent:

> Describe how one release reaches its users. Read the release configuration first. Show who receives each output, cite the source, and ask about recovery wherever the code does not say. Keep assumptions as draft descriptions.

Review the source and the board together. Resolve the question with the person who owns the release before treating the description as agreed behavior.
