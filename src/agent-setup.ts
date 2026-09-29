import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** One home-directory lookup, overridable so a test never reads or writes the real one. */
export function homeDir(): string {
  return process.env.STAVES_HOME_DIR || os.homedir();
}

const begin = "<!-- staves:generated:start -->";
const end = "<!-- staves:generated:end -->";
const legacySkills = new Set([
  "50c11da4f764d4cd9b593f7797571b3a8a8e1296a66203e475b763437570c22d",
  "3bc744866aab945a207c5c30b48ecb844f5dbc98d45f50380dc551ebcc088faf",
]);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function readOptional(file: string): Promise<string> {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}

/** Update only an untouched generated skill. A custom skill remains byte-for-byte intact. */
export async function installSkill(file: string, content: string): Promise<boolean> {
  const existing = await readOptional(file);
  const signature = existing.match(/\n<!-- staves:sha256:([a-f0-9]{64}) -->\n$/);
  const body = signature ? existing.slice(0, signature.index) : existing;
  if (existing && !legacySkills.has(digest(existing)) && (!signature || digest(body) !== signature[1])) {
    await fs.writeFile(file + ".generated.md", content);
    return false;
  }
  await fs.writeFile(file, `${content}\n<!-- staves:sha256:${digest(content)} -->\n`);
  return true;
}

/** The text inside the managed block, so a caller can tell a current block from an older one. */
export function managedBlock(existing: string): string | null {
  const from = existing.indexOf(begin), to = existing.indexOf(end);
  return from >= 0 && to > from ? existing.slice(from + begin.length, to).trim() : null;
}

/** `legacy` is every block this CLI has written without markers. Each shipped version wrote its
 * own text, so upgrading a file that predates the markers means recognising all of them; the first
 * one present is replaced. Anything else in the file is left exactly as the person wrote it. */
export function managedInstructions(existing: string, content: string, legacy?: string | string[]): string {
  const block = `${begin}\n${content.trim()}\n${end}`;
  if (existing.includes(begin) && existing.includes(end)) {
    return existing.slice(0, existing.indexOf(begin)) + block + existing.slice(existing.indexOf(end) + end.length);
  }
  const anchor = (legacy === undefined ? [] : [legacy].flat()).find(text => text && existing.includes(text));
  if (anchor) return existing.replace(anchor, `\n${block}\n`);
  return `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}\n${block}\n`;
}

/** Keep all non-Staves TOML verbatim. Only replace this server's table and subtables, and keep
 * `[mcp_servers.staves.env]` as written: those are the credentials the server is launched with. */
export function codexConfig(existing: string, args: string[]): string {
  const lines = existing.split("\n");
  let mode: "keep" | "replace" | "env" = "keep";
  const kept: string[] = [];
  const env: string[] = [];
  for (const line of lines) {
    const table = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (table) {
      const staves = /^mcp_servers\.(?:staves|"staves"|'staves')(?:\.|$)/.test(table[1]);
      mode = !staves ? "keep" : /^mcp_servers\.(?:staves|"staves"|'staves')\.env(?:\.|$)/.test(table[1]) ? "env" : "replace";
    }
    if (mode === "keep") kept.push(line);
    else if (mode === "env") env.push(line);
  }
  if (kept.some(line => /^\s*mcp_servers\s*[.=]/.test(line) || /^\s*(?:"staves"|'staves'|staves)\s*=/.test(line))) {
    throw new Error("Codex uses an inline/dotted MCP configuration. Move the staves entry into [mcp_servers.staves], then rerun setup; other configuration was preserved.");
  }
  const preserved = env.join("\n").trimEnd();
  return `${kept.join("\n").trimEnd()}\n\n[mcp_servers.staves]\ncommand = "npx"\nargs = ${JSON.stringify(args)}\n${preserved ? preserved + "\n" : ""}`;
}

/** The args of `[mcp_servers.staves]` in a Codex config, when it has a readable one. */
export function codexServerArgs(existing: string): string[] | undefined {
  const section = existing.match(/\[mcp_servers\.(?:staves|"staves"|'staves')\]([^]*?)(?=\n\s*\[|$)/)?.[1];
  const raw = section?.match(/^\s*args\s*=\s*(\[.*\])\s*$/m)?.[1];
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((value): value is string => typeof value === "string") ? parsed : undefined;
  } catch { return undefined; }
}

/** The `[mcp_servers.staves.env]` table of a Codex config: the environment the server is launched
 * with, which is where credentials such as the Langfuse keys actually live. Values are read as TOML
 * basic or literal strings, which is all anything writes there. */
export function codexServerEnv(existing: string): Record<string, string> | undefined {
  const section = existing.match(/\[mcp_servers\.(?:staves|"staves"|'staves')\.env\]([^]*?)(?=\n\s*\[|$)/)?.[1];
  if (section === undefined) return undefined;
  const env: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const pair = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*=\s*(\S.*)$/);
    if (!pair) continue;
    const raw = pair[4].trim();
    const double = raw.match(/^"(?:[^"\\]|\\.)*"/), single = raw.match(/^'([^']*)'/);
    let value = raw.replace(/\s+#.*$/, "");
    if (double) { try { value = JSON.parse(double[0]) as string; } catch { value = double[0].slice(1, -1); } }
    else if (single) value = single[1];
    env[pair[1] ?? pair[2] ?? pair[3]] = value;
  }
  return Object.keys(env).length ? env : undefined;
}

export async function registerCodex(root: string, args: string[]): Promise<void> {
  const file = path.join(root, ".codex", "config.toml");
  const content = codexConfig(await readOptional(file), args);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
