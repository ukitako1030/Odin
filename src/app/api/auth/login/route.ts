import { authMode, authConfigurationMessage, createSession, loginRateLimit, sameOriginMutation, sessionCookie, verifyOwnerPassword } from '@/lib/auth';
import { limitedJsonBody } from '@/lib/store/http';
import { StoreError } from '@/lib/entries';

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: 'Origin が一致しません。' }, { status: 403 });
  const mode = authMode(request);
  if (mode === 'unavailable') return Response.json({ error: authConfigurationMessage() }, { status: 503 });
  if (mode === 'local-development') return Response.json({ ok: true });
  const retry = loginRateLimit(request);
  if (retry) return Response.json({ error: '試行回数が多すぎます。少し待ってから再試行してください。' }, { status: 429, headers: { 'Retry-After': String(retry) } });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: 'JSON を送信してください。' }, { status: 415 });
  let data: unknown;
  try { data = await limitedJsonBody(request, 8 * 1024); }
  catch (error) {
    const tooLarge = error instanceof StoreError && error.status === 413;
    return Response.json({ error: tooLarge ? 'JSON が大きすぎます。' : 'JSON を読み取れません。' }, { status: tooLarge ? 413 : 400 });
  }
  const password = typeof data === 'object' && data !== null && 'password' in data ? (data as { password: unknown }).password : undefined;
  if (typeof password !== 'string' || !verifyOwnerPassword(password)) {
    loginRateLimit(request, true);
    return Response.json({ error: 'パスワードが違います。' }, { status: 401 });
  }
  const token = await createSession();
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token, request), 'Cache-Control': 'no-store' } });
}
