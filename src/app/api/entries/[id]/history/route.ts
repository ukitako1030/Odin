import { requireApiAuth } from '@/lib/auth';
import { getHistory } from '@/lib/entries';
import { apiError } from '@/lib/store/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try { return Response.json({ history: await getHistory((await context.params).id) }); }
  catch (error) { return apiError(error); }
}
