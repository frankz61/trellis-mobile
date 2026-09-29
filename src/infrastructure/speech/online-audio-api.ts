import { ModelRequestError } from '../../contracts/model';
import type { OnlineAudioConfig, OnlineSynthesisConfig } from '../../contracts/speech';
import { maxAudioUploadBytes } from '../../domain/voice';

// Structural subset of WinterCG fetch so the requests can be exercised without a native runtime.
export interface AudioResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type AudioFetch = (url: string, init: {
  method: 'POST'; headers: Record<string, string>; body: FormData | string; signal: AbortSignal;
}) => Promise<AudioResponse>;

type Service = '语音识别' | '朗读';

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorOf(text: string): string | undefined {
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown } | string };
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  } catch { /* not JSON */ }
  return undefined;
}

async function post(fetchImpl: AudioFetch, service: Service, url: string, apiKey: string, body: FormData | string,
  signal: AbortSignal, headers: Record<string, string> = {}): Promise<AudioResponse> {
  let response: AudioResponse;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${apiKey}` }, body, signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    // The transport's own reason (timeout, TLS, DNS, reset) is what tells these failures apart.
    const reason = error instanceof Error && error.message ? `（${error.message.slice(0, 160)}）` : '';
    throw new ModelRequestError(`无法连接到${service}服务，请检查网络和服务地址。${reason}`, 'network');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new ModelRequestError(`API Key 无效或没有访问该${service}模型的权限。`, 'auth', response.status);
    }
    const detail = (errorOf(text) ?? text).slice(0, 200);
    throw new ModelRequestError(`${service}服务返回错误（HTTP ${response.status}）${detail ? `：${detail}` : '。'}`, 'http', response.status);
  }
  return response;
}

// OpenAI-compatible `POST {baseUrl}/audio/transcriptions` (multipart). `audio` is a Blob; on the
// device that is an expo-file-system File, which carries the recording's name and extension.
export function createTranscriber(config: OnlineAudioConfig, fetchImpl: AudioFetch) {
  return {
    // `language` is a BCP 47 tag such as en-US; the API takes the ISO 639-1 part.
    async transcribe(audio: Blob & { name?: string }, language: string, signal: AbortSignal): Promise<string> {
      if (audio.size > maxAudioUploadBytes) throw new Error('录音超过 10 MB，请说短一些再试。');
      const form = new FormData();
      form.append('model', config.model);
      form.append('language', language.split('-')[0]!.toLowerCase());
      form.append('response_format', 'json');
      form.append('file', audio, audio.name || 'speech.m4a');
      const response = await post(fetchImpl, '语音识别', `${config.baseUrl}/audio/transcriptions`, config.apiKey, form, signal,
        { Accept: 'application/json' });
      const text = await response.text();
      if (!(response.headers.get('content-type') ?? '').includes('json')) return text.trim();
      let payload: { text?: unknown; error?: unknown };
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        throw new ModelRequestError('语音识别服务返回了无法解析的内容。', 'protocol');
      }
      const failure = errorOf(text);
      if (failure) throw new ModelRequestError(`语音识别服务返回错误：${failure}`, 'http');
      if (typeof payload.text !== 'string') throw new ModelRequestError('语音识别服务没有返回文字。', 'protocol');
      return payload.text.trim();
    },
  };
}

// OpenAI-compatible `POST {baseUrl}/audio/speech`; resolves with the encoded audio bytes.
export function createSynthesizer(config: OnlineSynthesisConfig, fetchImpl: AudioFetch) {
  return {
    async synthesize(text: string, signal: AbortSignal): Promise<Uint8Array> {
      const response = await post(fetchImpl, '朗读', `${config.baseUrl}/audio/speech`, config.apiKey,
        JSON.stringify({ model: config.model, input: text, voice: config.voice, response_format: config.format }),
        signal, { 'Content-Type': 'application/json' });
      // Some proxies answer 200 with a JSON error instead of audio.
      if ((response.headers.get('content-type') ?? '').includes('json')) {
        const body = await response.text();
        throw new ModelRequestError(`朗读服务没有返回音频${errorOf(body) ? `：${errorOf(body)}` : '。'}`, 'protocol');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new ModelRequestError('朗读服务没有返回音频。', 'protocol');
      return bytes;
    },
  };
}
