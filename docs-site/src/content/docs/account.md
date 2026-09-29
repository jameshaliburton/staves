---
title: "Account, keys and connections"
description: "What saves here, which key does what, and what the preview cannot do."
---
Your boards, conversations and revision history save to this account. Sign in on another machine and they come with you.

## The AI key

The key here is for talking to Staves *in this browser*: the interview, where Staves asks you about work that has no repository to read, and the reviews and replies the browser conversation produces. Choose a provider, paste a key, then press **Test & save connection**. It is kept in this browser alone and sent through Staves to the provider you chose, who bills you. It is per browser rather than per account, so signing in elsewhere asks again.

Nothing you do through a coding agent needs this key — connecting, describing a repository, drawing a board, reviewing it, answering questions. Your agent is already a model, and it uses its own. See [Bring in a coding agent](/docs/connect/).

A saved key is configuration, not proof that a model request will succeed. The board status distinguishes a configured model from an error or a verified connection. If a key is saved but requests fail, test the provider and model in Account; do not create an agent connection as a substitute.

Model and connection setup is desktop work. A phone opens a single board from a shared link, read only; the workspace itself says so and offers the link to continue on a computer.

## Coding agents

Account lists connections, selected board access, read/contribute permission, creation allowance and usage. Change access without reconnecting. Revoke a connection and its next gateway request is denied. Staves keeps only a hash of a token, which is why it can be shown to you exactly once.

## Runs

**Account → Runs** holds Langfuse keys per project, one set for each app whose runs you want on its boards, and shows which boards read each. The quickest way to add them is `npx @staves/cli connect --share-runs` in the project folder, which uses the keys your coding agent already has; you can also paste them here. The secret key is encrypted before it is stored and never shown again. **Remove keys** deletes one project's keys and leaves its boards connected. See [As run on staves.io](/docs/langfuse/#as-run-on-stavesio).

## What this preview does not do

Walkthroughs are design exploration, not execution of your services and not a live production trace. Library examples are fictional design material, not verified integrations. A connected assistant is not evidence that a workflow has run.

Creation allowance is lifetime and separate from access to existing boards. Deleting a board does not restore the allowance. Read-only connections cannot create boards even when an old allowance is retained.

A connection that has run out is not stuck: rerun `npx @staves/cli connect` in the project and tick **Create a new board for this project** on the approval page, or raise the allowance here. The terminal, `doctor` and the agent all say the same thing.
