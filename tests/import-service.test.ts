import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getEntry, setStorageForTests, StoreError, updateEntry } from '../src/lib/entries';
import { addImportCandidates, commitImportCandidates, createImportBatch, editImportCandidate, generateExtractCandidates, getImportBatch, getImportPacket, listImportBatches, purgeImportSource, updateImportSelection } from '../src/lib/imports/service';
import { LocalStorage } from '../src/lib/store/storage';
import type { ConversationMessage } from '../src/lib/types';

const message: ConversationMessage = { id: 'm1', conversationId: 'c1', conversationTitle: '大切な会話', provider: 'chatgpt', account: 'personal', role: 'user', text: '2026年の計画では、毎週日曜日にレビューする。', timestamp: '2026-09-24T00:00:00.000Z', sourceFile: 'export.json', hash: 'abc123' };
const input = { title: '週次レビュー', body: '毎週日曜日にレビューする。', kind: 'knowledge' as const, tags: ['習慣'], evidence: [{ messageId: 'm1', quote: '毎週日曜日にレビューする。' }] };

test('empty provider selection differs from all providers and uncertainty notes survive save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-scope-'));
  try {
    setStorageForTests(new LocalStorage(directory));
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await updateImportSelection(batch.id, { providers: [] }, batch.revision);
    assert.deepEqual(batch.selection.providers, []);
    const packet = await getImportPacket(batch.id) as { messages: unknown[] };
    assert.equal(packet.messages.length, 0);
    batch = await updateImportSelection(batch.id, {}, batch.revision);
    batch = await addImportCandidates(batch.id, [{ ...input, note: '実施状況は未確認。' }], batch.revision);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.match((await getEntry(batch.candidates[0].savedEntryId!))!.body, /確認メモ\n実施状況は未確認/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('import stages source, validates evidence, saves through Markdown, and deduplicates across batches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-'));
  const oldSeed = process.env.ODIN_SEED_EXAMPLES;
  process.env.ODIN_SEED_EXAMPLES = '0';
  try {
    setStorageForTests(new LocalStorage(directory));
    const first = await createImportBatch({ messages: [message], warnings: [], files: 1 }, 'Test');
    assert.equal((await listImportBatches())[0].messageCount, 1);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 0);
    await assert.rejects(() => addImportCandidates(first.id, [{ ...input, evidence: [{ messageId: 'fake', quote: 'fake' }] }], first.revision), (error: unknown) => error instanceof StoreError && error.code === 'INVALID_EVIDENCE');
    let batch = await updateImportSelection(first.id, { from: '2026-09-24', to: '2026-09-24' }, first.revision);
    batch = await addImportCandidates(first.id, [input], batch.revision);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 0);
    const packet = await getImportPacket(first.id) as { messages: ConversationMessage[]; candidateSchema: unknown };
    assert.equal(packet.messages.length, 1);
    assert.ok(packet.candidateSchema);
    batch = await commitImportCandidates(first.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'saved');
    const entry = await getEntry(batch.candidates[0].savedEntryId!);
    assert.match(entry!.body, /出典（会話履歴から承認して保存）/);
    assert.match(entry!.body, /毎週日曜日にレビューする。/);
    assert.match(entry!.body, /2026-09-24T00:00:00.000Z/);
    const second = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    let repeated = await addImportCandidates(second.id, [input], second.revision);
    repeated = await commitImportCandidates(second.id, [repeated.candidates[0].id], repeated.revision);
    assert.equal(repeated.candidates[0].savedEntryId, entry!.id);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 1);
    batch = await purgeImportSource(first.id, batch.revision);
    assert.equal(batch.messages.length, 0);
    assert.equal((await getEntry(entry!.id))?.body, entry!.body);
  } finally {
    if (oldSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = oldSeed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('update uses explicit target revision and preserves conflicting candidate for review', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-update-'));
  const oldSeed = process.env.ODIN_SEED_EXAMPLES;
  process.env.ODIN_SEED_EXAMPLES = '0';
  try {
    setStorageForTests(new LocalStorage(directory));
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await generateExtractCandidates(batch.id, batch.revision);
    const extracted = batch.candidates[0];
    batch = await editImportCandidate(batch.id, extracted.id, input, batch.revision);
    batch = await commitImportCandidates(batch.id, [extracted.id], batch.revision);
    const target = await getEntry(batch.candidates[0].savedEntryId!);
    const newer = await updateEntry(target!.id, { title: '手動変更' }, target!.revision);
    let second = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    second = await addImportCandidates(second.id, [{ ...input, body: '追加で振り返りの時間を確保する。', action: 'update', targetId: newer.id, expectedRevision: target!.revision }], second.revision);
    second = await commitImportCandidates(second.id, [second.candidates[0].id], second.revision);
    assert.equal(second.candidates[0].state, 'failed');
    assert.match(second.candidates[0].error!, /変更されました/);
    assert.equal((await getEntry(newer.id))?.body, newer.body);
    assert.equal((await getImportBatch(second.id)).revision, second.revision);
  } finally {
    if (oldSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = oldSeed;
    await rm(directory, { recursive: true, force: true });
  }
});

test('selection rejects impossible dates, excludes evidence outside range, and enforces batch revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-select-'));
  try {
    setStorageForTests(new LocalStorage(directory));
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    await assert.rejects(() => updateImportSelection(batch.id, { from: '2026-02-30' }, batch.revision), (error: unknown) => error instanceof StoreError && error.status === 400);
    batch = await updateImportSelection(batch.id, { from: '2026-09-25' }, batch.revision);
    await assert.rejects(() => addImportCandidates(batch.id, [input], batch.revision), (error: unknown) => error instanceof StoreError && error.code === 'INVALID_EVIDENCE');
    await assert.rejects(() => updateImportSelection(batch.id, {}, batch.revision - 1), (error: unknown) => error instanceof StoreError && error.code === 'REVISION_CONFLICT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('repeated packet download and equivalent selection preserve staged candidates and revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-noop-'));
  try {
    setStorageForTests(new LocalStorage(directory));
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await updateImportSelection(batch.id, { providers: ['chatgpt'], includeUndated: false }, batch.revision);
    const beforePacket = await getImportPacket(batch.id) as { revision: number };
    batch = await addImportCandidates(batch.id, [input], beforePacket.revision);
    const pendingId = batch.candidates[0].id;
    await getImportPacket(batch.id);
    const same = await updateImportSelection(batch.id, { providers: ['chatgpt'] }, batch.revision);
    assert.equal(same.revision, batch.revision);
    assert.equal(same.candidates[0].id, pendingId);
    assert.equal((await getImportBatch(batch.id)).candidates[0].id, pendingId);
    const changed = await updateImportSelection(batch.id, { from: '2026-09-25', providers: ['chatgpt'] }, same.revision);
    assert.equal(changed.candidates.length, 0);
    assert.equal(changed.status, 'ready');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('extract includes every message in numbered chunks and separates providers and accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-chunks-'));
  try {
    setStorageForTests(new LocalStorage(directory));
    const messages = Array.from({ length: 45 }, (_, index) => ({ ...message, id: `m${index}`, hash: `hash${index}`, text: `発言${index}`, conversationId: 'same' }));
    messages.push({ ...message, id: 'other', hash: 'other', text: '他アカウントの発言', account: 'other', conversationId: 'same' });
    messages.push({ ...message, id: 'other-provider', hash: 'other-provider', text: '他提供元の発言', provider: 'claude', conversationId: 'same' });
    let batch = await createImportBatch({ messages, warnings: [], files: 1 });
    batch = await generateExtractCandidates(batch.id, batch.revision);
    assert.equal(batch.candidates.length, 5);
    assert.deepEqual(batch.candidates.slice(0, 3).map((candidate) => candidate.evidence.length), [20, 20, 5]);
    assert.match(batch.candidates[2].title, /3\/3/);
    assert.match(batch.candidates[2].body, /発言44/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('receipt failure after Markdown save recovers without duplicate and preserves later edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-receipt-'));
  class FailingReceipt extends LocalStorage {
    failReceipt = true;
    override async write(name: string, content: string) {
      if (this.failReceipt && name.startsWith('import-receipt-')) { this.failReceipt = false; throw new Error('network cut after entry save'); }
      return super.write(name, content);
    }
  }
  const storage = new FailingReceipt(directory);
  try {
    setStorageForTests(storage);
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await addImportCandidates(batch.id, [input], batch.revision);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'failed');
    const entryName = (await readdir(directory)).find((name) => name.startsWith('entry-'))!;
    const id = entryName.slice(6, -3);
    const edited = await updateEntry(id, { title: '後日の手動変更' }, 1);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'saved');
    assert.equal(batch.candidates[0].savedEntryId, id);
    assert.equal((await getEntry(id))?.title, edited.title);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('一括保存は既存記録を一度だけ読み、同一操作中のレシート失敗から重複なく回復する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-bulk-'));
  class CountingStorage extends LocalStorage {
    entryLists = 0;
    failReceipt = true;
    override async list(prefix = '') {
      if (prefix === 'entry-') this.entryLists++;
      return super.list(prefix);
    }
    override async write(name: string, content: string) {
      if (this.failReceipt && name.startsWith('import-receipt-')) {
        this.failReceipt = false;
        throw new Error('receipt unavailable');
      }
      return super.write(name, content);
    }
  }
  const storage = new CountingStorage(directory);
  try {
    setStorageForTests(storage);
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await addImportCandidates(batch.id, [input, input, { ...input, title: '別の知識', body: '別の振り返り。' }], batch.revision);
    storage.entryLists = 0;
    batch = await commitImportCandidates(batch.id, batch.candidates.map((candidate) => candidate.id), batch.revision);
    assert.equal(storage.entryLists, 1);
    assert.deepEqual(batch.candidates.map((candidate) => candidate.state), ['failed', 'saved', 'saved']);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 2);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].savedEntryId, batch.candidates[1].savedEntryId);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed history write leaves a retryable candidate and evidence order does not duplicate another batch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-history-'));
  class FailingHistory extends LocalStorage {
    fail = true;
    override async write(name: string, content: string) {
      if (this.fail && name.startsWith('history-')) { this.fail = false; throw new Error('history unavailable'); }
      return super.write(name, content);
    }
  }
  try {
    setStorageForTests(new FailingHistory(directory));
    const messages = [message, { ...message, id: 'm2', hash: 'second', text: '二つ目の根拠。' }];
    const candidate = { ...input, evidence: [{ messageId: 'm1', quote: input.evidence[0].quote }, { messageId: 'm2', quote: '二つ目の根拠。' }] };
    let batch = await createImportBatch({ messages, warnings: [], files: 1 });
    batch = await addImportCandidates(batch.id, [candidate], batch.revision);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'failed');
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'saved');
    let repeated = await createImportBatch({ messages, warnings: [], files: 1 });
    repeated = await addImportCandidates(repeated.id, [{ ...candidate, evidence: [...candidate.evidence].reverse() }], repeated.revision);
    repeated = await commitImportCandidates(repeated.id, [repeated.candidates[0].id], repeated.revision);
    assert.equal(repeated.candidates[0].savedEntryId, batch.candidates[0].savedEntryId);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed current entry write leaves recovery history and succeeds on retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-current-'));
  class FailingEntry extends LocalStorage {
    fail = true;
    override async write(name: string, content: string) {
      if (this.fail && name.startsWith('entry-')) { this.fail = false; throw new Error('current entry unavailable'); }
      return super.write(name, content);
    }
  }
  try {
    setStorageForTests(new FailingEntry(directory));
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await addImportCandidates(batch.id, [input], batch.revision);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'failed');
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('history-')).length, 1);
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 0);
    batch = await commitImportCandidates(batch.id, [batch.candidates[0].id], batch.revision);
    assert.equal(batch.candidates[0].state, 'saved');
    assert.equal((await readdir(directory)).filter((name) => name.startsWith('entry-')).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('purging source blocks new extraction and retains explicit guidance on pending candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'odin-import-purge-'));
  try {
    setStorageForTests(new LocalStorage(directory));
    let batch = await createImportBatch({ messages: [message], warnings: [], files: 1 });
    batch = await addImportCandidates(batch.id, [input], batch.revision);
    batch = await purgeImportSource(batch.id, batch.revision);
    assert.equal(batch.candidates[0].state, 'failed');
    assert.match(batch.candidates[0].error!, /再取込/);
    await assert.rejects(() => generateExtractCandidates(batch.id, batch.revision), (error: unknown) => error instanceof StoreError && error.code === 'SOURCE_PURGED');
    await assert.rejects(() => addImportCandidates(batch.id, [input], batch.revision), (error: unknown) => error instanceof StoreError && error.code === 'SOURCE_PURGED');
    await assert.rejects(() => updateImportSelection(batch.id, {}, batch.revision), (error: unknown) => error instanceof StoreError && error.code === 'SOURCE_PURGED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
