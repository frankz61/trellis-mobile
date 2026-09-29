export type MessageRole = 'user' | 'assistant';
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type WordRelation = 'synonym' | 'antonym' | 'collocation';

export interface LearningSummary {
  sessions: number;
  words: number;
  mistakes: number;
  pendingTasks: number;
}

export interface VocabularyEntry {
  id: string;
  lemma: string;
  meaning: string;
  level: number;
}

export interface MistakeEntry {
  id: string;
  original: string;
  corrected: string;
  type: string;
  explanation: string;
}
