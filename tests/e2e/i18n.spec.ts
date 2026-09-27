import { test, expect } from '@playwright/test';

test('language preference survives reload and records keep their original language', async ({ page }) => {
  await page.goto('/?section=settings');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Create a record', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('言語切替テスト — original title');
  await dialog.getByLabel('Body', { exact: false }).fill('日本語の本文をそのまま残す。\n\nEnglish stays unchanged, too.');
  await dialog.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '記録を検索', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('言語切替テスト');
  await page.getByRole('dialog').getByRole('button', { name: /言語切替テスト — original title/ }).click();
  await expect(page.getByRole('dialog')).toContainText('日本語の本文をそのまま残す。');
  await expect(page.getByRole('dialog')).toContainText('English stays unchanged, too.');
});

test('language controls fit a small phone and persist across pages', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?section=settings');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Import conversations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});
