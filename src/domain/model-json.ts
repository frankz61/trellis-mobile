// Models are asked for strict JSON but often wrap it in prose or ``` fences.
// Returns the parsed object or null; callers validate the shape themselves.
export function parseModelJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
