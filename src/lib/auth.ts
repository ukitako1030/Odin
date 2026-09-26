import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'odin_session';
const ISSUER = 'odin';
const AUDIENCE = 'odin-owner';
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const failedLogins = new Map<string, { count: number; until: number }>();
const LOGIN_WINDOW_MS = 5 * 60_000;

type AuthMode = 'configured' | 'local-development' | 'unavailable';

function equalSecret(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function localRequestHost(request: Request): URL | null {
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host');
  if (!host || !isLoopback(requestUrl.hostname) || /[\s/@\\?#]/.test(host)) return null;
  try {
    const hostUrl = new URL(`${requestUrl.protocol}//${host}`);
    return isLoopback(hostUrl.hostname) && !hostUrl.username && !hostUrl.password && hostUrl.host === host.toLowerCase() ? hostUrl : null;
  } catch { return null; }
}

export function authMode(request: Request): AuthMode {
  const password = process.env.ODIN_OWNER_PASSWORD;
  const secret = process.env.ODIN_SESSION_SECRET;
  if (password && secret && Buffer.byteLength(secret) >= 32) return 'configured';
  if (password || secret) return 'unavailable';
  const url = new URL(request.url);
  if (process.env.NODE_ENV === 'development' && isLoopback(url.hostname) && (!request.headers.has('host') || localRequestHost(request))) return 'local-development';
  return 'unavailable';
}

export function authConfigurationMessage(): string {
  return 'ODIN_OWNER_PASSWORD と 32 バイト以上の ODIN_SESSION_SECRET を設定してください。開発時の未設定アクセスはローカル接続だけで許可されます。';
}

function originAllowed(request: Request): boolean {
  if (!MUTATIONS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    let expected = requestUrl.origin;
    if (process.env.NODE_ENV === 'production' && process.env.ODIN_PUBLIC_URL) expected = new URL(process.env.ODIN_PUBLIC_URL).origin;
    else if (process.env.NODE_ENV === 'development') expected = localRequestHost(request)?.origin ?? expected;
    return new URL(origin).origin === expected;
  }
  catch { return false; }
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

function validBearer(request: Request): boolean {
  const configured = process.env.ODIN_API_TOKEN;
  const supplied = bearerToken(request);
  return Boolean(configured && supplied && equalSecret(configured, supplied));
}

type OAuthConfig = { issuer: string; audience: string; ownerSub: string };
export function oauthConfig(): OAuthConfig | null {
  const { ODIN_OAUTH_ISSUER: issuer, ODIN_OAUTH_AUDIENCE: audience, ODIN_OAUTH_OWNER_SUB: ownerSub } = process.env;
  if (!issuer || !audience || !ownerSub) return null;
  try { const url = new URL(issuer); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null; }
  catch { return null; }
  return { issuer, audience, ownerSub };
}

export function oauthResourceUrl(request: Request): URL | null {
  const configured = process.env.ODIN_PUBLIC_URL;
  try {
    const base = new URL(configured || request.url);
    if (base.username || base.password || base.search || base.hash ||
      (configured && base.pathname !== '/') ||
      !['http:', 'https:'].includes(base.protocol) ||
      (process.env.NODE_ENV === 'production' && (!configured || base.protocol !== 'https:'))) return null;
    return new URL('/api/mcp', base.origin);
  } catch { return null; }
}

let cachedJwks: { issuer: string; verify: ReturnType<typeof createRemoteJWKSet> } | null = null;
async function validOAuthBearer(request: Request): Promise<boolean> {
  const config = oauthConfig();
  const token = bearerToken(request);
  if (!config || !token || token.length > 8192) return false;
  try {
    if (!cachedJwks || cachedJwks.issuer !== config.issuer) {
      const issuerUrl = new URL(config.issuer);
      const metadataUrl = new URL(`${issuerUrl.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`, issuerUrl.origin);
      const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      const metadata = await response.json() as { issuer?: string; jwks_uri?: string };
      if (metadata.issuer !== config.issuer || !metadata.jwks_uri) return false;
      const jwksUrl = new URL(metadata.jwks_uri);
      if (jwksUrl.protocol !== 'https:' || jwksUrl.origin !== issuerUrl.origin || jwksUrl.username || jwksUrl.password) return false;
      cachedJwks = { issuer: config.issuer, verify: createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000 }) };
    }
    const verified = await jwtVerify(token, cachedJwks.verify, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256','PS256','ES256'] });
    return verified.payload.sub === config.ownerSub && typeof verified.payload.exp === 'number';
  } catch { return false; }
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.split(';').map((piece) => piece.trim()).find((piece) => piece.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? null;
}

async function validSession(request: Request): Promise<boolean> {
  const token = cookieValue(request);
  const secret = process.env.ODIN_SESSION_SECRET;
  if (!token || !secret || Buffer.byteLength(secret) < 32) return false;
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    return result.payload.sub === 'owner';
  } catch { return false; }
}

export async function createSession(): Promise<string> {
  const secret = process.env.ODIN_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('Session secret is not configured');
  return new SignJWT({ role: 'owner' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner').setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(secret));
}

export function verifyOwnerPassword(password: string): boolean {
  const configured = process.env.ODIN_OWNER_PASSWORD;
  return Boolean(configured && equalSecret(password, configured));
}

/** In-process throttle; deploy behind an edge rate limit when public. */
export function loginRateLimit(request: Request, failed = false): number {
  const now = Date.now();
  if (failedLogins.size > 200) {
    for (const [key, entry] of failedLogins) if (entry.until <= now) failedLogins.delete(key);
  }
  const remote = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const keys = [`ip:${remote}`, 'global'];
  const ceilings = [10, 100];
  let retry = 0;
  keys.forEach((key, index) => {
    const previous = failedLogins.get(key);
    const entry = previous && previous.until > now ? previous : { count: 0, until: now + LOGIN_WINDOW_MS };
    if (failed) entry.count++;
    if (failed) failedLogins.set(key, entry);
    else if (previous && previous.until <= now) failedLogins.delete(key);
    if (entry.count >= ceilings[index]) retry = Math.max(retry, Math.ceil((entry.until - now) / 1000));
  });
  return retry;
}

export function sessionCookie(value: string, request: Request, maxAge = 60 * 60 * 24 * 7): string {
  const secure = new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function sameOriginMutation(request: Request): boolean { return originAllowed(request); }

/** Null means authorized. All API routes except login/status and MCP use this guard. */
export async function requireApiAuth(request: Request): Promise<Response | null> {
  const mode = authMode(request);
  if (mode === 'unavailable') return Response.json({ error: authConfigurationMessage() }, { status: 503 });
  const bearer = validBearer(request);
  const hasOrigin = request.headers.has('origin');
  if (hasOrigin && !originAllowed(request)) return Response.json({ error: 'Origin が一致しません。' }, { status: 403 });
  const oauth = !bearer && await validOAuthBearer(request);
  if (bearer || oauth) return null;
  if (!originAllowed(request)) return Response.json({ error: 'Origin が必要です。' }, { status: 403 });
  if (mode === 'local-development' || await validSession(request)) return null;
  return Response.json({ error: '認証が必要です。' }, { status: 401 });
}

/** MCP requires an API token even on development loopback. */
export async function requireMcpAuth(request: Request): Promise<Response | null> {
  if (!process.env.ODIN_API_TOKEN && !oauthConfig()) return Response.json({ error: 'MCP 接続には ODIN_API_TOKEN または OAuth リソースサーバー設定が必要です。' }, { status: 503 });
  const origin = request.headers.get('origin');
  if (origin && !originAllowed(request)) return Response.json({ error: 'Origin が一致しません。' }, { status: 403 });
  if (!validBearer(request) && !await validOAuthBearer(request)) {
    const resource = oauthResourceUrl(request);
    const challenge = resource ? `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/api/mcp', resource.origin)}"` : 'Bearer';
    return Response.json({ error: '有効な Bearer token が必要です。' }, { status: 401, headers: { 'WWW-Authenticate': challenge } });
  }
  return null;
}

export async function hasOwnerSession(request: Request): Promise<boolean> {
  const mode = authMode(request);
  return mode === 'local-development' || (mode === 'configured' && await validSession(request));
}
