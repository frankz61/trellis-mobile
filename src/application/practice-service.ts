import { parseModelJson } from '../domain/model-json';
import { structuredCallTimeoutMs, withTimeout } from './abort';
import {
  dailyGrammarTargets, dailyWordTargets, deviceTimezone, judgeLocally, localDate,
  parseEvaluation, parseExercise, type DailyPlan, type GeneratedExercise, type ReviewTarget,
} from '../domain/practice';
import { evaluationPrompt, exercisePrompt } from '../prompts/knowledge';
import type { ExerciseWithAttempt, KnowledgeRepository, PracticeRepository } from '../repositories/contracts';
import type { ModelAccess } from './model-access';

export interface PracticeDependencies {
  profileId: string;
  practice: PracticeRepository;
  knowledge: Pick<KnowledgeRepository, 'dueTargets'>;
  access: ModelAccess;
  createId: () => string;
  now?: () => Date;
  timezone?: () => string;
}

export interface DailyPractice {
  plan: DailyPlan | null;
  exercises: ExerciseWithAttempt[];
  // False when nothing is due yet, so the UI can say so instead of offering generation.
  hasTargets: boolean;
}

export const noTargetsMessage = '还没有需要复习的内容。先去“陪练”聊几句，记录下生词和错因。';
export const learnerLevel = 'B1-B2';

export class PracticeService {
  constructor(private readonly deps: PracticeDependencies) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private async targets(): Promise<ReviewTarget[]> {
    return this.deps.knowledge.dueTargets(this.deps.profileId, this.now().toISOString(), { words: dailyWordTargets, grammar: dailyGrammarTargets });
  }

  // Today's set is reused on every visit; nothing is generated here.
  async today(): Promise<DailyPractice> {
    const plan = await this.deps.practice.latestPlan(this.deps.profileId, localDate(this.now()));
    const [exercises, targets] = await Promise.all([plan ? this.deps.practice.exercises(plan.id) : [], this.targets()]);
    return { plan, exercises, hasTargets: targets.length > 0 };
  }

  // Creates a new plan version. Items the model fails to produce are skipped, never faked;
  // an empty result is an error rather than an empty plan.
  async generate(signal: AbortSignal): Promise<DailyPractice> {
    const targets = await this.targets();
    if (!targets.length) throw new Error(noTargetsMessage);
    const gateway = await this.deps.access.gateway();
    const generated: (GeneratedExercise & { id: string; target: ReviewTarget })[] = [];
    for (const target of targets) {
      const raw = await gateway.complete([{ role: 'user', content: exercisePrompt.build(target.label, target.type, learnerLevel) }], withTimeout(signal, structuredCallTimeoutMs));
      const exercise = parseExercise(parseModelJson(raw));
      if (exercise) generated.push({ ...exercise, id: this.deps.createId(), target });
    }
    if (!generated.length) throw new Error('这次没有生成出可用的题目，请稍后重试。');
    const now = this.now();
    const previous = await this.deps.practice.latestPlan(this.deps.profileId, localDate(now));
    const plan: DailyPlan = {
      id: this.deps.createId(), profileId: this.deps.profileId, localDate: localDate(now),
      timezone: (this.deps.timezone ?? deviceTimezone)(), version: (previous?.version ?? 0) + 1, createdAt: now.toISOString(),
    };
    await this.deps.practice.createPlan(plan, generated);
    return this.today();
  }

  // Records the answer first, then judges it (locally when unambiguous, otherwise by the model)
  // and applies exactly one mastery update. A failed evaluation leaves the attempt pending.
  async answer(exerciseId: string, input: string, signal: AbortSignal): Promise<ExerciseWithAttempt> {
    const exercise = await this.deps.practice.exercise(exerciseId);
    if (!exercise) throw new Error('题目不存在。');
    if (exercise.attempt && exercise.attempt.status !== 'pending') return exercise;
    const text = (exercise.attempt?.answer ?? input).trim();
    if (!text) throw new Error('请先写下你的答案。');
    const now = this.now().toISOString();
    let attempt = exercise.attempt;
    if (!attempt) {
      attempt = { id: this.deps.createId(), exerciseId, answer: text, status: 'pending', feedback: '', judgedBy: null };
      await this.deps.practice.createAttempt(attempt, now);
    }

    let verdict: { correct: boolean; feedback: string; judgedBy: 'local' | 'model' };
    if (judgeLocally(exercise, text) === true) {
      verdict = { correct: true, feedback: '答对了，和参考答案一致。', judgedBy: 'local' };
    } else {
      const gateway = await this.deps.access.gateway();
      const raw = await gateway.complete([{ role: 'user', content: evaluationPrompt.build(exercise.prompt, exercise.answer, text) }], withTimeout(signal, structuredCallTimeoutMs));
      const evaluation = parseEvaluation(parseModelJson(raw));
      if (!evaluation) throw new Error('评价结果无法解析，稍后可以再试一次。');
      verdict = { ...evaluation, judgedBy: 'model' };
    }
    await this.deps.practice.judgeAttempt(attempt.id, verdict.correct ? 'correct' : 'incorrect', verdict.feedback, verdict.judgedBy, now, {
      profileId: this.deps.profileId, targetType: exercise.targetType, targetId: exercise.targetId, correct: verdict.correct,
    });
    return (await this.deps.practice.exercise(exerciseId)) ?? exercise;
  }
}
