import { normalizeEndpoint } from './settings';

// 'system' uses the device's recognizer / TTS engine; 'online' calls an OpenAI-compatible audio API.
export type VoiceEngine = 'system' | 'online';

export const synthesisFormats = ['mp3', 'aac', 'opus', 'wav', 'flac'] as const;
export type SynthesisFormat = (typeof synthesisFormats)[number];

export interface RecognitionSettings {
  engine: VoiceEngine;
  baseUrl: string;
  model: string;
  // null means "use the AI model's key", which is only allowed on the same host.
  credentialRef: string | null;
}

export interface SynthesisSettings {
  engine: VoiceEngine;
  baseUrl: string;
  model: string;
  voice: string;
  format: SynthesisFormat;
  speechRate: number;
  credentialRef: string | null;
}

export interface VoiceSettings {
  recognition: RecognitionSettings;
  synthesis: SynthesisSettings;
}

export const defaultVoiceSettings: VoiceSettings = {
  recognition: { engine: 'system', baseUrl: '', model: '', credentialRef: null },
  synthesis: { engine: 'system', baseUrl: '', model: '', voice: '', format: 'mp3', speechRate: 0.85, credentialRef: null },
};

// One recorded utterance: long enough to think aloud, short enough to stay far below upload limits.
export const maxRecordingSeconds = 60;
export const maxAudioUploadBytes = 10 * 1024 * 1024;
// Per request to the speech endpoint; longer replies are split and played in sequence.
export const maxSynthesisChars = 2000;

// Blank online fields are allowed while the system engine is selected, so a half-filled
// configuration can be saved and finished later; switching to 'online' requires all of them.
function endpoint(raw: string, required: boolean): string {
  if (!raw.trim()) {
    if (required) throw new Error('请填写服务地址。');
    return '';
  }
  return normalizeEndpoint(raw);
}

function field(raw: string, required: boolean, message: string): string {
  const value = raw.trim();
  if (required && !value) throw new Error(message);
  return value;
}

export function validateRecognition(input: RecognitionSettings): RecognitionSettings {
  const online = input.engine === 'online';
  return {
    ...input,
    baseUrl: endpoint(input.baseUrl, online),
    model: field(input.model, online, '请填写语音识别模型名称。'),
  };
}

export function validateSynthesis(input: SynthesisSettings): SynthesisSettings {
  const online = input.engine === 'online';
  if (!synthesisFormats.includes(input.format)) throw new Error('不支持的音频格式。');
  if (!Number.isFinite(input.speechRate) || input.speechRate < 0.5 || input.speechRate > 1.5) {
    throw new Error('语速须在 0.5 到 1.5 之间。');
  }
  return {
    ...input,
    baseUrl: endpoint(input.baseUrl, online),
    model: field(input.model, online, '请填写朗读模型名称。'),
    voice: field(input.voice, online, '请填写声音名称。'),
  };
}

// Splits at sentence ends, then at spaces, so each request stays within the endpoint's input limit
// without cutting words; a single unbroken run longer than the limit is cut hard.
export function splitForSpeech(text: string, limit = maxSynthesisChars): string[] {
  const sentences = text.trim().match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/g) ?? [];
  const chunks: string[] = [];
  let current = '';
  const push = (piece: string) => {
    if (current && (current + piece).length > limit) { chunks.push(current.trim()); current = ''; }
    current += piece;
  };
  for (const sentence of sentences) {
    if (sentence.length <= limit) { push(sentence); continue; }
    for (const word of sentence.split(/(?<=\s)/)) {
      for (let start = 0; start < word.length; start += limit) push(word.slice(start, start + limit));
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}
