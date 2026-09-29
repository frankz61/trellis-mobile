import type { GatewayConfig, ModelGateway } from '../contracts/model';
import type { CredentialStore, SettingsRepository } from '../repositories/contracts';

export const notConfiguredMessage = '请先在“我的”页面配置模型服务和 API Key。';

// Resolves the learner's saved endpoint and secret into a gateway at call time,
// so a changed configuration applies to the next request without a restart.
export class ModelAccess {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly credentials: CredentialStore,
    private readonly createGateway: (config: GatewayConfig) => ModelGateway,
  ) {}

  async isConfigured(): Promise<boolean> {
    return (await this.resolve()) !== null;
  }

  async gateway(): Promise<ModelGateway> {
    const config = await this.resolve();
    if (!config) throw new Error(notConfiguredMessage);
    return this.createGateway(config);
  }

  private async resolve(): Promise<GatewayConfig | null> {
    const settings = await this.settings.load();
    const apiKey = settings.credentialRef ? await this.credentials.get(settings.credentialRef) : null;
    if (!settings.baseUrl || !settings.model || !apiKey) return null;
    return { baseUrl: settings.baseUrl, model: settings.model, apiKey, temperature: settings.temperature };
  }
}
