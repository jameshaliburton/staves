/**
 * The gym: simulated stakeholders with a hidden board. The interviewer talks to them; we score what it elicited,
 * what it invented, and how it asked. Runs the rule engine with a scripted stakeholder in CI; runs the model
 * engine with a model-played stakeholder when a Complete is given.
 */
import type { Board } from "./model.js";
import { emptyBoard } from "./model.js";
import { fold, type Op, type Entry } from "./ops.js";
const F = (ops: Op[]): Board => fold(ops.map((op, i): Entry => ({ seq: i + 1, id: `g${i}`, v: 2, at: "", by: "human", op })));
import { interviewFlow, interviewTurn, type Complete, type Line, type Card } from "./interviewer.js";

export interface Persona { name: string; role: string; hidden: { purpose: string; outside: string; jobs: { name: string; who: string; tasks?: string[]; tool?: { name: string; leaves: string }; wait?: string; decision?: string; exit?: string }[] }; /** how they answer: keyed by a regex over the question */ answers: [RegExp, string][]; fallback: string }

export const PERSONAS: Persona[] = [
  { name: "Anna", role: "claims adjuster", hidden: { purpose: "every claim gets a decision", outside: "the claimant", jobs: [
      { name: "Admit the claim", who: "Anna", tasks: ["find the policy", "check it is not a duplicate"], tool: { name: "Policy desk", leaves: "anything before 2019" }, wait: "until the claimant answers, about a week", exit: "if the number is wrong I send it back to intake" },
      { name: "Assess the claim", who: "Anna", tasks: ["gather the evidence", "score against the policy"], tool: { name: "Insurer portal", leaves: "attachments" }, decision: "I approve under five thousand; above that my lead does" } ] },
    answers: [
      [/tell me about the work|what is it|how does it (usually )?start/i, "A claim comes in from the claimant. I admit it, then I assess it, then I decide or my lead does."],
      [/last time|walk me through|first/i, "Last one: I opened the Policy desk and looked up the number. Then I checked it is not a duplicate. Then I waited until the claimant answered, about a week."],
      [/what do you (actually )?(see|open)|what.*screen|leave out|not on that screen|in that system|what isn't/i, "The Policy desk shows the policy and the holder. It leaves out anything before 2019."],
      [/wrong|went wrong|nearly did|way out|then what happens when/i, "If the number is wrong I send it back to intake."],
      [/decide|decision|answers for|sign(s)? off|who is waiting/i, "I approve under five thousand; above that my lead decides."],
      [/assess|evidence|score|then what/i, "Assessing: I gather the evidence from the insurer portal — it leaves out attachments — and score it against the policy."],
      [/done|how do you know|what ends/i, "It's done when the decision is recorded with a reason."],
    ], fallback: "Sorry, what do you mean by that?" },
  { name: "Tom", role: "procurement lead", hidden: { purpose: "three vetted bids and a recommendation for the design director", outside: "the design director", jobs: [
      { name: "Reach out to approved vendors", who: "Tom", tool: { name: "vendor system", leaves: "anyone we haven't paid in three years" } },
      { name: "Research new vendors", who: "Tom", tasks: ["search agency directories", "shortlist"], wait: "until they reply, up to two weeks", exit: "if nobody good replies I widen the search" },
      { name: "Score the bids", who: "Tom", decision: "the director signs off the shortlist" } ] },
    answers: [
      [/tell me about the work|what is it|kicks this off|start/i, "The design director asked me to source bids for a design contract. I reach out to approved vendors in our system but also research potential vendors we haven't worked with. It depends on the nature of the work."],
      [/depends|two (most )?common cases/i, "If it's brand work I go outside; if it's product work our approved list is usually enough."],
      [/what do you (actually )?(see|open)|screen|leave out|in that system|what isn't/i, "The vendor system only shows anyone we've paid in the last three years. Older ones are gone."],
      [/research|where do you look|looked enough/i, "I search agency directories and shortlist. Then I wait until they reply, up to two weeks. If nobody good replies I widen the search."],
      [/while you wait|what ends|too long/i, "Two weeks is too long; after that I chase them or widen the search."],
      [/then what|what do you have in hand|who gets it/i, "Then I score the bids on a rubric and the director signs off the shortlist. She gets three bids and a recommendation."],
      [/decide|sign|answers for|score|rubric/i, "I score the bids on a rubric and the director signs off the shortlist."],
      [/what do you mean/i, "Sorry — I mean the director. She gets the three bids and a recommendation at the end."],
    ], fallback: "Sorry, what do you mean by that?" },
];

export function stakeholderAnswer(p: Persona, question: string, turn: number): string {
  for (const [re, a] of p.answers) if (re.test(question)) return a;
  return turn > 7 ? "That's it — I think you have it." : p.fallback;
}

export interface GymScore { persona: string; turns: number; elicited: number; possible: number; invented: number; repeated: number; leading: number; relevance: number; cards: number; coverage: number; transcript: Line[] }

const LEADING = /^(do you|did you|is it|is that|are you|would you say|so you|isn'?t it|don'?t you)\b/i;

/** Run one session: interviewer vs persona, up to maxTurns. Scores against the hidden board. */
export async function runGym(p: Persona, opts: { model?: Complete; maxTurns?: number } = {}): Promise<GymScore> {
  const b: Board = { ...emptyBoard("gym", "gym"), context: { outside: p.hidden.outside } };
  let ops: Op[] = [{ t: "board", id: "gym", title: "gym" }, { t: "setContext", context: { outside: p.hidden.outside } }];
  const lines: Line[] = []; const asked: string[] = []; let repeated = 0, leading = 0, relevant = 0, cardsN = 0; const accepted: Card[] = [];
  const max = opts.maxTurns ?? 10;
  let turn = await interviewFlow(F(ops), lines, null, opts.model);
  for (let i = 0; i < max; i++) {
    lines.push({ who: "interviewer", text: turn.reply });
    const q = turn.reply.replace(/^So: [^.]*\. /, "").replace(/^I'm an AI[^.]*\. /, "");
    if (LEADING.test(q)) leading++;
    if (asked.some((a) => similar(a, q))) repeated++; asked.push(q);
    if (turn.done) break;
    const a = stakeholderAnswer(p, turn.reply.replace(/^So: [^.]*\. /, ""), i);
    lines.push({ who: "person", text: a });
    const before = ops.length;
    turn = await interviewFlow(F(ops), lines, a, opts.model);
    for (const c of turn.cards) { cardsN++; if (c.ops.length) { ops.push(...c.ops); accepted.push(c); } }
    if (ops.length > before) relevant++;
    if (/that's it|you have it|that's about it/i.test(a)) { lines.push({ who: "interviewer", text: turn.reply }); break; }
  }
  const final = F(ops);
  // score: hidden facts elicited
  const facts: string[] = []; for (const j of p.hidden.jobs) { facts.push(`job:${j.name}`); for (const t of j.tasks ?? []) facts.push(`task:${t}`); if (j.tool) facts.push(`tool:${j.tool.name}`); if (j.wait) facts.push("wait"); if (j.decision) facts.push("gate"); if (j.exit) facts.push("exit"); }
  const names = final.jobs.filter((j) => !j.removed).map((j) => j.name.toLowerCase());
  const texts = final.jobs.flatMap((j) => [j.name, j.rationale ?? "", ...(j.tools ?? []).map((t) => t.name), ...(j.exits ?? []).map((e) => e.condition + " " + e.target), j.gate?.rule ?? ""]).join(" ").toLowerCase();
  let elicited = 0;
  for (const f of facts) { const [k, v] = f.split(":"); if (k === "job" || k === "task") { if (names.some((n) => overlap(n, v.toLowerCase()) >= 0.5) || overlap(texts, v.toLowerCase()) >= 0.5) elicited++; } else if (k === "tool") { if (texts.includes(v.toLowerCase())) elicited++; } else if (k === "wait") { if (final.jobs.some((j) => j.workKind === "wait") || /wait/.test(texts)) elicited++; } else if (k === "gate") { if (final.jobs.some((j) => j.gate)) elicited++; } else if (k === "exit") { if (final.jobs.some((j) => j.exits?.length)) elicited++; } }
  // invented: cards whose quote is not in what the person said
  const saidAll = lines.filter((l) => l.who === "person").map((l) => l.text.toLowerCase()).join(" ");
  const invented = accepted.filter((c) => c.quote && !saidAll.includes(c.quote.toLowerCase().slice(0, 30))).length;
  const turns = lines.filter((l) => l.who === "interviewer").length;
  return { persona: p.name, turns, elicited, possible: facts.length, invented, repeated, leading, relevance: turns ? relevant / Math.max(1, turns - 1) : 0, cards: cardsN, coverage: elicited / facts.length, transcript: lines };
}
function similar(a: string, b: string) { return overlap(a.toLowerCase(), b.toLowerCase()) > 0.8; }
function overlap(a: string, b: string) { const A = new Set(a.split(/\W+/).filter((w) => w.length > 3)), B = new Set(b.split(/\W+/).filter((w) => w.length > 3)); if (!B.size) return 0; let n = 0; for (const w of B) if (A.has(w)) n++; return n / B.size; }

export async function gymReport(model?: Complete) {
  const rows = []; for (const p of PERSONAS) rows.push(await runGym(p, { model }));
  const line = (r: GymScore) => `${r.persona.padEnd(6)} coverage ${(r.coverage * 100).toFixed(0).padStart(3)}% (${r.elicited}/${r.possible})  relevance ${(r.relevance * 100).toFixed(0).padStart(3)}%  invented ${r.invented}  repeated ${r.repeated}  leading ${r.leading}  turns ${r.turns}`;
  return { rows, text: rows.map(line).join("\n") };
}
