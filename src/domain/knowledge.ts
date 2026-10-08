import { asString, isRecord } from './model-json';

// Mistake categories double as the grammar points a learner can be weak at.
export const mistakeTypes = [
  'tense', 'verb_form', 'subject_verb_agreement', 'noun_number', 'article', 'preposition',
  'word_choice', 'collocation', 'sentence_structure', 'spelling',
] as const;
export type MistakeType = (typeof mistakeTypes)[number];

export const grammarLabels: Record<MistakeType, string> = {
  tense: '时态',
  verb_form: '动词形式',
  noun_number: '单复数',
  article: '冠词',
  subject_verb_agreement: '主谓一致',
  preposition: '介词',
  word_choice: '用词',
  collocation: '搭配',
  sentence_structure: '句子结构',
  spelling: '拼写',
};

export function grammarLabel(name: string): string {
  return (grammarLabels as Record<string, string>)[name] ?? name;
}

// How grammar points are named inside English prompts; the Chinese labels are for the UI only.
const grammarNames: Record<MistakeType, string> = {
  tense: 'verb tense',
  verb_form: 'verb forms',
  noun_number: 'singular and plural nouns',
  article: 'articles (a / an / the)',
  subject_verb_agreement: 'subject-verb agreement',
  preposition: 'prepositions',
  word_choice: 'word choice',
  collocation: 'collocations',
  sentence_structure: 'sentence structure',
  spelling: 'spelling',
};

export function grammarName(name: string): string {
  return (grammarNames as Record<string, string>)[name] ?? name.replace(/_/g, ' ');
}

export interface ExtractedMistake {
  original: string;
  corrected: string;
  type: MistakeType;
  explanation: string;
}

export interface ExtractedWord {
  lemma: string;
  meaning: string;
}

export interface Extraction {
  mistakes: ExtractedMistake[];
  words: ExtractedWord[];
}

export const maxItemsPerExtraction = 10;
const maxTextLength = 300;

function isMistakeType(value: string): value is MistakeType {
  return (mistakeTypes as readonly string[]).includes(value);
}

// Accepts the model's JSON only after checking every field; malformed items are
// dropped rather than stored, and a malformed document is rejected outright.
export function parseExtraction(payload: unknown): Extraction | null {
  if (!isRecord(payload)) return null;
  const rawMistakes = Array.isArray(payload.mistakes) ? payload.mistakes : null;
  const rawWords = Array.isArray(payload.words) ? payload.words : null;
  if (!rawMistakes && !rawWords) return null;

  const mistakes: ExtractedMistake[] = [];
  for (const item of rawMistakes ?? []) {
    if (!isRecord(item)) continue;
    const original = asString(item.orig ?? item.original).slice(0, maxTextLength);
    const corrected = asString(item.fix ?? item.corrected).slice(0, maxTextLength);
    const type = asString(item.type).toLowerCase();
    if (!original || !corrected || original === corrected || !isMistakeType(type)) continue;
    mistakes.push({ original, corrected, type, explanation: asString(item.explanation).slice(0, maxTextLength) });
  }

  const words: ExtractedWord[] = [];
  const seen = new Set<string>();
  for (const item of rawWords ?? []) {
    if (!isRecord(item)) continue;
    const lemma = asString(item.lemma).toLowerCase();
    const meaning = asString(item.meaning_cn ?? item.meaning).slice(0, maxTextLength);
    if (!/^[a-z][a-z'-]*(?: [a-z'-]+){0,2}$/.test(lemma) || !meaning || seen.has(lemma)) continue;
    seen.add(lemma);
    words.push({ lemma, meaning });
  }

  return { mistakes: mistakes.slice(0, maxItemsPerExtraction), words: words.slice(0, maxItemsPerExtraction) };
}

// Stable per-message key so re-running an extraction never duplicates a mistake.
export function mistakeKey(mistake: ExtractedMistake): string {
  return `${mistake.type}:${mistake.original.toLowerCase().replace(/\s+/g, ' ')}`;
}
