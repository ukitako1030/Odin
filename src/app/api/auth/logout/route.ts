import { sameOriginMutation, sessionCookie } from '@/lib/auth';

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: 'Origin が一致しません。' }, { status: 403 });
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', request, 0), 'Cache-Control': 'no-store' } });
}
