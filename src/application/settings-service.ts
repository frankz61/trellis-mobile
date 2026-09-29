import { validateSettings, type ModelSettings } from '../domain/settings';
import type { CredentialStore, SettingsRepository } from '../repositories/contracts';
import { commitWithSecret } from './secrets';

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly credentials: CredentialStore,
    private readonly createId: () => string,
  ) {}

  async load(): Promise<{ settings: ModelSettings; hasApiKey: boolean }> {
    const settings = await this.repository.load();
    const hasApiKey = settings.credentialRef
      ? Boolean(await this.credentials.get(settings.credentialRef))
      : false;
    return { settings, hasApiKey };
  }

  async save(input: ModelSettings, replacementKey: string): Promise<ModelSettings> {
    const validated = validateSettings(input);
    const previous = await this.repository.load();
    const key = replacementKey.trim();
    if (validated.baseUrl !== previous.baseUrl && !key) {
      throw new Error('更换服务地址时，请重新填写该服务的 API Key。');
    }
    if (!key && (!previous.credentialRef || !(await this.credentials.get(previous.credentialRef)))) {
      throw new Error('请填写 API Key。');
    }
    return commitWithSecret({
      credentials: this.credentials,
      previousRef: previous.credentialRef,
      keptRef: previous.credentialRef,
      key,
      createRef: () => `trellis.model.${this.createId()}`,
      commit: async (credentialRef) => {
        const next = { ...validated, credentialRef };
        await this.repository.save(next);
        return next;
      },
    });
  }

  async clearApiKey(): Promise<void> {
    const settings = await this.repository.load();
    // If deletion fails, retain the reference so the user can retry.
    if (settings.credentialRef) await this.credentials.remove(settings.credentialRef);
    await this.repository.save({ ...settings, credentialRef: null });
  }
}
