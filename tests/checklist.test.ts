import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EntryMarkdown from '../src/components/EntryMarkdown';
import { inspectChecklistLine, toggleChecklistLine } from '../src/lib/checklist';

test('toggles only the selected duplicate GFM item and preserves Markdown', () => {
  const body = '- [ ] **同じ** [リンク](https://example.com)\n- [ ] **同じ** [リンク](https://example.com)';
  const second = body.lastIndexOf('- [ ]');
  const checked = toggleChecklistLine(body, second);
  assert.equal(checked, '- [ ] **同じ** [リンク](https://example.com)\n- [x] **同じ** [リンク](https://example.com)');
  assert.equal(toggleChecklistLine(checked, second), body);
});

test('converts plain bullet and numbered items without changing their content', () => {
  assert.equal(toggleChecklistLine('- 牛乳', 0), '- [x] 牛乳');
  assert.equal(toggleChecklistLine('12. **牛乳**', 0), '12. [x] **牛乳**');
  assert.deepEqual(inspectChecklistLine('12. [x] **牛乳**', 0), { checked: true, explicit: true });
  assert.equal(toggleChecklistLine('12. [x] **牛乳**', 0), '12. [ ] **牛乳**');
});

test('does not rewrite an unrelated position', () => {
  const body = '```\n- 偽物\n```\n- 本物';
  assert.equal(toggleChecklistLine(body, body.indexOf('偽物')), body);
  assert.equal(toggleChecklistLine(body, body.lastIndexOf('- 本物')), '```\n- 偽物\n```\n- [x] 本物');
});

test('renders check controls for GFM items and plain leaves, leaving parents and code alone', () => {
  const body = '- [ ] **買う** [店](https://example.com)\n- 親\n  - 子\n1. 番号\n```\n- 偽\n```';
  const html = renderToStaticMarkup(React.createElement(EntryMarkdown, { body, autoChecklist: true, disabled: false, onToggle: () => {} }));
  assert.equal((html.match(/role="checkbox"/g) ?? []).length, 3);
  assert.match(html, /aria-label="買う 店"/);
  assert.match(html, /<li>親/);
  assert.match(html, /<strong>買う<\/strong> <a href="https:\/\/example.com">店<\/a>/);
  assert.match(html, /<pre><code>- 偽\n<\/code><\/pre>/);
});
