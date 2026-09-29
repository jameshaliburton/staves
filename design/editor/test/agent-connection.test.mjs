// A person who skipped setup should be told so by the surface they are standing on, with the command
// that fixes it. These cover the two pure parts: what the editor may claim about an agent from the
// board's own log, and what the connect sheet offers for a hosted workspace versus a local one.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';

const shell = await readFile(new URL('../shell.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../home.js', import.meta.url), 'utf8');
const langfuse = await readFile(new URL('../langfuse.js', import.meta.url), 'utf8');
const editor = await readFile(new URL('../editor.js', import.meta.url), 'utf8');
const conversation = await readFile(new URL('../conversation.js', import.meta.url), 'utf8');

function extractFunction(src, name, label) {
  const marker = 'function ' + name + '(';
  let start = src.indexOf(marker);
  assert.ok(start >= 0, name + ' must be defined in ' + label);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function load(src, label, names) {
  const context = vm.createContext({});
  vm.runInContext(names.map(name => extractFunction(src, name, label)).join('\n'), context);
  return context;
}

/** The call expression beginning at `from`, up to its balanced closing parenthesis. */
function expression(src, from, label) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, label + ' must still contain ' + from);
  let depth = 0, i = src.indexOf('(', start);
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

/** A context where both sheets are watched, so a control that opens the wrong one is visible. */
function watching() {
  const calls = [];
  const context = vm.createContext({
    eb: (text, icon, fn) => ({ text, fn }),
    window: { stavesOpenConnectSheet: options => calls.push(options) },
    connectSheet: () => calls.push('the bundled paste-a-token sheet'),
  });
  return { calls, context };
}

const connection = load(shell, 'shell.js', ['agentActivityAgo', 'agentConnectionState']);
const evidence = load(langfuse, 'langfuse.js', ['langfuseEvidenceNote']);

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const ago = minutes => new Date(NOW - minutes * 60000).toISOString();

test('a board no agent has ever written to reports the never state', () => {
  const result = connection.agentConnectionState([{ by: 'human', at: ago(2) }, { by: 'human:jo', at: ago(1) }], [], NOW);
  assert.equal(result.state, 'never');
  assert.equal(result.actor, null);
  assert.match(result.text, /No agent has written/);
});

test('an empty log is the never state rather than a fault', () => {
  assert.equal(connection.agentConnectionState([], [], NOW).state, 'never');
  assert.equal(connection.agentConnectionState(null, null, NOW).state, 'never');
});

test('an agent entry inside ten minutes is active and names the actor', () => {
  const result = connection.agentConnectionState([{ by: 'human', at: ago(1) }, { by: 'agent:claude', at: ago(3) }], [], NOW);
  assert.equal(result.state, 'active');
  assert.equal(result.actor, 'agent:claude');
  assert.equal(result.text, 'Agent active · agent:claude');
});

test('a delivery event counts as agent activity even when no entry was written', () => {
  const result = connection.agentConnectionState([], [{ status: 'claimed', actor: 'agent:codex', at: ago(4) }], NOW);
  assert.equal(result.state, 'active');
  assert.equal(result.text, 'Agent active · agent:codex');
});

test('a human delivery actor is not an agent', () => {
  assert.equal(connection.agentConnectionState([], [{ status: 'queued', actor: 'human:jo', at: ago(1) }], NOW).state, 'never');
});

test('ten minutes is still active; past it the board is idle and says how long ago', () => {
  assert.equal(connection.agentConnectionState([{ by: 'agent:claude', at: ago(10) }], [], NOW).state, 'active');
  const idle = connection.agentConnectionState([{ by: 'agent:claude', at: ago(11) }], [], NOW);
  assert.equal(idle.state, 'idle');
  assert.equal(idle.text, 'Agent last active 11 minutes ago');
});

test('idle time is reported in the largest plain unit', () => {
  const at = hours => connection.agentConnectionState([{ by: 'agent:claude', at: ago(hours * 60) }], [], NOW).text;
  assert.equal(at(1), 'Agent last active 1 hour ago');
  assert.equal(at(5), 'Agent last active 5 hours ago');
  assert.equal(at(24), 'Agent last active 1 day ago');
  assert.equal(at(24 * 9), 'Agent last active 9 days ago');
});

test('the most recent agent event wins across entries and deliveries', () => {
  const result = connection.agentConnectionState(
    [{ by: 'agent:claude', at: ago(90) }],
    [{ status: 'completed', actor: 'agent:codex', at: ago(30) }],
    NOW,
  );
  assert.equal(result.actor, 'agent:codex');
  assert.equal(result.state, 'idle');
});

test('events without a usable timestamp are ignored rather than dated to now', () => {
  assert.equal(connection.agentConnectionState([{ by: 'agent:claude', at: 'not a date' }, { by: 'agent:claude' }], [], NOW).state, 'never');
});

// paintShellStatus calls this on every repaint, so an actor of the wrong shape must not throw and
// blank the footer. An actor that is not a name is unknown, which is not the same as an agent.
test('an actor that is not a string is unknown rather than an agent', () => {
  for (const by of [null, undefined, 42, {}, [], true, Symbol('agent')]) {
    assert.equal(connection.agentConnectionState([{ by, at: ago(1) }], [], NOW).state, 'never', String(typeof by) + ' must not count as an agent');
  }
  for (const actor of [null, 42, { name: 'agent' }]) {
    assert.equal(connection.agentConnectionState([], [{ status: 'claimed', actor, at: ago(1) }], NOW).state, 'never');
  }
});

test('the shared connection control opens the same handoff as the board action', () => {
  let opened = 0;
  const context = vm.createContext({ $: () => ({ classList: { contains: () => false } }), openHandoffExport: () => opened++, closeSheet() {} });
  vm.runInContext(extractFunction(shell, 'openConnectSheet', 'shell.js'), context);
  context.openConnectSheet();
  assert.equal(opened, 1);
});

test('the editor top bar opens the shared connect sheet, not the bundled one', () => {
  const { calls, context } = watching();
  const button = vm.runInContext(expression(editor, "eb('Connect assistant'", 'editor.js'), context);
  assert.equal(typeof button.fn, 'function');
  button.fn();
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0], 'object', 'the bundled sheet must not be what the top bar opens');
  assert.match(calls[0].reason, /\S/, 'the sheet is told why it was opened');
});

test('the conversation panel connect control opens the shared connect sheet', () => {
  const marker = "$('#conversation-connect').onclick = ";
  const start = conversation.indexOf(marker);
  assert.ok(start >= 0, 'conversation.js must still wire #conversation-connect');
  const handler = conversation.slice(start + marker.length, conversation.indexOf(';', start));
  const { calls, context } = watching();
  vm.runInContext('(' + handler + ')', context)();
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0], 'object', 'the bundled sheet must not be what the panel opens');
  assert.match(calls[0].reason, /\S/);
});

test('no editor source calls the bundled connectSheet any more', async () => {
  const dir = new URL('../', import.meta.url);
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.js'))) {
    const src = await readFile(new URL(name, dir), 'utf8');
    assert.doesNotMatch(src, /(?<![\w.])connectSheet\s*\(/, name + ' still calls the bundled connect sheet');
  }
});

// The paste-a-token sheet itself lived in the bundle generator, reachable from the stage-header chip
// and the toolbar. Those told people to paste a line of JSON at an agent; the commands they need are
// `npx @staves/cli init` and `doctor`. The generator and its output must both be free of it, or the
// next rebuild puts it back.
test('the bundle generator and its generated output no longer contain the paste-a-token sheet', async () => {
  for (const path of ['../../../scripts/build_app2.py', '../../../src/app2.ts']) {
    const src = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.equal(src.includes('connectSheet'), false, path + ' still carries the bundled connect sheet');
  }
});

// The single-file build (scripts/compose.cjs) ships the bundle without design/editor/shell.js, so the
// bundle's connect controls must survive the shared sheet being absent rather than throwing.
test('the bundle asks the shared sheet for the commands and copes when there is no shell', async () => {
  const generator = await readFile(new URL('../../../scripts/build_app2.py', import.meta.url), 'utf8');
  const start = generator.indexOf('function connectHelp(reason){');
  assert.ok(start >= 0, 'build_app2.py must define connectHelp');
  const body = generator.slice(start, generator.indexOf('\n', start));
  assert.match(body, /window\.stavesOpenConnectSheet\(\{reason/);
  assert.match(body, /else toast\('Run npx @staves\/cli init/);
  const calls = generator.match(/connectHelp\(/g) || [];
  assert.ok(calls.length >= 6, 'every control that offered the old sheet must call connectHelp');
});

// home.html loads home.js alone, so the workspace page cannot call into shell.js. The copy it keeps
// must stay the same copy: this fails the build if one of them is edited and the other is not.
test('the workspace account page uses the same agent-state rule as the editor footer', () => {
  for (const name of ['agentActivityAgo', 'agentConnectionState']) {
    assert.equal(
      extractFunction(home, name, 'home.js').replace(/\s+/g, ' ').trim(),
      extractFunction(shell, name, 'shell.js').replace(/\s+/g, ' ').trim(),
      name + ' has drifted between home.js and shell.js',
    );
  }
  const workspace = load(home, 'home.js', ['agentActivityAgo', 'agentConnectionState']);
  assert.equal(workspace.agentConnectionState([{ by: 'agent:claude', at: ago(3) }], [], NOW).state, 'active');
});

// The board scan is cached on window for the page's lifetime, so a retry that does not clear it can
// never read the logs again — and the copy tells people to retry.
function retryHarness() {
  const context = vm.createContext({});
  const prelude = `
    let loadState='ready', scans=0, statusCalls=0, loads=0;
    const painted=[];
    const window={stavesAgentScan:null,stavesAgentScanResult:null};
    function paintAgentLine(scan){painted.push(scan);}
    function paintAgentUnavailable(reason){painted.push({unavailable:reason});}
    function scanWorkspaceAgents(){scans++;return Promise.resolve({entries:[],read:1,asked:1,partial:false});}
    function status(){statusCalls++;}
    async function load(){loads++;loadState='ready';}
    function setLoadState(value){loadState=value;}
    function report(){return {scans,statusCalls,loads,painted,cached:window.stavesAgentScan};}
  `;
  vm.runInContext(prelude + extractFunction(home, 'startAgentScan', 'home.js') + '\n' + extractFunction(home, 'retryAccountChecks', 'home.js'), context);
  return context;
}

test('Check connection clears the cached scan so the board logs are read again', async () => {
  const context = retryHarness();
  await context.retryAccountChecks();
  await context.report().cached;
  assert.equal(context.report().scans, 1);
  await context.retryAccountChecks();
  await context.report().cached;
  assert.equal(context.report().scans, 2, 'the cached scan promise must be cleared on retry');
  assert.equal(context.report().statusCalls, 2, 'the model status is still re-checked');
  assert.equal(context.report().painted[0], null, 'the line returns to checking while the retry runs');
});

test('Check connection re-runs a workspace load that failed', async () => {
  const context = retryHarness();
  context.setLoadState('error');
  await context.retryAccountChecks();
  assert.equal(context.report().loads, 1);
});

test('the scan does not run against a board list that has not loaded', () => {
  const context = retryHarness();
  context.setLoadState('loading');
  context.startAgentScan();
  assert.equal(context.report().scans, 0);
  assert.equal(context.report().cached, null);
});

test('a board with no Langfuse reference asks the agent to connect and probe it', () => {
  const lines = evidence.langfuseEvidenceNote(null, false);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /staves_langfuse_connect/);
  assert.match(lines[0], /staves_langfuse_probe/);
  assert.match(lines[1], /MCP server/);
});

test('a reference with nothing fetched is connected but unverified', () => {
  const lines = evidence.langfuseEvidenceNote({ baseUrl: 'https://cloud.langfuse.com', projectId: 'p' }, false);
  assert.equal(lines[0], 'Connected · access not verified');
  assert.match(lines[1], /staves_langfuse_probe/);
});

test('once evidence exists the panel stops asking for a probe', () => {
  const lines = evidence.langfuseEvidenceNote({ baseUrl: 'https://cloud.langfuse.com', projectId: 'p' }, true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /does not fetch evidence/);
});
