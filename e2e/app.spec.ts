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

test('a kelvin value can be shown in °C, with a note on why that can mislead', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'T=300K');
  await page.keyboard.press('Escape');
  await expect(result(page, 1)).toContainText('300');
  await result(page, 1).locator('.unit-chip').click();
  const search = page.getByPlaceholder(/type a unit/);
  await search.fill('degC');
  await search.press('Enter');
  await expect(result(page, 1)).toContainText('26.85');
  // a warning badge; its text shows on hover
  const tip = page.locator('.unit-note-tip');
  await expect(page.locator('.unit-note')).toBeVisible();
  await expect(tip).toBeHidden();
  await page.locator('.unit-note').hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('absolute temperature');
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

test('the production build loads with no console errors and works through the sample', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('.row math-field');
  // the sample worksheet evaluates without errors: σ = F / A shown in MPa
  await expect(page.locator('.row-result .result').filter({ hasText: 'MPa' }).first()).toContainText('300');
  await expect(page.locator('.result.error, .col-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('nothing moves after the first paint (no layout shift)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { __cls: number }).__cls += (e as unknown as { value: number }).value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await page.waitForSelector('.row math-field');
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the on-screen keyboard ↵ adds one row; leaving an edited field adds none', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dismiss welcome' }).tap();
    const rows = page.locator('.row');
    const before = await rows.count();
    // edit a row with the on-screen keyboard, then leave it by tapping the title: no new row
    await page.locator('.row math-field').nth(2).tap();
    await expect(page.locator('.ML__keyboard.is-visible')).toBeVisible();
    await page.locator('.MLK__layer.is-visible div[tabindex="-1"]').filter({ has: page.locator('span.ML__cmr', { hasText: /^7$/ }) }).last().tap();
    await page.locator('.title-input').tap();
    await expect(rows).toHaveCount(before);
    // ↵ on the keyboard: exactly one new row
    await page.locator('.row math-field').nth(2).tap();
    await page.locator('.MLK__layer.is-visible .dim-return').first().tap();
    await expect(rows).toHaveCount(before + 1);
  });
});

test('“/” after unit chips puts them on top: 5 m Tab / s Tab = 5 m/s', async ({ page }) => {
  await freshSheet(page);
  await field(page, 1).click();
  await expect(field(page, 1)).toBeFocused();
  const keys = async (ks: string[]) => {
    for (const k of ks) {
      if (k === 'Tab') await expect(page.locator('.ac-pop')).toBeVisible(); // Tab inserts the suggestion
      await (k.length > 1 ? page.keyboard.press(k) : page.keyboard.type(k));
    }
  };
  await keys(['5', 'm', 'Tab', '/', 's', 'Tab']);
  await expect(field(page, 1)).toHaveJSProperty('value', String.raw`5\frac{\unit{m}}{\unit{s}}`);
  await expect(result(page, 1)).toContainText('m/s');
  await nextRow(page, 2);
  await keys(['1', '0', 'N', 'Tab', '/', 'm', 'm', 'Tab', '^', '2']);
  await expect(result(page, 2)).toContainText('N/mm²');
});

test.describe('phone ÷', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the on-screen ÷ after a unit chip divides by what comes next', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dismiss welcome' }).tap();
    await page.getByRole('button', { name: 'Worksheets' }).tap();
    await page.getByRole('button', { name: '+ New worksheet' }).tap();
    await page.locator('.row math-field').first().tap();
    const key = (sel: string, text?: RegExp) =>
      (text ? page.locator(`.MLK__layer.is-visible ${sel}`).filter({ hasText: text }) : page.locator(`.MLK__layer.is-visible ${sel}`)).first();
    await page.locator('.MLK__layer.is-visible div[tabindex="-1"]').filter({ has: page.locator('span.ML__cmr', { hasText: /^5$/ }) }).last().tap();
    await page.locator('.ML__keyboard [data-layer]').filter({ hasText: /^m kg$/ }).locator('visible=true').first().tap();
    await key('div[tabindex="-1"]', /^m$/).tap();
    await page.locator('.ML__keyboard [data-layer]').filter({ hasText: /^123$/ }).locator('visible=true').first().tap();
    await key('.dim-divide').tap();
    await page.locator('.ML__keyboard [data-layer]').filter({ hasText: /^m kg$/ }).locator('visible=true').first().tap();
    await key('div[tabindex="-1"]', /^s$/).tap();
    await expect(page.locator('.row math-field').first()).toHaveJSProperty('value', String.raw`5\frac{\unit{m}}{\unit{s}}`);
  });
});
