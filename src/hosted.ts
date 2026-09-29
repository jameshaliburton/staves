import { promises as fs } from "node:fs";
import path from "node:path";
import { homeDir } from "./agent-setup.js";
import { CloudStoreConflict } from "./conflict.js";
import { Store } from "./store.js";
import type { Entry } from "./ops.js";

/** Credentials authorize gateway calls only; no account session is issued to an agent. */
export interface Credentials { url: string; token: string; email: string; boards?: string[] | null }
export interface Session {
  email: string;
  user_id: string;
  boards: string[] | null;
  permission: "read" | "contribute";
  createLimit: number;
  createdCount: number;
}

const directory = () => path.join(homeDir(), ".staves");
export function credentialsPath(connection?: string): string {
  if (connection === undefined) return path.join(directory(), "credentials.json");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(connection)) throw new HostedAuthError("Invalid connection reference.");
  return path.join(directory(), "connections", connection + ".json");
}

export async function readCredentials(connection?: string): Promise<Credentials | null> {
  try {
    const raw = JSON.parse(await fs.readFile(credentialsPath(connection), "utf8"));
    return typeof raw?.token === "string" && typeof raw?.url === "string" ? raw as Credentials : null;
  } catch { return null; }
}

/** The connection already holding this account on this server, so reconnecting reuses it. Without an
 * email, the first connection held for this server. */
export async function findConnection(url: string, email?: string): Promise<string | null> {
  let names: string[];
  try { names = await fs.readdir(path.join(directory(), "connections")); }
  catch { return null; }
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const credentials = await readCredentials(name.slice(0, -".json".length)).catch(() => null);
    if (credentials?.url === url && (email === undefined || credentials.email === email)) return name.slice(0, -".json".length);
  }
  return null;
}

/** Whether any Staves account credential is stored on this machine, for any server: the default
 * file, or a credential any named connection holds. Enough to know that connecting this project
 * would reuse an account somebody has already signed in to, without opening it to find out. */
export async function anyCredentials(): Promise<boolean> {
  if (await readCredentials()) return true;
  let names: string[];
  try { names = await fs.readdir(path.join(directory(), "connections")); }
  catch { return false; }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (await readCredentials(name.slice(0, -".json".length)).catch(() => null)) return true;
  }
  return false;
}

export async function writeCredentials(credentials: Credentials, connection?: string): Promise<void> {
  await fs.mkdir(path.dirname(credentialsPath(connection)), { recursive: true, mode: 0o700 });
  await fs.writeFile(credentialsPath(connection), JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
  await fs.chmod(credentialsPath(connection), 0o600);
}

export async function forgetCredentials(connection?: string): Promise<boolean> {
  try { await fs.unlink(credentialsPath(connection)); return true; } catch { return false; }
}

export class HostedAuthError extends Error {}

/** Reject destinations that could expose credentials over an insecure connection. */
function siteUrl(site: string): string {
  let parsed: URL;
  try { parsed = new URL(site); } catch { throw new HostedAuthError("Provide a valid Staves URL."); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new HostedAuthError("Use the Staves site address without a path, query or credentials.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) {
    throw new HostedAuthError("Use HTTPS for hosted Staves connections.");
  }
  return parsed.origin;
}

async function gatewayRequest(site: string, resource: string, init: RequestInit, fetchImpl: typeof globalThis.fetch): Promise<unknown> {
  const origin = siteUrl(site);
  let response: Response;
  try {
    response = await fetchImpl(origin + resource, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch { throw new HostedAuthError(`Could not reach ${origin}. Check the address and your connection.`); }
  const result: unknown = response.status === 204 ? undefined : await response.json().catch(() => ({}));
  if (!response.ok) {
    const problem = result as { error?: string; message?: string } | undefined;
    if (response.status === 409) throw new CloudStoreConflict();
    throw new HostedAuthError(problem?.error || problem?.message || "Could not access your Staves boards.");
  }
  return result;
}

/** Validate a token and read its grant. Deliberately never receives a Supabase session. */
export async function exchange(url: string, token: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<Session> {
  const value = await gatewayRequest(url, "/auth/cli/exchange", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  }, fetchImpl) as Partial<Session>;
  if (!value || typeof value.email !== "string" || typeof value.user_id !== "string" ||
      !(value.boards === null || (Array.isArray(value.boards) && value.boards.every(board => typeof board === "string"))) ||
      !["read", "contribute"].includes(value.permission ?? "") ||
      !Number.isInteger(value.createLimit) || !Number.isInteger(value.createdCount)) {
    throw new HostedAuthError("The server did not return a usable connection. Update Staves and reconnect.");
  }
  return { email: value.email, user_id: value.user_id, boards: value.boards,
    permission: value.permission!, createLimit: value.createLimit!, createdCount: value.createdCount! };
}

/** Consume a temporary handoff once. Only the returned durable token is stored locally. */
export async function pairHandoff(url: string, code: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<string> {
  const value = await gatewayRequest(url, "/auth/cli/pair", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
  }, fetchImpl) as { token?: string };
  if (!value || typeof value.token !== "string" || !/^sta_[A-Za-z0-9_-]{43}$/.test(value.token)) {
    throw new HostedAuthError("The server did not return a usable connection token.");
  }
  return value.token;
}

/** A coding agent's Langfuse keys, as the MCP server is launched with them. Never printed or stored locally. */
export interface LangfuseKeys { publicKey: string; secretKey: string; baseUrl?: string }
/** What the gateway kept: the project the keys reach, and the connection's boards that now show its runs. */
export interface SharedRuns { projectId: string; projectName: string | null; boards: string[] }

const connectionHeaders = (token: string) => ({ "content-type": "application/json", Authorization: "Bearer " + token });
const unusableRuns = () => new HostedAuthError("The server did not return a usable answer about runs. Update Staves and try again.");

/** Hand this connection's Langfuse keys to the account once, so staves.io shows its boards' runs.
 * The gateway checks them against Langfuse and stores the secret encrypted; nothing comes back but the project. */
export async function shareRuns(credentials: Pick<Credentials, "url" | "token">, keys: LangfuseKeys, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<SharedRuns> {
  const body = { publicKey: keys.publicKey, secretKey: keys.secretKey, ...(keys.baseUrl ? { baseUrl: keys.baseUrl } : {}) };
  const value = await gatewayRequest(credentials.url, "/cli-api/langfuse", { method: "POST", headers: connectionHeaders(credentials.token), body: JSON.stringify(body) }, fetchImpl) as Partial<SharedRuns> | undefined;
  if (!value || typeof value.projectId !== "string" || !(value.projectName === null || typeof value.projectName === "string")
      || !Array.isArray(value.boards) || !value.boards.every(board => typeof board === "string")) throw unusableRuns();
  return { projectId: value.projectId, projectName: value.projectName, boards: value.boards };
}

/** The Langfuse project staves.io shows this connection's runs from, or null when it shows none. */
export async function runsProject(credentials: Pick<Credentials, "url" | "token">, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<string | null> {
  const value = await gatewayRequest(credentials.url, "/cli-api/langfuse", { headers: connectionHeaders(credentials.token) }, fetchImpl) as { projectId?: unknown } | undefined;
  if (!value || !(value.projectId === null || typeof value.projectId === "string")) throw unusableRuns();
  return value.projectId;
}

/** Every operation crosses the gateway with the original scoped token. There is no cached auth
 * session: revocation, invitation changes and grant checks apply to the very next request. */
export class GatewayStore extends Store {
  constructor(private readonly credentials: Credentials, userId: string, private readonly requestFetch: typeof globalThis.fetch = globalThis.fetch) {
    super("cloud:" + userId);
  }
  /** Fresh grant metadata lets agents scope work before consuming creation allowance. */
  access(): Promise<Session> {
    return exchange(this.credentials.url, this.credentials.token, this.requestFetch);
  }
  /** The Langfuse project staves.io shows this connection's runs from, or null when it shows none. */
  runsProject(): Promise<string | null> {
    return runsProject(this.credentials, this.requestFetch);
  }
  private request(resource: string, init: RequestInit = {}): Promise<unknown> {
    return gatewayRequest(this.credentials.url, "/cli-api" + resource, {
      ...init,
      headers: connectionHeaders(this.credentials.token),
    }, this.requestFetch);
  }
  private boardResource(board: string): string {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(board)) throw new Error("Invalid board name.");
    return "/board?board=" + encodeURIComponent(board);
  }
  override async list(): Promise<string[]> {
    const result = await this.request("/boards") as { boards: { name: string; updated_at: string }[] };
    return result.boards.map(board => board.name);
  }
  override async has(board: string): Promise<boolean> {
    return (await this.list()).includes(board);
  }
  override async touchedAt(board: string): Promise<string | null> {
    this.boardResource(board);
    const result = await this.request("/boards") as { boards: { name: string; updated_at: string }[] };
    return result.boards.find(row => row.name === board)?.updated_at ?? null;
  }
  protected override async readLog(board: string): Promise<{ entries: Entry[]; revision: number }> {
    return await this.request(this.boardResource(board)) as { entries: Entry[]; revision: number };
  }
  protected override async writeLog(board: string, entries: Entry[], revision: number, mode: "append" | "replace"): Promise<void> {
    if (mode !== "append") throw new Error("Agent connections cannot replace board history. Use the board in Staves to review changes.");
    await this.request(this.boardResource(board), { method: "POST", body: JSON.stringify({ entries, revision, mode }) });
  }
  override async branch(base: string, name: string, title: string, baselineName?: string): Promise<import("./model.js").Board> {
    this.boardResource(base); this.boardResource(name);
    return await this.request("/branch", { method: "POST", body: JSON.stringify({ base, name, title, baselineName }) }) as import("./model.js").Board;
  }
  override async deleteBoard(_board: string): Promise<void> {
    throw new Error("Agent connections cannot delete boards. Delete the board in Staves.");
  }
  override watch(_cb: () => void): () => void { return () => {}; }
}

export async function hostedStore(credentials: Credentials, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<GatewayStore> {
  const grant = await exchange(credentials.url, credentials.token, fetchImpl);
  return new GatewayStore(credentials, grant.user_id, fetchImpl);
}
