import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StoreError } from '../entries';
import { parseConversationFiles, selectMessages } from './parsers';
import type { ImportSelection, ParsedConversations } from '../types';

function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function codexImportAvailable(request: Request) {
  const url = new URL(request.url);
  return !process.env.VERCEL && process.env.ODIN_CODEX_IMPORT_ENABLED !== '0'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && (process.env.NODE_ENV === 'development' || process.env.ODIN_CODEX_IMPORT_ENABLED === '1');
}

/** This reader never mutates Codex files and never traverses credentials, caches, or symlinks. */
export async function readCodexConversations(selection: ImportSelection, root = process.env.ODIN_CODEX_HOME || join(homedir(), '.codex')): Promise<ParsedConversations> {
  // Validate the dates before touching disk.
  try { selectMessages([], selection); }
  catch (error) { throw new StoreError(error instanceof Error ? error.message : '日付を確認してください。', 400, 'INVALID_RANGE'); }
  const base = resolve(root);
  let resolvedBase: string;
  try { resolvedBase = await realpath(base); }
  catch { throw new StoreError('このPCにCodexの履歴フォルダーが見つかりません。書き出したファイルから取り込めます。', 404, 'CODEX_NOT_FOUND'); }
  const files: string[] = [];
  const warnings: ParsedConversations['warnings'] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 6) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const item of items) {
      if (item.isSymbolicLink()) continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path, depth + 1);
      else if (item.isFile() && item.name.endsWith('.jsonl')) {
        if (files.length >= 5000) throw new StoreError('履歴が多いため一度に読み込めません。対象のJSONLファイルを選んで取り込んでください。', 413, 'CODEX_TOO_LARGE');
        files.push(path);
      }
    }
  }
  for (const name of ['sessions', 'archived_sessions']) {
    // User-owned runtime data must never be traced into the deployment bundle.
    const path = join(/* turbopackIgnore: true */ base, name);
    try { if ((await lstat(path)).isSymbolicLink()) continue; } catch { continue; }
    await walk(path, 0);
  }
  const messages = new Map<string, ParsedConversations['messages'][number]>();
  let bytes = 0;
  for (const path of files.sort()) {
    const resolved = await realpath(path);
    if (!inside(resolvedBase, resolved)) continue;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) continue;
    bytes += info.size;
    if (bytes > 200 * 1024 * 1024) throw new StoreError('履歴の合計が200MBを超えています。必要なJSONLファイルを選んで取り込んでください。', 413, 'CODEX_TOO_LARGE');
    if (info.size > 20 * 1024 * 1024) {
      warnings.push({ file: relative(base, path), message: '20MBを超える履歴を除外しました。この会話は個別に分割して取り込んでください。' });
      continue;
    }
    const parsed = parseConversationFiles([{ name: relative(base, path).replaceAll('\\', '/'), data: await readFile(path) }], { provider: 'codex', account: 'local-codex' });
    warnings.push(...parsed.warnings);
    for (const message of selectMessages(parsed.messages, selection)) messages.set(message.id, message);
  }
  return { files: files.length, messages: [...messages.values()], warnings };
}
