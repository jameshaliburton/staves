import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewTurn, interviewFlow } from '../interviewer.js';
import { investigateImpact } from '../impact.js';
import { fold, type Entry, type Op } from '../ops.js';
import type { Board } from '../model.js';

function board(jobCount: number): Board {
  const ops: Op[] = [
    { t: 'board', id: 'b', title: 'Investment case', goal: 'Decide whether to invest' },
    { t: 'setContext', context: { purpose: 'due diligence', forWhom: 'inside', outside: 'the committee', shape: 'project' } },
    { t: 'track', track: { id: 'deal', name: 'Deal team', kind: 'person' } },
    { t: 'track', track: { id: 'tax', name: 'Tax advisor', kind: 'outside' } },
    { t: 'artifact', artifact: { id: 'memo', name: 'Tax memo', kind: 'record' } },
  ];
  for (let i = 0; i < jobCount; i++) ops.push({
    t: 'job',
    job: {
      id: 'j' + i, name: 'Job number ' + i, track: i % 2 ? 'tax' : 'deal', trigger: 'hand',
      inputs: [], outputs: [], outcome: 'a result someone can act on', beneficiary: 'the deal team',
      doneWhen: ['the reviewer signs it off'], rationale: 'A long description of how this work actually goes, '.repeat(4),
      status: 'draft', provenance: { source: 'human' },
    },
  });
  // j0 hands the memo to j1, so they are neighbours by artifact.
  ops.push({ t: 'updateJob', id: 'j0', patch: { outputs: ['memo'] } }, { t: 'updateJob', id: 'j1', patch: { inputs: ['memo'] } });
  const folded = fold(ops.map((op, i) => ({ seq: i + 1, id: String(i), at: '2026-09-16', by: 'human', op }) as Entry));
  (folded as any).__findings = [];
  return folded;
}

/** Capture what the model would actually be sent. */
async function payload(b: Board, opts: { job?: string } = {}) {
  let captured = '';
  const complete = async (_system: string, user: string) => { captured = user; return JSON.stringify({ reply: 'ok', cards: [] }); };
  const lines = [{ who: 'person' as const, text: 'we send the memo out for review' }];
  if (opts.job) await interviewTurn(b, b.jobs.find(j => j.id === opts.job)!, lines, 'tell me more', complete, {});
  else await interviewFlow(b, lines, 'tell me more', complete, {});
  const section = (name: string, next: string) => captured.slice(captured.indexOf(name) + name.length, captured.indexOf(next));
  return {
    all: captured,
    tokens: Math.round(captured.length / 4),
    evidence: section('EVIDENCE AND OPEN QUESTIONS', 'SUGGESTIONS ALREADY COLLECTED'),
  };
}

test('a small board is sent exactly as it was: rationing detail must not change ordinary interviews', async () => {
  const small = board(8);
  const sent = await payload(small, { job: 'j3' });
  for (const job of small.jobs) {
    assert.ok(sent.evidence.includes('"' + job.id + '"'), job.id + ' is present');
  }
  assert.ok(sent.evidence.includes('doneWhen'), 'every job keeps its full detail');
  assert.ok(sent.evidence.includes('the reviewer signs it off'));
});

test('on a large board every job still appears, but detail goes to the work in hand', async () => {
  const big = board(120);
  const sent = await payload(big, { job: 'j0' });
  const parsed = JSON.parse(sent.evidence.trim());
  const byId = new Map(parsed.jobs.map((j: any) => [j.id, j]));

  assert.equal(parsed.jobs.length, 120, 'the whole map is still visible — the interviewer reconciles against it');
  // The job in hand and the one it hands the memo to keep everything.
  for (const near of ['j0', 'j1']) {
    assert.ok((byId.get(near) as any).doneWhen, near + ' keeps its detail');
    assert.ok((byId.get(near) as any).rationale, near + ' keeps its description');
  }
  // A job at the far end of a 120-job board is a name and a place, not 22 fields.
  const far = byId.get('j99') as any;
  assert.equal(far.rationale, undefined, 'distant work is not described in full');
  assert.equal(far.doneWhen, undefined);
  assert.equal(far.name, 'Job number 99', 'but it is still nameable');
  assert.equal(far.track, 'tax', 'and still placed');
  assert.ok('outcome' in far, 'and still says what it achieves');
});

test('detail stops growing with the board; what remains is the map, and it is cheap', async () => {
  const at120 = await payload(board(120), { job: 'j0' });
  const at400 = await payload(board(400), { job: 'j0' });
  // Described work is bounded, so a big board costs what its map costs and no more.
  const perExtraJob = (at400.tokens - at120.tokens) / 280;
  assert.ok(perExtraJob < 45, `each further job costs ${perExtraJob.toFixed(1)} tokens of map`);
  assert.ok(at120.tokens < 9000, `120 jobs cost ${at120.tokens} tokens`);
});

/** Every job hands to the next, so the whole board is one investigation neighbourhood. */
function chained(jobCount: number): Board {
  const b = board(jobCount);
  for (let i = 0; i < jobCount - 1; i++) {
    b.artifacts.push({ id: 'a' + i, name: 'Handoff ' + i, kind: 'record' });
    b.jobs[i].outputs = ['a' + i];
    b.jobs[i + 1].inputs = ['a' + i];
  }
  return b;
}

test('the impact tool keeps its own reach; only the interview asks for a smaller slice', () => {
  const big = chained(120);
  const full = investigateImpact(big, { jobIds: ['j0'] });
  const scoped = investigateImpact(big, { jobIds: ['j0'], limit: 10 });
  assert.ok(scoped.jobs.length <= 10, 'the interview can ask for less');
  assert.ok(full.jobs.length > scoped.jobs.length, 'the tool itself keeps its reach');
  assert.equal(scoped.jobs[0].id, 'j0', 'the focus survives the cut');
});
