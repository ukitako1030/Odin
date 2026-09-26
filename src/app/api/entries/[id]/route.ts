import { requireApiAuth } from '@/lib/auth';
import { deleteEntry, getEntry, updateEntry, type EntryPatch } from '@/lib/entries';
import { apiError, expectedRevision, jsonBody } from '@/lib/store/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const entry = await getEntry(id);
    return entry ? Response.json({ entry }) : Response.json({ error: { code: 'NOT_FOUND', message: '項目が見つかりません。' } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const { expectedRevision: expected, ...patch } = await jsonBody(request);
    const entry = await updateEntry(id, patch as EntryPatch, expectedRevision(expected));
    return Response.json({ entry });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const queryRevision = new URL(request.url).searchParams.get('expectedRevision');
    const body = queryRevision ? null : await jsonBody(request);
    const entry = await deleteEntry(id, expectedRevision(queryRevision ?? body?.expectedRevision));
    return Response.json({ entry });
  } catch (error) { return apiError(error); }
}
