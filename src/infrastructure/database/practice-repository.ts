import { grammarLabel } from '../../domain/knowledge';
import { nextGrammarReview, nextWordMastery, type WordMastery } from '../../domain/mastery';
import type { AttemptStatus, DailyPlan, GeneratedExercise, ReviewAttempt, ReviewTarget, TargetType } from '../../domain/practice';
import type { ExerciseWithAttempt, PracticeRepository } from '../../repositories/contracts';
import type { Database } from './database';

interface ExerciseRow {
  id: string; planId: string; position: number; kind: ExerciseWithAttempt['kind']; prompt: string; answer: string;
  targetType: TargetType; targetId: string; targetName: string | null;
  attemptId: string | null; attemptAnswer: string | null; attemptStatus: AttemptStatus | null;
  attemptFeedback: string | null; attemptJudgedBy: ReviewAttempt['judgedBy'];
}

const exerciseSelect = `
  SELECT e.id, e.plan_id AS planId, e.position, e.kind, e.prompt, e.answer, e.target_type AS targetType, e.target_id AS targetId,
         CASE e.target_type WHEN 'word' THEN (SELECT lemma FROM words WHERE id = e.target_id)
                            ELSE (SELECT name FROM grammar_points WHERE id = e.target_id) END AS targetName,
         a.id AS attemptId, a.answer AS attemptAnswer, a.status AS attemptStatus, a.feedback AS attemptFeedback, a.judged_by AS attemptJudgedBy
  FROM exercises e LEFT JOIN review_attempts a ON a.exercise_id = e.id`;

function toExercise(row: ExerciseRow): ExerciseWithAttempt {
  const name = row.targetName ?? '';
  return {
    id: row.id, planId: row.planId, position: row.position, kind: row.kind, prompt: row.prompt, answer: row.answer,
    targetType: row.targetType, targetId: row.targetId, targetLabel: row.targetType === 'grammar' ? grammarLabel(name) : name,
    attempt: row.attemptId && row.attemptStatus ? {
      id: row.attemptId, exerciseId: row.id, answer: row.attemptAnswer ?? '', status: row.attemptStatus,
      feedback: row.attemptFeedback ?? '', judgedBy: row.attemptJudgedBy,
    } : null,
  };
}

export class SqlitePracticeRepository implements PracticeRepository {
  constructor(private readonly database: Database) {}

  latestPlan(profileId: string, localDate: string) {
    return this.database.getFirstAsync<DailyPlan>(
      `SELECT id, profile_id AS profileId, local_date AS localDate, timezone, version, created_at AS createdAt
       FROM daily_plans WHERE profile_id = ? AND local_date = ? ORDER BY version DESC LIMIT 1`, profileId, localDate,
    );
  }

  async createPlan(plan: DailyPlan, exercises: (GeneratedExercise & { id: string; target: ReviewTarget })[]) {
    await this.database.withTransactionAsync(async () => {
      await this.database.runAsync(
        'INSERT INTO daily_plans (id, profile_id, local_date, timezone, version, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        plan.id, plan.profileId, plan.localDate, plan.timezone, plan.version, plan.createdAt,
      );
      for (const [position, exercise] of exercises.entries()) {
        await this.database.runAsync(
          `INSERT INTO exercises (id, plan_id, position, kind, prompt, answer, target_type, target_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          exercise.id, plan.id, position, exercise.kind, exercise.prompt, exercise.answer, exercise.target.type, exercise.target.id, plan.createdAt,
        );
      }
    });
  }

  async exercises(planId: string) {
    const rows = await this.database.getAllAsync<ExerciseRow>(`${exerciseSelect} WHERE e.plan_id = ? ORDER BY e.position`, planId);
    return rows.map(toExercise);
  }

  async exercise(id: string) {
    const row = await this.database.getFirstAsync<ExerciseRow>(`${exerciseSelect} WHERE e.id = ?`, id);
    return row ? toExercise(row) : null;
  }

  async createAttempt(attempt: ReviewAttempt, now: string) {
    await this.database.runAsync(
      `INSERT INTO review_attempts (id, exercise_id, answer, status, feedback, judged_by, mastery_applied, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', '', NULL, 0, ?, ?)`, attempt.id, attempt.exerciseId, attempt.answer, now, now,
    );
  }

  async judgeAttempt(attemptId: string, status: Exclude<AttemptStatus, 'pending'>, feedback: string, judgedBy: 'local' | 'model', now: string,
    mastery: { profileId: string; targetType: TargetType; targetId: string; correct: boolean }) {
    const db = this.database;
    await db.withTransactionAsync(async () => {
      const current = await db.getFirstAsync<{ applied: number }>('SELECT mastery_applied AS applied FROM review_attempts WHERE id = ?', attemptId);
      if (!current || current.applied) return;
      await db.runAsync(
        'UPDATE review_attempts SET status = ?, feedback = ?, judged_by = ?, mastery_applied = 1, updated_at = ? WHERE id = ?',
        status, feedback, judgedBy, now, attemptId,
      );
      if (mastery.targetType === 'word') {
        const existing = await this.wordMastery(mastery.profileId, mastery.targetId);
        const next = nextWordMastery(existing ?? { level: 1, reviewCount: 0, dueAt: null }, mastery.correct, new Date(now));
        await db.runAsync(
          `INSERT INTO word_mastery (profile_id, word_id, level, review_count, due_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, word_id) DO UPDATE SET level = excluded.level, review_count = excluded.review_count,
             due_at = excluded.due_at, updated_at = excluded.updated_at`,
          mastery.profileId, mastery.targetId, next.level, next.reviewCount, next.dueAt, now,
        );
      } else {
        const existing = await db.getFirstAsync<{ count: number }>(
          'SELECT weakness_count AS count FROM grammar_mastery WHERE profile_id = ? AND grammar_id = ?', mastery.profileId, mastery.targetId,
        );
        const next = nextGrammarReview(existing?.count ?? 0, mastery.correct, new Date(now));
        await db.runAsync(
          `INSERT INTO grammar_mastery (profile_id, grammar_id, weakness_count, due_at, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, grammar_id) DO UPDATE SET weakness_count = excluded.weakness_count,
             due_at = excluded.due_at, updated_at = excluded.updated_at`,
          mastery.profileId, mastery.targetId, next.weakness, next.dueAt, now,
        );
      }
    });
  }

  wordMastery(profileId: string, wordId: string) {
    return this.database.getFirstAsync<WordMastery>(
      'SELECT level, review_count AS reviewCount, due_at AS dueAt FROM word_mastery WHERE profile_id = ? AND word_id = ?', profileId, wordId,
    );
  }
}
