import { backupFileName, backupFormat, backupVersion, parseBackup, type BackupPackage, type BackupTable } from '../domain/backup';
import type { BackupFiles, BackupRepository } from '../repositories/contracts';

export interface BackupDependencies {
  profileId: string;
  repository: BackupRepository;
  files: BackupFiles;
  schemaVersion: number;
  appVersion: string;
  now?: () => Date;
}

export interface RestoreSummary {
  exportedAt: string;
  sessions: number;
  words: number;
  mistakes: number;
}

export class BackupService {
  constructor(private readonly deps: BackupDependencies) {}

  async createPackage(): Promise<BackupPackage> {
    return {
      format: backupFormat,
      version: backupVersion,
      schemaVersion: this.deps.schemaVersion,
      exportedAt: (this.deps.now ?? (() => new Date()))().toISOString(),
      app: `trellis-mobile ${this.deps.appVersion}`,
      tables: await this.deps.repository.dump(),
    };
  }

  // Resolves with the saved file name, or null if the learner cancelled the picker.
  async exportToFile(): Promise<string | null> {
    const json = JSON.stringify(await this.createPackage());
    return this.deps.files.save(backupFileName((this.deps.now ?? (() => new Date()))()), json);
  }

  // Validates the whole file before touching the database; the repository swaps
  // the data in one transaction, so a rejected row leaves the current data intact.
  async restore(json: string): Promise<RestoreSummary> {
    let payload: unknown;
    try {
      payload = JSON.parse(json) as unknown;
    } catch {
      throw new Error('备份文件不是有效的 JSON。');
    }
    const backup = parseBackup(payload, this.deps.schemaVersion);
    const counts = await this.deps.repository.replace(backup.tables, this.deps.profileId);
    const count = (table: BackupTable) => counts[table] ?? 0;
    return { exportedAt: backup.exportedAt, sessions: count('sessions'), words: count('words'), mistakes: count('mistakes') };
  }

  // Resolves with null if the learner cancelled the picker.
  async restoreFromFile(): Promise<RestoreSummary | null> {
    const json = await this.deps.files.pick();
    return json === null ? null : this.restore(json);
  }
}
