import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext, ConversationService } from '../src/application/conversation-service';
import { notConfiguredMessage } from '../src/application/model-access';
import type { ModelGateway } from '../src/contracts/model';
import type { ConversationMessage } from '../src/domain/conversation';
import { defaultSettings } from '../src/domain/settings';
import { SqliteConversationRepository } from '../src/infrastructure/database/conversation-repository';
import { coachPrompt } from '../src/prompts/coach';
import { access, freshDatabase, plain, sequentialIds, type TestDatabase } from './helpers';

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

async function fixture(options: { unconfigured?: boolean; deltas?: string[]; failWith?: unknown; hang?: boolean; weak?: boolean } = {}) {
  const db = await freshDatabase();
  let requests = 0;
  let contexts: string[][] = [];
  const gateway: ModelGateway = {
    async *streamReply(messages, signal) {
      requests += 1;
      contexts.push(messages.map((m) => `${m.role}:${m.content}`));
      if (options.failWith) throw options.failWith;
      for (const delta of options.deltas ?? ['Hi', ' there']) {
        if (signal.aborted) throw abortError();
        yield delta;
      }
      if (options.hang) {
        // Like a real reader: rejects when the signal fires, whether it already fired or fires later.
        await new Promise<void>((_, reject) => {
          const fail = () => reject(abortError());
          if (signal.aborted) fail(); else signal.addEventListener('abort', fail);
        });
      }
    },
    async complete() { return ''; },
  };
  const afterReply: string[] = [];
  const service = new ConversationService({
    profileId: 'p1',
    repository: new SqliteConversationRepository(db),
    access: access(gateway, options.unconfigured ? defaultSettings : undefined),
    createId: sequentialIds(),
    knowledge: options.weak ? { async weakPoints() {
      return { grammar: [{ id: 'g1', name: 'tense', count: 2 }], words: [{ id: 'w1', lemma: 'exhausted', level: 1 }] };
    } } : undefined,
    afterReply: async (id) => { afterReply.push(id); },
  });
  const rows = () => plain(db.sqlite.prepare('SELECT role, content, status FROM messages ORDER BY rowid').all() as Pick<ConversationMessage, 'role' | 'content' | 'status'>[]);
  return { service, db, rows, requests: () => requests, contexts: () => contexts, afterReply, gateway };
}

test('a turn persists the user message before the reply and completes it after streaming', async () => {
  const f = await fixture();
  const updates: string[] = [];
  const result = await f.service.send('  Hello coach ', new AbortController().signal, (messages) => {
    updates.push(messages.map((m) => `${m.role}:${m.status}:${m.content}`).join('|'));
  });
  assert.deepEqual(f.rows(), [
    { role: 'user', content: 'Hello coach', status: 'complete' },
    { role: 'assistant', content: 'Hi there', status: 'complete' },
  ]);
  assert.equal(updates[0], 'user:complete:Hello coach|assistant:pending:');
  assert.equal(updates.at(-1), 'user:complete:Hello coach|assistant:complete:Hi there');
  assert.equal(result.length, 2);
  assert.equal(f.db.sqlite.prepare('SELECT title FROM sessions').get()?.title, 'Hello coach');
  assert.equal(f.requests(), 1);
  assert.deepEqual(f.afterReply, ['id-2']);
});

test('later turns reuse the session and the model context carries the history', async () => {
  const f = await fixture();
  await f.service.send('One', new AbortController().signal, () => {});
  const second = await f.service.send('Two', new AbortController().signal, () => {});
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n, 1);
  assert.equal(second.length, 4);
  const context = buildContext(second.slice(0, 3));
  assert.equal(context[0]?.role, 'system');
  assert.equal(context[0]?.content, coachPrompt.text);
  assert.deepEqual(context.slice(1).map((m) => `${m.role}:${m.content}`), ['user:One', 'assistant:Hi there', 'user:Two']);
});

test('recorded weak points reach the system prompt', async () => {
  const f = await fixture({ weak: true });
  await f.service.send('Hello', new AbortController().signal, () => {});
  const system = f.contexts()[0]?.[0] ?? '';
  // Grammar points reach the English prompt by their English name, not the Chinese UI label.
  assert.match(system, /weak points: verb tense\./);
  assert.doesNotMatch(system, /时态/);
  assert.match(system, /still learning: exhausted/);
  assert.equal(buildContext([])[0]?.content, coachPrompt.text, 'no profile lines without weak points');
});

test('aborting keeps the partial reply and marks it interrupted without throwing', async () => {
  const f = await fixture({ hang: true });
  const controller = new AbortController();
  const result = await f.service.send('Hello', controller.signal, (messages) => { if (messages[1]?.content === 'Hi there') controller.abort(); });
  assert.deepEqual(f.rows()[1], { role: 'assistant', content: 'Hi there', status: 'interrupted' });
  assert.equal(result[1]?.status, 'interrupted');
  assert.deepEqual(f.afterReply, [], 'interrupted turns are not extracted');
});

test('gateway failures mark the reply failed, keep the user message and rethrow a readable error', async () => {
  const f = await fixture({ failWith: new Error('boom') });
  await assert.rejects(f.service.send('Hello', new AbortController().signal, () => {}), /发送失败/);
  assert.deepEqual(f.rows(), [
    { role: 'user', content: 'Hello', status: 'complete' },
    { role: 'assistant', content: '', status: 'failed' },
  ]);
});

test('missing configuration or empty input rejects before anything is written', async () => {
  const unconfigured = await fixture({ unconfigured: true });
  await assert.rejects(unconfigured.service.send('Hello', new AbortController().signal, () => {}), new RegExp(notConfiguredMessage));
  assert.equal(unconfigured.rows().length, 0);
  assert.equal(unconfigured.requests(), 0);
  const f = await fixture();
  await assert.rejects(f.service.send('   ', new AbortController().signal, () => {}), /请输入/);
  assert.equal(f.rows().length, 0);
});

test('restore returns the latest session and turns orphaned pending replies into interrupted ones', async () => {
  const f = await fixture();
  await f.service.send('Hello', new AbortController().signal, () => {});
  // Simulate a process killed mid-stream: the reply row never left 'pending'.
  f.db.sqlite.prepare("UPDATE messages SET status = 'pending' WHERE role = 'assistant'").run();
  const fresh = (profileId: string, db: TestDatabase) => new ConversationService({
    profileId, repository: new SqliteConversationRepository(db), access: access(f.gateway), createId: () => 'new',
  });
  const restored = await fresh('p1', f.db).restore();
  assert.deepEqual(restored.map((m) => `${m.role}:${m.status}`), ['user:complete', 'assistant:interrupted']);
  assert.equal(f.rows()[1]?.status, 'interrupted');
  assert.deepEqual(await fresh('nobody', f.db).restore(), []);
});
