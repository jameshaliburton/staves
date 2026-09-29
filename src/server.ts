import { walkthroughBasis } from "./walkthrough-record.js";
import { telemetrySink } from "./telemetry-sink.js";
import { designHistory } from "./design-history.js";
import { saveWalkthrough, getWalkthrough, listWalkthroughs } from "./walkthrough-store.js";
import { previewAlternative } from "./alternative.js";
import { saveAssessmentRequest, getAssessment, listAssessmentRequests } from "./assessment-store.js";
import { assessmentOptionsSchema } from "./assessment.js";
import { walkThrough } from "./walkthrough.js";
import { captureCardPreconditions, StaleSuggestionError } from "./proposals.js";
import http from "node:http";
import { exportFromStore, exportOptionsSchema, formatExport } from "./export.js";
import { Store } from "./store.js";
import { ledger } from "./ledger.js";
import { readiness } from "./readiness.js";
import { boardAuthorship } from "./authorship.js";
import { openings } from "./openings.js";
import { traced, type TraceContent } from "./tracing.js";
import { walk } from "./walk.js";
import { handoff, connectionBlock } from "./handoff.js";
import { renderHTML, renderSVG, CSS_PARTS } from "./render.js";
import { APP_JS, appHTML } from "./app.js";
import { APP2_JS, APP2_HTML } from "./app2.js";
import { VERSION } from "./version.js";
import { collectableRuns, columns, diff, focusBoard, handoffs, lint, reviewData, scorecard } from "./derive.js";
import { readFileSync } from "node:fs";
import { stale, repoRoot } from "./stale.js";
import { watch as fsWatch, existsSync } from "node:fs";
import path from "node:path";
import { brief } from "./brief.js";
import { byKey, normalizeModelConfig, ModelConnectionError, interviewTurn, interviewFlow, normalizeInterviewMode, normalizeDraftStance } from "./interviewer.js";
import { fromBPMN, toJSON, fromJSON } from "./interop.js";
import { reflect } from "./reflect.js";
import { aggregateRuns, readObservations, recentCases, replayRun, runDays } from "./langfuse-runs.js";
import { SYSTEM_JS, SYSTEM_HTML } from "./system.js";
import type { Op } from "./ops.js";
import { createAgentHandoff, AgentHandoffError } from "./agent-handoff.js";

/** Serve the board on localhost. Returns the URL, or null if the port was taken (someone else is serving). */
/** One store's routes. `prefix` is the path the board lives under ("" locally, "/b/<token>" hosted). */
/** Per-store live state: who is connected (MCP clients announce themselves) and who is listening (the page). */
export interface Live { presence: Map<string, { name: string; since: string; last: string; board?: string; sampling?: boolean }>; sse: Set<http.ServerResponse>; broadcast: (event: string, data: unknown) => void; samplers: Map<string, { name: string; complete: (system: string, user: string) => Promise<string>; stream?: (system: string, user: string, onText?: (text: string) => void) => Promise<string> }> }
const lives = new Map<string, Live>();
export function liveFor(key: string): Live {
  if (!lives.has(key)) {
    const l: Live = { presence: new Map(), sse: new Set(), samplers: new Map(), broadcast: (event, data) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of l.sse) { try { r.write(msg); } catch { l.sse.delete(r); } } } };
    lives.set(key, l);
  }
  return lives.get(key)!;
}

/* relay sampling: the daemon queues a completion for a stdio MCP process, which runs it on its client's model and posts the text back */
type RelayJob = { id: string; system: string; user: string; resolve: (t: string) => void };
const relayQueues = new Map<string, { jobs: RelayJob[]; waiters: ((j: RelayJob | null) => void)[]; take: (ms: number) => Promise<RelayJob | null> }>();
const relayPending = new Map<string, RelayJob>();
function relayQueue(live: Live, sid: string) {
  const k = `${(live as any).key ?? ""}:${sid}`;
  if (!relayQueues.has(k)) { const q = { jobs: [] as RelayJob[], waiters: [] as ((j: RelayJob | null) => void)[], take: (ms: number) => new Promise<RelayJob | null>((res) => { const j = q.jobs.shift(); if (j) return res(j); const w = (x: RelayJob | null) => res(x); q.waiters.push(w); setTimeout(() => { const i = q.waiters.indexOf(w); if (i >= 0) { q.waiters.splice(i, 1); res(null); } }, ms); }) }; relayQueues.set(k, q); }
  return relayQueues.get(k)!;
}
function relayComplete(live: Live, sid: string, system: string, user: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const job: RelayJob = { id: Math.random().toString(36).slice(2), system, user, resolve };
    relayPending.set(job.id, job);
    const q = relayQueue(live, sid); const w = q.waiters.shift(); if (w) w(job); else q.jobs.push(job);
    setTimeout(() => { if (relayPending.has(job.id)) { relayPending.delete(job.id); reject(new Error("sampling timed out")); } }, 60_000);
  });
}
function relayResolve(live: Live, id: string, text: string) { const j = relayPending.get(id); if (j) { relayPending.delete(id); j.resolve(text); } }

/**
 * `trace` decides how much of a turn is recorded: "full" keeps the prompt and the reply, "metadata"
 * keeps everything else. It defaults to metadata because recording someone's words is a thing you opt
 * into. A local server is somebody running staves on their own machine with their own Langfuse keys,
 * so it opts itself in; the hosted gateway passes "full" only for the accounts that run the product.
 */
export function boardHandler(store: Store, prefix = "", options: { trace?: TraceContent } = {}) {
  const hosted = store.dir.startsWith("cloud:") || (!!prefix && prefix !== "/b/local");
  let version = Date.now().toString();
  const live = liveFor(store.dir);
  const { presence, broadcast } = live;
  store.watch(() => { version = Date.now().toString(); broadcast("change", { version }); });
  // the repo: a commit, checkout or edit changes what may be stale
  // Hosted stores use a namespace, not a filesystem directory.
  const root = store.dir.startsWith("cloud:") ? undefined : repoRoot(store.dir);
  if (root) {
    for (const f of [".git/HEAD", ".git/index", ".git/refs"]) { const p = path.join(root, f); if (existsSync(p)) try { fsWatch(p, { persistent: false, recursive: f.endsWith("refs") }, () => (version = Date.now().toString())); } catch {} }
    let t: NodeJS.Timeout | undefined;
    try { fsWatch(root, { persistent: false, recursive: true }, (_e, fn) => { if (!fn || /node_modules|\.git\/|\.staves\//.test(String(fn))) return; clearTimeout(t); t = setTimeout(() => (version = Date.now().toString()), 800); }); } catch {}
  }
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (prefix && url.pathname.startsWith(prefix)) url.pathname = url.pathname.slice(prefix.length) || "/";
    const boards = await store.list();
    const name = url.searchParams.get("board") ?? boards[0];
    try {
      if (url.pathname === "/version") return res.end(version);
      if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: hello\ndata: ${JSON.stringify({ version, presence: [...presence.values()] })}\n\n`);
        live.sse.add(res); req.on("close", () => live.sse.delete(res));
        return;
      }
      if (url.pathname === "/presence") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify([...presence.values()])); }
      if (url.pathname === "/hello" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const { id, name, board, sampling } = JSON.parse(body || "{}");
        presence.set(id, { name, since: presence.get(id)?.since ?? new Date().toISOString(), last: new Date().toISOString(), board, sampling: !!sampling });
        if (sampling && !live.samplers.has(id)) live.samplers.set(id, { name, complete: (system, user) => relayComplete(live, id, system, user) });
        broadcast("presence", [...presence.values()]);
        return res.end("ok");
      }
      if (url.pathname === "/bye" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const bid = JSON.parse(body || "{}").id; presence.delete(bid); live.samplers.delete(bid); broadcast("presence", [...presence.values()]);
        return res.end("ok");
      }
      if (url.pathname === "/sample/next") { // long-poll: a stdio MCP process waits here for work to run on its client's model
        const sid = url.searchParams.get("session") ?? ""; const q = relayQueue(live, sid);
        const job = await q.take(25_000);
        if (!job) { res.statusCode = 204; return res.end(); }
        res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ id: job.id, system: job.system, user: job.user }));
      }
      if (url.pathname === "/sample/done" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const { id, text } = JSON.parse(body || "{}"); relayResolve(live, id, text ?? ""); return res.end("ok");
      }
      if (url.pathname === "/undo" && req.method === "POST") {
        const e = await store.undo(name, url.searchParams.get("by") ?? "human");
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ undone: e ? { id: e.id, op: e.op.t } : null }));
      }
      if (url.pathname === "/system.json") {
        const names = (await store.list()).filter((n) => n !== "survey");
        const boards = await Promise.all(names.map(async (n) => ({ name: n, b: await store.board(n) })));
        const survey = (await store.list()).includes("survey") ? await store.board("survey") : null;
        const nodes = boards.map(({ name: n, b }) => { const jobs = b.jobs.filter((j) => !j.removed && !j.parent); const who = b.tracks.filter((t) => !t.removed); const f = lint(b).filter((x) => x.severity === "error").length; const sv = survey?.jobs.find((j) => j.boardRef === n); return { id: n, title: b.title === n ? (sv?.name ?? n) : b.title, for: b.context?.outside ?? sv?.beneficiary ?? who.find((t) => t.kind === "outside")?.name ?? "", jobs: jobs.length, people: who.filter((t) => t.kind === "person").length, agents: who.filter((t) => t.kind === "agent").length, systems: who.filter((t) => t.kind === "system").length, errors: f, who: who.map((t) => ({ name: t.name, kind: t.kind })), outs: b.artifacts.filter((a) => jobs.some((j) => j.outputs.includes(a.id))).map((a) => ({ id: a.id, name: a.name ?? a.id })), ins: b.artifacts.filter((a) => jobs.some((j) => j.inputs.includes(a.id))).map((a) => ({ id: a.id, name: a.name ?? a.id })), entry: sv?.rationale?.replace(/^entry: /, "") ?? "" }; });
        // edges: an artifact produced on one board and consumed on another (same id or same name), plus explicit links
        const edges: { from: string; to: string; what: string; kind: "handoff" | "link" }[] = [];
        for (const a of nodes) for (const b2 of nodes) if (a.id !== b2.id) for (const o of a.outs) { const m = b2.ins.find((i) => i.id === o.id || (i.name ?? "").toLowerCase() === (o.name ?? "").toLowerCase()); if (m && !/^from /.test(o.name ?? "") && !/^(x-|a-)/.test(o.name ?? "")) edges.push({ from: a.id, to: b2.id, what: o.name, kind: "handoff" }); }
        for (const { name: n, b } of boards) for (const c of b.comments) { const m = c.text.match(/^\[link\] (\S+) → (\S+): (.+)$/); if (m && !edges.some((e) => e.from === m[1] && e.to === m[2] && e.what === m[3])) edges.push({ from: m[1], to: m[2], what: m[3], kind: "link" }); }
        // threads: who appears on more than one board
        const threads = new Map<string, { name: string; kind: string; boards: string[] }>();
        for (const n of nodes) for (const w of n.who) { const k = w.name.toLowerCase(); const t = threads.get(k) ?? { name: w.name, kind: w.kind, boards: [] }; if (!t.boards.includes(n.id)) t.boards.push(n.id); threads.set(k, t); }
        res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ nodes: nodes.map(({ who, outs, ins, ...rest }) => ({ ...rest, outs: outs.filter((o) => !/^from /.test(o.name ?? "")).slice(0, 12), ins: ins.slice(0, 12) })), edges, threads: [...threads.values()].filter((t) => t.boards.length > 1) }));
      }
      if (url.pathname === "/link" && req.method === "POST") { // a cross-board handoff: the same artifact leaves one board's job and enters another's
        let body = ""; for await (const c of req) body += c; const { from, to, what } = JSON.parse(body || "{}") as { from: { board: string; job: string }; to: { board: string; job: string }; what: string };
        const id = `x-${Date.now().toString(36)}`; const fb = await store.board(from.board), tb = await store.board(to.board); const fj = fb.jobs.find((j) => j.id === from.job), tj = tb.jobs.find((j) => j.id === to.job);
        if (!fj || !tj) { res.statusCode = 404; return res.end("no such job"); }
        await store.append(from.board, [{ t: "artifact", artifact: { id, name: what, kind: "document" } }, { t: "updateJob", id: fj.id, patch: { outputs: [...fj.outputs, id] } }, { t: "comment", comment: { id: `c-${id}`, about: fj.id, by: "human", text: `[link] ${from.board} → ${to.board}: ${what}`, at: new Date().toISOString() } }], "human");
        await store.append(to.board, [{ t: "artifact", artifact: { id, name: what, kind: "document", external: true } as any }, { t: "updateJob", id: tj.id, patch: { inputs: [...tj.inputs, id] } }], "human");
        return res.end("ok");
      }
      if (url.pathname === "/system.js") { res.setHeader("content-type", "text/javascript"); return res.end(SYSTEM_JS); }
      if (url.pathname === "/system") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(SYSTEM_HTML); }
      if (url.pathname === "/reflect" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c; const { key, provider, model } = JSON.parse(body || "{}");
        const b = await store.board(name); const sampler = [...live.samplers.values()][0];
        const config = normalizeModelConfig({ provider, model });
        const k = key || process.env[config.provider === "openai" ? "OPENAI_API_KEY" : config.provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"];
        const complete = sampler ? sampler.complete : k ? byKey(k, config) : null;
        const r = await reflect(b, brief(b), complete);
        res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(r));
      }
      if (url.pathname === "/handoff-export" && req.method === "POST") {
        if (!name) { res.statusCode = 400; return res.end("Choose a board to export."); }
        let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 30000) { res.statusCode = 413; return res.end("Export request is too large."); } }
        const parsed = exportOptionsSchema.safeParse(JSON.parse(body || "{}"));
        if (!parsed.success) { res.statusCode = 400; return res.end("Invalid export options."); }
        const packet = await exportFromStore(store, name, parsed.data);
        // the same connection block the conversation handoff uses, so an exported prompt can reach the
        // board it is about rather than only describe it back
        const connection = connectionBlock({
          board: name,
          dir: hosted ? undefined : store.dir.replace(/\/\.staves$/, ""),
          hosted,
          connected: [...presence.values()].filter(p => !p.sampling && (!p.board || p.board === name)).map(p => p.name),
        });
        res.setHeader("content-type", "application/json");res.setHeader("cache-control", "no-store");
        return res.end(JSON.stringify({ packet, formats: { json: formatExport(packet, "json"), markdown: formatExport(packet, "markdown"), prompt: formatExport(packet, "prompt", connection), svg: formatExport(packet, "svg"), n8n: formatExport(packet, "n8n") } }));
      }
      if (url.pathname === "/export.json") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(toJSON(await store.board(name)), null, 2)); }
      if (url.pathname === "/import" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const { format, text } = JSON.parse(body || "{}");
        const ops = format === "bpmn" ? fromBPMN(text) : fromJSON(JSON.parse(text));
        await store.append(name, ops, "human");
        res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ ops: ops.length }));
      }
      if (url.pathname === "/interview" && req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const { job, lines, said, key, provider, model: modelId, mute, suggestions, mode: requestedMode, draft: requestedDraft } = JSON.parse(body || "{}");
        const mode = normalizeInterviewMode(requestedMode);
        const draft = normalizeDraftStance(requestedDraft);
        const b = await store.board(name); (b as any).__findings = lint(b).filter((f) => f.severity !== "info"); const j = b.jobs.find((x) => x.id === job);
        if (!j && job !== "board") { res.statusCode = 404; return res.end("no such job"); }
        // whose model: a connected agent that offers sampling → a key → the scripted engine
        const sampler = [...live.samplers.values()][0];
        const streaming = url.searchParams.get("stream") === "1";
        const config = normalizeModelConfig({ provider, model: modelId });
        const k = key || process.env[config.provider === "openai" ? "OPENAI_API_KEY" : config.provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"];
        const chosen = sampler ? (streaming && sampler.stream ? sampler.stream : sampler.complete) : k ? byKey(k, config) : undefined;
        /* Every interview turn goes through here, whichever model answers it, so this is the one place
           worth wrapping. Off unless Langfuse keys are configured; never able to change what the turn
           returns or how long it takes. */
        const model = chosen ? traced(chosen, {
          name: j ? "interview:job" : "interview:board",
          board: name, model: sampler ? `sampler:${sampler.name}` : `${config.provider}:${config.model}`,
          tags: [mode, draft, streaming ? "streaming" : "blocking"].filter(Boolean) as string[],
          content: options.trace ?? (prefix ? "metadata" : "full"),
        }) : undefined;
        const telemetry = telemetrySink();
        const startedAt = Date.now();
        const record = (outcome: "success" | "error" | "unavailable", engine: "model" | "rules" | "none", cardCount = 0) => telemetry.record({ scope: j ? "job" : "board", streaming, engine, outcome, cardCount, lineCount: Array.isArray(lines) ? lines.length : 0, startedAt });
        if (!model && process.env.STAVES_RULE_INTERVIEWER !== "1") {
          record("unavailable", "none");
          if (streaming) { res.setHeader("content-type", "application/x-ndjson; charset=utf-8"); return res.end(JSON.stringify({ type: "error", message: "Connect a coding assistant or configure a model to start this conversation." }) + "\n"); }
          res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ engine: "none", reply: "", cards: [], samplers: [...live.presence.values()].map((p) => p.name) }));
        }
        if (streaming) {
          res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
          res.setHeader("cache-control", "no-cache, no-transform");
          res.flushHeaders();
          const emit = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + "\n"); };
          try {
            emit({ type: "status", status: "thinking" });
            const session = { mode, draft, mute, suggestions, onReply: (text: string) => emit({ type: "reply", text }) };
            const turn = j ? await interviewTurn(b, j, lines ?? [], said ?? null, model, session) : await interviewFlow(b, lines ?? [], said ?? null, model, session);
            record("success", turn.engine, turn.cards.length);
            emit({ type: "complete", ...turn, cards: captureCardPreconditions(b, turn.cards), via: turn.engine === "model" ? (sampler ? sampler.name : "key") : undefined });
          } catch (error) { record("error", model ? "model" : "rules"); emit({ type: "error", message: error instanceof Error ? error.message : "Could not finish the response." }); }
          return res.end();
        }
        const turn = await (async () => {
          try {
            const result = j ? await interviewTurn(b, j, lines ?? [], said ?? null, model, { mode, draft, mute, suggestions }) : await interviewFlow(b, lines ?? [], said ?? null, model, { mode, draft, mute, suggestions });
            record("success", result.engine, result.cards.length);
            return result;
          } catch (error) { record("error", model ? "model" : "rules"); throw error; }
        })();
        res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ ...turn, cards: captureCardPreconditions(b, turn.cards), via: turn.engine === "model" ? (sampler ? sampler.name : "key") : undefined }));
      }
      if (url.pathname === "/redo" && req.method === "POST") { const e = await store.redo(name, url.searchParams.get("by") ?? "human"); res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ redone: e ? { id: e.id } : null })); }
      if (url.pathname === "/entries") { const since = url.searchParams.get("since"); const es = await store.entries(name); res.setHeader("content-type", "application/json"); { const i = since ? es.findIndex((e) => (e.id ?? String(e.seq)) === since) : -1; return res.end(JSON.stringify(since ? (i >= 0 ? es.slice(i + 1) : []) : es)); } }
      if (url.pathname === "/list") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(await store.list())); }
      if (url.pathname === "/proposals") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(await store.proposals(name))); }
      if (url.pathname === "/staves-version") return res.end(VERSION);
      if (url.pathname === "/design-history") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(await designHistory(store, name))); }
      if (url.pathname === "/langfuse-runs" || url.pathname === "/langfuse-run") {
        // As run: production observations read back in board vocabulary. Read-only — the board is
        // never written from here, and the credentials stay in this process's environment.
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        const answer = (status: number, body: unknown) => { res.statusCode = status; return res.end(JSON.stringify(body)); };
        if (req.method !== "GET") return answer(405, { error: "Read runs with GET." });
        const board = await store.board(name);
        const connection = board.context?.langfuse;
        if (!connection) return answer(400, { error: "Connect a Langfuse project first with staves_langfuse_connect." });
        // The daemon inherits the environment of whatever started it, which may not be the MCP server.
        if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return answer(400, { error: "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the coding agent environment. They are read from the environment of the process serving this board, so restart it with the keys set." });
        const days = runDays(url.searchParams.get("days"));
        const toStartTime = new Date().toISOString();
        const fromStartTime = new Date(Date.parse(toStartTime) - days * 86_400_000).toISOString();
        try {
          const scan = await readObservations(connection, { boardId: board.id, fromStartTime, toStartTime });
          if (url.pathname === "/langfuse-run") {
            const caseId = url.searchParams.get("case") ?? "";
            if (!caseId || caseId.length > 200) return answer(400, { error: "Choose a case to replay, by an id of up to 200 characters." });
            return answer(200, { ...replayRun(scan.observations, caseId, board), days, window: scan.window });
          }
          return answer(200, { ...aggregateRuns(scan, board), days, recentCases: recentCases(scan.observations) });
        } catch (error) { return answer(400, { error: error instanceof Error ? error.message : "Could not read runs from Langfuse." }); }
      }
      if (url.pathname === "/assessment") {
        res.setHeader("content-type", "application/json");
        if (req.method === "GET") return res.end(JSON.stringify(url.searchParams.has("id") ? await getAssessment(store, name, url.searchParams.get("id")!) : await listAssessmentRequests(store, name)));
        if (req.method !== "POST") throw new Error("Use GET or POST for assessments.");
        let body = ""; for await (const chunk of req) body += chunk;
        const { expectedRevision, ...input } = JSON.parse(body || "{}");
        if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) throw new Error("Invalid preview revision.");
        const options = assessmentOptionsSchema.omit({ id: true, capturedBy: true, capturedAt: true }).parse(input);
        return res.end(JSON.stringify(await saveAssessmentRequest(store, name, options, "human", expectedRevision)));
      }
      if (url.pathname === "/agent-handoff") {
        res.setHeader("content-type", "application/json");
        if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "Create a handoff with POST." })); }
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 30000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "Handoff request is too large." })); } }
        let input: unknown;
        try { input = JSON.parse(body || "{}"); }
        catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "Provide valid handoff details." })); }
        try {
          const result = await createAgentHandoff(store, name, input, {
            hosted,
            dir: hosted ? undefined : store.dir.replace(/\/\.staves$/, ""),
            connected: [...presence.values()].filter(p => !p.sampling && (!p.board || p.board === name)).map(p => p.name),
          });
          return res.end(JSON.stringify(result));
        } catch (error) {
          if (error instanceof AgentHandoffError) { res.statusCode = error.status; return res.end(JSON.stringify({ error: error.message })); }
          if (error instanceof Error && error.name === "ZodError") { res.statusCode = 400; return res.end(JSON.stringify({ error: "Invalid handoff details." })); }
          throw error;
        }
      }
      if (url.pathname === "/walkthrough") {
        res.setHeader("content-type", "application/json");
        if (req.method === "GET") return res.end(JSON.stringify(url.searchParams.has("id") ? await getWalkthrough(store, name, url.searchParams.get("id")!) : await listWalkthroughs(store, name)));
        if (req.method !== "POST") throw new Error("Use GET or POST for walkthroughs.");
        let body = ""; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body || "{}");
        const example = assessmentOptionsSchema.shape.cases.unwrap().element.parse(input.case ?? input);
        if (input.expectedBasis !== undefined && typeof input.expectedBasis !== "string") throw new Error("Invalid scenario preview basis.");
        if (input.save === true) return res.end(JSON.stringify(await saveWalkthrough(store, name, example, "human", input.maxSteps, input.expectedBasis)));
        const result = walkThrough(await store.board(name), example, { maxSteps: input.maxSteps });
        return res.end(JSON.stringify({ ...result, basis: walkthroughBasis(result.snapshot) }));
      }
      if (url.pathname === "/alternative-review") {
        const alternative = await store.board(name);
        const baseline = await store.baseline(name);
        if (!baseline?.baseline?.pinned || !alternative.base) throw new Error("Only pinned alternatives can advance intended design.");
        const sourceName = baseline.baseline.sourceBoard;
        const source = await store.board(sourceName);
        res.setHeader("content-type", "application/json");
        if (req.method === "GET") return res.end(JSON.stringify(previewAlternative(source, alternative, baseline)));
        if (req.method !== "POST") throw new Error("Use GET or POST for alternative review.");
        let body = ""; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body || "{}");
        if (typeof input.basis !== "string") throw new Error("Review the intended-design changes before accepting.");
        await store.append(sourceName, [{ t: "acceptAlternative", alternative, baseline, expectedBasis: input.basis }], "human");
        return res.end(JSON.stringify({ sourceBoard: sourceName, status: "intended-design-accepted", implementationChanged: false }));
      }
      if (url.pathname === "/baseline") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(await store.baseline(name)));
      }
      if (url.pathname === "/branch" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const input = JSON.parse(body || "{}");
        if (![input.base, input.name, input.title].every((value) => typeof value === "string" && value.trim())) throw new Error("Provide a source board, alternative name and title.");
        const alternative = await store.branch(input.base, input.name, input.title, typeof input.baselineName === "string" ? input.baselineName : undefined, typeof input.capturedBy === "string" ? input.capturedBy : "human");
        version = Date.now().toString();
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(alternative));
      }
      if (url.pathname === "/op" && req.method === "POST") {
        const who = url.searchParams.get("by") ?? "human";
        for (const [k, v] of presence) if (v.name === who) v.last = new Date().toISOString();
        let body = "";
        for await (const c of req) body += c;
        const input = JSON.parse(body || "[]");
        const before = url.searchParams.get("propose") === "1" ? (await store.entries(name)).length : 0;
        await store.append(name, Array.isArray(input) ? input : input.ops, who, url.searchParams.get("propose") === "1", Array.isArray(input) ? undefined : input.preconditions, Array.isArray(input) ? undefined : input.suggestions);
        version = Date.now().toString();
        // A proposal is answered later by its seq, so the author is told which entries it just made.
        if (url.searchParams.get("propose") === "1") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ ok: true, seqs: (await store.entries(name)).slice(before).map(entry => entry.seq) }));
        }
        return res.end("ok");
      }
      if (url.pathname === "/answer" && req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        const { id, answer, confirm } = JSON.parse(body || "{}");
        if (id && answer) await store.append(name, [{ t: "answer", id, answer, by: "human" }], "human");
        if (confirm) await store.append(name, [{ t: "confirm", id: confirm, by: "human" }], "human");
        version = Date.now().toString();
        return res.end("ok");
      }
      if (url.pathname === "/app.js") { res.setHeader("content-type", "text/javascript"); return res.end(APP_JS); }
      if (url.pathname === "/app2.js") { res.setHeader("content-type", "text/javascript"); return res.end(APP2_JS); }
      if (url.pathname === "/setup") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify((store as any).setup ?? { claudeCode: "npx @staves/cli init  — then: run staves", codex: "npx @staves/cli init", cursor: { mcpServers: { staves: { command: "npx", args: ["-y", "@staves/cli", "mcp", "--dir", store.dir] } } } })); }
      if (url.pathname === "/log") {
        const id = url.searchParams.get("id") ?? "";
        const es = (await store.entries(name)).filter((e) => JSON.stringify(e.op).includes(`"${id}"`));
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(es));
      }
            if (url.pathname === "/source") {
        // read-only view of a file in the repo the board describes; never written, never served outside the repo root
        const root = path.resolve(store.dir, "..");
        const rel = url.searchParams.get("path") ?? "";
        const full = path.resolve(root, rel);
        if (!rel || !full.startsWith(root) || !existsSync(full)) { res.statusCode = 404; return res.end("no such source"); }
        const txt = readFileSync(full, "utf8");
        const sym = url.searchParams.get("symbol");
        let out = txt;
        if (sym) { const i = txt.indexOf(sym); if (i >= 0) { const start = txt.lastIndexOf("\n", Math.max(0, i - 400)); out = txt.slice(start < 0 ? 0 : start, Math.min(txt.length, i + 2400)); } }
        res.setHeader("content-type", "text/plain; charset=utf-8");
        return res.end(out.length > 12000 ? out.slice(0, 12000) + "\n…" : out);
      }
      if (url.pathname === "/board.json") {
        const focus = url.searchParams.get("focus");
        const b0 = await store.board(name);
        const b = focus ? focusBoard(b0, focus) : b0;
        const sourceBaseline = b.base ? await store.baseline(name) : null;
        const base = sourceBaseline && focus ? focusBoard(sourceBaseline, focus) : sourceBaseline;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ ...b, findings: lint(b), ledger: ledger(b), readiness: readiness(b), authorship: boardAuthorship(b), openings: openings(b), walk: walk(b), stale: stale(b, store.dir), scorecard: scorecard(b), runs: collectableRuns(b), baseScorecard: base ? scorecard(base) : undefined, diff: base ? diff(base, b) : undefined, boards: await store.list(), columns: Object.fromEntries(columns(b)), handoffs: handoffs(b), proposalsList: await store.proposals(name), review: reviewData(b) }));
      }
      /* One paste. The facts the prompt needs — which board, where it lives, what is already connected —
         are things only the server knows, so it builds the whole thing rather than handing the client a
         template to fill in and letting the two drift. */
      if (url.pathname === "/handoff") {
        const b = await store.board(name);
        const connected = [...presence.values()].filter(p => !p.sampling && (!p.board || p.board === name)).map(p => p.name);
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(handoff(b, {
          board: name,
          dir: hosted ? undefined : store.dir.replace(/\/\.staves$/, ""),
          hosted,
          url: url.searchParams.get("page") ?? undefined,
          scope: url.searchParams.get("scope") ?? "board",
          intention: url.searchParams.get("intention") ?? undefined,
          draft: url.searchParams.get("draft") ?? undefined,
          connected,
        })));
      }
      if (url.pathname === "/brief") { res.setHeader("content-type", "text/markdown"); return res.end(brief(await store.board(name))); }
      if (url.pathname === "/board.svg") {
        const open = (url.searchParams.get("open") ?? "").split(",").filter(Boolean);
        const level = Number(url.searchParams.get("level") ?? 1) as 0 | 1 | 2;
        const b0 = await store.board(name);
        const focus = url.searchParams.get("focus");
        const b = focus ? focusBoard(b0, focus) : b0;
        res.setHeader("content-type", "image/svg+xml");
        return res.end(renderSVG(b, { open, level, stale: stale(b0, store.dir).map((x) => x.job) }));
      }
      res.setHeader("content-type", "text/html");
      if (url.pathname === "/print") {
        const b = await store.board(name);
        const open = (url.searchParams.get("open") ?? "").split(",").filter(Boolean);
        return res.end(renderHTML(b, { open, proposals: await store.proposals(name) }));
      }
      if (name) return res.end(APP2_HTML);
      if (!name) { // no board yet: open the app on the board this repo would be called, so the doors are there
        let def = "board"; try { def = JSON.parse(readFileSync(path.join(store.dir, "config.json"), "utf8")).board || def; } catch {}
        const have = await store.list(); if (have.includes("survey")) def = "survey"; else if (have.length === 1) def = have[0];
        res.statusCode = 302; res.setHeader("location", `${prefix}/?board=${encodeURIComponent(def)}`); return res.end();
      }
      const b = await store.board(name);
      const open = (url.searchParams.get("open") ?? "").split(",").filter(Boolean);
      const nav = boards.length > 1 ? `<p style="font-size:12px">${boards.map((x) => `<a href="/?board=${x}">${x}</a>`).join(" · ")}</p>` : "";
      res.end(renderHTML(b, { open, proposals: await store.proposals(name) }).replace("<main>", "<main>" + nav));
    } catch (e: any) {
      if (e instanceof ModelConnectionError) { res.statusCode = 400; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: e.message })); }
      if (e instanceof StaleSuggestionError) { res.statusCode = 409; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: e.message })); }
      res.statusCode = 500;
      res.end(String(e?.stack ?? e));
    }
  };
  (handler as any).store = store;
  return handler;
}

export async function serveHttp(store: Store, port = 5178, log: (s: string) => void = () => {}, tries = 6): Promise<string | null> {
  const { editorHandler } = await loadEditor();
  const handler = editorHandler(store, undefined, "/b/local");
  const attempt = (p: number): Promise<string | null> => new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.once("error", () => {
      if (p - port + 1 >= tries) { log(`staves: ports ${port}–${p} are all taken — an older staves is probably still running. Stop it (lsof -i :${port}) and retry.`); resolve(null); }
      else { log(`staves: port ${p} is taken (an older staves still running?) — using ${p + 1}`); resolve(attempt(p + 1)); }
    });
    srv.listen(p, "127.0.0.1", () => { log(`staves ${VERSION}: http://localhost:${p}  (boards in ${store.dir})`); resolve(`http://localhost:${p}`); });
  });
  return attempt(port);
}

/** Load the shipped editor; the development preview uses this same handler. */
export async function loadEditor(): Promise<{ editorHandler: (store: Store, modelStatus?: { status: string }, prefix?: string) => ReturnType<typeof boardHandler> & { store: Store } }> {
  return import(new URL("../design/editor/handler.mjs", import.meta.url).href);
}
