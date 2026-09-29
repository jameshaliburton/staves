import type { Complete } from "./interviewer.js";

/**
 * Tracing staves' own interview turns.
 *
 * langfuse.ts reads somebody else's Langfuse for evidence about their agents. It has no way to record
 * what staves itself does — every function in it fetches, discovers or probes. So the one product
 * whose entire subject is other people's workflows has never been able to look at its own, and every
 * question about why a conversation went wrong has been answered by reading code and guessing.
 *
 * This wraps the single place every model call passes through. Three rules:
 *
 *  - It never changes what the caller gets. A turn must not fail, slow down or read differently
 *    because something could not be written to an observability tool.
 *  - It is off unless keys are configured. Conversations are the person's account of their own work,
 *    and shipping them to a third party is a decision somebody makes on purpose, not a default that
 *    arrives with an upgrade.
 *  - Failures are silent to the caller and visible in the log, once. A tracer that spams a terminal
 *    when a network is down is worse than no tracer.
 */

export interface TraceConfig { baseUrl: string; publicKey: string; secretKey: string; release?: string }
/**
 * How much of a turn is recorded.
 *
 * "full" keeps the prompt and the reply, which is what makes a trace worth reading when a conversation
 * goes wrong. "metadata" keeps everything except those two: which model, which mode, how long it took,
 * how big the exchange was, and the error if it failed.
 *
 * The split exists because a hosted person's conversation is their account of their own work, and they
 * bring their own provider key — they are paying for the call, and the content of it travelling to
 * somebody else's observability account is not the bargain they signed up for. An owner tracing their
 * own boards is a different thing entirely. So: full on the accounts that run the product, metadata on
 * everybody else, and errors from everybody, because a failure nobody can see is a failure nobody fixes.
 */
export type TraceContent = "full" | "metadata";

export interface TraceMeta {
  /** what kind of turn: the whole board, one job, an assessment */
  name: string;
  /** the board it is about — never its contents, just which one */
  board?: string;
  /** which model answered, when the caller knows */
  model?: string;
  sessionId?: string;
  tags?: string[];
  /** default "metadata": recording somebody's words is the thing you opt into, not out of */
  content?: TraceContent;
}

export function traceConfig(env: NodeJS.ProcessEnv = process.env): TraceConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const raw = (env.LANGFUSE_BASE_URL ?? env.LANGFUSE_HOST ?? "https://cloud.langfuse.com").trim();
  let baseUrl: string;
  try { const u = new URL(raw); if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null; baseUrl = u.origin; }
  catch { return null; }
  return { baseUrl, publicKey, secretKey, release: env.STAVES_VERSION?.trim() || undefined };
}

let warned = false;
const now = () => new Date().toISOString();
const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Ingestion is fire-and-forget: the promise is never awaited by a turn and never rejects to it. */
async function send(config: TraceConfig, batch: unknown[], fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(`${config.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64"),
      },
      body: JSON.stringify({ batch }),
    });
    if (!res.ok && !warned) { warned = true; console.warn(`staves: could not write traces to Langfuse (${res.status}); conversations are unaffected`); }
  } catch (error) {
    if (!warned) { warned = true; console.warn(`staves: could not write traces to Langfuse (${(error as Error)?.message ?? "unknown"}); conversations are unaffected`); }
  }
}

/**
 * Wrap a completion so every call to it becomes a trace with one generation inside.
 *
 * Streaming is preserved exactly: the onText callback is passed straight through, so the person sees
 * tokens at the same moment they would have without this. The trace is written after the call
 * settles, from what already happened, and an error is recorded as the generation's output rather
 * than swallowed — a turn that failed is the one you most want to be able to look at.
 */
export function traced(complete: Complete, meta: TraceMeta, deps: { config?: TraceConfig | null; fetch?: typeof fetch } = {}): Complete {
  const config = deps.config === undefined ? traceConfig() : deps.config;
  if (!config) return complete;
  return async (system, user, onText) => {
    const traceId = id(), observationId = id(), startedAt = now();
    try {
      const output = await complete(system, user, onText);
      void send(config, batch(config, meta, { traceId, observationId, startedAt, system, user, output }), deps.fetch);
      return output;
    } catch (error) {
      void send(config, batch(config, meta, { traceId, observationId, startedAt, system, user, error: (error as Error)?.message ?? String(error) }), deps.fetch);
      throw error;
    }
  };
}

function batch(config: TraceConfig, meta: TraceMeta, turn: {
  traceId: string; observationId: string; startedAt: string; system: string; user: string; output?: string; error?: string;
}): unknown[] {
  const endedAt = now();
  const full = meta.content === "full";
  return [
    {
      id: id(), type: "trace-create", timestamp: endedAt,
      body: {
        id: turn.traceId, name: meta.name, timestamp: turn.startedAt, release: config.release,
        sessionId: meta.sessionId, tags: [...(meta.tags ?? []), full ? "content" : "metadata-only"],
        // the board's name, never its contents: enough to find the conversation, not a second copy of it
        metadata: { board: meta.board },
      },
    },
    {
      id: id(), type: "generation-create", timestamp: endedAt,
      body: {
        id: turn.observationId, traceId: turn.traceId, name: meta.name, model: meta.model,
        startTime: turn.startedAt, endTime: endedAt,
        // the shape of the exchange without the exchange: enough to see a prompt that ran away or a
        // reply that came back truncated, which is most of what a size tells you anyway
        metadata: { promptChars: turn.system.length + turn.user.length, replyChars: turn.output?.length ?? 0 },
        ...(full ? {
          input: [{ role: "system", content: turn.system }, { role: "user", content: turn.user }],
          output: turn.error ? undefined : turn.output,
        } : {}),
        level: turn.error ? "ERROR" : "DEFAULT",
        // an error message is about what staves did, not about what they said, so it travels either way
        statusMessage: turn.error,
      },
    },
  ];
}
