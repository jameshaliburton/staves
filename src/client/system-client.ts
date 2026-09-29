/* The system map: boards as cards, handoffs between them as flowing links, shared people and agents as threads. d3-force. */
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from "d3-force";
import { select, selectAll } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { drag } from "d3-drag";
import { linkHorizontal } from "d3-shape";
import "d3-transition";

type Node = { id: string; title: string; for: string; jobs: number; people: number; agents: number; systems: number; errors: number; entry: string; outs: { id: string; name: string }[]; ins: { id: string; name: string }[]; x?: number; y?: number; fx?: number | null; fy?: number | null; kind?: "board" | "thread"; threadKind?: string; boards?: string[] };
type Edge = { from: string; to: string; what: string; kind: "handoff" | "link" | "thread"; source?: any; target?: any };

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const KIND_COLOR: Record<string, string> = { person: "#d9c9a6", agent: "#4fcb92", system: "#8d9791", outside: "#8fa3b8", team: "#d9c9a6", build: "#8d9791" };

async function main() {
  const data = await (await fetch("./system.json")).json() as { nodes: Node[]; edges: Edge[]; threads: { name: string; kind: string; boards: string[] }[] };
  const svg = select("#map"); const W = window.innerWidth, H = window.innerHeight - 44;
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const g = svg.append("g");
  const nodes: Node[] = [...data.nodes.map((n) => ({ ...n, kind: "board" as const })), ...data.threads.map((t) => ({ id: `who:${t.name}`, title: t.name, kind: "thread" as const, threadKind: t.kind, boards: t.boards, for: "", jobs: 0, people: 0, agents: 0, systems: 0, errors: 0, entry: "", outs: [], ins: [] }))];
  const edges: Edge[] = [...data.edges.map((e) => ({ ...e })), ...data.threads.flatMap((t) => t.boards.map((b) => ({ from: `who:${t.name}`, to: b, what: t.name, kind: "thread" as const })))];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = edges.map((e) => ({ ...e, source: byId.get(e.from)!, target: byId.get(e.to)! })).filter((e) => e.source && e.target);
  // defs: glow + arrow
  const defs = svg.append("defs");
  defs.append("marker").attr("id", "arrow").attr("viewBox", "0 -5 10 10").attr("refX", 10).attr("refY", 0).attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto").append("path").attr("d", "M0,-4L10,0L0,4").attr("fill", "#f0a35e");
  const glow = defs.append("filter").attr("id", "glow"); glow.append("feGaussianBlur").attr("stdDeviation", "6").attr("result", "b"); const m = glow.append("feMerge"); m.append("feMergeNode").attr("in", "b"); m.append("feMergeNode").attr("in", "SourceGraphic");
  // layout
  const sim = forceSimulation(nodes as any).force("link", forceLink(links as any).id((d: any) => d.id).distance((l: any) => (l.kind === "thread" ? 170 : 340)).strength((l: any) => (l.kind === "thread" ? 0.2 : 0.5)))
    .force("charge", forceManyBody().strength((d: any) => (d.kind === "thread" ? -300 : -2600)))
    .force("collide", forceCollide().radius((d: any) => (d.kind === "thread" ? 44 : 150)).strength(1))
    .force("center", forceCenter(W / 2, H / 2)).force("x", forceX(W / 2).strength(0.03)).force("y", forceY(H / 2).strength(0.05));
  // links
  const linkG = g.append("g");
  const path = linkG.selectAll("path").data(links).enter().append("path").attr("class", (d: any) => `link ${d.kind === "link" ? "explicit" : d.kind}`).attr("marker-end", (d: any) => (d.kind === "thread" ? null : "url(#arrow)")).style("opacity", 0);
  path.transition().delay((_d, i) => 300 + i * 40).duration(600).style("opacity", 1);
  const label = linkG.selectAll("text").data(links.filter((l) => l.kind !== "thread")).enter().append("text").attr("class", "llabel").text((d: any) => d.what);
  // nodes
  const node = g.append("g").selectAll("g").data(nodes).enter().append("g").attr("class", (d: any) => `node ${d.kind}`).style("opacity", 0).call(drag<any, any>().filter((ev: any) => !ev.shiftKey && !ev.button).on("start", (ev, d: any) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }).on("drag", (ev, d: any) => { d.fx = ev.x; d.fy = ev.y; }).on("end", (ev, d: any) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }) as any);
  node.transition().delay((_d, i) => i * 60).duration(700).style("opacity", 1);
  const boards = node.filter((d: any) => d.kind === "board");
  boards.append("rect").attr("class", "card").attr("x", -120).attr("y", -50).attr("width", 240).attr("height", 100).attr("rx", 12);
  boards.append("text").attr("class", "title").attr("x", -104).attr("y", -24).each(function (d: any) { wrap(select(this), d.title, 26, 2); });
  boards.append("text").attr("class", "for").attr("x", -104).attr("y", 18).text((d: any) => (d.for ? `for ${d.for}` : d.entry || ""));
  boards.append("g").attr("class", "meta").attr("transform", "translate(-104,40)").each(function (d: any) { const gg = select(this); const items = [[d.jobs, "jobs"], [d.people, "people"], [d.agents, "agents"], [d.systems, "systems"]].filter((x) => (x[0] as number) > 0); let x = 0; for (const [n, l] of items) { gg.append("text").attr("x", x).attr("class", "m").text(`${n} ${l}`); x += 14 + String(n).length * 7 + (l as string).length * 6.2; } if (d.errors) gg.append("circle").attr("cx", 208).attr("cy", -6).attr("r", 9).attr("fill", "#e5484d"), gg.append("text").attr("x", 208).attr("y", -3).attr("class", "err").text(d.errors); });
  boards.on("click", (_ev, d: any) => { location.href = `./?board=${encodeURIComponent(d.id)}`; }).style("cursor", "pointer");
  const threads = node.filter((d: any) => d.kind === "thread");
  threads.append("circle").attr("r", 22).attr("class", "tcirc").attr("stroke", (d: any) => KIND_COLOR[d.threadKind] ?? "#aaa");
  threads.append("text").attr("class", "tname").attr("y", 38).text((d: any) => d.title);
  threads.append("text").attr("class", "tglyph").attr("y", 5).text((d: any) => ({ person: "👤", agent: "◈", system: "▣", outside: "◎" } as any)[d.threadKind] ?? "•");
  // hover: light the neighbourhood
  node.on("mouseenter", (_ev, d: any) => { const near = new Set([d.id, ...links.filter((l) => l.source.id === d.id || l.target.id === d.id).flatMap((l) => [l.source.id, l.target.id])]); node.classed("dim", (x: any) => !near.has(x.id)); path.classed("dim", (l: any) => !(l.source.id === d.id || l.target.id === d.id)).classed("lit", (l: any) => l.source.id === d.id || l.target.id === d.id); label.classed("dim", (l: any) => !(l.source.id === d.id || l.target.id === d.id)); })
    .on("mouseleave", () => { node.classed("dim", false); path.classed("dim", false).classed("lit", false); label.classed("dim", false); });
  // connect: shift-drag from a board to another → a handoff between them
  let from: Node | null = null; const rubber = g.append("path").attr("class", "rubber").style("display", "none");
  boards.on("mousedown.connect", (ev: MouseEvent, d: any) => { if (!ev.shiftKey) return; ev.stopPropagation(); from = d; rubber.style("display", null); });
  svg.on("mousemove.connect", (ev: MouseEvent) => { if (!from) return; const [mx, my] = pointer(ev); rubber.attr("d", curve(from.x!, from.y!, mx, my)); });
  svg.on("mouseup.connect", (ev: MouseEvent) => { if (!from) return; const [mx, my] = pointer(ev); const to = nodes.find((n) => n.kind === "board" && n !== from && Math.abs(n.x! - mx) < 125 && Math.abs(n.y! - my) < 55); rubber.style("display", "none"); if (to) connectSheet(from, to); from = null; });
  const zm = zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 2.5]).on("zoom", (ev) => g.attr("transform", ev.transform)); svg.call(zm as any);
  function pointer(ev: MouseEvent) { const t = (svg.node() as any).__zoom ?? zoomIdentity; const r = (svg.node() as SVGSVGElement).getBoundingClientRect(); return t.invert([ev.clientX - r.left, ev.clientY - r.top]); }
  const line = linkHorizontal();
  const HW = 120, HH = 50;
  function curve(ax: number, ay: number, bx: number, by: number) { const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) >= Math.abs(dy) * 1.2) { const sx = dx >= 0 ? ax + HW : ax - HW, tx = dx >= 0 ? bx - HW - 4 : bx + HW + 4; const c = Math.max(70, Math.abs(tx - sx) * 0.5); const sg = Math.sign(dx || 1); return `M${sx},${ay} C${sx + sg * c},${ay} ${tx - sg * c},${by} ${tx},${by}`; }
    const sy = dy >= 0 ? ay + HH : ay - HH, ty = dy >= 0 ? by - HH - 4 : by + HH + 4; const c = Math.max(60, Math.abs(ty - sy) * 0.5); const sg = Math.sign(dy || 1); return `M${ax},${sy} C${ax},${sy + sg * c} ${bx},${ty - sg * c} ${bx},${ty}`; }
  sim.on("tick", () => { path.attr("d", (l: any) => (l.kind === "thread" ? `M${l.source.x},${l.source.y}L${l.target.x},${l.target.y}` : curve(l.source.x, l.source.y, l.target.x, l.target.y))); label.attr("x", (l: any) => (l.source.x + l.target.x) / 2).attr("y", (l: any) => (l.source.y + l.target.y) / 2 - 10); node.attr("transform", (d: any) => `translate(${d.x},${d.y})`); });
  $("#count").textContent = `${data.nodes.length} boards · ${data.edges.length} handoffs between them · ${data.threads.length} shared`;
  if (!data.nodes.length) $("#empty").style.display = "grid";
  async function connectSheet(a: Node, b: Node) {
    const fa = await (await fetch(`./board.json?board=${encodeURIComponent(a.id)}`)).json(); const fb = await (await fetch(`./board.json?board=${encodeURIComponent(b.id)}`)).json();
    const ja = fa.jobs.filter((j: any) => !j.removed && !j.parent), jb = fb.jobs.filter((j: any) => !j.removed && !j.parent);
    const sh = $("#sheet"); sh.style.display = "grid";
    sh.innerHTML = `<div class="box"><h3>What changes hands from <b>${esc(a.title)}</b> to <b>${esc(b.title)}</b>?</h3><label>The thing</label><input id="x-what" placeholder="the answer · the shortlist · a decision"><label>Leaves from</label><select id="x-from">${ja.map((j: any) => `<option value="${j.id}">${esc(j.name)}</option>`).join("")}</select><label>Arrives at</label><select id="x-to">${jb.map((j: any) => `<option value="${j.id}">${esc(j.name)}</option>`).join("")}</select><div class="row"><button id="x-cancel" class="bt q">Cancel</button><button id="x-ok" class="bt acc">Connect</button></div></div>`;
    (sh.querySelector("#x-cancel") as HTMLElement).onclick = () => (sh.style.display = "none");
    (sh.querySelector("#x-ok") as HTMLElement).onclick = async () => { const what = (sh.querySelector("#x-what") as HTMLInputElement).value.trim() || "something"; await fetch("./link", { method: "POST", body: JSON.stringify({ from: { board: a.id, job: (sh.querySelector("#x-from") as HTMLSelectElement).value }, to: { board: b.id, job: (sh.querySelector("#x-to") as HTMLSelectElement).value }, what }) }); location.reload(); };
    setTimeout(() => (sh.querySelector("#x-what") as HTMLInputElement).focus(), 50);
  }
}
function wrap(t: any, text: string, max: number, lines: number) { const words = text.split(/\s+/); let line: string[] = [], n = 0; for (const w of words) { if ((line.join(" ") + " " + w).length > max && line.length) { t.append("tspan").attr("x", -104).attr("dy", n ? 16 : 0).text(line.join(" ")); line = []; n++; if (n >= lines) { t.append("tspan").text("…"); return; } } line.push(w); } if (line.length) t.append("tspan").attr("x", -104).attr("dy", n ? 16 : 0).text(line.join(" ")); }
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
main();
