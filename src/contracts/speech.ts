import type { SynthesisFormat } from '../domain/voice';

export interface RecognitionCapability {
  available: boolean;
  // 'utterance' ends by itself after a pause; 'manual' records until finished or the time limit.
  mode: 'utterance' | 'manual';
  // Human-readable explanation when `available` is false.
  reason?: string;
  // Shown after a successful recognition, e.g. that the audio left the device.
  privacyNote?: string;
}

export interface RecognitionOptions {
  onPartial?: (text: string) => void;
  // The learner is done talking: stop listening and resolve with what was heard.
  finish?: AbortSignal;
  // Recording is over and the audio is being transcribed (online engines only).
  onTranscribing?: () => void;
}

export interface SpeechRecognitionGateway {
  capability(language: string): Promise<RecognitionCapability>;
  // Single-utterance recognition. Resolves with the final transcript, rejects with an
  // AbortError when `signal` fires, and with a readable Error on any other failure.
  recognize(language: string, signal: AbortSignal, options?: RecognitionOptions): Promise<string>;
}

export interface SpeechSynthesisGateway {
  hasEnglishVoice(): Promise<boolean>;
  speak(text: string, rate: number): Promise<void>;
  stop(): Promise<void>;
}

// Resolved at call time from settings and secure storage; never persisted in this form.
export interface OnlineAudioConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface OnlineSynthesisConfig extends OnlineAudioConfig {
  voice: string;
  format: SynthesisFormat;
}
