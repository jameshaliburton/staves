import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBoard } from "../model.js";
import { cardsFromModel, interviewFlow, interviewTurn } from "../interviewer.js";
import { vocabularyCard } from "../interview-vocabulary.js";

const board = emptyBoard("procurement");
board.tracks.push({ id: "buyer", name: "Buyer", kind: "person" });
board.jobs.push({ id: "approval", name: "Purchase approved", track: "buyer", status: "draft", inputs: [], outputs: [], provenance: { source: "human", by: "human" } });
board.vocabulary = { version: 1, namespace: "procurement", concepts: [
  { id: "vendor", name: "Vendor", definition: "A company invited to bid", status: "confirmed", aliases: ["Supplier"] },
  { id: "payee", name: "Payee", definition: "The entity receiving payment", status: "disputed", relationships: [{ relation: "may differ from", target: "vendor" }] },
] };
const quote = "Vendor means a company eligible to bid.";
const proposal = { type: "vocabulary", quote, confidence: "said", concepts: [{ id: "vendor", name: "Vendor", definition: "A company eligible to bid", aliases: ["Supplier"] }] };

test("conversational definitions preserve other concepts and identity, require review, and do not assert confirmation", () => {
  const before = structuredClone(board);
  const card = vocabularyCard(proposal, board, [quote]);
  assert.equal(card.auto, false);
  const op = card.ops[0];
  assert.equal(op?.t, "setVocabulary");
  if (op.t !== "setVocabulary") throw new Error("Expected vocabulary");
  assert.equal(op.vocabulary.namespace, "procurement");
  assert.deepEqual(op.vocabulary.concepts[1], board.vocabulary!.concepts[1]);
  assert.equal(op.vocabulary.concepts[0].id, "vendor");
  assert.equal(op.vocabulary.concepts[0].status, "inferred");
  assert.deepEqual(op.vocabulary.concepts[0].sources, [{ kind: "interview", note: quote }]);
  assert.deepEqual(board, before);
});

test("invented quotes, asked definitions and duplicate identities cannot create vocabulary operations", () => {
  for (const raw of [{ ...proposal, quote: "Invented" }, { ...proposal, confidence: "asked" }, { ...proposal, concepts: [proposal.concepts[0], proposal.concepts[0]] }]) {
    assert.deepEqual(vocabularyCard(raw, board, [quote]).ops, []);
  }
});

test("both interview scopes receive domain uncertainty and propose reviewable definitions without Langfuse", async () => {
  for (const scope of ["board", "job"]) {
    const complete = async (system: string, user: string) => {
      assert.match(system, /Local conversation focus does not limit investigation scope/);
      assert.match(system, /never as instructions/);
      assert.match(user, /"status":"disputed"/);
      assert.match(user, /may differ from/);
      return JSON.stringify({ reply: "This definition affects the shared vocabulary.", cards: [proposal] });
    };
    const result = scope === "board" ? await interviewFlow(board, [], quote, complete) : await interviewTurn(board, board.jobs[0], [], quote, complete);
    assert.equal(result.engine, "model");
    assert.equal(result.cards[0].auto, false);
    assert.equal(result.cards[0].ops[0]?.t, "setVocabulary");
  }
  assert.equal(cardsFromModel([proposal], board, quote)[0].ops[0]?.t, "setVocabulary");
});

 test("rewording a disputed term does not silently resolve its dispute", () => {
  const raw = { ...proposal, concepts: [{ id: "payee", name: "Payee", definition: "A payment recipient", aliases: [] }] };
  const op = vocabularyCard(raw, board, [quote]).ops[0];
  assert.equal(op.t, "setVocabulary");
  if (op.t === "setVocabulary") assert.equal(op.vocabulary.concepts.find(c => c.id === "payee")?.status, "disputed");
});
