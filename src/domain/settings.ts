export interface ModelSettings {
  baseUrl: string;
  model: string;
  speechRate: number;
  credentialRef: string | null;
}

export const defaultSettings: ModelSettings = {
  baseUrl: '',
  model: '',
  speechRate: 0.85,
  credentialRef: null,
};

export function validateSettings(input: ModelSettings): ModelSettings {
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw new Error('请输入完整的 HTTPS 服务地址，例如 https://example.com/v1');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址须使用 HTTPS，且不能包含账号、查询参数或片段。');
  }
  const model = input.model.trim();
  if (!model) throw new Error('请输入模型名称。');
  if (!Number.isFinite(input.speechRate) || input.speechRate < 0.5 || input.speechRate > 1.5) {
    throw new Error('语速须在 0.5 到 1.5 之间。');
  }
  return { ...input, baseUrl: url.toString().replace(/\/+$/, ''), model };
}
