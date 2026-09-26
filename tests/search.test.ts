import assert from 'node:assert/strict';
import test from 'node:test';
import { entryMatchesQuery, searchEntries } from '../src/lib/search';
import type { Entry } from '../src/lib/types';

test('knowledge search combines words, supports exact tags and ranks titles before cited mentions', () => {
  const base: Entry = { id: 'test', title: 'Ｏｄｉｎの保存方式', kind: 'knowledge', body: 'Markdownを正本にする。', tags: ['設計', '保存'], status: 'active', revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  assert.equal(entryMatchesQuery(base, 'odin Markdown #設計'), true);
  assert.equal(entryMatchesQuery(base, 'odin #計'), false);
  assert.equal(entryMatchesQuery(base, 'odin 不在の語'), false);
  assert.equal(entryMatchesQuery(base, '"Markdownを正本"'), true);
  const other = { ...base, id: 'other', title: '別の記録', updatedAt: '2026-02-01', body: '会話ではOdinの保存方式に触れている。' };
  assert.equal(searchEntries([other, base], 'Odin')[0].id, 'test');
  assert.equal(entryMatchesQuery({ ...base, title: '記録', body: '日曜の振り返り\n<!-- odin-import:internal-marker -->' }, 'odin'), false);
});

test('empty search preserves inputs and orders by update time, while tag-only queries normalize exact tags', () => {
  const base: Entry = { id: 'older', title: '古い記録', kind: 'memo', body: '', tags: ['ＡＩ', '設計'], status: 'active', revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const newer = { ...base, id: 'newer', title: '新しい記録', tags: ['AI研究'], updatedAt: '2026-02-01' };
  const entries = [base, newer];
  assert.deepEqual(searchEntries(entries, '  ').map(entry => entry.id), ['newer', 'older']);
  assert.deepEqual(entries.map(entry => entry.id), ['older', 'newer']);
  assert.deepEqual(searchEntries(entries, '#ai #設計').map(entry => entry.id), ['older']);
  assert.equal(entryMatchesQuery(newer, '#ai'), false);
  base.tags = ['更新'];
  assert.deepEqual(searchEntries(entries, '#ai'), []);
});

test('ranking keeps title matches ahead of body matches and uses update time for equal scores', () => {
  const base: Entry = { id: 'exact', title: 'Odin', kind: 'knowledge', body: '保存について', tags: ['保存'], status: 'active', revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const entries = [
    { ...base, id: 'body', title: '保存について', body: 'Odin', updatedAt: '2026-03-01' },
    { ...base, id: 'prefix-older', title: 'Odinの記録' },
    { ...base, id: 'prefix-newer', title: 'Odinの仕様', updatedAt: '2026-02-01' },
    base,
  ];
  assert.deepEqual(searchEntries(entries, 'ｏｄｉｎ').map(entry => entry.id), ['exact', 'prefix-newer', 'prefix-older', 'body']);
  assert.deepEqual(searchEntries(entries, '"保存について"').map(entry => entry.id), ['body', 'prefix-newer', 'prefix-older', 'exact']);
});
