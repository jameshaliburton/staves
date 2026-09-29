/**
 * Reflection: zoom out and look at the whole board against its goal, in three lenses.
 *   logical    — does the flow hold together: reachability, dead ends, loops, decisions with no other path, contradictions
 *   functional — can it actually be done: tools, checks, handoffs that carry what the next step needs, bounds on waits
 *   goal       — does it serve the stated purpose for the stated person: the chain to the outside party, the must-not guarded,
 *                the intent against the allocation, the scale against the waits, who holds too much
 * Deterministic pass always; model pass on the same lenses when a model is available. Same output shape.
 */
import type { Board, Job } from "./model.js";
import { handoffs } from "./derive.js";
import type { Complete } from "./interviewer.js";
import { ModelConnectionError } from "./providers.js";

export interface Reflection { lens: "logical" | "functional" | "goal"; severity: "error" | "warn" | "info"; title: string; why: string; about: string[]; fix?: string; source: "rules" | "model" }

const live = (b: Board) => b.jobs.filter((j) => !j.removed && j.kind !== "ghost");
const top = (b: Board) => live(b).filter((j) => !j.parent);
const name = (b: Board, id: string) => b.jobs.find((j) => j.id === id)?.name ?? b.tracks.find((t) => t.id === id)?.name ?? id;

export function reflectRules(b: Board): Reflection[] {
  const R: Reflection[] = []; const jobs = top(b); const H = handoffs(b); const tr = (j: Job) => b.tracks.find((t) => t.id === j.track);
  const outsideJobs = jobs.filter((j) => j.kind === "outside" || tr(j)?.kind === "outside");
  const succ = new Map<string, string[]>(), pred = new Map<string, string[]>();
  for (const h of H) { (succ.get(h.from) ?? succ.set(h.from, []).get(h.from)!).push(h.to); (pred.get(h.to) ?? pred.set(h.to, []).get(h.to)!).push(h.from); }
  // logical: reachability from the outside party's first job
  const starts = outsideJobs.filter((j) => !(pred.get(j.id)?.length)).map((j) => j.id); const seen = new Set<string>(); const stack = [...starts];
  while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); for (const y of succ.get(x) ?? []) stack.push(y); }
  if (starts.length) { const unreachable = jobs.filter((j) => !seen.has(j.id) && !(j.trigger === "clock")); if (unreachable.length && unreachable.length < jobs.length) R.push({ lens: "logical", severity: "warn", title: `${unreachable.length} job${unreachable.length > 1 ? "s" : ""} without a connected starting point`, why: `Starting from ${outsideJobs.map((j) => j.name).join(", ")}, no handoff reaches ${unreachable.map((j) => `"${j.name}"`).join(", ")}. Check whether they start independently or need a handoff added.`, about: unreachable.map((j) => j.id), fix: "describe how these jobs start and add any missing handoffs", source: "rules" }); }
  // logical: dead ends — outputs nobody reads, and the flow never returns to the outside
  const ends = jobs.filter((j) => !(succ.get(j.id)?.length) && !(j.kind === "outside" || tr(j)?.kind === "outside") && !j.exits?.some((e) => /stop|done|end|close/i.test(e.target ?? "")));
  if (ends.length) R.push({ lens: "logical", severity: "warn", title: `${ends.length} job${ends.length > 1 ? "s" : ""} without a recorded next step or ending`, why: `${ends.map((j) => `"${j.name}"`).join(", ")} ${ends.length > 1 ? "have" : "has"} no outgoing handoff or explicit ending recorded. Check whether the result needs to reach someone else, or whether this is an intentional ending.`, about: ends.map((j) => j.id), fix: "hand something on, or add a way out that says who is told", source: "rules" });
  const returns = outsideJobs.some((j) => (pred.get(j.id)?.length ?? 0) > 0);
  if (outsideJobs.length && !returns && jobs.length > 2) R.push({ lens: "goal", severity: "error", title: "No return handoff is shown for external participants", why: `${outsideJobs.map((j) => j.name).join(", ")} have no incoming handoffs recorded. Check which participants need a result and how they receive it.`, about: outsideJobs.map((j) => j.id), fix: "draw the job where they receive the outcome and connect it", source: "rules" });
  // logical: loops without a limit; decisions with only one path
  for (const j of jobs) { if (j.loop && !j.loop.limit) R.push({ lens: "logical", severity: "warn", title: `"${j.name}" has no recorded repeat limit`, why: "No repeat limit is recorded. Check what ends the loop and what happens afterwards.", about: [j.id], fix: "say how many times, then what", source: "rules" }); if (j.gate && !(j.exits?.length)) R.push({ lens: "logical", severity: "warn", title: `"${j.name}" has a decision with no recorded alternative`, why: `The decision (${j.gate.rule}) has no alternative outcome recorded. What happens if the condition is not met?`, about: [j.id], fix: "add the way out for 'no', and who is told", source: "rules" }); }
  // functional: handoffs that carry nothing named; waits unbounded at scale
  const blank = H.filter((h) => { const a = b.artifacts.find((x) => x.id === (h as any).artifact); return !a || /^from /.test(a.name) || a.name === "→"; });
  if (blank.length >= 2) R.push({ lens: "functional", severity: "info", title: `${blank.length} handoffs don't say what changes hands`, why: "Name the information or result each receiver needs so the handoff can be reviewed.", about: blank.map((h) => h.to), fix: "name the thing on each handoff", source: "rules" });
  const waits = live(b).filter((j) => j.workKind === "wait" && !/\d+\s*(day|hour|week|min)/i.test(`${j.rationale ?? ""} ${(j.doneWhen ?? []).join(" ")}`));
  if (waits.length && b.context?.scale && /hundred|thousand|dozens/i.test(b.context.scale)) R.push({ lens: "functional", severity: "warn", title: "Wait limits to clarify", why: `At ${b.context.scale}, ${waits.length} wait${waits.length > 1 ? "s" : ""} with no bound (${waits.map((w) => `"${w.name}"`).join(", ")}) may need a timeout or escalation. No time limit was found in the recorded description.`, about: waits.map((w) => w.id), fix: "put a bound on each wait and a way out when it passes", source: "rules" });
  // goal: the must-not, guarded?
  if (b.context?.mustNot) { const words = b.context.mustNot.toLowerCase().split(/\W+/).filter((w) => w.length > 4); const guarded = live(b).some((j) => { const t = `${j.gate?.rule ?? ""} ${(j.checks ?? []).map((c) => c.rule).join(" ")} ${(j.exits ?? []).map((e) => e.condition).join(" ")} ${(j.doneWhen ?? []).join(" ")}`.toLowerCase(); return words.filter((w) => t.includes(w)).length >= Math.max(1, Math.ceil(words.length / 3)); }); if (!guarded) R.push({ lens: "goal", severity: "error", title: "Check how the stated concern is addressed", why: `"${b.context.mustNot}" — no matching wording was found in the recorded decisions, checks, exceptions or completion criteria. A safeguard may be described differently or missing from the board.`, about: [], fix: "add the check or decision that catches it, on the job where it would happen", source: "rules" }); }
  // goal: intent vs allocation
  const agentShaped = live(b).filter((j) => j.parent && ["look", "read", "match", "draft", "move"].includes(j.workKind ?? "") && (b.tracks.find((t) => t.id === j.track)?.kind === "person") && (j.tools ?? []).some((t) => t.reach === "api"));
  if (b.intent?.primary === "labor-hours" && agentShaped.length) R.push({ lens: "goal", severity: "info", title: `Review ${agentShaped.length} human task${agentShaped.length > 1 ? "s" : ""} for automation opportunities`, why: `${agentShaped.slice(0, 4).map((j) => `"${j.name}"`).join(", ")}${agentShaped.length > 4 ? "…" : ""}: lookups and reads with a reachable tool. These may be worth exploring against the goal of reducing human effort.`, about: agentShaped.map((j) => j.id), fix: "review each task, its tools and checks before proposing an agent job", source: "rules" });
  if (b.intent?.primary === "error-rate" && !live(b).some((j) => j.checks?.length)) R.push({ lens: "goal", severity: "warn", title: "No task checks are recorded for the goal of reducing errors", why: "The board does not yet describe task checks. Ask what detects incorrect results and where that is handled.", about: [], fix: "for each task that produces something, say what must be true when it's done", source: "rules" });
  // goal: one person holds everything
  const per = new Map<string, number>(); for (const j of jobs) if (tr(j)?.kind === "person") per.set(j.track, (per.get(j.track) ?? 0) + 1);
  const people = [...per.entries()]; const total = people.reduce((a, [, n]) => a + n, 0);
  for (const [t, n] of people) if (people.length > 1 && n / total >= 0.7 && n >= 3) R.push({ lens: "goal", severity: "info", title: `${name(b, t)} holds ${n} of ${total} people's jobs`, why: "This role holds most of the recorded human jobs. Check capacity and backup coverage.", about: jobs.filter((j) => j.track === t).map((j) => j.id), fix: "say which of these could be shared, and what the other person would need to take it", source: "rules" });
  // side by side: the pairs worth reading together — what a person finds by putting two jobs next to each other
  const consumers = new Map<string, string[]>(), producers = new Map<string, string[]>();
  for (const j of jobs) { for (const a of j.inputs) (consumers.get(a) ?? consumers.set(a, []).get(a)!).push(j.id); for (const a of j.outputs) (producers.get(a) ?? producers.set(a, []).get(a)!).push(j.id); }
  const artName = (id: string) => b.artifacts.find((a) => a.id === id)?.name ?? id;
  for (const [a, cs] of consumers) if (cs.length > 1) R.push({ lens: "logical", severity: "info", title: `"${artName(a)}" is read by ${cs.length} jobs — do they all mean the same thing by it?`, why: `${cs.map((c) => `"${name(b, c)}"`).join(", ")} each take it. Put them side by side: same baseline, same state, same definition? Check whether each job needs the same information and level of completeness.`, about: cs, fix: "say for each what it needs from it; split the artifact if the answers differ", source: "rules" });
  for (const [a, ps] of producers) if (ps.length > 1) R.push({ lens: "logical", severity: "info", title: `"${artName(a)}" is produced by ${ps.length} jobs`, why: `${ps.map((c) => `"${name(b, c)}"`).join(", ")} each write it. Which one wins when they disagree, and does the reader know which it got?`, about: ps, fix: "name the rule that decides, or split them", source: "rules" });
  const reachedFromMany = jobs.filter((j) => (pred.get(j.id)?.length ?? 0) > 1);
  for (const j of reachedFromMany) R.push({ lens: "logical", severity: "info", title: `"${j.name}" is reached from ${pred.get(j.id)!.length} places`, why: `${pred.get(j.id)!.map((p) => `"${name(b, p)}"`).join(", ")} all lead here. Read them together: does each arrive with the same thing, and does "${j.name}" behave the same for each?`, about: [j.id, ...pred.get(j.id)!], fix: "describe different cases, or separate jobs if they serve different outcomes", source: "rules" });
  // shared rare nouns across jobs on different tracks: two definitions of "the same X"
  const stop = new Set("the a an of to for in on and or with from by is are it its this that what when who how job jobs claim work".split(" "));
  const nouns = new Map<string, string[]>();
  for (const j of jobs) for (const w of new Set(`${j.name} ${j.outcome ?? ""}`.toLowerCase().match(/[a-z]{5,}/g) ?? [])) if (!stop.has(w)) (nouns.get(w) ?? nouns.set(w, []).get(w)!).push(j.id);
  for (const [w, ids] of nouns) { const tracksOf = new Set(ids.map((id) => b.jobs.find((j) => j.id === id)?.track)); if (ids.length >= 2 && ids.length <= 4 && tracksOf.size > 1 && /^(same|identity|company|record|subject|owner|answer|reference|match|duplicate|valid|approved|current|correct|final|complete|ready)/.test(w)) R.push({ lens: "logical", severity: "info", title: `"${w}" appears in ${ids.length} jobs on different rows — one definition, or two?`, why: `${ids.map((id) => `"${name(b, id)}"`).join(", ")}. Check whether the roles use the same definition. Record any differences that affect the handoff.`, about: ids, fix: "record the definition in each job's completion criteria and note differences on the handoff", source: "rules" }); }
  // logical: two jobs with the same name
  const seenNames = new Map<string, string>(); for (const j of jobs) { const k = j.name.toLowerCase(); if (seenNames.has(k)) R.push({ lens: "logical", severity: "info", title: `"${j.name}" appears twice`, why: "Check whether they are repeated work, different cases, or duplicates.", about: [seenNames.get(k)!, j.id], fix: "merge them, or name what is different", source: "rules" }); else seenNames.set(k, j.id); }
  return R;
}

export async function reflectModel(b: Board, brief: string, complete: Complete): Promise<Reflection[]> {
  const system = `You are staves, reflecting on a workflow board as a whole. Three lenses, in this order: LOGICAL (does the flow hold together — reachability, dead ends, loops, decisions with only one path, steps that contradict each other), FUNCTIONAL (can it be done — tools and what they return, checks, handoffs carrying what the next step needs, bounds on waits, whether an agent could actually do what is assigned to it), GOAL (does it serve the stated purpose for the stated person — the chain to whoever is waiting, whether the one thing that must not happen is guarded, whether the allocation serves the intent, whether the scale breaks anything, who holds too much). Only say what the board supports; cite the jobs by name. Distinguish missing evidence from absent behavior: an undocumented check is not proof that no check exists. Phrase inferred gaps as questions to investigate, and do not claim automation is feasible from task categories alone. Prefer the few things that matter over many small ones. Return ONLY JSON: {"reflections":[{"lens":"logical|functional|goal","severity":"error|warn|info","title":string,"why":string,"about":[job names],"fix":string}]}. At most 8.`;
  const text = await complete(system, `THE BOARD (brief)\n${brief}\n\nRespond with the JSON.`);
  const json = JSON.parse(text.replace(/```json|```/g, "").trim());
  const byName = new Map(live(b).map((j) => [j.name.toLowerCase(), j.id]));
  return (json.reflections ?? []).map((r: any): Reflection => ({ lens: ["logical", "functional", "goal"].includes(r.lens) ? r.lens : "goal", severity: ["error", "warn", "info"].includes(r.severity) ? r.severity : "info", title: String(r.title ?? "").slice(0, 120), why: String(r.why ?? "").slice(0, 400), about: (r.about ?? []).map((n: string) => byName.get(String(n).toLowerCase()) ?? "").filter(Boolean), fix: r.fix ? String(r.fix).slice(0, 200) : undefined, source: "model" }));
}

export async function reflect(b: Board, brief: string, complete?: Complete | null): Promise<{ reflections: Reflection[]; via: "rules" | "model+rules" }> {
  const rules = reflectRules(b);
  if (!complete) return { reflections: rules, via: "rules" };
  try { const m = await reflectModel(b, brief, complete); const dedup = m.filter((x) => !rules.some((r) => r.title.toLowerCase() === x.title.toLowerCase())); return { reflections: [...rules, ...dedup], via: "model+rules" }; } catch (error) { if (error instanceof ModelConnectionError) throw error; return { reflections: rules, via: "rules" }; }
}

export function reflectionText(rs: Reflection[]): string {
  if (!rs.length) return "No additional questions were found by these checks. Missing details may still affect the review.";
  const lens = (l: Reflection["lens"]) => rs.filter((r) => r.lens === l);
  const L: string[] = [];
  for (const [l, t] of [["logical", "Does it hold together?"], ["functional", "Can it be done?"], ["goal", "Does it serve the goal?"]] as const) { const xs = lens(l); if (!xs.length) continue; L.push(`## ${t}`, ...xs.map((r) => `- [${r.severity}] ${r.title} — ${r.why}${r.fix ? ` → ${r.fix}` : ""}`), ""); }
  return L.join("\n");
}
