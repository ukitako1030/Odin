import test from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { oauthConfig, requireApiAuth, requireMcpAuth } from '../src/lib/auth';
import { protectedResourceMetadata } from '../src/lib/oauth-metadata';

const keys = ['NODE_ENV', 'ODIN_OWNER_PASSWORD', 'ODIN_SESSION_SECRET', 'ODIN_API_TOKEN', 'ODIN_OAUTH_ISSUER', 'ODIN_OAUTH_AUDIENCE', 'ODIN_OAUTH_OWNER_SUB', 'ODIN_PUBLIC_URL'] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
function restoreEnvironment() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('OAuth verifies the owner access token and rejects invalid signed tokens', async () => {
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ODIN_OWNER_PASSWORD: 'owner password',
      ODIN_SESSION_SECRET: 's'.repeat(40),
      ODIN_OAUTH_ISSUER: 'https://auth.example/tenant/',
      ODIN_OAUTH_AUDIENCE: 'https://odin.example/api/mcp',
      ODIN_OAUTH_OWNER_SUB: 'auth0|owner',
      ODIN_PUBLIC_URL: 'https://odin.example',
    });
    delete process.env.ODIN_API_TOKEN;

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const otherKey = (await generateKeyPair('RS256')).privateKey;
    const jwk = { ...await exportJWK(publicKey), kid: 'owner-key', alg: 'RS256', use: 'sig' };
    const discoveryUrl = 'https://auth.example/tenant/.well-known/openid-configuration';
    const jwksUrl = 'https://auth.example/tenant/.well-known/jwks.json';
    const fetched: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url === discoveryUrl) return Response.json({ issuer: process.env.ODIN_OAUTH_ISSUER, jwks_uri: jwksUrl });
      if (url === jwksUrl) return Response.json({ keys: [jwk] });
      throw new Error(`Unexpected OAuth fetch: ${url}`);
    };

    const sign = (claims: { sub?: string; aud?: string; iss?: string; exp?: number; key?: CryptoKey } = {}) => {
      const token = new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'owner-key' })
        .setSubject(claims.sub ?? 'auth0|owner')
        .setIssuer(claims.iss ?? 'https://auth.example/tenant/')
        .setAudience(claims.aud ?? 'https://odin.example/api/mcp')
        .setIssuedAt();
      if (claims.exp !== undefined) token.setExpirationTime(claims.exp);
      return token.sign(claims.key ?? privateKey);
    };
    const validExpiry = Math.floor(Date.now() / 1000) + 300;
    const request = (token: string) => new Request('https://odin.example/api/mcp', { headers: { Authorization: `Bearer ${token}` } });
    const valid = await sign({ exp: validExpiry });
    assert.equal(await requireMcpAuth(request(valid)), null);
    assert.equal(await requireApiAuth(request(valid)), null);
    assert.deepEqual(fetched, [discoveryUrl, jwksUrl]);

    const invalid = [
      await sign({ sub: 'auth0|someone-else', exp: validExpiry }),
      await sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
      await sign({ aud: 'https://another.example/api', exp: validExpiry }),
      await sign({ iss: 'https://another.example/', exp: validExpiry }),
      await sign({ key: otherKey, exp: validExpiry }),
      await sign(), // jose accepts a signed JWT without exp; Odin must not.
    ];
    for (const token of invalid) {
      const denied = await requireMcpAuth(request(token));
      assert.equal(denied?.status, 401);
      assert.equal(denied.headers.get('WWW-Authenticate'), 'Bearer resource_metadata="https://odin.example/.well-known/oauth-protected-resource/api/mcp"');
    }
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('protected resource metadata uses the configured public URL and fails closed on malformed URLs', async () => {
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ODIN_OAUTH_ISSUER: 'https://auth.example/',
      ODIN_OAUTH_AUDIENCE: 'odin-api',
      ODIN_OAUTH_OWNER_SUB: 'auth0|owner',
      ODIN_PUBLIC_URL: 'https://odin.example/',
    });
    delete process.env.ODIN_API_TOKEN;
    const request = new Request('https://internal.example/api/mcp', { headers: { Host: 'attacker.example' } });
    const metadata = protectedResourceMetadata(request);
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), {
      resource: 'https://odin.example/api/mcp',
      authorization_servers: ['https://auth.example/'],
      bearer_methods_supported: ['header'],
    });
    assert.equal((await requireMcpAuth(request))?.headers.get('WWW-Authenticate'), 'Bearer resource_metadata="https://odin.example/.well-known/oauth-protected-resource/api/mcp"');

    for (const publicUrl of ['not-a-url', 'http://odin.example', 'https://user:password@odin.example', 'https://odin.example/path', 'https://odin.example/?secret=value']) {
      process.env.ODIN_PUBLIC_URL = publicUrl;
      assert.equal(protectedResourceMetadata(request).status, 503);
      const denied = await requireMcpAuth(request);
      assert.equal(denied?.status, 401);
      assert.equal(denied.headers.get('WWW-Authenticate'), 'Bearer');
    }
    delete process.env.ODIN_PUBLIC_URL;
    assert.equal(protectedResourceMetadata(request).status, 503);
    assert.equal((await requireMcpAuth(request))?.headers.get('WWW-Authenticate'), 'Bearer');

    process.env.ODIN_OAUTH_ISSUER = 'http://auth.example/';
    assert.equal(oauthConfig(), null);
    assert.equal(protectedResourceMetadata(request).status, 503);
  } finally { restoreEnvironment(); }
});

test('OAuth rejects discovery that names another issuer or a foreign JWKS origin', async () => {
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ODIN_OAUTH_AUDIENCE: 'odin-api',
      ODIN_OAUTH_OWNER_SUB: 'auth0|owner',
      ODIN_PUBLIC_URL: 'https://odin.example',
    });
    const { privateKey } = await generateKeyPair('RS256');
    const requestFor = async (issuer: string) => {
      process.env.ODIN_OAUTH_ISSUER = issuer;
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' })
        .setSubject('auth0|owner').setIssuer(issuer).setAudience('odin-api')
        .setExpirationTime('5m').sign(privateKey);
      return new Request('https://odin.example/api/mcp', { headers: { Authorization: `Bearer ${token}` } });
    };
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('/wrong-issuer/')) return Response.json({ issuer: 'https://attacker.example/', jwks_uri: 'https://auth.example/keys' });
      if (url.includes('/foreign-jwks/')) return Response.json({ issuer: 'https://auth.example/foreign-jwks/', jwks_uri: 'https://attacker.example/keys' });
      throw new Error(`Unexpected OAuth fetch: ${url}`);
    };
    assert.equal((await requireMcpAuth(await requestFor('https://auth.example/wrong-issuer/')))?.status, 401);
    assert.equal((await requireMcpAuth(await requestFor('https://auth.example/foreign-jwks/')))?.status, 401);
    assert.deepEqual(requested, [
      'https://auth.example/wrong-issuer/.well-known/openid-configuration',
      'https://auth.example/foreign-jwks/.well-known/openid-configuration',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});
