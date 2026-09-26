import { requireApiAuth } from '@/lib/auth';
import { getImportPacket } from '@/lib/imports/service';
import { apiError } from '@/lib/store/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const { id } = await params;
    const packet = await getImportPacket(id);
    return new Response(JSON.stringify(packet, null, 2), { headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="odin-conversations-${id}.json"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) { return apiError(error); }
}
