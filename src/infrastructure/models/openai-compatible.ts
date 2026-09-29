import { ModelRequestError, type GatewayConfig, type ModelGateway, type ModelMessage } from '../../contracts/model';
import { SseParser } from './sse';

// Structural subset of WinterCG fetch so the gateway can be exercised without a native runtime.
export interface StreamingResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: {
  method: string; headers: Record<string, string>; body: string; signal: AbortSignal;
}) => Promise<StreamingResponse>;

interface Completion {
  choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[];
  error?: { message?: unknown } | string;
}

function contentOf(payload: Completion): string {
  const choice = payload.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content;
  return typeof content === 'string' ? content : '';
}

function errorOf(payload: Completion): string | undefined {
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  return undefined;
}

function parseJson(text: string): Completion {
  try {
    return JSON.parse(text) as Completion;
  } catch {
    throw new ModelRequestError('模型返回了无法解析的内容。', 'protocol');
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createOpenAiCompatibleGateway(config: GatewayConfig, fetchImpl: FetchLike): ModelGateway {
  async function request(messages: ModelMessage[], stream: boolean, signal: AbortSignal): Promise<StreamingResponse> {
    let response: StreamingResponse;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model, messages, stream,
          ...(config.temperature === null ? {} : { temperature: config.temperature }),
        }),
        signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ModelRequestError('无法连接到模型服务，请检查网络和服务地址。', 'network');
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      if (response.status === 401 || response.status === 403) {
        throw new ModelRequestError('API Key 无效或没有访问该模型的权限。', 'auth', response.status);
      }
      throw new ModelRequestError(
        `模型服务返回错误（HTTP ${response.status}）${detail ? `：${detail}` : '。'}`, 'http', response.status,
      );
    }
    return response;
  }

  function contentOrThrow(payload: Completion): string {
    const failure = errorOf(payload);
    if (failure) throw new ModelRequestError(`模型服务返回错误：${failure}`, 'http');
    return contentOf(payload);
  }

  return {
    async *streamReply(messages, signal) {
      const response = await request(messages, true, signal);

      // Some proxies ignore `stream` and answer with a single JSON document.
      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        const content = contentOrThrow(parseJson(await response.text()));
        if (content) yield content;
        return;
      }

      if (!response.body) throw new ModelRequestError('模型服务没有返回内容。', 'protocol');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          const events = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
          for (const data of events) {
            if (data.trim() === '[DONE]') return;
            const content = contentOrThrow(parseJson(data));
            if (content) yield content;
          }
          if (done) return;
        }
      } finally {
        reader.cancel().catch(() => undefined);
      }
    },

    // Structured tasks also stream: some proxies answer non-streaming requests an
    // order of magnitude slower, and accumulating deltas costs nothing.
    async complete(messages, signal) {
      let content = '';
      for await (const delta of this.streamReply(messages, signal)) content += delta;
      return content;
    },
  };
}
