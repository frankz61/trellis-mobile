import { asString, isRecord } from './model-json';

export const exerciseKinds = ['cloze', 'sentence_make', 'mini_dialogue'] as const;
export type ExerciseKind = (typeof exerciseKinds)[number];
export type TargetType = 'word' | 'grammar';
export type AttemptStatus = 'pending' | 'correct' | 'incorrect';

export const exerciseKindLabels: Record<ExerciseKind, string> = {
  cloze: '填空',
  sentence_make: '造句',
  mini_dialogue: '对话',
};

export interface DailyPlan {
  id: string;
  profileId: string;
  localDate: string;
  timezone: string;
  version: number;
  createdAt: string;
}

export interface Exercise {
  id: string;
  planId: string;
  position: number;
  kind: ExerciseKind;
  prompt: string;
  answer: string;
  targetType: TargetType;
  targetId: string;
  targetLabel: string;
}

export interface ReviewAttempt {
  id: string;
  exerciseId: string;
  answer: string;
  status: AttemptStatus;
  feedback: string;
  judgedBy: 'local' | 'model' | null;
}

export interface ReviewTarget {
  type: TargetType;
  id: string;
  label: string;
  // Higher comes first when the daily set is chosen.
  weight: number;
}

export interface GeneratedExercise {
  kind: ExerciseKind;
  prompt: string;
  answer: string;
}

export interface Evaluation {
  correct: boolean;
  feedback: string;
}

export const dailyWordTargets = 2;
export const dailyGrammarTargets = 3;

// Calendar day in the device's zone; plans keep the zone they were made in.
export function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function parseExercise(payload: unknown): GeneratedExercise | null {
  if (!isRecord(payload)) return null;
  const kind = asString(payload.kind).toLowerCase();
  const prompt = asString(payload.prompt);
  const answer = asString(payload.answer);
  if (!(exerciseKinds as readonly string[]).includes(kind) || !prompt || !answer) return null;
  return { kind: kind as ExerciseKind, prompt: prompt.slice(0, 600), answer: answer.slice(0, 600) };
}

export function parseEvaluation(payload: unknown): Evaluation | null {
  if (!isRecord(payload) || typeof payload.correct !== 'boolean') return null;
  return { correct: payload.correct, feedback: asString(payload.feedback).slice(0, 600) };
}

export function normalizeAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?,;:"'’“”]+$/g, '');
}

// Cloze items have one reference answer, so an exact (normalized) match is
// decided on the device. Anything else needs the model's judgement.
export function judgeLocally(exercise: Pick<Exercise, 'kind' | 'answer'>, answer: string): boolean | null {
  if (exercise.kind !== 'cloze') return null;
  return normalizeAnswer(answer) === normalizeAnswer(exercise.answer) ? true : null;
}
