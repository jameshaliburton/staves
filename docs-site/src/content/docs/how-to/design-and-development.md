---
title: Connect design to Git and development
description: Keep design alternatives, assessments and implementation references connected to the repository's existing workflow.
---

Staves versions intended work. Git versions code. A design alternative can exist before any code branch, and several branches or pull requests may implement one design. Accepting a design does not merge code or authorize deployment.

## Assess a design with your existing agent

On the board, choose **Coding agent** in the header, select the work, and **Copy to coding agent**. That saves the design scope and revision as a request on the board and puts the prompt on your clipboard for your usual coding agent. Tell the agent what you want — assess feasibility, compare the code with the spec, or build. Building is a separate step: the agent opens its own implementation request on the same board before it changes code.

The agent reads the original packet with `staves_assessment`, inspects the repository, and returns scoped findings with `staves_assessment_return`. Reports retain their references, limitations and original request. A relevant design change or withdrawal of captured evidence makes the result require reconciliation.

## Capture the actual checkout

Ask the agent to use `staves_git_context` in the project directory. It reads the sanitized repository origin, branch or detached HEAD, full commit ID, worktree status, tracked/untracked dirty counts and optionally the resolved base commit and ancestry. It does not access the network, change files or create a branch.

Then use `staves_development_link` to associate the snapshot with the board and, when relevant, the saved request ID. These are immutable reports: add a new link after the checkout changes. A dirty checkout explicitly means HEAD does not contain all the work being assessed.

The CLI offers the same bridge:

```sh
# Inspect the checkout without writing a Staves record
staves git --repo /path/to/project --base main

# Link it to an existing design request
staves git onboarding --repo /path/to/project --base main --request REQUEST_ID

# Use an existing hosted connection
staves git onboarding --repo /path/to/project --request REQUEST_ID --hosted --connection CONNECTION_ID
```

Use the project's normal branch, worktree, PR and test conventions. Staves does not create a parallel code workflow. Local repositories without a network origin remain usable; their origin is recorded as unavailable, and filesystem paths are not copied into the record.

## Return implementation references

After explicitly requested implementation, return the affected jobs, code/commit/PR references, scoped test results and remaining limitations. A reported passing test requires a reference. Reported implementation requires a code or PR reference and an implementation request.

PR links can be included in development records. Open/closed/merged states require the time they were checked; a reported merge also requires its full merge commit. Staves labels these as reports and does not independently query the Git provider. A branch name alone never proves a PR was merged. No remote webhook or background PR synchronization is configured by these tools.

## Read the relationship

Choose **History** in the bottom taskbar. The view shows accessible source designs and alternatives, their pinned baselines, assessment requests, case walkthroughs, intended-design acceptance and reported Git/PR references. Staves revision numbers and Git commit IDs remain distinct.

Use `staves_design_history` for the same view through the coding agent. Scoped connections only expose accessible boards; an unavailable parent remains explicitly unavailable.
