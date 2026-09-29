import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelRequestError } from '../src/contracts/model';
import { createOpenAiCompatibleGateway, type FetchLike, type StreamingResponse } from '../src/infrastructure/models/openai-compatible';
import { SseParser } from '../src/infrastructure/models/sse';

test('sse parser survives events and multi-byte characters split across chunks', () => {
  const parser = new SseParser();
  const encoded = new TextEncoder().encode('data: {"a":"你好"}\r\n\r\ndata: 1\ndata: 2\n\n: comment\n\ndata: [DONE]');
  const decoder = new TextDecoder();
  const events: string[] = [];
  // Feed one byte at a time to cut through every event boundary and every UTF-8 sequence.
  for (const byte of encoded) events.push(...parser.push(decoder.decode(new Uint8Array([byte]), { stream: true })));
  events.push(...parser.flush());
  assert.deepEqual(events, ['{"a":"你好"}', '1\n2', '[DONE]']);
});

function response(body: string | Uint8Array[], init: Partial<StreamingResponse> = {}): StreamingResponse {
  const chunks = typeof body === 'string' ? [new TextEncoder().encode(body)] : body;
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next); else controller.close();
      },
    }),
    text: async () => (typeof body === 'string' ? body : ''),
    ...init,
  };
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

const config = { baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'k' };

test('streams deltas from chat completions and stops at [DONE]', async () => {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response([
      new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"Hel'),
      new TextEncoder().encode('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n'),
    ]);
  };
  const gateway = createOpenAiCompatibleGateway(config, fetchImpl);
  const deltas = await collect(gateway.streamReply([{ role: 'user', content: 'hi' }], new AbortController().signal));
  assert.deepEqual(deltas, ['Hello', ' there']);
  assert.equal(calls[0]?.url, 'https://example.com/v1/chat/completions');
  assert.equal(calls[0]?.init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0]!.init.body), { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true });
});

test('classifies auth, http and protocol failures', async () => {
  const unauthorized = createOpenAiCompatibleGateway(config, async () => response('nope', { ok: false, status: 401 }));
  await assert.rejects(collect(unauthorized.streamReply([], new AbortController().signal)),
    (error: unknown) => error instanceof ModelRequestError && error.kind === 'auth' && error.status === 401);

  const serverError = createOpenAiCompatibleGateway(config, async () => response('busy', { ok: false, status: 503 }));
  await assert.rejects(collect(serverError.streamReply([], new AbortController().signal)),
    (error: unknown) => error instanceof ModelRequestError && error.kind === 'http' && /503/.test(error.message) && /busy/.test(error.message));

  const garbage = createOpenAiCompatibleGateway(config, async () => response('data: {not json\n\n'));
  await assert.rejects(collect(garbage.streamReply([], new AbortController().signal)),
    (error: unknown) => error instanceof ModelRequestError && error.kind === 'protocol');

  const offline = createOpenAiCompatibleGateway(config, async () => { throw new TypeError('Network request failed'); });
  await assert.rejects(collect(offline.streamReply([], new AbortController().signal)),
    (error: unknown) => error instanceof ModelRequestError && error.kind === 'network');
});

test('accepts a non-streaming JSON answer and surfaces embedded errors', async () => {
  const json = (payload: unknown) => response(JSON.stringify(payload), {
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  });
  const plain = createOpenAiCompatibleGateway(config, async () => json({ choices: [{ message: { content: 'Full answer' } }] }));
  assert.deepEqual(await collect(plain.streamReply([], new AbortController().signal)), ['Full answer']);

  const failing = createOpenAiCompatibleGateway(config, async () => json({ error: { message: 'model not found' } }));
  await assert.rejects(collect(failing.streamReply([], new AbortController().signal)), /model not found/);
});

test('abort errors propagate unchanged so callers can mark the reply as interrupted', async () => {
  const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  const gateway = createOpenAiCompatibleGateway(config, async () => { throw abort; });
  await assert.rejects(collect(gateway.streamReply([], new AbortController().signal)), (error: unknown) => error === abort);
});
