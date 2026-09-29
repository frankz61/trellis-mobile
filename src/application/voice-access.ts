import type {
  OnlineAudioConfig, OnlineSynthesisConfig, SpeechRecognitionGateway, SpeechSynthesisGateway,
} from '../contracts/speech';
import { sameHost } from '../domain/settings';
import type { RecognitionSettings, SynthesisSettings, VoiceSettings } from '../domain/voice';
import type { CredentialStore, SettingsRepository, VoiceSettingsRepository } from '../repositories/contracts';

// Where an online speech service gets its key from: its own entry, or the AI model's key when both
// endpoints are on the same host. A key is never sent to a host the learner did not enter it for.
export type KeySource = 'own' | 'shared' | 'missing';

export const recognitionNotConfigured = '在线语音识别还没配置完整，请在“我的”页面填写服务地址、模型和 API Key。';
export const synthesisNotConfigured = '在线朗读还没配置完整，请在“我的”页面填写服务地址、模型、声音和 API Key。';

type Resolved<T> = { engine: 'system' } | { engine: 'online'; config: T } | { engine: 'online'; config: null };

export class VoiceAccess {
  constructor(
    private readonly voice: VoiceSettingsRepository,
    private readonly model: SettingsRepository,
    private readonly credentials: CredentialStore,
  ) {}

  load(): Promise<VoiceSettings> {
    return this.voice.load();
  }

  async key(section: RecognitionSettings | SynthesisSettings): Promise<{ source: KeySource; apiKey: string | null }> {
    const own = section.credentialRef ? await this.credentials.get(section.credentialRef) : null;
    if (own) return { source: 'own', apiKey: own };
    const model = await this.model.load();
    const shared = model.credentialRef && sameHost(model.baseUrl, section.baseUrl)
      ? await this.credentials.get(model.credentialRef)
      : null;
    return shared ? { source: 'shared', apiKey: shared } : { source: 'missing', apiKey: null };
  }

  async recognition(): Promise<Resolved<OnlineAudioConfig>> {
    const { recognition: r } = await this.voice.load();
    if (r.engine === 'system') return { engine: 'system' };
    const { apiKey } = await this.key(r);
    return { engine: 'online', config: apiKey && r.baseUrl && r.model ? { baseUrl: r.baseUrl, model: r.model, apiKey } : null };
  }

  async synthesis(): Promise<Resolved<OnlineSynthesisConfig>> {
    const { synthesis: s } = await this.voice.load();
    if (s.engine === 'system') return { engine: 'system' };
    const { apiKey } = await this.key(s);
    return {
      engine: 'online',
      config: apiKey && s.baseUrl && s.model && s.voice
        ? { baseUrl: s.baseUrl, model: s.model, voice: s.voice, format: s.format, apiKey }
        : null,
    };
  }
}

export interface VoiceEngines {
  system: { recognition: SpeechRecognitionGateway; speech: SpeechSynthesisGateway };
  onlineRecognition(config: OnlineAudioConfig): SpeechRecognitionGateway;
  onlineSpeech(config: OnlineSynthesisConfig): SpeechSynthesisGateway;
}

// The screens keep one recognition and one speech gateway; which engine serves a call is decided
// from the saved settings at that moment, so switching engines applies without a restart.
export function createVoiceRouter(access: VoiceAccess, engines: VoiceEngines): {
  recognition: SpeechRecognitionGateway;
  speech: SpeechSynthesisGateway;
} {
  async function recognizer(): Promise<SpeechRecognitionGateway | string> {
    const resolved = await access.recognition();
    if (resolved.engine === 'system') return engines.system.recognition;
    return resolved.config ? engines.onlineRecognition(resolved.config) : recognitionNotConfigured;
  }

  async function speaker(): Promise<SpeechSynthesisGateway | string> {
    const resolved = await access.synthesis();
    if (resolved.engine === 'system') return engines.system.speech;
    return resolved.config ? engines.onlineSpeech(resolved.config) : synthesisNotConfigured;
  }

  let speaking: SpeechSynthesisGateway | null = null;

  const speech: SpeechSynthesisGateway = {
    async hasEnglishVoice() {
      const gateway = await speaker();
      return typeof gateway === 'string' ? false : gateway.hasEnglishVoice();
    },
    async speak(text, rate) {
      await speech.stop();
      const gateway = await speaker();
      if (typeof gateway === 'string') throw new Error(gateway);
      speaking = gateway;
      try {
        await gateway.speak(text, rate);
      } finally {
        if (speaking === gateway) speaking = null;
      }
    },
    async stop() {
      const current = speaking;
      speaking = null;
      // The system engine is always stopped too: it may still be talking from before an engine switch.
      await Promise.all([engines.system.speech.stop(), current && current !== engines.system.speech ? current.stop() : undefined]);
    },
  };

  const recognition: SpeechRecognitionGateway = {
    async capability(language) {
      const gateway = await recognizer();
      if (typeof gateway === 'string') return { available: false, mode: 'manual', reason: gateway };
      return gateway.capability(language);
    },
    async recognize(language, signal, options) {
      const gateway = await recognizer();
      if (typeof gateway === 'string') throw new Error(gateway);
      return gateway.recognize(language, signal, options);
    },
  };

  return { recognition, speech };
}
