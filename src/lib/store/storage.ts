import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { StoreStatus } from '../types';

export interface Storage {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  status(): Promise<StoreStatus>;
}

function safeName(name: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) throw new Error('Unsafe storage name');
  return name;
}

export class LocalStorage implements Storage {
  constructor(private readonly root = resolve(process.cwd(), '.odin', 'vault')) {}
  private path(name: string) { return join(this.root, safeName(name)); }
  async read(name: string) {
    try { return await readFile(this.path(name), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async write(name: string, content: string) {
    if (process.env.VERCEL) throw new Error('Local storage is not writable on Vercel. Configure Google Drive.');
    await mkdir(this.root, { recursive: true });
    const temp = this.path(`.tmp-${randomUUID()}`);
    await writeFile(temp, content, { flag: 'wx' });
    await rename(temp, this.path(name));
  }
  async list(prefix: string) {
    try { return (await readdir(this.root)).filter((name) => name.startsWith(prefix) && /^[a-zA-Z0-9_.-]+$/.test(name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async status(): Promise<StoreStatus> {
    const writable = !process.env.VERCEL;
    return { provider: 'local', connected: writable, writable, message: writable ? 'この端末の .odin/vault に保存しています。' : 'Vercel 上ではローカル保存できません。Google Drive を設定してください。' };
  }
}

export class DriveStorage implements Storage {
  private token?: { value: string; until: number };
  private tokenLoad?: Promise<string>;
  private index?: { files: { id: string; name: string }[]; until: number };
  private indexLoad?: Promise<{ id: string; name: string }[]>;
  private indexGeneration = 0;
  private lease?: { token: string; lost: boolean };
  private lockKey() { return `odin:lock:${createHash('sha256').update(this.config().folderId).digest('hex')}`; }
  private async assertWriteLease() {
    const configured = !!this.lockConfig();
    if (!configured && !process.env.VERCEL) return;
    const lease = this.lease;
    if (!lease) throw new Error('Drive write lease is required.');
    if (lease.lost) throw new Error('Drive write lease was lost.');
    try {
      const renewed = await this.redis(['EVAL', 'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE",KEYS[1],ARGV[2]) else return 0 end', 1, this.lockKey(), lease.token, 30000]);
      if (renewed !== 1) { lease.lost = true; throw new Error('Drive write lease was lost.'); }
    } catch (error) { lease.lost = true; throw error; }
  }
  refreshIndex() { this.index = undefined; this.indexLoad = undefined; this.indexGeneration++; }
  private lockConfig() {
    const url = process.env.ODIN_LOCK_REDIS_URL;
    const token = process.env.ODIN_LOCK_REDIS_TOKEN;
    if (!url || !token) return null;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Redis lock URL must be HTTPS.');
    return { url: parsed.toString().replace(/\/$/, ''), token };
  }
  private async redis(command: (string | number)[]) {
    const config = this.lockConfig();
    if (!config) throw new Error('Redis lock is not configured.');
    const response = await fetch(config.url, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Redis lock request failed (${response.status}).`);
    const data = await response.json() as { result?: unknown; error?: string };
    if (data.error) throw new Error('Redis lock request failed.');
    return data.result;
  }
  async withWriteLock<T>(action: () => Promise<T>): Promise<T> {
    const config = this.lockConfig();
    if (!config) {
      if (process.env.VERCEL) throw new Error('Drive writes on Vercel require ODIN_LOCK_REDIS_URL and ODIN_LOCK_REDIS_TOKEN.');
      return action();
    }
    const key = this.lockKey();
    const token = randomUUID();
    const acquired = await this.redis(['SET', key, token, 'NX', 'PX', 30000]);
    if (acquired !== 'OK') throw new Error('Another Odin writer is active. Retry shortly.');
    const lease = { token, lost: false };
    this.lease = lease;
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing || lease.lost) return;
      renewing = true;
      void this.redis(['EVAL', 'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE",KEYS[1],ARGV[2]) else return 0 end', 1, key, token, 30000])
        .then((result) => { if (result !== 1) lease.lost = true; })
        .catch(() => { lease.lost = true; })
        .finally(() => { renewing = false; });
    }, 10000);
    try {
      const value = await action();
      if (lease.lost) throw new Error('Drive write lease was lost.');
      const stillOwned = await this.redis(['EVAL', 'if redis.call("GET",KEYS[1]) == ARGV[1] then return 1 else return 0 end', 1, key, token]);
      if (stillOwned !== 1) throw new Error('Drive write lease was lost.');
      return value;
    } finally {
      clearInterval(timer);
      this.lease = undefined;
      try { await this.redis(['EVAL', 'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end', 1, key, token]); }
      catch (error) { console.error('Odin lock release failed', error); }
    }
  }
  private config() {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: refreshToken, GOOGLE_DRIVE_FOLDER_ID: folderId } = process.env;
    if (!clientId || !clientSecret || !refreshToken || !folderId) throw new Error('Google Drive configuration is incomplete.');
    return { clientId, clientSecret, refreshToken, folderId };
  }
  private async accessToken() {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    if (this.tokenLoad) return this.tokenLoad;
    const loading = (async () => {
      const { clientId, clientSecret, refreshToken } = this.config();
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Google Drive authentication failed (${response.status}).`);
      const data = await response.json() as { access_token: string; expires_in: number };
      if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number') throw new Error('Google Drive authentication response is invalid.');
      this.token = { value: data.access_token, until: Date.now() + data.expires_in * 1000 };
      return data.access_token;
    })();
    this.tokenLoad = loading;
    try { return await loading; }
    finally { if (this.tokenLoad === loading) this.tokenLoad = undefined; }
  }
  private async request(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await this.accessToken()}`, ...init.headers }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
    return response;
  }
  private async files(prefix = '') {
    if (this.index && this.index.until > Date.now()) return this.index.files.filter((file) => file.name.startsWith(prefix));
    const generation = this.indexGeneration;
    const loading = this.indexLoad ?? (async () => {
      const { folderId } = this.config();
      const files: { id: string; name: string }[] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
        if (pageToken) query.set('pageToken', pageToken);
        const data = await (await this.request(`https://www.googleapis.com/drive/v3/files?${query}`)).json() as { nextPageToken?: string; files?: { id: string; name: string }[] };
        if (!Array.isArray(data.files) || data.files.some((file) => typeof file?.id !== 'string' || typeof file?.name !== 'string')) throw new Error('Google Drive file listing is invalid.');
        files.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      const managed = files.filter((file) => /^(entry-|history-|commit-|idempotency-|import-batch-|import-receipt-)/.test(file.name));
      if (new Set(managed.map((file) => file.name)).size !== managed.length) throw new Error('Duplicate Odin filenames in Google Drive folder.');
      return files;
    })();
    this.indexLoad = loading;
    try {
      const files = await loading;
      if (generation === this.indexGeneration) this.index = { files, until: Date.now() + 2000 };
      return files.filter((file) => file.name.startsWith(prefix));
    } finally {
      if (this.indexLoad === loading) this.indexLoad = undefined;
    }
  }
  async read(name: string) {
    safeName(name);
    const file = (await this.files(name)).find((item) => item.name === name);
    if (!file) return null;
    return (await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`)).text();
  }
  async write(name: string, content: string) {
    safeName(name);
    if ((process.env.VERCEL || this.lockConfig()) && !this.lease) throw new Error('Drive write lease is required.');
    const file = (await this.files(name)).find((item) => item.name === name);
    await this.assertWriteLease();
    if (file) {
      await this.request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content });
      return;
    }
    const boundary = `odin-${randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [this.config().folderId], mimeType: 'text/plain' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const created = await (await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json() as { id?: string };
    if (!created.id) throw new Error('Google Drive create response is invalid.');
    const cached = this.index;
    this.refreshIndex();
    if (cached) this.index = { files: [...cached.files, { id: created.id, name }], until: Date.now() + 2000 };
  }
  async list(prefix: string) { safeName(prefix); return (await this.files(prefix)).map((file) => file.name); }
  async status(): Promise<StoreStatus> {
    try {
      const { folderId } = this.config();
      const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,mimeType,capabilities(canAddChildren)`);
      const folder = await response.json() as { mimeType?: string; capabilities?: { canAddChildren?: boolean } };
      const folderWritable = folder.mimeType === 'application/vnd.google-apps.folder' && folder.capabilities?.canAddChildren === true;
      const configured = !!this.lockConfig();
      let lockReady = !process.env.VERCEL && !configured;
      if (configured) { try { lockReady = await this.redis(['PING']) === 'PONG'; } catch { lockReady = false; } }
      const writable = folderWritable && lockReady;
      return { provider: 'drive', connected: true, writable, message: writable ? 'Google Drive の指定フォルダーに保存しています。' : !folderWritable ? 'Google Drive の指定フォルダーに書き込む権限がありません。' : !configured ? 'Vercel での書き込みには Redis ロック設定が必要です。' : 'Redis ロックに接続できません。' };
    }
    catch (error) { return { provider: 'drive', connected: false, writable: false, message: error instanceof Error ? error.message : 'Google Drive に接続できません。' }; }
  }
}

export function createStorage(): Storage {
  return process.env.ODIN_STORAGE === 'drive' ? new DriveStorage() : new LocalStorage(process.env.ODIN_VAULT_DIR);
}
