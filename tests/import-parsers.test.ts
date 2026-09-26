import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseConversationFiles, selectMessages } from '../src/lib/imports/parsers';

const file = (name: string, value: unknown) => ({ name, data: strToU8(typeof value === 'string' ? value : JSON.stringify(value)) });

test('ChatGPT current_node の枝だけを日時順に採用する', () => {
  const message = (id: string, role: string, text: string) => ({ id, author: { role }, content: { content_type: 'text', parts: [text] }, create_time: 1780000000 });
  const mapping = {
    root: { id: 'root', parent: null, children: ['u'], message: null },
    u: { id: 'u', parent: 'root', children: ['old', 'new'], message: message('u', 'user', '質問') },
    old: { id: 'old', parent: 'u', children: [], message: message('old', 'assistant', '旧回答') },
    new: { id: 'new', parent: 'u', children: [], message: message('new', 'assistant', '採用回答') },
  };
  const result = parseConversationFiles([file('conversations.json', [{ id: 'c1', title: '枝', current_node: 'new', mapping }])]);
  assert.deepEqual(result.messages.map((m) => m.text), ['質問', '採用回答']);
  assert.equal(result.messages[0].provider, 'chatgpt');
  assert.match(result.messages[0].conversationId, /^chatgpt:/);
  assert.equal(result.messages[0].timestamp, '2026-05-28T20:26:40.000Z');
  assert.deepEqual(parseConversationFiles([file('conversations.json', [{ id: 'c1', title: '枝', current_node: 'new', mapping }])]).messages.map((m) => m.id), result.messages.map((m) => m.id));
});

test('Claude の text/content と日付欠落を扱う', () => {
  const result = parseConversationFiles([file('claude.json', [{ uuid: 'c2', name: 'Claude会話', chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'こんにちは', created_at: '2026-09-23T23:00:00Z' },
    { uuid: 'm2', sender: 'assistant', content: [{ type: 'text', text: '回答' }, { type: 'image', source: 'hidden' }], updated_at: '2026-09-24T00:00:00Z' },
  ] }])], { account: 'personal' });
  assert.deepEqual(result.messages.map((m) => [m.role, m.text]), [['user', 'こんにちは'], ['assistant', '回答']]);
  assert.equal(result.messages[1].timestamp, undefined);
  assert.equal(result.messages[0].account, 'personal');
});

test('Gemini My Activity JSON/HTML は可視本文のみ抽出する', () => {
  const json = parseConversationFiles([file('MyActivity.json', [{ title: 'Used Gemini Apps', titleUrl: 'https://gemini.google.com/app/a', time: '2026-09-24T00:00:00Z', description: 'Prompted 天気は？' }])]);
  assert.equal(json.messages[0].text, '天気は？');
  assert.equal(json.messages[0].role, 'user');
  assert.equal(json.messages[0].sourceUrl, 'https://gemini.google.com/app/a');
  const html = parseConversationFiles([file('MyActivity.html', '<div class="header">Gemini Apps</div><div class="outer-cell"><time datetime="2026-09-24T00:00:00Z"></time><div>Geminiで質問</div></div>')]);
  assert.equal(html.messages.length, 1);
  assert.equal(html.messages[0].timestamp, '2026-09-24T00:00:00.000Z');
  assert.equal(html.messages[0].role, 'unknown');
});

test('Codex JSONL は response_item と重複する event_msg を除外する', () => {
  const lines = [
    { type: 'session_meta', payload: { id: 'session-1' } },
    { timestamp: '2026-09-24T01:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '実装して' }] } },
    { timestamp: '2026-09-24T01:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: '実装して' } },
    { timestamp: '2026-09-24T01:00:02Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完了' }] } },
    { timestamp: '2026-09-24T01:00:03Z', type: 'event_msg', payload: { type: 'agent_message', message: '完了' } },
    { timestamp: '2026-09-24T01:00:04Z', type: 'response_item', payload: { type: 'function_call', name: 'exec' } },
  ];
  const result = parseConversationFiles([file('rollout.jsonl', lines.map((x) => JSON.stringify(x)).join('\n'))]);
  assert.deepEqual(result.messages.map((m) => m.text), ['実装して', '完了']);
  assert.match(result.messages[0].conversationId, /^codex:/);
});

test('Markdown frontmatter と日付不明の既定除外、JST半開区間', () => {
  const parsed = parseConversationFiles([file('notes.md', '---\ntitle: 記録\ncreatedAt: 2026-09-23T15:00:00Z\nsource: https://example.com/1\n---\n本文'), file('plain.txt', '日時なし')]);
  assert.equal(parsed.messages[0].conversationTitle, '記録');
  assert.equal(parsed.messages[0].sourceUrl, 'https://example.com/1');
  assert.deepEqual(selectMessages(parsed.messages, { from: '2026-09-24', to: '2026-09-24' }).map((m) => m.text), ['本文']);
  assert.equal(selectMessages(parsed.messages, { from: '2026-09-25', to: '2026-09-25' }).length, 0);
  assert.equal(selectMessages(parsed.messages, { from: '2026-09-25', includeUndated: true }).length, 1);
  assert.equal(selectMessages(parsed.messages, { providers: ['claude'], includeUndated: true }).length, 0);
  assert.equal(selectMessages(parsed.messages, { accounts: ['other'], includeUndated: true }).length, 0);
  assert.equal(selectMessages(parsed.messages, { excludedConversationIds: [parsed.messages[0].conversationId] }).length, 0);
  assert.throws(() => selectMessages([], { from: '2026-02-30' }));
  assert.throws(() => selectMessages([], { from: '2026-09-25', to: '2026-09-24' }));
});

test('ZIP の安全性、添付警告、壊れた JSON', () => {
  const zip = zipSync({ 'safe/log.md': strToU8('本文'), 'attachment.png': new Uint8Array([1, 2, 3]) });
  const result = parseConversationFiles([{ name: 'export.zip', data: zip }]);
  assert.equal(result.messages.length, 1);
  assert.ok(result.warnings.some((w) => w.message.includes('添付')));
  assert.throws(() => parseConversationFiles([file('../bad.md', '本文')]), /危険/);
  assert.throws(() => parseConversationFiles([{ name: 'export.zip', data: zipSync({ '../bad.md': strToU8('本文') }) }]), /危険/);
  assert.throws(() => parseConversationFiles([file('broken.json', '{')]), /JSONが不正/);
  assert.throws(() => parseConversationFiles([{ name: 'bomb.zip', data: zipSync({ 'large.md': strToU8('a'.repeat(2 * 1024 * 1024)) }) }]), /圧縮率/);
  const hugeAttachment = zipSync({ 'large.png': strToU8('a'.repeat(34 * 1024 * 1024)), 'log.md': strToU8('記録') });
  assert.equal(parseConversationFiles([{ name: 'export.zip', data: hugeAttachment }]).messages.length, 1);
});

test('HTML/JSONはGemini証跡がなければ自動認識しない', () => {
  const chat = parseConversationFiles([file('chat.html', '<div class="activity">ChatGPT transcript</div>')]);
  assert.equal(chat.messages.length, 0);
  assert.ok(chat.warnings.some((w) => w.message.includes('識別')));
  const generic = parseConversationFiles([file('activity.json', [{ title: 'Search', time: '2026-09-24T00:00:00Z', header: 'My Activity' }])]);
  assert.equal(generic.messages.length, 0);
  const gemini = parseConversationFiles([file('activity.json', [{ products: ['Gemini Apps'], title: 'Used Gemini Apps', time: '2026-09-24T00:00:00Z' }])]);
  assert.equal(gemini.messages.length, 1);
  assert.equal(gemini.messages[0].role, 'unknown');
  const undatedHtml = parseConversationFiles([file('Gemini.html', '<div class="activity">Gemini Apps activity</div>')]);
  assert.equal(undatedHtml.messages[0].timestamp, undefined);
  assert.ok(undatedHtml.warnings.some((w) => w.message.includes('日時')));
});

test('Codexのanalysisと注入環境情報を除外する', () => {
  const lines = [
    { type: 'session_meta', payload: { id: 'session' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>secret</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for workspace' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: '内部推論' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '利用者向け回答' }] } },
  ];
  const parsed = parseConversationFiles([file('rollout.jsonl', lines.map((x) => JSON.stringify(x)).join('\n'))]);
  assert.deepEqual(parsed.messages.map((m) => m.text), ['利用者向け回答']);
  assert.ok(parsed.warnings.some((w) => w.message.includes('環境情報')));
});

test('会話IDはサービスとアカウント別、fallback IDは再アップロードで安定する', () => {
  const claude = [{ uuid: 'same-id', name: '会話', chat_messages: [{ sender: 'human', text: '同文' }, { sender: 'human', text: '同文' }] }];
  const one = parseConversationFiles([file('claude.json', claude)], { account: 'a' });
  const twice = parseConversationFiles([file('claude.json', claude), file('claude.json', claude)], { account: 'a' });
  assert.equal(one.messages.length, 2);
  assert.deepEqual(twice.messages.map((m) => m.id), one.messages.map((m) => m.id));
  assert.notEqual(one.messages[0].conversationId, parseConversationFiles([file('claude.json', claude)], { account: 'b' }).messages[0].conversationId);
  const chatgpt = parseConversationFiles([file('chatgpt.json', [{ conversation_id: 'same-id', current_node: 'm', mapping: { m: { id: 'm', parent: null, children: [], message: { id: 'm', author: { role: 'user' }, content: { parts: ['同文'] } } } } }])]);
  assert.notEqual(one.messages[0].conversationId, chatgpt.messages[0].conversationId);
});

test('無効なISO日時は日付不明とする', () => {
  const parsed = parseConversationFiles([file('claude.json', [{ uuid: 'c', chat_messages: [{ sender: 'human', text: '無効', created_at: '2026-02-30T10:00:00Z' }] }])]);
  assert.equal(parsed.messages[0].timestamp, undefined);
  assert.equal(selectMessages(parsed.messages, { from: '2026-02-01', to: '2026-02-28' }).length, 0);
});
