import { expect, test, type Page } from '@playwright/test';
import type { Entry } from '../../src/lib/types';

const themes = ['蒼穹の記憶', '琥珀の工房', '深紫の旅路'] as const;
const id = (group: number, index: number) => `constellation-${group}-${index}`;
const bridgePairs = [
  [id(0, 0), id(1, 0)],
  [id(1, 1), id(2, 1)],
] as const;
const bridgeKeys = new Set(bridgePairs.map(([a, b]) => [a, b].sort().join('|')));
const groupById = new Map(
  themes.flatMap((_, group) => Array.from({ length: 12 }, (_, index) => [id(group, index), group] as const)),
);

const entries: Entry[] = themes.flatMap((tag, group) =>
  Array.from({ length: 12 }, (_, index) => ({
    id: id(group, index),
    title: `${tag} ${String(index + 1).padStart(2, '0')}`,
    kind: 'knowledge' as const,
    body: `${tag}についての記録。`,
    tags: [tag],
    status: 'active' as const,
    relatedIds: [
      ...(index > 0 ? [id(group, index - 1)] : []),
      ...(group === 0 && index === 0 ? [id(1, 0)] : []),
      ...(group === 1 && index === 1 ? [id(2, 1)] : []),
    ],
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    revision: 1,
  })),
);

async function openFixture(page: Page, mobile = false) {
  await page.setViewportSize(mobile ? { width: 320, height: 568 } : { width: 1440, height: 1000 });
  await page.route('**/api/entries*', route => {
    if (route.request().method() !== 'GET') return route.continue();
    const deleted = new URL(route.request().url()).searchParams.get('deleted') === 'true';
    return route.fulfill({ json: { entries: deleted ? [] : entries } });
  });
  await page.goto('/?section=graph');
  const graph = page.getByRole('region', { name: '知識の星図' });
  const map = graph.locator('svg[aria-label="記録のつながり"]');
  await expect(map.locator('g[data-node-id]')).toHaveCount(36);
  await expect(map.locator('g[data-constellation]')).toHaveCount(3);
  return { graph, map };
}

async function checkRealBridges(page: Page) {
  const bridges = await page.locator('path[data-constellation-edge]').evaluateAll(paths =>
    paths.map(path => [path.getAttribute('data-source'), path.getAttribute('data-target')]),
  );
  expect(bridges.length).toBeGreaterThan(0);
  const shownCrossGroup = new Set<string>();
  for (const [source, target] of bridges) {
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    const sourceGroup = groupById.get(source!);
    const targetGroup = groupById.get(target!);
    expect(sourceGroup).toBeDefined();
    expect(targetGroup).toBeDefined();
    if (sourceGroup === targetGroup) continue; // Shared tag makes any pair in this group a real relation.
    const key = [source!, target!].sort().join('|');
    expect(bridgeKeys.has(key)).toBe(true);
    shownCrossGroup.add(key);
  }
  expect(shownCrossGroup).toEqual(bridgeKeys);
}

async function signalState(page: Page) {
  return page.locator('path[data-signal]').first().evaluate(path => {
    const style = getComputedStyle(path);
    return { name: style.animationName, playState: style.animationPlayState, offset: style.strokeDashoffset };
  });
}

test('three constellations occupy distinct places and only real bridges carry idle signals', async ({ page }) => {
  const { graph, map } = await openFixture(page);
  const centroids = await map.locator('g[data-node-id]').evaluateAll(nodes => {
    const groups = new Map<string, Array<{ x: number; y: number }>>();
    for (const node of nodes) {
      const group = node.getAttribute('data-group-id');
      const star = node.querySelector('circle[data-star]');
      if (!group || !star) continue;
      const rect = star.getBoundingClientRect();
      groups.set(group, [...(groups.get(group) ?? []), { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }]);
    }
    return [...groups.values()].map(points => ({
      count: points.length,
      x: points.reduce((total, point) => total + point.x, 0) / points.length,
      y: points.reduce((total, point) => total + point.y, 0) / points.length,
    }));
  });
  expect(centroids).toHaveLength(3);
  expect(centroids.map(group => group.count).sort((a, b) => a - b)).toEqual([12, 12, 12]);
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  for (let a = 0; a < centroids.length; a++) {
    for (let b = a + 1; b < centroids.length; b++) {
      const distance = Math.hypot(centroids[a].x - centroids[b].x, centroids[a].y - centroids[b].y);
      expect(distance).toBeGreaterThan(Math.min(110, bounds!.width * 0.12));
    }
  }

  const largest = await map.locator('circle[data-star]').evaluateAll(stars =>
    Math.max(...stars.map(star => star.getBoundingClientRect().width)),
  );
  expect(largest).toBeLessThanOrEqual(12);
  await checkRealBridges(page);
  await expect(map.locator('path[data-signal]').first()).toBeAttached();
  await expect.poll(async () => (await signalState(page)).playState).toBe('running');
  const before = await signalState(page);
  await expect.poll(async () => (await signalState(page)).offset, { timeout: 4000 }).not.toBe(before.offset);
  await page.screenshot({ path: 'docs/screenshots/graph-constellations-e2e-desktop.png', fullPage: true, animations: 'disabled' });

  await page.evaluate(() => localStorage.setItem('odin-motion', 'off'));
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/motion-off/);
  await expect(map.locator('path[data-signal]').first()).toBeAttached();
  const stopped = await signalState(page);
  expect(stopped.name === 'none' || stopped.playState === 'paused').toBe(true);
  await checkRealBridges(page);
  await expect(graph).toBeVisible();
});

test('320px search can select and open a record without overflow; reduced motion stops signals', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { graph, map } = await openFixture(page, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await checkRealBridges(page);
  const stopped = await signalState(page);
  expect(stopped.name === 'none' || stopped.playState === 'paused').toBe(true);

  const title = entries.find(entry => entry.id === id(1, 1))!.title;
  await graph.getByRole('textbox', { name: '星図の記録を検索' }).fill(title);
  await graph.locator('[aria-label="星図の検索結果"]')
    .getByRole('button', { name: `${title}のつながりを見る` }).click();
  const selected = graph.getByRole('complementary', { name: '選択した記録' });
  await expect(selected.getByRole('heading', { name: title })).toBeVisible();
  await expect(map.locator(`g[data-node-id="${id(1, 1)}"]`)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/graph-constellations-e2e-mobile.png', fullPage: true, animations: 'disabled' });

  await selected.getByRole('button', { name: '記録を開く' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
