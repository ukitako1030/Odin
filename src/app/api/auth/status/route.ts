import { authMode, hasOwnerSession } from '@/lib/auth';

export async function GET(request: Request) {
  const mode = authMode(request);
  return Response.json({ mode, authenticated: await hasOwnerSession(request) }, { status: mode === 'unavailable' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
