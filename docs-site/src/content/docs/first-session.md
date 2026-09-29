---
title: "Your first session"
description: "From the invitation to a first board drawn by your coding agent, and what to expect at each step."
---

This is the whole path for a beta tester, in the order you will meet it. Plan on fifteen minutes.

**You need:** your invitation email, a desktop browser, Node.js 20 or later, and a coding agent you
already use — Claude Code, Codex, Gemini CLI or Cursor. No AI provider key: your agent is the model.

## 1. Sign in

Go to [staves.io/beta/access](https://staves.io/beta/access) and enter the address that was invited.
You get a single-use sign-in link by email; there is no password. An address without an invitation
is refused with *This account does not have an active beta invitation* — ask us, rather than trying
another address.

You land in your workspace. An empty workspace is the normal starting state.

## 2. Make a board with your agent

1. Choose **New board → Use my coding agent**.
2. Pick where you are starting: **An existing project**, a new idea, or **Interview me in my coding
   agent** (no repository needed). Add a line of starting context if you like — name the one
   workflow you mean, such as *how a disputed charge gets resolved*.
3. **Prepare agent handoff**, then **Copy agent setup and request**.
4. Open your coding agent **in the project directory** and paste it into the chat.

The copied text carries a single-use connection code that expires after ten minutes. If it expires,
prepare a new handoff; nothing was granted. The connection it makes can create one board and cannot
see your other boards.

Prefer the terminal? `npx @staves/cli connect` in the project directory does the same thing with a
browser approval. See [Bring in a coding agent](/docs/connect/).

## 3. Let the agent connect itself

The agent runs `npx @staves/cli connect` itself. That registers Staves for Claude Code, Codex, Gemini
CLI and Cursor in the project, and writes a short managed block into `CLAUDE.md`, `AGENTS.md` and
`GEMINI.md`. It does not upload your repository.

Your client then has to load the new tools. This is the one step the agent cannot do for you:

- **Claude Code:** open `/mcp` and approve or reconnect Staves.
- **Codex:** trust the project, restart the MCP connection or session, then check `/mcp`.
- **Gemini CLI:** `/mcp reload`.
- **Cursor:** enable Staves in MCP settings.

The agent should tell you which applies. Until the tools load, it can keep working through the CLI
(`npx @staves/cli tool …`) and should say that it is doing so. Access is proven when it calls
`staves_brief` on your board and reads it back — not when a config file exists or `doctor` passes.

## 4. What you should see

- A short list of what the agent can do with the board: describe the code, interview you, assess
  gaps, test scenarios, review as each role.
- **The board's link**, as soon as the board exists. Open it; jobs arrive in batches while you talk.
- **Questions**, where the code cannot tell the agent something. An open question is the board working
  as intended, not a failure. Answer the ones you can.

The first pass is a draft for you to challenge. Anything the agent inferred about people is marked as
its inference until someone confirms it.

## 5. Come back to it

On any board, **Coding agent** in the header prepares a scoped request: the whole workflow or the jobs
you choose, plus what you want to do next. **Copy to coding agent**, paste it into your project's chat,
and the dialog shows **Received by** the agent once it picks the request up.

If a different project or agent needs this board, use **Board options → Connect a coding agent →
Connect another agent**. That connection can read and contribute to this board only.

To take the board somewhere else — a brief, a drawing, the data — use **Board options → Export…**.
See [Share and hand off](/docs/handoff/).

## If something is off

Run `npx @staves/cli doctor` in the project. It names what is registered, what is stale and the
command that fixes each line. The common cases are in [When it does not work](/docs/troubleshooting/).

## Tell us

Every hosted board has a **Feedback** button. Use it for anything: a wrong word on the board, a step
above that did not match what you saw, a moment you did not know what to do next. The last one is the
most useful to us.

What we keep and who handles it is in [Your data in the beta](/docs/beta-data/).
