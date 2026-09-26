import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} checklist persists individual items and handles save errors`, async ({ page, request }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    // Initialize the dedicated test vault before adding fixtures.
    await request.get('/api/entries');
    const body = '週末に必要なもの\n\n- コーヒー豆\n- ノート\n- [x] 牛乳\n\n買い忘れをひとつずつ確認。';
    const response = await request.post('/api/entries', {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { title: '週末の買い物', kind: 'shopping', body, tags: ['暮らし'] },
    });
    const { entry } = await response.json();
    await page.goto(`/?entry=${entry.id}`);
    const checks = page.locator('.detail-body').getByRole('checkbox');
    await expect(checks).toHaveCount(3);
    await checks.nth(0).focus();
    await page.keyboard.press('Space');
    await expect(checks.nth(0)).toBeChecked();
    await expect(page.getByRole('dialog').getByRole('button', { name: '編集', exact: true })).toBeEnabled();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.reload();
    await expect(checks.nth(0)).toBeChecked();
    await expect(checks.nth(1)).not.toBeChecked();
    await expect(checks.nth(2)).toBeChecked();
    await page.screenshot({ path: `docs/screenshots/checklist-${mobile ? 'mobile' : 'desktop'}.png` });
    await checks.nth(0).click();
    await expect(checks.nth(0)).not.toBeChecked();
    await expect(page.getByRole('dialog').getByRole('button', { name: '編集', exact: true })).toBeEnabled();
    const saved = (await (await request.get(`/api/entries/${entry.id}`)).json()).entry;
    expect(saved.body).toContain('- [ ] コーヒー豆');
    expect(saved.body).toContain('- ノート');
    expect(saved.status).toBe('active');
    await page.route(`**/api/entries/${entry.id}`, async route => {
      if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { error: { message: '保存のテストエラー' } } });
      else await route.continue();
    });
    await checks.nth(1).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('保存のテストエラー');
    await expect(checks.nth(1)).toBeChecked();
    await expect(checks.nth(1)).toBeEnabled();
    await page.unrouteAll();
    await page.getByRole('button', { name: '再試行', exact: true }).click();
    await expect(checks.nth(1)).toBeChecked();
    await expect(checks.nth(1)).toBeEnabled();
    await expect(page.getByRole('dialog').getByRole('button', { name: '編集', exact: true })).toBeEnabled();
    const latest = (await (await request.get(`/api/entries/${entry.id}`)).json()).entry;
    await request.patch(`/api/entries/${entry.id}`, {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { body: `${latest.body}\n\n別端末からの追記`, expectedRevision: latest.revision },
    });
    await checks.nth(2).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: '未保存分を取り消して再読み込み' }).click();
    await expect(page.locator('.detail-body')).toContainText('別端末からの追記');
    await expect(checks.nth(2)).toBeChecked();
    await expect(checks.nth(2)).toBeEnabled();
    await checks.nth(2).click();
    await expect(checks.nth(2)).not.toBeChecked();
    await expect(page.getByRole('dialog').getByRole('button', { name: '編集', exact: true })).toBeEnabled();
  });
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} rapid checks respond before a slow save and keep latest state`, async ({ page, request }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await request.get('/api/entries');
    const { entry } = await (await request.post('/api/entries', {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { title: '続けてチェック', kind: 'shopping', body: '- 牛乳\n- パン\n- 卵', tags: [] },
    })).json();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writes: { body: string; expectedRevision: number }[] = [];
    await page.route(`**/api/entries/${entry.id}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) await gate;
      await route.continue();
    });
    await page.goto(`/?entry=${entry.id}`);
    const checks = page.locator('.detail-body').getByRole('checkbox');
    await checks.nth(0).click();
    await expect(checks.nth(0)).toBeChecked({ timeout: 300 });
    await checks.nth(1).click();
    await expect(checks.nth(1)).toBeChecked({ timeout: 300 });
    await expect.poll(() => writes.length).toBe(1);
    await checks.nth(2).click();
    await checks.nth(0).click();
    await expect(checks.nth(0)).not.toBeChecked({ timeout: 300 });
    await expect(checks.nth(2)).toBeChecked({ timeout: 300 });
    expect(writes).toHaveLength(1);
    await expect(page.getByTestId('checklist-save-status')).toHaveCount(0);
    await page.screenshot({ path: `docs/screenshots/checklist-fast-${mobile ? 'mobile' : 'desktop'}.png` });
    // Closing the detail must not cancel the pending save.
    await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    release();
    await expect.poll(async () => (await (await request.get(`/api/entries/${entry.id}`)).json()).entry.body.trimEnd()).toBe('- [ ] 牛乳\n- [x] パン\n- [x] 卵');
    expect(writes).toHaveLength(2);
    expect(writes[1].expectedRevision).toBe(writes[0].expectedRevision + 1);
    await page.goto(`/?entry=${entry.id}`);
    await expect(checks.nth(0)).not.toBeChecked();
    await expect(checks.nth(1)).toBeChecked();
    await expect(checks.nth(2)).toBeChecked();
  });
}
