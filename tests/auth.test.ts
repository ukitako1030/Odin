import test from 'node:test';
import assert from 'node:assert/strict';
import { authMode, createSession, requireApiAuth, requireMcpAuth, sessionCookie, verifyOwnerPassword } from '../src/lib/auth';

const saved = { NODE_ENV: process.env.NODE_ENV, ODIN_OWNER_PASSWORD: process.env.ODIN_OWNER_PASSWORD, ODIN_SESSION_SECRET: process.env.ODIN_SESSION_SECRET, ODIN_API_TOKEN: process.env.ODIN_API_TOKEN, ODIN_OAUTH_ISSUER: process.env.ODIN_OAUTH_ISSUER, ODIN_OAUTH_AUDIENCE: process.env.ODIN_OAUTH_AUDIENCE, ODIN_OAUTH_OWNER_SUB: process.env.ODIN_OAUTH_OWNER_SUB };
function reset() { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
function configured() { process.env.ODIN_OWNER_PASSWORD = 'correct horse battery staple'; process.env.ODIN_SESSION_SECRET = 's'.repeat(40); process.env.ODIN_API_TOKEN = 't'.repeat(40); delete process.env.ODIN_OAUTH_ISSUER; delete process.env.ODIN_OAUTH_AUDIENCE; delete process.env.ODIN_OAUTH_OWNER_SUB; }

test('authentication fails closed in production and on non-loopback development URLs', async () => {
  try {
    delete process.env.ODIN_OWNER_PASSWORD; delete process.env.ODIN_SESSION_SECRET; delete process.env.ODIN_API_TOKEN;
    Object.assign(process.env, { NODE_ENV: 'production' });
    assert.equal(authMode(new Request('http://127.0.0.1:3000/api/entries')), 'unavailable');
    assert.equal((await requireApiAuth(new Request('http://127.0.0.1:3000/api/entries')))?.status, 503);
    Object.assign(process.env, { NODE_ENV: 'development' });
    assert.equal(authMode(new Request('http://example.test/api/entries')), 'unavailable');
    assert.equal((await requireApiAuth(new Request('http://example.test/api/entries')))?.status, 503);
    assert.equal(authMode(new Request('http://127.0.0.1:3000/api/entries')), 'local-development');
    assert.equal(await requireApiAuth(new Request('http://127.0.0.1:3000/api/entries')), null);
    assert.equal((await requireMcpAuth(new Request('http://127.0.0.1:3000/api/mcp')))?.status, 503);
  } finally { reset(); }
});

test('password, signed session, bearer and Origin guard enforce owner access', async () => {
  try {
    configured(); Object.assign(process.env, { NODE_ENV: 'production' });
    assert.equal(verifyOwnerPassword('wrong'), false);
    assert.equal(verifyOwnerPassword('correct horse battery staple'), true);
    const url = 'https://odin.example/api/entries';
    assert.equal((await requireApiAuth(new Request(url)))?.status, 401);
    const token = await createSession();
    const cookie = sessionCookie(token, new Request(url));
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.equal(await requireApiAuth(new Request(url, { headers: { Cookie: cookie } })), null);
    const tokenParts = token.split('.');
    tokenParts[2] = (tokenParts[2][0] === 'A' ? 'B' : 'A') + tokenParts[2].slice(1);
    assert.equal((await requireApiAuth(new Request(url, { headers: { Cookie: cookie.replace(token, tokenParts.join('.')) } })))?.status, 401);
    assert.equal((await requireApiAuth(new Request(url, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example' } })))?.status, 403);
    assert.equal((await requireApiAuth(new Request(url, { method: 'POST', headers: { Cookie: cookie } })))?.status, 403);
    assert.equal(await requireApiAuth(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${'t'.repeat(40)}` } })), null);
    assert.equal((await requireApiAuth(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${'t'.repeat(40)}`, Origin: 'https://attacker.example' } })))?.status, 403);
    assert.equal((await requireMcpAuth(new Request('https://odin.example/api/mcp', { headers: { Authorization: 'Bearer wrong' } })))?.status, 401);
    assert.equal(await requireMcpAuth(new Request('https://odin.example/api/mcp', { headers: { Authorization: `Bearer ${'t'.repeat(40)}` } })), null);
  } finally { reset(); }
});

test('development matches browser Host when Next normalizes request URL to localhost', async () => {
  try {
    configured(); Object.assign(process.env, { NODE_ENV: 'development' });
    const internal = 'http://localhost:3100/api/entries';
    const bearer = `Bearer ${'t'.repeat(40)}`;
    const make = (host: string, origin: string) => new Request(internal, { method: 'POST', headers: { Host: host, Origin: origin, Authorization: bearer } });
    assert.equal(await requireApiAuth(make('127.0.0.1:3100', 'http://127.0.0.1:3100')), null);
    assert.equal((await requireApiAuth(make('127.0.0.1:3100', 'http://127.0.0.1:3000')))?.status, 403);
    assert.equal((await requireApiAuth(make('127.0.0.1:3100', 'http://attacker.example')))?.status, 403);
    assert.equal((await requireApiAuth(make('evil.example:3100', 'http://evil.example:3100')))?.status, 403);
    delete process.env.ODIN_OWNER_PASSWORD; delete process.env.ODIN_SESSION_SECRET;
    assert.equal(authMode(new Request(internal, { headers: { Host: 'evil.example:3100' } })), 'unavailable');
    assert.equal(authMode(new Request(internal, { headers: { Host: '127.0.0.1:3100', 'X-Forwarded-Host': 'evil.example' } })), 'local-development');
  } finally { reset(); }
});

test('production uses configured public origin without trusting Host or forwarded headers', async () => {
  const previousPublic = process.env.ODIN_PUBLIC_URL;
  try {
    configured(); Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.ODIN_PUBLIC_URL = 'https://odin.example';
    const make = (origin: string) => new Request('http://localhost:3000/api/entries', { method: 'POST', headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example', Origin: origin, Authorization: `Bearer ${'t'.repeat(40)}` } });
    assert.equal(await requireApiAuth(make('https://odin.example')), null);
    assert.equal((await requireApiAuth(make('https://attacker.example')))?.status, 403);
  } finally {
    if (previousPublic === undefined) delete process.env.ODIN_PUBLIC_URL; else process.env.ODIN_PUBLIC_URL = previousPublic;
    reset();
  }
});
