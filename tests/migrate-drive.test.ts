import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { migrateDriveFiles } from '../scripts/migrate-drive-files';
import { LocalStorage, type Storage } from '../src/lib/store/storage';

class MockDrive implements Storage {
  files = new Map<string, string>();
  writes: string[] = [];
  locks = 0;
  corruptReadback = false;
  refreshIndex() {}
  async withWriteLock<T>(action: () => Promise<T>): Promise<T> { this.locks++; return action(); }
  async read(name: string) { return this.corruptReadback && this.writes.includes(name) ? 'corrupt' : this.files.get(name) ?? null; }
  async write(name: string, content: string) { this.writes.push(name); this.files.set(name, content); }
  async list(prefix: string) { return [...this.files.keys()].filter((name) => name.startsWith(prefix)); }
  async status() { return { provider: 'drive' as const, connected: true, writable: true, message: 'mock' }; }
}

test('migration includes import batches and receipts, and dry run never writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-migrate-'));
  try {
    const local = new LocalStorage(directory);
    const remote = new MockDrive();
    const contents = {
      'entry-one.md': 'entry', 'history-one.md': 'history', 'commit-one.json': 'commit',
      'idempotency-one.json': 'idempotency', 'import-batch-one.json': 'batch',
      'import-receipt-one.json': 'receipt', 'unrelated.txt': 'ignore',
    };
    for (const [name, content] of Object.entries(contents)) await local.write(name, content);
    remote.files.set('entry-one.md', 'entry');
    assert.deepEqual(await migrateDriveFiles(local, remote, true), { total: 6, existing: 1, pending: 5, dryRun: true });
    assert.equal(remote.locks, 0);
    assert.deepEqual(remote.writes, []);
    assert.deepEqual(await migrateDriveFiles(local, remote), { total: 6, existing: 1, pending: 5, dryRun: false });
    assert.equal(remote.locks, 1);
    assert.deepEqual(remote.writes, ['commit-one.json', 'history-one.md', 'idempotency-one.json', 'import-batch-one.json', 'import-receipt-one.json']);
    assert.equal(remote.files.has('unrelated.txt'), false);
    for (const [name, content] of Object.entries(contents)) assert.equal(await local.read(name), content);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migration checks every conflict before writing and preserves existing remote content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-migrate-conflict-'));
  try {
    const local = new LocalStorage(directory);
    const remote = new MockDrive();
    await local.write('entry-first.md', 'new');
    await local.write('import-receipt-last.json', 'local');
    remote.files.set('import-receipt-last.json', 'remote');
    await assert.rejects(() => migrateDriveFiles(local, remote), /Drive に異なる内容があります: import-receipt-last.json/);
    assert.deepEqual(remote.writes, []);
    assert.equal(remote.files.get('import-receipt-last.json'), 'remote');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migration verifies readback of each created file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-migrate-readback-'));
  try {
    const local = new LocalStorage(directory);
    const remote = new MockDrive();
    await local.write('import-batch-one.json', 'batch');
    remote.corruptReadback = true;
    await assert.rejects(() => migrateDriveFiles(local, remote), /保存確認に失敗しました: import-batch-one.json/);
    assert.deepEqual(remote.writes, ['import-batch-one.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
