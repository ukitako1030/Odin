/** Interactive one-time desktop OAuth setup. Secrets are written locally, never printed. */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

try { process.loadEnvFile('.env.local'); } catch { /* Environment variables also work. */ }
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Google Cloud の「デスクトップ アプリ」OAuth クライアントを作成し、.env.local に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。');
  process.exit(1);
}
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
let callbackResolve: (code: string) => void;
let callbackReject: (error: Error) => void;
const callback = new Promise<string>((resolve, reject) => { callbackResolve = resolve; callbackReject = reject; });
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
  if (url.searchParams.get('state') !== state) { response.writeHead(400).end('Invalid state'); return; }
  if (url.searchParams.has('error') || !url.searchParams.get('code')) {
    response.writeHead(400).end('Authorization was not completed.');
    callbackReject(new Error('Google authorization was declined.')); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Odin</title><body style="background:#070b15;color:#dfeaff;font:18px system-ui;padding:60px"><h1>Odin</h1><p>認証コードを受け取りました。ターミナルで接続結果を確認してください。</p></body>');
  callbackResolve(url.searchParams.get('code')!);
});
async function main() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot start local OAuth callback');
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId!, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  console.log('次の URL をブラウザーで開き、自分の Google アカウントを選んでください。\n');
  console.log(url.toString());
  const timeout = setTimeout(() => callbackReject(new Error('Authorization timed out after 5 minutes.')), 300_000);
  const code = await callback.finally(() => clearTimeout(timeout));
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  if (!tokenResponse.ok) throw new Error(`OAuth token exchange failed (${tokenResponse.status}).`);
  const token = await tokenResponse.json() as { access_token: string; refresh_token?: string };
  if (!token.refresh_token) throw new Error('Refresh token not returned. Repeat consent with offline access.');
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
  let folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    const query = new URLSearchParams({ q: "name = 'Odin' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: 'files(id,name)', pageSize: '100' });
    const lookup = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers });
    if (!lookup.ok) throw new Error(`Folder lookup failed (${lookup.status}).`);
    const existing = await lookup.json() as { files: { id: string }[] };
    if (existing.files.length > 1) throw new Error('Odin フォルダーが複数あります。GOOGLE_DRIVE_FOLDER_ID を指定してください。');
    folderId = existing.files[0]?.id;
    if (!folderId) {
      const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers, body: JSON.stringify({ name: 'Odin', mimeType: 'application/vnd.google-apps.folder' }) });
      if (!created.ok) throw new Error(`Folder creation failed (${created.status}).`);
      folderId = (await created.json() as { id: string }).id;
    }
  }
  const check = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId!)}?fields=mimeType,capabilities(canAddChildren)`, { headers });
  if (!check.ok) throw new Error('指定フォルダーへのアクセス権がありません。');
  const folder = await check.json() as { mimeType: string; capabilities: { canAddChildren: boolean } };
  if (folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities.canAddChildren) throw new Error('書き込み可能なフォルダーを指定してください。');
  const envPath = resolve('.env.local');
  let env = await readFile(envPath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
  for (const [key, value] of Object.entries({ GOOGLE_CLIENT_ID: clientId!, GOOGLE_CLIENT_SECRET: clientSecret!, GOOGLE_REFRESH_TOKEN: token.refresh_token, GOOGLE_DRIVE_FOLDER_ID: folderId!, ODIN_STORAGE: 'drive' })) {
    const line = `${key}=${JSON.stringify(value)}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    env = regex.test(env) ? env.replace(regex, () => line) : `${env.trimEnd()}\n${line}\n`;
  }
  const tempPath = `${envPath}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tempPath, env, { mode: 0o600, flag: 'wx' });
  await rename(tempPath, envPath);
  await chmod(envPath, 0o600);
  console.log('\n接続設定を .env.local に保存しました。秘密情報は表示しません。アプリを再起動してください。');
  console.log('ローカルの記録は自動移動しません。移行する場合は npm run migrate:drive を実行してください。');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Setup failed'); process.exitCode = 1; }).finally(() => server.close());
