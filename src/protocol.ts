export const HUMAN_READABLE_FLOW = `Human-readable flow is the first deliverable. Before detailing tasks, draw an end-to-end outline a collaborator can follow without opening every job. Keep consequential boundaries visible at the top level: a first usable result, a durable save, independent background work, publication, human review, waiting, recovery, continuation or settlement, and return through history or notifications when relevant. Choose only boundaries supported by the workflow; this is not a mandatory list of invented steps.

A shared performer does not imply a single job. Reuse a track for the same responsible performer across multiple visible jobs. Separate roles only when responsibility or independent execution genuinely differs; do not invent agents to fill lanes. Name the beneficiary as a role; put what they need in the outcome.

Keep decisions that change the route visible with named conditions and target jobs. Show waits, failures and bounded loops where they change the person's experience. Put retrieval mechanics and detailed checks inside jobs, but never hide the only explanation of a consequential handoff or branch in nested tasks or prose. Inputs and outputs describe data; decision exits describe routes. Neither substitutes for the other.

Before reporting ready, inspect the rendered board when browser access is available, at its normal overview and an expanded job. Walk one ordinary case and one interrupted or returning case through the visible jobs. Check that another person can follow the sequence, branches and responsibilities without opening every card. If visual inspection is unavailable, report that limit and review the top-level structure explicitly. A task count or a clean structural review is not proof of readability.

Grouping is optional and subordinate to this reader test. staves_cut changes the board; it is not a required finishing step. Do not apply it to an already purposeful outline merely because machinery lies between human touchpoints. Inspect proposed groups first, preserve consequential boundaries, and use proposals for confirmed work.`;

export const PROTOCOL = `How to describe a system to staves — as the work people do, not as what the code does.

${HUMAN_READABLE_FLOW}

Before writing, call staves_access to understand the connection's board access and creation allowance. Scope the workflow in conversation. Reuse the requested existing board; only create boards within the allowance. Do not create a survey board by default, because it consumes an allowance before the useful board exists.

For an interview or new idea without code, use staves_interview instead of the code-reading sequence below. Conduct the interview yourself using the current agent model. Save actual reported words with staves_interview_record, then draw draft performers, artifacts and jobs after meaningful answers. Keep inference separate and planned behavior planned. Send the exact board URL as soon as the first board is saved, and again at pause or completion. Record working, partial or ready for human review with staves_interview_progress. Never claim human confirmation or implemented behavior merely because you recorded an answer.

For a code-backed description, the order matters more than the rules. Code narrates itself in execution order, and if you follow it you will produce a list of computer tasks. Do not. Start from the outside and walk in.

1. Who is outside, and what do they want? Start with the people or parties named in the request, then inspect code and documentation to identify who asks, waits or receives: a customer, a requester, a reviewer, a regulator, a colleague. Treat inferred roles as provisional; do not invent a person to fill a required category. Say, where known, what each has when it has gone well. That sentence is the goal, and every job you describe must sit on the path to it.

2. Tracks (staves_track): those outside parties; then every person inside by role; then every agent (which model or prompt); then every system that acts on its own (a scheduler, a mailer, a store). A system is a performer only if it starts work by itself; otherwise it is a tool inside someone's job.

3. Now read the code: routes, prompts, cron and queue config, migrations, templates, every place a person types, chooses, approves or is emailed. You are looking for handoffs — moments where something changes hands between performers — not for functions.

4. Jobs (staves_describe), from the outside in. Name a job by what a person has when it is done, in three to five words: "Admit the claim", "Find the owner", "Deliver the answer". The test: someone is waiting on it, and they are a person or an outside party, never a system. A step may remain a visible job when it changes the result, responsibility, availability or route for the ultimate human beneficiary, even if its immediate recipient is another system. Pure implementation mechanics belong inside jobs. Describe the human touchpoints first, then the jobs between them, then the machinery as tasks inside those jobs (parent). Words that mean you are describing code, not work: run, call, handle, process, invoke, fetch, poll, worker, queue, job row, payload, token, webhook, endpoint, cron, cache. Keep them in the rationale or in sources, never in the name.

5. For every job: which files you read (sources); what starts it — something arrives, the previous job ends, a schedule, a person gets to it; what it takes and produces (artifacts — handoffs are drawn from these); what is different when it is done; who is waiting on it and what they do with it; what you would check. If the code decides something that determines whether a person gets what they wanted, that is a gate: the rule in words, and who answers for it — a person's track, or a rule with a named owner. Every exit gets a target; every loop gets a limit and a then-what.

6. Tasks, at the granularity a person uses. The standard is the stranger test: a competent stranger could do the task by hand from your description alone and get the same result, including the same failures. Every task answers seven questions — what arrives, and in what form; what you open, and how you get to it; what you look at — which part, how much, how far in; what you are looking for; what you do with it; when you stop, and the limit on trying; what you do when it isn't there, is ambiguous, or disagrees. The third and seventh are where work goes wrong silently. Split every agent's job into tasks (staves_split, then staves_describe each with parent) and answer the seven for each.

7. Every tool, source or system a task touches gets four facts: what goes in; what comes back — its shape, portion, size, freshness, verbatim or summarised; what it does not return; what happens when it fails. Put the second and third in does and limits. "Unknown" is a valid value; a missing one is a finding. The tell: a task that is a verb and a noun — "search X", "read Y", "process Z" — is code narrating itself; each such verb hides a coverage decision someone made once and nobody wrote down. Read staves://granularity for one example per kind of work.

8. Time, when the code shows it: minutes per instance, instances per week.

9. Record implementation separately: unknown, planned, in-progress or implemented, with a note explaining the evidence and what remains unfinished. Missing means unknown. A confirmed description does not prove implementation. Keep planned work visible as ordinary jobs, not ghost jobs. Where the evidence does not say, say unknown and use staves_ask. Do not infer, do not smooth over, do not invent a person.

10. Review the visible journey before grouping. Use staves_cut only when merging implementation mechanics improves readability without hiding consequential boundaries. It mutates the board; skip it when the outline already expresses the intended work. Preserve confirmed descriptions through proposals.

11. Tell the person where the board is. It draws itself as you go. When they comment on the board, staves_comments lists what awaits your reply: answer each in place — say why it is or isn't a good idea, what is missing, what you would need — and propose a change with staves_propose when the comment calls for one.

The reader test, which outranks every rule above: the person who does this work today, reading the name and the outcome, would say "yes, that is my job" in their own words. If they would ask what a word means, it is the wrong word. Use the vocabulary of the goal, the outside parties and the artifacts; never the vocabulary of the system.

Bad → good, so you recognise it (job names):
  "Run the worker"                 → "Find the owner" (task inside: "Claim the next queued lookup")
  "handleSignup()"                 → "Create the account"
  "Drain the report queue"         → "Deliver the report" (task inside: "Send or hold")
  "Poll the job status"            → not a job; a task inside "Show the requester where it stands"
  "Write the ledger row"           → not a job; the artifact "delivery ledger" produced by "Deliver the report"
`;

/** Names that describe code, not work: a word list (any case) and a shape check (camelCase, parens, underscores, file extensions). */
const CODE_WORDS = /\b(run|call|invoke|execute|handle|process|trigger|fetch|post|put|delete|query|select|insert|dispatch|emit|poll|spawn|sync|parse|serialize|deserialize|validate|persist|drain|enqueue|dequeue|worker|queue|payload|token|webhook|endpoint|cron|cache|handler|controller|middleware|lambda|function|method|api|db|database|json|http)\b/i;
const CODE_SHAPE = /\(\)|[a-z][A-Z]|_|\.(ts|js|py|sql|tsx|go|rb)$/;
export const CODE_NAME = { test: (s: string) => CODE_WORDS.test(s) || CODE_SHAPE.test(s) };

/** Beneficiaries must be people or outside parties. */
export const MACHINE_BENEFICIARY = /\b(system|worker|queue|scheduler|database|db|cron|api|server|service|pipeline|cache|store|the code|the engine|downstream|next step|the job)\b/i;

export const GRANULARITY = `Granularity: one example per kind of work. The shape matters, not the platform.

Lookup. Not "search the registry." → "Type the legal name into the registry's search box. Take the first result whose country matches. If none, retry without the suffix. If still none, stop and mark unknown. It returns name, number, status — not officers, not filing history."

Reading. Not "read the annual report." → "Open the PDF. Search for 'subsidiaries'. Read that section only — two or three pages of two hundred. Copy every entity name with its percentage. If there is no such section, check the notes to the accounts; if nothing, stop."

Extraction. Not "extract the owner." → "From the lead paragraph, take the entity named after 'owned by' or 'subsidiary of'. If two are named, take both and flag it. If neither phrase appears, nothing is extracted."

Comparison and judgment. Not "reconcile sources." → "Two sources name different parents. The one with a date wins; if both are dated, the newer; if neither, keep both and mark unresolved. Never drop a source silently."

Classification. Not "triage the ticket." → "Read the first message only. If it mentions a payment, billing; if an error code, technical; otherwise general. When unsure, general — and say so."

Drafting. Not "write the memo." → "From the sourced claims only, in the template. Every claim carries its link. Nothing from memory. Dates only if they appear in a source."

Sending and waiting. Not "send the report." → "To the address on the request, via the mail provider. Before sending: a person has read it, and no report has gone to this address today. If it bounces, nobody is told — that is a gap."

A system call, generic. Not "call the API." → "Returns the first ten results as snippets, not pages; cached for a day; truncated at four thousand characters; no second page is fetched; a timeout returns nothing and is not retried."

For every tool: what goes in · what comes back (shape, portion, size, freshness, verbatim or summarised) · what it does not return · what happens when it fails.`;


/** Words the person who does the work would not say: technical and operational vocabulary (any case), acronyms, casing. */
const JARGON_WORDS = /\b(ingest|ingestion|normali[sz]e|normali[sz]ation|orchestrat\w*|pipeline|payload|schema|endpoint|instance|runtime|resolve|resolution|dedup\w*|hydrate|serialize|parse|persist|provision|deploy|config\w*|integrat\w*|sync|async|batch job|cron|webhook|callback|lambda|microservice|backend|frontend|middleware|handler|worker|queue|cache|token|session|auth\w*|oauth|api|sdk|json|xml|csv|sql|db|uuid|guid|etl|crud|http|url|regex|boolean|null|enum|metadata|entity|artifact|object|node|edge|graph|vector|embedding|inference|prompt|llm|model call|tokeniz\w*|rate.?limit\w*|retry|timeout|idempoten\w*|lineage|upstream|downstream|dispatch|emit|trigger|invoke|execute)\b/i;
const JARGON_SHAPE = /[a-z]+[A-Z][a-z]+|_/;
export const JARGON = { exec: (s: string): string | null => (s.match(JARGON_WORDS) ?? s.match(JARGON_SHAPE))?.[0] ?? null };
