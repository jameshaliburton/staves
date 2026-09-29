/** Provider transports use fixed HTTPS endpoints; credentials never enter URLs or errors. */
import type { Complete } from "./interviewer.js";

export type ModelProvider = "anthropic" | "openai" | "gemini";
export interface ModelConfig { provider: ModelProvider; model: string }
export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
};
const names = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini" };
export class ModelConnectionError extends Error {}
export function normalizeModelConfig(options: { provider?: unknown; model?: unknown } = {}): ModelConfig {
  const provider = options.provider ?? "anthropic";
  if (provider !== "anthropic" && provider !== "openai" && provider !== "gemini") throw new ModelConnectionError("Choose Anthropic, OpenAI, or Gemini.");
  const model = options.model === undefined || options.model === "" ? DEFAULT_MODELS[provider] : options.model;
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model)) throw new ModelConnectionError("Enter a valid model ID without spaces or URL characters.");
  return { provider, model };
}
function failure(provider: ModelProvider, status?: number): ModelConnectionError {
  const label = names[provider];
  const message = status === 401 || status === 403 ? "Check your API key and its access permissions."
    : status === 429 ? "Your account is rate limited or out of quota. Check billing and retry."
    : status === 400 || status === 404 ? "Check the model ID and whether your account can use it."
    : status && status >= 500 ? "The provider is temporarily unavailable. Please retry."
    : "The connection failed or timed out. Please retry.";
  return new ModelConnectionError(`${label}: ${message}`);
}
/** One interview turn is a reply plus its suggestion cards. Every provider gets the same room for it;
 *  Anthropic asked for 1400 from the single-provider days, which truncated ordinary answers. */
export const REPLY_BUDGET = 4096;

type Payload = {
  type?: string;
  error?: unknown;
  delta?: { type?: string; text?: string; stop_reason?: string };
  content?: { text?: string }[];
  choices?: { delta?: { content?: string }; message?: { content?: string }; finish_reason?: string }[];
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  stop_reason?: string;
  promptFeedback?: { blockReason?: string };
};
function content(data: Payload, provider: ModelProvider, streaming: boolean): string {
  if (data.error || data.type === "error") throw failure(provider);
  if (data.stop_reason === "max_tokens" || data.delta?.stop_reason === "max_tokens" || data.choices?.[0]?.finish_reason === "length" || data.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new ModelConnectionError(`${names[provider]}: The reply ran past the model's output limit before it was finished. Ask for a smaller piece of the work — one job, or one part of the flow — and retry.`);
  if (data.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(data.candidates?.[0]?.finishReason ?? "") || data.choices?.[0]?.finish_reason === "content_filter") throw new ModelConnectionError(`${names[provider]} could not answer this request. Please rephrase it and retry.`);
  if (provider === "anthropic") return streaming ? (data.delta?.type === "text_delta" ? data.delta.text ?? "" : "") : (data.content ?? []).map(part => part.text ?? "").join("");
  if (provider === "openai") return (streaming ? data.choices?.[0]?.delta?.content : data.choices?.[0]?.message?.content) ?? "";
  return (data.candidates?.[0]?.content?.parts ?? []).filter(part => !part.thought).map(part => part.text ?? "").join("");
}
export const byKey = (key: string, options: { provider?: unknown; model?: unknown } = {}): Complete => {
  const { provider, model } = normalizeModelConfig(options);
  if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key) || key.length > 4096) throw new ModelConnectionError(`Enter a valid ${names[provider]} API key.`);
  return async (system, user, onText) => {
    const streaming = !!onText;
    const headers: Record<string, string> = { "content-type": "application/json" };
    let endpoint: string;
    let body: unknown;
    if (provider === "anthropic") {
      endpoint = "https://api.anthropic.com/v1/messages";
      Object.assign(headers, { "x-api-key": key.trim(), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
      // The system prompt is the same bytes every turn; the board and transcript are not, and they sit in
      // the user message. One breakpoint at the end of the system prompt makes the stable part a cache
      // prefix: written once, then read at a tenth of the price for as long as the person keeps talking.
      // OpenAI caches long prefixes automatically and Gemini caches implicitly, so neither needs marking.
      body = { model, max_tokens: REPLY_BUDGET, stream: streaming, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] };
    } else if (provider === "openai") {
      endpoint = "https://api.openai.com/v1/chat/completions";
      headers.authorization = `Bearer ${key.trim()}`;
      body = { model, max_completion_tokens: REPLY_BUDGET, stream: streaming, store: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    } else {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${streaming ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      headers["x-goog-api-key"] = key.trim();
      body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: REPLY_BUDGET } };
    }
    try {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw failure(provider, response.status);
      if (!streaming) {
        const text = content(await response.json() as Payload, provider, false);
        if (!text.trim()) throw new ModelConnectionError(`${names[provider]} returned no text. Check the model and retry.`);
        return text;
      }
      if (!response.body) throw failure(provider);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", text = "";
      const consume = (line: string) => {
        if (!line.startsWith("data:")) return;
        const value = line.slice(5).trim();
        if (!value || value === "[DONE]") return;
        const delta = content(JSON.parse(value) as Payload, provider, true);
        if (delta) { text += delta; onText?.(text); }
      };
      try {
        for (;;) {
          const next = await reader.read();
          buffer += decoder.decode(next.value, { stream: !next.done });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n")) >= 0) {
            consume(buffer.slice(0, boundary).replace(/\r$/, ""));
            buffer = buffer.slice(boundary + 1);
          }
          if (next.done) { if (buffer.trim()) consume(buffer); break; }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!text.trim()) throw new ModelConnectionError(`${names[provider]} returned no text. Check the model and retry.`);
      return text;
    } catch (error) {
      if (error instanceof ModelConnectionError) throw error;
      throw failure(provider);
    }
  };
};
export async function testModelConnection(key: string, options: { provider?: unknown; model?: unknown } = {}): Promise<ModelConfig> {
  const config = normalizeModelConfig(options);
  await byKey(key, config)("Respond with only the word OK.", "Connection test.");
  return config;
}
