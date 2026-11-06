// Real-browser checks of the main flows (D38): typing with chips, results, unit dropdowns, toolbox,
// drag-and-drop, undo, export/import. Each test starts from a fresh browser profile.
import { test, expect, type Page } from '@playwright/test';

async function freshSheet(page: Page) {
  await page.goto('/');
  // dismiss the welcome card, start a blank worksheet
  await page.getByRole('button', { name: 'Dismiss welcome' }).click();
  await page.getByRole('button', { name: 'Worksheets' }).click();
  await page.getByRole('button', { name: '+ New worksheet' }).click();
  await expect(page.locator('.row')).toHaveCount(1);
}

/** The math field of row n (1-based). */
const field = (page: Page, n: number) => page.locator('.row').nth(n - 1).locator('math-field');
const result = (page: Page, n: number) => page.locator('.row').nth(n - 1).locator('.row-result .result');

async function typeRow(page: Page, n: number, keys: string) {
  await field(page, n).click();
  await expect(field(page, n)).toBeFocused(); // type only once the field has the caret
  await page.keyboard.type(keys, { delay: 25 });
}

/** Enter makes a new row; wait until it has the caret before typing on. */
async function nextRow(page: Page, n: number) {
  await page.keyboard.press('Enter');
  await expect(field(page, n)).toBeFocused();
}

test('typing a value with units, then a formula', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'X=6N');
  await nextRow(page, 2);
  await page.keyboard.type('X/2mm^2', { delay: 25 });
  await page.keyboard.press('Escape');
  await expect(result(page, 1)).toContainText('6');
  await expect(result(page, 1)).toContainText('N');
  await expect(result(page, 2)).toContainText('3');
  await expect(result(page, 2)).toContainText('N/mm²');
  // * becomes a centred dot, ^ keeps several digits in the exponent
  await nextRow(page, 3);
  await page.keyboard.type('2*10^23', { delay: 25 });
  await expect(field(page, 3)).toHaveJSProperty('value', '2\\cdot10^{23}');
});

test('the unit dropdown changes only the display', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'X=6N');
  await nextRow(page, 2);
  await page.keyboard.type('X/2mm^2', { delay: 25 });
  await expect(result(page, 2)).toContainText('N/mm²');
  await result(page, 2).locator('.unit-chip').click();
  const search = page.getByPlaceholder(/type a unit/);
  await expect(search).toBeFocused();
  await search.fill('psi');
  await search.press('Enter');
  await expect(result(page, 2)).toContainText('435.1132132');
  await expect(result(page, 2)).toContainText('psi');
});

test('function toolbox inserts at the caret', async ({ page }) => {
  await freshSheet(page);
  await field(page, 1).click();
  await page.getByRole('button', { name: 'Functions toolbox' }).click();
  await page.getByRole('tab', { name: 'Special' }).click();
  await page.getByRole('button', { name: 'Γ(x)' }).click();
  await page.keyboard.type('5');
  await expect(result(page, 1)).toContainText('24');
});

test('dragging a row keeps its unit chips', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'A=20mm');
  await nextRow(page, 2);
  await page.keyboard.type('B=6kN', { delay: 25 });
  await page.keyboard.press('Escape');
  await page.locator('.title-input').click(); // leave the field so chips are applied
  await expect(field(page, 2)).toHaveJSProperty('value', 'B=6\\unit{kN}');
  // drag row 2 by its handle onto row 1
  const handle = page.locator('.row').nth(1).locator('.handle');
  await handle.hover();
  await handle.dragTo(page.locator('.row').nth(0));
  await expect(field(page, 1)).toHaveJSProperty('value', 'B=6\\unit{kN}');
  // the chip is still a chip, not raw "\unit kN" text
  const raw = await field(page, 1).evaluate((el) => (el.shadowRoot?.textContent ?? '').includes('unit'));
  expect(raw).toBe(false);
});

test('undo and redo', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, '2+3');
  await expect(result(page, 1)).toContainText('5');
  await page.locator('.title-input').click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(field(page, 1)).toHaveJSProperty('value', '');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(field(page, 1)).toHaveJSProperty('value', '2+3');
});

test('export and import round-trip', async ({ page }) => {
  await freshSheet(page);
  await page.locator('.title-input').fill('Round trip');
  await typeRow(page, 1, 'G=3m');
  await page.locator('.title-input').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export/ }).click()]);
  expect(download.suggestedFilename()).toBe('Round trip.dimensional.json');
  const path = await download.path();
  // start over, then import the file
  await page.getByRole('button', { name: 'Worksheets' }).click();
  await page.getByRole('button', { name: '+ New worksheet' }).click();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.locator('.title-input')).toHaveValue('Round trip');
  await expect(field(page, 1)).toHaveJSProperty('value', 'G=3\\unit{m}');
});

test('phone width has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
});
