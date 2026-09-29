---
title: When it does not work
description: What to check, in the order it usually goes wrong.
---

```sh
npx @staves/cli doctor
```

One screen: what is running, what is registered, and what is wrong. It exits 1 when something is
broken, and ends with the top three things to do next and the command for each. `--strict` also
fails on registrations that are stale but still working — an old version pin, a managed block from
an earlier release — which is what you want in CI and not what you want on your own machine.

Start there. Beyond it, in rough order of likelihood:

## The agent lists no `staves_` tools

Its MCP connections need reloading. In Claude Code, `/mcp` shows the server as pending until you
approve it once for the project.

## "This machine is not connected"

`connect` has not been run here, or the selected file under `~/.staves/connections/` was removed. Run
`npx @staves/cli connect` in the project.

## `connect` sits there waiting

It is waiting for you to approve the request in a browser. `connect` prints a 6-character check
code and the approval URL; open it, check the code matches, choose what the connection may open,
and approve. The credential then arrives in the terminal on its own — there is nothing to copy.
The request expires after ten minutes.

Inside a coding agent, over SSH, or in CI there is no browser to open, so nothing launches. The
printed URL still works from any signed-in browser, including one on another machine.
`npx @staves/cli connect --no-browser` says so explicitly and skips the launch attempt.

If nobody is going to approve it, give a token instead — this is the CI path:

```sh
STAVES_TOKEN=sta_... npx @staves/cli connect
pbpaste | npx @staves/cli connect --token-stdin
```

`--token-stdin` is what makes it read the pipe, and it leaves nothing in your shell history.

## The approval page says the request expired, or was already collected

An approval request lives ten minutes. Run `npx @staves/cli connect` again in the project; a fresh
request opens a fresh page with a fresh check code.

## The check code in the browser is not the one in your terminal

You are looking at somebody else's request, or an older one of your own. **Deny** it and rerun
`npx @staves/cli connect`. Approve only a request whose 6-character code matches the terminal you
just ran it in.

## "This token is not valid"

Only the CI paths use a token at all. The one you supplied was revoked, mistyped, or belongs to
another account. Generate a new one in **Account → Coding agents**, or drop the token and let
browser approval do it: plain `npx @staves/cli connect`.

## "This account does not have an active beta invitation"

The token is fine; the account's invitation was withdrawn.

## "No board named …"

The name given to the agent does not exist. A read tool says so and lists the boards that do,
rather than answering as if that board were empty. Pick one of the listed names; do not have the
agent create a board to satisfy a read.

## The board it opens is not the one you meant

`staves_list` shows each board's title beside its id, so ask for the title rather than the id. A
board the approval page created is named after the project directory.

## "The connection cannot create a board"

The connection is read only, or its lifetime creation allowance is spent. Rerun
`npx @staves/cli connect` and tick **Create a new board for this project**, or raise the allowance
under **Account → Coding agents**. The agent gets the same sentence back from `staves_access`.

## It describes the wrong thing

A repository usually holds several workflows. Name the one you mean — "describe the checkout flow"
— rather than asking it to describe the repository.

## A queued request never runs

Queued means saved, not received. Something has to deliver it:
`npx @staves/cli listen --agent claude --once`. The listener runs in the foreground and takes
assessments only — a conversation request needs your interactive agent, and an implementation
request stays queued too. The listener says so on screen for each one, rather than passing over it
in silence.
