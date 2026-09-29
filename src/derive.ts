import { JARGON } from "./protocol.js";
import type { Artifact, Board, Id, Job, Question, Track } from "./model.js";
import { reflectRules } from "./reflect.js";

/* ---------- handoffs: derived, never drawn ---------- */

export interface Handoff {
  from: Id;
  to: Id;
  artifact?: Id;
  /** an exit or loop declared on the source job */
  kind: "artifact" | "exit" | "loop";
  condition?: string;
}

const live = (b: Board) => b.jobs.filter((j) => !j.removed);

/** Position of every job: explicit order, else description order; composites at their earliest task, tasks at their parent. */
export function orderMap(b: Board): Map<Id, number> {
  const order = new Map<Id, number>(b.jobs.map((j, i) => [j.id, j.order ?? i]));
  for (const j of b.jobs) if (j.parent && (order.get(j.id)! < (order.get(j.parent) ?? Infinity))) order.set(j.parent, order.get(j.id)!);
  const sibs = new Map<Id, Job[]>();
  for (const j of b.jobs) if (j.parent) sibs.set(j.parent, [...(sibs.get(j.parent) ?? []), j]);
  for (const [pid, ks] of sibs) ks.sort((a, c) => (a.order ?? b.jobs.indexOf(a)) - (c.order ?? b.jobs.indexOf(c))).forEach((k, i) => order.set(k.id, (order.get(pid) ?? 0) + (i + 1) / 1000));
  return order;
}

export function handoffs(b: Board): Handoff[] {
  const out: Handoff[] = [];
  const jobsLive = live(b);
  const producers = new Map<Id, Id[]>();
  for (const j of jobsLive) for (const o of j.outputs) producers.set(o, [...(producers.get(o) ?? []), j.id]);
  const seen = new Set<string>();
  const push = (h: Handoff) => {
    const k = `${h.from}>${h.to}:${h.artifact ?? h.condition ?? h.kind}`;
    if (!seen.has(k) && h.from !== h.to) {
      seen.add(k);
      out.push(h);
    }
  };
  for (const j of jobsLive) {
    for (const i of j.inputs) for (const p of producers.get(i) ?? []) push({ from: p, to: j.id, artifact: i, kind: "artifact" });
    for (const e of j.exits ?? []) if (e.target && e.target !== "stop") push({ from: j.id, to: e.target, kind: "exit", condition: e.condition });
    if (j.loop) push({ from: j.id, to: j.loop.to, kind: "loop" });
  }
  return out;
}

/* ---------- columns: order by handoff, ignoring loops ---------- */

export function columns(b: Board): Map<Id, number> {
  const order = orderMap(b);
  const hs = handoffs(b).filter((h) => h.kind !== "loop" && (order.get(top(b, h.from)) ?? 0) < (order.get(top(b, h.to)) ?? 0));
  const jobs = live(b).filter((j) => !j.parent);
  const col = new Map<Id, number>();
  const preds = new Map<Id, Id[]>();
  for (const h of hs) preds.set(h.to, [...(preds.get(h.to) ?? []), h.from]);
  const visiting = new Set<Id>();
  const depth = (id: Id): number => {
    if (col.has(id)) return col.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let d = 0;
    for (const p of preds.get(id) ?? []) d = Math.max(d, depth(top(b, p)) + 1);
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  for (const j of jobs) depth(j.id);
  // stores and queues sit in the column of what feeds them
  return col;
}

function top(b: Board, id: Id): Id {
  let j = b.jobs.find((x) => x.id === id);
  while (j?.parent) j = b.jobs.find((x) => x.id === j!.parent);
  return j?.id ?? id;
}

/* ---------- the cut: execution → jobs ---------- */

export interface CutRegion {
  id: string;
  /** human touchpoints this region starts after */
  after: Id[];
  /** where it hands off to */
  ends: Id[];
  inside: Id[];
  tracks: Id[];
}

const isHuman = (b: Board, j: Job) => {
  const t = b.tracks.find((x) => x.id === j.track);
  return t?.kind === "person" || t?.kind === "outside" || j.kind === "outside" || j.kind === "ghost";
};

/**
 * Three rules:
 * 1. cut at every human or outside touchpoint;
 * 2. cut at every machinery node a person hands into;
 * 3. cut at every join — a node fed from more than one region.
 */
export function cut(b: Board): { regions: CutRegion[]; shared: Id[] } {
  const jobs = live(b).filter((j) => !j.parent);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const out = new Map<Id, Id[]>();
  const inn = new Map<Id, Id[]>();
  for (const h of handoffs(b)) {
    if (h.kind === "loop") continue;
    if (!byId.has(h.from) || !byId.has(h.to)) continue;
    out.set(h.from, [...(out.get(h.from) ?? []), h.to]);
    inn.set(h.to, [...(inn.get(h.to) ?? []), h.from]);
  }
  const human = (id: Id) => isHuman(b, byId.get(id)!);
  const entry = (id: Id) => (inn.get(id) ?? []).some(human);
  const regions = new Map<string, CutRegion>();
  for (const j of jobs) {
    if (!human(j.id)) continue;
    for (const m of out.get(j.id) ?? []) {
      if (human(m)) continue;
      const reg = new Set<Id>();
      const ends = new Set<Id>();
      const stack = [m];
      while (stack.length) {
        const x = stack.pop()!;
        if (reg.has(x)) continue;
        reg.add(x);
        for (const y of out.get(x) ?? []) {
          if (human(y)) ends.add(y);
          else if (entry(y) && y !== m) ends.add(y);
          else stack.push(y);
        }
      }
      const key = [...reg].sort().join("|");
      const r = regions.get(key) ?? { id: key, after: [], ends: [], inside: [...reg], tracks: [] };
      r.after = [...new Set([...r.after, j.id])];
      r.ends = [...new Set([...r.ends, ...ends])];
      regions.set(key, r);
    }
  }
  // rule 3: a node fed from more than one region starts its own region
  const regs = [...regions.values()];
  const count = new Map<Id, number>();
  for (const r of regs) for (const x of r.inside) count.set(x, (count.get(x) ?? 0) + 1);
  const shared = [...count].filter(([, c]) => c > 1).map(([id]) => id);
  if (shared.length) {
    const sharedSet = new Set(shared);
    for (const r of regs) {
      const keep = r.inside.filter((x) => !sharedSet.has(x));
      if (keep.length !== r.inside.length) {
        r.inside = keep;
        r.ends = [...new Set([...r.ends, ...shared.filter((s) => r.inside.some((x) => (out.get(x) ?? []).includes(s)))])];
      }
    }
    regs.push({ id: shared.sort().join("|"), after: [], ends: [], inside: shared, tracks: [] });
  }
  for (const r of regs) r.tracks = [...new Set(r.inside.map((x) => byId.get(x)!.track))];
  return { regions: regs.filter((r) => r.inside.length), shared };
}

/* ---------- the account: what a job must say ---------- */

export function missingAccount(j: Job): string[] {
  const m: string[] = [];
  if (!j.outcome) m.push("outcome");
  if (!j.beneficiary) m.push("beneficiary");
  if (!j.doneWhen?.length) m.push("doneWhen");
  return m;
}

export function accountQuestions(j: Job): string[] {
  const q: string[] = [];
  if (!j.outcome) q.push(`"${j.name}": what is different when it's done? Describe the work, not the steps.`);
  if (!j.beneficiary) q.push(`"${j.name}": who is waiting on this, and what do they do with it?`);
  if (!j.doneWhen?.length) q.push(`"${j.name}": what would you check to know it's done?`);
  return q;
}

/* ---------- the linter ---------- */

export type Severity = "error" | "warn" | "info";
export interface Finding {
  id: string;
  rule:
    | "dangling-exit"
    | "loop-no-limit"
    | "parked-no-limit"
    | "watch-only"
    | "unread-artifact"
    | "shared-machinery"
    | "two-entrances"
    | "gate-no-owner"
    | "lever-no-door"
    | "orphan"
    | "account-missing"
    | "orphan-input"
    | "over-capacity"
    | "name-too-long"
    | "composite-unnamed"
    | "gate-swallowed"
    | "tool-unreachable"
    | "budget"
    | "machinery-at-top"
    | "no-tasks"
    | "tool-coverage"
    | "no-checks"
    | "handover"
    | "jargon";
  severity: Severity;
  about: Id;
  message: string;
}

export function lint(b: Board): Finding[] {
  const f: Finding[] = [];
  const hs = handoffs(b);
  const jobs = live(b);
  const produced = new Set(jobs.flatMap((j) => j.outputs));
  const consumed = new Set(jobs.flatMap((j) => j.inputs));
  const inbound = new Map<Id, number>();
  for (const h of hs) inbound.set(h.to, (inbound.get(h.to) ?? 0) + 1);

  for (const j of jobs) {
    if (j.id.startsWith("focus:") || j.boardRef) continue;
    const track = b.tracks.find((t) => t.id === j.track);
    if (j.name.trim().split(/\s+/).length > 9 && j.kind !== "ghost")
      f.push({ id: `long:${j.id}`, rule: "name-too-long", severity: "info", about: j.id, message: `"${j.name}" is a sentence. A job's name is three to five words; the sentence is its outcome.` });
    if (j.provenance.source === "derived" && (!j.outcome || !j.beneficiary))
      f.push({ id: `unnamed:${j.id}`, rule: "composite-unnamed", severity: "warn", about: j.id, message: `"${j.name}" was made by the cut and nobody has said what it achieves or for whom.` });
    if (track?.kind === "agent") {
      const kids = jobs.filter((k) => k.parent === j.id);
      if (!kids.length && !j.parent && j.kind !== "ghost")
        f.push({ id: `notasks:${j.id}`, rule: "no-tasks", severity: "warn", about: j.id, message: `"${j.name}" is an agent's job with no tasks inside. A stranger could not do it from this. Ask the agent to break it down.` });
      if (j.parent && j.outputs.length && !j.checks?.length)
        f.push({ id: `chk:${j.id}`, rule: "no-checks", severity: "info", about: j.id, message: `"${j.name}" produces ${j.outputs.map((o) => b.artifacts.find((a) => a.id === o)?.name ?? o).join(", ")} and checks nothing. What would tell a person it came out wrong?` });
      for (const t of j.tools ?? []) if (!t.does || !t.limits)
        f.push({ id: `cov:${j.id}:${t.name}`, rule: "tool-coverage", severity: "warn", about: j.id, message: `${t.name} on "${j.name}": nobody has said what comes back and what does not.` });
      for (const k of kids) if (k.gate && k.gate.accountable !== "rule" && b.tracks.find((t) => t.id === k.gate!.accountable)?.kind === "person")
        f.push({ id: `swallow:${j.id}:${k.id}`, rule: "gate-swallowed", severity: "error", about: j.id, message: `"${j.name}" is an agent's job but contains "${k.name}", where a person decides. Keep the decision on the person's track.` });
      for (const t of [...(j.tools ?? []), ...kids.flatMap((k) => k.tools ?? [])]) if (t.reach === "screen" || t.reach === "none")
        f.push({ id: `reach:${j.id}:${t.name}`, rule: "tool-unreachable", severity: "warn", about: j.id, message: `"${j.name}" runs on an agent but uses ${t.name}, which an agent cannot reach (${t.reach}).` });
    }
    if (track?.budgetSeconds && j.minutes && j.minutes * 60 > track.budgetSeconds)
      f.push({ id: `budget:${j.id}`, rule: "budget", severity: "error", about: j.id, message: `"${j.name}" takes ~${j.minutes} min but ${track.name} kills anything over ${track.budgetSeconds} s.` });
    if (j.kind !== "store" && j.kind !== "queue") {
      const said = [j.name, j.outcome ?? "", j.beneficiary ?? ""].join(" ");
      const words = new Set(((b.context as any)?.words ?? []).map((w: string) => w.toLowerCase())); let txt = said; let m = JARGON.exec(txt);
      while (m && words.has(String(m).toLowerCase())) { txt = txt.replace(new RegExp(`\\b${String(m).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " "); m = JARGON.exec(txt); }
      if (m) f.push({ id: `jargon:${j.id}`, rule: "jargon", severity: "info", about: j.id, message: `"${j.name}" uses "${m}" — a word the person doing the work would not say. Say it in their words.` });
    }
    if (j.movedFrom) {
      const from = b.tracks.find((t) => t.id === j.movedFrom);
      const toKind = track?.kind, fromKind = from?.kind;
      const H = (m: string) => f.push({ id: `hand:${j.id}:${m.slice(0, 18)}`, rule: "handover", severity: "warn", about: j.id, message: `"${j.name}" moved from ${from?.name ?? j.movedFrom} to ${track?.name ?? j.track}: ${m}` });
      if ((fromKind === "system" || fromKind === "agent") && toKind === "person") {
        if (j.trigger !== "hand") H("a person does this now — it starts when they get to it, so the wait needs a bound.");
        if (j.exits?.length && !j.gate) H(`its ${j.exits.length} exits were conditions in code; now a person decides them — make that a gate with their name on it.`);
        if (!j.minutes) H("a person's time is the constraint now: how many minutes per instance, how many a week?");
        H("re-read the account as instructions for a human: what do they open, look at, decide, and do when it isn't there?");
      }
      if (fromKind === "person" && (toKind === "agent" || toKind === "system")) {
        if (j.trigger === "hand") H("an agent does this now — it starts when the previous job ends, not when someone gets to it.");
        if (j.gate && j.gate.accountable === j.movedFrom) H(`the decision "${j.gate.rule}" cannot move with it — keep it on ${from?.name}'s track as its own task.`);
        for (const t of j.tools ?? []) if (t.reach === "screen" || t.reach === "none") H(`${t.name} is ${t.reach}-only — an agent cannot reach it; it becomes an escalation or a blocker.`);
        if (!j.examples?.length) H("an agent will do exactly what is described and nothing else: give one example of an input and what it became.");
        if (!j.checks?.length) H("what would tell anyone this came out wrong? An agent needs checks a person used to do by eye.");
        H(`what does ${from?.name} still do here? Usually the judgment — leave it as a task on their track.`);
      }
      if (toKind === "outside") H("outside our hands now: what do we wait on, how long, and what happens when it doesn't come?");
    }
    if (!j.parent && track?.kind === "system" && j.kind !== "store" && j.kind !== "queue" && j.kind !== "ghost" && !j.beneficiary?.trim())
      f.push({ id: `mach:${j.id}`, rule: "machinery-at-top", severity: "info", about: j.id, message: `"${j.name}" has no beneficiary recorded. Who is waiting on its outcome, or whose job is it part of?` });
    const miss = missingAccount(j);
    if (miss.length && j.kind !== "store" && j.kind !== "queue" && j.kind !== "ghost")
      f.push({ id: `acct:${j.id}`, rule: "account-missing", severity: j.status === "draft" ? "warn" : "error", about: j.id, message: `"${j.name}" has no ${miss.join(", ")}.` });
    for (const e of j.exits ?? [])
      if (!e.target) f.push({ id: `dangle:${j.id}:${e.condition}`, rule: "dangling-exit", severity: "error", about: j.id, message: `"${j.name}" exits on "${e.condition}" and nothing says where that goes.` });
    if (j.loop && !j.loop.limit) f.push({ id: `loop:${j.id}`, rule: "loop-no-limit", severity: "error", about: j.id, message: `"${j.name}" loops back with no limit and no "then what".` });
    if (j.trigger === "hand" && track?.kind === "person" && !j.doneWhen?.length && j.kind !== "ghost")
      f.push({ id: `park:${j.id}`, rule: "parked-no-limit", severity: "info", about: j.id, message: `"${j.name}" waits for a person and nothing bounds the wait.` });
    if (j.kind === "watch") f.push({ id: `watch:${j.id}`, rule: "watch-only", severity: "warn", about: j.id, message: `"${j.name}": a person can look here but cannot act.` });
    if (j.gate && !j.gate.accountable) f.push({ id: `gate:${j.id}`, rule: "gate-no-owner", severity: "error", about: j.id, message: `The gate "${j.gate.rule}" on "${j.name}" has no accountable party.` });
    if (j.gate && j.gate.accountable === "rule" && !j.gate.ruleOwner) f.push({ id: `gateowner:${j.id}`, rule: "gate-no-owner", severity: "warn", about: j.id, message: `A rule decides "${j.gate.rule}" on "${j.name}"; nobody is named as the rule's owner.` });
    if (j.kind === "ghost" && j.name.match(/exist|rpc|lever/i)) f.push({ id: `lever:${j.id}`, rule: "lever-no-door", severity: "warn", about: j.id, message: `"${j.name}" exists but nothing reaches it.` });
    const touched = hs.some((h) => h.from === j.id || h.to === j.id);
    if (!touched && !j.parent && j.kind !== "ghost" && jobs.length > 1)
      f.push({ id: `orphan:${j.id}`, rule: "orphan", severity: "warn", about: j.id, message: `"${j.name}" is connected to nothing.` });
    for (const i of j.inputs) {
      const a = b.artifacts.find((x) => x.id === i);
      if (!produced.has(i) && !a?.external) f.push({ id: `oin:${j.id}:${i}`, rule: "orphan-input", severity: "error", about: j.id, message: `"${j.name}" needs "${a?.name ?? i}" but nothing produces it and it isn't declared external.` });
    }
    if (j.kind === "store" || j.kind === "work")
      for (const o of j.outputs) {
        const a = b.artifacts.find((x) => x.id === o);
        if (!consumed.has(o) && a?.kind === "record") f.push({ id: `unread:${j.id}:${o}`, rule: "unread-artifact", severity: "warn", about: j.id, message: `"${a.name}" is written and nothing reads it.` });
      }
  }
  for (const l of loads(b)) if (l.over) f.push({ id: `cap:${l.track}`, rule: "over-capacity", severity: "error", about: l.track, message: `${b.tracks.find((t) => t.id === l.track)?.name} has ${l.hours.toFixed(1)} estimated h/week${l.unknownJobs.length ? " from the specified inputs alone" : ""} against ${l.capacity} h available.` });
  const c = cut(b);
  for (const s of c.shared) f.push({ id: `shared:${s}`, rule: "shared-machinery", severity: "warn", about: s, message: `"${jobs.find((j) => j.id === s)?.name}" is reached from more than one job — coupled machinery.` });
  for (const r of c.regions) if (r.after.length > 1) for (const x of r.inside.slice(0, 1)) f.push({ id: `join:${r.id}`, rule: "two-entrances", severity: "info", about: x, message: `The job containing "${jobs.find((j) => j.id === x)?.name}" has ${r.after.length} incoming handoffs. Are all required, is any one sufficient, or does it depend on a condition? Connections alone do not specify this.` });
  return f;
}

/* ---------- questions the tool asks ---------- */

export function toolQuestions(b: Board): Question[] {
  const qs: Question[] = [];
  for (const j of live(b)) for (const t of accountQuestions(j)) qs.push({ id: `q:${j.id}:${t.slice(0, 12)}`, about: j.id, askedBy: "staves", text: t });
  const c = cut(b);
  for (const r of c.regions) {
    if (r.inside.length < 2) continue;
    const names = r.inside.map((x) => b.jobs.find((j) => j.id === x)?.name).join(", ");
    const after = r.after.map((x) => b.jobs.find((j) => j.id === x)?.name).join(" / ") || "the start";
    qs.push({ id: `cut:${r.id}`, about: r.inside[0], askedBy: "staves", text: `${names} sit together between "${after}" and what comes next. What does the person on the far side have when they're done? Name that job.` });
  }
  return qs;
}

/** Ops that turn the cut into composites: one draft job per region, its inside jobs re-parented. */
export function applyCut(b: Board): { ops: import("./ops.js").Op[]; questions: Question[] } {
  const c = cut(b);
  const ops: import("./ops.js").Op[] = [];
  const qs: Question[] = [];
  for (const r of c.regions) {
    if (r.inside.length < 2) continue;
    const inside = r.inside.map((x) => b.jobs.find((j) => j.id === x)!);
    const id = `job:${r.inside.slice().sort().join("+")}`.slice(0, 60);
    const after = r.after.map((x) => b.jobs.find((j) => j.id === x)?.name).join(" / ") || "the start";
    const name = `After ${after}`;
    const track = inside.map((j) => j.track).sort((a, z) => inside.filter((j) => j.track === z).length - inside.filter((j) => j.track === a).length)[0];
    const inputs = [...new Set(inside.flatMap((j) => j.inputs).filter((a) => !inside.some((j) => j.outputs.includes(a))))];
    const outputs = [...new Set(inside.flatMap((j) => j.outputs).filter((a) => !inside.some((j) => j.inputs.includes(a)) || b.jobs.some((j) => !r.inside.includes(j.id) && j.inputs.includes(a))))];
    ops.push({ t: "job", job: { id, name, track, inputs, outputs, provenance: { source: "derived", by: "staves" }, status: "draft" } });
    for (const j of inside) ops.push({ t: "updateJob", id: j.id, patch: { parent: id } });
    qs.push({ id: `cut:${id}`, about: id, askedBy: "staves", text: `${inside.map((j) => j.name).join(", ")} now sit inside one job. What does the person on the far side have when it's done? Name it, and say who that person is.` });
  }
  for (const q of qs) ops.push({ t: "ask", question: q });
  return { ops, questions: qs };
}

/** Estimated subtotal only; missing/invalid inputs are explicitly retained. */
export function effort(b: Board, jobs: Job[]): { hours: number; unknownJobs: Id[] } {
  let hours = 0;
  const unknownJobs: Id[] = [];
  for (const j of jobs) {
    const minutes = j.minutes;
    const volume = j.perWeek ?? b.perWeek;
    if (minutes === undefined || volume === undefined || !Number.isFinite(minutes) || !Number.isFinite(volume) || minutes < 0 || volume < 0) {
      unknownJobs.push(j.id);
    } else {
      hours += minutes * volume / 60;
    }
  }
  return { hours, unknownJobs };
}

/** A known subtotal can establish overload, but cannot establish spare capacity. */
export function loads(b: Board): { track: Id; hours: number; unknownJobs: Id[]; capacity?: number; over: boolean }[] {
  return b.tracks.filter((t) => t.kind === "person" && !t.removed).map((t) => {
    const estimate = effort(b, live(b).filter((j) => j.track === t.id));
    const capacity = t.capacityHoursPerWeek === undefined ? undefined : t.capacityHoursPerWeek * (t.people ?? 1);
    return { track: t.id, ...estimate, capacity, over: capacity !== undefined && estimate.hours > capacity };
  });
}

export function trackOf(b: Board, id: Id): Track | undefined {
  return b.tracks.find((t) => t.id === id);
}

/** What the board looks like from one role's chair: what I do, wait on, decide, hand off, and what is unresolved around me. */
export function hatBrief(b: Board, trackId: Id): string {
  const t = b.tracks.find((x) => x.id === trackId);
  if (!t) return "";
  const jobs = live(b);
  const mine = jobs.filter((j) => j.track === trackId);
  const art = (id: Id) => b.artifacts.find((a) => a.id === id)?.name ?? id;
  const name = (id: Id) => jobs.find((j) => j.id === id)?.name ?? id;
  const hs = handoffs(b);
  const what = (h: Handoff) => (h.artifact ? art(h.artifact) : h.kind === "loop" ? "a retry" : `the "${h.condition}" case`);
  const L: string[] = [];
  L.push(`# From the chair of: ${t.name} (${t.kind})${t.meta ? ` — ${t.meta}` : ""}`, "");
  L.push("## What I do", ...(mine.length ? mine.map((j) => `- ${j.name} [implementation: ${j.implementation?.state ?? "unknown"}]${j.outcome ? ` — ${j.outcome}` : ""}${j.trigger === "hand" ? " (when I get to it)" : ""}${j.minutes ? ` · ~${j.minutes} min` : ""}`) : ["- nothing is on my track"]), "");
  const waitOn = hs.filter((h) => mine.some((j) => j.id === h.to)).map((h) => `- ${what(h)} from ${name(h.from)}${jobs.find((j) => j.id === h.from)?.track === trackId ? "" : ` (${b.tracks.find((x) => x.id === jobs.find((j) => j.id === h.from)?.track)?.name})`}`);
  L.push("## What I wait on", ...(waitOn.length ? [...new Set(waitOn)] : ["- nothing"]), "");
  const give = hs.filter((h) => mine.some((j) => j.id === h.from)).map((h) => `- ${what(h)} to ${name(h.to)} (${b.tracks.find((x) => x.id === jobs.find((j) => j.id === h.to)?.track)?.name})`);
  L.push("## What others wait on me for", ...(give.length ? [...new Set(give)] : ["- nothing"]), "");
  const decide = jobs.filter((j) => j.gate && j.gate.accountable === trackId).map((j) => `- "${j.gate!.rule}" on ${j.name}`);
  L.push("## What I answer for", ...(decide.length ? decide : ["- no decision has my name on it"]), "");
  const touched = jobs.filter((j) => j.beneficiary && new RegExp(t.name.split(" ")[0], "i").test(j.beneficiary)).map((j) => `- ${j.name} (${b.tracks.find((x) => x.id === j.track)?.name}) — ${j.outcome ?? "no outcome stated"}`);
  L.push("## What is done for me by others", ...(touched.length ? touched : ["- nothing names me as the one waiting"]), "");
  const around = lint(b).filter((f) => mine.some((j) => j.id === f.about) || hs.some((h) => (h.to === f.about && mine.some((j) => j.id === h.from)) || (h.from === f.about && mine.some((j) => j.id === h.to))));
  L.push("## Unresolved around me", ...(around.length ? around.map((f) => `- ${f.message}`) : ["- nothing flagged"]), "");
  const qs = b.questions.filter((q) => !q.answer && mine.some((j) => j.id === q.about));
  if (qs.length) L.push("## Open questions on my work", ...qs.map((q) => `- ${q.text}`), "");
  if (t.kind === "agent" || t.kind === "system") {
    // the stranger test, asked back: could a stranger (or a replacement model) do each task from what is written?
    const ask: string[] = [];
    for (const j of mine) {
      const tasks = jobs.filter((x) => x.parent === j.id);
      if (!tasks.length) ask.push(`- "${j.name}": what are the steps inside? A stranger cannot do a job that has no tasks.`);
      for (const k of tasks) {
        if (!k.rationale) ask.push(`- "${k.name}": what do I open, how far do I read, when do I stop?`);
        if (!k.workKind) ask.push(`- "${k.name}": what kind of work is this — look up, read, match, draft, decide, tell, move, wait?`);
        for (const tool of k.tools ?? []) { if (!tool.does) ask.push(`- "${k.name}" · ${tool.name}: what comes back, here?`); if (!tool.limits) ask.push(`- "${k.name}" · ${tool.name}: what does it leave out — sections, older records, later pages, attachments?`); if (!tool.reach) ask.push(`- "${k.name}" · ${tool.name}: how do I reach it — an API, a screen, not at all?`); }
        if (!(k.checks?.length)) ask.push(`- "${k.name}": what must be true when I'm done, and what happens when it isn't?`);
        if (!(k.tools?.length) && ["look", "read", "match", "move"].includes(k.workKind ?? "")) ask.push(`- "${k.name}": ${k.workKind} — in what? No tool is named.`);
      }
      if (!(j.exits?.length)) ask.push(`- "${j.name}": what do I do when it isn't there, or comes back wrong? No way out is written.`);
      if (!(j.instructions?.length)) ask.push(`- "${j.name}": where are my instructions — the prompt, the config? The board can't show what it can't find.`);
    }
    L.push("## The stranger test — could a replacement do my work from this?", ...(ask.length ? ask.slice(0, 20).concat(ask.length > 20 ? [`- …and ${ask.length - 20} more`] : []) : ["- yes: every task says what it opens, what comes back, what it leaves out, and what must be true when it's done"]), "");
  }
  return L.join("\n");
}

/* ---------- scorecard: the board on the dimensions a redesign is judged on ---------- */
export interface Scorecard {
  humanHours: number; agentHours: number; humanJobs: number; agentJobs: number; humanHoursUnknown: Id[]; agentHoursUnknown: Id[]; jobs: number; tasks: number;
  humanDecisions: number; ruleDecisions: number; unownedRules: number;
  unboundedWaits: number; danglingExits: number; unreachableTools: number; uncheckedOutputs: number; unconfirmed: number;
}
export function scorecard(b: Board): Scorecard {
  const jobs = live(b);
  const kind = (j: Job) => b.tracks.find((t) => t.id === j.track)?.kind;
  const human = effort(b, jobs.filter((j) => kind(j) === "person"));
  const agent = effort(b, jobs.filter((j) => kind(j) === "agent"));
  const f = lint(b);
  return {
    humanJobs: jobs.filter((j) => kind(j) === "person").length, agentJobs: jobs.filter((j) => kind(j) === "agent").length,
    humanHours: human.hours, agentHours: agent.hours, humanHoursUnknown: human.unknownJobs, agentHoursUnknown: agent.unknownJobs,
    jobs: jobs.filter((j) => !j.parent).length, tasks: jobs.filter((j) => j.parent).length,
    humanDecisions: jobs.filter((j) => j.gate && j.gate.accountable !== "rule").length,
    ruleDecisions: jobs.filter((j) => j.gate?.accountable === "rule").length,
    unownedRules: f.filter((x) => x.rule === "gate-no-owner").length,
    unboundedWaits: f.filter((x) => x.rule === "parked-no-limit").length,
    danglingExits: f.filter((x) => x.rule === "dangling-exit").length,
    unreachableTools: f.filter((x) => x.rule === "tool-unreachable").length,
    uncheckedOutputs: f.filter((x) => x.rule === "no-checks").length,
    unconfirmed: jobs.filter((j) => j.status === "draft").length,
  };
}

/* ---------- collectable runs: consecutive tasks on a person's track that read as lookup, transfer or drafting, with reachable tools ---------- */
const MECHANICAL = /\b(look ?up|find|search|fetch|pull|open|read|copy|paste|enter|type|transfer|move|record|log|file|format|draft|write|fill|match|compare|check against|reconcile|extract|list|collect|sort|dedup|rename|convert|normali[sz]e|map)\b/i;
const JUDGMENT = /\b(decide|approve|reject|judge|choose|negotiate|call|phone|ask|persuade|escalate|sign off|sign|review|assess|weigh|interpret|advise|explain|meet|interview)\b/i;
export interface Run { parent?: Id; track: Id; tasks: Id[]; blockers: string[] }
export function collectableRuns(b: Board): Run[] {
  const jobs = live(b);
  const ord = orderMap(b);
  const kind = (j: Job) => b.tracks.find((t) => t.id === j.track)?.kind;
  const mechanical = (j: Job) => !j.gate && !JUDGMENT.test(`${j.name} ${j.outcome ?? ""}`) && MECHANICAL.test(`${j.name} ${j.outcome ?? ""} ${j.rationale ?? ""}`);
  const runs: Run[] = [];
  const groups = new Map<string, Job[]>();
  for (const j of jobs) if (kind(j) === "person") { const k = `${j.parent ?? ""}|${j.track}`; groups.set(k, [...(groups.get(k) ?? []), j]); }
  for (const [k, list] of groups) {
    const sorted = list.sort((a, c) => (ord.get(a.id) ?? 0) - (ord.get(c.id) ?? 0));
    let cur: Job[] = [];
    const flush = () => { if (cur.length >= 2) { const tools = cur.flatMap((j) => j.tools ?? []); runs.push({ parent: k.split("|")[0] || undefined, track: k.split("|")[1], tasks: cur.map((j) => j.id), blockers: [...new Set(tools.filter((t) => t.reach === "screen" || t.reach === "none").map((t) => `${t.name} (${t.reach})`))] }); } cur = []; };
    for (const j of sorted) { if (mechanical(j)) cur.push(j); else flush(); }
    flush();
  }
  return runs;
}

/* ---------- diff: what a scenario changed against its base ---------- */
export interface SemanticChange { job: Job; fields: { field: string; before: unknown; after: unknown }[] }
export interface Diff { tracksChanged: { before: Track; after: Track | null }[]; artifactsChanged: { before: Artifact | null; after: Artifact | null }[]; contextChanged: { field: string; before: unknown; after: unknown }[]; changed: SemanticChange[]; added: Job[]; removed: Job[]; moved: { job: Job; from: Id; to: Id }[]; renamed: { job: Job; from: string }[]; reparented: { job: Job; from?: Id; to?: Id }[]; tracksAdded: Track[] }
export function diff(base: Board, scen: Board): Diff {
  const bj = new Map(live(base).map((j) => [j.id, j])), sj = new Map(live(scen).map((j) => [j.id, j]));
  const d: Diff = { tracksChanged: [], artifactsChanged: [], contextChanged: [], changed: [], added: [], removed: [], moved: [], renamed: [], reparented: [], tracksAdded: scen.tracks.filter((t) => !base.tracks.some((x) => x.id === t.id)) };
  for (const [id, j] of sj) { const o = bj.get(id); if (!o) { d.added.push(j); continue; } if (o.track !== j.track) d.moved.push({ job: j, from: o.track, to: j.track }); if (o.name !== j.name) d.renamed.push({ job: j, from: o.name }); if ((o.parent ?? "") !== (j.parent ?? "")) d.reparented.push({ job: j, from: o.parent, to: j.parent }); }
  const fields: (keyof Job)[] = ["kind", "workKind", "outcome", "beneficiary", "doneWhen", "rationale", "trigger", "triggerNote", "prerequisites", "inputs", "outputs", "exits", "gate", "loop", "checks", "tools", "minutes", "perWeek", "implementation"];
  for (const [id, job] of sj) {
    const before = bj.get(id);
    if (!before) continue;
    const changed = fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(job[field])).map((field) => ({ field, before: before[field] ?? null, after: job[field] ?? null }));
    if (changed.length) d.changed.push({ job, fields: changed });
  }
  for (const before of base.tracks) {
    const after = scen.tracks.find((track) => track.id === before.id) ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) d.tracksChanged.push({ before, after });
  }
  for (const id of new Set([...base.artifacts, ...scen.artifacts].map((artifact) => artifact.id))) {
    const before = base.artifacts.find((artifact) => artifact.id === id) ?? null;
    const after = scen.artifacts.find((artifact) => artifact.id === id) ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) d.artifactsChanged.push({ before, after });
  }
  for (const field of ["goal", "context", "intent", "perWeek"] as const) {
    if (JSON.stringify(base[field]) !== JSON.stringify(scen[field])) d.contextChanged.push({ field, before: base[field] ?? null, after: scen[field] ?? null });
  }
  for (const [id, j] of bj) if (!sj.has(id)) d.removed.push(j);
  return d;
}

/* ---------- focus: one job as its own board ---------- */
export function focusBoard(b: Board, jobId: Id): Board {
  const parent = b.jobs.find((j) => j.id === jobId);
  if (!parent) return b;
  const jobs = live(b);
  const kids = jobs.filter((j) => j.parent === jobId).sort((a, c) => (orderMap(b).get(a.id) ?? 0) - (orderMap(b).get(c.id) ?? 0));
  const art = (id: Id) => b.artifacts.find((a) => a.id === id)?.name ?? id;
  const tracksUsed = new Set(kids.map((k) => k.track));
  const inTrack: Track = { id: "focus:in", name: "Comes in", kind: "outside" };
  const outTrack: Track = { id: "focus:out", name: "Goes out", kind: "outside" };
  const inJob: Job = { id: "focus:in", name: parent.inputs.length ? parent.inputs.map(art).join(", ") : "the previous job", track: inTrack.id, trigger: "event", inputs: [], outputs: parent.inputs, kind: "outside", provenance: { source: "derived" }, status: "confirmed" };
  const outJob: Job = { id: "focus:out", name: parent.outputs.length ? parent.outputs.map(art).join(", ") : "who is waiting", track: outTrack.id, trigger: "chain", inputs: parent.outputs, outputs: [], kind: "outside", provenance: { source: "derived" }, status: "confirmed" };
  // tasks become top-level; consecutive tasks with no artifacts between them get a derived chain artifact so the flow draws
  const chain: Artifact[] = [];
  const flat: Job[] = kids.map((k, i) => ({ ...k, parent: undefined, inputs: [...k.inputs], outputs: [...k.outputs] }));
  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i], c = flat[i + 1];
    if (!a.outputs.some((o) => c.inputs.includes(o))) { const id = `focus:step:${i}`; chain.push({ id, name: "→", kind: "record" }); a.outputs.push(id); c.inputs.push(id); }
  }
  if (flat.length) { if (!flat[0].inputs.length) flat[0].inputs.push(...parent.inputs); if (!flat[flat.length - 1].outputs.length) flat[flat.length - 1].outputs.push(...parent.outputs); }
  return {
    ...b,
    title: parent.name,
    goal: parent.outcome ?? b.goal,
    tracks: [inTrack, ...b.tracks.filter((t) => tracksUsed.has(t.id)), outTrack],
    jobs: [inJob, ...flat, outJob],
    artifacts: [...b.artifacts, ...chain],
    questions: b.questions.filter((q) => kids.some((k) => k.id === q.about)),
    comments: b.comments.filter((c) => kids.some((k) => k.id === c.about)),
  };
}

/* ---------- review: the analysis in one read ---------- */
export function review(b: Board): string {
  const jobs = live(b).filter((j) => !j.parent);
  const f = lint(b);
  const by = (r: string) => f.filter((x) => x.rule === r);
  const L: string[] = [];
  L.push(`# ${b.title}`, b.goal ? `> ${b.goal}` : "", "");
  const people = b.tracks.filter((t) => t.kind === "person"), agents = b.tracks.filter((t) => t.kind === "agent"), systems = b.tracks.filter((t) => t.kind === "system");
  L.push(`${jobs.length} jobs across ${people.length} people, ${agents.length} agents and ${systems.length} systems. ${jobs.filter((j) => j.status === "draft").length} have draft descriptions.`, "");
  L.push("Implementation (separate from description confirmation): " + ["unknown", "planned", "in-progress", "implemented"].map(state => `${jobs.filter(j => (j.implementation?.state ?? "unknown") === state).length} ${state}`).join(" · "), "");
  const sections: [string, string[], string][] = [
    ["Handoffs and decisions to clarify", ["dangling-exit", "parked-no-limit", "gate-no-owner", "unread-artifact", "gate-swallowed"], "check the recorded owners, endings and handoffs"],
    ["Automation details to review", ["tool-coverage", "no-checks", "no-tasks", "tool-unreachable"], "tool results, checks or task descriptions may be missing"],
    ["Goals and job descriptions", ["jargon", "account-missing", "machinery-at-top", "name-too-long"], "clarify the intended result and who needs it"],
    ["Changes to review", ["handover", "stale"], ""],
  ];
  for (const [title, rules, why] of sections) {
    const items = rules.flatMap(by);
    if (!items.length) continue;
    L.push(`## ${title} · ${items.length}`, why ? `_${why}_` : "", ...items.slice(0, 8).map((x) => `- ${x.message}`), items.length > 8 ? `- …and ${items.length - 8} more` : "", "");
  }
  const runs = collectableRuns(b);
  if (runs.length) L.push(`## Task groups to consider for automation · ${runs.length}`, ...runs.map((r) => `- ${r.tasks.map((t) => b.jobs.find((j) => j.id === t)?.name ?? t).join(" → ")}${r.blockers.length ? ` (can't reach: ${r.blockers.join(", ")})` : ""}`), "");
  const qs = b.questions.filter((q) => !q.answer);
  if (qs.length) L.push(`## Open questions · ${qs.length}`, ...qs.map((q) => `- ${q.text}`), "");
  L.push("## Suggested next steps", ...f.filter((x) => x.severity === "error").slice(0, 3).concat(f.filter((x) => x.severity === "warn").slice(0, 3)).slice(0, 3).map((x, i) => `${i + 1}. ${x.message}`));
  return L.filter((l) => l !== undefined).join("\n");
}

/* ---------- issues: what people raised, as a work list for the agent ---------- */
export function issues(b: Board): string {
  const name = (id: Id) => (id === "board" ? "the board" : b.jobs.find((j) => j.id === id)?.name ?? b.tracks.find((t) => t.id === id)?.name ?? id);
  const L: string[] = [];
  const scoped = b.questions.find((q) => q.id === "q-scope" && q.answer);
  if (scoped) L.push(`## The person chose how to proceed`, `- ${scoped.answer}`, "");
  const qs = b.questions.filter((q) => !q.answer && q.askedBy === "human");
  const designerQuestions = b.questions.filter(q => !q.answer && q.status !== "done" && q.askedBy !== "human");
  const cs = b.comments.filter((c) => c.by === "human" && !b.comments.some((r) => r.replyTo === c.id));
  const rej = (b as any).proposals?.filter?.((p: any) => p.status === "rejected") ?? [];
  if (qs.length) L.push("## Questions a person asked", ...qs.map((q) => `- [${q.id}] on ${name(q.about ?? "board")}: ${q.text}`), "");
  if (designerQuestions.length) L.push("## Questions awaiting designer input", ...designerQuestions.map(q => `- [${q.id}] on ${name(q.about ?? "board")}: ${q.text}`), "");
  if (cs.length) L.push("## Comments awaiting your reply", ...cs.map((c) => `- [${c.id}] on ${name(c.about)}: ${c.text}`), "");
  const f = lint(b).filter((x) => x.severity !== "info");
  if (f.length) L.push(`## Findings on the board · ${f.length}`, ...f.slice(0, 20).map((x) => `- on ${name(x.about)}: ${x.message}`), "");
  if (!L.length) return "Nothing raised. The board has no open questions, no comments awaiting reply, and no warnings.";
  L.push("For each: read the sources of the job it concerns, answer or reply in place (staves_answer / staves_comment with replyTo), and where the code needs to change, say what you would change and propose the board change with staves_propose. Do not change the board silently.");
  return L.join("\n");
}

/** The review as data, for the page. */
export function reviewData(b: Board) {
  const jobs = live(b).filter((j) => !j.parent);
  const f = lint(b);
  const name = (id: Id) => b.jobs.find((j) => j.id === id)?.name ?? id;
  const by = (rules: string[]) => f.filter((x) => rules.includes(x.rule)).map((x) => ({ job: x.about, name: name(x.about), text: x.message.replace(/^"[^"]*"[: ]*/, ""), severity: x.severity }));
  const people = b.tracks.filter((t) => t.kind === "person" && !t.removed), agents = b.tracks.filter((t) => t.kind === "agent" && !t.removed), systems = b.tracks.filter((t) => t.kind === "system" && !t.removed), outside = b.tracks.filter((t) => t.kind === "outside" && !t.removed);
  const sc = scorecard(b);
  return {
    title: b.title, goal: b.goal, context: b.context,
    implementation: jobs.map(j => ({ job: j.id, state: j.implementation?.state ?? "unknown", note: j.implementation?.note })),
    summary: (() => { const peopleJobs = jobs.filter((j) => (people.some((t) => t.id === j.track) || outside.some((t) => t.id === j.track))); const unword = peopleJobs.filter((j) => j.status === "draft"); const mach = jobs.filter((j) => agents.some((t) => t.id === j.track) || systems.some((t) => t.id === j.track)); const sourced = mach.filter((j) => j.sources?.length); const st = b.jobs.filter((j) => (j as any).stale).length; return `${jobs.length} jobs across ${people.length} people, ${agents.length} agents and ${systems.length} systems.${peopleJobs.length ? ` ${unword.length} of the ${peopleJobs.length} jobs on human or external tracks have draft descriptions.` : ""}${mach.length ? ` ${sourced.length} of ${mach.length} agent and system jobs have code references${sourced.length < mach.length ? "; the rest have no code references attached" : ""}.` : ""}`; })(),
    facts: [
      { icon: "globe-simple", value: outside.map((t) => t.name).join(", ") || "—", label: "external participants" },
      ...(agents.length >= people.length ? (() => { const at = live(b).filter((j) => j.parent && agents.some((t) => t.id === j.track)); const ok = at.filter((k) => k.rationale && (k.tools ?? []).every((t) => t.does && t.limits) && k.checks?.length); const tools = at.flatMap((k) => k.tools ?? []); const full = tools.filter((t) => t.does && t.limits && t.reach); return [{ icon: "robot", value: `${ok.length}/${at.length}`, label: "agent tasks with steps and checks documented" }, { icon: "wrench", value: `${full.length}/${tools.length}`, label: "tools with access, results and limits documented" }]; })() : [{ icon: "user", value: !sc.humanJobs ? "No work modeled" : sc.humanHoursUnknown.length ? "Incomplete" : sc.humanHours.toFixed(1), label: "estimated human hours a week" }]),
      { icon: "robot", value: `${agents.length}`, label: `agent tracks; ${jobs.filter((j) => j.instructions?.length).length} jobs with instructions` },
      { icon: "warning", value: `${f.filter((x) => x.severity !== "info").length}`, label: "items to review" },
      { icon: "scales", value: `${sc.unownedRules}`, label: "decisions with no recorded owner" },
    ],
    sections: [
      { key: "surprise", icon: "hand-pointing", title: "Handoffs and decisions to clarify", why: "check the recorded owners, endings and handoffs", items: by(["dangling-exit", "parked-no-limit", "gate-no-owner", "unread-artifact", "gate-swallowed"]) },
      { key: "blind", icon: "warning", title: "Automation details to review", why: "tool results, checks or task descriptions may be missing", items: by(["tool-coverage", "no-checks", "no-tasks", "tool-unreachable"]) },
      { key: "words", icon: "translate", title: "Goals and job descriptions", why: "clarify the intended result and who needs it", items: by(["jargon", "account-missing", "machinery-at-top", "name-too-long"]) },
      { key: "moved", icon: "git-diff", title: "Changes to review", why: "", items: by(["handover", "stale"]) },
    ].filter((s) => s.items.length),
    first: f.filter((x) => x.severity === "error").concat(f.filter((x) => x.severity === "warn")).slice(0, 3).map((x) => ({ job: x.about, name: name(x.about), text: x.message })),
    runs: collectableRuns(b).map((r) => ({ tasks: r.tasks.map(name), blockers: r.blockers })),
    reflections: reflectRules(b),
  };
}
