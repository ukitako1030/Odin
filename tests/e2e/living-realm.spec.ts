import { expect, test, type Page } from '@playwright/test';

const screenshots = 'docs/screenshots';

async function expectLoadedImage(page: Page, selector: string) {
  const image = page.locator(selector);
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
}

async function hasRunningInfiniteAnimation(page: Page) {
  return page.locator('[data-animate]').evaluateAll(elements => elements.some(element =>
    element.getAnimations({ subtree: true }).some(animation =>
      animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity,
    ),
  ));
}

test('the generated wordmark and living light move at rest, and the motion preference persists', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
  await expect(page.locator('.loading-block')).toHaveCount(0);
  const sidebarLogo = page.locator('aside[aria-label="メインメニュー"] button[aria-label="ODIN ホーム"]');
  await expect(sidebarLogo).toBeVisible();
  await expectLoadedImage(page, 'aside[aria-label="メインメニュー"] img[alt="ODIN"]');

  const heroLight = page.locator('.hero > [data-animate]');
  await expect(heroLight).toHaveAttribute('data-animate', 'true');
  await expect(sidebarLogo.locator('[data-animate]')).toHaveAttribute('data-animate', 'true');
  const firstGlow = heroLight.locator(':scope > span').first();
  const initialTransform = await firstGlow.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => firstGlow.evaluate(element => getComputedStyle(element).transform), { timeout: 3000 })
    .not.toBe(initialTransform);
  await expect.poll(() => hasRunningInfiniteAnimation(page)).toBe(true);
  await page.screenshot({ path: `${screenshots}/living-home-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: '設定', exact: true }).click();
  const switchControl = page.getByRole('switch', { name: '演出を有効にする' });
  await expect(switchControl).toHaveAttribute('aria-checked', 'true');
  await switchControl.click();
  await expect(switchControl).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('odin-motion'))).toBe('off');

  await sidebarLogo.click();
  await expect(heroLight).toHaveAttribute('data-animate', 'false');
  await expect(sidebarLogo.locator('[data-animate]')).toHaveAttribute('data-animate', 'false');
  expect(await hasRunningInfiniteAnimation(page)).toBe(false);
  await page.reload();
  await expect(heroLight).toHaveAttribute('data-animate', 'false');
  expect(await page.evaluate(() => localStorage.getItem('odin-motion'))).toBe('off');
  expect(await hasRunningInfiniteAnimation(page)).toBe(false);
});

test('reduced motion stops the new decorative animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.hero > [data-animate]')).toHaveAttribute('data-animate', 'false');
  await expect(page.locator('aside[aria-label="メインメニュー"] [data-animate]')).toHaveAttribute('data-animate', 'false');
  expect(await hasRunningInfiniteAnimation(page)).toBe(false);
});

test('mobile scenes and navigation fit at 390px and 320px', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今日の道しるべ' })).toBeVisible();
    await expect(page.locator('.loading-block')).toHaveCount(0);
    const mobileLogo = page.locator('header.topbar button[aria-label="ODIN ホーム"]');
    await expect(mobileLogo).toBeVisible();
    await expectLoadedImage(page, 'header.topbar img[alt="ODIN"]');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    for (const scene of ['well', 'quill']) {
      const art = page.locator(`[data-realm-scene="${scene}"] img`);
      await art.scrollIntoViewIfNeeded();
      await expect.poll(() => art.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await page.locator('.hero').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-realm-scene="well"] [data-animate]')).toHaveAttribute('data-animate', 'false');

    if (width === 390) {
      await page.screenshot({ path: `${screenshots}/living-home-mobile.png`, fullPage: true });
    }

    await page.getByRole('button', { name: 'その他の場所を開く' }).click();
    await page.getByRole('button', { name: 'ナレッジ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ナレッジ', exact: true })).toBeVisible();
    await expectLoadedImage(page, '[data-realm-scene="archive"] img');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: `${screenshots}/living-archive-mobile.png`, fullPage: true });

    await page.getByRole('navigation', { name: 'スマートフォンのナビゲーション' })
      .getByRole('button', { name: 'タスク' }).click();
    await expect(page.getByRole('heading', { name: 'タスク', exact: true })).toBeVisible();
    await expectLoadedImage(page, '[data-realm-scene="compass"] img');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
