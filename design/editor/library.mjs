import { randomUUID } from 'node:crypto';
import { columns } from '../../dist/derive.js';
import { fold, SCHEMA } from '../../dist/ops.js';

// Fictional design examples: none of these descriptions claim a deployed system.
const definitions = [
  {
    id: 'support-triage', title: 'Help a customer get unstuck', pattern: 'Triage & escalation',
    description: 'A support agent drafts a grounded answer; a specialist owns sensitive cases and unresolved problems.',
    goal: 'The customer understands what to do next and can reach a person when the answer is not enough.',
    roles: [['customer', 'Customer', 'outside'], ['specialist', 'Support specialist', 'person'], ['triage', 'Triage agent', 'agent'], ['answer', 'Answer agent', 'agent'], ['delivery', 'Delivery service', 'system']],
    steps: [
      ['request', 'Explain the problem', 'customer', 'request', ['Describe what happened', 'Include the expected result']],
      ['route', 'Find the right help', 'triage', 'triage', ['Identify the customer’s goal', 'Recognize sensitive or urgent cases']],
      ['draft', 'Prepare a routine answer', 'answer', 'ready-reply', ['Find relevant approved guidance', 'Prepare a sourced answer within the approved support policy']],
      ['approve', 'Resolve the difficult case', 'specialist', 'ready-reply', ['Review the customer request and triage assessment', 'Decide on a response and explain the next step']],
      ['deliver', 'Get the answer delivered', 'delivery', 'delivered', ['Send to the request channel', 'Record delivery or notify the specialist']],
      ['confirm', 'Know what to do next', 'customer', 'feedback', ['Try the suggested next step', 'Ask for more help if still blocked']],
    ],
    inputs: { request: [], route: ['request'], draft: ['triage'], approve: ['triage'], deliver: ['ready-reply'], confirm: ['delivered'] },
    starts: { draft: 'Only when triage identifies a routine request within the approved support policy.', approve: 'Only when triage identifies a sensitive, urgent or uncertain request.', deliver: 'When either the routine answer agent or the specialist produces an answer ready to send for this request. One answer is sufficient; never wait for both branches.' },
    gate: { job: 'route', rule: 'Sensitive, urgent or uncertain requests need a specialist before a reply is sent.', accountable: 'specialist', exits: [['Routine request', 'draft'], ['Sensitive or uncertain', 'approve']] },
    exception: { job: 'deliver', rule: 'The customer must receive the reply.', onFail: 'Keep the request open and notify the support specialist; do not mark it resolved.' },
    question: 'What should happen when the customer says the answer did not solve their problem?',
  },
  {
    id: 'evidence-research', title: 'Turn a question into a defensible answer', pattern: 'Research & synthesis',
    description: 'Two research roles collect and challenge evidence before a human researcher approves the conclusion.',
    goal: 'The requester can make a decision while seeing what is supported, disputed and still unknown.',
    roles: [['requester', 'Decision maker', 'outside'], ['researcher', 'Lead researcher', 'person'], ['finder', 'Evidence agent', 'agent'], ['challenger', 'Challenge agent', 'agent']],
    steps: [
      ['request', 'Frame the decision', 'requester', 'question', ['Name the decision this will inform', 'Set the scope and deadline']],
      ['find', 'Assemble the evidence', 'finder', 'evidence', ['Find primary sources within the agreed scope', 'Record exact passages, dates and gaps']],
      ['challenge', 'Expose weak conclusions', 'challenger', 'challenge', ['Look for conflicting evidence', 'Separate supported claims from assumptions']],
      ['approve', 'Stand behind the answer', 'researcher', 'report', ['Resolve or disclose disagreements', 'Approve the conclusion and its limits']],
      ['decide', 'Make an informed choice', 'requester', 'decision', ['Read the conclusion and uncertainty', 'Request further research when needed']],
    ],
    gate: { job: 'approve', rule: 'Every material claim needs a source or an explicit unknown label.', accountable: 'researcher', exits: [['Evidence sufficient', 'decide'], ['Missing material evidence', 'find']] },
    exception: { job: 'find', rule: 'The evidence includes accessible source passages, not just search snippets.', onFail: 'Record the inaccessible source and leave the claim unresolved.' },
    question: 'How much uncertainty can the decision maker accept before more research is necessary?',
  },
  {
    id: 'document-processing', title: 'Make an invoice ready to pay', pattern: 'Extraction & approval',
    description: 'Agents read and reconcile invoices, with explicit review for discrepancies and a separate payment approval.',
    goal: 'The supplier is paid the right amount, once, with a clear explanation when payment is held.',
    roles: [['supplier', 'Supplier', 'outside'], ['clerk', 'Accounts specialist', 'person'], ['approver', 'Budget owner', 'person'], ['reader', 'Document agent', 'agent'], ['checker', 'Matching agent', 'agent'], ['ledger', 'Payment service', 'system']],
    steps: [
      ['submit', 'Request payment', 'supplier', 'invoice', ['Provide the invoice and purchase reference', 'Give a contact for questions']],
      ['read', 'Make the invoice readable', 'reader', 'details', ['Capture amounts and supplier details with page references', 'Mark unreadable or ambiguous fields']],
      ['match', 'Explain any discrepancy', 'checker', 'match', ['Compare the invoice with the purchase order', 'Check for an earlier payment or duplicate']],
      ['resolve', 'Agree what is owed', 'clerk', 'reconciled', ['Review uncertain fields and mismatches', 'Ask the supplier to clarify disputed amounts']],
      ['approve', 'Authorize the payment', 'approver', 'authorization', ['Confirm the goods or services were received', 'Approve or hold the payment with a reason']],
      ['pay', 'Keep the supplier informed', 'ledger', 'receipt', ['Schedule the authorized amount once', 'Send a receipt or explain a failed payment']],
    ],
    gate: { job: 'approve', rule: 'Only a budget owner can authorize payment; unresolved discrepancies stay on hold.', accountable: 'approver', exits: [['Approved', 'pay'], ['Disputed', 'resolve'], ['Rejected with explanation', 'stop']] },
    exception: { job: 'match', rule: 'A suspected duplicate must never be silently approved.', onFail: 'Hold the invoice for the accounts specialist and link the suspected earlier invoice.' },
    question: 'Who tells the supplier why an invoice is on hold, and how soon should they hear?',
  },
  {
    id: 'software-review', title: 'Ship a change people can trust', pattern: 'Build & independent review',
    description: 'A coding agent and an independent reviewer support a maintainer, with acceptance tied to user outcomes.',
    goal: 'People receive the intended improvement without losing an existing capability or an understandable recovery path.',
    roles: [['designer', 'Workflow designer', 'person'], ['maintainer', 'Maintainer', 'person'], ['coder', 'Coding agent', 'agent'], ['reviewer', 'Review agent', 'agent'], ['checks', 'Build and test service', 'system'], ['user', 'Product user', 'outside']],
    steps: [
      ['define', 'Agree the improvement', 'designer', 'brief', ['Describe the person’s goal and current friction', 'Name acceptance examples and open questions']],
      ['build', 'Make the improvement usable', 'coder', 'change', ['Inspect the current behavior before changing it', 'Implement the change and record unfinished work']],
      ['check', 'Expose broken expectations', 'checks', 'results', ['Exercise acceptance examples and existing behavior', 'Report failures and missing test coverage']],
      ['review', 'Challenge the proposed change', 'reviewer', 'review', ['Compare the change with the human goal', 'Look for failure paths and unsupported claims']],
      ['approve', 'Decide whether to release', 'maintainer', 'release', ['Review evidence, risks and remaining work', 'Approve a release with a recovery plan']],
      ['use', 'Benefit from the change', 'user', 'feedback', ['Complete the improved workflow', 'Report confusion or unexpected behavior']],
    ],
    gate: { job: 'approve', rule: 'Unresolved critical findings block release; a maintainer owns the decision.', accountable: 'maintainer', exits: [['Ready with evidence', 'use'], ['Needs revision', 'build']] },
    exception: { job: 'check', rule: 'Passing tests do not establish that untested human outcomes work.', onFail: 'Mark the missing acceptance evidence and ask the designer or maintainer to review it.' },
    question: 'Which human outcome cannot be established by the automated checks alone?',
  },
];

function previewOf(board) {
  const positions = columns(board);
  const jobs = board.jobs.filter(job => !job.removed && !job.parent);
  const max = Math.max(1, ...jobs.map(job => positions.get(job.id) || 0));
  return board.tracks.filter(track => !track.removed).map(track => ({
    kind: track.kind,
    positions: jobs.filter(job => job.track === track.id).map(job => (positions.get(job.id) || 0) / max).sort((a, b) => a - b),
  }));
}

export const examples = definitions.map(({ id, title, pattern, description, goal, roles, steps }) => ({
  id, title, pattern, description, goal,
  roles: roles.map(([, name, kind]) => ({ name, kind })),
  jobCount: steps.length, taskCount: steps.reduce((sum, step) => sum + step[4].length, 0),
  fictional: true,
  preview: previewOf(fold(exampleOps(id).map((op, index) => ({ seq: index + 1, v: SCHEMA, at: '2026-01-01T00:00:00.000Z', by: 'example', op })))),
}));

export function exampleOps(id, title) {
  const item = definitions.find(example => example.id === id);
  if (!item) throw new Error('Choose an example from the library.');
  const implementation = { state: 'planned', note: 'Fictional example. Adapt this design to your project; no implementation has been inspected.' };
  const provenance = { source: 'human', by: 'Staves example library' };
  const artifactNames = { 'ready-reply': 'Answer ready to send', request: 'Customer request', triage: 'Request assessment', draft: 'Sourced draft answer', approved: 'Reviewed answer', delivered: 'Delivery confirmation', feedback: 'Recipient feedback', question: 'Decision and research scope', evidence: 'Sources and evidence gaps', challenge: 'Disputed claims and findings', report: 'Reviewed research report', decision: 'Decision and rationale', invoice: 'Supplier invoice', details: 'Invoice details with page references', match: 'Matches and discrepancies', reconciled: 'Agreed invoice details', authorization: 'Payment authorization or hold', receipt: 'Payment receipt or failure notice', brief: 'Human outcomes and acceptance examples', change: 'Proposed change and unfinished work', results: 'Test results and missing coverage', review: 'Independent review findings', release: 'Release decision and recovery plan' };
  const ops = [
    { t: 'board', id, title: title || item.title, goal: item.goal, origin: `example:${id}` },
    { t: 'setContext', context: { purpose: item.goal, stance: 'to-be', where: 'drawn', notes: 'Fictional design example. All work is planned, not evidence of a running system.' } },
    ...item.roles.map(([id, name, kind]) => ({ t: 'track', track: { id, name, kind } })),
  ];
  for (let index = 0; index < item.steps.length; index++) {
    const [id, name, track, output, tasks] = item.steps[index];
    const inputs = item.inputs?.[id] ?? (index ? [item.steps[index - 1][3]] : []);
    if (!ops.some(op => op.t === 'artifact' && op.artifact.id === output)) ops.push({ t: 'artifact', artifact: { id: output, name: artifactNames[output] || output, kind: 'record', note: output === 'ready-reply' ? 'One answer per customer request, produced by either the routine answer agent or the support specialist according to the triage decision. The branches are alternatives.' : `Produced by “${name}”; retain supporting evidence and unresolved questions for the recipient.` } });
    const job = { id, name, track, inputs, outputs: [output], outcome: item.goal, beneficiary: item.roles[0][1], doneWhen: [`The recipient can use the ${artifactNames[output]?.toLowerCase() || output} and see any unresolved questions.`], trigger: index ? 'chain' : 'ask', provenance, status: 'draft', implementation };
    if (item.starts?.[id]) { job.trigger = 'event'; job.triggerNote = item.starts[id]; }
    if (id === item.gate.job) Object.assign(job, { gate: { rule: item.gate.rule, accountable: item.gate.accountable }, exits: item.gate.exits.map(([condition, target]) => ({ condition, target })) });
    if (id === item.exception.job) job.checks = [{ rule: item.exception.rule, onFail: item.exception.onFail }];
    ops.push({ t: 'job', job });
    tasks.forEach((name, taskIndex) => ops.push({ t: 'job', job: { id: `${id}-task-${taskIndex + 1}`, parent: id, name, track, inputs: taskIndex === 0 ? [...inputs] : [], outputs: taskIndex === tasks.length - 1 ? [output] : [], provenance, status: 'draft', implementation, outcome: name, beneficiary: item.roles[0][1] } }));
  }
  ops.push({ t: 'ask', question: { id: 'example-open-question', about: item.gate.job, askedBy: 'staves', status: 'raised', text: item.question } });
  return structuredClone(ops);
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

const creations = new Map();

// Save current design only: no event history, proposals, conversations, or base link.
export function templateOps(board, id, title, origin = 'saved-template') {
  const ops = [{ t: 'board', id, title, goal: board.goal, origin }];
  if (board.context) ops.push({ t: 'setContext', context: structuredClone(board.context) });
  for (const track of board.tracks.filter(item => !item.removed)) ops.push({ t: 'track', track: structuredClone(track) });
  for (const artifact of board.artifacts) ops.push({ t: 'artifact', artifact: structuredClone(artifact) });
  for (const source of board.jobs.filter(item => !item.removed)) {
    const job = structuredClone(source);
    delete job.boardRef; delete job.sources; delete job.instructions;
    delete job.implementation; delete job.confirmedFields; delete job.movedFrom;
    job.status = 'draft'; job.provenance = { source: 'human', by: 'Saved template' };
    ops.push({ t: 'job', job });
  }
  for (const region of board.regions.filter(item => !item.removed)) ops.push({ t: 'region', region: structuredClone(region) });
  if (board.perWeek !== undefined) ops.push({ t: 'setVolume', perWeek: board.perWeek });
  if (board.intent) ops.push({ t: 'setIntent', intent: structuredClone(board.intent) });
  return ops;
}

// The one place a board comes into being. The workspace's own new-board form and an approved
// terminal connection append the same opening log, once per id: a repeat while the first append is
// still in flight waits for it rather than writing a second copy.
export async function createBoardLog(store, { id, title, goal = '', source = 'blank', exampleId, templateId }) {
  const ops = source === 'template' ? templateOps(await store.board(templateId), id, title, 'template-copy') : source === 'example' ? exampleOps(exampleId, title) : [
    { t: 'board', id, title, goal, origin: source === 'project' ? 'project' : 'drawn' },
    { t: 'setContext', context: { purpose: goal, where: source === 'project' ? 'code' : 'drawn', stance: source === 'project' ? 'as-is' : 'to-be' } },
  ];
  ops[0].id = id;
  if (goal && ['example', 'template'].includes(source)) { ops[0].goal = goal; const context = ops.find(op => op.t === 'setContext'); if (context) context.context.purpose = goal; else ops.push({ t: 'setContext', context: { purpose: goal } }); }
  const key = `${store.dir}:${id}`;
  if (creations.has(key)) { await creations.get(key); return; }
  const pending = store.append(id, ops, 'human');
  creations.set(key, pending);
  try { await pending; } catch (error) { creations.delete(key); throw error; }
}

export async function workspaceApi(req, res, url, store, prefix = '') {
  if (!['/workspace-api', '/workspace-api/boards', '/workspace-api/templates'].includes(url.pathname)) return false;
  try {
    if (url.pathname === '/workspace-api' && req.method === 'GET') {
      const ids = (await store.list()).filter(id => /^[a-zA-Z0-9_-]+$/.test(id));
      const boards = await Promise.all(ids.map(async id => {
        const [board, entries, touchedAt] = await Promise.all([store.board(id), store.entries(id), store.touchedAt?.(id) ?? null]);
        return { id, touchedAt, title: board.title, goal: board.goal || board.context?.purpose || '', jobs: board.jobs.filter(job => !job.removed && !job.parent).length, roles: board.tracks.filter(track => !track.removed).length, revision: entries.at(-1)?.seq || 0, updatedAt: entries.at(-1)?.at || null, origin: board.origin || null, preview: previewOf(board) };
      }));
      // Order by when each board last changed in this workspace, not by the age of the work it
      // describes. A log replayed in from elsewhere keeps its original timestamps, so sorting on
      // those buries a board that arrived a minute ago underneath everything else.
      boards.sort((a, b) => (b.touchedAt || b.updatedAt || '').localeCompare(a.touchedAt || a.updatedAt || ''));
      send(res, 200, { boards: boards.filter(board => board.origin !== 'saved-template'), templates: boards.filter(board => board.origin === 'saved-template'), examples });
      return true;
    }
    if (!((url.pathname === '/workspace-api/boards' && ['POST', 'DELETE'].includes(req.method)) || (url.pathname === '/workspace-api/templates' && req.method === 'POST'))) { send(res, 405, { error: 'Method not allowed.' }); return true; }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) { send(res, 413, { error: 'The project details are too long.' }); return true; } }
    let input;
    try { input = JSON.parse(raw); } catch { send(res, 400, { error: 'Provide valid project details.' }); return true; }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('board');
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || input?.confirm !== true) { send(res, 400, { error: 'Confirm the board deletion before continuing.' }); return true; }
      const ids = await store.list();
      for (const other of ids.filter(name => name !== id)) {
        // A scenario used to record where it came from with a `base` op; branch() now writes a pinned
        // `baseline` carrying sourceBoard instead. This looked for the old shape only, so it had
        // silently stopped finding anything and boards with live scenarios were deleting cleanly.
        // Both are checked because logs written before the change still say it the old way.
        if ((await store.entries(other)).some(entry =>
          (entry.op.t === 'base' && entry.op.board === id) ||
          (entry.op.t === 'baseline' && entry.op.baseline?.sourceBoard === id))) { send(res, 409, { error: 'A scenario depends on this board. Delete the scenario first.' }); return true; }
      }
      await store.deleteBoard(id);
      creations.delete(`${store.dir}:${id}`);
      send(res, 200, { deleted: id }); return true;
    }
    if (url.pathname === '/workspace-api/templates') {
      if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || typeof input.boardId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.boardId) || typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId)) { send(res, 400, { error: 'Choose a board and name your template.' }); return true; }
      const ids = await store.list();
      const id = `template-${input.requestId}`;
      if (ids.includes(id)) { send(res, 200, { id, title: (await store.board(id)).title }); return true; }
      if (!ids.includes(input.boardId)) { send(res, 404, { error: 'This board is no longer available.' }); return true; }
      const ops = templateOps(await store.board(input.boardId), id, input.title.trim());
      const key = `${store.dir}:${id}`;
      if (creations.has(key)) await creations.get(key);
      else { const pending = store.append(id, ops, 'human'); creations.set(key, pending); try { await pending; } finally { creations.delete(key); } }
      send(res, 201, { id, title: input.title.trim() }); return true;
    }
    if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || !['blank', 'project', 'example', 'template'].includes(input.source) || (input.goal !== undefined && (typeof input.goal !== 'string' || input.goal.length > 2000))) {
      send(res, 400, { error: 'Add a project name (up to 160 characters) and choose a starting point.' }); return true;
    }
    if (input.source === 'example' && !examples.some(example => example.id === input.exampleId)) { send(res, 400, { error: 'Choose an example from the library.' }); return true; }
    if (input.source === 'template' && (typeof input.templateId !== 'string' || !(await store.list()).includes(input.templateId) || (await store.board(input.templateId)).origin !== 'saved-template')) { send(res, 404, { error: 'This saved template is no longer available.' }); return true; }
    if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId))) { send(res, 400, { error: 'Invalid creation request. Reopen setup and try again.' }); return true; }
    if(input.source==='blank'&&input.startMode!=='manual'&&!input.goal?.trim()){send(res,400,{error:'Describe who this workflow is for and the result they need.'});return true;}
    const title = input.title.trim();
    const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'workflow';
    let id;
    if (input.requestId) id = `workflow-${input.requestId}`;
    else do { id = `${slug}-${randomUUID()}`; } while ((await store.list()).includes(id));
    const creationKey = `${store.dir}:${id}`;
    if (creations.has(creationKey)) await creations.get(creationKey);
    if (input.requestId && (await store.list()).includes(id)) {
      const existing = await store.board(id);
      send(res, 200, { id, title: existing.title, source: input.source, url: `${prefix}/?board=${encodeURIComponent(id)}`, next: input.source === 'project' ? 'connect' : input.source === 'blank'&&input.startMode!=='manual' ? 'interview' : 'canvas' }); return true;
    }
    await createBoardLog(store, { id, title, goal: input.goal?.trim() || '', source: input.source, exampleId: input.exampleId, templateId: input.templateId });
    send(res, 201, { id, title, source: input.source, url: `${prefix}/?board=${encodeURIComponent(id)}`, next: input.source === 'project' ? 'connect' : input.source === 'blank'&&input.startMode!=='manual' ? 'interview' : 'canvas' });
    return true;
  } catch (error) {
    send(res, 500, { error: 'Could not open the workspace. Please try again.' });
    return true;
  }
}
