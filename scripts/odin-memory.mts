import nextEnv from '@next/env';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryClient } from './lib/memory-client.mts';
import type { EntryInput } from '../src/lib/types';

nextEnv.loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), '..'), true);
const [command, ...args] = process.argv.slice(2);
const options = new Map<string, string>();
async function main() {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--id', '--revision', '--file', '--key', '--query'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('引数が正しくありません。');
    options.set(args[i], args[i + 1]);
  }
  const client = new MemoryClient(process.env.ODIN_URL || 'http://127.0.0.1:3000', process.env.ODIN_API_TOKEN);
  if (command === 'status') return client.status();
  if (command === 'search') return client.search(options.get('--query'));
  if (command === 'fetch') return client.fetch(options.get('--id') || '');
  if (command !== 'create' && command !== 'update') throw new Error('利用方法: npm run memory -- status | search --query 語句 | fetch --id UUID | create --file JSON --key KEY | update --id UUID --file JSON --revision N');
  const file = options.get('--file');
  if (!file) throw new Error('--file に UTF-8 JSON ファイルを指定してください。');
  const data = JSON.parse(await readFile(resolve(file), 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('1件の項目または更新内容をJSONオブジェクトで渡してください。');
  if (command === 'create') return client.create(data as EntryInput, options.get('--key') || '');
  return client.update(options.get('--id') || '', data, Number(options.get('--revision')));
}
main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error instanceof Error ? error.message : 'Odinとの通信に失敗しました。');
  if (command === 'create' || command === 'update') console.error('通信切断時は保存済みの可能性があります。作成は同じキー・同じ内容で再試行し、更新は対象を再取得してください。');
  process.exitCode = 1;
});
