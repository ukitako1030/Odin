import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Entry, EntryInput } from '../../src/lib/types';

async function createEntry(request: APIRequestContext, input: EntryInput): Promise<Entry> {
  const response = await request.post('/api/entries', {
    headers: { Origin: 'http://127.0.0.1:3100' },
    data: input,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).entry as Entry;
}

test('a larger constellation supports zoom, drag and keyboard exploration', async ({ page, request }) => {
  await request.get('/api/entries');
  const themes = ['記憶の育て方', '創作の種', '旅の計画', '日々の学び'];
  const records: Entry[] = [];
  for (let index = 0; index < 32; index++) {
    records.push(await createEntry(request, { title: `${themes[Math.floor(index / 8)]} ${index % 8 + 1}`, kind: index % 3 === 0 ? 'idea' : 'knowledge', body: '知識のつながりを、星図から辿る。', tags: [themes[Math.floor(index / 8)]] }));
  }
  await page.goto('/?section=graph');
  const graph = page.getByRole('region', { name: '知識の星図' });
  const map = graph.locator('svg[aria-label="記録のつながり"]');
  await expect(map.getByRole('button', { name: `${records[0].title}のつながりを見る` })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/graph-overview-desktop.png', fullPage: true });
  await graph.getByRole('button', { name: '星図を拡大', exact: true }).click();
  await expect(map.locator(':scope > g')).toHaveAttribute('transform', /scale\(1.25\)/);
  await graph.getByRole('button', { name: '星図を全体に合わせる' }).click();
  const bounds = (await map.boundingBox())!;
  await page.mouse.move(bounds.x + 7, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 50, bounds.y + 115, { steps: 5 });
  await page.mouse.up();
  await expect(map.locator(':scope > g')).not.toHaveAttribute('transform', 'translate(0 0) scale(1)');
  await graph.getByRole('button', { name: '星図を全体に合わせる' }).click();
  await map.getByRole('button', { name: `${records[0].title}のつながりを見る` }).focus();
  await page.keyboard.press('Enter');
  await expect(graph.getByRole('complementary', { name: '選択した記録' }).getByRole('heading', { name: records[0].title })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await graph.getByRole('button', { name: '周辺だけ', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/graph-neighborhood-mobile.png', fullPage: true, animations: 'disabled' });
  await graph.getByRole('button', { name: '選択した記録を開く' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: records[0].title, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

async function openGraph(page: Page, mobile: boolean) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'その他の場所を開く' }).click();
  await page.getByRole('button', { name: '知識の星図', exact: true }).last().click();
  await expect(page).toHaveURL(/section=graph/);
  const graph = page.getByRole('region', { name: '知識の星図' });
  await expect(graph).toBeVisible();
  await expect(graph.locator('svg[aria-label="記録のつながり"]')).toBeVisible();
  return graph;
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} graph shows relation reasons and preserves focus through history`, async ({ page, request }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const suffix = `${mobile ? 'M' : 'D'}${Date.now().toString(36).slice(-4)}`;
    const sharedTag = `星図専用${suffix}`;
    const project = await createEntry(request, {
      title: `星図の工房 ${suffix}`, kind: 'project', body: '', tags: [],
    });
    const explicit = await createEntry(request, {
      title: `明示の記憶 ${suffix}`, kind: 'knowledge', body: '直接結んだ記録', tags: [],
    });
    const tagged = await createEntry(request, {
      title: `共通タグの記憶 ${suffix}`, kind: 'idea', body: 'タグで結んだ記録', tags: [sharedTag],
    });
    const inProject = await createEntry(request, {
      title: `同じ計画の記憶 ${suffix}`, kind: 'memo', body: '計画で結んだ記録', tags: [], projectId: project.id,
    });
    const center = await createEntry(request, {
      title: `星図の中心 ${suffix}`, kind: 'knowledge', body: '星図から詳細を開く',
      tags: [sharedTag], projectId: project.id, relatedIds: [explicit.id],
    });
    const archived = await createEntry(request, {
      title: `保管した記憶 ${suffix}`, kind: 'knowledge', body: '', tags: [sharedTag], status: 'archived',
    });

    const graph = await openGraph(page, mobile);
    const map = graph.locator('svg[aria-label="記録のつながり"]');
    await map.getByRole('button', { name: `${center.title}のつながりを見る` }).locator('circle').first().click();
    await expect(page).toHaveURL(new RegExp(`section=graph.*focus=${center.id}|focus=${center.id}.*section=graph`));
    const selected = graph.getByRole('complementary', { name: '選択した記録' });
    await expect(selected.getByRole('heading', { name: center.title })).toBeVisible();
    await expect(selected).toContainText(explicit.title);
    await expect(selected).toContainText(tagged.title);
    await expect(selected).toContainText(project.title);
    await expect(selected).not.toContainText(inProject.title);
    await expect(selected).toContainText('関連する記録');
    await expect(selected).toContainText(`共通タグ: ${sharedTag.toLowerCase()}`);
    await expect(selected).toContainText('所属プロジェクト');

    await page.screenshot({ path: `docs/screenshots/graph-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await selected.getByRole('button', { name: '記録を開く' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: center.title })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`focus=${center.id}`));
    await expect(selected.getByRole('heading', { name: center.title })).toBeVisible();
    await selected.getByRole('button', { name: '記録を開く' }).click();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(selected.getByRole('heading', { name: center.title })).toBeVisible();

    await map.getByRole('button', { name: `${explicit.title}のつながりを見る` }).locator('circle').first().click();
    await expect(selected.getByRole('heading', { name: explicit.title })).toBeVisible();
    await page.goBack();
    await expect(selected.getByRole('heading', { name: center.title })).toBeVisible();

    const search = graph.getByRole('textbox', { name: '星図の記録を検索' });
    await search.fill(tagged.title);
    await graph.locator('[aria-label="星図の検索結果"]').getByRole('button', { name: `${tagged.title}のつながりを見る` }).click();
    await expect(selected.getByRole('heading', { name: tagged.title })).toBeVisible();
    await search.fill(`一致しない星図 ${suffix}`);
    await expect(graph).toContainText(/見つかりません|該当する記録|一致する記録がありません|検索結果がありません/);
    await search.fill('');
    await map.getByRole('button', { name: `${tagged.title}のつながりを見る` }).locator('circle').first().click();
    await graph.getByRole('checkbox', { name: 'アーカイブを含める' }).check();
    await expect(map.getByRole('button', { name: `${archived.title}のつながりを見る` })).toBeVisible();
    await graph.getByRole('checkbox', { name: '共通タグ' }).uncheck();
    await graph.getByRole('button', { name: '周辺だけ' }).click();
    await expect(selected.getByRole('heading', { name: tagged.title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
