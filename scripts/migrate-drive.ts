/** Explicit, non-destructive local -> Drive migration. Existing different remote files block overwrite. */
import { LocalStorage, DriveStorage } from '../src/lib/store/storage';
import { migrateDriveFiles } from './migrate-drive-files';
try { process.loadEnvFile('.env.local'); } catch { /* can use supplied environment */ }
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run') || args.length > 1) throw new Error('使い方: npm run migrate:drive -- [--dry-run]');
  const dryRun = args[0] === '--dry-run';
  const local = new LocalStorage(process.env.ODIN_VAULT_DIR);
  const remote = new DriveStorage();
  const status = await remote.status();
  if (!(dryRun ? status.connected : status.writable)) throw new Error(status.message);
  const result = await migrateDriveFiles(local, remote, dryRun);
  if (dryRun) console.log(`Dry run: 対象 ${result.total} 件、Drive と同一 ${result.existing} 件、追加予定 ${result.pending} 件。ファイルは変更していません。`);
  else console.log(`${result.pending} ファイルを Drive に保存・確認しました（対象 ${result.total} 件、既存同一 ${result.existing} 件）。元のローカルファイルは保持しています。`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
