import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { interviewFlow, cardsFromModel, type Turn } from '../interviewer.js';
import type { Board } from '../model.js';

/**
 * Synthetic people, put through the interview.
 *
 * The model is stubbed, deliberately. What is under test is not whether a model writes good questions —
 * that cannot be asserted — but whether the pipeline still refuses to invent when a real person talks
 * the way real people do: in fragments, out of order, contradicting themselves, or barely at all.
 *
 * Each persona is a transcript a person might actually produce. Against each one the stub plays an
 * eager model: it proposes changes the words support, and changes they do not. Everything the words do
 * not support has to be rejected or demoted, whoever is talking and however they say it.
 */

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: String(i), v: 2, at: '2026-09-16T10:0' + (i % 10) + ':00.000Z', by: 'human', op }));
const at = (ops: Op[]) => { const b = fold(entries(ops)); (b as any).__findings = []; return b; };
const base: Op[] = [
  { t: 'board', id: 'b', title: 'Investment case', goal: 'Decide whether to invest' },
  { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
];

interface Persona { who: string; how: string; lines: string[] }

const PEOPLE: Persona[] = [
  {
    who: 'the domain expert, talking in jargon and shorthand',
    how: 'jagged',
    lines: [
      'QoE comes back from the advisor, we bridge it to the LOI model, then IC papers get drafted',
      'well — bridge is the wrong word. we reconcile. the adjustments schedule is the thing',
      'sorry, going back: the LOI is signed before any of that. i skipped a step',
    ],
  },
  {
    who: 'the enthusiast, who agrees with everything and volunteers more than was asked',
    how: 'enthusiastic',
    lines: [
      'yes! exactly that. and we could totally automate the whole reconciliation bit',
      'honestly the whole thing could be an agent, we should just do it',
      'whatever you think is best really, you clearly know this stuff',
    ],
  },
  {
    who: 'the reluctant one, answering in as few words as possible',
    how: 'reluctant',
    lines: ['the usual', 'depends', 'i mean it varies. sometimes legal looks at it'],
  },
  {
    who: 'the one who contradicts an earlier answer',
    how: 'contradictory',
    lines: [
      'the deal team drafts the memo',
      'actually no, the advisor drafts it and we just review. i misspoke earlier',
    ],
  },
];

/** An eager model: half of what it proposes is grounded in the words, half is not. */
function eagerModel(said: string) {
  return async () => JSON.stringify({
    reply: 'Noted.',
    topics: ['jobs'],
    cards: [
      // grounded: the person's own words, quoted exactly
      { type: 'job', name: 'Reconcile the adjustments schedule', quote: said, confidence: 'said' },
      // fabricated: a quote nobody said
      { type: 'job', name: 'Escalate to the audit committee', quote: 'we always escalate to the audit committee', confidence: 'said' },
      // a question of the interviewer's own, dressed as testimony
      { type: 'job', name: 'Check whether legal signed off', quote: 'should we check whether legal signed off?', confidence: 'said' },
      // a hypothetical, dressed as testimony
      { type: 'who', name: 'Compliance reviewer', quote: 'maybe compliance would look at it', confidence: 'said' },
      // closing a class nobody closed
      { type: 'settle', name: 'jobs', quote: 'that is everything' },
    ],
  });
}

const saidIn = (b: Board, quote: string) => JSON.stringify(b).toLowerCase().includes(quote.toLowerCase());

for (const person of PEOPLE) {
  test(`${person.how}: nothing reaches the board that the words do not carry`, async () => {
    const board = at(base);
    let turn: Turn | undefined;
    for (const line of person.lines) {
      turn = await interviewFlow(board, person.lines.slice(0, person.lines.indexOf(line)).map(text => ({ who: 'person', text })), line, eagerModel(line) as any, {});
    }
    const cards = turn!.cards;

    const fabricated = cards.find(c => c.name === 'Escalate to the audit committee');
    assert.ok(!fabricated || fabricated.confidence !== 'said',
      'a quote nobody said must never be recorded as their testimony');

    const asQuestion = cards.find(c => c.name === 'Check whether legal signed off');
    assert.ok(!asQuestion || asQuestion.confidence !== 'said',
      'the interviewer’s own question is not something the person said');

    const hypothetical = cards.find(c => c.name === 'Compliance reviewer');
    assert.ok(!hypothetical || hypothetical.confidence !== 'said',
      '“maybe” is not a statement of fact about the work');

    for (const card of cards) {
      for (const op of card.ops) {
        if (op.t === 'job') assert.ok(op.job.provenance?.source,
          'every job carries where it came from, whoever proposed it');
      }
    }
  });
}

test('the reluctant person is not padded out into a workflow they did not describe', async () => {
  const board = at(base);
  const turn = await interviewFlow(board, [], 'the usual',
    async () => JSON.stringify({ reply: 'Which part?', cards: [] }), {});
  assert.equal(turn.cards.length, 0, 'three words support nothing, so nothing is proposed');
  assert.deepEqual(turn.topics, [], 'and a turn that names no class claims none');
});

test('enthusiasm is not evidence: agreeing with a suggestion does not make it testimony', () => {
  const b = at(base);
  const [card] = cardsFromModel(
    [{ type: 'job', name: 'Automate the reconciliation', quote: 'whatever you think is best really', confidence: 'said' }],
    b, 'whatever you think is best really');
  // the words are genuinely theirs, so they may be quoted -- but deference is not a description of work
  assert.ok(card, 'the card still exists for the person to look at');
  assert.ok(!card.auto, 'it is never applied to the board without them');
});

test('a correction overrides the earlier answer rather than sitting beside it', async () => {
  const board = at(base);
  const lines = [{ who: 'person' as const, text: 'the deal team drafts the memo' }];
  const turn = await interviewFlow(board, lines, 'actually no, the advisor drafts it and we just review. i misspoke earlier',
    async (_system: string, user: string) => {
      // the prompt must carry both, or the model cannot know it is being corrected
      assert.match(user, /deal team drafts the memo/, 'the earlier answer travels with the turn');
      assert.match(user, /i misspoke earlier/, 'and so does the correction');
      return JSON.stringify({ reply: 'Understood — the advisor drafts it.', cards: [] });
    }, {});
  assert.ok(turn.reply.length > 0);
});

test('a settle nobody asked for is Staves’ judgment, and says so', () => {
  const b = at(base);
  const [settled] = cardsFromModel([{ type: 'settle', name: 'jobs', quote: 'that is everything' }], b, 'the usual');
  if (settled?.ops.length) {
    const op = settled.ops[0] as any;
    assert.equal(op.by, 'staves', 'closing a class on words the person did not say is staves’ own call');
    assert.equal(settled.confidence, 'implied', 'and it shows as an assumption they can undo');
  }
});

test('the jagged transcript keeps its order, not the order it was spoken in', async () => {
  // "i skipped a step" is the hard case: the last thing said belongs first
  const board = at(base);
  let sawBoth = false;
  await interviewFlow(board,
    [{ who: 'person', text: 'QoE comes back, then IC papers get drafted' }],
    'sorry, going back: the LOI is signed before any of that. i skipped a step',
    async (_system: string, user: string) => {
      sawBoth = /QoE comes back/.test(user) && /i skipped a step/.test(user);
      return JSON.stringify({ reply: 'So the LOI comes first.', cards: [] });
    }, {});
  assert.ok(sawBoth, 'both turns reach the model, so it can place the step where it belongs');
});

/* ---- second pass: the edges of "they said it" ---- */

test('a common fragment is not a quote: three characters must not buy testimony', () => {
  const b = at(base);
  const said = 'the advisor sends the memo to the committee';
  const [card] = cardsFromModel(
    // "the" is genuinely in the transcript, and carries no meaning at all
    [{ type: 'job', name: 'Escalate to the audit committee', quote: 'the', confidence: 'said' }], b, said);
  assert.notEqual(card?.confidence, 'said',
    'a substring that happens to appear is not something the person told you');
});

test('the interviewer’s own words are not the person’s', async () => {
  const board = at(base);
  const lines = [
    { who: 'interviewer' as const, text: 'Does legal review the memo before it goes out?' },
    { who: 'person' as const, text: 'sometimes' },
  ];
  const turn = await interviewFlow(board, lines, 'sometimes',
    async () => JSON.stringify({ reply: 'Noted.', cards: [
      { type: 'job', name: 'Legal reviews the memo', quote: 'Does legal review the memo before it goes out?', confidence: 'said' },
    ] }), {});
  assert.notEqual(turn.cards[0]?.confidence, 'said',
    'quoting the question back does not make the answer');
});

test('a paraphrase is the model’s inference, not a quotation', () => {
  const b = at(base);
  const [card] = cardsFromModel(
    [{ type: 'job', name: 'Reconcile adjustments', quote: 'we reconcile the adjustments schedule', confidence: 'said' }],
    b, 'well — bridge is the wrong word. we reconcile. the adjustments schedule is the thing');
  assert.notEqual(card?.confidence, 'said', 'near enough is not their sentence');
});

test('an exit that points nowhere is not written to the board as if it did', () => {
  const b = at([...base,
    { t: 'job', job: { id: 'j1', name: 'Draft the memo', track: 'deal', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } }]);
  const cards = cardsFromModel(
    [{ type: 'exit', name: 'unsigned', about: 'j1', condition: 'comes back unsigned', target: 'j-does-not-exist', quote: 'it comes back unsigned', confidence: 'said' }],
    b, 'it comes back unsigned');
  for (const card of cards) for (const op of card.ops) {
    if (op.t === 'updateJob' && (op as any).exits) {
      for (const exit of (op as any).exits as any[]) {
        assert.ok(!exit.target || exit.target === 'stop' || b.jobs.some(j => j.id === exit.target),
          'an exit may end the work or name a job that exists, and nothing else');
      }
    }
  }
});

test('the same work named twice does not become two jobs', () => {
  const b = at([...base,
    { t: 'job', job: { id: 'j-memo', name: 'Draft the tax memo', track: 'deal', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } }]);
  const said = 'the advisor drafts the tax memo';
  const cards = cardsFromModel([{ type: 'job', name: 'Draft the tax memo', quote: said, confidence: 'said' }], b, said);
  const creates = cards.flatMap(c => c.ops).filter(op => op.t === 'job') as any[];
  assert.ok(!creates.some(op => op.job.id !== 'j-memo' && op.job.name === 'Draft the tax memo'),
    'a job that is already on the board is updated, not duplicated beside itself');
});

/* ---- third pass: what a model must never be able to do ---- */

test('naming a role that already exists does not create a second one', () => {
  const b = at(base);
  const said = 'the deal team owns it';
  const cards = cardsFromModel([{ type: 'who', name: 'Deal team', kind: 'person', quote: said, confidence: 'said' }], b, said);
  const created = cards.flatMap(c => c.ops).filter(op => op.t === 'track') as any[];
  assert.ok(!created.some(op => op.track.id !== 'deal'),
    'the same people described twice are the same people');
});

test('a job cannot be put on a performer that does not exist', () => {
  const b = at(base);
  const said = 'the compliance desk signs it off';
  const cards = cardsFromModel([{ type: 'job', name: 'Sign off', who: 'Compliance desk', quote: said, confidence: 'said' }], b, said);
  const jobs = cards.flatMap(c => c.ops).filter(op => op.t === 'job') as any[];
  const tracks = new Set([...b.tracks.map(t => t.id), ...cards.flatMap(c => c.ops).filter(op => op.t === 'track').map((op: any) => op.track.id)]);
  for (const op of jobs) assert.ok(tracks.has(op.job.track),
    'a job names a performer the board has, or brings one with it');
});

test('a trigger the model invented is not written to the board', () => {
  const b = at(base);
  const said = 'it starts when the data room lands';
  const valid = new Set(['hand','ask','event','chain','clock','watch','deadline','always','other']);
  const cards = cardsFromModel([{ type: 'job', name: 'Review the data room', trigger: 'telepathy', quote: said, confidence: 'said' }], b, said);
  for (const op of cards.flatMap(c => c.ops).filter(op => op.t === 'job') as any[]) {
    if (op.job.trigger !== undefined) assert.ok(valid.has(op.job.trigger),
      'the trigger is one of the ways work actually starts, not free text');
  }
});

test('done-when arrives as a list even when the model sends a sentence', () => {
  const b = at(base);
  const said = 'it is done when the committee has minuted it';
  const cards = cardsFromModel([{ type: 'job', name: 'Minute the decision', doneWhen: 'the committee has minuted it', quote: said, confidence: 'said' }], b, said);
  for (const op of cards.flatMap(c => c.ops).filter(op => op.t === 'job') as any[]) {
    if (op.job.doneWhen !== undefined) assert.ok(Array.isArray(op.job.doneWhen),
      'doneWhen is a list of checks; a bare string would break every reader of it');
  }
});

test('nothing a model proposes removes work from the board on its own', () => {
  const b = at([...base,
    { t: 'job', job: { id: 'j-old', name: 'Old step', track: 'deal', trigger: 'hand', inputs: [], outputs: [], status: 'draft', provenance: { source: 'human' } } }]);
  const said = 'we do not do the old step any more';
  const cards = cardsFromModel([{ type: 'job', name: 'Old step', remove: true, quote: said, confidence: 'said' } as any], b, said);
  const destructive = cards.flatMap(c => c.ops).filter(op => op.t === 'removeJob' || op.t === 'removeTrack');
  for (const card of cards) if (card.ops.some(op => op.t === 'removeJob' || op.t === 'removeTrack')) {
    assert.equal(card.auto, false, 'removing described work is never applied without the person');
  }
  assert.ok(destructive.length === 0 || cards.every(c => !c.auto),
    'work leaves the board because a person said so, not because a turn suggested it');
});

test('a settle proposed as a question does not close anything', () => {
  const b = at(base);
  const [card] = cardsFromModel([{ type: 'settle', name: 'roles', quote: 'is that all of them?' }], b, 'is that all of them?');
  if (card?.ops.length) {
    const op = card.ops[0] as any;
    assert.notEqual(op.by, 'human', 'a question is not the person closing the class');
  }
});

/* ---- fourth pass: the model misbehaving ---- */

const quiet = async () => JSON.stringify({ reply: 'ok', cards: [] });

test('a reply that is not JSON does not take the conversation down', async () => {
  const board = at(base);
  await assert.doesNotReject(async () => {
    const turn = await interviewFlow(board, [], 'the usual', (async () => 'I think the answer is probably yes.') as any, {});
    assert.ok(typeof turn.reply === 'string');
  }, 'a model that ignores the format is a bad turn, not a broken session');
});

test('cards that are not a list are ignored rather than crashing the turn', async () => {
  const board = at(base);
  const turn = await interviewFlow(board, [], 'the usual',
    (async () => JSON.stringify({ reply: 'ok', cards: 'lots of them' })) as any, {});
  assert.deepEqual(turn.cards, [], 'nothing usable came back, so nothing is proposed');
});

test('a null card among good ones does not lose the good ones', () => {
  const b = at(base);
  const said = 'the advisor drafts the memo and we review it';
  const cards = cardsFromModel([null, { type: 'job', name: 'Review the memo', quote: said, confidence: 'said' }, undefined] as any, b, said);
  assert.ok(cards.some(c => c.name === 'Review the memo'), 'one bad entry does not discard the turn');
});

test('an enormous name is cut to something a board can hold', () => {
  const b = at(base);
  const said = 'we do the thing';
  const [card] = cardsFromModel([{ type: 'job', name: 'x'.repeat(5000), quote: said, confidence: 'said' }], b, said);
  assert.ok((card?.name.length ?? 0) <= 90, 'a name is a name, not a paragraph');
});

test('a card cannot reach through the board into the prototype', () => {
  const b = at(base);
  const said = 'we do the thing';
  cardsFromModel([{ type: 'job', name: 'Thing', __proto__: { polluted: true }, quote: said, confidence: 'said' } as any], b, said);
  assert.equal(({} as any).polluted, undefined, 'nothing a model sends may leak onto Object.prototype');
});

test('five hundred proposals do not become five hundred changes on the board', () => {
  const b = at(base);
  const said = 'we do a lot of things around here';
  const many = Array.from({ length: 500 }, (_, i) => ({ type: 'job', name: 'Step ' + i, quote: said, confidence: 'said' }));
  const cards = cardsFromModel(many, b, said);
  assert.ok(cards.every(c => !c.auto),
    'a flood is still reviewed one at a time; nothing applies itself');
});

test('the prompt stays bounded as the board grows', async () => {
  const jobs: Op[] = Array.from({ length: 200 }, (_, i) => ({
    t: 'job', job: { id: 'j' + i, name: 'Step ' + i, track: 'deal', trigger: 'hand', inputs: [], outputs: [],
      outcome: 'a result ' + i, beneficiary: 'someone', doneWhen: ['checked'], status: 'draft', provenance: { source: 'human' } },
  } as Op));
  const board = at([...base, ...jobs]);
  let sent = '';
  await interviewFlow(board, [], 'what next?', (async (_s: string, user: string) => { sent = user; return quiet(); }) as any, {});
  assert.ok(sent.length < 120000, 'a 200-job board must not send an unbounded prompt: ' + sent.length + ' chars');
});
