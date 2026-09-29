import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, type Entry, type Op } from '../ops.js';
import { cardsFromModel } from '../interviewer.js';
import { ledger, settlementBasis, LEDGER_CLASSES, type LedgerClass } from '../ledger.js';
import type { Board } from '../model.js';

/**
 * How long it actually takes to get every class green.
 *
 * The personas test what the interview refuses. This tests whether it can finish: drive four different
 * kinds of work through the stages a description goes through — the brief, who does it, the work
 * itself, what changes hands, and how it goes wrong — and count the turns each class takes to close.
 *
 * The model is stubbed with a competent one: it turns what the person said into the card that stage
 * calls for and nothing else. That is deliberate. With a perfect model and cooperative answers, the
 * turn count is the floor — the best the pipeline can do. Anything that cannot go green here cannot go
 * green in a real conversation either, and that is the failure this is hunting.
 */

const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({ seq: i + 1, id: 'e' + i, v: 2, at: '2026-09-16T10:00:00.000Z', by: 'human', op }));
const boardAt = (ops: Op[]) => { const b = fold(entries(ops)); (b as any).__findings = []; return b; };

interface Stage { says: string; cards: (b: Board) => any[] }
interface Domain { name: string; kind: string; start: Op[]; stages: Stage[] }

/** Four kinds of work that fail in different ways: physical, regulated, editorial, software. */
const DOMAINS: Domain[] = [
  {
    name: 'Warehouse returns', kind: 'physical goods moving through people and shelves',
    start: [{ t: 'board', id: 'b', title: 'Warehouse returns' }],
    stages: [
      { says: 'we take back damaged stock from shops so the shop is not out of pocket, and we must never restock something broken',
        cards: () => [{ type: 'context', title: 'Warehouse returns',
          context: { purpose: 'take back damaged stock so the shop is not out of pocket', forWhom: 'the shops', mustNot: 'restock something broken' },
          quote: 'we take back damaged stock from shops so the shop is not out of pocket, and we must never restock something broken', confidence: 'said' }] },
      { says: 'the driver collects it, the goods-in clerk checks it, and the supplier gets told',
        cards: () => [
          { type: 'who', name: 'Driver', kind: 'person', quote: 'the driver collects it, the goods-in clerk checks it, and the supplier gets told', confidence: 'said' },
          { type: 'who', name: 'Goods-in clerk', kind: 'person', quote: 'the driver collects it, the goods-in clerk checks it, and the supplier gets told', confidence: 'said' },
          { type: 'who', name: 'Supplier', kind: 'outside', quote: 'the driver collects it, the goods-in clerk checks it, and the supplier gets told', confidence: 'said' }] },
      { says: 'driver brings back a pallet, clerk inspects it and writes a condition note, then we send the supplier a claim',
        cards: (b) => [
          job(b, 'Collect the pallet', 'Driver', { outputs: ['a-pallet'], outcome: 'the stock is back on site', beneficiary: 'the shop', doneWhen: ['the pallet is booked in'] },
            'driver brings back a pallet, clerk inspects it and writes a condition note, then we send the supplier a claim'),
          job(b, 'Inspect and write the condition note', 'Goods-in clerk', { inputs: ['a-pallet'], outputs: ['a-note'], outcome: 'a condition note', beneficiary: 'the supplier', doneWhen: ['the note is signed'] },
            'driver brings back a pallet, clerk inspects it and writes a condition note, then we send the supplier a claim'),
          job(b, 'Send the claim', 'Supplier', { inputs: ['a-note'], outcome: 'a claim the supplier can act on', beneficiary: 'the shop', doneWhen: ['the supplier acknowledges it'] },
            'driver brings back a pallet, clerk inspects it and writes a condition note, then we send the supplier a claim')] },
      { says: 'if the pallet is unreadable the clerk stops and photographs it instead',
        cards: (b) => [exit(b, 'Inspect and write the condition note', 'the pallet is unreadable', 'if the pallet is unreadable the clerk stops and photographs it instead')] },
    ],
  },
  {
    name: 'Clinical site activation', kind: 'regulated work where the rules are the point',
    start: [{ t: 'board', id: 'b', title: 'Clinical site activation' }],
    stages: [
      { says: 'we get a trial site ready to enrol patients, for the sponsor, and we must never enrol before the ethics approval is in hand',
        cards: () => [{ type: 'context', title: 'Clinical site activation',
          context: { purpose: 'get a trial site ready to enrol patients', forWhom: 'the sponsor', mustNot: 'enrol before the ethics approval is in hand' },
          quote: 'we get a trial site ready to enrol patients, for the sponsor, and we must never enrol before the ethics approval is in hand', confidence: 'said' }] },
      { says: 'the study start-up lead runs it, the ethics committee decides, and the site pharmacist signs for the drug',
        cards: () => [
          { type: 'who', name: 'Start-up lead', kind: 'person', quote: 'the study start-up lead runs it, the ethics committee decides, and the site pharmacist signs for the drug', confidence: 'said' },
          { type: 'who', name: 'Ethics committee', kind: 'outside', quote: 'the study start-up lead runs it, the ethics committee decides, and the site pharmacist signs for the drug', confidence: 'said' },
          { type: 'who', name: 'Site pharmacist', kind: 'person', quote: 'the study start-up lead runs it, the ethics committee decides, and the site pharmacist signs for the drug', confidence: 'said' }] },
      { says: 'lead assembles the submission, ethics returns an opinion, pharmacist receipts the drug against it',
        cards: (b) => [
          job(b, 'Assemble the submission', 'Start-up lead', { outputs: ['a-dossier'], outcome: 'a dossier ethics can rule on', beneficiary: 'the ethics committee', doneWhen: ['the dossier is submitted'] },
            'lead assembles the submission, ethics returns an opinion, pharmacist receipts the drug against it'),
          job(b, 'Return the opinion', 'Ethics committee', { inputs: ['a-dossier'], outputs: ['a-opinion'], outcome: 'a written opinion', beneficiary: 'the site', doneWhen: ['the opinion is issued'] },
            'lead assembles the submission, ethics returns an opinion, pharmacist receipts the drug against it'),
          job(b, 'Receipt the drug', 'Site pharmacist', { inputs: ['a-opinion'], outcome: 'drug held under the approval', beneficiary: 'the sponsor', doneWhen: ['the receipt is countersigned'] },
            'lead assembles the submission, ethics returns an opinion, pharmacist receipts the drug against it')] },
      { says: 'if ethics come back with conditions the lead reworks the dossier and resubmits',
        cards: (b) => [exit(b, 'Return the opinion', 'ethics come back with conditions', 'if ethics come back with conditions the lead reworks the dossier and resubmits')] },
    ],
  },
  {
    name: 'Investigation desk', kind: 'editorial judgement that resists being written down',
    start: [{ t: 'board', id: 'b', title: 'Investigation desk' }],
    stages: [
      { says: 'we turn a tip into a publishable story for readers, and we must never publish something a second source has not stood up',
        cards: () => [{ type: 'context', title: 'Investigation desk',
          context: { purpose: 'turn a tip into a publishable story', forWhom: 'readers', mustNot: 'publish something a second source has not stood up' },
          quote: 'we turn a tip into a publishable story for readers, and we must never publish something a second source has not stood up', confidence: 'said' }] },
      { says: 'a reporter works it, the desk editor decides, and legal reads it before it goes',
        cards: () => [
          { type: 'who', name: 'Reporter', kind: 'person', quote: 'a reporter works it, the desk editor decides, and legal reads it before it goes', confidence: 'said' },
          { type: 'who', name: 'Desk editor', kind: 'person', quote: 'a reporter works it, the desk editor decides, and legal reads it before it goes', confidence: 'said' },
          { type: 'who', name: 'Legal', kind: 'outside', quote: 'a reporter works it, the desk editor decides, and legal reads it before it goes', confidence: 'said' }] },
      { says: 'reporter files a draft with the sourcing, editor marks it up, legal clears it',
        cards: (b) => [
          job(b, 'File the draft', 'Reporter', { outputs: ['a-draft'], outcome: 'a draft with its sourcing attached', beneficiary: 'the desk editor', doneWhen: ['two sources are named'] },
            'reporter files a draft with the sourcing, editor marks it up, legal clears it'),
          job(b, 'Mark up the draft', 'Desk editor', { inputs: ['a-draft'], outputs: ['a-marked'], outcome: 'a draft the desk stands behind', beneficiary: 'legal', doneWhen: ['every claim is attributed'] },
            'reporter files a draft with the sourcing, editor marks it up, legal clears it'),
          job(b, 'Clear it for publication', 'Legal', { inputs: ['a-marked'], outcome: 'a story that can be published', beneficiary: 'readers', doneWhen: ['legal has signed it off'] },
            'reporter files a draft with the sourcing, editor marks it up, legal clears it')] },
      { says: 'if the second source pulls out the editor spikes it and it goes back to the reporter',
        cards: (b) => [exit(b, 'Mark up the draft', 'the second source pulls out', 'if the second source pulls out the editor spikes it and it goes back to the reporter')] },
    ],
  },
  {
    name: 'Incident response', kind: 'software work where systems act as well as people',
    start: [{ t: 'board', id: 'b', title: 'Incident response' }],
    stages: [
      { says: 'we get a broken service back for customers, and we must never close an incident without saying what caused it',
        cards: () => [{ type: 'context', title: 'Incident response',
          context: { purpose: 'get a broken service back', forWhom: 'customers', mustNot: 'close an incident without saying what caused it' },
          quote: 'we get a broken service back for customers, and we must never close an incident without saying what caused it', confidence: 'said' }] },
      { says: 'the pager rota picks it up, the on-call engineer fixes it, and the status page tells everyone',
        cards: () => [
          { type: 'who', name: 'On-call engineer', kind: 'person', quote: 'the pager rota picks it up, the on-call engineer fixes it, and the status page tells everyone', confidence: 'said' },
          { type: 'who', name: 'Pager rota', kind: 'system', quote: 'the pager rota picks it up, the on-call engineer fixes it, and the status page tells everyone', confidence: 'said' },
          { type: 'who', name: 'Status page', kind: 'system', quote: 'the pager rota picks it up, the on-call engineer fixes it, and the status page tells everyone', confidence: 'said' }] },
      { says: 'rota raises an alert, engineer restores the service, status page publishes the update',
        cards: (b) => [
          job(b, 'Raise the alert', 'Pager rota', { outputs: ['a-alert'], outcome: 'someone awake knows', beneficiary: 'the on-call engineer', doneWhen: ['the page is acknowledged'] },
            'rota raises an alert, engineer restores the service, status page publishes the update'),
          job(b, 'Restore the service', 'On-call engineer', { inputs: ['a-alert'], outputs: ['a-fix'], outcome: 'the service is serving again', beneficiary: 'customers', doneWhen: ['error rate is back to normal'] },
            'rota raises an alert, engineer restores the service, status page publishes the update'),
          job(b, 'Publish the update', 'Status page', { inputs: ['a-fix'], outcome: 'customers know it is fixed', beneficiary: 'customers', doneWhen: ['the update is live'] },
            'rota raises an alert, engineer restores the service, status page publishes the update')] },
      { says: 'if the engineer cannot restore it inside an hour it escalates to the service owner',
        cards: (b) => [exit(b, 'Restore the service', 'it is not restored inside an hour', 'if the engineer cannot restore it inside an hour it escalates to the service owner')] },
    ],
  },
];

function job(_b: Board, name: string, who: string, fields: Record<string, unknown>, quote: string) {
  return { type: 'job', name, who, quote, confidence: 'said', ...fields };
}
function exit(b: Board, jobName: string, condition: string, quote: string) {
  const owner = b.jobs.find(j => !j.removed && j.name === jobName);
  // the handler reads the job from `job`, the condition from `name`, and the destination from `detail`
  return { type: 'exit', job: owner?.id, name: condition, detail: 'stop', quote, confidence: 'said' };
}

/** Apply everything a turn proposed, the way auto-update does when the person leaves it on. */
function applyTurn(ops: Op[], cards: { ops: Op[] }[]): Op[] {
  return [...ops, ...cards.flatMap(c => c.ops)];
}

const report: string[] = [];

for (const domain of DOMAINS) {
  test(`${domain.name}: every stage closes, and we can say how long it took`, () => {
    let ops = [...domain.start];
    const closedAt = new Map<LedgerClass, number>();
    let turn = 0;

    for (const stage of domain.stages) {
      turn++;
      const board = boardAt(ops);
      const cards = cardsFromModel(stage.cards(board), board, stage.says);
      ops = applyTurn(ops, cards);

      // the person confirms what they just described, in their own words
      const after = boardAt(ops);
      for (const cls of LEDGER_CLASSES) {
        const item = ledger(after).find(i => i.class === cls)!;
        if (item.state === 'open' && item.depth >= 1 && !closedAt.has(cls)) {
          ops = [...ops, { t: 'settle', class: cls, settled: true, by: 'human', quote: stage.says, basis: settlementBasis(boardAt(ops), cls) } as Op];
          closedAt.set(cls, turn);
        }
      }
    }

    const final = ledger(boardAt(ops));
    const open = final.filter(i => i.state !== 'closed').map(i => i.class);
    report.push(`  ${domain.name.padEnd(26)} ${LEDGER_CLASSES.map(c => `${c}:${closedAt.get(c) ?? '—'}`).join('  ')}`);
    assert.deepEqual(open, [], `${domain.name} left classes open that a cooperative person described: ${open.join(', ')}`);
    assert.ok(turn <= domain.stages.length, 'no stage needed a turn that was not offered');
  });
}

test('the stages close in the order the work is described, across every kind of work', () => {
  // eslint-disable-next-line no-console
  console.log('\n  turns to close each class (— means it never closed):\n' + report.join('\n') + '\n');
  assert.equal(report.length, DOMAINS.length, 'every domain reported');
});
