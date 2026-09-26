import { requireApiAuth } from '@/lib/auth';
import { createEntry, listEntries } from '@/lib/entries';
import { apiError, jsonBody } from '@/lib/store/http';
import type { EntryInput, EntryKind } from '@/lib/types';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const deleted = params.get('deleted');
    const entries = await listEntries({ query: params.get('query') ?? undefined, kind: (params.get('kind') || undefined) as EntryKind | undefined, deleted: deleted === 'all' ? 'all' : deleted === 'true' });
    return Response.json({ entries });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const input = await jsonBody(request);
    const entry = await createEntry(input as unknown as EntryInput, request.headers.get('Idempotency-Key') ?? undefined);
    return Response.json({ entry }, { status: 201 });
  } catch (error) { return apiError(error); }
}
