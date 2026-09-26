import type { Storage } from '../src/lib/store/storage';

type LockableStorage = Storage & {
  refreshIndex(): void;
  withWriteLock<T>(action: () => Promise<T>): Promise<T>;
};

const managedName = (name: string) => /^(entry-|history-|commit-|idempotency-|import-batch-|import-receipt-)/.test(name);

export type MigrationResult = { total: number; existing: number; pending: number; dryRun: boolean };

export async function migrateDriveFiles(local: Storage, remote: LockableStorage, dryRun = false): Promise<MigrationResult> {
  const migrate = async (): Promise<MigrationResult> => {
    const names = (await local.list('')).filter(managedName).sort();
    const pending: { name: string; content: string }[] = [];
    let existingCount = 0;
    remote.refreshIndex();
    // Finish every conflict check before making the first write.
    for (const name of names) {
      const content = await local.read(name);
      if (content === null) throw new Error(`移行を中止しました。ローカルファイルを読み取れません: ${name}`);
      const existing = await remote.read(name);
      if (existing !== null && existing !== content) throw new Error(`移行を中止しました。Drive に異なる内容があります: ${name}`);
      if (existing === null) pending.push({ name, content });
      else existingCount++;
    }
    if (!dryRun) {
      for (const file of pending) {
        await remote.write(file.name, file.content);
        if (await remote.read(file.name) !== file.content) throw new Error(`保存確認に失敗しました: ${file.name}`);
      }
    }
    return { total: names.length, existing: existingCount, pending: pending.length, dryRun };
  };
  return dryRun ? migrate() : remote.withWriteLock(migrate);
}
