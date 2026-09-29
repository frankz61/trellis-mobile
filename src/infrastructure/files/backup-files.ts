import { Directory, File } from 'expo-file-system';
import type { BackupFiles } from '../../repositories/contracts';

function isCancellation(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message);
}

// System pickers only: the app never writes outside a folder the learner chose.
export const backupFiles: BackupFiles = {
  async save(fileName, json) {
    let directory: Directory;
    try {
      directory = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (isCancellation(error)) return null;
      throw new Error('无法打开文件夹选择器。');
    }
    const file = directory.createFile(fileName, 'application/json');
    file.write(json);
    return file.name || fileName;
  },

  async pick() {
    const result = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] });
    if (result.canceled) return null;
    return result.result.text();
  },
};
