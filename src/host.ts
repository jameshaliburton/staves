import http from "node:http";
import { REPLY_BUDGET } from "./providers.js";
import path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Store } from "./store.js";
import { buildServer } from "./mcp.js";
import { boardHandler, liveFor, loadEditor } from "./server.js";
import { VERSION } from "./version.js";

/**
 * staves as a web service. One process, many workspaces, each behind a token.
 *   GET  /                    the front door: New board
 *   POST /new                 a workspace; returns its token and the connect lines
 *   ALL  /mcp/<token>         remote MCP (Streamable HTTP) — one session per agent, named from its handshake
 *   GET  /b/<token>/…         the board app and its endpoints (events, undo, source…)
 * Local mode is the same server with a workspace called "local" pointed at the project's .staves.
 */
export interface HostOptions { root: string; port: number; publicUrl: string; local?: string }

export async function host(o: HostOptions) {
  const { editorHandler } = await loadEditor();
  await fs.mkdir(o.root, { recursive: true });
  const dirOf = (t: string) => (t === "local" && o.local ? o.local : path.join(o.root, t));
  const valid = (t: string) => (t === "local" && !!o.local) || (/^[a-z0-9]{20,}$/.test(t) && existsSync(path.join(o.root, t)));
  const handlers = new Map<string, ReturnType<typeof boardHandler>>();
  const handlerFor = (t: string) => { if (!handlers.has(t)) { const st = new Store(dirOf(t)); (st as any).setup = setup(o.publicUrl, t); handlers.set(t, editorHandler(st, undefined, `/b/${t}`)); } return handlers.get(t)!; };
  // the same Store instance for MCP sessions and the page, so presence and agent naming meet
  const storeFor = (t: string) => { handlerFor(t); return (handlers.get(t) as any).store as Store; };
  // MCP sessions: one transport + server per agent session, so the agent's name from initialize sticks
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; token: string; id: string; last: number }>();
  // sessions that stop talking are forgotten: clients rarely say goodbye
  setInterval(() => { const now = Date.now(); for (const [sid, s] of sessions) if (now - s.last > 90_000) { sessions.delete(sid); const live = liveFor(dirOf(s.token)); live.presence.delete(s.id); live.samplers.delete(s.id); live.broadcast("presence", [...live.presence.values()]); s.transport.close().catch(() => {}); } }, 30_000).unref();
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (o.local && url.pathname === "/") { res.statusCode = 302; res.setHeader("location", `/b/local/${url.search}`); return res.end(); }
      if (url.pathname === "/new" && req.method === "POST") {
        const token = randomBytes(12).toString("hex");
        await fs.mkdir(path.join(o.root, token), { recursive: true });
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(setup(o.publicUrl, token)));
      }
      if (url.pathname === "/workspaces") { res.setHeader("content-type", "application/json"); const ws = (await fs.readdir(o.root)).filter(valid); return res.end(JSON.stringify([...(o.local ? ["local"] : []), ...ws])); }
      const m = url.pathname.match(/^\/mcp\/([a-z0-9]+)$/);
      if (m) {
        const token = m[1];
        if (!valid(token)) { res.statusCode = 404; return res.end("no such workspace"); }
        const sid = req.headers["mcp-session-id"]?.toString();
        let body: any = undefined;
        if (req.method === "POST") { let b = ""; for await (const c of req) b += c; body = b ? JSON.parse(b) : undefined; }
        if (sid && sessions.has(sid)) { const s = sessions.get(sid)!; s.last = Date.now(); const pr = liveFor(dirOf(s.token)).presence.get(s.id); if (pr) pr.last = new Date().toISOString(); return s.transport.handleRequest(req, res, body); }
        if (req.method !== "POST" || !body || body.method !== "initialize") { res.statusCode = 400; return res.end("start with initialize"); }
        const store = storeFor(token);
        const live = liveFor(store.dir);
        const id = randomUUID();
        // Someone else's workspace: this machine's registrations and boards describe another project.
        const server = buildServer(store, "agent", `${o.publicUrl}/b/${token}/`, { recommendations: false });
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => id, onsessioninitialized: (s: string) => { sessions.set(s, { transport, token, id, last: Date.now() }); } });
        server.server.oninitialized = () => {
          const ci = server.server.getClientVersion();
          const name = ci?.name ?? "agent";
          (store as any).agent = name;
          const caps = server.server.getClientCapabilities();
          const sampling = !!caps?.sampling;
          live.presence.set(id, { name, since: new Date().toISOString(), last: new Date().toISOString(), sampling });
          if (sampling) live.samplers.set(id, { name, complete: async (system, user) => { const r = await server.server.createMessage({ systemPrompt: system, messages: [{ role: "user", content: { type: "text", text: user } }], maxTokens: REPLY_BUDGET }); return r.content.type === "text" ? r.content.text : ""; } });
          live.broadcast("presence", [...live.presence.values()]);
        };
        transport.onclose = () => { sessions.delete(id); live.presence.delete(id); live.samplers.delete(id); live.broadcast("presence", [...live.presence.values()]); server.close(); };
        await server.connect(transport);
        return transport.handleRequest(req, res, body);
      }
      const b = url.pathname.match(/^\/b\/([a-z0-9]+)(\/.*)?$/);
      if (b) {
        if (!valid(b[1])) { res.statusCode = 404; return res.end("no such workspace"); }
        if (!b[2]) { res.statusCode = 302; res.setHeader("location", `/b/${b[1]}/${url.search}`); return res.end(); }
        return handlerFor(b[1])(req, res);
      }
      if (url.pathname === "/staves-version") return res.end(VERSION);
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(landing(o));
    } catch (e: any) { res.statusCode = 500; res.end(String(e?.stack ?? e)); }
  });
  await new Promise<void>((resolve, reject) => { let p = o.port; const tryListen = () => { srv.once("error", (e: any) => { if (e.code === "EADDRINUSE" && p - o.port < 6) { p++; tryListen(); } else reject(e); }); srv.listen(p, () => { o.port = p; o.publicUrl = o.publicUrl.replace(/:\d+$/, `:${p}`); resolve(); }); }; tryListen(); });
  console.error(`staves ${VERSION} · ${o.publicUrl}${o.local ? `  (local workspace → ${o.local})` : ""}  (workspaces in ${o.root})`);
  return srv;
}

export function setup(publicUrl: string, token: string) {
  const mcp = `${publicUrl}/mcp/${token}`;
  return { token, board: `${publicUrl}/b/${token}/`, mcp, claudeCode: `claude mcp add --transport http staves ${mcp}`, codex: `codex mcp add staves --url ${mcp}`, cursor: { mcpServers: { staves: { url: mcp } } }, say: "run staves" };
}

function landing(o: HostOptions) {
  const local = o.local ? setup(o.publicUrl, "local") : null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>staves</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--b0:#0f1211;--b1:#171b1a;--b2:#1e2322;--b3:#262c2a;--line:#2b3230;--line2:#3a4340;--t1:#e8ebe8;--t2:#a9b1ad;--t3:#6f7874;--acc:#f0a35e;--agent:#4fcb92}
*{box-sizing:border-box}body{margin:0;background:var(--b0);color:var(--t1);font:14px/1.5 Archivo,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:72px 32px 96px}
.logo{display:flex;align-items:center;gap:10px;color:var(--acc);font-weight:700;letter-spacing:-.01em;margin-bottom:40px}
h1{font-size:34px;font-weight:700;letter-spacing:-.03em;margin:0 0 10px;line-height:1.15}p.lead{color:var(--t2);font-size:16px;margin:0 0 32px;max-width:56ch}
.card{background:var(--b1);border:1px solid var(--line);border-radius:12px;padding:22px 24px;margin:0 0 14px}
.card h3{margin:0 0 4px;font-size:14px;color:var(--t1)}.card .why{color:var(--t3);font-size:12.5px;margin:0 0 12px}
.bt{height:40px;padding:0 18px;border:0;border-radius:8px;background:var(--acc);color:#1a1208;font:inherit;font-weight:700;cursor:pointer}.bt:hover{filter:brightness(1.06)}.bt.q{background:var(--b3);color:var(--t1)}
pre{margin:10px 0 0;padding:12px 14px;background:var(--b0);border:1px solid var(--line2);border-radius:8px;font:12.5px/1.5 ui-monospace,Menlo,monospace;color:var(--t1);white-space:pre-wrap;word-break:break-all;position:relative}
pre .cp{position:absolute;right:8px;top:8px;font:12px Archivo,sans-serif;color:var(--t2);background:var(--b3);border:0;border-radius:5px;padding:4px 8px;cursor:pointer}
.tabs{display:flex;gap:4px;margin:12px 0 0}.tabs button{background:none;border:1px solid var(--line2);color:var(--t2);border-radius:6px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}.tabs button.on{background:var(--b3);color:var(--t1)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:28px 0 0}.step{background:var(--b1);border:1px solid var(--line);border-radius:10px;padding:16px}.step b{display:block;font-size:22px;color:var(--acc);margin-bottom:4px}.step span{color:var(--t2);font-size:13px}
a{color:var(--agent)}.foot{color:var(--t3);font-size:12px;margin-top:40px}
</style></head><body><main>
<div class="logo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="17" r="2" fill="currentColor"/></svg>staves</div>
<h1>Your agents, explained to the people they work for.</h1>
<p class="lead">Point your coding agent at the thing it built. staves draws the work as the people in it experience it — who does what for whom, where a person decides, where an agent is trusted blind — and reviews it in one read.</p>
<div class="card"><h3>New board</h3><div class="why">A place for one system. Nothing to install here; your agent connects to it.</div><button class="bt" id="new">New board</button>${local ? ` <a href="${local.board}" style="margin-left:14px">open the local board →</a>` : ""}<div id="out"></div></div>
<div class="steps"><div class="step"><b>1</b><span>Paste one line into Claude Code, Codex or Cursor.</span></div><div class="step"><b>2</b><span>In the agent, say <i>run staves</i>. It reads the code and draws the board here.</span></div><div class="step"><b>3</b><span>Read the review. Raise what surprises you; the agent picks it up.</span></div></div>
<div class="foot">Free with your own agent. Boards are yours: an append-only log you can commit next to the code. staves ${VERSION}</div>
<script>
const out=document.getElementById('out');
function show(r){ let tab='cc'; const lines={cc:r.claudeCode,codex:r.codex,cursor:JSON.stringify(r.cursor,null,2)};
 const render=()=>{ out.innerHTML='<div class="tabs">'+[['cc','Claude Code'],['codex','Codex'],['cursor','Cursor / Desktop']].map(([k,l])=>'<button class="'+(tab===k?'on':'')+'" data-t="'+k+'">'+l+'</button>').join('')+'</div><pre id="line"></pre><p style="color:var(--t2);font-size:13px;margin:12px 0 0">Then, in the agent: <b style="color:var(--t1)">run staves</b>. Your board: <a href="'+r.board+'">'+r.board+'</a> — keep this page; the link is the key.</p>'; const pre=document.getElementById('line'); pre.textContent=lines[tab]; const cp=document.createElement('button'); cp.className='cp'; cp.textContent='copy'; cp.onclick=()=>{ navigator.clipboard.writeText(lines[tab]); cp.textContent='copied'; }; pre.appendChild(cp); out.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;render();}); };
 render(); }
document.getElementById('new').onclick=async()=>{ const r=await (await fetch('/new',{method:'POST'})).json(); show(r); };
${local ? `` : ``}
</script></main></body></html>`;
}
