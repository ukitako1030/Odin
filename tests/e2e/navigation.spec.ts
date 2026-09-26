import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} back and forward restore sections, search and details`, async ({ page, request }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const response = await request.post('/api/entries', {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { title: `戻る検証 ${mobile}`, kind: 'knowledge', body: '履歴から正しい画面へ戻る', tags: [] },
    });
    const { entry } = await response.json();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
    await page.locator('.dashboard-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/screenshots/home-clear-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.getByRole('button', { name: 'タスク', exact: true }).last().click();
    await expect(page).toHaveURL(/section=task/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/section=task/);
    await page.getByRole('button', { name: '記録を検索', exact: true }).last().click();
    await page.getByRole('dialog').getByRole('textbox').fill(entry.title);
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(entry.title) }).click();
    await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(entry.title);
    await page.goForward();
    await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/navigation-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(entry.title);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
    await page.goto(`/?entry=${entry.id}`);
    await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/section=knowledge/);
  });
}

test('browser forward restores an unsaved editor draft', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
  await page.getByRole('button', { name: '新しい記録を作成', exact: true }).click();
  await page.getByRole('dialog').getByLabel('タイトル', { exact: true }).fill('まだ保存していない記憶');
  await page.getByRole('dialog').getByLabel('本文', { exact: false }).fill('戻っても入力を失わない');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('dialog').getByLabel('タイトル', { exact: true })).toHaveValue('まだ保存していない記憶');
  await expect(page.getByRole('dialog').getByLabel('本文', { exact: false })).toHaveValue('戻っても入力を失わない');
});
