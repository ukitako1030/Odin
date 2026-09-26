import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} home brings tasks reminders and shopping together`, async ({ page, request }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const headers = { Origin: 'http://127.0.0.1:3100' };
    await request.get('/api/entries');
    const existing = (await (await request.get('/api/entries')).json()).entries;
    for (const item of existing.filter((item: { kind: string }) => ['task', 'reminder', 'shopping'].includes(item.kind))) {
      await request.patch(`/api/entries/${item.id}`, { headers, data: { status: 'done', expectedRevision: item.revision } });
    }
    const fixtures = [
      { title: '資料を提出する', kind: 'task', dueAt: '2026-09-24T00:00:00+09:00' },
      { title: '予約の時間を確認する', kind: 'reminder', dueAt: '2026-09-25T00:00:00+09:00' },
      { title: 'コーヒー豆を買う', kind: 'shopping', dueAt: '2026-09-26T00:00:00+09:00' },
      ...Array.from({ length: 4 }, (_, i) => ({ title: `日付のないタスク${i}`, kind: 'task' })),
    ];
    for (const fixture of fixtures) await request.post('/api/entries', { headers, data: { ...fixture, body: '次にすることを確認。', tags: [] } });
    await page.goto('/');
    const panel = page.locator('.today-panel');
    await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
    await expect(panel.locator('.today-row')).toHaveCount(6);
    await expect(panel.locator('.today-row').nth(0)).toContainText('資料を提出する');
    await expect(panel.locator('.today-row').nth(1)).toContainText('予約の時間を確認する');
    await expect(panel.locator('.today-row').nth(2)).toContainText('コーヒー豆を買う');
    await expect(panel.locator('.tiny-rune')).toHaveCount(0);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/screenshots/home-actions-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await panel.getByRole('button', { name: /もっと見る/ }).click();
    await expect(panel.locator('.today-row')).toHaveCount(7);
    await panel.getByRole('button', { name: 'コーヒー豆を買うを完了にする', exact: true }).click();
    await expect(panel.locator('.today-row')).toHaveCount(6);
    await panel.getByRole('button', { name: 'リマインダー', exact: true }).click();
    await expect(page).toHaveURL(/section=reminder/);
    await page.goBack();
    await panel.getByRole('button', { name: '買い物', exact: true }).click();
    await expect(page).toHaveURL(/section=shopping/);
  });
}
