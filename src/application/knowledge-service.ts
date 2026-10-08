import { ModelRequestError } from '../contracts/model';
import { isAbortError, structuredCallTimeoutMs, withTimeout } from './abort';
import { parseExtraction } from '../domain/knowledge';
import { parseModelJson } from '../domain/model-json';
import { extractionPrompt } from '../prompts/knowledge';
import type { ConversationRepository, KnowledgeRepository, PersistedTask, TaskRepository, WeakPoints } from '../repositories/contracts';
import type { ModelAccess } from './model-access';

export interface KnowledgeDependencies {
  profileId: string;
  tasks: TaskRepository;
  knowledge: KnowledgeRepository;
  conversation: Pick<ConversationRepository, 'message' | 'replyBefore' | 'replyAfter'>;
  access: ModelAccess;
  createId: () => string;
  now?: () => string;
}

export interface ExtractionOutcome {
  messageId: string;
  words: number;
  mistakes: number;
}

export const maxTaskAttempts = 3;
const backoffBaseMs = 30_000;

export class KnowledgeService {
  constructor(private readonly deps: KnowledgeDependencies) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  // One extraction per user message; re-enqueueing after a retry is harmless.
  async enqueueExtraction(userMessageId: string): Promise<void> {
    await this.deps.tasks.enqueue({
      id: this.deps.createId(), kind: 'extract', dedupeKey: `extract:${userMessageId}`, payload: JSON.stringify({ messageId: userMessageId }),
    }, this.now());
  }

  // Startup recovery: tasks left 'running' by a killed process are queued again.
  recover(): Promise<number> {
    return this.deps.tasks.recoverRunning(this.now());
  }

  pendingCount(): Promise<number> {
    return this.deps.tasks.pendingCount();
  }

  weakPoints(): Promise<WeakPoints> {
    return this.deps.knowledge.weakPoints(this.deps.profileId);
  }

  // Drains the queue one task at a time. Model failures back off and give up after
  // maxTaskAttempts; results are reported per task so the UI can stay honest.
  async runPending(signal: AbortSignal, onOutcome?: (outcome: ExtractionOutcome) => void): Promise<{ succeeded: number; failed: number }> {
    const result = { succeeded: 0, failed: 0 };
    for (;;) {
      if (signal.aborted) return result;
      const task = await this.deps.tasks.claimNext(this.now());
      if (!task) return result;
      try {
        const outcome = await this.execute(task, withTimeout(signal, structuredCallTimeoutMs));
        await this.deps.tasks.finish(task.id, 'succeeded', task.attempts + 1, null, this.now());
        result.succeeded += 1;
        if (outcome) onOutcome?.(outcome);
      } catch (error) {
        // A user abort re-queues the task untouched; a timeout counts as a failed attempt.
        const cancelled = isAbortError(error) && signal.aborted;
        const attempts = task.attempts + (cancelled ? 0 : 1);
        const exhausted = attempts >= maxTaskAttempts;
        const nextRunAt = cancelled ? null : new Date(Date.parse(this.now()) + backoffBaseMs * 2 ** (attempts - 1)).toISOString();
        await this.deps.tasks.finish(task.id, exhausted ? 'failed' : 'pending', attempts, exhausted ? null : nextRunAt, this.now());
        if (cancelled) return result;
        result.failed += 1;
        if (error instanceof ModelRequestError && error.kind === 'auth') return result;
      }
    }
  }

  private async execute(task: PersistedTask, signal: AbortSignal): Promise<ExtractionOutcome | null> {
    if (task.kind !== 'extract') throw new Error(`未知任务类型：${task.kind}`);
    const { messageId } = JSON.parse(task.payload) as { messageId: string };
    const message = await this.deps.conversation.message(messageId);
    // A deleted message leaves nothing to extract; the task is simply done.
    if (!message || !message.content.trim()) return null;
    // The coach's question disambiguates short answers ("Yes, twice."); the coach's answer holds the
    // word the learner asked for ("How do you say ...?"). Only that word may be taken from it.
    const [before, after] = await Promise.all([
      this.deps.conversation.replyBefore(messageId), this.deps.conversation.replyAfter(messageId),
    ]);
    const gateway = await this.deps.access.gateway();
    const prompt = extractionPrompt.build({ message: message.content, previousReply: before?.content, answer: after?.content });
    const raw = await gateway.complete([{ role: 'user', content: prompt }], signal);
    const extraction = parseExtraction(parseModelJson(raw));
    if (!extraction) throw new ModelRequestError('抽取结果不是有效的 JSON。', 'protocol');
    const counts = await this.deps.knowledge.applyExtraction(this.deps.profileId, messageId, extraction, this.now());
    return { messageId, ...counts };
  }
}
