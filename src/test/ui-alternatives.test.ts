import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { APP2_JS } from '../app2.js';

test('alternative creation checks persistence before navigation and retains failure for the form', async () => {
  let save: (values: { n: string }) => Promise<void> = async () => {};
  let successful = false;
  const requests: string[] = [];
  const location = { href: './?board=source' };
  const context = vm.createContext({
    $: () => ({ classList: { remove() {} } }), state: { name: 'source', board: { title: 'Source' } }, location,
    sheet: (_title: string, _fields: unknown, callback: typeof save) => { save = callback; },
    fetch: async (url: string) => { requests.push(url); return { ok: successful, text: async () => 'Alternative already exists.' }; },
  });
  vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('async function branch()'), APP2_JS.indexOf('function patterns()')), context);
  await vm.runInContext('branch()', context);
  await assert.rejects(save({ n: 'Alternative' }), /already exists/);
  assert.equal(location.href, './?board=source');
  successful = true;
  await save({ n: 'Alternative' });
  assert.equal(location.href, './?board=alternative');
  assert.deepEqual(requests, ['./branch', './branch']);
});

test('alternative changes identify the job, field and before/after values', () => {
  const context = vm.createContext({ esc: (value: unknown) => String(value) });
  vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('function diffValue('), APP2_JS.indexOf('async function branch()')), context);
  const output = vm.runInContext("diffList({changed:[{job:{name:'Review claim'},fields:[{field:'minutes',before:12,after:5},{field:'prerequisites',before:null,after:{kind:'all',inputs:['claim','policy']}}]}]})", context);
  assert.match(output, /Review claim · minutes per instance: 12 → 5/);
  assert.match(output, /prerequisites: not specified → kind: all; inputs: claim, policy/);
});

test('standalone pinned baseline survives source edits and rejects duplicate alternatives', async () => {
  const memory = new Map<string, string>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } });
  const browser = { fetch: globalThis.fetch };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  try {
    await import('../standalone.js');
    const post = (path: string, body: unknown) => browser.fetch(path, { method: 'POST', body: JSON.stringify(body) });
    await post('./op?board=source', [{ t: 'board', id: 'source', title: 'Captured title' }]);
    assert.equal((await post('./branch', { base: 'source', name: 'alternative', title: 'Alternative' })).ok, true);
    await post('./op?board=source', [{ t: 'board', id: 'source', title: 'Changed source' }]);
    const baseline = await (await browser.fetch('./baseline?board=alternative')).json();
    assert.equal(baseline.title, 'Captured title');
    assert.equal(baseline.baseline.pinned, true);
    assert.equal((await post('./branch', { base: 'source', name: 'alternative', title: 'Overwrite' })).ok, false);
    assert.equal((await (await browser.fetch('./board.json?board=alternative')).json()).title, 'Alternative');
    await post('./op?board=source', [
      { t: 'track', track: { id: 'analyst', name: 'Analyst', kind: 'person' } },
      { t: 'artifact', artifact: { id: 'claim', name: 'Claim', kind: 'document' } },
      { t: 'job', job: { id: 'assess', name: 'Assess claim', track: 'analyst', inputs: ['claim'], outputs: [], provenance: { source: 'human', by: 'human' }, status: 'draft' } },
    ]);
    await post('./op?board=legacy', [{ t: 'base', board: 'source' }, { t: 'board', id: 'legacy', title: 'Legacy' }]);
    const before = memory.get('staves:boards');
    const invalid = [{ t: 'updateJob', id: 'assess', patch: { prerequisites: { kind: 'all', inputs: ['missing'] } } }];
    await assert.rejects(post('./op?board=source&propose=1', invalid), /unknown artifact|not a job input/);
    assert.equal(memory.get('staves:boards'), before);
    await assert.rejects(post('./op?board=legacy', invalid), /unknown artifact|not a job input/);
    assert.equal(memory.get('staves:boards'), before);
    assert.equal((await (await browser.fetch('./board.json?board=legacy')).json()).jobs[0].name, 'Assess claim');
    await post('./branch', { base: 'source', name: 'focused', title: 'Focused alternative' });
    const focused = await (await browser.fetch('./board.json?board=focused&focus=assess')).json();
    assert.deepEqual(focused.diff.added, []);
    assert.deepEqual(focused.diff.removed, []);
    assert.deepEqual(focused.scorecard, focused.baseScorecard);


  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('job sheet requires conditional detail and preserves the selected prerequisite inputs', async () => {
  let save: (values: Record<string, string>) => Promise<void> = async () => {};
  const writes: unknown[] = [];
  const context = vm.createContext({
    state: { board: { artifacts: [] } }, TRIG: {},
    job: () => ({ name: 'Assess', inputs: ['claim', 'policy'], prerequisites: { kind: 'all', inputs: ['claim'] } }),
    sheet: (_title: string, _fields: unknown, callback: typeof save) => { save = callback; },
    op: async (ops: unknown) => { writes.push(ops); },
  });
  vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('function sheetJob('), APP2_JS.indexOf('function sheetTask(')), context);
  vm.runInContext("sheetJob('assess')", context);
  assert.throws(() => save({ pr: 'conditional', pc: '' }), /Describe the condition/);
  await save({ pr: 'conditional', pc: 'When a claim arrives' });
  assert.match(JSON.stringify(writes), /"inputs":\["claim"\],"condition":"When a claim arrives"/);
});


test('comparison shows track, artifact and board changes without job edits', () => {
  const context = vm.createContext({ esc: (value: unknown) => String(value) });
  vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('function diffValue('), APP2_JS.indexOf('async function branch()')), context);
  const output = vm.runInContext("diffList({tracksChanged:[{before:{name:'Analyst',kind:'person'},after:{name:'Automation',kind:'agent'}}],artifactsChanged:[{before:null,after:{name:'Decision'}}],contextChanged:[{field:'goal',before:'Fast',after:'Accurate'}]})", context);
  assert.match(output, /Track Analyst/);
  assert.match(output, /kind: person → name: Automation; kind: agent/);
  assert.match(output, /Artifact Decision/);
  assert.match(output, /Board goal: Fast → Accurate/);
  assert.doesNotMatch(output, /No changes yet/);
});

test('context menu forwards and stops the selection event so its popup stays open', () => {
  let actionEvent: unknown;
  let stopped = false;
  const button: { onclick?: (event: unknown) => void } = {};
  const popup = { innerHTML: '', offsetWidth: 100, offsetHeight: 100, style: {}, classList: { add() {}, remove() {} } };
  const context = vm.createContext({ $: () => popup, $$: () => [button], window: { innerWidth: 800, innerHeight: 600 } });
  const start = APP2_JS.indexOf('function ctx(');
  vm.runInContext(APP2_JS.slice(start, APP2_JS.indexOf('\n', start)), context);
  context.items = [['Effort estimates', 'ph-clock', (event: unknown) => { actionEvent = event; }]];
  vm.runInContext('ctx({preventDefault(){},stopPropagation(){},clientX:30,clientY:40},items)', context);
  const click = { clientX: 50, clientY: 60, stopPropagation: () => { stopped = true; } };
  button.onclick!(click);
  assert.equal(stopped, true);
  assert.equal(actionEvent, click);
});
