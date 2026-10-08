import type { BackupRow, BackupTable } from '../domain/backup';
import type { ConversationMessage, ConversationSession, MessageStatus } from '../domain/conversation';
import type { Extraction } from '../domain/knowledge';
import type { GraphSnapshot } from '../domain/graph';
import type { LearningSummary, MistakeEntry, TaskStatus, VocabularyEntry } from '../domain/learning';
import type { WordMastery } from '../domain/mastery';
import type { AttemptStatus, DailyPlan, Exercise, GeneratedExercise, ReviewAttempt, ReviewTarget, TargetType } from '../domain/practice';
import type { ModelSettings } from '../domain/settings';
import type { VoiceSettings } from '../domain/voice';

export interface SettingsRepository {
  load(): Promise<ModelSettings>;
  save(settings: ModelSettings): Promise<void>;
}

export interface VoiceSettingsRepository {
  load(): Promise<VoiceSettings>;
  save(settings: VoiceSettings): Promise<void>;
}

export interface CredentialStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  remove(ref: string): Promise<void>;
}

// Everything the knowledge-graph view draws, for one learner.
export interface GraphRepository {
  snapshot(profileId: string): Promise<GraphSnapshot>;
}

export interface LearningRepository {
  summary(): Promise<LearningSummary>;
  vocabulary(): Promise<VocabularyEntry[]>;
  mistakes(): Promise<MistakeEntry[]>;
}

export interface ConversationRepository {
  latestSession(profileId: string): Promise<ConversationSession | null>;
  createSession(session: ConversationSession): Promise<void>;
  messages(sessionId: string): Promise<ConversationMessage[]>;
  message(id: string): Promise<ConversationMessage | null>;
  // The coach reply the given message was answering: the last non-empty assistant message before it.
  replyBefore(id: string): Promise<ConversationMessage | null>;
  // The completed coach reply that answered the given message, if no other learner message came first.
  replyAfter(id: string): Promise<ConversationMessage | null>;
  appendMessage(message: ConversationMessage): Promise<void>;
  updateMessage(id: string, content: string, status: MessageStatus): Promise<void>;
  // Replies left 'pending' by a killed process are never completed; surface them as interrupted.
  interruptPending(sessionId: string): Promise<void>;
}

export interface WeakPoints {
  grammar: { id: string; name: string; count: number }[];
  words: { id: string; lemma: string; level: number }[];
}

export interface KnowledgeRepository {
  // Writes words, evidence, mistakes and weakness counts in one transaction.
  // Re-applying the same message is a no-op thanks to per-message unique keys.
  applyExtraction(profileId: string, messageId: string, extraction: Extraction, now: string): Promise<{ words: number; mistakes: number }>;
  weakPoints(profileId: string): Promise<WeakPoints>;
  dueTargets(profileId: string, now: string, limits: { words: number; grammar: number }): Promise<ReviewTarget[]>;
}

export interface PersistedTask {
  id: string;
  kind: 'extract' | 'generate' | 'evaluate';
  dedupeKey: string;
  payload: string;
  status: TaskStatus;
  attempts: number;
  nextRunAt: string | null;
}

export interface TaskRepository {
  // Returns false when a task with the same dedupe key already exists.
  enqueue(task: Omit<PersistedTask, 'status' | 'attempts' | 'nextRunAt'>, now: string): Promise<boolean>;
  claimNext(now: string): Promise<PersistedTask | null>;
  finish(id: string, status: 'succeeded' | 'failed' | 'pending', attempts: number, nextRunAt: string | null, now: string): Promise<void>;
  // Tasks left 'running' by a killed process go back to the queue.
  recoverRunning(now: string): Promise<number>;
  pendingCount(): Promise<number>;
}

export interface ExerciseWithAttempt extends Exercise {
  attempt: ReviewAttempt | null;
}

export interface PracticeRepository {
  latestPlan(profileId: string, localDate: string): Promise<DailyPlan | null>;
  createPlan(plan: DailyPlan, exercises: (GeneratedExercise & { id: string; target: ReviewTarget })[]): Promise<void>;
  exercises(planId: string): Promise<ExerciseWithAttempt[]>;
  exercise(id: string): Promise<ExerciseWithAttempt | null>;
  createAttempt(attempt: ReviewAttempt, now: string): Promise<void>;
  // Records the verdict and the mastery change together; never called twice for one attempt.
  judgeAttempt(attemptId: string, status: Exclude<AttemptStatus, 'pending'>, feedback: string, judgedBy: 'local' | 'model', now: string,
    mastery: { profileId: string; targetType: TargetType; targetId: string; correct: boolean }): Promise<void>;
  wordMastery(profileId: string, wordId: string): Promise<WordMastery | null>;
}

export interface BackupRepository {
  dump(): Promise<Record<BackupTable, BackupRow[]>>;
  replace(tables: Record<BackupTable, BackupRow[]>, profileId: string): Promise<Record<BackupTable, number>>;
}

// Where a backup file goes and comes from; the user picks the location through the system UI.
export interface BackupFiles {
  // Resolves with the saved file name, or null when the user cancelled.
  save(fileName: string, json: string): Promise<string | null>;
  // Resolves with the file's text, or null when the user cancelled.
  pick(): Promise<string | null>;
}
