import type { Entry, EntryInput, StoreStatus } from '../../src/lib/types';
import { isDeepStrictEqual } from 'node:util';

/** Thin REST client: all storage rules remain in entries.ts on the server. */
export class MemoryClient {
  readonly base: URL;
  private readonly token?: string;
  private readonly transport: typeof fetch;
  constructor(url: string, token?: string, transport: typeof fetch = fetch) {
    this.token = token;
    this.transport = transport;
    this.base = new URL(url);
    if (this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== '/' ||
      !(this.base.protocol === 'https:' || (this.base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname)))) {
      throw new Error('ODIN_URL は資格情報を含まない HTTPS のオリジン、またはローカル HTTP にしてください。');
    }
  }
  async request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
    const response = await this.transport(new URL(path, this.base), {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Origin: this.base.origin, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      // Do not echo arbitrary server/proxy response bodies (they may contain credentials).
      throw new Error(`Odin HTTP ${response.status}。401/403: 認証、409: 版競合、503: 接続設定を確認してください。`);
    }
    return await response.json() as T;
  }
  status() { return this.request<StoreStatus>('/api/status'); }
  search(query = '') { return this.request<{ entries: Entry[] }>(`/api/entries?query=${encodeURIComponent(query)}`); }
  fetch(id: string) { return this.request<{ entry: Entry }>(`/api/entries/${this.id(id)}`); }
  private id(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('有効な UUID が必要です。');
    return id;
  }
  private async writableDrive() {
    const status = await this.status();
    if (status.provider !== 'drive' || !status.connected || !status.writable) {
      throw new Error('Google Drive の接続・書き込みを確認できないため保存しませんでした。');
    }
  }
  private async readback(saved: Entry) {
    try {
      const { entry } = await this.fetch(saved.id);
      if (!isDeepStrictEqual(entry, saved)) throw new Error('Changed');
      return { entry, url: new URL(`/?entry=${entry.id}`, this.base).toString(), verified: true };
    } catch {
      throw new Error(`書き込み応答を受信しましたが読み戻し未確認です。ID=${saved.id}。新規キーで再作成せず、このIDを確認してください。`);
    }
  }
  async create(input: EntryInput, key: string) {
    if (!key?.trim() || key.length > 200 || /[\r\n]/.test(key)) throw new Error('再試行で共通の --key（1〜200文字）が必要です。');
    await this.writableDrive();
    const { entry } = await this.request<{ entry: Entry }>('/api/entries', 'POST', input, key);
    return this.readback(entry);
  }
  async update(id: string, patch: Record<string, unknown>, revision: number) {
    this.id(id);
    if (!Number.isInteger(revision) || revision < 1) throw new Error('取得済みの --revision が必要です。');
    if ('expectedRevision' in patch) throw new Error('版番号は --revision だけで指定してください。');
    await this.writableDrive();
    const { entry } = await this.request<{ entry: Entry }>(`/api/entries/${id}`, 'PATCH', { ...patch, expectedRevision: revision });
    return this.readback(entry);
  }
}
