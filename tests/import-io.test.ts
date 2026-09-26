import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { codexImportAvailable, readCodexConversations } from '../src/lib/imports/codex';
import { importJsonBody, limitedBody } from '../src/lib/imports/http';

async function temporaryCodex(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'odin-import-io-'));
  t.after(async () => {
    const parent = await realpath(tmpdir());
    const actual = await realpath(root);
    const rel = relative(parent, actual);
    if (!rel.startsWith('odin-import-io-') || rel.includes(sep) || rel === '..' || isAbsolute(rel)) throw new Error('一時ディレクトリの削除先が想定外です');
    await rm(actual, { recursive: true, force: true });
  });
  return root;
}

function rollout(id: string, messages: { role: 'user' | 'assistant'; text: string; timestamp: string }[]) {
  return [
    JSON.stringify({ type: 'session_meta', payload: { id } }),
    ...messages.map((message) => JSON.stringify({
      type: 'response_item', timestamp: message.timestamp,
      payload: { type: 'message', role: message.role, content: [{ type: 'text', text: message.text }] },
    })),
  ].join('\n');
}

test('Codex loader は sessions と archived_sessions のみを読み、JST期間で発言を選ぶ', async (t) => {
  const root = await temporaryCodex(t);
  const sessions = join(root, 'sessions', '2026', '09', '24');
  const archived = join(root, 'archived_sessions');
  const unrelated = join(root, 'other');
  await Promise.all([mkdir(sessions, { recursive: true }), mkdir(archived), mkdir(unrelated)]);
  await writeFile(join(sessions, 'active.jsonl'), rollout('active', [
    { role: 'user', text: '期間前', timestamp: '2026-09-23T14:59:59Z' },
    { role: 'user', text: '開始', timestamp: '2026-09-23T15:00:00Z' },
    { role: 'assistant', text: '終了直前', timestamp: '2026-09-24T14:59:59Z' },
    { role: 'assistant', text: '期間後', timestamp: '2026-09-24T15:00:00Z' },
  ]));
  await writeFile(join(archived, 'archived.jsonl'), rollout('archived', [{ role: 'user', text: '過去の保存済み', timestamp: '2026-09-24T02:00:00Z' }]));
  await writeFile(join(root, 'auth.json'), '{"secret":"read-prohibited"}');
  await writeFile(join(root, 'history.jsonl'), rollout('outside', [{ role: 'user', text: 'ルート直下', timestamp: '2026-09-24T02:00:00Z' }]));
  await writeFile(join(unrelated, 'other.jsonl'), rollout('other', [{ role: 'user', text: '対象外フォルダー', timestamp: '2026-09-24T02:00:00Z' }]));
  const result = await readCodexConversations({ from: '2026-09-24', to: '2026-09-24' }, root);
  assert.equal(result.files, 2);
  assert.deepEqual(result.messages.map((m) => m.text).sort(), ['開始', '終了直前', '過去の保存済み'].sort());
  assert.ok(result.messages.every((m) => m.account === 'local-codex' && m.sourceFile.match(/^(sessions|archived_sessions)\//)));
  assert.equal((await readFile(join(root, 'auth.json'), 'utf8')), '{"secret":"read-prohibited"}');
});

test('Codex loader は symlink をたどらず、無効な日付ではディスク探索前に止まる', async (t) => {
  const root = await temporaryCodex(t);
  const outside = await temporaryCodex(t);
  const sessions = join(root, 'sessions');
  await mkdir(sessions);
  await writeFile(join(outside, 'leak.jsonl'), rollout('leak', [{ role: 'user', text: '外部', timestamp: '2026-09-24T00:00:00Z' }]));
  try {
    await symlink(outside, join(sessions, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    t.diagnostic('この環境ではsymlinkを作成できないため、symlink検証を省略');
  }
  const result = await readCodexConversations({}, root);
  assert.equal(result.messages.length, 0);
  await assert.rejects(readCodexConversations({ from: '2026-02-30' }, join(root, 'does-not-exist')), /存在しない日付/);
});

test('Codexローカル入口はループバックと明示有効化を要する', () => {
  const before = process.env.ODIN_CODEX_IMPORT_ENABLED;
  try {
    process.env.ODIN_CODEX_IMPORT_ENABLED = '1';
    assert.equal(codexImportAvailable(new Request('http://127.0.0.1:3000/api/import')), true);
    assert.equal(codexImportAvailable(new Request('http://example.com/api/import')), false);
    process.env.ODIN_CODEX_IMPORT_ENABLED = '0';
    assert.equal(codexImportAvailable(new Request('http://127.0.0.1:3000/api/import')), false);
  } finally {
    if (before === undefined) delete process.env.ODIN_CODEX_IMPORT_ENABLED;
    else process.env.ODIN_CODEX_IMPORT_ENABLED = before;
  }
});

function streamRequest(chunks: string[], headers?: HeadersInit) {
  const encoder = new TextEncoder();
  let index = 0;
  return new Request('http://localhost/import', {
    method: 'POST', headers, duplex: 'half',
    body: new ReadableStream<Uint8Array>({ pull(controller) {
      if (index >= chunks.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(chunks[index++]));
    } }),
  } as RequestInit & { duplex: 'half' });
}

test('HTTP body はContent-Length欠落や偽装でも読取中にサイズ制限する', async () => {
  await assert.rejects(limitedBody(streamRequest(['ab', 'cd']), 3), (error: unknown) => (error as { code?: string }).code === 'IMPORT_TOO_LARGE');
  await assert.rejects(limitedBody(streamRequest(['ab'], { 'content-length': '999' }), 3), (error: unknown) => (error as { code?: string }).code === 'IMPORT_TOO_LARGE');
  await assert.rejects(limitedBody(streamRequest(['ab', 'cd'], { 'content-length': '1' }), 3), (error: unknown) => (error as { code?: string }).code === 'IMPORT_TOO_LARGE');
  assert.equal(new TextDecoder().decode(await limitedBody(streamRequest(['ab', 'c']), 3)), 'abc');
});

test('HTTP JSON は有効値を返し、不正なJSONを区別する', async () => {
  assert.deepEqual(await importJsonBody(streamRequest(['{"a":', '1}'])), { a: 1 });
  await assert.rejects(importJsonBody(streamRequest(['{'])), (error: unknown) => (error as { code?: string }).code === 'INVALID_JSON');
  await assert.rejects(limitedBody(new Request('http://localhost/import', { method: 'POST' }), 10), (error: unknown) => (error as { code?: string }).code === 'EMPTY_IMPORT');
});
