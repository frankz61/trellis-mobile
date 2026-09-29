// Ported from Trellis Web `backend/app/prompts/` (baseline a3fdff5). Evaluation no
// longer asks for `mastery_delta`: mastery changes are decided by local rules.
import { mistakeTypes } from '../domain/knowledge';

export const extractionPrompt = {
  version: 'extract-v1',
  build: (userInput: string) => [
    "Extract knowledge points worth saving from the learner's English input below.",
    'Only report real mistakes the learner made and words that are genuinely new or advanced for a CEFR B1 learner.',
    'Output STRICT JSON only, no extra text. Schema:',
    `{"mistakes":[{"orig":"original fragment","fix":"corrected","type":"${mistakeTypes.join('|')}","explanation":"short explanation in Chinese"}],`,
    ' "words":[{"lemma":"new word base form","meaning_cn":"Chinese meaning"}]}',
    'Use empty arrays when there is nothing to save.',
    '',
    'Learner input:',
    userInput,
    '',
    'JSON:',
  ].join('\n'),
} as const;

export const exercisePrompt = {
  version: 'exercise-v1',
  build: (item: string, kind: 'word' | 'grammar', level: string) => [
    'Generate one targeted exercise for an English learner.',
    `Target item: ${item} (kind: ${kind}, level: ${level}).`,
    'For kind "cloze" the prompt must contain exactly one blank written as ____ and the answer must be the single word or phrase that fills it.',
    'Output STRICT JSON only:',
    '{"kind":"cloze|sentence_make|mini_dialogue","prompt":"the question","answer":"reference answer"}',
    '',
    'JSON:',
  ].join('\n'),
} as const;

export const evaluationPrompt = {
  version: 'evaluate-v1',
  build: (question: string, reference: string, answer: string) => [
    "Evaluate whether the learner's answer is correct and give short feedback in Chinese.",
    'Judge the answer against the exercise and its reference answer; accept any wording that is',
    'equally correct English, not only a literal match.',
    'Output STRICT JSON only:',
    '{"correct": true or false, "feedback":"feedback in Chinese"}',
    '',
    'Exercise:',
    question,
    '',
    'Reference answer:',
    reference,
    '',
    'Learner answer:',
    answer,
    '',
    'JSON:',
  ].join('\n'),
} as const;
