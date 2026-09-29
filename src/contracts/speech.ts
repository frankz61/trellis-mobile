export interface RecognitionCapability {
  available: boolean;
  onDevice: boolean;
  // Human-readable explanation when `available` is false.
  reason?: string;
}

export interface SpeechRecognitionGateway {
  capability(language: string): Promise<RecognitionCapability>;
  // Single-utterance recognition. Resolves with the final transcript, rejects with an
  // AbortError when the signal fires, and with a readable Error on any other failure.
  recognize(language: string, signal: AbortSignal, onPartial?: (text: string) => void): Promise<string>;
}

export interface SpeechSynthesisGateway {
  hasEnglishVoice(): Promise<boolean>;
  speak(text: string, rate: number): Promise<void>;
  stop(): Promise<void>;
}
