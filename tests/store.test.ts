import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createEntry, deleteEntry, exportArchive, exportMarkdown, getEntry, getHistory, listEntries, restoreEntry, setStorageForTests, StoreError, updateEntry } from '../src/lib/entries';
import { DriveStorage, LocalStorage } from '../src/lib/store/storage';

test('Markdown persistence, history, optimistic revisions, idempotency, trash and safe paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-store-'));
  const previousSeed = process.env.ODIN_SEED_EXAMPLES;
  process.env.ODIN_SEED_EXAMPLES = '0';
  try {
    setStorageForTests(new LocalStorage(directory));
    const input = { title: 'Coffee plan', kind: 'task' as const, body: 'Buy **beans**', tags: ['today'] };
    const created = await createEntry(input, 'retry-key');
    assert.equal((await createEntry(input, 'retry-key')).id, created.id);
    await assert.rejects(() => createEntry({ ...input, title: 'Different' }, 'retry-key'), (error: unknown) => error instanceof StoreError && error.status === 409);
    const disk = await readFile(join(directory, `entry-${created.id}.md`), 'utf8');
    assert.match(disk, /Buy \*\*beans\*\*/);
    assert.equal((await getEntry(created.id))?.title, 'Coffee plan');
    const changed = await updateEntry(created.id, { status: 'done', dueAt: '2026-09-24T18:00:00+09:00', source: 'manual' }, 1);
    assert.equal(changed.revision, 2);
    await assert.rejects(() => updateEntry(created.id, { title: 'Stale' }, 1), (error: unknown) => error instanceof StoreError && error.code === 'REVISION_CONFLICT');
    const cleared = await updateEntry(created.id, { dueAt: null, source: null }, 2);
    assert.equal(cleared.dueAt, undefined);
    assert.equal(cleared.source, undefined);
    const deleted = await deleteEntry(created.id, 3);
    assert.equal((await listEntries()).length, 0);
    assert.equal((await listEntries({ deleted: true })).length, 1);
    const restored = await restoreEntry(created.id, deleted.revision);
    assert.equal(restored.deletedAt, undefined);
    assert.equal((await getHistory(created.id)).length, 5);
    const archive = unzipSync(await exportArchive());
    assert.match(strFromU8(archive['manifest.json']), /odin-markdown-v1/);
    assert.ok(archive[`entries/entry-${created.id}.md`]);
    assert.equal(Object.keys(archive).filter((name) => name.startsWith('history/')).length, 5);
    await assert.rejects(() => getEntry('../outside'), (error: unknown) => error instanceof StoreError && error.code === 'INVALID_ID');
    const corruptId = '11111111-1111-4111-8111-111111111111';
    await new LocalStorage(directory).write(`entry-${corruptId}.md`, '---\ntitle: Broken\n---\nMissing metadata');
    await assert.rejects(() => getEntry(corruptId), (error: unknown) => error instanceof StoreError && error.code === 'CORRUPT_ENTRY');
  } finally {
    if (previousSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = previousSeed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('retry after an interrupted save reuses the reserved ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-retry-'));
  const previousSeed = process.env.ODIN_SEED_EXAMPLES;
  process.env.ODIN_SEED_EXAMPLES = '0';
  class InterruptedStorage extends LocalStorage {
    once = true;
    override async write(name: string, content: string) {
      if (this.once && name.startsWith('history-')) { this.once = false; throw new Error('interrupted'); }
      return super.write(name, content);
    }
  }
  try {
    setStorageForTests(new InterruptedStorage(directory));
    const input = { title: 'Retry', kind: 'memo' as const, body: '', tags: [] };
    await assert.rejects(() => createEntry(input, 'interrupted-key'));
    const entry = await createEntry(input, 'interrupted-key');
    assert.equal((await listEntries()).length, 1);
    assert.equal((await createEntry(input, 'interrupted-key')).id, entry.id);
  } finally {
    if (previousSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = previousSeed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('an interrupted update keeps attempted history in recovery only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-recovery-'));
  const previousSeed = process.env.ODIN_SEED_EXAMPLES;
  process.env.ODIN_SEED_EXAMPLES = '0';
  class FailedCurrentWrite extends LocalStorage {
    fail = false;
    override async write(name: string, content: string) {
      if (this.fail && name.startsWith('entry-')) { this.fail = false; throw new Error('interrupted before commit'); }
      return super.write(name, content);
    }
  }
  const vault = new FailedCurrentWrite(directory);
  try {
    setStorageForTests(vault);
    const entry = await createEntry({ title: 'Stable', kind: 'memo', body: '', tags: [] });
    vault.fail = true;
    await assert.rejects(() => updateEntry(entry.id, { title: 'Uncommitted' }, 1));
    assert.equal((await getEntry(entry.id))?.title, 'Stable');
    assert.deepEqual((await getHistory(entry.id)).map((item) => item.entry.title), ['Stable']);
    const archive = unzipSync(await exportArchive());
    assert.equal(Object.keys(archive).filter((name) => name.startsWith('history/')).length, 1);
    assert.equal(Object.keys(archive).filter((name) => name.startsWith('recovery/')).length, 1);
  } finally {
    if (previousSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = previousSeed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('large reads use a bounded worker pool and Markdown export reads each entry once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-batched-'));
  const previousSeed = process.env.ODIN_SEED_EXAMPLES;
  process.env.ODIN_SEED_EXAMPLES = '0';
  class CountingStorage extends LocalStorage {
    reads = 0;
    active = 0;
    maxActive = 0;
    slowName?: string;
    slowDone = false;
    startedWhileSlow = false;
    override async read(name: string) {
      this.reads++;
      this.active++;
      this.maxActive = Math.max(this.maxActive, this.active);
      if (this.reads > 16 && !this.slowDone) this.startedWhileSlow = true;
      try {
        await new Promise((resolve) => setTimeout(resolve, name === this.slowName ? 40 : 2));
        return await super.read(name);
      } finally { this.active--; if (name === this.slowName) this.slowDone = true; }
    }
  }
  const vault = new CountingStorage(directory);
  try {
    setStorageForTests(vault);
    const entries = [];
    for (let index = 0; index < 20; index++) entries.push(await createEntry({ title: `Entry ${index}`, kind: 'memo', body: '', tags: [] }));
    vault.slowName = (await vault.list('entry-'))[0];
    vault.reads = 0;
    assert.equal((await listEntries()).length, 20);
    assert.equal(vault.reads, 20);
    assert.equal(vault.maxActive, 16);
    assert.equal(vault.startedWhileSlow, true);
    vault.reads = 0;
    assert.equal((await exportMarkdown()).match(/<!-- [\da-f-]{36}\.md -->/g)?.length, 20);
    assert.equal(vault.reads, 20);
    let revision = 1;
    for (let index = 0; index < 15; index++) revision = (await updateEntry(entries[0].id, { title: `Revision ${index}` }, revision)).revision;
    vault.maxActive = 0;
    assert.equal((await getHistory(entries[0].id)).length, 16);
    assert.ok(vault.maxActive <= 16);
    vault.reads = 0;
    vault.maxActive = 0;
    const archive = unzipSync(await exportArchive());
    assert.equal(Object.keys(archive).filter((name) => name.startsWith('history/')).length, 35);
    assert.equal(vault.reads, 55);
    assert.ok(vault.maxActive <= 16);
  } finally {
    if (previousSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = previousSeed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Drive adapter refreshes token, creates, reads and updates files, and rejects malformed listings', async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID'] as const;
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) process.env[key] = key;
  const files = new Map<string, { id: string; content: string }>();
  for (const [name, content] of Object.entries({ 'entry-existing.md': 'entry', 'history-existing.md': 'history', 'commit-existing.json': 'commit', 'idempotency-existing.json': 'idempotency' })) files.set(name, { id: `pre-${name}`, content });
  let tokens = 0;
  let folderListings = 0;
  let malformed = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: `token-${++tokens}`, expires_in: 0 });
    if (url.includes('uploadType=multipart')) {
      const body = String(init?.body);
      const name = JSON.parse(body.match(/\{"name"[^\r]+\}/)?.[0] ?? '{}').name as string;
      const content = body.split('\r\n\r\n')[2]?.split('\r\n--odin-')[0] ?? '';
      files.set(name, { id: `file-${files.size + 1}`, content });
      return Response.json({ id: `file-${files.size}` });
    }
    if (url.includes('/drive/v3/files?')) {
      folderListings++;
      if (malformed) return Response.json({ files: [{ name: 'bad' }] });
      return Response.json({ files: [...files].map(([name, file]) => ({ name, id: file.id })) });
    }
    if (url.includes('uploadType=media')) {
      const id = /files\/([^?]+)/.exec(url)?.[1];
      const file = [...files.values()].find((item) => item.id === id);
      if (!file) return new Response(null, { status: 404 });
      file.content = String(init?.body);
      return Response.json({ id });
    }
    if (url.includes('alt=media')) {
      const id = /files\/([^?]+)/.exec(url)?.[1];
      const file = [...files.values()].find((item) => item.id === id);
      return file ? new Response(file.content) : new Response(null, { status: 404 });
    }
    return Response.json({ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } });
  };
  try {
    const drive = new DriveStorage();
    assert.equal(await drive.read('entry-existing.md'), 'entry');
    assert.equal(await drive.read('history-existing.md'), 'history');
    assert.equal(await drive.read('commit-existing.json'), 'commit');
    assert.equal(await drive.read('idempotency-existing.json'), 'idempotency');
    assert.equal(folderListings, 1);
    await drive.write('entry-test.md', 'first');
    assert.equal(await drive.read('entry-test.md'), 'first');
    await drive.write('entry-test.md', 'second');
    assert.equal(await drive.read('entry-test.md'), 'second');
    assert.ok(tokens >= 4);
    assert.equal((await drive.status()).writable, true);
    malformed = true;
    drive.refreshIndex();
    await assert.rejects(() => drive.list('entry-'), /listing is invalid/);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of envKeys) { const value = oldEnv[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('concurrent Drive reads share token and listing requests', async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID'] as const;
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) process.env[key] = key;
  let tokens = 0;
  let listings = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) {
      tokens++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      return Response.json({ access_token: 'token', expires_in: 3600 });
    }
    if (url.includes('/drive/v3/files?')) {
      listings++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      return Response.json({ files: [{ name: 'entry-test.md', id: 'file-1' }] });
    }
    if (url.includes('alt=media')) return new Response('entry');
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const drive = new DriveStorage();
    assert.deepEqual(await Promise.all(Array.from({ length: 12 }, () => drive.read('entry-test.md'))), Array(12).fill('entry'));
    assert.equal(tokens, 1);
    assert.equal(listings, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of envKeys) { const value = oldEnv[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('an invalidated Drive listing cannot overwrite a newer index', async () => {
  const oldFetch = globalThis.fetch;
  const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID'] as const;
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) process.env[key] = key;
  let listings = 0;
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let oldStarted!: () => void;
  const started = new Promise<void>((resolve) => { oldStarted = resolve; });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'token', expires_in: 3600 });
    if (url.includes('/drive/v3/files?')) {
      listings++;
      if (listings === 1) { oldStarted(); await oldGate; return Response.json({ files: [{ name: 'entry-old.md', id: 'old' }] }); }
      return Response.json({ files: [{ name: 'entry-new.md', id: 'new' }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const drive = new DriveStorage();
    const old = drive.list('entry-');
    await started;
    drive.refreshIndex();
    assert.deepEqual(await drive.list('entry-'), ['entry-new.md']);
    releaseOld();
    assert.deepEqual(await old, ['entry-old.md']);
    assert.deepEqual(await drive.list('entry-'), ['entry-new.md']);
    assert.equal(listings, 2);
  } finally {
    releaseOld();
    globalThis.fetch = oldFetch;
    for (const key of envKeys) { const value = oldEnv[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('Vercel Drive fails closed without Redis lock and rejects competing writers', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['VERCEL', 'ODIN_LOCK_REDIS_URL', 'ODIN_LOCK_REDIS_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VERCEL = '1';
  process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
  delete process.env.ODIN_LOCK_REDIS_URL;
  delete process.env.ODIN_LOCK_REDIS_TOKEN;
  const first = new DriveStorage();
  try {
    await assert.rejects(() => first.withWriteLock(async () => 1), /require ODIN_LOCK_REDIS_URL/);
    await assert.rejects(() => first.write('entry-test.md', 'x'), /lease is required/);
    process.env.ODIN_LOCK_REDIS_URL = 'https://redis.example.com';
    process.env.ODIN_LOCK_REDIS_TOKEN = 'test-token';
    let held: string | null = null;
    let uploads = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test', expires_in: 3600 });
      if (url.includes('/drive/v3/files?')) return Response.json({ files: [] });
      if (url.includes('uploadType=')) { uploads++; return Response.json({ id: 'new-file' }); }
      const command = JSON.parse(String(init?.body)) as (string | number)[];
      if (command[0] === 'SET') {
        if (held) return Response.json({ result: null });
        held = String(command[2]);
        return Response.json({ result: 'OK' });
      }
      if (command[0] === 'EVAL') {
        const owns = held === command[4];
        if (String(command[1]).includes('DEL') && owns) held = null;
        return Response.json({ result: owns ? 1 : 0 });
      }
      return Response.json({ error: 'unexpected command' });
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writes: string[] = [];
    const active = first.withWriteLock(async () => { writes.push('first-start'); await gate; writes.push('first-end'); return 'first'; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = new DriveStorage();
    await assert.rejects(() => second.withWriteLock(async () => { writes.push('overlap'); return 'second'; }), /Another Odin writer/);
    release();
    assert.equal(await active, 'first');
    assert.equal(await second.withWriteLock(async () => { writes.push('second'); return 'second'; }), 'second');
    assert.deepEqual(writes, ['first-start', 'first-end', 'second']);
    await assert.rejects(() => second.withWriteLock(async () => { held = null; await second.write('entry-lost.md', 'x'); }), /lease was lost/);
    assert.equal(uploads, 0);
    assert.equal(held, null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
