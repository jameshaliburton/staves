import { readLock } from "./daemon.js";
import type { Credentials } from "./hosted.js";

/** Where a local board opens when nothing is serving it yet: the port the daemon prefers. */
export const LOCAL_BASE = "http://localhost:5178/b/local";
/** One guide, in one place. Every screen that can leave a person stuck ends with this link. */
const GUIDE = "https://staves.io/docs/connect/";
const START = "start it with npx @staves/cli open";

/** Where this project's boards are, and whether anything is serving them right now. A link nobody
 * is answering is still worth printing — but only beside the command that makes it answer. */
export interface BaseLink { url: string; live: boolean; hint?: string }

const parse = (base: string): URL | undefined => { try { return new URL(base); } catch { return undefined; } };
/** A base under /b/ is already one workspace's own page: a local daemon, or a host-mode token. An
 * account origin is not — its boards and its workspace are different pages of the same service. */
const workspacePage = (target: URL) => target.pathname.startsWith("/b/");

/** One board on a base. Every scheme staves serves names the board the same way, so this is the
 * only place that has to know how. */
export function boardUrl(base: string, id: string): string {
  const target = new URL(base);
  target.searchParams.set("board", id);
  return target.toString();
}

/** Every board this connection can open. On a board server that is the page itself. */
export function workspaceUrl(base: string): string {
  const target = parse(base);
  return !target || workspacePage(target) ? base : `${base.replace(/\/$/, "")}/workspace`;
}

/** How to connect an agent to Staves. A service somebody else runs serves its own copy of the
 * guide; everything else — a local daemon included — is pointed at the one on staves.io. */
export function guideUrl(base?: string): string {
  const target = base === undefined ? undefined : parse(base);
  if (!target || workspacePage(target) || /(^|\.)staves\.io$/i.test(target.hostname)) return GUIDE;
  return `${target.origin}/docs/connect/`;
}

async function answers(url: string, fetchImpl: typeof globalThis.fetch): Promise<boolean> {
  try { return (await fetchImpl(`${url}/staves-version`, { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}

export interface ResolveBaseInput { dir: string; credentials?: Credentials | null }

/** Where this project's boards open. An account answers wherever it is; a local daemon has to be
 * running, and its lock file outlives the process that wrote it — so the lock is asked, not
 * believed. When nothing answers the link is still named, with the command that starts it. */
export async function resolveBase(input: ResolveBaseInput, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<BaseLink> {
  if (input.credentials) return { url: input.credentials.url.replace(/\/$/, ""), live: true };
  const lock = readLock(input.dir);
  if (lock && await answers(lock.url, fetchImpl)) return { url: `${lock.url}/b/local`, live: true };
  return { url: LOCAL_BASE, live: false, hint: START };
}
