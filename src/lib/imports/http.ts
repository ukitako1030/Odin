import { StoreError } from '../entries';

/** Read incrementally so missing/forged Content-Length cannot bypass the limit. */
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit) throw new StoreError('ファイルが大きすぎます。分割して取り込んでください。', 413, 'IMPORT_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new StoreError('取り込む内容がありません。', 400, 'EMPTY_IMPORT');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new StoreError('ファイルが大きすぎます。分割して取り込んでください。', 413, 'IMPORT_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function importJsonBody(request: Request): Promise<unknown> {
  const raw = await limitedBody(request, 8 * 1024 * 1024);
  try { return JSON.parse(new TextDecoder().decode(raw)); }
  catch { throw new StoreError('JSON の内容を確認してください。', 400, 'INVALID_JSON'); }
}
