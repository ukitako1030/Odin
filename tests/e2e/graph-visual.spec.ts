import { expect, test, type Page } from '@playwright/test';
import type { Entry } from '../../src/lib/types';

const graphEntries: Entry[] = ['想起', '探究', '創作'].flatMap((tag, group) =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `graph-visual-${group}-${index}`,
    title: `${tag}の記憶 ${String(index + 1).padStart(2, '0')}`,
    kind: 'knowledge' as const,
    body: `${tag}についての記録。`,
    tags: [tag],
    status: 'active' as const,
    relatedIds: index ? [`graph-visual-${group}-${index - 1}`] : [],
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    revision: 1,
  })));

async function openIsolatedGraph(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.route('**/api/entries*', route => {
    if (route.request().method() !== 'GET') return route.continue();
    const deleted = new URL(route.request().url()).searchParams.get('deleted') === 'true';
    return route.fulfill({ json: { entries: deleted ? [] : graphEntries } });
  });
  await page.goto('/?section=graph');
  const graph = page.getByRole('region', { name: '知識の星図' });
  const map = graph.locator('svg[aria-label="記録のつながり"]');
  await expect(map.locator('circle[data-star]')).toHaveCount(36);
  return { graph, map, canvas: graph.locator('[data-sky-active]') };
}

async function expectClearTopicLabels(page: Page) {
  const result = await page.locator('svg[aria-label="記録のつながり"]').evaluate(svg => {
    const stars = [...svg.querySelectorAll<SVGCircleElement>('circle[data-star]')].map(star => {
      const box = star.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const labels = [...svg.querySelectorAll<SVGGElement>('g[role="button"]')]
      .filter(group => group.getAttribute('aria-label')?.endsWith('の集まりを拡大'));
    const covered = labels.flatMap(label => {
      const rect = label.querySelector('rect');
      if (!rect) return [];
      const box = rect.getBoundingClientRect();
      return stars.filter(star => star.x >= box.left && star.x <= box.right && star.y >= box.top && star.y <= box.bottom)
        .map(() => label.getAttribute('aria-label'));
    });
    return { count: labels.length, covered };
  });
  expect(result.count).toBeGreaterThanOrEqual(2);
  expect(result.covered).toEqual([]);
}

test('desktop celestial atlas moves at rest and keeps stars clear of topic labels', async ({ page }) => {
  const { graph, map, canvas } = await openIsolatedGraph(page, false);
  const image = graph.locator('img[src*="knowledge-nebula.webp"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(canvas).toHaveAttribute('data-sky-active', 'true');
  const current = image.locator('..').locator('div').first();
  const before = await current.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => current.evaluate(element => getComputedStyle(element).transform), { timeout: 5000 }).not.toBe(before);
  await expectClearTopicLabels(page);
  const largest = await map.locator('circle[data-star]').evaluateAll(stars => Math.max(...stars.map(star => star.getBoundingClientRect().width)));
  expect(largest).toBeLessThanOrEqual(12);
  await page.screenshot({ path: 'docs/screenshots/graph-celestial-e2e-desktop.png', fullPage: true, animations: 'disabled' });

  await map.getByRole('button', { name: /の集まりを拡大/ }).first().click();
  await expect.poll(async () => Number(await map.getAttribute('data-zoom'))).toBeGreaterThanOrEqual(2.4);
  const zoomedLargest = await map.locator('circle[data-star]').evaluateAll(stars => Math.max(...stars.map(star => star.getBoundingClientRect().width)));
  expect(zoomedLargest).toBeLessThanOrEqual(12);

  await page.evaluate(() => localStorage.setItem('odin-motion', 'off'));
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/motion-off/);
  await expect(canvas).toHaveAttribute('data-sky-active', 'false');
  await expect.poll(() => map.locator('circle[class*="halo"]').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('mobile atlas fits topic labels and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { graph, map, canvas } = await openIsolatedGraph(page, true);
  const image = graph.locator('img[src*="knowledge-nebula.webp"]');
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(canvas).toHaveAttribute('data-sky-active', 'false');
  await expect.poll(() => map.locator('circle[class*="halo"]').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expectClearTopicLabels(page);
  const largest = await map.locator('circle[data-star]').evaluateAll(stars => Math.max(...stars.map(star => star.getBoundingClientRect().width)));
  expect(largest).toBeLessThanOrEqual(12);
  await page.screenshot({ path: 'docs/screenshots/graph-celestial-e2e-mobile.png', fullPage: true, animations: 'disabled' });
});
