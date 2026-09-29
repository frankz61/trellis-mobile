import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettingsService } from '../src/application/settings-service';
import { defaultSettings, validateSettings } from '../src/domain/settings';
import type { CredentialStore, SettingsRepository } from '../src/repositories/contracts';

function fixture() {
  let stored = { ...defaultSettings };
  let failSave = false;
  let failSecret = false;
  let counter = 0;
  const secrets = new Map<string, string>();
  const repository: SettingsRepository = {
    async load() { return { ...stored }; },
    async save(value) { if (failSave) throw new Error('database failure'); stored = { ...value }; },
  };
  const credentials: CredentialStore = {
    async get(ref) { return secrets.get(ref) ?? null; },
    async set(ref, value) { if (failSecret) throw new Error('keystore failure'); secrets.set(ref, value); },
    async remove(ref) { secrets.delete(ref); },
  };
  return {
    service: new SettingsService(repository, credentials, () => String(++counter)), secrets,
    stored: () => stored,
    failDatabase: () => { failSave = true; },
    failKeystore: () => { failSecret = true; },
  };
}

const configured = { ...defaultSettings, baseUrl: 'https://example.com/v1/', model: 'test-model' };

test('normalizes endpoints and rejects credentials or insecure endpoints', () => {
  assert.equal(validateSettings(configured).baseUrl, 'https://example.com/v1');
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret']) {
    assert.throws(() => validateSettings({ ...configured, baseUrl: url }));
  }
});

test('saves only a secret reference in settings and allows retaining the key', async () => {
  const f = fixture();
  const saved = await f.service.save(configured, 'test-key');
  assert.equal(f.secrets.get(saved.credentialRef!), 'test-key');
  assert.ok(!JSON.stringify(f.stored()).includes('test-key'));
  await f.service.save({ ...saved, model: 'new-model' }, '');
  assert.equal((await f.service.load()).hasApiKey, true);
  assert.equal(f.stored().model, 'new-model');
  await f.service.clearApiKey();
  assert.equal((await f.service.load()).hasApiKey, false);
  assert.equal(f.secrets.size, 0);
});

test('database failure preserves the old key and removes the uncommitted replacement', async () => {
  const f = fixture();
  const saved = await f.service.save(configured, 'old-key');
  f.failDatabase();
  await assert.rejects(f.service.save(saved, 'new-key'), /database failure/);
  assert.equal(f.secrets.get(saved.credentialRef!), 'old-key');
  assert.equal(f.secrets.size, 1);
  assert.deepEqual(f.stored(), saved);
});

test('keystore failure does not change database settings', async () => {
  const f = fixture();
  f.failKeystore();
  await assert.rejects(f.service.save(configured, 'test-key'), /keystore failure/);
  assert.deepEqual(f.stored(), defaultSettings);
});

test('changing providers requires an explicit replacement key', async () => {
  const f = fixture();
  const saved = await f.service.save(configured, 'test-key');
  await assert.rejects(f.service.save({ ...saved, baseUrl: 'https://other.example/v1' }, ''), /重新填写/);
  assert.deepEqual(f.stored(), saved);
});
