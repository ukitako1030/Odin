import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/app/api/mcp/route';
import { setStorageForTests } from '../src/lib/entries';
import type { Storage } from '../src/lib/store/storage';
import { createImportBatch } from '../src/lib/imports/service';

const memory = new Map<string,string>();
const storage: Storage = {
  read: async (name) => memory.get(name) ?? null,
  write: async (name, content) => { memory.set(name, content); },
  list: async (prefix) => [...memory.keys()].filter((name) => name.startsWith(prefix)),
  status: async () => ({ provider: 'local', connected: true, writable: true, message: 'test' }),
};
function request(method: string, params?: unknown, token = 'test-token') {
  return new Request('http://127.0.0.1:3000/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }) });
}
async function call(name: string, args: unknown) {
  const response = await POST(request('tools/call', { name, arguments: args }));
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
function value(result: { content: { text: string }[] }) { return JSON.parse(result.content[0].text); }

test('MCP SDK transport exposes tools and enforces revision on writes', async () => {
  const previous = process.env.ODIN_API_TOKEN;
  const previousSeed = process.env.ODIN_SEED_EXAMPLES;
  const previousPublic = process.env.ODIN_PUBLIC_URL;
  try {
    process.env.ODIN_API_TOKEN = 'test-token'; process.env.ODIN_SEED_EXAMPLES = '0';
    process.env.ODIN_PUBLIC_URL = 'https://odin.example';
    setStorageForTests(storage); memory.clear();
    assert.equal((await POST(request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, 'bad'))).status, 401);
    const init = await POST(request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));
    assert.equal(init.status, 200);
    assert.equal((await init.json()).result.serverInfo.name, 'odin');
    const listed = await POST(request('tools/list'));
    const definitions = (await listed.json()).result.tools;
    const names = definitions.map((tool: { name: string }) => tool.name);
    assert.equal(definitions.find((tool: { name: string }) => tool.name === 'odin_fetch').annotations.readOnlyHint, true);
    assert.equal(definitions.find((tool: { name: string }) => tool.name === 'odin_create').annotations.readOnlyHint, false);
    assert.equal(definitions.find((tool: { name: string }) => tool.name === 'odin_trash').annotations.destructiveHint, true);
    assert.ok(names.includes('odin_search')); assert.ok(names.includes('odin_trash'));
    const created = value(await call('odin_create', { input: { title: 'Test', kind: 'task', body: 'Do it', tags: [], source: 'manual' }, idempotencyKey: 'once' }));
    assert.equal(created.revision, 1);
    const retried = await call('odin_create', { input: { title: 'Test', kind: 'task', body: 'Do it', tags: [], source: 'manual' }, idempotencyKey: 'once' });
    assert.equal(value(retried).id, created.id);
    assert.equal(retried.structuredContent.url, `https://odin.example/?entry=${created.id}`);
    const search = value(await call('odin_search', { query: 'Test' }));
    assert.equal(search.length, 1);
    const stale = await call('odin_complete', { id: created.id, expectedRevision: 2 });
    assert.equal(stale.isError, true);
    assert.equal(value(stale).code, 'REVISION_CONFLICT');
    const done = value(await call('odin_complete', { id: created.id, expectedRevision: 1 }));
    assert.equal(done.status, 'done'); assert.equal(done.revision, 2);
    const cleared = value(await call('odin_update', { id: created.id, patch: { source: null }, expectedRevision: 2 }));
    assert.equal(cleared.source, undefined); assert.equal(cleared.revision, 3);
    const fetched = value(await call('odin_fetch', { id: created.id }));
    assert.equal(fetched.revision, 3);
  } finally {
    if (previous === undefined) delete process.env.ODIN_API_TOKEN; else process.env.ODIN_API_TOKEN = previous;
    if (previousSeed === undefined) delete process.env.ODIN_SEED_EXAMPLES; else process.env.ODIN_SEED_EXAMPLES = previousSeed;
    if (previousPublic === undefined) delete process.env.ODIN_PUBLIC_URL; else process.env.ODIN_PUBLIC_URL = previousPublic;
  }
});

test('MCP pages long conversation evidence and stages AI proposals without writing knowledge', async () => {
  const previous = process.env.ODIN_API_TOKEN;
  try {
    process.env.ODIN_API_TOKEN = 'test-token'; setStorageForTests(storage); memory.clear();
    const batch = await createImportBatch({ files: 1, warnings: [], messages: [{ id: 'message1', conversationId: 'conversation1', conversationTitle: '知識の扱い', provider: 'codex', account: 'local', role: 'user', text: '長い文脈'.repeat(4000) + '原文を根拠にする。', timestamp: '2026-09-24T00:00:00Z', sourceFile: 'test.jsonl', hash: 'test' }] });
    const packet = value(await call('odin_import_packet', { batchId: batch.id }));
    assert.equal(packet.messages[0].textTruncated, true);
    assert.equal(packet.messages[0].text.length, 12000);
    const continuation = value(await call('odin_import_message', { batchId: batch.id, messageId: 'message1', offset: 12000 }));
    assert.match(continuation.text, /原文を根拠にする/);
    const staged = value(await call('odin_import_candidates', { batchId: batch.id, expectedRevision: batch.revision, candidates: [{ title: '根拠を残す', body: '原文を根拠にするという本人の方針。', kind: 'knowledge', tags: [], evidence: [{ messageId: 'message1', quote: '原文を根拠にする。' }] }] }));
    assert.equal(staged.candidates[0].state, 'pending');
    assert.equal(staged.candidates[0].body, undefined);
    assert.equal([...memory.keys()].filter(name => name.startsWith('entry-')).length, 0);
    const stale = await call('odin_import_candidates', { batchId: batch.id, expectedRevision: batch.revision, candidates: [{ title: '二度目', body: '原文', kind: 'knowledge', tags: [], evidence: [{ messageId: 'message1', quote: '原文' }] }] });
    assert.equal(value(stale).code, 'REVISION_CONFLICT');
  } finally { if (previous === undefined) delete process.env.ODIN_API_TOKEN; else process.env.ODIN_API_TOKEN = previous; }
});
