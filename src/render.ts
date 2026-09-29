import type { Board, Id, Job, Track } from "./model.js";
import { collectableRuns, handoffs, lint, loads, orderMap, type Finding } from "./derive.js";
import { FONT_CSS } from "./fonts/archivo.js";
import { T, fit, textWidth, wrap } from "./layout.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const tw = textWidth;

const CSS = `
:root{--stock:#eef1ee;--leaf:#f7f9f7;--ink:#14211c;--mute:#525c57;--seal:#0e6b4a;--bistre:#8c5209;--maple:#c4162b;--rule:rgba(20,33,28,.14);--rule2:rgba(20,33,28,.26);--tint:rgba(20,33,28,.045);--agent:#0e6b4a;--agent-fill:rgba(14,107,74,.10);--sys:#7a8580}
html,body{margin:0;background:var(--stock);color:var(--ink);font-family:'Archivo',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{padding:40px}
h1{margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-.015em}
p.goal{margin:0 0 26px;font-size:13px;color:var(--mute);max-width:80ch;line-height:1.45}
.wrap{overflow-x:auto}
svg{display:block;overflow:visible}
.track-name{font-size:12.5px;font-weight:600;fill:var(--ink)}.track-meta{font-size:11px;fill:var(--mute)}
.clip-title{font-size:12.5px;font-weight:600;letter-spacing:-.01em;fill:var(--ink)}.clip-meta{font-size:10.5px;fill:var(--mute)}
.art{font-size:10.5px;font-weight:500;fill:var(--ink)}.small{font-size:10.5px;fill:var(--mute)}.note{font-size:10.5px;fill:var(--ink)}
.track-bg{fill:var(--tint)}.col{stroke:var(--rule2);stroke-width:1;stroke-dasharray:1 5}
.clip{fill:var(--leaf);stroke:var(--ink);stroke-width:1.25}.clip.agent{fill:var(--agent-fill);stroke:var(--agent)}.clip.sys{fill:var(--stock);stroke:var(--sys)}
.clip.outside{fill:none;stroke:var(--ink);stroke-dasharray:3 3}.clip.ghost{fill:none;stroke:var(--rule2);stroke-dasharray:3 4}.clip.queue{fill:none;stroke:var(--ink);stroke-dasharray:3 4}
.clip.prov-agent{stroke-dasharray:none;stroke:rgba(20,33,28,.55)}.clip.agent.prov-agent{stroke:rgba(14,107,74,.6)}
.clip.prov-confirmed{stroke-width:1.5}.clip.agent.prov-confirmed{stroke:var(--agent);stroke-width:1.5}
.clip.prov-derived{stroke-dasharray:4 3}
.port{fill:var(--leaf);stroke:var(--ink);stroke-width:1.25}.port.agent{stroke:var(--agent)}
.wire{fill:none;stroke:var(--mute);stroke-width:1.5}.wire.soft{stroke:var(--rule2);stroke-dasharray:2 5}.wire.pull{stroke-dasharray:4 4}.wire.admit{stroke:var(--seal);stroke-width:2}
.g{fill:none;stroke:var(--ink);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.g.agent{stroke:var(--agent)}.g.sys{stroke:var(--sys)}.g.warn{stroke:var(--bistre)}
.gf{fill:var(--ink)}.gf.agent{fill:var(--agent)}.gf.warn{fill:var(--bistre)}
@media print{main{padding:0}.wrap{overflow:visible}}
`;

const SVG_CSS = CSS.split("\n").filter((l) => !/^(html,body|main|h1|p\.goal|\.wrap|svg\{|@media)/.test(l)).join("\n");
export const CSS_PARTS = {
  font: FONT_CSS,
  tokens: CSS.split("\n").filter((l) => /^:root|^html,body/.test(l)).join("\n"),
  svg: SVG_CSS.split("\n").filter((l) => !/^:root|^html,body/.test(l)).join("\n"),
};
const DEFS = `<defs>
<symbol id="person" viewBox="0 0 16 16"><circle class="g" cx="8" cy="5" r="3"/><path class="g" d="M2.5 14.5c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5"/></symbol>
<symbol id="agent" viewBox="0 0 16 16"><rect class="g agent" x="2.5" y="5" width="11" height="8.5" rx="2"/><circle class="gf agent" cx="6" cy="9.3" r="1.1"/><circle class="gf agent" cx="10" cy="9.3" r="1.1"/><path class="g agent" d="M8 5V2.8"/><circle class="gf agent" cx="8" cy="2.2" r="1"/></symbol>
<symbol id="system" viewBox="0 0 16 16"><ellipse class="g sys" cx="8" cy="4" rx="5.5" ry="2"/><path class="g sys" d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4"/><path class="g sys" d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/></symbol>
<symbol id="outside" viewBox="0 0 16 16"><circle class="g" cx="8" cy="8" r="5.5" stroke-dasharray="2 2"/><path class="g" d="M8 2.5v11M2.5 8h11"/></symbol>
<symbol id="t-event" viewBox="0 0 12 12"><path class="gf" d="M7 1L2.5 7h3l-.7 4L9.5 5h-3z"/></symbol>
<symbol id="t-clock" viewBox="0 0 12 12"><circle class="g" cx="6" cy="6" r="4.5"/><path class="g" d="M6 3.4V6l1.9 1.3"/></symbol>
<symbol id="t-chain" viewBox="0 0 12 12"><path class="g" d="M5 7.5 3.2 9.3a2 2 0 0 1-2.8-2.8L2.7 4.2a2 2 0 0 1 2.8 0"/><path class="g" d="M7 4.5l1.8-1.8a2 2 0 0 1 2.8 2.8L9.3 7.8a2 2 0 0 1-2.8 0"/></symbol>
<symbol id="t-hand" viewBox="0 0 12 12"><path class="gf" d="M3 1.5v9l2.4-2.3 1.5 3.3 1.5-.7-1.5-3.2H10z"/></symbol>
<symbol id="m-eye" viewBox="0 0 14 14"><path class="g" d="M1.5 7c1.6-3 3.5-4.5 5.5-4.5S10.9 4 12.5 7c-1.6 3-3.5 4.5-5.5 4.5S3.1 10 1.5 7z"/><circle class="g" cx="7" cy="7" r="1.8"/></symbol>
<symbol id="m-loop" viewBox="0 0 14 14"><path class="g" d="M11 7A4 4 0 1 1 9.5 3.9"/><path class="gf" d="M9 1.5 12 4 8.7 5.6z"/></symbol>
<symbol id="m-queue" viewBox="0 0 14 14"><path class="g" d="M2 4h10M2 7h10M2 10h10" stroke-dasharray="2 1.5"/></symbol>
<symbol id="m-unconfirmed" viewBox="0 0 14 14"><circle class="g" cx="7" cy="7" r="5.5" stroke-dasharray="2 2.2"/></symbol>
<symbol id="a-document" viewBox="0 0 12 12"><path class="g" d="M2.5 1.5h5l2 2v7h-7z" fill="var(--leaf)"/><path class="g" d="M4.5 6.5h3M4.5 8.5h3" stroke-width="1"/></symbol>
<symbol id="a-data" viewBox="0 0 12 12"><ellipse class="g" cx="6" cy="3.2" rx="4" ry="1.6" fill="var(--leaf)"/><path class="g" d="M2 3.2v6c0 .9 1.8 1.6 4 1.6s4-.7 4-1.6v-6" fill="var(--leaf)"/></symbol>
<symbol id="a-decision" viewBox="0 0 12 12"><path d="M6 1 11 6 6 11 1 6z" fill="var(--seal)"/></symbol>
<symbol id="a-message" viewBox="0 0 12 12"><rect class="g" x="1.5" y="2.5" width="9" height="7" rx="1" fill="var(--leaf)"/><path class="g" d="M2 3l4 3.2L10 3" stroke-width="1"/></symbol>
<symbol id="a-record" viewBox="0 0 12 12"><rect class="g" x="2" y="1.5" width="8" height="9" rx="1" fill="var(--leaf)"/><path class="g" d="M4 4.5h4M4 6.5h4M4 8.5h2" stroke-width="1"/></symbol>
<symbol id="a-other" viewBox="0 0 12 12"><circle class="g" cx="6" cy="6" r="4" fill="var(--leaf)"/></symbol>
<symbol id="m-more" viewBox="0 0 14 14"><circle class="gf" cx="3" cy="7" r="1.2"/><circle class="gf" cx="7" cy="7" r="1.2"/><circle class="gf" cx="11" cy="7" r="1.2"/></symbol>
<symbol id="m-opp" viewBox="0 0 14 14"><path class="g" d="M3 11 11 3M6 3h5v5" style="stroke:var(--seal)"/></symbol>
<symbol id="m-moved" viewBox="0 0 14 14"><path class="g warn" d="M2 10h10M9 7l3 3-3 3"/><path class="g warn" d="M12 4H2M5 1 2 4l3 3"/></symbol>
<symbol id="m-stale" viewBox="0 0 14 14"><circle class="g warn" cx="7" cy="7" r="5.5"/><path class="g warn" d="M7 3.8V7l2 1.4"/><path class="gf warn" d="M10.5 2.2l2 1.2-1.6 1.6z"/></symbol>
<symbol id="m-comment" viewBox="0 0 14 14"><path class="g" d="M2 3h10v7H6l-3 2.5V10H2z"/></symbol>
<symbol id="m-wait" viewBox="0 0 14 14"><path class="g warn" d="M3.5 2h7M3.5 12h7M4 2c0 3 3 3.6 3 5s-3 2-3 5M10 2c0 3-3 3.6-3 5s3 2 3 5"/></symbol>
<symbol id="m-parallel" viewBox="0 0 14 14"><path class="g" d="M4 2v10M7 2v10M10 2v10"/></symbol>
<symbol id="m-question" viewBox="0 0 14 14"><circle class="g warn" cx="7" cy="7" r="5.5"/><path class="g warn" d="M5.3 5.6A1.8 1.8 0 1 1 7.6 7.5c-.5.3-.6.6-.6 1.1"/><circle class="gf warn" cx="7" cy="10.4" r=".8"/></symbol>
</defs>`;

export interface RenderOptions {
  /** show pins and the footnote gutter */
  pins?: boolean;
  /** composite job ids to open in place: their tasks are drawn, and a region spans them */
  open?: Id[];
  /** pending proposals (entries) to show for acceptance */
  proposals?: import("./ops.js").Entry[];
  /** 0 = overview (names only), 1 = board, 2 = detail (every composite open) */
  level?: 0 | 1 | 2;
  /** job ids whose sources changed since they were described */
  stale?: Id[];
}

function columnsOf(b: Board, jobs: Job[], src: (id: Id) => Id, dst: (id: Id) => Id, seq: { from: Id; to: Id }[] = []): Map<Id, number> {
  const ids = new Set(jobs.map((j) => j.id));
  const order = orderMap(b);
  // a handoff to a job described earlier is a return, not a step forward
  const hs = [...handoffs(b).filter((h) => h.kind !== "loop").map((h) => ({ from: src(h.from), to: dst(h.to) })), ...seq].filter((h) => ids.has(h.from) && ids.has(h.to) && h.from !== h.to && (order.get(h.from) ?? 0) < (order.get(h.to) ?? 0));
  const preds = new Map<Id, Id[]>();
  for (const h of hs) preds.set(h.to, [...(preds.get(h.to) ?? []), h.from]);
  const col = new Map<Id, number>();
  const visiting = new Set<Id>();
  const depth = (id: Id): number => {
    if (col.has(id)) return col.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let d = 0;
    for (const p of preds.get(id) ?? []) d = Math.max(d, depth(p) + 1);
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  for (const j of jobs) depth(j.id);
  return col;
}

export function renderSVG(b: Board, opts: RenderOptions = {}): string {
  const pins = opts.pins ?? true;
  const open = new Set(opts.open ?? []);
  if ((opts.level ?? 1) === 2) for (const j of b.jobs) if (!j.removed && b.jobs.some((x) => x.parent === j.id && !x.removed)) open.add(j.id);
  const stale = new Set(opts.stale ?? []);
  const collectable = new Set(collectableRuns(b).flatMap((r) => r.tasks));
  // visible: top-level jobs that are not opened, plus the children of opened composites
  const hasKids = (id: Id) => b.jobs.some((x) => x.parent === id);
  const chainOpen = (j: Job): boolean => !j.parent || (open.has(j.parent) && chainOpen(b.jobs.find((x) => x.id === j.parent)!));
  const visible = (j: Job): boolean => !j.removed && chainOpen(j) && !(open.has(j.id) && hasKids(j.id));
  const jobs = b.jobs.filter(visible);
  const level = opts.level ?? 1;
  const top = (bb: Board, id: Id): Id => {
    let j = bb.jobs.find((x) => x.id === id);
    while (j?.parent && !open.has(j.parent)) j = bb.jobs.find((x) => x.id === j!.parent);
    return j?.id ?? id;
  };
  const ord = orderMap(b);
  const kidsOf = (id: Id) => jobs.filter((j) => j.parent === id).sort((a, c) => (ord.get(a.id) ?? 0) - (ord.get(c.id) ?? 0));
  const entryOf = (id: Id): Id => (open.has(id) && kidsOf(id).length ? entryOf(kidsOf(id)[0].id) : id);
  const exitOf = (id: Id): Id => (open.has(id) && kidsOf(id).length ? exitOf(kidsOf(id)[kidsOf(id).length - 1].id) : id);
  // handoffs declared on an opened composite itself enter at its first task and leave from its last
  const src = (id: Id) => { const t = top(b, id); return open.has(t) ? exitOf(t) : t; };
  const dst = (id: Id) => { const t = top(b, id); return open.has(t) ? entryOf(t) : t; };
  // tasks inside an open job follow each other in order until they have handoffs of their own
  const seq: { from: Id; to: Id }[] = [];
  for (const oid of open) { const k = kidsOf(oid); for (let i = 0; i + 1 < k.length; i++) seq.push({ from: k[i].id, to: k[i + 1].id }); }
  const colOf = columnsOf(b, jobs, src, dst, seq);
  const col = colOf;
  const ncol = Math.max(0, ...[...col.values()]) + 1;
  const tracks = b.tracks.filter((t) => !t.removed && jobs.some((j) => j.track === t.id));
  const findings = pins ? lint(b) : [];
  const pinByJob = new Map<Id, number>();
  const notes: string[] = [];
  const addNote = (about: Id, text: string) => {
    if (!pinByJob.has(about)) {
      pinByJob.set(about, notes.length + 1);
      notes.push(text);
    } else notes[pinByJob.get(about)! - 1] += " " + text;
  };
  for (const f of findings) {
    if (f.rule === "account-missing" && f.severity === "warn") continue;
    addNote(top(b, f.about), f.message);
  }
  if (pins) for (const q of b.questions) if (!q.answer && q.about && !q.id.startsWith("q:art:") && b.jobs.some((j) => j.id === q.about)) addNote(top(b, q.about), `Open question (${q.askedBy}): ${q.text}`);

  // measure
  const PAD = T.clipPadX;
  const meta = (j: Job) => {
    if (level === 0) return "";
    const bits: string[] = [];
    if (j.minutes) bits.push(j.minutes < 1 ? "<1 min" : j.minutes < 90 ? `${j.minutes} min` : j.minutes < 1440 ? `~${Math.round(j.minutes / 60)} h` : `~${Math.round(j.minutes / 1440)} d`);
    if (j.perWeek) bits.push(`${j.perWeek}/wk`);
    const kids = b.jobs.filter((x) => x.parent === j.id);
    if (kids.length) bits.push(`${kids.length} tasks`);
    if (j.exits?.length) bits.push(`${j.exits.length} exits`);
    if (j.loop) bits.push(j.loop.limit ? `retry ≤ ${j.loop.limit}` : "loops");
    if (j.tools?.length) bits.push(j.tools.map((t) => t.name).join(" · "));
    if (!bits.length && j.rationale) bits.push(j.rationale);
    if (!bits.length && j.doneWhen?.length) bits.push(j.doneWhen[0]);
    let s = bits.join(" · ");
    if (s.length > T.metaMaxChars) s = fit(s, T.metaMaxChars * T.metaSize * T.em, T.metaSize);
    return s;
  };
  const glyphW = (j: Job) => (j.trigger ? T.triggerGlyph + T.glyphGap : 0) + (j.kind === "watch" || j.kind === "queue" ? T.kindGlyph + T.glyphGap : 0);
  const width = (j: Job) => {
    const m = meta(j);
    const w = Math.max(tw(j.name, T.titleSize, T.titleWeight) + glyphW(j), tw(m, T.metaSize)) + 2 * PAD + (j.gate || j.exits?.length ? T.gateReserve : 0);
    return Math.max(T.columnMinWidth, Math.ceil(w) + 2);
  };
  const colw = Array(ncol).fill(T.columnMinWidth);
  for (const j of jobs) colw[col.get(j.id) ?? 0] = Math.max(colw[col.get(j.id) ?? 0], width(j));
  const GUT = T.columnGutter, X0 = T.labelColumn;
  const colx: number[] = [];
  let x = X0;
  for (const w of colw) {
    colx.push(x);
    x += w + GUT;
  }
  const W = x;
  const TH = T.trackHeight, TG = T.trackGap;
  // lanes: when clips collide in a track-column, the track grows a row rather than stacking them
  const rowOf = new Map<Id, number>();
  const rows = new Map<Id, number>();
  for (const t of tracks) {
    const used = new Map<number, number>();
    let max = 1;
    for (const j of jobs.filter((x) => x.track === t.id)) {
      const c = col.get(j.id) ?? 0;
      const r = used.get(c) ?? 0;
      rowOf.set(j.id, r);
      used.set(c, r + 1);
      max = Math.max(max, r + 1);
    }
    rows.set(t.id, max);
  }
  const th = (t: Track) => rows.get(t.id)! * TH;
  const ty = new Map<Id, number>();
  let yy = 0;
  for (const t of tracks) { ty.set(t.id, yy); yy += th(t) + TG; }
  const BH = yy;
  const pos = new Map<Id, { x: number; y: number; w: number; h: number }>();
  for (const j of jobs) {
    const c = col.get(j.id) ?? 0;
    const w = width(j), hasMeta = !!meta(j), h = hasMeta ? T.clipHeight : T.clipHeightSlim;
    pos.set(j.id, { x: colx[c], y: (ty.get(j.track) ?? 0) + rowOf.get(j.id)! * TH + (hasMeta ? T.clipPadTop : T.clipPadTopSlim), w, h });
  }

  const out: string[] = [];
  // columns and artifact labels
  const artAtCol = new Map<number, { name: string; kind: string }>();
  for (const h of handoffs(b)) if (h.artifact && h.kind === "artifact") {
    const c = col.get(top(b, h.to)) ?? 0;
    const from = col.get(top(b, h.from)) ?? 0;
    const a = b.artifacts.find((x) => x.id === h.artifact);
    if (a && from < c && (!artAtCol.has(c) || from === c - 1)) artAtCol.set(c, { name: a.name, kind: a.kind });
  }
  colx.forEach((cx, i) => {
    out.push(`<line class="col" x1="${cx - T.boardInset}" y1="-12" x2="${cx - T.boardInset}" y2="${BH}"/>`);
    const a = artAtCol.get(i);
    if (a) out.push(`<use href="#a-${a.kind}" x="${cx - T.boardInset - 6}" y="-30" width="12" height="12"/><text class="art" x="${cx - T.boardInset + 10}" y="-20">${esc(fit(a.name, colw[i] + GUT - 20, T.artifactSize))}</text>`);
  });
  for (const t of tracks) {
    const y = ty.get(t.id)!;
    out.push(`<rect class="track-bg" data-track="${esc(t.id)}" x="${X0 - T.boardInset}" y="${y}" width="${W - X0 + T.boardInset}" height="${th(t)}"/>`);
    const labelW = X0 - T.boardInset - T.trackNameX - 8;
    out.push(`<use href="#${t.kind}" x="0" y="${y + 22}" width="${T.trackGlyph}" height="${T.trackGlyph}"/><text class="track-name" x="${T.trackNameX}" y="${y + 29}">${esc(fit(t.name, labelW, T.trackNameSize, T.titleWeight))}</text>`);
    const ld = loads(b).find((l) => l.track === t.id);
    const metaLine = ld?.unknownJobs.length ? `Effort incomplete${t.meta ? ` · ${t.meta}` : ""}` : ld && ld.hours > 0 ? `${ld.hours.toFixed(1)} h/wk${ld.capacity ? ` of ${ld.capacity}` : ""}${t.meta ? ` · ${t.meta}` : ""}` : t.meta;
    if (metaLine) out.push(`<text class="track-meta" x="${T.trackNameX}" y="${y + 43}"${ld?.over ? ' style="fill:var(--maple)"' : ""}>${esc(fit(metaLine, labelW, T.trackMetaSize))}</text>`);
  }
  // wires
  const port = (id: Id, side: "in" | "out") => {
    const p = pos.get(top(b, id))!;
    return [side === "in" ? p.x : p.x + p.w, p.y + p.h / 2] as const;
  };
  // one wire per (consumer, artifact): the producer in the nearest earlier column wins
  const hsAll = handoffs(b).map((h) => ({ ...h, A: src(h.from), B: dst(h.to) })).filter((h) => h.A !== h.B && pos.has(h.A) && pos.has(h.B));
  for (const e of seq) if (!hsAll.some((h) => h.A === e.from && h.B === e.to)) hsAll.push({ from: e.from, to: e.to, kind: "artifact", A: e.from, B: e.to } as any);
  const best = new Map<string, (typeof hsAll)[number]>();
  for (const h of hsAll) {
    const k = h.kind === "artifact" ? `${h.B}:${h.artifact}` : `${h.A}>${h.B}:${h.kind}:${h.condition ?? ""}`;
    const cur = best.get(k);
    const gap = (col.get(h.B) ?? 0) - (col.get(h.A) ?? 0);
    const curGap = cur ? (col.get(cur.B) ?? 0) - (col.get(cur.A) ?? 0) : Infinity;
    if (!cur || (gap > 0 && (curGap <= 0 || gap < curGap))) best.set(k, h);
  }
  for (const h of best.values()) {
    const A = h.A, B = h.B;
    const [ax, ay] = port(A, "out"), [bx, by] = port(B, "in");
    const toJ = b.jobs.find((j) => j.id === B)!, fromJ = b.jobs.find((j) => j.id === A)!;
    const gate = !!fromJ.gate && h.kind === "exit";
    const cls = h.kind === "loop" ? "wire soft" : gate ? "wire admit" : toJ.trigger === "hand" ? "wire pull" : fromJ.kind === "outside" || toJ.kind === "outside" ? "wire soft" : "wire";
    let d: string;
    const cA = col.get(A) ?? 0, cB = col.get(B) ?? 0;
    if (h.kind === "loop" || bx < ax) {
      const [ax2] = port(A, "in");
      const mid = Math.max(ay, by) + T.wireLoopDrop;
      d = `M${ax2} ${ay + 10} C ${ax2 - 30} ${mid}, ${bx + 30} ${mid}, ${bx} ${by + 10}`;
    } else if (cA === cB) {
      const p0 = pos.get(A)!, p1 = pos.get(B)!;
      d = `M${p0.x + p0.w / 2} ${p1.y > p0.y ? p0.y + p0.h : p0.y} V ${p1.y > p0.y ? p1.y : p1.y + p1.h}`;
    } else if (cB - cA === 1 || Math.abs(by - ay) < 2) {
      const mx = (ax + bx) / 2;
      d = `M${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
    } else {
      // spans columns: travel along the row with fewer clips in the way, and turn in a gutter
      const between = (trackId: Id) => jobs.filter((j) => j.track === trackId && (col.get(j.id) ?? 0) > cA && (col.get(j.id) ?? 0) < cB).length;
      const useSourceRow = between(fromJ.track) <= between(toJ.track);
      const gx = useSourceRow ? colx[cB] - GUT / 2 : colx[cA + 1] - GUT / 2; // last gutter, or first
      const r = 10, dir = by > ay ? 1 : -1;
      d = `M${ax} ${ay} H ${gx - r} Q ${gx} ${ay} ${gx} ${ay + dir * r} V ${by - dir * r} Q ${gx} ${by} ${gx + r} ${by} H ${bx}`;
    }
    const share = h.kind === "exit" ? fromJ.exits?.find((e) => e.condition === h.condition)?.share : undefined;
    const op = share !== undefined ? ` style="opacity:${Math.max(0.25, Math.min(1, 0.25 + share))}"` : "";
    out.push(`<path class="${cls}" data-from="${esc(A)}" data-to="${esc(B)}"${op} d="${d}"/>`);
  }
  // regions for opened composites
  for (const oid of open) {
    const kids = jobs.filter((j) => j.parent === oid).map((j) => pos.get(j.id)!).filter(Boolean);
    const parent = b.jobs.find((j) => j.id === oid);
    if (!kids.length || !parent) continue;
    const x0 = Math.min(...kids.map((k) => k.x)) - 12, x1 = Math.max(...kids.map((k) => k.x + k.w)) + 12;
    const y0 = Math.min(...kids.map((k) => k.y)) - 26, y1 = Math.max(...kids.map((k) => k.y + k.h)) + 10;
    out.push(`<rect data-region="${esc(oid)}" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="4" fill="rgba(14,107,74,.05)" stroke="var(--seal)" stroke-width="1.25"/>`);
    out.push(`<text class="clip-title" x="${x0 + 10}" y="${y0 + 16}" style="fill:var(--seal)">${esc(fit(parent.name, (x1 - x0) / 2, T.titleSize, T.titleWeight))}</text>`);
    if (parent.beneficiary) out.push(`<text class="clip-meta" x="${x0 + 10 + tw(parent.name, T.titleSize, T.titleWeight) + 12}" y="${y0 + 16}">${esc(fit(`for ${parent.beneficiary}`, (x1 - x0) / 2 - 20, T.metaSize))}</text>`);
  }
  // clips
  for (const j of jobs) {
    const p = pos.get(j.id)!;
    const t = b.tracks.find((x) => x.id === j.track);
    out.push(`<g class="job" data-job="${esc(j.id)}" data-track="${esc(j.track)}" data-col="${col.get(j.id) ?? 0}"${j.parent ? ` data-parent="${esc(j.parent)}"` : ""}${b.jobs.some((x) => x.parent === j.id && !x.removed) ? ' data-composite="1"' : ""}>`);
    const kind = j.kind ?? "work";
    const cls = kind === "ghost" ? "clip ghost" : kind === "queue" ? "clip queue" : kind === "outside" || t?.kind === "outside" ? "clip outside" : t?.kind === "agent" ? "clip agent" : t?.kind === "system" || kind === "store" ? "clip sys" : "clip";
    const composite = b.jobs.some((x) => x.parent === j.id);
    if (composite) out.push(`<rect class="${cls}" x="${p.x + T.compositeShadow}" y="${p.y + T.compositeShadow}" width="${p.w}" height="${p.h}" rx="${T.clipRadius}" style="fill:var(--stock)"/>`);
    const prov = j.status === "confirmed" || j.provenance.source === "confirmed" ? "prov-confirmed" : j.provenance.source === "human" ? "prov-human" : j.provenance.source === "derived" ? "prov-derived" : "prov-agent";
    out.push(`<rect class="${cls} ${prov}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${T.clipRadius}"/>`);
    if (kind === "work") out.push(`<circle class="port${t?.kind === "agent" ? " agent" : ""}" cx="${p.x}" cy="${p.y + p.h / 2}" r="${T.portRadius}"/>`);
    const exits = j.exits?.length ?? 0;
    if (j.gate || exits) {
      const n = Math.max(1, exits);
      const nh = p.h / n;
      j.exits?.length
        ? j.exits.forEach((e, i) => out.push(`<path d="M${p.x + p.w} ${p.y + i * nh}v${nh}l-${T.notchDepth}-${nh / 2}z" fill="${e.target ? "var(--seal)" : "var(--bistre)"}"/>`))
        : out.push(`<path d="M${p.x + p.w} ${p.y}v${p.h}l-${T.notchDepthSingle}-${p.h / 2}z" fill="var(--seal)"/>`);
    }
    let tx = p.x + PAD;
    if (j.trigger) {
      out.push(`<use href="#t-${j.trigger}" x="${tx}" y="${p.y + 8}" width="${T.triggerGlyph}" height="${T.triggerGlyph}"/>`);
      tx += T.triggerGlyph + T.glyphGap;
    }
    if (kind === "watch") { out.push(`<use href="#m-eye" x="${tx}" y="${p.y + 8}" width="${T.kindGlyph}" height="${T.kindGlyph}"/>`); tx += T.kindGlyph + T.glyphGap; }
    if (kind === "queue") { out.push(`<use href="#m-queue" x="${tx}" y="${p.y + 8}" width="${T.kindGlyph}" height="${T.kindGlyph}"/>`); tx += T.kindGlyph + T.glyphGap; }
    const titleCls = kind === "ghost" || kind === "queue" || kind === "store" ? "clip-meta" : "clip-title";
    const inner = p.x + p.w - PAD - (j.gate || j.exits?.length ? T.gateReserve : 0);
    out.push(`<text class="${titleCls}" x="${tx}" y="${p.y + 18}">${esc(fit(j.name, inner - tx, T.titleSize, T.titleWeight))}</text>`);
    const m = meta(j);
    if (m) out.push(`<text class="clip-meta" x="${p.x + PAD}" y="${p.y + 34}">${esc(fit(m, inner - p.x - PAD, T.metaSize))}</text>`);
    // marks sit in a row above the clip's right edge, pin last and outermost
    // marks, by priority; at most three on the clip, the rest in the peek
    const all: string[] = [];
    if (stale.has(j.id)) all.push("m-stale");
    if (j.movedFrom) all.push("m-moved");
    if (collectable.has(j.id)) all.push("m-opp");
    if (j.trigger === "hand" && t?.kind === "person") all.push("m-wait");
    if (j.loop) all.push("m-loop");
    if (b.comments.some((c) => c.about === j.id)) all.push("m-comment");
    const marks = all.slice(0, 3);
    if (all.length > 3) marks.push("m-more");
    if (/parallel|burst|concurren|×\d/i.test(j.rationale ?? "")) marks.push("m-parallel");
    const pin = pinByJob.get(j.id);
    let mx = p.x + p.w - 9 - (pin ? T.pinRadius * 2 + 2 : 0) - (marks.length - 1) * T.markStep;
    for (const m of marks) { out.push(`<use href="#${m}" x="${mx - T.markSize / 2}" y="${p.y - T.markRise}" width="${T.markSize}" height="${T.markSize}"/>`); mx += T.markStep; }
    if (pin) out.push(`<circle cx="${p.x + p.w - 2}" cy="${p.y - 2}" r="${T.pinRadius}" fill="var(--bistre)"/><text x="${p.x + p.w - 2}" y="${p.y + 1.5}" text-anchor="middle" style="font-size:9px;font-weight:600;fill:var(--leaf)">${pin}</text>`);
    out.push(`</g>`);
  }
  // gutter
  let fy = BH + T.gutterTop;
  notes.forEach((n, i) => {
    out.push(`<circle cx="7" cy="${fy - 4}" r="${T.pinRadius}" fill="var(--bistre)"/><text x="7" y="${fy - 0.5}" text-anchor="middle" style="font-size:9px;font-weight:600;fill:var(--leaf)">${i + 1}</text>`);
    for (const line of wrap(n)) { out.push(`<text class="note" x="22" y="${fy}">${esc(line)}</text>`); fy += T.gutterLine; }
  });
  const openQs = b.questions.filter((q) => !q.answer);
  if (openQs.length) {
    fy += 8;
    out.push(`<text class="small" x="0" y="${fy}">${openQs.length} open question${openQs.length > 1 ? "s" : ""} — answer below, or in the brief.</text>`);
    fy += 18;
  }
  const H = fy + 12;
  const font = `<style>${FONT_CSS}${SVG_CSS} svg{font-family:'Archivo',system-ui,sans-serif}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -40 ${W} ${H + 40}" width="${W}" height="${H + 40}" style="background:#eef1ee">${font}${DEFS}${out.join("\n")}</svg>`;
}

function top(b: Board, id: Id): Id {
  let j = b.jobs.find((x) => x.id === id);
  while (j?.parent) j = b.jobs.find((x) => x.id === j!.parent);
  return j?.id ?? id;
}

function composites(b: Board, opts: RenderOptions): string {
  const comp = b.jobs.filter((j) => !j.removed && !j.parent && b.jobs.some((x) => x.parent === j.id && !x.removed));
  if (!comp.length) return "";
  const open = new Set(opts.open ?? []);
  if ((opts.level ?? 1) === 2) for (const j of b.jobs) if (!j.removed && b.jobs.some((x) => x.parent === j.id && !x.removed)) open.add(j.id);
  const stale = new Set(opts.stale ?? []);
  const collectable = new Set(collectableRuns(b).flatMap((r) => r.tasks));
  return `<p style="font-size:12px;color:var(--mute)">Open in place: ${comp.map((j) => open.has(j.id) ? `<a href="?open=${[...open].filter((x) => x !== j.id).join(",")}">close ${esc(j.name)}</a>` : `<a href="?open=${[...open, j.id].join(",")}">${esc(j.name)}</a>`).join(" · ")}</p>`;
}
const btn = (attrs: string, label: string, seal = false) => `<button ${attrs} style="font:inherit;font-size:11px;margin:2px 6px 2px 0;padding:5px 9px;border:1px solid var(--${seal ? "seal" : "ink"});color:var(--${seal ? "seal" : "ink"});background:none;cursor:pointer">${label}</button>`;
const sel = (name: string, opts: { v: string; l: string }[]) => `<select name="${name}" style="font:inherit;font-size:12px;padding:5px;border:1px solid var(--rule2);background:var(--leaf)">${opts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join("")}</select>`;
const inp = (name: string, ph: string, w = 28) => `<input name="${name}" placeholder="${esc(ph)}" style="font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--rule2);background:var(--leaf);width:${w}ch">`;
const OPJS = `<script>window.__op=async(ops)=>{await fetch('/op'+location.search,{method:'POST',body:JSON.stringify(ops)});location.reload();};
window.__form=(f)=>Object.fromEntries(new FormData(f).entries());</script>`;

function proposalsPanel(b: Board, opts: RenderOptions): string {
  const ps = opts.proposals ?? [];
  if (!ps.length) return "";
  const line = (e: import("./ops.js").Entry) => {
    const o = e.op as any;
    const j = (id: string) => b.jobs.find((x) => x.id === id)?.name ?? id;
    if (o.t === "job") return `replace "${j(o.job.id)}" with a new description (${o.job.name})`;
    if (o.t === "updateJob") return `change "${j(o.id)}": ${Object.entries(o.patch).map(([k, v]) => `${k} → ${JSON.stringify(v)}`).join(", ")}`;
    if (o.t === "removeJob") return `remove "${j(o.id)}"`;
    if (o.t === "comment") return `— ${o.comment.text}`;
    return `${o.t}`;
  };
  return `<section style="margin-top:28px;max-width:90ch"><h2 style="font-size:15px;margin:0 0 10px">Proposals · ${ps.length}</h2>${ps.map((e) => `<div style="margin:0 0 10px;font-size:13px"><span style="color:var(--mute);font-size:12px">${esc(e.by)} proposes</span><br>${esc(line(e))}<br>${btn(`onclick="__op([{t:'accept',seq:${e.seq}}])"`, "Accept", true)}${btn(`onclick="__op([{t:'reject',seq:${e.seq}}])"`, "Reject")}</div>`).join("")}</section>`;
}

function editPanel(b: Board): string {
  const trackOpts = b.tracks.map((t) => ({ v: t.id, l: t.name }));
  const jobOpts = b.jobs.filter((j) => !j.parent).map((j) => ({ v: j.id, l: j.name }));
  const jobBoxes = b.jobs.filter((j) => !j.parent).map((j) => `<label style="font-size:12px;margin-right:12px;white-space:nowrap"><input type="checkbox" name="ids" value="${esc(j.id)}"> ${esc(j.name)}</label>`).join("");
  return `<section style="margin-top:28px;max-width:100ch"><h2 style="font-size:15px;margin:0 0 10px">Edit</h2>
<div style="display:grid;gap:14px;font-size:13px">
<form onsubmit="event.preventDefault();const f=__form(this);__op([{t:'track',track:{id:f.id||f.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:f.name,kind:f.kind,meta:f.meta||undefined}}])"><b>Add a track</b> &nbsp; ${inp("name", "name", 18)} ${sel("kind", [{ v: "person", l: "person" }, { v: "agent", l: "agent" }, { v: "system", l: "system" }, { v: "outside", l: "outside" }])} ${inp("meta", "one line, optional", 28)} ${btn('type="submit"', "Add")}</form>
<form onsubmit="event.preventDefault();const f=__form(this);__op([{t:'job',job:{id:f.id||f.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:f.name,track:f.track,trigger:f.trigger||undefined,inputs:[],outputs:[],provenance:{source:'human',by:'human'},status:'confirmed'}}])"><b>Add a job</b> &nbsp; ${inp("name", "what it achieves", 24)} on ${sel("track", trackOpts)} starts when ${sel("trigger", [{ v: "hand", l: "a person gets to it" }, { v: "event", l: "something arrives" }, { v: "chain", l: "the previous one ends" }, { v: "clock", l: "a schedule fires" }])} ${btn('type="submit"', "Add")}</form>
<form onsubmit="event.preventDefault();const f=__form(this);__op([{t:'updateJob',id:f.job,patch:{track:f.track}}])"><b>Move a job</b> &nbsp; ${sel("job", jobOpts)} to ${sel("track", trackOpts)} ${btn('type="submit"', "Move")}</form>
<form onsubmit="event.preventDefault();const f=__form(this);__op([{t:'updateJob',id:f.job,patch:{name:f.name}}])"><b>Rename</b> &nbsp; ${sel("job", jobOpts)} ${inp("name", "new name", 24)} ${btn('type="submit"', "Rename")}</form>
<form onsubmit="event.preventDefault();const f=new FormData(this);const ids=f.getAll('ids');if(ids.length<2)return;const id=f.get('id')||String(f.get('name')).toLowerCase().replace(/[^a-z0-9]+/g,'-');__op([{t:'job',job:{id,name:f.get('name'),track:f.get('track'),inputs:[],outputs:[],provenance:{source:'human',by:'human'},status:'confirmed'}},...ids.map(x=>({t:'updateJob',id:x,patch:{parent:id}}))])"><b>Collect into a job</b> &nbsp; ${inp("name", "name the job by its outcome", 26)} on ${sel("track", trackOpts)} ${btn('type="submit"', "Collect", true)}<div style="margin-top:6px">${jobBoxes}</div></form>
<form onsubmit="event.preventDefault();const f=__form(this);__op([{t:'removeJob',id:f.job}])"><b>Remove</b> &nbsp; ${sel("job", jobOpts)} ${btn('type="submit"', "Remove")}</form>
</div></section>${OPJS}`;
}

function commentsPanel(b: Board): string {
  const name = (id: string) => (id === "board" ? "the board" : b.jobs.find((j) => j.id === id)?.name ?? b.tracks.find((t) => t.id === id)?.name ?? id);
  const list = b.comments.map((c) => `<div style="margin:0 0 8px;font-size:13px"><span style="font-size:12px;color:var(--mute)">${esc(c.by)} on ${esc(name(c.about))}</span><br>${esc(c.text)}</div>`).join("");
  const about = [{ v: "board", l: "the board" }, ...b.jobs.filter((j) => !j.parent).map((j) => ({ v: j.id, l: j.name })), ...b.tracks.map((t) => ({ v: t.id, l: t.name }))];
  return `<section style="margin-top:28px;max-width:80ch"><h2 style="font-size:15px;margin:0 0 10px">Comments · ${b.comments.length}</h2>${list}
<form onsubmit="event.preventDefault();const f=__form(this);__op([{t:'comment',comment:{id:'c:'+Date.now(),about:f.about,by:'human',text:f.text,at:new Date().toISOString()}}])" style="font-size:13px;margin-top:8px">on ${sel("about", about)} ${inp("text", "say it", 40)} ${btn('type="submit"', "Comment")}</form></section>`;
}

function questionsForm(b: Board): string {
  const open = b.questions.filter((q) => !q.answer);
  const drafts = b.jobs.filter((j) => !j.removed && j.status === "draft" && !j.parent && j.kind !== "ghost" && j.kind !== "outside");
  if (!open.length && !drafts.length) return "";
  const q = open.map((x) => `<div style="margin:0 0 14px"><div style="font-size:12px;color:var(--bistre)">${x.askedBy} asks${x.about ? ` · ${esc(b.jobs.find((j) => j.id === x.about)?.name ?? "")}` : ""}</div><div style="font-size:13px;margin:2px 0 6px">${esc(x.text)}</div><textarea data-q="${esc(x.id)}" style="width:min(70ch,100%);font:inherit;font-size:12px;padding:8px;border:1px solid var(--rule2);background:var(--leaf)" rows="2" placeholder="Answer in place. Your answer is recorded as yours."></textarea><br><button data-answer="${esc(x.id)}" style="font:inherit;font-size:11px;margin-top:6px;padding:6px 10px;border:1px solid var(--seal);color:var(--seal);background:none;cursor:pointer">Answer</button></div>`).join("");
  const d = drafts.length ? `<div style="font-size:12px;color:var(--mute);margin-top:18px">Drafts said by the agent, not yet confirmed: ${drafts.map((j) => `<button data-confirm="${esc(j.id)}" style="font:inherit;font-size:11px;margin:2px 4px 2px 0;padding:4px 8px;border:1px solid var(--ink);background:none;cursor:pointer">confirm ${esc(j.name)}</button>`).join("")}</div>` : "";
  return `<section style="margin-top:28px;max-width:80ch"><h2 style="font-size:15px;margin:0 0 12px">Open questions · ${open.length}</h2>${q}${d}</section>
<script>document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=async()=>{const id=b.dataset.answer;const t=document.querySelector('[data-q="'+id+'"]').value.trim();if(!t)return;await fetch('/answer'+location.search,{method:'POST',body:JSON.stringify({id,answer:t})});location.reload();});
document.querySelectorAll('[data-confirm]').forEach(b=>b.onclick=async()=>{await fetch('/answer'+location.search,{method:'POST',body:JSON.stringify({confirm:b.dataset.confirm})});location.reload();});</script>`;
}

export function renderHTML(b: Board, opts: RenderOptions = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.title)} · staves</title>
<style>${FONT_CSS}${CSS}</style></head><body><main>
<h1>${esc(b.title)}</h1><p class="goal">${esc(b.goal ?? "")}${b.origin ? ` <span style="opacity:.7">· ${esc(b.origin)}</span>` : ""}</p>
<div class="wrap">${renderSVG(b, opts)}</div>
${composites(b, opts)}
${proposalsPanel(b, opts)}
${questionsForm(b)}
${editPanel(b)}
${commentsPanel(b)}
</main>
<script>
(async()=>{let last=null;setInterval(async()=>{try{const r=await fetch('/version',{cache:'no-store'});const v=await r.text();if(last&&v!==last)location.reload();last=v;}catch(e){}},1500)})();
</script></body></html>`;
}

export type { Finding };
