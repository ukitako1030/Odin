import assert from 'node:assert/strict';
import test from 'node:test';
import matter from 'gray-matter';
import { createEntry, getEntry, setStorageForTests, StoreError } from '../src/lib/entries';
import { parseConversationFiles } from '../src/lib/imports/parsers';
import { createImportBatch, getImportPacket } from '../src/lib/imports/service';
import { parseSafeFrontmatter } from '../src/lib/safe-frontmatter';
import type { Storage } from '../src/lib/store/storage';

const memory = new Map<string, string>();
const storage: Storage = {
  read: async name => memory.get(name) ?? null,
  write: async (name, content) => { memory.set(name, content); },
  list: async prefix => [...memory.keys()].filter(name => name.startsWith(prefix)),
  status: async () => ({ provider: 'local', connected: true, writable: true, message: 'test' }),
};
const state = globalThis as typeof globalThis & { __odinFrontmatterSentinel?: boolean };
const executable = '---javascript\n({ title: (globalThis.__odinFrontmatterSentinel = true, "unsafe") })\n---\n本文';

test('imported Markdown rejects executable frontmatter before evaluation', () => {
  state.__odinFrontmatterSentinel = false;
  try {
    for (const language of ['javascript', 'js', 'JAVASCRIPT', 'custom']) {
      const content = executable.replace('---javascript', `---${language}`);
      assert.throws(() => parseConversationFiles([{ name: 'note.md', data: new TextEncoder().encode(content) }]));
    }
    assert.equal(state.__odinFrontmatterSentinel, false);
  } finally { delete state.__odinFrontmatterSentinel; }
});

test('safe frontmatter preserves YAML and JSON and avoids gray-matter input cache', () => {
  const yaml = '---\ntitle: YAML\n---\n本文';
  const json = '---json\n{"title":"JSON"}\n---\n本文';
  assert.equal(parseSafeFrontmatter(yaml).data.title, 'YAML');
  assert.equal(parseSafeFrontmatter(json).data.title, 'JSON');
  assert.equal(parseSafeFrontmatter('\ufeff---yml\ntitle: YML\n---\n本文').data.title, 'YML');
  assert.equal(matter.stringify({ content: '通常の本文' }, { title: '記録' }), matter.stringify('通常の本文', { title: '記録' }));
  const cache = (matter as typeof matter & { cache: Record<string, unknown> }).cache;
  const unique = `---\ntitle: ${crypto.randomUUID()}\n---\n本文`;
  assert.equal(Object.hasOwn(cache, unique), false);
  parseSafeFrontmatter(unique);
  assert.equal(Object.hasOwn(cache, unique), false);
});

test('stored entry and import packet reject executable metadata without evaluation', async () => {
  memory.clear(); setStorageForTests(storage);
  const id = '11111111-1111-4111-8111-111111111111';
  memory.set(`entry-${id}.md`, executable);
  const batch = await createImportBatch({ files: 1, warnings: [], messages: [] });
  state.__odinFrontmatterSentinel = false;
  try {
    await assert.rejects(getEntry(id), (error: unknown) => error instanceof StoreError && error.code === 'CORRUPT_ENTRY');
    await assert.rejects(getImportPacket(batch.id), (error: unknown) => error instanceof StoreError && error.code === 'CORRUPT_ENTRY');
    assert.equal(state.__odinFrontmatterSentinel, false);
  } finally { delete state.__odinFrontmatterSentinel; }
});

test('saving a body that starts with frontmatter preserves it as text', async () => {
  memory.clear(); setStorageForTests(storage);
  state.__odinFrontmatterSentinel = false;
  try {
    const entry = await createEntry({ title: 'Safe body', kind: 'memo', body: executable, tags: [] });
    assert.equal((await getEntry(entry.id))?.body, `${executable}\n`);
    assert.equal(state.__odinFrontmatterSentinel, false);
    assert.equal(Object.hasOwn((matter as typeof matter & { cache: Record<string, unknown> }).cache, executable), false);
  } finally { delete state.__odinFrontmatterSentinel; }
});
