import { z } from 'zod';
import type { Board, Comment } from './model.js';
import type { Op } from './ops.js';
import { isHumanEvidenceActor } from './evidence-lifecycle.js';

const schema = z.object({
  version: z.literal(1),
  scope: z.string().min(1).max(200),
  intention: z.string().trim().max(2000),
}).strict();
export type DesignConversation = z.infer<typeof schema>;

/** Working intention is conversation context, not accepted workflow or implementation state. */
export function validateDesignConversationOperation(board: Board, op: Op, actor: string, propose = false): void {
  if (op.t === 'revert' && op.entity === 'comment') {
    const current = board.comments.find(comment => comment.id === op.id);
    const restored = op.prior && typeof op.prior === 'object' ? op.prior as Partial<Comment> : undefined;
    if (!current?.designConversation && !restored?.designConversation) return;
    if (!isHumanEvidenceActor(actor) && !propose) throw new Error('Working intention changes require human review. Propose the change instead.');
    if (op.prior === null) return;
    if (!restored || restored.id !== op.id || typeof restored.about !== 'string' || !restored.designConversation) throw new Error('Conversation identity must match its scope.');
    const comment: Comment = { ...restored, id: op.id, about: restored.about, by: actor, text: '' };
    validateDesignConversationOperation(board, { t: 'comment', comment }, actor, propose);
    op.prior = comment;
    return;
  }
  if (op.t !== 'comment' && op.t !== 'removeComment') return;
  const id = op.t === 'comment' ? op.comment.id : op.id;
  const prior = board.comments.find(comment => comment.id === id);
  const record = op.t === 'comment' ? op.comment.designConversation : undefined;
  if (!record && !prior?.designConversation) return;
  if (!isHumanEvidenceActor(actor) && !propose) throw new Error('Working intention changes require human review. Propose the change instead.');
  if (op.t === 'removeComment') return;
  if (!record) throw new Error('A design conversation cannot be replaced by an ordinary comment.');
  const parsed = schema.parse(record);
  if (parsed.scope !== 'board' && !board.jobs.some(job => job.id === parsed.scope && !job.removed)) throw new Error('Conversation scope is not on this workflow.');
  if (op.comment.about !== parsed.scope || id !== `design-conversation:${parsed.scope}`) throw new Error('Conversation identity must match its scope.');
  if (op.comment.assessment || op.comment.walkthrough || op.comment.development) throw new Error('Conversation context must be separate from assessment and execution records.');
  if (prior && !prior.designConversation) throw new Error('Conversation identity is already used by another comment.');
  op.comment.designConversation = parsed;
  op.comment.by = actor;
  op.comment.text = parsed.intention ? `Working intention: ${parsed.intention}` : 'Working intention cleared.';
}

export function designConversationContext(board: Board, scope = 'board'): string {
  const records = board.comments.filter(comment => comment.designConversation && (comment.designConversation.scope === 'board' || comment.designConversation.scope === scope));
  return JSON.stringify(records.flatMap((comment: Comment) => {
    const parsed = schema.safeParse(comment.designConversation);
    return parsed.success && parsed.data.intention ? [{ scope: parsed.data.scope, intention: parsed.data.intention, recordedBy: comment.by }] : [];
  }));
}
