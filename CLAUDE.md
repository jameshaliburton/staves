## Open and closed — read BOUNDARY.md first

This repo is open core. `BOUNDARY.md` says which side every path is on; `OPEN-CORE.md` says why.
Before adding, moving or importing a file:

- Place it with the table in `BOUNDARY.md`. Closed code (the gateway, database, staves.io pages,
  backoffice and deployment) lives in the private `staves-cloud` repository, never here. Everything
  that one person can use alone with their own agent or key is open.
- Open code never imports closed code and never calls staves.io unless the person connects.
  If hosted behaviour needs a hook, add a small interface in open code instead.
- Never write secrets, tokens, owner emails or tester names into tracked files.
- Changes to what a board *is* start in `spec/` (the Staves format), with a changelog line.
- Run `npm run check:boundary` after changes. It must pass.


<!-- staves:generated:start -->
## Staves

Boards are saved to the connected Staves account. This project keeps only a connection reference, in .staves/config.json on this machine; it does not store board data in .staves/.

Boards: https://staves.io/workspace
Guide: https://staves.io/docs/connect/


FIRST USE: call staves_access, then staves_list for accessible board titles. Respect the supplied board, revision and request context; do not open every board. After verifying access, show a concise bullet list of what we can do with this board:
- Build a working prototype from the spec.
- Discuss or refine the spec.
- Create and connect a new project, or connect an existing codebase.
- Assess feasibility and identify gaps.
- Compare the implementation with the spec.
- Implement selected jobs or changes.
- Walk through concrete test scenarios.
- Review the workflow from each role.
- Record findings and build progress back on the board.
Tailor the bullets to the board and granted access. If the person has already chosen an action, proceed with it without asking again. Verify native access with an actual MCP tool call; distinguish CLI access from a loaded native connection. The developer need never have opened the web editor.
"Connect Staves" means verify access and explain readiness, not create a graph. Read-only credentials and an exhausted creation allowance still permit their granted read operations. When staves_access returns nextStep, repeat its sentence to the person as the way forward; it is not a dead end. Never create an unrequested survey. Scope an unnamed workflow in conversation, then check allowance before creating anything.
A board name you were given may not exist: staves_brief on an unknown board fails with the list of boards; do not create a board to satisfy a read.
For a named existing board, read staves_brief and staves_requests. Read the pinned request before claiming it; use staves_request_status to claim and report running, completed or failed. Discussion completion requires an outcome note; assessments require a saved report before completion. A queued request does not mean a running agent has received it. Never claim background execution or automatic wake-up without a supported runtime.
Interview through staves_interview using your current model. To map a system: read the code first, then call staves_help, then follow its protocol. Save coherent batches and return the exact board URL. Use proposals for confirmed work. Ask about uncertainty rather than inventing evidence.
For assessment or implementation, preserve the requested board revision and scope. When the person chooses to build, create a scoped staves_assess request with intent implement on the same board. Retain that board as the spec, link the actual project directory, reread it before changes, and report results after changes; never create a duplicate board or promise automatic background rebuilding. Assessment does not authorize code changes. Return real source and test references through staves_assessment_return, and Git context through staves_git_context/staves_development_link. Distinguish proposed tests, executed tests, merged code and deployment. Never impersonate human confirmation.
Langfuse is optional. Continue modeling without it; say execution evidence is unavailable. When relevant, verify access and discover observations before importing explicitly mapped evidence. Credentials belong in the MCP server launch environment, never tool arguments or conversation. A trace is evidence of execution, not proof of the intended outcome. To see how a workflow actually ran, staves_langfuse_runs; it measures, it does not approve.


Use immediately: `npx -y @staves/cli@0.44.1 tool staves_interview --hosted --input '{}'`. Every MCP tool is available through this CLI with the same JSON arguments.
Detailed modelling guidance: .claude/skills/staves/SKILL.md (Claude Code) or .agents/skills/staves/SKILL.md (Codex and others). Read it before your first Staves write.
<!-- staves:generated:end -->
