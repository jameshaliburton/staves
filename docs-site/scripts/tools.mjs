// The tool reference is generated from the server itself.
//
//   npm run tools            rewrite the reference page
//   npm run tools -- --check fail if the page no longer matches the server
//
// Hand-written API documentation drifts the moment a parameter is added, and nobody notices because
// nothing fails. This reads the registered tools, so the page is wrong only if the code is.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const page = path.resolve(here, '../src/content/docs/reference/tools.md');
const check = process.argv.includes('--check');

const { buildServer } = await import(path.join(repo, 'dist/mcp.js'));
const { Store } = await import(path.join(repo, 'dist/store.js'));
const server = buildServer(new Store('/tmp/staves-docs-none'), 'docs', 'https://staves.io');

/** Grouped by the question someone has when they reach for one, not alphabetically. */
const GROUPS = [
  ['Finding your way', 'Start here when you do not know what exists yet.',
    ['staves_access', 'staves_help', 'staves_list', 'staves_survey', 'staves_board', 'staves_brief']],
  ['Interviewing in your agent', 'Talk through the work and save drafts without a separate model or browser interview.',
    ['staves_interview', 'staves_interview_record', 'staves_interview_progress']],
  ['Domain vocabulary', 'Read stable work concepts and propose domain definitions with explicit implementation associations.',
    ['staves_vocabulary', 'staves_vocabulary_propose']],
  ['Langfuse execution evidence', 'Connect a project, instrument job identifiers, and attach explicitly mapped observations.',
    ['staves_langfuse_connect', 'staves_langfuse_instrumentation', 'staves_langfuse_evidence', 'staves_langfuse_refresh', 'staves_langfuse_retract']],
  ['Drawing the work', 'Building a board from what the code actually does.',
    ['staves_start', 'staves_track', 'staves_artifact', 'staves_describe', 'staves_describe_many',
     'staves_split', 'staves_collect', 'staves_handover', 'staves_cut', 'staves_patch',
     'staves_words', 'staves_intent', 'staves_volume']],
  ['Questions and discussion', 'What the code cannot tell you, and what the person said about it.',
    ['staves_ask', 'staves_answer', 'staves_comment', 'staves_comments']],
  ['Reviewing it', 'Finding what is missing, coupled, jargon, or no longer true.',
    ['staves_review', 'staves_reflect', 'staves_issues', 'staves_hats', 'staves_stale', 'staves_focus']],
  ['Changing it safely', 'Proposing rather than overwriting, and trying an alternative.',
    ['staves_propose', 'staves_scenario']],
  ['Connecting development', 'Link design requests with existing local Git and PR workflows.',
    ['staves_design_history', 'staves_git_context', 'staves_development_link']],
  ['Assessing a design', 'Walk through explicit cases and exchange snapshot-bound requests and agent reports.',
    ['staves_impact', 'staves_walkthrough', 'staves_walkthrough_runs', 'staves_assess', 'staves_assessment', 'staves_assessment_return']],
  ['Taking it elsewhere', 'Getting the description out in a shape something else can use.',
    ['staves_export']],
];

const tools = Object.entries(server._registeredTools || {}).map(([name, t]) => ({
  name,
  description: (t.description || '').trim(),
  args: Object.entries(t.inputSchema?.shape || {}).map(([key, value]) => ({
    name: key,
    optional: !!value.isOptional?.(),
    describe: (value.description || value._def?.description || '').trim(),
  })),
}));
const byName = new Map(tools.map(t => [t.name, t]));

const escape = s => s.replace(/\|/g, '\\|').replace(/</g, '&lt;');
const lines = [
  '---',
  'title: "Every tool, and when to reach for it"',
  'description: "The complete Staves MCP surface, generated from the server: what each tool does and what it takes."',
  '---',
  '',
  'Your coding agent has these once it is connected. You will rarely name one — saying *run staves*',
  'or *what has drifted* is enough — but this is what is behind those requests, and what to ask for',
  'when you want something specific.',
  '',
  ':::note',
  'This page is generated from the running server. Every argument a tool takes is listed here.',
  ':::',
  '',
];

// Every tool is written the same way, grouped or not: an ungrouped tool with arguments used to
// print none, which made the page claim more than it showed.
function emit(tool) {
  lines.push(`### \`${tool.name}\``, '', tool.description, '');
  if (!tool.args.length) { lines.push('Takes nothing.', ''); return; }
  lines.push('| Argument | | What it is |', '| --- | --- | --- |');
  for (const a of tool.args) {
    lines.push(`| \`${a.name}\` | ${a.optional ? 'optional' : '**required**'} | ${escape(a.describe) || '—'} |`);
  }
  lines.push('');
}

const seen = new Set();
for (const [title, blurb, names] of GROUPS) {
  lines.push(`## ${title}`, '', blurb, '');
  for (const name of names) {
    const tool = byName.get(name);
    if (!tool) continue;
    seen.add(name);
    emit(tool);
  }
}

const leftover = tools.filter(t => !seen.has(t.name));
if (leftover.length) {
  lines.push('## Everything else', '');
  for (const tool of leftover) emit(tool);
}

lines.push('---', '',
  `*${tools.length} tools. Generated from the server — run \`npm run tools\` in \`docs-site\` after changing them.*`, '');

const next = lines.join('\n');
if (check) {
  const current = existsSync(page) ? readFileSync(page, 'utf8') : '';
  if (current !== next) {
    console.error('The tool reference no longer matches the server.\n\nRun `npm run tools` in docs-site and commit the result.');
    process.exit(1);
  }
  console.log(`tool reference: ${tools.length} tools, still matching the server`);
} else {
  writeFileSync(page, next);
  console.log(`tool reference written: ${tools.length} tools across ${GROUPS.length} groups` +
    (leftover.length ? `, ${leftover.length} ungrouped` : ''));
}
