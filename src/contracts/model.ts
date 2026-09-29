export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ModelErrorKind = 'network' | 'auth' | 'http' | 'protocol';

export class ModelRequestError extends Error {
  constructor(message: string, readonly kind: ModelErrorKind, readonly status?: number) {
    super(message);
    this.name = 'ModelRequestError';
  }
}

export interface GatewayConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ModelGateway {
  // Yields text deltas. Rejects with an AbortError when the signal fires.
  streamReply(messages: ModelMessage[], signal: AbortSignal): AsyncIterable<string>;
  // Whole answer for structured tasks. Callers must validate the JSON they get back.
  complete(messages: ModelMessage[], signal: AbortSignal): Promise<string>;
}
