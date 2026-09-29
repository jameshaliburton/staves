import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { handoff, connectionBlock } from '../handoff.js';
import { workflowExport } from '../export.js';

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-17T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const board = fold(entries([
  { t: 'board', id: 'b', title: 'Gym platform', goal: 'Tailor training week by week' },
  { t: 'track', track: { id: 'p', name: 'Platform', kind: 'system' } },
  { t: 'job', job: { id: 'menu', name: 'Choose a base program', track: 'p', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } },
] as Op[]));

const facts = { board: 'gym', dir: '/Users/j/projects/gym', url: 'http://127.0.0.1:4391/?board=gym', connected: [] as string[] };

test('with nothing connected, the agent is told to connect itself — not to ask me to', () => {
  const h = handoff(board, facts);
  assert.equal(h.needsSetup, true);
  assert.match(h.prompt, /run it yourself rather than asking me to/);
  assert.match(h.prompt, /npx @staves\/cli init/);
  assert.match(h.prompt, /npx @staves\/cli doctor/);
  assert.match(h.prompt, /cd '\/Users\/j\/projects\/gym'/, 'it has to stand in the right project');
});

test('the prompt says which board, out of all of them, and where it lives', () => {
  const { prompt } = handoff(board, facts);
  assert.match(prompt, /id:\s+gym/);
  assert.match(prompt, /\/Users\/j\/projects\/gym\/\.staves\/gym\.jsonl/, 'a local agent needs the log, not just a URL');
  assert.match(prompt, /page:\s+http:\/\/127\.0\.0\.1:4391/);
});

test('presence avoids redundant setup only after the receiving session verifies access', () => {
  const h = handoff(board, { ...facts, connected: ['Claude Code'] });
  assert.equal(h.needsSetup, false);
  assert.match(h.prompt, /ALREADY CONNECTED: Claude Code/);
  assert.match(h.prompt, /If this session can read the board, skip setup/);
  assert.match(h.prompt, /cli init/, 'a different receiving agent still needs setup instructions');
});

test('a hosted workspace connects the hosted way', () => {
  const h = handoff(board, { ...facts, hosted: true });
  assert.match(h.prompt, /npx @staves\/cli connect/);
  assert.ok(!/cli init/.test(h.prompt));
});

test('the scope names the job, so the agent does not re-scope the conversation', () => {
  const { prompt } = handoff(board, { ...facts, scope: 'menu' });
  assert.match(prompt, /scope:\s+menu \(Choose a base program\)/);
  assert.match(handoff(board, { ...facts, scope: 'board' }).prompt, /the whole workflow/);
});

test('an unset intention asks rather than inventing one', () => {
  assert.match(handoff(board, facts).prompt, /Not set — ask me what I want to work on/);
  assert.match(handoff(board, { ...facts, intention: 'work out where the agent should argue' }).prompt, /work out where the agent should argue/);
});

test('an unsent draft travels, and an empty one does not leave an empty heading', () => {
  assert.match(handoff(board, { ...facts, draft: 'the menu needs the profile first' }).prompt, /PART WAY THROUGH TYPING\n\s+the menu needs the profile first/);
  assert.ok(!/PART WAY THROUGH/.test(handoff(board, { ...facts, draft: '   ' }).prompt));
});

test('it says plainly what the handoff does not authorize', () => {
  const { prompt } = handoff(board, facts);
  assert.match(prompt, /Not writing application code, not running migrations, not deploying/);
  assert.match(prompt, /If you cannot reach the board, say so — do not describe it from this prompt/,
    'a prompt full of board facts is exactly what an agent would otherwise paraphrase back');
});

test('the everyday commands name this board, so none of them need editing', () => {
  const { commands } = handoff(board, { ...facts, connected: ['Codex'] });
  assert.ok(commands.every(c => c.what && c.label));
  assert.ok(commands.filter(c => /--board/.test(c.command)).every(c => /--board gym/.test(c.command)));
  assert.match(commands.find(c => /Reconnect/.test(c.label))!.command, /cli init/);
  assert.match(handoff(board, { ...facts, hosted: true }).commands.find(c => /Reconnect/.test(c.label))!.command, /cli connect/);
});

/* ---- the other door: Share & hand off ---- */

test('an exported prompt can reach the board, not only describe it', async () => {
  const { exportPrompt } = await import('../export.js');
  const { connectionBlock } = await import('../handoff.js');
  const connection = connectionBlock({ board: 'gym', dir: '/Users/j/projects/gym', connected: [] });
  const packet = workflowExport(board, 3, { purpose: 'feasibility', unknowns: 'ask-first' });

  const withIt = exportPrompt(packet, connection);
  assert.match(withIt, /^FIRST, CONNECT/, 'how to reach it comes before what to do with it');
  assert.match(withIt, /npx @staves\/cli init/);
  assert.match(withIt, /id:\s+gym/);
  assert.match(withIt, /Assess feasibility/, 'and the purpose survives');
  assert.match(withIt, /If you cannot reach the board, say so and stop/,
    'an agent holding a workflow it cannot write to can only describe it back at you');

  // a caller with nothing to say about the connection still gets a usable prompt
  assert.ok(!/FIRST, CONNECT/.test(exportPrompt(packet)));
});

test('both doors use one connection block, so they cannot drift apart', async () => {
  const { connectionBlock, handoff } = await import('../handoff.js');
  const f = { board: 'gym', dir: '/Users/j/projects/gym', connected: [] as string[] };
  assert.ok(handoff(board, f).prompt.includes(connectionBlock(f)), 'the conversation handoff embeds it verbatim');
});


test('hosted setup explains browser approval and never emits a placeholder shell command', () => {
  const prompt = connectionBlock({ board: 'gym', hosted: true, connected: [] });
  assert.doesNotMatch(prompt, /cd </);
  assert.match(prompt, /approval URL/);
  assert.match(prompt, /staves_brief/);
});

test('local setup quotes project paths containing spaces and shell metacharacters', () => {
  const prompt = connectionBlock({ board: 'gym', dir: "/Users/j/Client's project", connected: [] });
  assert.ok(prompt.includes("cd '/Users/j/Client'\"'\"'s project'"));
});

test('connection instructions prefer verified native tools and cover each client', () => {
  const prompt = connectionBlock({ board: 'gym', hosted: true, connected: [] });
  for (const client of ['Claude Code', 'Codex', 'Gemini CLI', 'Cursor']) assert.ok(prompt.includes(client));
  assert.match(prompt, /actually calling staves_brief from this session's MCP tools/);
  assert.match(prompt, /Never silently treat CLI fallback as completed native setup/);
  assert.match(prompt, /plain shell uses the Staves CLI/);
});
