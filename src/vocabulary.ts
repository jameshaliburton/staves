import { z } from "zod";
import type { Board } from "./model.js";
import type { Op } from "./ops.js";

const identity = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const text = z.string().trim().min(1).max(2000);
export const conceptSchema = z.object({
  id: identity,
  name: z.string().trim().min(1).max(200),
  definition: text,
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  status: z.enum(["inferred", "confirmed", "disputed", "superseded"]),
  sources: z.array(z.object({ kind: z.enum(["interview", "repository", "trace", "document"]), note: text, ref: text.optional() }).strict()).max(50).optional(),
  links: z.array(z.object({ kind: z.enum(["job", "track", "artifact"]), id: identity }).strict()).max(200).optional(),
  relationships: z.array(z.object({ relation: z.string().trim().min(1).max(200), target: identity }).strict()).max(100).optional(),
  mappings: z.array(z.object({ kind: z.enum(["repository", "api", "langfuse"]), ref: text, note: text }).strict()).max(100).optional(),
  supersededBy: identity.optional(),
}).strict();
export const vocabularySchema = z.object({ version: z.literal(1), namespace: identity, concepts: z.array(conceptSchema).max(300) }).strict();
export type DomainConcept = z.infer<typeof conceptSchema>;
export type DomainVocabulary = z.infer<typeof vocabularySchema>;

/** References are associations, never assertions that code or traces were independently verified. */
export function validateVocabulary(value: unknown, board?: Board): DomainVocabulary {
  const vocabulary = vocabularySchema.parse(value);
  const ids = new Set(vocabulary.concepts.map(c => c.id));
  if (ids.size !== vocabulary.concepts.length) throw new Error("Vocabulary concept identities must be unique.");
  for (const concept of vocabulary.concepts) {
    for (const target of [...(concept.relationships ?? []).map(r => r.target), ...(concept.supersededBy ? [concept.supersededBy] : [])]) {
      if (!ids.has(target) || target === concept.id) throw new Error(`Concept ${concept.id} has an invalid concept reference ${target}.`);
    }
    if (concept.status === "superseded" && !concept.supersededBy) throw new Error("A superseded concept must identify its replacement.");
    if (concept.status !== "superseded" && concept.supersededBy) throw new Error("Only superseded concepts can have a replacement.");
    const visited = new Set([concept.id]);
    let replacement = concept.supersededBy;
    while (replacement) {
      if (visited.has(replacement)) throw new Error("Concept replacement cannot be cyclic.");
      visited.add(replacement);
      replacement = vocabulary.concepts.find(c => c.id === replacement)?.supersededBy;
    }
    if (board) for (const link of concept.links ?? []) {
      const collection = link.kind === "job" ? board.jobs : link.kind === "track" ? board.tracks : board.artifacts;
      // Tombstones remain valid references to historical work.
      if (!collection.some(entity => entity.id === link.id)) throw new Error(`Concept ${concept.id} references missing ${link.kind} ${link.id}.`);
    }
  }
  return vocabulary;
}

export function validateVocabularyOperation(board: Board, op: Op, actor: string, propose = false): void {
  if (op.t !== "setVocabulary") return;
  validateVocabulary(op.vocabulary, board);
  const current = board.vocabulary;
  if (current && current.namespace !== op.vocabulary.namespace) throw new Error("Vocabulary namespace is immutable; reuse stable concept identities.");
  if (current?.concepts.some(c => !op.vocabulary.concepts.some(next => next.id === c.id))) throw new Error("Retain existing concepts; supersede them instead of deleting their identities.");
  if (!propose && actor !== "human" && !actor.startsWith("human:")) throw new Error("Vocabulary changes require a human decision; agents must propose changes.");
}

export function vocabularyContext(board: Board): string {
  return board.vocabulary ? `DOMAIN VOCABULARY (namespace identities persist across alternatives):\n${JSON.stringify(board.vocabulary)}\nInferred or disputed definitions remain questions. Mappings are reported associations, not verified implementation evidence. Propose changes explicitly; do not silently merge terms.` : "No domain vocabulary has been established. Propose definitions when terminology affects the work; do not invent agreement or silently merge terms.";
}
