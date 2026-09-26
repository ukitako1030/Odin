import { z } from 'zod';
import { requireApiAuth } from '@/lib/auth';
import { StoreError } from '@/lib/entries';
import { limitedBody } from '@/lib/imports/http';
import { parseConversationFiles } from '@/lib/imports/parsers';
import { createImportBatch, listImportBatches } from '@/lib/imports/service';
import { apiError } from '@/lib/store/http';
import { conversationProviders } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try { return Response.json({ batches: await listImportBatches() }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  const denied = await requireApiAuth(request); if (denied) return denied;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data')) throw new StoreError('履歴ファイルを選んでください。', 400, 'INVALID_UPLOAD');
    const bytes = await limitedBody(request, 50 * 1024 * 1024);
    let data: FormData;
    try { data = await new Response(Buffer.from(bytes), { headers: { 'Content-Type': contentType } }).formData(); }
    catch { throw new StoreError('ファイルを読み取れません。選び直してください。', 400, 'INVALID_UPLOAD'); }
    const files = data.getAll('files').filter((file): file is File => typeof file !== 'string');
    if (!files.length || files.length > 100) throw new StoreError('1〜100個のファイルを選んでください。', 400, 'INVALID_UPLOAD');
    const provider = z.enum(['auto', ...conversationProviders]).parse(data.get('provider') || 'auto');
    const account = z.string().trim().max(100).parse(data.get('account') || 'default');
    const title = z.string().trim().max(200).parse(data.get('title') || '');
    let parsed;
    try { parsed = parseConversationFiles(await Promise.all(files.map(async file => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))), { provider, account }); }
    catch (error) { throw new StoreError(error instanceof Error ? error.message : '履歴形式を確認してください。', 400, 'INVALID_IMPORT'); }
    if (!parsed.messages.length) throw new StoreError(parsed.warnings[0]?.message || '読み取れる会話がありませんでした。', 400, 'EMPTY_IMPORT');
    return Response.json({ batch: await createImportBatch(parsed, title || undefined) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
