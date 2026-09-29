import type { Turn } from "./interviewer.js";

export interface InterviewCheckpoint { state: "collect" | "build"; reason: string }
export const CHECKPOINT_CRAFT = `GRAPH UPDATE RHYTHM: Stream the conversational reply, not individual graph operations. Return a checkpoint field in every response: {"state":"collect|build","reason":string}. Choose collect while clarifying incomplete or exploratory information; return no cards and keep the current design stable. The full transcript remains available for the next turn. Choose build when enough evidence supports a coherent first outline, a meaningful section revision, or an explicit local edit. Do not wait for a fixed number of answers, a complete interview, or a fixed node count. Build an early useful outline. At build, reconcile relevant earlier answers with the current board and accepted/dismissed suggestions, and emit the whole coherent set of changes together. An explicit rename or other unambiguous local instruction can build immediately; hypothetical questions are not instructions. If the person asks to show what you have, build the evidence-supported outline now, leaving unsupported parts explicitly unknown. A build may contain review-required proposals; it never grants permission to confirm assumptions, change confirmed work, or silently broaden the selected edit scope. Keep reason to one plain sentence explaining what is ready or what remains unclear.`;

/** Legacy providers retain their prior behavior; an explicit collect response cannot write. */
export function checkpointTurn(raw: unknown, turn: Turn): Turn {
  const checkpoint = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const state = checkpoint.state === "collect" || checkpoint.state === "build" ? checkpoint.state : turn.cards.length ? "build" : "collect";
  const reason = typeof checkpoint.reason === "string" && checkpoint.reason.trim() ? checkpoint.reason.trim().slice(0, 300) : state === "collect" ? "Gathering context for the next coherent update." : "A coherent set of changes is ready.";
  return { ...turn, checkpoint: { state, reason }, cards: state === "collect" ? [] : turn.cards };
}
