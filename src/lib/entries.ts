import { createHash, randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { parseSafeFrontmatter } from './safe-frontmatter';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { createStorage, DriveStorage, type Storage } from './store/storage';
import { entryKinds, type Entry, type EntryInput, type EntryKind, type EntryRevision } from './types';
import { entryMatchesQuery } from './search';

const fields = z.object({
  title: z.string().trim().min(1).max(200), kind: z.enum(entryKinds), body: z.string().max(500_000),
  tags: z.array(z.string().trim().min(1).max(60)).max(30), status: z.enum(['active', 'done', 'archived']).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(), projectId: z.string().uuid().optional(),
  relatedIds: z.array(z.string().uuid()).max(100).optional(), source: z.string().max(1000).optional(),
});
const inputSchema = fields.strict();
const patchSchema = fields.partial().extend({
  dueAt: fields.shape.dueAt.nullable(), projectId: fields.shape.projectId.nullable(),
  relatedIds: fields.shape.relatedIds.nullable(), source: fields.shape.source.nullable(),
}).strict();
const entrySchema = fields.extend({ id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string(), revision: z.number().int().positive(), deletedAt: z.string().optional(), isExample: z.boolean().optional() });
export type EntryPatch = Omit<Partial<EntryInput>, 'dueAt' | 'projectId' | 'relatedIds' | 'source'> & { dueAt?: string | null; projectId?: string | null; relatedIds?: string[] | null; source?: string | null };
export type ListOptions = { query?: string; kind?: EntryKind; deleted?: boolean | 'all' };
const readConcurrency = 16;

async function mapWithReadLimit<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && next < items.length) {
      const index = next++;
      try { results[index] = await read(items[index]); }
      catch (error) { stopped = true; throw error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(readConcurrency, items.length) }, () => worker()));
  return results;
}

export class StoreError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) { super(message); }
}

let storage: Storage = createStorage();
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action, action);
  queue = next.catch(() => undefined);
  return next;
}
function refreshDriveIndex() { if (storage instanceof DriveStorage) storage.refreshIndex(); }
export function mutation<T>(action: () => Promise<T>): Promise<T> {
  return serial(async () => {
    refreshDriveIndex();
    return storage instanceof DriveStorage ? storage.withWriteLock(action) : action();
  });
}
export function setStorageForTests(next: Storage) { storage = next; queue = Promise.resolve(); }
export function importStorage(): Storage { return storage; }

function assertId(id: string) { if (!z.string().uuid().safeParse(id).success) throw new StoreError('ID が正しくありません。', 400, 'INVALID_ID'); }
function filename(id: string) { assertId(id); return `entry-${id}.md`; }
function parseEntry(raw: string): Entry {
  try {
    const document = parseSafeFrontmatter(raw);
    return entrySchema.parse({ ...document.data, body: document.content.replace(/^\n/, '') }) as Entry;
  } catch { throw new StoreError('保存データの形式が壊れています。', 503, 'CORRUPT_ENTRY'); }
}
function markdown(entry: Entry) {
  const { body, ...metadata } = entry;
  return matter.stringify({ content: body }, metadata);
}
async function readEntry(id: string) {
  const raw = await storage.read(filename(id));
  return raw ? parseEntry(raw) : null;
}
async function save(entry: Entry) {
  const suffix = `${entry.id}-${String(entry.revision).padStart(8, '0')}-${randomUUID()}`;
  const content = markdown(entry);
  await storage.write(`history-${suffix}.md`, content);
  await storage.write(filename(entry.id), content);
  await storage.write(`commit-${suffix}.json`, JSON.stringify({ savedAt: entry.updatedAt }));
}
const exampleSpecs: EntryInput[] = [
  { title: 'Odin へようこそ', kind: 'knowledge', body: 'ここは、知識・タスク・アイデアをひとつにつなぐ場所です。検索、タグ、関連付けを試してみてください。\n\nこのデータはサンプルです。いつでも編集・削除できます。', tags: ['はじめに'], status: 'active' },
  { title: '新しいプロジェクト', kind: 'project', body: '目的、次の一歩、参考資料をここにまとめましょう。', tags: ['サンプル'], status: 'active' },
  { title: 'ひらめきを残す', kind: 'idea', body: 'まだ形になっていない考えも、書き留めておくと育てられます。', tags: ['サンプル'], status: 'active' },
  { title: '最初のタスクを試す', kind: 'task', body: '完了にして、一覧の変化を確認しましょう。', tags: ['サンプル'], status: 'active' },
  { title: '買い物リストの例', kind: 'shopping', body: '- コーヒー豆\n- ノート', tags: ['サンプル'], status: 'active' },
];
async function seedIfEmpty() {
  if (process.env.ODIN_STORAGE === 'drive' || process.env.ODIN_SEED_EXAMPLES === '0') return;
  if ((await storage.list('entry-')).length > 0) return;
  const now = new Date().toISOString();
  const ids = exampleSpecs.map(() => randomUUID());
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const [index, spec] of exampleSpecs.entries()) {
    const entry: Entry = { ...spec, id: ids[index], status: spec.status ?? 'active', createdAt: now, updatedAt: now, revision: 1, isExample: true };
    if (entry.kind === 'task') { entry.projectId = ids[1]; entry.dueAt = `${today}T18:00:00+09:00`; }
    await save(entry);
  }
}
function ensureRevision(entry: Entry, expectedRevision: number) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new StoreError('expectedRevision が必要です。', 400, 'REVISION_REQUIRED');
  if (entry.revision !== expectedRevision) throw new StoreError('他の変更が先に保存されました。再読み込みしてください。', 409, 'REVISION_CONFLICT');
}
export async function listEntries(options: ListOptions = {}): Promise<Entry[]> {
  return serial(async () => {
    refreshDriveIndex();
    await seedIfEmpty();
    if (options.kind && !entryKinds.includes(options.kind)) throw new StoreError('種類が正しくありません。', 400, 'INVALID_KIND');
    const entries = await readAllEntries();
    const query = options.query?.trim();
    return entries.filter((entry): entry is Entry => !!entry)
      .filter((entry) => options.deleted === 'all' || (options.deleted ? !!entry.deletedAt : !entry.deletedAt))
      .filter((entry) => !options.kind || entry.kind === options.kind)
      .filter((entry) => !query || entryMatchesQuery(entry, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}
async function readAllEntries(): Promise<Entry[]> {
  const names = (await storage.list('entry-')).filter((name) => /^entry-[\da-f-]{36}\.md$/.test(name));
  const entries = await mapWithReadLimit(names, async (name) => {
    const raw = await storage.read(name);
    return raw ? parseEntry(raw) : null;
  });
  return entries.filter((entry): entry is Entry => !!entry);
}
/** Call within an existing mutation or for a read-only snapshot; never nest serial(). */
export async function readEntriesDirect(): Promise<Entry[]> {
  refreshDriveIndex();
  return readAllEntries();
}
export async function getEntry(id: string): Promise<Entry | null> { refreshDriveIndex(); return readEntry(id); }
export async function createEntry(input: EntryInput, idempotencyKey?: string): Promise<Entry> {
  return mutation(() => createEntryInMutation(input, idempotencyKey));
}
export async function createEntryInMutation(input: EntryInput, idempotencyKey?: string): Promise<Entry> {
  const parsed = inputSchema.parse(input);
  const key = idempotencyKey?.trim();
  if (key && key.length > 200) throw new StoreError('Idempotency-Key が長すぎます。', 400, 'INVALID_KEY');
  const hash = key ? createHash('sha256').update(key).digest('hex') : null;
  const digest = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  const id = hash ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}` : randomUUID();
  if (hash) {
    const previous = await storage.read(`idempotency-${hash}.json`);
    if (previous) {
      const record = JSON.parse(previous) as { id: string; digest: string };
      if (record.digest !== digest) throw new StoreError('同じ Idempotency-Key に異なる内容が使われました。', 409, 'IDEMPOTENCY_CONFLICT');
      const existing = await readEntry(record.id);
      if (existing) return existing;
    }
    await storage.write(`idempotency-${hash}.json`, JSON.stringify({ id, digest }));
  }
  const now = new Date().toISOString();
  const entry: Entry = { ...parsed, id, status: parsed.status ?? 'active', createdAt: now, updatedAt: now, revision: 1 };
  await save(entry);
  return entry;
}
export async function updateEntry(id: string, patch: EntryPatch, expectedRevision: number): Promise<Entry> {
  return mutation(() => updateEntryInMutation(id, patch, expectedRevision));
}
export async function updateEntryInMutation(id: string, patch: EntryPatch, expectedRevision: number): Promise<Entry> {
  const entry = await readEntry(id);
  if (!entry) throw new StoreError('項目が見つかりません。', 404, 'NOT_FOUND');
  if (entry.deletedAt) throw new StoreError('ごみ箱から復元してください。', 409, 'DELETED');
  ensureRevision(entry, expectedRevision);
  const parsed = patchSchema.parse(patch);
  const sanitized = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== null)) as Partial<Entry>;
  const next: Entry = { ...entry, ...sanitized, updatedAt: new Date().toISOString(), revision: entry.revision + 1 };
  for (const field of ['dueAt', 'projectId', 'relatedIds', 'source'] as const) if (parsed[field] === null) delete next[field];
  await save(next); return next;
}
export async function deleteEntry(id: string, expectedRevision: number): Promise<Entry> {
  return mutation(async () => {
    const entry = await readEntry(id);
    if (!entry) throw new StoreError('項目が見つかりません。', 404, 'NOT_FOUND');
    ensureRevision(entry, expectedRevision);
    if (entry.deletedAt) return entry;
    const now = new Date().toISOString();
    const next = { ...entry, deletedAt: now, updatedAt: now, revision: entry.revision + 1 };
    await save(next); return next;
  });
}
export async function restoreEntry(id: string, expectedRevision: number): Promise<Entry> {
  return mutation(async () => {
    const entry = await readEntry(id);
    if (!entry) throw new StoreError('項目が見つかりません。', 404, 'NOT_FOUND');
    ensureRevision(entry, expectedRevision);
    if (!entry.deletedAt) return entry;
    const { deletedAt: _deletedAt, ...rest } = entry;
    const next = { ...rest, updatedAt: new Date().toISOString(), revision: entry.revision + 1 };
    await save(next); return next;
  });
}
export async function getHistory(id: string): Promise<EntryRevision[]> {
  refreshDriveIndex();
  assertId(id);
  const current = await readEntry(id);
  if (!current) throw new StoreError('項目が見つかりません。', 404, 'NOT_FOUND');
  const names = (await storage.list(`history-${id}-`)).sort();
  const commits = new Set(await storage.list(`commit-${id}-`));
  const currentMarkdown = markdown(current);
  const history = await mapWithReadLimit(names, async (name) => {
    const raw = await storage.read(name);
    if (!raw) return null;
    const legacy = /^history-[\da-f-]{36}-\d{8}\.md$/.test(name);
    const marker = name.replace(/^history-/, 'commit-').replace(/\.md$/, '.json');
    if (!legacy && !commits.has(marker) && raw !== currentMarkdown) return null;
    const entry = parseEntry(raw);
    if (legacy && entry.revision > current.revision) return null;
    return { entry, savedAt: entry.updatedAt };
  });
  return history.filter((item): item is EntryRevision => !!item);
}
export async function exportMarkdown(id?: string): Promise<string> {
  if (id) {
    refreshDriveIndex();
    const entry = await readEntry(id);
    if (!entry) throw new StoreError('項目が見つかりません。', 404, 'NOT_FOUND');
    return markdown(entry);
  }
  return serial(async () => {
    refreshDriveIndex();
    await seedIfEmpty();
    const entries = await readAllEntries();
    const byUpdatedAt = (a: Entry, b: Entry) => b.updatedAt.localeCompare(a.updatedAt);
    const ordered = [
      ...entries.filter((entry) => !entry.deletedAt).sort(byUpdatedAt),
      ...entries.filter((entry) => !!entry.deletedAt).sort(byUpdatedAt),
    ];
    return ordered.map((entry) => `<!-- ${entry.id}.md -->\n${markdown(entry)}`).join('\n\n');
  });
}
export async function exportArchive(): Promise<Uint8Array> {
  refreshDriveIndex();
  const names = [...await storage.list('entry-'), ...await storage.list('history-')]
    .filter((name) => /^(entry-[\da-f-]{36}|history-[\da-f-]{36}-\d{8}(?:-[\da-f-]{36})?)\.md$/.test(name));
  const commits = new Set(await storage.list('commit-'));
  const files: Record<string, Uint8Array> = {};
  const current = new Map<string, string>();
  const entryNames = names.filter((name) => name.startsWith('entry-'));
  const entryRaws = await mapWithReadLimit(entryNames, (name) => storage.read(name));
  for (const [index, name] of entryNames.entries()) {
    const raw = entryRaws[index];
    if (raw) { files[`entries/${name}`] = strToU8(raw); current.set(name.slice(6, -3), raw); }
  }
  let committedCount = 0;
  let recoveryCount = 0;
  const historyNames = names.filter((name) => name.startsWith('history-'));
  const historyRaws = await mapWithReadLimit(historyNames, (name) => storage.read(name));
  for (const [index, name] of historyNames.entries()) {
    const raw = historyRaws[index];
    if (!raw) continue;
    const id = name.slice(8, 44);
    const marker = name.replace(/^history-/, 'commit-').replace(/\.md$/, '.json');
    const committed = /^history-[\da-f-]{36}-\d{8}\.md$/.test(name) || commits.has(marker) || current.get(id) === raw;
    files[`${committed ? 'history' : 'recovery'}/${name}`] = strToU8(raw);
    if (committed) committedCount++; else recoveryCount++;
  }
  files['manifest.json'] = strToU8(JSON.stringify({ schema: 'odin-markdown-v1', exportedAt: new Date().toISOString(), entries: current.size, history: committedCount, recovery: recoveryCount }, null, 2));
  return zipSync(files, { level: 6 });
}
export async function getStoreStatus() { return storage.status(); }
