import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const origin = 'http://127.0.0.1:3100';
const conversations = [{
  id: 'e2e-import-source', title: 'E2E 週次レビューの相談', current_node: 'after', mapping: {
    old: { id: 'old', parent: null, message: { id: 'old', author: { role: 'user' }, create_time: Date.parse('2026-09-22T14:59:59Z') / 1000, content: { parts: ['範囲外の古い相談。'] } } },
    user: { id: 'user', parent: 'old', message: { id: 'user', author: { role: 'user' }, create_time: Date.parse('2026-09-23T01:00:00Z') / 1000, content: { parts: ['毎週日曜日に記録を振り返ると決めました。'] } } },
    assistant: { id: 'assistant', parent: 'user', message: { id: 'assistant', author: { role: 'assistant' }, create_time: Date.parse('2026-09-24T14:59:59Z') / 1000, content: { parts: ['週次レビューでは今週の学びを三つにまとめます。'] } } },
    after: { id: 'after', parent: 'assistant', message: { id: 'after', author: { role: 'user' }, create_time: Date.parse('2026-09-24T15:00:00Z') / 1000, content: { parts: ['翌日の期間外の発言。'] } } },
  },
}];
const upload = { name: 'conversations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(conversations)) };

test('period selection, editable evidence draft, persistence, and searchable knowledge work on desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/import');
  await page.getByLabel('会話履歴ファイル').setInputFiles(upload);
  await page.getByLabel('取り込み名').fill('E2E 知識の取り込み');
  await page.getByRole('button', { name: /^履歴を読み込む/ }).click();
  await expect(page.getByRole('heading', { name: '残したい範囲を選ぶ' })).toBeVisible();
  const scope = page.locator('section').filter({ has: page.getByRole('heading', { name: '残したい範囲を選ぶ' }) });
  await scope.getByLabel('開始日').fill('2026-09-23');
  await scope.getByLabel('終了日').fill('2026-09-24');
  await page.getByRole('button', { name: /^原文から下書きを作る/ }).click();
  await page.getByRole('button', { name: /E2E 週次レビューの相談/ }).click();
  const title = page.getByLabel('タイトル', { exact: true });
  await expect(title).toBeVisible();
  await expect(page.getByRole('textbox', { name: '本文', exact: true })).not.toHaveValue(/翌日の期間外/);
  await title.fill('E2E 日曜レビューの習慣');
  await page.getByRole('textbox', { name: '本文', exact: true }).fill('毎週日曜日に記録を振り返る。実行状況を後から追記する。');
  await page.getByLabel('タグ', { exact: false }).fill('週次, 習慣');
  await page.getByRole('heading', { name: '候補を確認して保存' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('docs/screenshots/import-review-desktop.png') });
  // The save action must include the draft on screen without a separate "apply" click.
  await page.getByRole('button', { name: /^この候補を保存/ }).click();
  await expect(page.getByRole('link', { name: '保存した記録を開く ↗' })).toBeVisible();
  const savedUrl = await page.getByRole('link', { name: '保存した記録を開く ↗' }).getAttribute('href');
  await page.getByRole('link', { name: '保存した記録を開く ↗' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'E2E 日曜レビューの習慣', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('出典（会話履歴から承認して保存）');
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'E2E 日曜レビューの習慣', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '記録を検索', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('日曜 #習慣');
  await expect(page.getByRole('dialog').getByRole('button', { name: /E2E 日曜レビューの習慣/ })).toBeVisible();
  await page.goto(savedUrl!);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve('docs/screenshots/import-saved-mobile.png'), fullPage: true });
  await page.goto('/import');
  await page.getByRole('button', { name: /E2E 知識の取り込み/ }).click();
  await page.getByRole('button', { name: /E2E 日曜レビューの習慣/ }).click();
  await expect(page.getByRole('link', { name: '保存した記録を開く ↗' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('heading', { name: '候補を確認して保存' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('docs/screenshots/import-review-mobile.png') });
  expect(errors).toEqual([]);
});

test('external AI proposals are staged, validated, append safely and survive retry', async ({ request, page }) => {
  const created = await request.post('/api/imports', { headers: { Origin: origin }, multipart: { files: upload, title: 'E2E 外部AI候補' } });
  expect(created.status()).toBe(201);
  let { batch } = await created.json();
  const source = batch.messages.find((m: { text: string }) => m.text.startsWith('毎週日曜日'));
  const candidate = { title: 'E2E AIが抽出した学び', body: '日曜日を記録の振り返りに使うという本人の判断。', kind: 'knowledge', tags: ['振り返り'], evidence: [{ messageId: source.id, quote: source.text }] };
  const bad = await request.patch(`/api/imports/${batch.id}`, { headers: { Origin: 'https://unrelated.invalid' }, data: { action: 'candidates', candidates: [candidate], expectedRevision: batch.revision } });
  expect(bad.status()).toBe(403);
  const fabricated = await request.patch(`/api/imports/${batch.id}`, { headers: { Origin: origin }, data: { action: 'candidates', candidates: [{ ...candidate, evidence: [{ messageId: source.id, quote: '存在しない発言です' }] }], expectedRevision: batch.revision } });
  expect(fabricated.status()).toBe(400);
  await page.goto(`/import?batch=${batch.id}`);
  await expect(page.getByRole('heading', { name: 'E2E 外部AI候補', exact: true })).toBeVisible();
  await page.getByLabel('候補JSON', { exact: false }).fill(JSON.stringify({ candidates: [candidate] }));
  await page.getByRole('button', { name: /候補を受け取る/ }).click();
  await page.getByRole('button', { name: /E2E AIが抽出した学び/ }).click();
  let entries = (await (await request.get('/api/entries')).json()).entries;
  expect(entries.some((e: { title: string }) => e.title === candidate.title)).toBe(false);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /対象JSONをダウンロード/ }).click();
  await download;
  await expect(page.getByRole('button', { name: /E2E AIが抽出した学び/ })).toBeVisible();
  await page.getByRole('button', { name: /^この候補を保存/ }).click();
  await expect(page.getByRole('link', { name: '保存した記録を開く ↗' })).toBeVisible();
  ({ batch } = await (await request.get(`/api/imports/${batch.id}`)).json());
  const replay = await request.patch(`/api/imports/${batch.id}`, { headers: { Origin: origin }, data: { action: 'commit', candidateIds: [batch.candidates[0].id], expectedRevision: batch.revision } });
  expect(replay.ok()).toBe(true);
  ({ batch } = await replay.json());
  entries = (await (await request.get('/api/entries')).json()).entries;
  expect(entries.filter((e: { title: string }) => e.title === candidate.title)).toHaveLength(1);
  const invalidRange = await request.patch(`/api/imports/${batch.id}`, { headers: { Origin: origin }, data: { action: 'select', selection: { from: '2026-02-30' }, expectedRevision: batch.revision } });
  expect(invalidRange.status()).toBe(400);
});
