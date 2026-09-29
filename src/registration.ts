import { existsSync } from "node:fs";
import path from "node:path";
import { codexServerArgs, codexServerEnv, homeDir, readOptional } from "./agent-setup.js";
import { readCredentials, type LangfuseKeys } from "./hosted.js";
import { VERSION } from "./version.js";

/** The clients a project registration is written for; one file each. */
export type RegistrationClient = "claude" | "cursor" | "codex" | "gemini";

export interface Registration {
  label: string;
  file: string;
  client?: RegistrationClient;
  serverArgs?: string[];
  env?: unknown;
  reason?: string;
  state: "present" | "absent" | "unreadable";
}

export function table(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** The `staves` server entry of an MCP configuration object, whatever shape the file actually has. */
export function stavesEntry(config: unknown): Record<string, unknown> | undefined {
  return table(table(table(config)?.mcpServers)?.staves);
}
export function entryArgs(entry: unknown): string[] | undefined {
  const args = table(entry)?.args;
  return Array.isArray(args) && args.every((value): value is string => typeof value === "string") ? args : undefined;
}

/** A spec npm resolves from a checkout rather than the registry: file:, link:, or a filesystem
 * path. It is a developer running their own build, not a misspelled package name. A bare name with
 * no separator is a registry name however it is spelled — `p5.js` is a package, not a file. */
export function isLocalSpec(spec: string): boolean {
  return /^(?:file:|link:)/.test(spec)
    || /^(?:\.{1,2}\/|~\/|\/|[A-Za-z]:\\)/.test(spec)
    || (/[\\/]/.test(spec) && !spec.startsWith("@"));
}

/** npx runs flags, then the package spec, then the package's own command. The published package is
 * `@staves/cli`; registrations written before the rename name `staves`, which npm does not serve. */
export function packageToken(serverArgs: string[]): { index: number; spec: string; name: string; version?: string; local: boolean } | undefined {
  const index = serverArgs.findIndex(value => !value.startsWith("-"));
  if (index < 0) return undefined;
  const spec = serverArgs[index];
  if (isLocalSpec(spec)) return { index, spec, name: spec, local: true };
  const at = spec.lastIndexOf("@");
  return at > 0
    ? { index, spec, name: spec.slice(0, at), version: spec.slice(at + 1), local: false }
    : { index, spec, name: spec, local: false };
}

/** A registration npm cannot resolve, or one pinned to a version this CLI is not. A local checkout
 * is neither: the developer chose it. Returns the spec as written, so a report can name it. */
export function stalePackage(serverArgs: string[] | undefined): string | undefined {
  if (!serverArgs) return undefined;
  const token = packageToken(serverArgs);
  if (token?.local) return undefined;
  if (!token || token.name !== "@staves/cli") return token?.spec ?? "(no package)";
  return token.version && token.version !== VERSION ? token.spec : undefined;
}

/** A file doctor cannot open is a line in the report, never the end of it: permissions, a directory
 * where a config should be, a half-written file. Only ENOENT is silence. */
export async function readForReport(file: string): Promise<{ text: string } | { reason: string }> {
  try { return { text: await readOptional(file) }; }
  catch (error) {
    const failure = error as NodeJS.ErrnoException;
    return { reason: failure.code ?? (error instanceof Error ? error.message : String(error)) };
  }
}

export async function jsonRegistration(file: string, label: string, pick: (config: unknown) => Record<string, unknown> | undefined, client?: RegistrationClient): Promise<Registration> {
  const read = await readForReport(file);
  if ("reason" in read) return { label, file, client, state: "unreadable", reason: read.reason };
  if (!read.text.trim()) return { label, file, client, state: "absent" };
  let parsed: unknown;
  try { parsed = JSON.parse(read.text); } catch { return { label, file, client, state: "unreadable", reason: "invalid JSON" }; }
  const entry = pick(parsed);
  return entry ? { label, file, client, state: "present", serverArgs: entryArgs(entry), env: entry.env } : { label, file, client, state: "absent" };
}

export async function tomlRegistration(file: string, label: string, client?: RegistrationClient): Promise<Registration> {
  const read = await readForReport(file);
  if ("reason" in read) return { label, file, client, state: "unreadable", reason: read.reason };
  if (!read.text.trim()) return { label, file, client, state: "absent" };
  const serverArgs = codexServerArgs(read.text);
  return serverArgs ? { label, file, client, state: "present", serverArgs, env: codexServerEnv(read.text) } : { label, file, client, state: "absent" };
}

/** The registration files whose staves entry carries Langfuse keys in the environment the MCP server
 * is launched with. Named, because which file holds them is the whole question: they are not in this
 * shell, and a client that reads a different file will not see them. */
export function langfuseRegistrations(registrations: Registration[]): string[] {
  return registrations
    .filter(item => Object.keys(table(item.env) ?? {}).some(key => key.startsWith("LANGFUSE")))
    .map(item => item.label);
}

/** A usable pair from one environment: both keys present and shaped like Langfuse keys, so an
 * unexpanded `${LANGFUSE_SECRET_KEY}` or half a pair is not mistaken for keys. The server is read as
 * src/langfuse.ts reads it: LANGFUSE_BASE_URL, then LANGFUSE_HOST; neither leaves Langfuse Cloud. */
function langfuseKeysIn(env: unknown): LangfuseKeys | undefined {
  const values = table(env);
  const text = (name: string) => typeof values?.[name] === "string" ? (values[name] as string).trim() : "";
  const publicKey = text("LANGFUSE_PUBLIC_KEY"), secretKey = text("LANGFUSE_SECRET_KEY"), baseUrl = text("LANGFUSE_BASE_URL") || text("LANGFUSE_HOST");
  if (!publicKey.startsWith("pk-lf-") || !secretKey.startsWith("sk-lf-")) return undefined;
  return { publicKey, secretKey, ...(baseUrl ? { baseUrl } : {}) };
}

/** The Langfuse keys the coding agent already has: this shell's LANGFUSE_* first, then the env block
 * of this project's registered staves server. `source` names where, never what. */
export function agentLangfuseKeys(env: NodeJS.ProcessEnv | Record<string, string | undefined>, registrations: Registration[]): { source: string; keys: LangfuseKeys } | undefined {
  const shell = langfuseKeysIn(env);
  if (shell) return { source: "this shell", keys: shell };
  for (const item of registrations) {
    const keys = langfuseKeysIn(item.env);
    if (keys) return { source: item.label, keys };
  }
  return undefined;
}

/** The question staves connect asks in a terminal: which Staves, and which Langfuse the keys reach — never the keys. */
export function shareRunsQuestion(stavesUrl: string, keys: LangfuseKeys): string {
  const hostOf = (value: string) => { try { return new URL(value).host; } catch { return value; } };
  return `Show this project's runs on ${hostOf(stavesUrl)} using the Langfuse keys your coding agent already has (${hostOf(keys.baseUrl ?? "https://cloud.langfuse.com")})? [Y/n] `;
}

/** The three files a project registration is written to, in the order a person meets them. One
 * reader for the report and the home screen, so the two can never disagree about what is set up. */
export function projectRegistrations(root: string): Promise<Registration[]> {
  return Promise.all([
    jsonRegistration(path.join(root, ".mcp.json"), ".mcp.json", stavesEntry, "claude"),
    jsonRegistration(path.join(root, ".cursor", "mcp.json"), ".cursor/mcp.json", stavesEntry, "cursor"),
    tomlRegistration(path.join(root, ".codex", "config.toml"), ".codex/config.toml", "codex"),
    jsonRegistration(path.join(root, ".gemini", "settings.json"), ".gemini/settings.json", stavesEntry, "gemini"),
  ]);
}

/** Registrations outside this project, which doctor reports and never edits. */
export function userRegistrations(root: string): Promise<Registration[]> {
  const home = homeDir();
  return Promise.all([
    jsonRegistration(path.join(home, ".mcp.json"), "~/.mcp.json", stavesEntry),
    jsonRegistration(path.join(home, ".claude.json"), "~/.claude.json", stavesEntry),
    jsonRegistration(path.join(home, ".claude.json"), `~/.claude.json projects[${root}]`, config => stavesEntry(table(table(config)?.projects)?.[root])),
    tomlRegistration(path.join(home, ".codex", "config.toml"), "~/.codex/config.toml"),
    jsonRegistration(path.join(home, ".gemini", "settings.json"), "~/.gemini/settings.json", stavesEntry),
  ]);
}

/** Say what the entry would actually launch, and what about it is wrong. Reads only. `note` takes
 * the lines that are stale but working, so a caller can decide separately whether those are a
 * failure; by default they are printed like everything else. */
export async function reportRegistration(item: Registration, scope: "project" | "user", say: (line: string) => void, note: (line: string) => void = say): Promise<void> {
  if (item.state === "absent") return say(`· ${item.label}: no staves entry`);
  if (item.state === "unreadable") return say(`✗ ${item.label}: cannot be read (${item.reason ?? "unknown reason"})`);
  if (!item.serverArgs) return say(`✗ ${item.label}: the staves entry has no args list`);
  say(`✓ ${item.label}: npx ${item.serverArgs.join(" ")}`);
  const problems: string[] = [];
  const token = packageToken(item.serverArgs);
  // A checkout is a deliberate choice, not a fault: say what it is and check nothing about pins.
  if (token?.local) say(`  · ${item.label}: local development registration (${token.spec}) — not the published package`);
  else if (!token || token.name !== "@staves/cli") problems.push(`✗ package "${token?.name ?? "none"}" is not @staves/cli (that package does not exist on npm)`);
  else if (token.version && token.version !== VERSION) problems.push(`· pinned @staves/cli@${token.version}, current is ${VERSION} — run staves setup`);
  if (item.serverArgs.includes("--dir")) {
    const target = item.serverArgs[item.serverArgs.indexOf("--dir") + 1];
    if (!target || !existsSync(target)) problems.push(`✗ --dir ${target ?? "(no path)"} does not exist`);
  }
  if (item.serverArgs.includes("--hosted")) {
    // No --connection is the legacy default credential file, which the server would also accept.
    const id = item.serverArgs.includes("--connection") ? item.serverArgs[item.serverArgs.indexOf("--connection") + 1] : undefined;
    if (!await readCredentials(id)) problems.push(`✗ credential for --connection ${id ?? "(the legacy default)"} missing — run staves connect`);
  }
  for (const problem of problems) (problem.startsWith("·") ? note : say)("  " + problem);
  if (problems.length) say(scope === "project" ? "  · fix with: staves setup" : `  · edit ${item.file} or rerun staves init/connect in the project that wrote it`);
}
