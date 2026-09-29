// The subset of expo-sqlite's SQLiteDatabase the repositories need; tests supply a node:sqlite adapter.
export type BindValue = string | number | null;

export interface Database {
  runAsync(sql: string, ...params: BindValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: BindValue[]): Promise<T | null>;
  // Runs `task` inside BEGIN/COMMIT and rolls back if it throws.
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
