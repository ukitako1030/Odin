import test from 'node:test';
import assert from 'node:assert/strict';
import { englishMessages, localizedKindLabels, normalizeLocale, translate } from '../src/lib/i18n';

test('locale preferences accept only supported languages', () => {
  assert.equal(normalizeLocale('en'), 'en');
  for (const value of [undefined, '', 'ja', 'fr', '<script>']) assert.equal(normalizeLocale(value), 'ja');
});

test('UI translation preserves record text passed as a parameter and unknown diagnostics', () => {
  assert.equal(translate('ja', '設定'), '設定');
  assert.equal(translate('en', '設定'), 'Settings');
  const template = Object.keys(englishMessages).find(key => key.includes('{title}'))!;
  assert.ok(template);
  const title = '日本語の記憶 {count} <b> & English';
  assert.ok(translate('en', template, { title }).includes(title));
  assert.equal(translate('en', 'Unknown diagnostic: 123'), 'Unknown diagnostic: 123');
  assert.equal(translate('en', 'toString'), 'toString');
});

test('every translation preserves template parameters', () => {
  const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [source, english] of Object.entries(englishMessages)) {
    assert.ok(english.trim(), `Empty translation: ${source}`);
    assert.deepEqual(parameters(english), parameters(source), `Parameter mismatch: ${source}`);
  }
});

test('changing kind labels keeps the persisted record identifiers', () => {
  assert.deepEqual(Object.keys(localizedKindLabels('ja')).sort(), Object.keys(localizedKindLabels('en')).sort());
  assert.equal(localizedKindLabels('en').knowledge, 'Knowledge');
  assert.equal(localizedKindLabels('ja').knowledge, 'ナレッジ');
});

test('dynamic import diagnostics retain original filenames and conversation titles', () => {
  assert.equal(translate('en', '旅行の記憶: current_node がないため最後の枝を採用しました'), '旅行の記憶: Used the last branch because current_node is missing.');
  assert.equal(translate('en', 'ファイルが大きすぎます: 日本語.json'), 'File too large: 日本語.json');
  assert.equal(translate('ja', 'ファイルが大きすぎます: 日本語.json'), 'ファイルが大きすぎます: 日本語.json');
});
