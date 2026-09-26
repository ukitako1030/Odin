import nextEnv from '@next/env';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
nextEnv.loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), '..'), true);

// Readiness only: never deploy, create accounts, print credentials, or write data.
const required = ['ODIN_PUBLIC_URL', 'ODIN_OWNER_PASSWORD', 'ODIN_SESSION_SECRET', 'ODIN_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID', 'ODIN_LOCK_REDIS_URL', 'ODIN_LOCK_REDIS_TOKEN', 'ODIN_OAUTH_ISSUER', 'ODIN_OAUTH_AUDIENCE', 'ODIN_OAUTH_OWNER_SUB'];
const missing = required.filter(name => !process.env[name]);
const issues: string[] = [];
if (process.env.ODIN_STORAGE !== 'drive') issues.push('ODIN_STORAGE must be drive');
if (process.env.ODIN_SESSION_SECRET && Buffer.byteLength(process.env.ODIN_SESSION_SECRET) < 32) issues.push('ODIN_SESSION_SECRET must be at least 32 bytes');
for (const key of ['ODIN_PUBLIC_URL', 'ODIN_LOCK_REDIS_URL', 'ODIN_OAUTH_ISSUER']) {
  if (!process.env[key]) continue;
  try { const url = new URL(process.env[key]!); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(); }
  catch { issues.push(`${key} must be a credential-free HTTPS URL`); }
}
if (process.env.ODIN_PUBLIC_URL && process.env.ODIN_OAUTH_AUDIENCE) {
  try { if (process.env.ODIN_OAUTH_AUDIENCE !== new URL('/api/mcp', process.env.ODIN_PUBLIC_URL).toString()) issues.push('ODIN_OAUTH_AUDIENCE must match the public /api/mcp resource for the Auth0 setup'); } catch { /* URL error above */ }
}
console.log(JSON.stringify({ configured: !missing.length && !issues.length, missing, issues, note: '設定の有無だけを確認。接続・権限・各AIからの実操作は別途検証が必要です。' }, null, 2));
if (missing.length || issues.length) process.exitCode = 1;
