import test from 'node:test';
import assert from 'node:assert/strict';
import { apiError, jsonBody, limitedJsonBody } from '../src/lib/store/http';
import { StoreError } from '../src/lib/entries';
import { POST as login } from '../src/app/api/auth/login/route';

test('JSON body limit checks streamed bytes even with a false Content-Length', async () => {
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(' '.repeat(3 * 1024 * 1024 + 1)));
      controller.close();
    },
  });
  const request = new Request('https://odin.example/api/entries', {
    method: 'POST', body: streamed, duplex: 'half', headers: { 'Content-Length': '1' },
  } as RequestInit);
  await assert.rejects(jsonBody(request), (error: unknown) => error instanceof StoreError && error.status === 413);
  assert.deepEqual(await jsonBody(new Request('https://odin.example/api/entries', { method: 'POST', body: '{"title":"ok"}' })), { title: 'ok' });
  await assert.rejects(limitedJsonBody(new Request('https://odin.example/api/entries', {
    method: 'POST', body: '{}', headers: { 'Content-Length': '3145729' },
  }), 3 * 1024 * 1024), (error: unknown) => error instanceof StoreError && error.status === 413);
});

test('login rejects oversized JSON before parsing it', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ODIN_OWNER_PASSWORD: process.env.ODIN_OWNER_PASSWORD,
    ODIN_SESSION_SECRET: process.env.ODIN_SESSION_SECRET,
    ODIN_PUBLIC_URL: process.env.ODIN_PUBLIC_URL,
  };
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.ODIN_OWNER_PASSWORD = 'test-owner-password';
    process.env.ODIN_SESSION_SECRET = 's'.repeat(40);
    process.env.ODIN_PUBLIC_URL = 'https://odin.example';
    const request = new Request('https://odin.example/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://odin.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(8192) }),
    });
    assert.equal((await login(request)).status, 413);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('unexpected API errors do not print their message or stack', () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const response = apiError(new Error('private-token-in-upstream-error'));
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(logged).includes('private-token-in-upstream-error'), false);
    assert.deepEqual(logged, [['Odin API error', 'Error']]);
  } finally { console.error = original; }
});
