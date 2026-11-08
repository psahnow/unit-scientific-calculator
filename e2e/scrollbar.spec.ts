// Desktop scrollbar (D48). Headless browsers hide scrollbars unless told not to, so this file
// launches one that shows them.
import { test, expect } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('a real scrollbar is present in these tests', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (document.body.style.minHeight = '3000px'));
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
});

test('the page keeps its width when a long sheet brings in the scrollbar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Worksheets' }).click();
  await page.getByRole('button', { name: '+ New worksheet' }).click();
  const width = () => page.evaluate(() => document.querySelector('.app')!.getBoundingClientRect().width);
  const scrolls = () => page.evaluate(() => document.documentElement.scrollHeight > innerHeight);
  const short = await width();
  expect(await scrolls()).toBe(false);
  // enough rows to scroll
  const field = (n: number) => page.locator('.row').nth(n - 1).locator('math-field');
  await field(1).click();
  await expect(field(1)).toBeFocused();
  await page.keyboard.type('1');
  for (let n = 2; n <= 14; n++) {
    await page.keyboard.press('Enter');
    await expect(field(n)).toBeFocused();
    await page.keyboard.type(String(n));
  }
  expect(await scrolls()).toBe(true);
  expect(await width()).toBe(short);
});

test('the footer sits at the bottom of the window on a short sheet', async ({ page }) => {
  for (const [w, h] of [[1100, 800], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await page.waitForSelector('.row math-field');
    await page.getByRole('button', { name: 'Worksheets' }).click();
    await page.getByRole('button', { name: '+ New worksheet' }).click();
    await expect(page.locator('.row')).toHaveCount(1);
    const box = (await page.locator('.footer').boundingBox())!;
    expect(Math.abs(box.y + box.height - h)).toBeLessThan(1.5);
  }
});
