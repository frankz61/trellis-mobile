import { ModelRequestError, type ModelMessage } from '../contracts/model';
import { maxUserMessageLength, sessionTitle, type ConversationMessage, type MessageStatus } from '../domain/conversation';
import { grammarName } from '../domain/knowledge';
import { coachPrompt, type LearnerProfile } from '../prompts/coach';
import type { ConversationRepository, KnowledgeRepository } from '../repositories/contracts';
import type { ModelAccess } from './model-access';

export interface ConversationDependencies {
  profileId: string;
  repository: ConversationRepository;
  access: ModelAccess;
  createId: () => string;
  // Weak points feed the system prompt; omitted only in tests.
  knowledge?: Pick<KnowledgeRepository, 'weakPoints'>;
  // Called once a reply completes, e.g. to queue knowledge extraction for the turn.
  afterReply?: (userMessageId: string) => Promise<void>;
  now?: () => string;
}

// Recent turns sent to the model; the SQLite history itself is unbounded.
export const contextTurns = 20;
// How often a partial reply is written back while streaming.
const persistIntervalMs = 500;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function buildContext(history: ConversationMessage[], profile: LearnerProfile = { weakGrammar: [], weakWords: [] }): ModelMessage[] {
  const turns = history
    .filter((message) => message.content && message.status !== 'failed' && message.status !== 'pending')
    .slice(-contextTurns)
    .map((message): ModelMessage => ({ role: message.role, content: message.content }));
  return [{ role: 'system', content: coachPrompt.build(profile) }, ...turns];
}

export class ConversationService {
  private sessionId: string | null = null;

  constructor(private readonly deps: ConversationDependencies) {}

  async restore(): Promise<ConversationMessage[]> {
    const session = await this.deps.repository.latestSession(this.deps.profileId);
    this.sessionId = session?.id ?? null;
    if (!session) return [];
    await this.deps.repository.interruptPending(session.id);
    return this.deps.repository.messages(session.id);
  }

  private async learnerProfile(): Promise<LearnerProfile> {
    if (!this.deps.knowledge) return { weakGrammar: [], weakWords: [] };
    const weak = await this.deps.knowledge.weakPoints(this.deps.profileId);
    return { weakGrammar: weak.grammar.map((g) => grammarName(g.name)), weakWords: weak.words.map((w) => w.lemma) };
  }

  async send(
    input: string,
    signal: AbortSignal,
    onUpdate: (messages: ConversationMessage[]) => void,
  ): Promise<ConversationMessage[]> {
    const text = input.trim();
    if (!text) throw new Error('请输入想说的内容。');
    if (text.length > maxUserMessageLength) throw new Error(`单条消息请控制在 ${maxUserMessageLength} 字以内。`);
    const gateway = await this.deps.access.gateway();

    const now = this.deps.now ?? (() => new Date().toISOString());
    const { repository } = this.deps;
    let history: ConversationMessage[] = [];
    if (this.sessionId) {
      history = await repository.messages(this.sessionId);
    } else {
      const session = { id: this.deps.createId(), profileId: this.deps.profileId, title: sessionTitle(text), createdAt: now() };
      await repository.createSession(session);
      this.sessionId = session.id;
    }

    // Persist the turn before any network activity so a crash never loses the learner's input.
    const userMessage: ConversationMessage = {
      id: this.deps.createId(), sessionId: this.sessionId, role: 'user', content: text, status: 'complete', createdAt: now(),
    };
    await repository.appendMessage(userMessage);
    let reply: ConversationMessage = {
      id: this.deps.createId(), sessionId: this.sessionId, role: 'assistant', content: '', status: 'pending', createdAt: now(),
    };
    await repository.appendMessage(reply);
    const publish = () => { const messages = [...history, userMessage, reply]; onUpdate(messages); return messages; };
    publish();

    const finish = async (status: MessageStatus) => {
      reply = { ...reply, status };
      await repository.updateMessage(reply.id, reply.content, status);
      return publish();
    };

    const profile = await this.learnerProfile();
    let lastPersist = Date.now();
    try {
      for await (const delta of gateway.streamReply(buildContext([...history, userMessage], profile), signal)) {
        reply = { ...reply, content: reply.content + delta };
        publish();
        if (Date.now() - lastPersist >= persistIntervalMs) {
          await repository.updateMessage(reply.id, reply.content, 'pending');
          lastPersist = Date.now();
        }
      }
    } catch (error) {
      if (isAbort(error)) return finish('interrupted');
      await finish('failed');
      throw new Error(error instanceof ModelRequestError ? error.message : '发送失败，请稍后重试。');
    }
    if (!reply.content) {
      await finish('failed');
      throw new Error('模型没有返回内容，请重试。');
    }
    const messages = await finish('complete');
    await this.deps.afterReply?.(userMessage.id);
    return messages;
  }
}
