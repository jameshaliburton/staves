// A fixed, fictional board for the documentation screenshots.
//
// Deliberately not anyone's real work: these images are published, and a screenshot of a live
// account leaks both its content and the shape of its data. It is also deterministic, so a shot
// that changes means the interface changed, not that the board did.
import { Store } from '../../dist/store.js';

const provenance = () => ({ source: 'agent', by: 'docs-fixture' });

export const BOARD = 'invoices';

export async function seed(dir) {
  const store = new Store(dir);
  await store.append(BOARD, [
    {
      t: 'board', id: BOARD,
      title: 'Make an invoice ready to pay',
      goal: 'The supplier is paid the right amount, once, with a clear explanation whenever payment is held.',
      origin: 'Authored for the Staves documentation. Not a description of a real system.',
    },
    { t: 'track', track: { id: 'supplier', name: 'Supplier', kind: 'outside' } },
    { t: 'track', track: { id: 'inbox', name: 'Invoice inbox (mail and portal)', kind: 'system' } },
    { t: 'track', track: { id: 'reader', name: 'Document agent', kind: 'agent' } },
    { t: 'track', track: { id: 'clerk', name: 'Accounts specialist', kind: 'person' } },
    { t: 'track', track: { id: 'owner', name: 'Budget owner', kind: 'person' } },
    { t: 'track', track: { id: 'ledger', name: 'Payment service', kind: 'system' } },

    { t: 'artifact', artifact: { id: 'invoice', name: 'the invoice as sent', kind: 'document', external: true } },
    { t: 'artifact', artifact: { id: 'reading', name: 'what the invoice says', kind: 'data' } },
    { t: 'artifact', artifact: { id: 'matched', name: 'invoice matched to an order', kind: 'record' } },
    { t: 'artifact', artifact: { id: 'approval', name: 'the budget owner’s decision', kind: 'decision' } },
    { t: 'artifact', artifact: { id: 'payment', name: 'the payment, and its receipt', kind: 'record' } },

    { t: 'job', job: { id: 'send', name: 'Send the invoice', track: 'supplier', kind: 'outside',
      trigger: 'hand', inputs: [], outputs: ['invoice'], provenance: provenance(), status: 'confirmed' } },
    { t: 'job', job: { id: 'receive', name: 'Take the invoice in', track: 'inbox',
      trigger: 'event', inputs: ['invoice'], outputs: ['reading'],
      outcome: 'Every invoice that arrives is one a person can find again, whichever way it was sent.',
      beneficiary: 'The accounts specialist, who should never have to search two places',
      doneWhen: ['The invoice is retrievable by supplier and by order number within a minute of arriving'],
      provenance: provenance(), status: 'confirmed' } },
    { t: 'job', job: { id: 'read', name: 'Read what it says', track: 'reader',
      trigger: 'chain', inputs: ['reading'], outputs: ['matched'],
      outcome: 'The amount, the supplier and the order it belongs to are known, or the invoice is marked as unreadable rather than guessed at.',
      beneficiary: 'The accounts specialist, who reads the exceptions and not the rest',
      doneWhen: ['An invoice the agent could not read is queued for a person, never assigned a guessed amount'],
      provenance: provenance(), status: 'confirmed' } },
    { t: 'job', job: { id: 'check', name: 'Check it against the order', track: 'clerk',
      trigger: 'chain', inputs: ['matched'], outputs: ['approval'],
      outcome: 'An invoice that matches its order goes on; one that does not carries a written reason a supplier could understand.',
      beneficiary: 'The supplier, who is told why they are waiting',
      doneWhen: ['A held invoice always has a reason attached before the day ends'],
      provenance: provenance(), status: 'confirmed' } },
    { t: 'job', job: { id: 'approve', name: 'Decide whether to pay', track: 'owner',
      trigger: 'hand', inputs: ['approval'], outputs: ['payment'],
      outcome: 'Someone accountable has said yes, and it is recorded who and when.',
      beneficiary: 'Whoever is asked about this payment six months from now',
      provenance: provenance(), status: 'draft' } },
    { t: 'job', job: { id: 'pay', name: 'Pay it once', track: 'ledger',
      trigger: 'chain', inputs: ['payment'], outputs: [],
      outcome: 'The supplier is paid the approved amount exactly once, with a receipt they can quote back.',
      provenance: provenance(), status: 'planned' } },

    { t: 'ask', question: { id: 'q:dup', about: 'pay', askedBy: 'staves',
      text: 'What stops the same invoice being paid twice when a supplier resends it with a new number?' } },
    { t: 'ask', question: { id: 'q:part', about: 'check', askedBy: 'staves',
      text: 'A part-delivered order arrives with a full invoice. Is that held, part-paid, or returned?' } },
  ], 'docs-fixture');
  return store;
}
