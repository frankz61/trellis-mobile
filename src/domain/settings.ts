export interface ModelSettings {
  baseUrl: string;
  model: string;
  // null leaves sampling to the provider's default.
  temperature: number | null;
  credentialRef: string | null;
}

export const defaultSettings: ModelSettings = {
  baseUrl: '',
  model: '',
  temperature: null,
  credentialRef: null,
};

// HTTPS only, and no credentials or query in the URL: the key travels in a header, never in the address.
export function normalizeEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('请输入完整的 HTTPS 服务地址，例如 https://example.com/v1');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址须使用 HTTPS，且不能包含账号、查询参数或片段。');
  }
  return url.toString().replace(/\/+$/, '');
}

// A key may only be reused for an endpoint on the same host (scheme, host and port).
export function sameHost(a: string, b: string): boolean {
  try {
    return Boolean(a && b) && new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function validateSettings(input: ModelSettings): ModelSettings {
  const baseUrl = normalizeEndpoint(input.baseUrl);
  const model = input.model.trim();
  if (!model) throw new Error('请输入模型名称。');
  const { temperature } = input;
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    throw new Error('温度须在 0 到 2 之间，或留空使用服务默认值。');
  }
  return { ...input, baseUrl, model };
}
