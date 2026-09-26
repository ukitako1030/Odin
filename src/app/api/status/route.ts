import { requireApiAuth } from '@/lib/auth';
import { getStoreStatus } from '@/lib/entries';
import { apiError } from '@/lib/store/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try { return Response.json(await getStoreStatus()); }
  catch (error) { return apiError(error); }
}
