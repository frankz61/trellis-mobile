import { grammarLabel, mistakeKey, type Extraction } from '../../domain/knowledge';
import { initialWordMastery, reviewLevelThreshold } from '../../domain/mastery';
import type { ReviewTarget } from '../../domain/practice';
import type { KnowledgeRepository, WeakPoints } from '../../repositories/contracts';
import type { Database } from './database';

export class SqliteKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly database: Database, private readonly createId: () => string) {}

  async applyExtraction(profileId: string, messageId: string, extraction: Extraction, now: string) {
    const db = this.database;
    const counts = { words: 0, mistakes: 0 };
    await db.withTransactionAsync(async () => {
      const mastery = initialWordMastery(new Date(now));
      for (const word of extraction.words) {
        let row = await db.getFirstAsync<{ id: string }>("SELECT id FROM words WHERE lemma = ? AND pos = ''", word.lemma);
        if (!row) {
          row = { id: this.createId() };
          await db.runAsync("INSERT INTO words (id, lemma, pos, meaning) VALUES (?, ?, '', ?)", row.id, word.lemma, word.meaning);
        }
        const seen = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM word_evidence WHERE word_id = ? AND message_id = ?', row.id, messageId,
        );
        if (seen) continue;
        await db.runAsync('INSERT INTO word_evidence (id, word_id, message_id) VALUES (?, ?, ?)', this.createId(), row.id, messageId);
        await db.runAsync(
          `INSERT OR IGNORE INTO word_mastery (profile_id, word_id, level, review_count, due_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`, profileId, row.id, mastery.level, mastery.reviewCount, mastery.dueAt, now,
        );
        counts.words += 1;
      }

      for (const mistake of extraction.mistakes) {
        const key = mistakeKey(mistake);
        const existing = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM mistakes WHERE message_id = ? AND item_key = ?', messageId, key,
        );
        if (existing) continue;
        const mistakeId = this.createId();
        await db.runAsync(
          'INSERT INTO mistakes (id, message_id, item_key, original, corrected, type, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)',
          mistakeId, messageId, key, mistake.original, mistake.corrected, mistake.type, mistake.explanation,
        );
        let grammar = await db.getFirstAsync<{ id: string }>('SELECT id FROM grammar_points WHERE name = ?', mistake.type);
        if (!grammar) {
          grammar = { id: this.createId() };
          await db.runAsync('INSERT INTO grammar_points (id, name) VALUES (?, ?)', grammar.id, mistake.type);
        }
        await db.runAsync('INSERT INTO mistake_grammar_links (mistake_id, grammar_id) VALUES (?, ?)', mistakeId, grammar.id);
        await db.runAsync(
          `INSERT INTO grammar_mastery (profile_id, grammar_id, weakness_count, due_at, updated_at) VALUES (?, ?, 1, NULL, ?)
           ON CONFLICT(profile_id, grammar_id) DO UPDATE SET weakness_count = weakness_count + 1, updated_at = excluded.updated_at`,
          profileId, grammar.id, now,
        );
        counts.mistakes += 1;
      }
    });
    return counts;
  }

  async weakPoints(profileId: string): Promise<WeakPoints> {
    const [grammar, words] = await Promise.all([
      this.database.getAllAsync<{ id: string; name: string; count: number }>(
        `SELECT g.id, g.name, gm.weakness_count AS count FROM grammar_mastery gm
         JOIN grammar_points g ON g.id = gm.grammar_id
         WHERE gm.profile_id = ? AND gm.weakness_count > 0 ORDER BY gm.weakness_count DESC, g.name LIMIT 5`, profileId,
      ),
      this.database.getAllAsync<{ id: string; lemma: string; level: number }>(
        `SELECT w.id, w.lemma, wm.level FROM word_mastery wm JOIN words w ON w.id = wm.word_id
         WHERE wm.profile_id = ? AND wm.level < ? ORDER BY wm.level, wm.due_at, w.lemma LIMIT 5`, profileId, reviewLevelThreshold,
      ),
    ]);
    return { grammar, words };
  }

  async dueTargets(profileId: string, now: string, limits: { words: number; grammar: number }): Promise<ReviewTarget[]> {
    const [grammar, words] = await Promise.all([
      this.database.getAllAsync<{ id: string; name: string; count: number }>(
        `SELECT g.id, g.name, gm.weakness_count AS count FROM grammar_mastery gm
         JOIN grammar_points g ON g.id = gm.grammar_id
         WHERE gm.profile_id = ? AND gm.weakness_count > 0 ORDER BY gm.weakness_count DESC, g.name LIMIT ?`, profileId, limits.grammar,
      ),
      this.database.getAllAsync<{ id: string; lemma: string; level: number }>(
        `SELECT w.id, w.lemma, wm.level FROM word_mastery wm JOIN words w ON w.id = wm.word_id
         WHERE wm.profile_id = ? AND wm.level < ? AND (wm.due_at IS NULL OR wm.due_at <= ?)
         ORDER BY wm.level, wm.due_at, w.lemma LIMIT ?`, profileId, reviewLevelThreshold, now, limits.words,
      ),
    ]);
    return [
      ...grammar.map((g): ReviewTarget => ({ type: 'grammar', id: g.id, label: grammarLabel(g.name), weight: g.count })),
      ...words.map((w): ReviewTarget => ({ type: 'word', id: w.id, label: w.lemma, weight: reviewLevelThreshold - w.level })),
    ];
  }
}
