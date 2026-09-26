import { z } from 'zod';
import { requireApiAuth } from '@/lib/auth';
import { StoreError } from '@/lib/entries';
import { codexImportAvailable, readCodexConversations } from '@/lib/imports/codex';
import { importJsonBody } from '@/lib/imports/http';
import { createImportBatch, updateImportSelection } from '@/lib/imports/service';
import { apiError } from '@/lib/store/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  return Response.json({ available: codexImportAvailable(request) });
}

export async function POST(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    if (!codexImportAvailable(request)) throw new StoreError('このPCのCodex履歴はローカルのOdinから取り込めます。', 403, 'LOCAL_ONLY');
    const input = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(await importJsonBody(request));
    const parsed = await readCodexConversations(input);
    if (!parsed.messages.length) throw new StoreError('指定期間の会話が見つかりませんでした。期間を変更するか、書き出しファイルを追加してください。', 404, 'EMPTY_IMPORT');
    const batch = await createImportBatch(parsed, `Codex · ${input.from}〜${input.to}`);
    return Response.json({ batch: await updateImportSelection(batch.id, input, batch.revision) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
