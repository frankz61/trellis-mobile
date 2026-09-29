import { sameHost } from '../domain/settings';
import {
  validateRecognition, validateSynthesis, type RecognitionSettings, type SynthesisSettings, type VoiceSettings,
} from '../domain/voice';
import type { CredentialStore, VoiceSettingsRepository } from '../repositories/contracts';
import { commitWithSecret } from './secrets';
import type { KeySource, VoiceAccess } from './voice-access';

type Section = 'recognition' | 'synthesis';

export interface VoiceSettingsView {
  settings: VoiceSettings;
  keys: Record<Section, KeySource>;
}

export class VoiceSettingsService {
  constructor(
    private readonly repository: VoiceSettingsRepository,
    private readonly access: VoiceAccess,
    private readonly credentials: CredentialStore,
    private readonly createId: () => string,
  ) {}

  async load(): Promise<VoiceSettingsView> {
    const settings = await this.repository.load();
    const [recognition, synthesis] = await Promise.all([
      this.access.key(settings.recognition), this.access.key(settings.synthesis),
    ]);
    return { settings, keys: { recognition: recognition.source, synthesis: synthesis.source } };
  }

  saveRecognition(input: RecognitionSettings, replacementKey: string): Promise<RecognitionSettings> {
    return this.save('recognition', validateRecognition(input), replacementKey);
  }

  saveSynthesis(input: SynthesisSettings, replacementKey: string): Promise<SynthesisSettings> {
    return this.save('synthesis', validateSynthesis(input), replacementKey);
  }

  // Removes the service's own key; it falls back to the model key when that is on the same host.
  async clearKey(section: Section): Promise<void> {
    const settings = await this.repository.load();
    const ref = settings[section].credentialRef;
    // If deletion fails, retain the reference so the user can retry.
    if (ref) await this.credentials.remove(ref);
    await this.repository.save({ ...settings, [section]: { ...settings[section], credentialRef: null } });
  }

  private async save<T extends RecognitionSettings | SynthesisSettings>(section: Section, validated: T, replacementKey: string): Promise<T> {
    const previous = await this.repository.load();
    const before = previous[section];
    const key = replacementKey.trim();
    if (key && !validated.baseUrl) throw new Error('请先填写服务地址，再保存它的 API Key。');

    // An own key belongs to the host it was entered for; moving to another host drops it.
    const ownStillValid = Boolean(before.credentialRef)
      && sameHost(before.baseUrl, validated.baseUrl)
      && Boolean(await this.credentials.get(before.credentialRef!));
    const keptRef = ownStillValid ? before.credentialRef : null;

    if (validated.engine === 'online' && !key && !keptRef) {
      const shared = await this.access.key({ ...validated, credentialRef: null });
      if (shared.source !== 'shared') {
        throw new Error(before.credentialRef && !ownStillValid
          ? '更换服务主机时，请重新填写该服务的 API Key。'
          : '请填写该服务的 API Key。与 AI 模型在同一主机且模型 Key 已保存时，才可留空共用。');
      }
    }

    return commitWithSecret({
      credentials: this.credentials,
      previousRef: before.credentialRef,
      keptRef,
      key,
      createRef: () => `trellis.${section === 'recognition' ? 'stt' : 'tts'}.${this.createId()}`,
      commit: async (credentialRef) => {
        // Re-read so a concurrent save of the other section is not overwritten.
        const latest = await this.repository.load();
        const next = { ...validated, credentialRef };
        await this.repository.save({ ...latest, [section]: next });
        return next;
      },
    });
  }
}
