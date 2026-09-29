import type { GraphSnapshot } from '../../domain/graph';
import type { GraphRepository } from '../../repositories/contracts';
import type { Database } from './database';

// Messages belong to a learner through their session.
const ownMessage = 'JOIN messages msg ON msg.id = {col} JOIN sessions s ON s.id = msg.session_id AND s.profile_id = ?';
const own = (column: string) => ownMessage.replace('{col}', column);

export class SqliteGraphRepository implements GraphRepository {
  constructor(private readonly database: Database) {}

  async snapshot(profileId: string): Promise<GraphSnapshot> {
    const db = this.database;
    const [words, grammar, sentences, evidence, mistakes] = await Promise.all([
      db.getAllAsync<GraphSnapshot['words'][number]>(
        `SELECT w.id, w.lemma, w.meaning, COALESCE(m.level, 0) AS level FROM words w
         LEFT JOIN word_mastery m ON m.word_id = w.id AND m.profile_id = ?
         WHERE EXISTS (SELECT 1 FROM word_evidence e ${own('e.message_id')} WHERE e.word_id = w.id)
         ORDER BY w.lemma`,
        profileId, profileId,
      ),
      db.getAllAsync<GraphSnapshot['grammar'][number]>(
        `SELECT g.id, g.name, COALESCE(gm.weakness_count, 0) AS weakness FROM grammar_points g
         LEFT JOIN grammar_mastery gm ON gm.grammar_id = g.id AND gm.profile_id = ?
         WHERE EXISTS (SELECT 1 FROM mistake_grammar_links l JOIN mistakes mi ON mi.id = l.mistake_id ${own('mi.message_id')}
                       WHERE l.grammar_id = g.id)
         ORDER BY g.name`,
        profileId, profileId,
      ),
      db.getAllAsync<GraphSnapshot['sentences'][number]>(
        `SELECT msg.id, msg.content, msg.created_at AS createdAt FROM messages msg
         JOIN sessions s ON s.id = msg.session_id AND s.profile_id = ?
         WHERE EXISTS (SELECT 1 FROM word_evidence e WHERE e.message_id = msg.id)
            OR EXISTS (SELECT 1 FROM mistakes mi WHERE mi.message_id = msg.id)
         ORDER BY msg.created_at`,
        profileId,
      ),
      db.getAllAsync<GraphSnapshot['evidence'][number]>(
        `SELECT e.word_id AS wordId, e.message_id AS messageId FROM word_evidence e ${own('e.message_id')}`,
        profileId,
      ),
      db.getAllAsync<GraphSnapshot['mistakes'][number]>(
        `SELECT mi.id, l.grammar_id AS grammarId, mi.message_id AS messageId, mi.original, mi.corrected, mi.explanation
         FROM mistakes mi JOIN mistake_grammar_links l ON l.mistake_id = mi.id ${own('mi.message_id')}
         ORDER BY mi.rowid`,
        profileId,
      ),
    ]);
    const plain = <T extends object>(rows: T[]) => rows.map((row) => ({ ...row }));
    return {
      words: plain(words), grammar: plain(grammar), sentences: plain(sentences),
      evidence: plain(evidence), mistakes: plain(mistakes),
    };
  }
}
