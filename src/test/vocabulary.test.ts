import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { validateVocabulary, type DomainVocabulary } from "../vocabulary.js";
import { previewAlternative } from "../alternative.js";
import { workflowExport } from "../export.js";
const vocabulary: DomainVocabulary = { version: 1, namespace: "procurement", concepts: [{ id: "vendor", name: "Vendor", definition: "An organization supplying goods", status: "confirmed", aliases: ["Supplier"], links: [{ kind: "job", id: "j" }], mappings: [{ kind: "repository", ref: "vendor.ts", note: "Reported implementation" }] }] };
async function fixture(run: (store: Store) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-vocabulary-"));
  try {
    const store = new Store(dir);
    await store.append("source", [{ t: "board", id: "source", title: "Original" }, { t: "track", track: { id: "t", name: "Owner", kind: "person" } }, { t: "job", job: { id: "j", name: "Review vendor", track: "t", inputs: [], outputs: [], status: "draft", provenance: { source: "agent" } } }], "human");
    await run(store);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test("agent definitions require human acceptance, including forged confirmation attempts", () => fixture(async s => {
  await assert.rejects(s.append("source", [{ t: "setVocabulary", vocabulary }], "agent"), /human/);
  await s.append("source", [{ t: "setVocabulary", vocabulary }], "agent", true);
  assert.equal((await s.board("source")).vocabulary, undefined);
  await assert.rejects(s.append("source", [{ t: "accept", seq: (await s.entries("source")).find(e => e.pending)!.seq }], "agent"), /human/);
  await s.append("source", [{ t: "accept", seq: (await s.entries("source")).find(e => e.pending)!.seq }], "human:reviewer");
  assert.deepEqual((await s.board("source")).vocabulary, vocabulary);
}));
test("stale replacement proposals cannot overwrite new human definitions", () => fixture(async s => {
  await s.append("source", [{ t: "setVocabulary", vocabulary }], "human");
  const replacement = structuredClone(vocabulary); replacement.concepts[0].name = "Supplier";
  await s.append("source", [{ t: "setVocabulary", vocabulary: replacement }], "agent", true);
  const current = structuredClone(vocabulary); current.concepts[0].definition = "An approved organization supplying goods";
  await s.append("source", [{ t: "setVocabulary", vocabulary: current }], "human");
  await assert.rejects(s.append("source", [{ t: "accept", seq: (await s.entries("source")).find(e => e.pending)!.seq }], "human"), /stale/);
}));
test("identities persist through renaming and alternatives, deletions and namespace replacement reject", () => fixture(async s => {
  await s.append("source", [{ t: "setVocabulary", vocabulary }], "human");
  await assert.rejects(s.append("source", [{ t: "setVocabulary", vocabulary: { ...vocabulary, namespace: "other" } }], "human"), /namespace/);
  await assert.rejects(s.append("source", [{ t: "setVocabulary", vocabulary: { ...vocabulary, concepts: [] } }], "human"), /Retain/);
  await s.branch("source", "alt", "Alternative");
  const next = structuredClone(vocabulary); next.concepts[0].name = "Supplier";
  await s.append("alt", [{ t: "setVocabulary", vocabulary: next }], "human");
  const source = await s.board("source"), alt = await s.board("alt"), baseline = await s.baseline("alt");
  assert.equal(alt.vocabulary?.namespace, source.vocabulary?.namespace);
  const review = previewAlternative(source, alt, baseline!);
  assert.equal(review.changes[0].field, "vocabulary");
  await s.append("source", [{ t: "acceptAlternative", alternative: alt, baseline: baseline!, expectedBasis: review.basis }], "human");
  assert.equal((await s.board("source")).vocabulary?.concepts[0].name, "Supplier");
}));
test("reject dangling references, cyclic replacement and unknown payload fields", () => {
  assert.throws(() => validateVocabulary({ ...vocabulary, concepts: [...vocabulary.concepts, ...vocabulary.concepts] }), /unique/);
  assert.throws(() => validateVocabulary({ ...vocabulary, secretKey: "secret" }));
  assert.throws(() => validateVocabulary({ ...vocabulary, concepts: [{ ...vocabulary.concepts[0], relationships: [{ relation: "is", target: "absent" }] }] }), /reference/);
  assert.throws(() => validateVocabulary({ ...vocabulary, concepts: [{ ...vocabulary.concepts[0], status: "superseded", supersededBy: "other" }, { id: "other", name: "Other", definition: "Another", status: "superseded", supersededBy: "vendor" }] }), /cyclic/);
});
test("structured exports retain definitions and honor source-reference omission", () => fixture(async s => {
  await s.append("source", [{ t: "setVocabulary", vocabulary }], "human");
  const board = await s.board("source");
  assert.equal(workflowExport(board, 1).board.vocabulary?.concepts[0].mappings, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(workflowExport(board, 1, { includeSources: true }).board.vocabulary)), JSON.parse(JSON.stringify(vocabulary)));
}));
test("definition changes alter assessment basis", () => fixture(async s => {
  const { createAssessmentRequest } = await import("../assessment.js");
  await s.append("source", [{ t: "setVocabulary", vocabulary }], "human");
  const board = await s.board("source");
  const options = { id: "r", capturedBy: "human", capturedAt: "2026-09-14T10:00:00Z", jobIds: ["j"] };
  const prior = createAssessmentRequest(board, 4, options);
  board.vocabulary!.concepts[0].definition = "Only approved vendors";
  const after = createAssessmentRequest(board, 5, options);
  assert.notEqual(prior.basis, after.basis);
}));
