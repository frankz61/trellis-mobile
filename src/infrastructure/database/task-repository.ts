import type { PersistedTask, TaskRepository } from '../../repositories/contracts';
import type { Database } from './database';

const columns = 'id, kind, dedupe_key AS dedupeKey, payload, status, attempts, next_run_at AS nextRunAt';

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: Database) {}

  async enqueue(task: Omit<PersistedTask, 'status' | 'attempts' | 'nextRunAt'>, now: string) {
    const existing = await this.database.getFirstAsync<{ id: string }>('SELECT id FROM tasks WHERE dedupe_key = ?', task.dedupeKey);
    if (existing) return false;
    await this.database.runAsync(
      `INSERT INTO tasks (id, kind, dedupe_key, payload, status, attempts, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`, task.id, task.kind, task.dedupeKey, task.payload, now, now,
    );
    return true;
  }

  async claimNext(now: string) {
    let claimed: PersistedTask | null = null;
    await this.database.withTransactionAsync(async () => {
      const task = await this.database.getFirstAsync<PersistedTask>(
        `SELECT ${columns} FROM tasks WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?)
         ORDER BY created_at LIMIT 1`, now,
      );
      if (!task) return;
      await this.database.runAsync("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?", now, task.id);
      claimed = { ...task, status: 'running' };
    });
    return claimed;
  }

  async finish(id: string, status: 'succeeded' | 'failed' | 'pending', attempts: number, nextRunAt: string | null, now: string) {
    await this.database.runAsync(
      'UPDATE tasks SET status = ?, attempts = ?, next_run_at = ?, updated_at = ? WHERE id = ?', status, attempts, nextRunAt, now, id,
    );
  }

  async recoverRunning(now: string) {
    const stuck = await this.database.getAllAsync<{ id: string }>("SELECT id FROM tasks WHERE status = 'running'");
    for (const task of stuck) {
      await this.database.runAsync("UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ?", now, task.id);
    }
    return stuck.length;
  }

  async pendingCount() {
    const row = await this.database.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending', 'running')");
    return row?.n ?? 0;
  }
}
