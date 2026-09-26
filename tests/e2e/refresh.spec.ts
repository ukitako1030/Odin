import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} late refresh cannot undo a saved completion`, async ({ page, request }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await request.get('/api/entries');
    const title = `再読み込みの競合 ${mobile ? 'スマホ' : 'PC'}`;
    const { entry } = await (await request.post('/api/entries', {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { title, kind: 'task', body: '古い通信で完了状態を戻さない。', tags: [] },
    })).json();
    await page.goto('/?section=task');
    const complete = page.getByRole('button', { name: `${title}を完了にする`, exact: true });
    const reopen = page.getByRole('button', { name: `${title}を未完了にする`, exact: true });
    await expect(complete).toBeVisible();
    await page.clock.setFixedTime(new Date(Date.now() + 31_000));

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let staleReady = false;
    let delivered = false;
    let reads = 0;
    await page.route('**/api/entries?deleted=all', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      reads++;
      if (reads !== 1) return route.continue();
      const response = await route.fetch();
      const stale = await response.json();
      staleReady = true;
      await gate;
      await route.fulfill({ json: stale }).catch(() => {}); // The improved client cancels this request.
      delivered = true;
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => staleReady).toBe(true);
    expect(reads).toBe(1);
    await complete.click();
    await expect(reopen).toBeVisible();
    release();
    await expect.poll(() => delivered).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(reopen).toBeVisible();
    await expect(complete).toHaveCount(0);
    expect((await (await request.get(`/api/entries/${entry.id}`)).json()).entry.status).toBe('done');
    await page.screenshot({ path: `docs/screenshots/backend-review-${mobile ? 'mobile' : 'desktop'}.png` });
  });
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} records render before diagnostics and brief returns skip reads`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let diagnosticsFinished = false;
    let reads = 0;
    page.on('request', req => { if (new URL(req.url()).pathname === '/api/entries') reads++; });
    await page.route('**/api/status', async route => {
      await gate;
      await route.fulfill({ json: { provider: 'local', connected: true, writable: true, message: 'test' } });
      diagnosticsFinished = true;
    });
    await page.goto('/?section=knowledge');
    await expect(page.getByRole('button', { name: /Odin へようこそ/ }).first()).toBeVisible();
    expect(diagnosticsFinished).toBe(false);
    const initialReads = reads;
    const focus = () => page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await focus();
    await page.waitForTimeout(250);
    expect(reads).toBe(initialReads); // Do not restart an in-flight refresh.
    release();
    await expect.poll(() => diagnosticsFinished).toBe(true);
    await focus();
    await page.waitForTimeout(250);
    expect(reads).toBe(initialReads);
    await page.clock.setFixedTime(new Date(Date.now() + 31_000));
    await focus();
    await expect.poll(() => reads).toBe(initialReads + 1);
    await expect(page.locator('.loading-block')).toHaveCount(0);
    await page.screenshot({ path: `docs/screenshots/refresh-light-${mobile ? 'mobile' : 'desktop'}.png` });
  });
}

test('one list read separates current records from trash without changing the default API', async ({ page, request }) => {
  await request.get('/api/entries');
  const title = '一覧から隠す削除済みの記録';
  const { entry } = await (await request.post('/api/entries', {
    headers: { Origin: 'http://127.0.0.1:3100' },
    data: { title, kind: 'memo', body: '復元用の本文', tags: [] },
  })).json();
  await request.delete(`/api/entries/${entry.id}?expectedRevision=${entry.revision}`, { headers: { Origin: 'http://127.0.0.1:3100' } });
  const normal = (await (await request.get('/api/entries')).json()).entries;
  const all = (await (await request.get('/api/entries?deleted=all')).json()).entries;
  expect(normal.some((value: { id: string }) => value.id === entry.id)).toBe(false);
  expect(all.some((value: { id: string; deletedAt?: string }) => value.id === entry.id && value.deletedAt)).toBe(true);
  const reads: string[] = [];
  page.on('request', value => { if (value.method() === 'GET' && new URL(value.url()).pathname === '/api/entries') reads.push(value.url()); });
  await page.goto('/?section=memo');
  await expect(page.locator('.loading-block')).toHaveCount(0);
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(url => new URL(url).searchParams.get('deleted') === 'all')).toBe(true);
  await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.getByRole('button', { name: `${title}を元に戻す`, exact: true })).toBeVisible();
});
