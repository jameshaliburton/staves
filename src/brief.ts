import type { Board } from "./model.js";
import { cut, lint } from "./derive.js";

/** The board as prose an agent should read before touching the work. */
export const TRIGGER_WORDS: Record<string, string> = { hand: "a person gets to it", ask: "someone asks for it", event: "something arrives", chain: "the previous job ends", clock: "a schedule fires", watch: "a condition is met", deadline: "time runs out", always: "it never stops", other: "(in their words)" };
export function brief(b: Board): string {
  const L: string[] = [];
  if (b.context && (b.context.purpose || b.context.outside || b.context.stakes?.length || b.context.mustNot)) L.push(`Context: ${[b.context.purpose, b.context.outside ? `for ${b.context.outside}` : "", b.context.stakes?.length ? `at stake: ${b.context.stakes.join(", ")}` : "", b.context.mustNot ? `must not: ${b.context.mustNot}` : ""].filter(Boolean).join(" · ")}`, "");
  const track = (id: string) => b.tracks.find((t) => t.id === id);
  const art = (id: string) => b.artifacts.find((a) => a.id === id)?.name ?? id;
  const job = (id: string) => b.jobs.find((j) => j.id === id);
  L.push(`# ${b.title}`, "");
  if (b.goal) L.push(b.goal, "");
  if (b.origin) L.push(`_${b.origin}_`, "");
  L.push("## Who does the work", "");
  for (const t of b.tracks) L.push(`- **${t.name}** (${t.kind})${t.meta ? ` — ${t.meta}` : ""}`);
  L.push("", "## Jobs", "");
  const emit = (parent: string | undefined, depth: number) => {
    for (const j of b.jobs.filter((x) => x.parent === parent)) {
      const pad = "  ".repeat(depth);
      const t = track(j.track);
      L.push(`${pad}- **${j.name}** — ${t?.name ?? j.track}${j.kind && j.kind !== "work" ? ` · ${j.kind}` : ""}${j.status === "draft" ? " _(draft)_" : ""}`);
      L.push(`${pad}  - Implementation: ${j.implementation?.state ?? "unknown"}${j.implementation?.note ? ` — ${j.implementation.note}` : ""} (separate from description confirmation)`);
      if (j.outcome) L.push(`${pad}  - Outcome: ${j.outcome}`);
      if (j.beneficiary) L.push(`${pad}  - For: ${j.beneficiary}`);
      if (j.doneWhen?.length) L.push(`${pad}  - Done when: ${j.doneWhen.join("; ")}`);
      if (j.trigger) L.push(`${pad}  - Starts when: ${TRIGGER_WORDS[j.trigger] ?? j.trigger}${j.triggerNote ? ` — ${j.triggerNote}` : ""}`);
      if (j.inputs.length || j.outputs.length) L.push(`${pad}  - Takes: ${j.inputs.map(art).join(", ") || "—"} → Produces: ${j.outputs.map(art).join(", ") || "—"}`);
      if (j.gate) L.push(`${pad}  - Gate: "${j.gate.rule}" — ${j.gate.accountable === "rule" ? `a rule decides${j.gate.ruleOwner ? ` (owner: ${j.gate.ruleOwner})` : " (no owner named)"}` : j.gate.accountable ? `${track(j.gate.accountable)?.name ?? j.gate.accountable} is accountable` : "nobody is accountable"}`);
      for (const e of j.exits ?? []) L.push(`${pad}  - Exit: ${e.condition} → ${e.target === "stop" ? "stops" : e.target ? job(e.target)?.name ?? e.target : "NOWHERE (dangling)"}`);
      if (j.loop) L.push(`${pad}  - Loops back to ${job(j.loop.to)?.name ?? j.loop.to}${j.loop.limit ? ` (limit ${j.loop.limit})` : " (no limit)"}${j.loop.then ? `, then ${j.loop.then}` : ""}`);
      if (j.tools?.length) L.push(`${pad}  - Tools: ${j.tools.map((x) => `${x.name} (${x.reach}${x.personal ? ", personal" : ""})${x.does ? ` — returns: ${x.does}` : ""}${x.limits ? `; leaves out: ${x.limits}` : " — WHAT IT LEAVES OUT IS UNKNOWN"}`).join("; ")}`);
      for (const ins of j.instructions ?? []) L.push(`${pad}  - Instructions: ${ins.path}${ins.symbol ? `#${ins.symbol}` : ""}${ins.summary ? ` — ${ins.summary}` : ""}`);
      for (const ex of j.examples ?? []) L.push(`${pad}  - Example: ${ex.in} → ${ex.out}${ex.note ? ` (${ex.note})` : ""}`);
      for (const c of j.checks ?? []) L.push(`${pad}  - Check: ${c.rule}${c.onFail ? ` — on failure: ${c.onFail}` : " — on failure: NOT SAID"}`);
      L.push(`${pad}  - Said by: ${j.provenance.source}${j.provenance.by ? ` (${j.provenance.by})` : ""}`);
      emit(j.id, depth + 1);
    }
  };
  emit(undefined, 0);
  const c = cut(b);
  if (c.regions.length) {
    L.push("", "## The cut (derived)", "");
    for (const r of c.regions) L.push(`- ${r.inside.map((x) => job(x)?.name).join(" · ")} — after ${r.after.map((x) => job(x)?.name).join(" / ") || "start"}${r.ends.length ? ` → ${r.ends.map((x) => job(x)?.name).join(" / ")}` : ""}`);
    if (c.shared.length) L.push(`- Shared machinery: ${c.shared.map((x) => job(x)?.name).join(", ")}`);
  }
  const f = lint(b);
  if (f.length) {
    L.push("", "## Findings", "");
    for (const x of f) L.push(`- [${x.severity}] ${x.message}`);
  }
  const waiting = b.comments.filter((c) => c.by === "human" && !b.comments.some((r) => r.replyTo === c.id));
  if (waiting.length) {
    L.push("", "## Comments awaiting your reply", "");
    for (const c of waiting) L.push(`- on "${c.about === "board" ? "the board" : job(c.about)?.name ?? b.tracks.find((t) => t.id === c.about)?.name ?? c.about}": ${c.text}  _(reply with staves_comment, replyTo: ${c.id})_`);
  }
  const open = b.questions.filter((q) => !q.answer), done = b.questions.filter((q) => q.answer);
  if (open.length) {
    L.push("", "## Open questions", "");
    for (const q of open) L.push(`- (${q.askedBy}${q.about ? `, about "${job(q.about)?.name ?? q.about}"` : ""}) ${q.text}`);
  }
  if (done.length) {
    L.push("", "## Clarified", "");
    for (const q of done) L.push(`- Q: ${q.text}\n  A (${q.answeredBy}): ${q.answer}`);
  }
  return L.join("\n") + "\n";
}
