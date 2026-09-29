import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SettingsService } from '../src/application/settings-service';
import { createVoiceRouter, VoiceAccess, type VoiceEngines } from '../src/application/voice-access';
import { VoiceSettingsService } from '../src/application/voice-settings-service';
import { ModelRequestError } from '../src/contracts/model';
import type { OnlineAudioConfig, OnlineSynthesisConfig, SpeechRecognitionGateway, SpeechSynthesisGateway } from '../src/contracts/speech';
import {
  defaultVoiceSettings, maxAudioUploadBytes, splitForSpeech, validateRecognition, validateSynthesis,
} from '../src/domain/voice';
import { migrate, migrations, schemaVersion } from '../src/infrastructure/database/migrations';
import { SqliteSettingsRepository, SqliteVoiceSettingsRepository } from '../src/infrastructure/database/repositories';
import { createSynthesizer, createTranscriber, type AudioFetch, type AudioResponse } from '../src/infrastructure/speech/online-audio-api';
import type { CredentialStore } from '../src/repositories/contracts';
import { adapter, freshDatabase, sequentialIds } from './helpers';

const host = 'https://audio.example.com/v1';
const signal = () => new AbortController().signal;

test('online speech settings are validated only when the online engine is selected', () => {
  const recognition = defaultVoiceSettings.recognition;
  assert.deepEqual(validateRecognition(recognition), recognition);
  assert.throws(() => validateRecognition({ ...recognition, engine: 'online' }), /服务地址/);
  assert.throws(() => validateRecognition({ ...recognition, engine: 'online', baseUrl: 'http://x.example/v1', model: 'm' }), /HTTPS/);
  assert.equal(validateRecognition({ ...recognition, engine: 'online', baseUrl: `${host}/`, model: ' whisper ' }).model, 'whisper');
  // A half-filled online form can still be kept while the system engine is in use.
  assert.equal(validateRecognition({ ...recognition, baseUrl: `${host}/` }).baseUrl, host);

  const synthesis = { ...defaultVoiceSettings.synthesis, engine: 'online' as const, baseUrl: host, model: 'tts' };
  assert.throws(() => validateSynthesis(synthesis), /声音/);
  assert.throws(() => validateSynthesis({ ...synthesis, voice: 'v', format: 'ogg' as never }), /格式/);
  assert.throws(() => validateSynthesis({ ...synthesis, voice: 'v', speechRate: 3 }), /语速/);
});

test('long text is split at sentence ends within the limit without losing words', () => {
  const text = 'One two three. Four five six! Seven eight nine? Ten.';
  assert.deepEqual(splitForSpeech(text, 1000), [text]);
  const chunks = splitForSpeech(text, 20);
  assert.deepEqual(chunks, ['One two three.', 'Four five six!', 'Seven eight nine?', 'Ten.']);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
  // A sentence longer than the limit falls back to word boundaries, then to a hard cut.
  const long = splitForSpeech('alpha beta gamma delta epsilon', 12);
  assert.ok(long.every((chunk) => chunk.length <= 12));
  assert.equal(long.join(' ').replace(/\s+/g, ' '), 'alpha beta gamma delta epsilon');
  assert.deepEqual(splitForSpeech('x'.repeat(25), 10), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  assert.deepEqual(splitForSpeech('   '), []);
});

test('v2 databases upgrade to v3 keeping the model settings and defaulting speech to the system', async () => {
  const db = adapter(new DatabaseSync(':memory:'));
  db.sqlite.exec(migrations[0].sql);
  db.sqlite.exec(migrations[1].sql);
  db.sqlite.exec('PRAGMA user_version = 2');
  db.sqlite.exec(`UPDATE settings SET base_url = '${host}', model = 'm', speech_rate = 0.7, credential_ref = 'ref' WHERE id = 1`);
  await migrate(db);
  assert.equal(schemaVersion, 3);
  assert.deepEqual(await new SqliteSettingsRepository(db).load(), { baseUrl: host, model: 'm', temperature: null, credentialRef: 'ref' });
  assert.deepEqual(await new SqliteVoiceSettingsRepository(db).load(), {
    ...defaultVoiceSettings, synthesis: { ...defaultVoiceSettings.synthesis, speechRate: 0.7 },
  });
  assert.throws(() => db.sqlite.exec("UPDATE settings SET recognition_engine = 'cloud'"), /CHECK/);
  assert.throws(() => db.sqlite.exec("UPDATE settings SET tts_format = 'ogg'"), /CHECK/);
  assert.throws(() => db.sqlite.exec('UPDATE settings SET temperature = 3'), /CHECK/);
});

async function fixture() {
  const db = await freshDatabase();
  const secrets = new Map<string, string>();
  const credentials: CredentialStore = {
    async get(ref) { return secrets.get(ref) ?? null; },
    async set(ref, value) { secrets.set(ref, value); },
    async remove(ref) { secrets.delete(ref); },
  };
  const modelRepository = new SqliteSettingsRepository(db);
  const voiceRepository = new SqliteVoiceSettingsRepository(db);
  const access = new VoiceAccess(voiceRepository, modelRepository, credentials);
  const model = new SettingsService(modelRepository, credentials, sequentialIds('m'));
  const voice = new VoiceSettingsService(voiceRepository, access, credentials, sequentialIds('v'));
  await model.save({ baseUrl: host, model: 'chat', temperature: 0.3, credentialRef: null }, 'model-key');
  return { db, secrets, access, model, voice };
}

const onlineRecognition = { engine: 'online' as const, baseUrl: host, model: 'whisper', credentialRef: null };

test('a speech service on the model host shares the model key; another host needs its own', async () => {
  const f = await fixture();
  await f.voice.saveRecognition(onlineRecognition, '');
  assert.equal((await f.voice.load()).keys.recognition, 'shared');
  assert.deepEqual(await f.access.recognition(), { engine: 'online', config: { baseUrl: host, model: 'whisper', apiKey: 'model-key' } });

  const elsewhere = { ...onlineRecognition, baseUrl: 'https://other.example/v1' };
  await assert.rejects(f.voice.saveRecognition(elsewhere, ''), /API Key/);
  assert.equal((await f.voice.load()).settings.recognition.baseUrl, host);

  await f.voice.saveRecognition(elsewhere, 'stt-key');
  const view = await f.voice.load();
  assert.equal(view.keys.recognition, 'own');
  assert.equal(f.secrets.get(view.settings.recognition.credentialRef!), 'stt-key');
  assert.ok(view.settings.recognition.credentialRef!.startsWith('trellis.stt.'));
  // Only references reach SQLite.
  assert.ok(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM settings').all()).includes('stt-key'));
});

test('an own key stays with its host: moving host drops it, and the old secret is deleted', async () => {
  const f = await fixture();
  await f.voice.saveRecognition({ ...onlineRecognition, baseUrl: 'https://other.example/v1' }, 'stt-key');
  const ownRef = (await f.voice.load()).settings.recognition.credentialRef!;

  // Same host, different path: the key is kept.
  await f.voice.saveRecognition({ ...onlineRecognition, baseUrl: 'https://other.example/v2' }, '');
  assert.equal((await f.voice.load()).settings.recognition.credentialRef, ownRef);

  // A third host without a key is refused and nothing changes.
  await assert.rejects(f.voice.saveRecognition({ ...onlineRecognition, baseUrl: 'https://third.example/v1' }, ''), /重新填写/);
  assert.equal(f.secrets.get(ownRef), 'stt-key');

  // Moving onto the model host falls back to sharing and removes the orphaned secret.
  await f.voice.saveRecognition(onlineRecognition, '');
  assert.equal((await f.voice.load()).keys.recognition, 'shared');
  assert.equal(f.secrets.has(ownRef), false);
});

test('saving one speech section leaves the other untouched; clearing a key falls back to sharing', async () => {
  const f = await fixture();
  const synthesis = { ...defaultVoiceSettings.synthesis, engine: 'online' as const, baseUrl: host, model: 'aura', voice: 'asteria', speechRate: 1 };
  await f.voice.saveSynthesis(synthesis, 'tts-key');
  await f.voice.saveRecognition(onlineRecognition, '');
  const view = await f.voice.load();
  assert.equal(view.settings.synthesis.voice, 'asteria');
  assert.equal(view.settings.synthesis.speechRate, 1);
  assert.equal(view.keys.synthesis, 'own');

  await f.voice.clearKey('synthesis');
  assert.equal((await f.voice.load()).keys.synthesis, 'shared');
  assert.deepEqual(await f.access.synthesis(), {
    engine: 'online', config: { baseUrl: host, model: 'aura', voice: 'asteria', format: 'mp3', apiKey: 'model-key' },
  });

  // Once the model key is gone there is nothing to share.
  await f.model.clearApiKey();
  assert.deepEqual(await f.access.synthesis(), { engine: 'online', config: null });
});

function fakeSpeech(log: string[], name: string): SpeechSynthesisGateway {
  return {
    async hasEnglishVoice() { return true; },
    async speak(text) { log.push(`${name}:speak:${text}`); },
    async stop() { log.push(`${name}:stop`); },
  };
}

function fakeRecognition(name: string): SpeechRecognitionGateway {
  return {
    async capability() { return { available: true, mode: name === 'system' ? 'utterance' : 'manual' }; },
    async recognize() { return `${name} heard`; },
  };
}

test('the router picks the engine per call from saved settings', async () => {
  const f = await fixture();
  const log: string[] = [];
  const configs: (OnlineAudioConfig | OnlineSynthesisConfig)[] = [];
  const engines: VoiceEngines = {
    system: { recognition: fakeRecognition('system'), speech: fakeSpeech(log, 'system') },
    onlineRecognition(config) { configs.push(config); return fakeRecognition('online'); },
    onlineSpeech(config) { configs.push(config); return fakeSpeech(log, 'online'); },
  };
  const router = createVoiceRouter(f.access, engines);
  assert.equal(await router.recognition.recognize('en-US', signal()), 'system heard');
  await router.speech.speak('hi', 1);
  assert.deepEqual(log, ['system:stop', 'system:speak:hi']);

  // Online but incomplete: reported honestly, nothing is sent anywhere.
  await f.db.runAsync("UPDATE settings SET recognition_engine = 'online', synthesis_engine = 'online'");
  assert.equal((await router.recognition.capability('en-US')).available, false);
  await assert.rejects(router.speech.speak('hi', 1), /在线朗读还没配置完整/);
  assert.equal(configs.length, 0);

  await f.voice.saveRecognition(onlineRecognition, '');
  await f.voice.saveSynthesis({ ...defaultVoiceSettings.synthesis, engine: 'online', baseUrl: host, model: 'aura', voice: 'asteria' }, '');
  assert.equal(await router.recognition.recognize('en-US', signal()), 'online heard');
  log.length = 0;
  await router.speech.speak('hello', 1);
  assert.deepEqual(log, ['system:stop', 'online:speak:hello']);
  assert.deepEqual(configs.map((config) => config.apiKey), ['model-key', 'model-key']);
});

function audioResponse(body: string | Uint8Array, init: { status?: number; contentType?: string } = {}): AudioResponse {
  const status = init.status ?? 200;
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: status < 400,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? init.contentType ?? 'application/json' : null) },
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

const audioConfig = { baseUrl: host, model: 'whisper', apiKey: 'k' };

test('transcription uploads multipart audio and reads the text back', async () => {
  const calls: { url: string; init: Parameters<AudioFetch>[1] }[] = [];
  const transcriber = createTranscriber(audioConfig, async (url, init) => {
    calls.push({ url, init });
    return audioResponse('{"text":" I went hiking today. "}');
  });
  const audio = Object.assign(new Blob([new Uint8Array(16)], { type: 'audio/mp4' }), { name: 'rec.m4a' });
  assert.equal(await transcriber.transcribe(audio, 'en-US', signal()), 'I went hiking today.');
  assert.equal(calls[0]!.url, `${host}/audio/transcriptions`);
  assert.equal(calls[0]!.init.headers.Authorization, 'Bearer k');
  const form = calls[0]!.init.body as FormData;
  assert.equal(form.get('model'), 'whisper');
  assert.equal(form.get('language'), 'en');
  assert.equal((form.get('file') as File).name, 'rec.m4a');

  const plain = createTranscriber(audioConfig, async () => audioResponse('Hello there\n', { contentType: 'text/plain' }));
  assert.equal(await plain.transcribe(audio, 'en-US', signal()), 'Hello there');
});

test('transcription failures are classified and oversized audio never leaves the device', async () => {
  const audio = new Blob([new Uint8Array(8)]);
  const denied = createTranscriber(audioConfig, async () => audioResponse('{"error":{"message":"bad key"}}', { status: 401 }));
  await assert.rejects(denied.transcribe(audio, 'en', signal()), (error: unknown) => error instanceof ModelRequestError && error.kind === 'auth');
  const busy = createTranscriber(audioConfig, async () => audioResponse('{"error":{"message":"overloaded"}}', { status: 503 }));
  await assert.rejects(busy.transcribe(audio, 'en', signal()), /HTTP 503.*overloaded/);
  const offline = createTranscriber(audioConfig, async () => { throw new TypeError('Network request failed'); });
  await assert.rejects(offline.transcribe(audio, 'en', signal()), (error: unknown) => error instanceof ModelRequestError && error.kind === 'network');

  let called = false;
  const guarded = createTranscriber(audioConfig, async () => { called = true; return audioResponse('{}'); });
  const huge = { size: maxAudioUploadBytes + 1 } as Blob;
  await assert.rejects(guarded.transcribe(huge, 'en', signal()), /10 MB/);
  assert.equal(called, false);
});

test('synthesis posts JSON and returns audio bytes; JSON answers and aborts are not audio', async () => {
  const synthesisConfig = { ...audioConfig, model: 'aura', voice: 'asteria', format: 'mp3' as const };
  const calls: Parameters<AudioFetch>[1][] = [];
  const synthesizer = createSynthesizer(synthesisConfig, async (_url, init) => {
    calls.push(init);
    return audioResponse(new Uint8Array([1, 2, 3]), { contentType: 'audio/mpeg' });
  });
  assert.deepEqual([...await synthesizer.synthesize('Hello', signal())], [1, 2, 3]);
  assert.deepEqual(JSON.parse(calls[0]!.body as string), { model: 'aura', input: 'Hello', voice: 'asteria', response_format: 'mp3' });

  const jsonError = createSynthesizer(synthesisConfig, async () => audioResponse('{"error":"voice not found"}'));
  await assert.rejects(jsonError.synthesize('Hello', signal()), /voice not found/);

  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const aborted = createSynthesizer(synthesisConfig, async () => { throw abort; });
  await assert.rejects(aborted.synthesize('Hello', signal()), (error: unknown) => error === abort);
});
