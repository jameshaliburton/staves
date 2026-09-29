import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode, fold, type Entry, type Op } from "../ops.js";

test("living brief persists new fields, keeps other context and can clear an answer", () => {
  const operations: Op[] = [
    { t: "board", id: "brief", title: "Support" },
    { t: "setContext", context: { purpose: "Help customers", stakes: ["trust"], where: "people" } },
    { t: "setContext", context: { improvement: "Reduce waiting", success: "A reply within a day", outside: "Customers" } },
    { t: "setContext", context: { success: "" } },
  ];
  const entries: Entry[] = operations.map((op, seq) => ({ op, seq, by: "human", at: "2026-09-09" }));
  const board = fold(decode(encode(entries)));
  assert.deepEqual(board.context, {
    purpose: "Help customers",
    stakes: ["trust"],
    where: "people",
    improvement: "Reduce waiting",
    success: "",
    outside: "Customers",
  });
});
