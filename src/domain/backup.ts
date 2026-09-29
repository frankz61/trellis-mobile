import { isRecord } from './model-json';

export const backupFormat = 'trellis-backup';
export const backupVersion = 1;

// Learning data only: settings (which reference the API key) and transient tasks stay out.
export const backupTables = [
  'profiles', 'sessions', 'messages', 'words', 'grammar_points', 'word_relations', 'word_evidence',
  'mistakes', 'mistake_grammar_links', 'word_mastery', 'grammar_mastery', 'daily_plans', 'exercises', 'review_attempts',
] as const;
export type BackupTable = (typeof backupTables)[number];

export type BackupRow = Record<string, string | number | null>;

export interface BackupPackage {
  format: typeof backupFormat;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  app: string;
  tables: Record<BackupTable, BackupRow[]>;
}

export function backupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `trellis-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

// Structural check only; row-level constraints are enforced by SQLite during restore.
export function parseBackup(payload: unknown, currentSchemaVersion: number): BackupPackage {
  if (!isRecord(payload) || payload.format !== backupFormat) throw new Error('这不是 Trellis 的备份文件。');
  if (typeof payload.version !== 'number' || payload.version > backupVersion) throw new Error('备份文件由更新版本创建，请升级 App 后再恢复。');
  if (typeof payload.schemaVersion !== 'number' || payload.schemaVersion > currentSchemaVersion) {
    throw new Error('备份文件由更新版本创建，请升级 App 后再恢复。');
  }
  if (!isRecord(payload.tables)) throw new Error('备份文件缺少数据表。');
  const tables = {} as Record<BackupTable, BackupRow[]>;
  for (const name of backupTables) {
    const rows = payload.tables[name] ?? [];
    if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) throw new Error(`备份文件中的 ${name} 数据格式不正确。`);
    tables[name] = rows as BackupRow[];
  }
  return {
    format: backupFormat, version: payload.version, schemaVersion: payload.schemaVersion,
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : '', app: typeof payload.app === 'string' ? payload.app : '', tables,
  };
}
