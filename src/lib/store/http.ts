import { ZodError } from 'zod';
import { StoreError } from '../entries';

export function apiError(error: unknown): Response {
  if (error instanceof StoreError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください。', details: error.flatten() } }, { status: 400 });
  console.error('Odin API error', error instanceof Error ? error.name : typeof error);
  return Response.json({ error: { code: 'STORE_ERROR', message: '保存先への接続または書き込みに失敗しました。' } }, { status: 503 });
}

export async function limitedJsonBody(request: Request, limit: number): Promise<unknown> {
  const tooLarge = () => new StoreError('JSON が大きすぎます。', 413, 'BODY_TOO_LARGE');
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new StoreError('JSON の内容を確認してください。', 400, 'INVALID_JSON');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new StoreError('JSON の内容を確認してください。', 400, 'INVALID_JSON'); }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await limitedJsonBody(request, 3 * 1024 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('JSON の内容を確認してください。', 400, 'INVALID_JSON');
  }
}

export function expectedRevision(value: unknown): number {
  const revision = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) throw new StoreError('expectedRevision が必要です。', 400, 'REVISION_REQUIRED');
  return revision;
}
