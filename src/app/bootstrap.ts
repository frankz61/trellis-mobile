import { randomUUID } from 'expo-crypto';
import { fetch } from 'expo/fetch';
import { openDatabaseAsync } from 'expo-sqlite';
import { version as appVersion } from '../../package.json';
import { BackupService } from '../application/backup-service';
import { ConversationService } from '../application/conversation-service';
import { KnowledgeService } from '../application/knowledge-service';
import { ModelAccess } from '../application/model-access';
import { PracticeService } from '../application/practice-service';
import { SettingsService } from '../application/settings-service';
import { createVoiceRouter, VoiceAccess } from '../application/voice-access';
import { VoiceSettingsService } from '../application/voice-settings-service';
import { SqliteBackupRepository } from '../infrastructure/database/backup-repository';
import { SqliteConversationRepository } from '../infrastructure/database/conversation-repository';
import { SqliteKnowledgeRepository } from '../infrastructure/database/knowledge-repository';
import { migrate, schemaVersion } from '../infrastructure/database/migrations';
import { SqlitePracticeRepository } from '../infrastructure/database/practice-repository';
import { SqliteLearningRepository, SqliteSettingsRepository, SqliteVoiceSettingsRepository } from '../infrastructure/database/repositories';
import { SqliteTaskRepository } from '../infrastructure/database/task-repository';
import { backupFiles } from '../infrastructure/files/backup-files';
import { createOpenAiCompatibleGateway } from '../infrastructure/models/openai-compatible';
import { credentials } from '../infrastructure/secure-storage/credentials';
import { createOnlineRecognition } from '../infrastructure/speech/online-recognition';
import { createOnlineSpeech } from '../infrastructure/speech/online-speech';
import { systemRecognition } from '../infrastructure/speech/system-recognition';
import { systemSpeech } from '../infrastructure/speech/system-speech';

async function initialize() {
  const database = await openDatabaseAsync('trellis.db');
  try {
    await migrate(database);
    const profile = await database.getFirstAsync<{ id: string }>('SELECT id FROM profiles LIMIT 1');
    const profileId = profile?.id ?? randomUUID();
    if (!profile) {
      await database.runAsync(
        'INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)',
        profileId, '我的学习空间', new Date().toISOString(),
      );
    }
    const settingsRepository = new SqliteSettingsRepository(database);
    // expo/fetch streams response bodies; React Native's built-in fetch buffers them.
    const access = new ModelAccess(settingsRepository, credentials, (config) => createOpenAiCompatibleGateway(config, fetch));
    const conversationRepository = new SqliteConversationRepository(database);
    const knowledgeRepository = new SqliteKnowledgeRepository(database, randomUUID);
    const knowledge = new KnowledgeService({
      profileId, tasks: new SqliteTaskRepository(database), knowledge: knowledgeRepository,
      conversation: conversationRepository, access, createId: randomUUID,
    });
    await knowledge.recover();
    const voiceRepository = new SqliteVoiceSettingsRepository(database);
    const voiceAccess = new VoiceAccess(voiceRepository, settingsRepository, credentials);
    // Which engine answers is decided per call from the saved settings.
    const voice = createVoiceRouter(voiceAccess, {
      system: { recognition: systemRecognition, speech: systemSpeech },
      onlineRecognition: createOnlineRecognition,
      onlineSpeech: createOnlineSpeech,
    });
    return {
      profileId,
      settings: new SettingsService(settingsRepository, credentials, randomUUID),
      voiceSettings: new VoiceSettingsService(voiceRepository, voiceAccess, credentials, randomUUID),
      access,
      learning: new SqliteLearningRepository(database),
      conversation: new ConversationService({
        profileId, repository: conversationRepository, access, createId: randomUUID, knowledge: knowledgeRepository,
        afterReply: (userMessageId) => knowledge.enqueueExtraction(userMessageId),
      }),
      knowledge,
      practice: new PracticeService({
        profileId, practice: new SqlitePracticeRepository(database), knowledge: knowledgeRepository, access, createId: randomUUID,
      }),
      backup: new BackupService({
        profileId, repository: new SqliteBackupRepository(database), files: backupFiles, schemaVersion, appVersion: appVersion,
      }),
      speech: voice.speech,
      recognition: voice.recognition,
    };
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}

export type AppServices = Awaited<ReturnType<typeof initialize>>;
let initialization: Promise<AppServices> | undefined;

export function bootstrap(): Promise<AppServices> {
  initialization ??= initialize().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
