import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBoard } from "../model.js";
import { interviewFlow, interviewTurn, type Complete } from "../interviewer.js";

const board = emptyBoard("checkpoint");
board.tracks.push({ id: "owner", name: "Owner", kind: "person" });
board.jobs.push({ id: "approval", name: "Purchase approved", track: "owner", inputs: [], outputs: [], status: "draft", provenance: { source: "human" } });

test("collect checkpoint cannot expose executable cards in either interview scope", async () => {
  const complete: Complete = async () => JSON.stringify({ reply: "Who has authority?", checkpoint: { state: "collect", reason: "Approval authority is unclear." }, cards: [{ type: "task", job: "approval", name: "Approve", quote: "Approve" }] });
  for (const scope of ["board", "job"]) {
    const turn = scope === "board" ? await interviewFlow(board, [], "Approve", complete) : await interviewTurn(board, board.jobs[0], [], "Approve", complete);
    assert.equal(turn.checkpoint?.state, "collect");
    assert.deepEqual(turn.cards, []);
    assert.equal(board.jobs.length, 1);
  }
});

test("build checkpoint retains coherent edits and earlier transcript evidence", async () => {
  const quote = "The buyer checks the purchase request.";
  const turn = await interviewFlow(board, [{ who: "person", text: quote }], "Show me what you have", async (system, user) => {
    assert.match(system, /Do not wait for a fixed number of answers/);
    assert.match(system, /explicit rename/);
    assert.ok(user.includes(quote));
    return JSON.stringify({ reply: "The approval check is ready to review.", checkpoint: { state: "build", reason: "The responsibility and check are clear." }, cards: [{ type: "task", job: "approval", name: "Check purchase request", quote, confidence: "said" }] });
  });
  assert.equal(turn.checkpoint?.state, "build");
  assert.equal(turn.cards[0].ops[0].t, "job");
  assert.equal(turn.cards[0].quote, quote);
});
