import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * A project's .staves/config.json. The hosted connection reference is kept here, on this machine, so the
 * instruction files an agent reads (CLAUDE.md, AGENTS.md, GEMINI.md) can be committed without it.
 */
async function read(stavesDir: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(stavesDir, "config.json"), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

/** The connection this project was connected with, if it was. */
export async function projectConnection(stavesDir: string): Promise<string | undefined> {
  const connection = (await read(stavesDir)).connection;
  return typeof connection === "string" && connection ? connection : undefined;
}

/** Remember the connection for this project, keeping everything else in the config as it was. */
export async function recordProjectConnection(stavesDir: string, connection: string): Promise<void> {
  const config = await read(stavesDir);
  if (config.connection === connection) return;
  await fs.mkdir(stavesDir, { recursive: true });
  await fs.writeFile(path.join(stavesDir, "config.json"), JSON.stringify({ ...config, connection }, null, 2) + "\n");
}
