---
title: "Start with one human outcome"
description: "Choose a workflow small enough to understand together."
---
Start with the person waiting for a result. “Help a customer resolve a disputed charge” gives the board a clearer boundary than “map the backend”.

- **Existing project:** ask your coding agent to inspect one workflow and describe it through Staves MCP.
- **New idea:** name the outcome, add the people involved, then sketch the jobs or talk them through.
- **Example:** use a fictional workflow as a starting point. Its roles and decisions are suggestions to adapt.

You can start while the implementation is unfinished. Keep unknowns visible instead of filling them with guesses.

## Choose where to work

**New board → Work here** keeps the browser interview and the manual canvas available. **New board → Use an example** starts from a complete fictional workflow instead.

**New board → Use my coding agent** prepares a single-use connection request. No board title or provider key is required. Choose an existing project, a new idea, or an interview conducted entirely in the agent. The default allows one new board without access to your other boards.

Copy the request and paste it into your coding agent's chat. It connects itself, saves the graph as you talk and gives you the board's exact link. You can open the board whenever you want; opening it is optional for continuing the conversation. Planned work stays planned, and recorded answers stay separate from the agent's interpretation. [Your first session](/docs/first-session/) walks through it step by step.

Already have a board? **Coding agent** in the board header picks it back up in an agent that is already connected. **Board options → Connect a coding agent → Connect another agent** grants a new agent access to that board only, without permission to create others. Manage access and creation allowances under **Account → Coding agents**.

## Or start from the project

You do not have to begin in the browser. Run `npx @staves/cli connect` in the project directory and the approval page offers a new board named after that directory, ticked when the account has none. The board is created before access is granted, and the terminal comes back with its link. See [Bring in a coding agent](/docs/connect/).
