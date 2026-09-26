import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { parseSafeFrontmatter } from '../safe-frontmatter';
import type { ConversationMessage, ConversationProvider, ImportSelection, ImportWarning, ParsedConversations } from '../types';

type InputFile = { name: string; data: Uint8Array };
type UnknownRecord = Record<string, unknown>;
type Draft = Omit<ConversationMessage, 'id' | 'hash'> & { nativeMessageId?: string };

const MAX_INPUT = 256 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const MAX_MESSAGE = 1024 * 1024;
const MAX_RATIO = 250;
const decoder = new TextDecoder('utf-8', { fatal: true });

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function date(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = value > 1e12 ? value : value * 1000;
    const parsed = new Date(n);
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
  }
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return undefined;
  const parts = value.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?/);
  if (!parts) return undefined;
  const [, yy, mm, dd, hh, minute, ss] = parts;
  const y = Number(yy), m = Number(mm), d = Number(dd);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || Number(hh) > 23 || Number(minute) > 59 || Number(ss ?? 0) > 59) return undefined;
  const offset = value.match(/([+-])(\d\d):(\d\d)$/);
  if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return undefined;
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function textParts(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    const parts = value.map((part) => {
      if (typeof part === 'string') return part;
      const item = record(part);
      if (!item) return '';
      return string(item.text) ?? (item.type === 'text' ? string(item.content) : undefined) ?? '';
    }).filter(Boolean);
    return parts.join('\n').trim() || undefined;
  }
  const item = record(value);
  if (item) return textParts(item.parts ?? item.text ?? item.content);
  return undefined;
}

function safeName(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  return !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized) && !normalized.split('/').includes('..') && !normalized.includes('\0');
}

function expand(files: InputFile[]): { files: InputFile[]; warnings: ImportWarning[] } {
  const expanded: InputFile[] = [];
  const warnings: ImportWarning[] = [];
  let total = 0;
  const add = (file: InputFile) => {
    if (!safeName(file.name)) throw new Error(`危険なファイル名: ${file.name}`);
    if (expanded.length >= MAX_FILES) throw new Error('ファイル数の上限を超えました');
    if (file.data.length > MAX_FILE) throw new Error(`ファイルが大きすぎます: ${file.name}`);
    total += file.data.length;
    if (total > MAX_TOTAL) throw new Error('展開後の合計サイズの上限を超えました');
    expanded.push(file);
  };
  for (const file of files) {
    if (file.data.length > MAX_INPUT) throw new Error(`入力ファイルが大きすぎます: ${file.name}`);
    if (!safeName(file.name)) throw new Error(`危険なファイル名: ${file.name}`);
    if (!/\.zip$/i.test(file.name)) { add(file); continue; }
    let zipCount = 0;
    let zipSize = 0;
    const entries = unzipSync(file.data, { filter: (item) => {
      if (!safeName(item.name)) throw new Error(`ZIP内の危険なパス: ${item.name}`);
      zipCount++;
      if (zipCount > MAX_FILES || expanded.length + zipCount > MAX_FILES) throw new Error('ZIP内のファイル数の上限を超えました');
      const supported = /\.(?:json|jsonl|md|markdown|txt|html|htm)$/i.test(item.name);
      if (!item.name.endsWith('/') && !supported) warnings.push({ file: `${file.name}/${item.name}`, message: '対応しない添付ファイルを除外しました' });
      if (!supported || item.name.endsWith('/')) return false;
      if (item.originalSize > MAX_FILE) throw new Error(`ZIP内のファイルが大きすぎます: ${item.name}`);
      zipSize += item.originalSize;
      if (total + zipSize > MAX_TOTAL) throw new Error('ZIP展開サイズの上限を超えました');
      if (item.originalSize > 1024 * 1024 && item.originalSize / Math.max(item.size, 1) > MAX_RATIO) throw new Error(`ZIPの圧縮率が異常です: ${item.name}`);
      return !item.name.endsWith('/') && supported;
    } });
    for (const [name, data] of Object.entries(entries)) {
      if (data.length > MAX_FILE) throw new Error(`ZIP内のファイルが大きすぎます: ${name}`);
      add({ name: `${file.name}/${name}`, data });
    }
    if (!Object.keys(entries).length) warnings.push({ file: file.name, message: '対応する会話ファイルがありません' });
  }
  return { files: expanded, warnings };
}

function push(out: Draft[], warnings: ImportWarning[], draft: Draft) {
  const bytes = Buffer.byteLength(draft.text, 'utf8');
  if (bytes > MAX_MESSAGE) { warnings.push({ file: draft.sourceFile, message: '本文が上限を超えたメッセージを除外しました' }); return; }
  if (draft.text.trim()) out.push(draft);
}

function chatgpt(data: unknown, file: string, account: string, warnings: ImportWarning[]): Draft[] {
  const conversations = Array.isArray(data) ? data : [data];
  const out: Draft[] = [];
  for (const raw of conversations) {
    const conv = record(raw);
    if (!conv || !record(conv.mapping)) continue;
    const mapping = conv.mapping as UnknownRecord;
    const id = string(conv.id) ?? string(conv.conversation_id) ?? digest(JSON.stringify(mapping)).slice(0, 24);
    const title = string(conv.title) ?? '無題の会話';
    let current = string(conv.current_node);
    if (!current || !record(mapping[current])) {
      const leaves = Object.entries(mapping).filter(([, value]) => !Array.isArray(record(value)?.children) || !(record(value)?.children as unknown[]).length);
      current = leaves.at(-1)?.[0];
      warnings.push({ file, message: `${title}: current_node がないため最後の枝を採用しました` });
    }
    const chain: UnknownRecord[] = [];
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const node = record(mapping[current]);
      if (!node) break;
      chain.push(node);
      current = string(node.parent);
    }
    for (const node of chain.reverse()) {
      const msg = record(node.message);
      const author = record(msg?.author);
      const role = author?.role === 'user' || author?.role === 'assistant' ? author.role : undefined;
      if (!role || !msg) continue;
      const text = textParts(msg.content);
      if (!text) { if (record(msg.content)?.content_type !== 'text') warnings.push({ file, message: '添付または非テキストのメッセージを除外しました' }); continue; }
      push(out, warnings, { provider: 'chatgpt', account, conversationId: id, conversationTitle: title, role, text, timestamp: date(msg.create_time), sourceFile: file, nativeMessageId: string(msg.id) ?? string(node.id) });
    }
  }
  return out;
}

function claude(data: unknown, file: string, account: string, warnings: ImportWarning[]): Draft[] {
  const out: Draft[] = [];
  for (const raw of Array.isArray(data) ? data : [data]) {
    const conv = record(raw);
    if (!conv || !Array.isArray(conv.chat_messages)) continue;
    const id = string(conv.uuid) ?? digest(JSON.stringify(conv)).slice(0, 24);
    const title = string(conv.name) ?? '無題の会話';
    for (const rawMessage of conv.chat_messages) {
      const msg = record(rawMessage);
      if (!msg) continue;
      const role = msg.sender === 'human' || msg.role === 'user' ? 'user' : msg.sender === 'assistant' || msg.role === 'assistant' ? 'assistant' : undefined;
      if (!role) continue;
      const text = textParts(msg.text) ?? textParts(msg.content);
      if (!text) { warnings.push({ file, message: '添付または非テキストのメッセージを除外しました' }); continue; }
      push(out, warnings, { provider: 'claude', account, conversationId: id, conversationTitle: title, role, text, timestamp: date(msg.created_at), sourceFile: file, nativeMessageId: string(msg.uuid) });
    }
  }
  return out;
}

function geminiJson(data: unknown, file: string, account: string, warnings: ImportWarning[]): Draft[] {
  const out: Draft[] = [];
  const activities = Array.isArray(data) ? data : Array.isArray(record(data)?.activities) ? record(data)?.activities as unknown[] : [data];
  for (const raw of activities) {
    const item = record(raw);
    if (!item) continue;
    const title = string(item.title) ?? string(item.header) ?? 'Gemini アクティビティ';
    const prompt = textParts(item.prompt);
    const description = textParts(item.description);
    const rawText = prompt ?? textParts(item.text) ?? description ?? title;
    const text = rawText.replace(/^(?:Prompted|Asked)\s+/i, '').trim();
    const timestamp = date(item.time ?? item.timestamp ?? item.createdAt);
    const sourceUrl = string(item.titleUrl) ?? string(item.url);
    const conversationId = string(item.conversationId) ?? sourceUrl ?? digest(JSON.stringify([title, timestamp ?? '', text])).slice(0, 24);
    const role = prompt || /^\s*(?:Prompted|Asked)\s+/i.test(description ?? '') ? 'user' : 'unknown';
    push(out, warnings, { provider: 'gemini', account, conversationId, conversationTitle: title, role, text, timestamp, sourceFile: file, sourceUrl, nativeMessageId: string(item.id) });
    const reply = textParts(item.response);
    if (reply) push(out, warnings, { provider: 'gemini', account, conversationId, conversationTitle: title, role: 'assistant', text: reply, timestamp, sourceFile: file });
  }
  return out;
}

function htmlText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function geminiHtml(html: string, file: string, account: string, warnings: ImportWarning[]): Draft[] {
  const out: Draft[] = [];
  if (!geminiHtmlEvidence(html, file)) { warnings.push({ file, message: 'Gemini Takeoutのアクティビティと確認できないHTMLを除外しました' }); return out; }
  const blocks = html.match(/<div\b[^>]*class=["'][^"']*(?:outer-cell|content-cell|activity)[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*(?:outer-cell|content-cell|activity)[^"']*["']|$)/gi) ?? [];
  for (const [index, block] of blocks.entries()) {
    const text = htmlText(block);
    if (!text) continue;
    const time = block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? block.match(/data-time=["']([^"']+)["']/i)?.[1];
    const timestamp = date(time);
    if (!timestamp) warnings.push({ file, message: 'HTMLのアクティビティ日時を確認できず、日付不明として扱いました' });
    push(out, warnings, { provider: 'gemini', account, conversationId: digest(JSON.stringify([index, text, timestamp ?? ''])).slice(0, 24), conversationTitle: 'Gemini アクティビティ', role: 'unknown', text, timestamp, sourceFile: file });
  }
  if (!out.length) warnings.push({ file, message: 'HTMLから個別のアクティビティを識別できませんでした' });
  return out;
}

function geminiHtmlEvidence(html: string, file: string): boolean {
  return /(?:gemini|bard)/i.test(file) && /class=["'][^"']*(?:outer-cell|content-cell|activity)/i.test(html)
    || /(?:Gemini Apps|Google Gemini|Bard)\b/i.test(html) && /class=["'][^"']*(?:outer-cell|content-cell|activity)/i.test(html);
}

function injectedContext(text: string): boolean {
  return /^\s*(?:<environment_context>|<system_reminder>|#\s*AGENTS\.md\s+instructions\b|AGENTS\.md\s+instructions\s+for\b)/i.test(text);
}

function codex(content: string, file: string, account: string, warnings: ImportWarning[]): Draft[] {
  const response: Draft[] = [];
  const events: Draft[] = [];
  let sessionId: string | undefined;
  for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error(`${file}:${lineIndex + 1}: JSONLが不正です`); }
    const item = record(raw);
    if (!item) continue;
    if (item.type === 'session_meta') sessionId = string(record(item.payload)?.id) ?? sessionId;
    const payload = record(item.payload) ?? item;
    const timestamp = date(item.timestamp ?? payload.timestamp);
    if (item.type === 'response_item' || payload.type === 'message') {
      const message = item.type === 'response_item' ? payload : item;
      if (message.type !== 'message') continue;
      const role = message.role === 'user' || message.role === 'assistant' ? message.role : undefined;
      if (!role) continue;
      const channel = string(message.channel) ?? string(record(message.metadata)?.channel);
      if (role === 'assistant' && channel && channel !== 'final') { warnings.push({ file, message: '非公開のassistant発言を除外しました' }); continue; }
      const text = textParts(message.content);
      if (!text) continue;
      if (role === 'user' && injectedContext(text)) { warnings.push({ file, message: '注入された環境情報を発言から除外しました' }); continue; }
      push(response, warnings, { provider: 'codex', account, conversationId: sessionId ?? digest(file).slice(0, 24), conversationTitle: file.split(/[\\/]/).at(-1) ?? 'Codex', role, text, timestamp, sourceFile: file, nativeMessageId: string(message.id) });
    } else if (item.type === 'event_msg') {
      const role = payload.type === 'user_message' ? 'user' : payload.type === 'agent_message' ? 'assistant' : undefined;
      if (!role) continue;
      const text = textParts(payload.message);
      if (!text) continue;
      if (role === 'user' && injectedContext(text)) { warnings.push({ file, message: '注入された環境情報を発言から除外しました' }); continue; }
      push(events, warnings, { provider: 'codex', account, conversationId: sessionId ?? digest(file).slice(0, 24), conversationTitle: file.split(/[\\/]/).at(-1) ?? 'Codex', role, text, timestamp, sourceFile: file });
    }
  }
  const remaining = new Map<string, Draft[]>();
  const eventKey = (message: Draft) => JSON.stringify([message.role, message.text]);
  for (const message of response) {
    const key = eventKey(message);
    const matches = remaining.get(key) ?? [];
    matches.push(message);
    remaining.set(key, matches);
  }
  for (const event of events) {
    const matches = remaining.get(eventKey(event));
    const match = matches?.findIndex((candidate) => !candidate.timestamp || !event.timestamp || Math.abs(Date.parse(candidate.timestamp) - Date.parse(event.timestamp)) <= 120000) ?? -1;
    if (match >= 0) matches!.splice(match, 1);
    else response.push(event);
  }
  const firstUser = response.find(message => message.role === 'user');
  const title = firstUser?.text.replace(/\s+/g, ' ').slice(0, 100);
  if (title) for (const message of response) message.conversationTitle = title;
  return response.sort((a, b) => a.timestamp && b.timestamp ? a.timestamp.localeCompare(b.timestamp) : 0);
}

function markdown(content: string, file: string, account: string, warnings: ImportWarning[]): Draft[] {
  let parsed: ReturnType<typeof parseSafeFrontmatter>;
  try { parsed = parseSafeFrontmatter(content); } catch { throw new Error(`${file}: frontmatterが不正です`); }
  const text = parsed.content.trim();
  if (!text) return [];
  const title = string(parsed.data.title) ?? file.split(/[\\/]/).at(-1)?.replace(/\.(?:md|markdown|txt)$/i, '') ?? 'テキスト';
  const sourceUrl = string(parsed.data.source);
  const timestamp = date(parsed.data.createdAt instanceof Date ? parsed.data.createdAt.toISOString() : parsed.data.createdAt);
  const out: Draft[] = [];
  push(out, warnings, { provider: 'markdown', account, conversationId: digest(`${account}:${file}:${digest(content)}`).slice(0, 24), conversationTitle: title, role: 'unknown', text, timestamp, sourceFile: file, sourceUrl });
  return out;
}

function geminiJsonEvidence(data: unknown, name: string): boolean {
  const root = record(data);
  const items = Array.isArray(data) ? data : Array.isArray(root?.activities) ? root.activities as unknown[] : [data];
  return items.some((raw) => {
    const item = record(raw);
    if (!item) return false;
    const products = Array.isArray(item.products) ? item.products.filter((p): p is string => typeof p === 'string').join(' ') : '';
    const evidence = [products, string(item.header), string(item.title), string(item.titleUrl), string(item.url)].filter(Boolean).join(' ');
    return /(?:Gemini Apps|Google Gemini|gemini\.google\.com|\bBard\b)/i.test(evidence)
      || /gemini/i.test(name) && Boolean(item.time || item.timestamp || item.prompt || item.description);
  });
}

function infer(data: unknown, name: string, content: string): ConversationProvider | undefined {
  if (/\.jsonl$/i.test(name)) return 'codex';
  if (/\.(?:md|markdown|txt)$/i.test(name)) return 'markdown';
  if (/\.html?$/i.test(name)) return geminiHtmlEvidence(content, name) ? 'gemini' : undefined;
  const sample = Array.isArray(data) ? data[0] : data;
  const obj = record(sample);
  if (record(obj?.mapping)) return 'chatgpt';
  if (Array.isArray(obj?.chat_messages)) return 'claude';
  if (geminiJsonEvidence(data, name)) return 'gemini';
  return undefined;
}

export function parseConversationFiles(files: InputFile[], options: { provider?: ConversationProvider | 'auto'; account?: string } = {}): ParsedConversations {
  const expanded = expand(files);
  const warnings = [...expanded.warnings];
  const drafts: { draft: Draft; fileIndex: number }[] = [];
  const account = options.account?.trim() ?? '';
  for (const [fileIndex, file] of expanded.files.entries()) {
    if (!/\.(?:json|jsonl|md|markdown|txt|html|htm)$/i.test(file.name)) { warnings.push({ file: file.name, message: '対応しない添付ファイルを除外しました' }); continue; }
    let content: string;
    try { content = decoder.decode(file.data); } catch { warnings.push({ file: file.name, message: 'UTF-8テキストではないため除外しました' }); continue; }
    const isJson = /\.json$/i.test(file.name);
    let data: unknown;
    if (isJson) {
      try { data = JSON.parse(content); } catch { throw new Error(`${file.name}: JSONが不正です`); }
    }
    const provider = options.provider && options.provider !== 'auto' ? options.provider : infer(data, file.name, content);
    if (!provider) { warnings.push({ file: file.name, message: '会話形式を識別できませんでした' }); continue; }
    const parsed = provider === 'chatgpt' ? chatgpt(data, file.name, account, warnings)
      : provider === 'claude' ? claude(data, file.name, account, warnings)
      : provider === 'gemini' ? isJson ? geminiJson(data, file.name, account, warnings) : geminiHtml(content, file.name, account, warnings)
      : provider === 'codex' ? codex(content, file.name, account, warnings)
      : markdown(content, file.name, account, warnings);
    if (!parsed.length) warnings.push({ file: file.name, message: '読み取れる発言がありませんでした' });
    drafts.push(...parsed.map((draft) => ({ draft, fileIndex })));
  }
  const seen = new Set<string>();
  const fallbackOccurrences = new Map<string, number>();
  const messages: ConversationMessage[] = [];
  for (const { draft, fileIndex } of drafts) {
    const { nativeMessageId, ...unscoped } = draft;
    const base = { ...unscoped, conversationId: `${draft.provider}:${digest(draft.account).slice(0, 12)}:${digest(draft.conversationId).slice(0, 24)}` };
    const hash = digest(base.text);
    const fallback = JSON.stringify([base.provider, base.account, base.conversationId, base.role, base.timestamp ?? '', hash]);
    const occurrenceKey = `${fileIndex}:${fallback}`;
    const occurrence = fallbackOccurrences.get(occurrenceKey) ?? 0;
    fallbackOccurrences.set(occurrenceKey, occurrence + 1);
    const id = digest(JSON.stringify([base.provider, base.account, base.conversationId, nativeMessageId ?? [base.role, base.timestamp ?? '', hash, occurrence], hash]));
    if (seen.has(id)) continue;
    seen.add(id);
    messages.push({ ...base, id, hash });
  }
  return { messages, warnings, files: expanded.files.length };
}

function dayBoundary(value: string, next: boolean): number {
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error('日付はYYYY-MM-DDで指定してください');
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error('存在しない日付です');
  return Date.UTC(year, month - 1, day + Number(next), -9);
}

export function selectMessages(messages: ConversationMessage[], selection: ImportSelection): ConversationMessage[] {
  const from = selection.from ? dayBoundary(selection.from, false) : -Infinity;
  const to = selection.to ? dayBoundary(selection.to, true) : Infinity;
  if (from >= to) throw new Error('終了日は開始日以降にしてください');
  const providers = selection.providers ? new Set(selection.providers) : undefined;
  const accounts = selection.accounts ? new Set(selection.accounts) : undefined;
  const excluded = new Set(selection.excludedConversationIds ?? []);
  return messages.filter((message) => {
    if (providers && !providers.has(message.provider)) return false;
    if (accounts && !accounts.has(message.account)) return false;
    if (excluded.has(message.conversationId)) return false;
    if (!message.timestamp) return Boolean(selection.includeUndated);
    const time = Date.parse(message.timestamp);
    return Number.isFinite(time) && time >= from && time < to;
  });
}
