// Deliberately simple, testable review rules. The model only says whether an
// answer was right; how mastery moves is decided here.
export const maxLevel = 5;
export const reviewLevelThreshold = 3;
const intervalsByLevel = [1, 1, 2, 4, 7, 15];
const dayMs = 24 * 60 * 60 * 1000;

export interface WordMastery {
  level: number;
  reviewCount: number;
  dueAt: string | null;
}

// A word met in conversation is due right away so the first review lands the same day.
export function initialWordMastery(now: Date): WordMastery {
  return { level: 1, reviewCount: 0, dueAt: now.toISOString() };
}

export function nextWordMastery(current: WordMastery, correct: boolean, now: Date): WordMastery {
  const level = Math.max(0, Math.min(maxLevel, current.level + (correct ? 1 : -1)));
  const days = intervalsByLevel[Math.min(level, intervalsByLevel.length - 1)] ?? 1;
  return { level, reviewCount: current.reviewCount + 1, dueAt: new Date(now.getTime() + days * dayMs).toISOString() };
}

export function nextWeakness(count: number, correct: boolean): number {
  return Math.max(0, count + (correct ? -1 : 1));
}
