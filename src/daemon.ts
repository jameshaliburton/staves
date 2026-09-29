import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { serveHttp, liveFor } from "./server.js";

/** One daemon per .staves dir. The lockfile says where it is. */
export function lockPath(dir: string) { return path.join(dir, ".daemon.json"); }
export function readLock(dir: string): { port: number; pid: number; url: string; since: string } | null {
  const p = lockPath(dir);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
export async function alive(url: string): Promise<boolean> {
  try { const r = await fetch(url + "/staves-version", { signal: AbortSignal.timeout(800) }); return r.ok; } catch { return false; }
}
/** Find a live daemon for this dir, or start one in the background and wait for it. */
export async function ensureDaemon(dir: string, preferPort = 5178, log: (s: string) => void = () => {}): Promise<string> {
  const lock = readLock(dir);
  if (lock && (await alive(lock.url))) return lock.url + "/b/local";
  mkdirSync(dir, { recursive: true });
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
  const child = spawn(process.execPath, [cli, "web", "--dir", dir, String(preferPort), "--no-open", "--idle"], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const l = readLock(dir);
    if (l && (await alive(l.url))) { log(`staves started at ${l.url}`); return l.url + "/b/local"; }
  }
  throw new Error("could not start the staves daemon");
}
/** Run as the daemon: own the store and the page, write the lockfile, exit when told. */
export async function runDaemon(dir: string, port: number, idleMs = 0) {
  mkdirSync(dir, { recursive: true });
  const store = new Store(dir);
  const url = await serveHttp(store, port, (m) => console.error(m));
  if (!url) { console.error("staves: no free port"); process.exit(1); }
  writeFileSync(lockPath(dir), JSON.stringify({ port: Number(url.split(":").pop()), pid: process.pid, url, since: new Date().toISOString() }));
  if (idleMs > 0) { let idleSince = Date.now(); setInterval(() => { const l = liveFor(dir); if (l.presence.size || l.sse.size) idleSince = Date.now(); else if (Date.now() - idleSince > idleMs) { console.error("staves: nothing connected for a while — stopping"); process.exit(0); } }, 30_000).unref(); }
  const clean = () => { try { if (readLock(dir)?.pid === process.pid) unlinkSync(lockPath(dir)); } catch {} };
  process.on("exit", clean); process.on("SIGINT", () => process.exit(0)); process.on("SIGTERM", () => process.exit(0));
  return url;
}

/** The web service writes the same lockfile so doctor, open and the MCP clients find it. */
export function writeLock(dir: string, url: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockPath(dir), JSON.stringify({ port: Number(url.split(":").pop()), pid: process.pid, url, since: new Date().toISOString() }));
  const clean = () => { try { if (readLock(dir)?.pid === process.pid) unlinkSync(lockPath(dir)); } catch {} };
  process.on("exit", clean); process.on("SIGINT", () => process.exit(0)); process.on("SIGTERM", () => process.exit(0));
}

export function liveIdle(dir: string, idleMs: number) {
  let idleSince = Date.now();
  setInterval(() => { const l = liveFor(dir); if (l.presence.size || l.sse.size) idleSince = Date.now(); else if (Date.now() - idleSince > idleMs) { console.error("staves: nothing connected for a while — stopping"); process.exit(0); } }, 30_000).unref();
}
