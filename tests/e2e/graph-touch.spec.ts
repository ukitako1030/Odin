import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

async function createDenseGraph(request: APIRequestContext) {
  const topics = ['想起', '探究', '創作'];
  const titles: string[] = [];
  for (const topic of topics) {
    for (let index = 1; index <= 12; index++) {
      const title = `${topic}の記憶 ${String(index).padStart(2, '0')}`;
      const response = await request.post('/api/entries', {
        headers: { Origin: 'http://127.0.0.1:3100' },
        data: { title, kind: 'knowledge', body: `${topic}について考えたこと。`, tags: [topic] },
      });
      expect(response.status()).toBe(201);
      titles.push(title);
    }
  }
  return titles;
}

async function visibleDetailLabels(page: Page): Promise<number> {
  return page.locator('svg[aria-label="記録のつながり"] text[data-graph-label]').evaluateAll(labels =>
    labels.filter(label => {
      const style = getComputedStyle(label);
      const bounds = label.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.1 && bounds.width > 0;
    }).length);
}

async function largestStarDiameter(page: Page): Promise<number> {
  return page.locator('svg[aria-label="記録のつながり"] circle[data-star]').evaluateAll(stars =>
    Math.max(0, ...stars.map(star => star.getBoundingClientRect().width)));
}

test('mobile semantic zoom keeps stars small and supports pinch, pan and selection', async ({ page, request }) => {
  const titles = await createDenseGraph(request);
  await page.goto('/?section=graph');
  const graph = page.getByRole('region', { name: '知識の星図' });
  const map = graph.locator('svg[aria-label="記録のつながり"]');
  await expect(map.getByRole('button', { name: `${titles[0]}のつながりを見る` })).toBeVisible();
  await expect(map).toHaveAttribute('data-zoom', '1');
  const overviewLabels = await visibleDetailLabels(page);
  expect(await map.getByRole('button', { name: /の集まりを拡大/ }).count()).toBeGreaterThan(0);
  expect(await largestStarDiameter(page)).toBeLessThanOrEqual(12);
  await page.screenshot({ path: 'docs/screenshots/graph-mobile-overview-v2.png', fullPage: true, animations: 'disabled' });

  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 20, y, id: 0 }, { x: x + 20, y, id: 1 }] });
  for (const distance of [60, 80, 100, 120, 140]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance / 2, y, id: 0 }, { x: x + distance / 2, y, id: 1 }] });
  }
  const zoom = Number(await map.getAttribute('data-zoom'));
  expect(zoom).toBeGreaterThan(2.5);
  expect(zoom).toBeLessThanOrEqual(6);
  await expect.poll(() => visibleDetailLabels(page)).toBeGreaterThan(overviewLabels);
  expect(await largestStarDiameter(page)).toBeLessThanOrEqual(12);
  await page.screenshot({ path: 'docs/screenshots/graph-mobile-zoom-v2.png', fullPage: true, animations: 'disabled' });

  const firstStar = map.locator('circle[data-star]').first();
  const beforePan = await firstStar.boundingBox();
  // CDP touchMove lists every *remaining* active finger; omitting id 1 lifts it.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 70, y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30, y: y + 28, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const afterPan = await firstStar.boundingBox();
  expect(beforePan).not.toBeNull();
  expect(afterPan).not.toBeNull();
  expect(Math.hypot(afterPan!.x - beforePan!.x, afterPan!.y - beforePan!.y)).toBeGreaterThan(8);
  await expect(page).not.toHaveURL(/focus=/);

  await graph.getByRole('button', { name: '星図を全体に合わせる' }).tap();
  await expect(map).toHaveAttribute('data-zoom', '1');
  await map.getByRole('button', { name: '想起の集まりを拡大' }).tap();
  await expect.poll(async () => Number(await map.getAttribute('data-zoom'))).toBeGreaterThanOrEqual(2.4);
  await expect(page).not.toHaveURL(/focus=/);
  await page.screenshot({ path: 'docs/screenshots/graph-mobile-topic-v2.png', fullPage: true, animations: 'disabled' });

  const visibleStar = await map.locator('circle[data-star]').evaluateAll(stars => {
    const svg = stars[0]?.closest('svg');
    const mapBounds = svg?.getBoundingClientRect();
    if (!mapBounds) return null;
    for (const star of stars) {
      const bounds = star.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
      if (x > mapBounds.left + 25 && x < mapBounds.right - 25 && y > mapBounds.top + 25 && y < mapBounds.bottom - 25) {
        const name = star.closest('[role="button"]')?.getAttribute('aria-label');
        if (name) return { x, y, title: name.replace(/のつながりを見る$/, '') };
      }
    }
    return null;
  });
  expect(visibleStar).not.toBeNull();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: visibleStar!.x, y: visibleStar!.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(graph.getByRole('complementary', { name: '選択した記録' }).getByRole('heading', { name: visibleStar!.title })).toBeVisible();
  await expect(page).toHaveURL(/focus=/);

  const search = graph.getByRole('textbox', { name: '星図の記録を検索' });
  await search.fill(titles[0]);
  await graph.locator('[aria-label="星図の検索結果"]').getByRole('button', { name: `${titles[0]}のつながりを見る` }).click();
  await expect(graph.getByRole('complementary', { name: '選択した記録' }).getByRole('heading', { name: titles[0] })).toBeVisible();
  await expect(page).toHaveURL(/focus=/);
});
