import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryClient } from '../scripts/lib/memory-client.mts';
import type { Entry, EntryInput } from '../src/lib/types';

const input: EntryInput = { title: '牛乳', kind: 'shopping', body: '2本', tags: [] };
const entry: Entry = { ...input, id: '12345678-1234-4234-8234-123456789012', revision: 1, status: 'active', createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z' };
const drive = { provider: 'drive', connected: true, writable: true };

test('memory capture verifies Drive, keeps retry key and reads saved content back', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).endsWith('/api/status') ? drive : { entry });
  };
  const client = new MemoryClient('https://odin.example', 'test-token', transport);
  const result = await client.create(input, 'request-1-item-1');
  assert.equal(result.verified, true);
  assert.equal(result.url, `https://odin.example/?entry=${entry.id}`);
  assert.deepEqual(calls.map(c => c.init?.method), ['GET', 'POST', 'GET']);
  assert.equal(new Headers(calls[1].init?.headers).get('Idempotency-Key'), 'request-1-item-1');
  assert.equal(calls[1].init?.redirect, 'error');
  await client.create(input, 'request-1-item-1');
  assert.equal(new Headers(calls[4].init?.headers).get('Idempotency-Key'), 'request-1-item-1');
});

test('memory capture never writes when Drive is unavailable or local', async () => {
  for (const status of [{ ...drive, provider: 'local' }, { ...drive, writable: false }, { ...drive, connected: false }]) {
    let mutations = 0;
    const client = new MemoryClient('http://127.0.0.1:3000', undefined, async (_url, init) => {
      if (init?.method !== 'GET') mutations++;
      return Response.json(status);
    });
    await assert.rejects(client.create(input, 'key'), /保存しませんでした/);
    assert.equal(mutations, 0);
  }
});

test('updates preserve expectedRevision and surface conflict without blind retry', async () => {
  let patches = 0;
  const client = new MemoryClient('https://odin.example', undefined, async (url, init) => {
    if (String(url).endsWith('/api/status')) return Response.json(drive);
    patches++;
    assert.equal(JSON.parse(String(init?.body)).expectedRevision, 1);
    return new Response('private proxy content', { status: 409 });
  });
  await assert.rejects(client.update(entry.id, { body: '3本' }, 1), /HTTP 409/);
  assert.equal(patches, 1);
});

test('readback failure reports uncertain save with ID and does not create again', async () => {
  let mutations = 0;
  const client = new MemoryClient('https://odin.example', undefined, async (url, init) => {
    if (String(url).endsWith('/api/status')) return Response.json(drive);
    if (init?.method === 'POST') { mutations++; return Response.json({ entry }); }
    throw new Error('offline');
  });
  await assert.rejects(client.create(input, 'key'), new RegExp(`読み戻し未確認.*${entry.id}`));
  assert.equal(mutations, 1);
});

test('rejects unsafe origins, invalid IDs, absent keys and overridden revisions before requests', async () => {
  for (const url of ['http://odin.example', 'https://token@odin.example', 'https://odin.example/?secret=x', 'ftp://localhost', 'https://odin.example/path']) assert.throws(() => new MemoryClient(url));
  const client = new MemoryClient('https://odin.example', undefined, async () => { throw new Error('must not request'); });
  await assert.rejects(client.create(input, ''), /--key/);
  assert.throws(() => client.fetch('../secrets'), /UUID/);
  await assert.rejects(client.update(entry.id, { expectedRevision: 2 }, 1), /--revision/);
});
