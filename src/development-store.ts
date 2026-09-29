import type { Store } from "./store.js";
import { fold } from "./ops.js";
import { ulid } from "./ulid.js";
import { normalizeDevelopmentRecord, type DevelopmentOptions, type DevelopmentRecord } from "./development.js";

export async function saveDevelopmentLink(store: Store, name: string, options: DevelopmentOptions, actor: string): Promise<DevelopmentRecord> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid board name.");
  const entries = await store.entries(name);
  if (!entries.length) throw new Error("Board does not exist.");
  const base = entries.find(entry => entry.op.t === "base");
  const board = fold(entries, base?.op.t === "base" ? await store.board(base.op.board) : undefined);
  const id = ulid();
  const record = normalizeDevelopmentRecord(board, { id, options } as DevelopmentRecord, actor, new Date().toISOString(), entries.at(-1)?.seq ?? 0);
  const saved = await store.append(name, [{ t: "comment", comment: {
    id: `development:${id}`, about: "board", by: actor, text: `Development link reported: ${record.options.git.repository.origin ?? "local repository"} · ${record.options.git.branch ?? "detached HEAD"}. Git and PR references do not accept or deploy the design.`, development: record,
  } }], actor);
  const stored = saved.comments.find(comment => comment.development?.id === id)?.development;
  if (!stored) throw new Error("Saved development link was not found.");
  return structuredClone(stored);
}
