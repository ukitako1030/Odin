import { requireApiAuth } from '@/lib/auth';
import { restoreEntry } from '@/lib/entries';
import { apiError, expectedRevision, jsonBody } from '@/lib/store/http';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await jsonBody(request);
    return Response.json({ entry: await restoreEntry(id, expectedRevision(body.expectedRevision)) });
  } catch (error) { return apiError(error); }
}
