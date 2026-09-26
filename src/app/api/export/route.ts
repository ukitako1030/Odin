import { requireApiAuth } from '@/lib/auth';
import { exportArchive, exportMarkdown } from '@/lib/entries';
import { apiError } from '@/lib/store/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get('id') ?? undefined;
    if (id) {
      const content = await exportMarkdown(id);
      return new Response(content, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}.md"` } });
    }
    const archive = await exportArchive();
    return new Response(new Uint8Array(archive), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="odin-export.zip"' } });
  } catch (error) { return apiError(error); }
}
