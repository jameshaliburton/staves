import type { ProposalBasis } from "./proposals.js";
import type { Board } from "./model.js";
import type { Entry, Op } from "./ops.js";

/** How long the daemon gets to answer before the wait is called a failure. A daemon that is wedged,
 * or one whose port was inherited by something else, otherwise hangs the agent's call forever. */
export const DAEMON_TIMEOUT = 10_000;

const seconds = (ms: number) => ms >= 1000 ? `${Math.round(ms / 1000)} second${ms >= 2000 ? "s" : ""}` : `${ms} milliseconds`;
export const daemonTimeout = (ms: number) => `The local Staves daemon did not answer within ${seconds(ms)}.`;

/** fetch reports an abort as the signal's reason, sometimes wrapped as the cause of a TypeError. */
function timedOut(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = error; e instanceof Error && !seen.has(e); e = (e as { cause?: unknown }).cause) {
    seen.add(e);
    if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  }
  return false;
}

/** A Store that lives in a daemon. Same surface as Store; every call is a request. */
export class RemoteStore {
  constructor(public base: string, public agent = "agent", public timeoutMs = DAEMON_TIMEOUT) {}
  get dir() { return this.base; }
  /** Every request to the daemon goes through here, so every one of them has a deadline. */
  private async ask(path: string, init?: RequestInit): Promise<Response> {
    try { return await fetch(this.base + path, { ...init, signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch (error) { throw timedOut(error) ? new Error(daemonTimeout(this.timeoutMs)) : error; }
  }
  private async j<T>(p: string, init?: RequestInit): Promise<T> {
    const r = await this.ask(p, init);
    if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
    try { return await r.json() as T; }
    catch (error) { throw timedOut(error) ? new Error(daemonTimeout(this.timeoutMs)) : error; }
  }
  list(): Promise<string[]> { return this.j("/list"); }
  async has(board: string): Promise<boolean> { return (await this.list()).includes(board); }
  entries(board: string): Promise<Entry[]> { return this.j(`/entries?board=${encodeURIComponent(board)}`); }
  board(board: string): Promise<Board> { return this.j(`/board.json?board=${encodeURIComponent(board)}`); }
  proposals(board: string): Promise<Entry[]> { return this.j(`/proposals?board=${encodeURIComponent(board)}`); }
  async append(board: string, ops: Op[], by = this.agent, propose = false, preconditions?: ProposalBasis[]): Promise<Board> {
    const r = await this.ask(`/op?board=${encodeURIComponent(board)}&by=${encodeURIComponent(by)}${propose ? "&propose=1" : ""}`, { method: "POST", body: JSON.stringify(preconditions === undefined ? ops : { ops, preconditions }) });
    if (!r.ok) throw new Error(`append: ${r.status} ${await r.text()}`);
    return this.board(board);
  }
  async branch(base: string, name: string, title: string, baselineName?: string, capturedBy = this.agent): Promise<Board> { return this.j("/branch", { method: "POST", body: JSON.stringify({ base, name, title, baselineName, capturedBy }) }); }
  baseline(board: string): Promise<Board | null> { return this.j(`/baseline?board=${encodeURIComponent(board)}`); }
  async undo(board: string, by = "human"): Promise<Entry | null> { return (await this.j<{ undone: Entry | null }>(`/undo?board=${encodeURIComponent(board)}&by=${encodeURIComponent(by)}`, { method: "POST" })).undone; }
  watch(_cb: () => void) { return () => {}; }
  async hello(id: string, name: string, board?: string, sampling?: boolean) { await this.ask("/hello", { method: "POST", body: JSON.stringify({ id, name, board, sampling }) }).catch(() => {}); }
  async bye(id: string) { await this.ask("/bye", { method: "POST", body: JSON.stringify({ id }) }).catch(() => {}); }
}
