// Real-browser checks of the main flows (D38): typing with chips, results, unit dropdowns, toolbox,
// drag-and-drop, undo, export/import. Each test starts from a fresh browser profile.
import { test, expect, type Page } from '@playwright/test';
import { openSample, openSheet, SAMPLE } from './sample';

async function freshSheet(page: Page) {
  await openSample(page);
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

test('a period after a letter dots it: m. is ṁ, x.. is ẍ, and 2.5 m stays a number', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'm.=2kg');
  await page.keyboard.press('Tab');
  await page.keyboard.type('/s', { delay: 25 });
  await page.keyboard.press('Tab');
  const value = (n: number) => field(page, n).evaluate((f) => (f as HTMLInputElement).value);
  expect(await value(1)).toMatch(/^\\dot\{m\}=2/);
  await expect(result(page, 1)).toContainText('kg/s');
  await nextRow(page, 2);
  await page.keyboard.type('x..=3*m.', { delay: 25 });
  await expect(field(page, 2)).toHaveJSProperty('value', String.raw`\ddot{x}=3\cdot\dot{m}`);
  await expect(result(page, 2)).toContainText('6');
  await nextRow(page, 3);
  await page.keyboard.type('2.5m+1.5m', { delay: 25 });
  await page.keyboard.press('Escape');
  await expect(result(page, 3)).toContainText('4');
  expect(await value(3)).not.toMatch(/dot/);
  // after a number: 6m. is 6 · ṁ
  await nextRow(page, 4);
  await page.keyboard.type('6m.', { delay: 25 });
  await expect(field(page, 4)).toHaveJSProperty('value', String.raw`6\cdot\dot{m}`);
  await expect(result(page, 4)).toContainText('12');
  // m’s suggestions: metre first, then the ṁ defined in row 1
  await nextRow(page, 5);
  await page.keyboard.type('3m', { delay: 25 });
  const items = page.locator('.ac-pop [role="option"]');
  await expect(items.nth(1)).toContainText('ṁ'); // ṁ as a letter and a combining dot
  await expect(items.nth(0)).toContainText('metre');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(field(page, 5)).toHaveJSProperty('value', String.raw`3\cdot\dot{m}`);
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

test('the unit menu keeps its size while you scroll its list (opened upward, near the bottom)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 750 });
  // a distance in miles shown in inches, last of 12 rows
  const rows = [
    ...Array.from({ length: 11 }, (_, i) => ({ id: 'p' + i, type: 'expr', latex: String(i + 1) })),
    { id: 'd', type: 'expr', latex: String.raw`d=3\unit{mi}`, displayUnit: 'in' },
  ];
  await openSheet(page, { ...SAMPLE, id: 'miles', title: 'Miles', rows });
  await page.evaluate(() => scrollTo(0, 1e6));
  await result(page, 12).locator('.unit-chip').click();
  const menu = page.locator('.unit-menu');
  await expect(menu).toBeVisible();
  const before = (await menu.boundingBox())!;
  // the button is near the bottom, so the menu opens upward
  expect(before.y + before.height).toBeLessThan((await result(page, 12).locator('.unit-chip').boundingBox())!.y + 1);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height - 40);
  for (let k = 0; k < 25; k++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(200);
  const after = (await menu.boundingBox())!;
  expect(after.height).toBe(before.height);
  expect(after.y).toBe(before.y);
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
  await page.mouse.move(5, 400); // away from the badge (the dropdown closes right over it)
  await expect(tip).toBeHidden();
  await page.locator('.unit-note').hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('absolute temperature');
});

test('a number right after a letter is a subscript: T1 = 5, then 2·T12', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'T1=5');
  await expect(field(page, 1)).toHaveJSProperty('value', 'T_1=5');
  await nextRow(page, 2);
  await page.keyboard.type('T12=3', { delay: 25 });
  await expect(field(page, 2)).toHaveJSProperty('value', 'T_{12}=3');
  await nextRow(page, 3);
  await page.keyboard.type('T1+T12', { delay: 25 });
  await expect(field(page, 3)).toHaveJSProperty('value', 'T_1+T_{12}');
  await expect(result(page, 3)).toContainText('8');
  // numbers stay numbers: 2e3 and 3x are not subscripts
  await nextRow(page, 4);
  await page.keyboard.type('2x+2e3', { delay: 25 });
  await expect(field(page, 4)).toHaveJSProperty('value', '2x+2e3');
});

test('wide screens list the variables in the margin; clicking one goes to its row', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSample(page);
  const panel = page.getByRole('complementary', { name: 'Variables' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.var-item').filter({ hasText: 'σ' })).toContainText('300 MPa');
  await expect(panel.locator('.var-group-title')).toHaveText(['Beam inputs']);
  // collapse the folder, then jump to a variable inside it: the folder opens and the row has the caret
  await page.getByRole('button', { name: /Collapse folders/ }).click();
  await panel.locator('.var-item').filter({ hasText: 'A' }).first().click();
  const row = page.locator('.row').filter({ has: page.locator('math-field') }).nth(1);
  await expect(row.locator('math-field')).toBeFocused();
  await expect(row.locator('math-field')).toHaveJSProperty('value', 'A=20\\unit{mm}^2');
  // narrower: no panel
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(panel).toBeHidden();
});

test('Tab straight after fast typing takes the whole unit (mm, not m)', async ({ page }) => {
  await freshSheet(page);
  await field(page, 1).click();
  await expect(field(page, 1)).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.type('mm'); // no delay, then Tab at once
    await page.keyboard.press('Tab');
    await page.keyboard.type('+');
  }
  await expect(field(page, 1)).toHaveJSProperty('value', String.raw`\unit{mm}+\unit{mm}+\unit{mm}+\unit{mm}+\unit{mm}+`);
});

test('arrow keys go into a note and out again', async ({ page }) => {
  await openSample(page);
  // sample sheet: row 4 is L = 1.5 m, row 5 a note, row 6 σ = F/A
  const above = page.locator('.row').nth(3).locator('math-field');
  const note = page.locator('.row').nth(4).locator('textarea');
  const below = page.locator('.row').nth(5).locator('math-field');
  await above.click();
  await expect(above).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(note).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(below).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(note).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(above).toBeFocused();
});

test('typed function input: F(l:m) converts inches to metres', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, 'F(l:m)=2l');
  await page.keyboard.press('Escape');
  // the definition shows the unit it gives (D53)
  await expect(result(page, 1)).toHaveText(/→s*m$/);
  await nextRow(page, 2);
  await page.keyboard.type('F(3in)', { delay: 25 });
  await page.keyboard.press('Escape');
  await expect(result(page, 2)).toContainText('0.1524');
  await expect(result(page, 2)).toContainText('m');
  await page.locator('.title-input').click(); // leave: the m becomes a unit chip
  await expect(field(page, 1)).toHaveJSProperty('value', String.raw`F\left(l:\unit{m}\right)=2l`);
});

test('hovering the ⚠ in the margin shows the error', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, '2m+3s');
  await page.locator('.title-input').click();
  await expect(page.locator('.ac-pop')).toHaveCount(0);
  const mark = page.locator('.row').first().locator('.gutter .hover-tip');
  const tip = mark.locator('.hover-tip-text');
  await expect(mark).toBeVisible();
  await expect(tip).toBeHidden();
  await mark.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/length.*time|add/i);
});

test('#n is the answer of row n, and follows the row when rows move', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, '6m');
  await page.keyboard.press('Tab');
  await nextRow(page, 2);
  await page.keyboard.type('2m', { delay: 25 });
  await page.keyboard.press('Tab');
  await nextRow(page, 3);
  await page.keyboard.type('#1*#2', { delay: 25 });
  await expect(field(page, 3)).toHaveJSProperty('value', String.raw`\#1\cdot\#2`);
  await expect(result(page, 3)).toContainText('12');
  await expect(result(page, 3)).toContainText('m²');
  // move the product to the top (Alt+↑ twice): its references now read #2 · #3
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(field(page, 1)).toHaveJSProperty('value', String.raw`\#2\cdot\#3`);
  await expect(result(page, 1)).toContainText('12');
});

test('a unit that no longer fits: picking one that does clears the error, (none) included', async ({ page }) => {
  await freshSheet(page);
  await typeRow(page, 1, '5m');
  await page.locator('.title-input').click();
  await result(page, 1).locator('.unit-chip').click();
  await page.getByPlaceholder(/type a unit/).fill('mm');
  await page.getByPlaceholder(/type a unit/).press('Enter');
  // the row becomes a plain number: "mm" no longer fits
  await field(page, 1).click();
  await expect(field(page, 1)).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('5', { delay: 25 });
  await page.locator('.title-input').click();
  const warn = result(page, 1).locator('.warn');
  await expect(warn).toHaveCount(1);
  for (const choice of ['(none)', '%']) {
    await result(page, 1).locator('.unit-chip').click();
    await page.locator('.unit-menu button').filter({ hasText: choice }).first().click();
    await expect(warn).toHaveCount(0);
  }
  await expect(result(page, 1)).toContainText('500');
});

test('margin switches: folder scope and fraction', async ({ page }) => {
  await openSample(page);
  // row 3 of the sample, A = 20 mm², is inside the "Beam inputs" folder
  const row = page.locator('.row').nth(2);
  await row.hover();
  const scope = row.locator('.gutter-btn.scope');
  await expect(scope).toHaveAttribute('aria-pressed', 'false');
  await expect(scope).toHaveAttribute('title', /A is visible everywhere. Click to keep it inside “Beam inputs”/);
  await scope.click();
  await expect(scope).toHaveAttribute('aria-pressed', 'true');
  await expect(scope).toHaveAttribute('title', /A is only defined inside “Beam inputs”/);
  // the fraction switch: L = 1.5 m is 3/2 m
  const l = page.locator('.row').nth(3);
  await l.hover();
  const frac = l.locator('.gutter-btn.frac');
  await frac.click();
  await expect(l.locator('.row-result .result')).toContainText('3');
  await expect(frac).toHaveAttribute('aria-pressed', 'true');
  await frac.click();
  await expect(l.locator('.row-result .result')).toContainText('1.5');
});

test('drag from anywhere in the margin, but not from a switch', async ({ page }) => {
  await openSample(page);
  const value = (n: number) => page.locator('.row').nth(n).locator('math-field');
  // the bottom of row 3's margin (no switch there) onto row 2: A moves above F
  const g = page.locator('.row').nth(2).locator('.gutter');
  const box = (await g.boundingBox())!;
  await g.hover({ position: { x: box.width / 2, y: box.height - 6 } });
  await g.dragTo(page.locator('.row').nth(1), { sourcePosition: { x: box.width / 2, y: box.height - 6 } });
  await expect(value(1)).toHaveJSProperty('value', String.raw`A=20\unit{mm}^2`);
  // from the scope switch: nothing moves
  const row = page.locator('.row').nth(3);
  await row.hover();
  await row.locator('.gutter-btn.scope').dragTo(page.locator('.row').nth(1));
  await expect(value(3)).toHaveJSProperty('value', String.raw`L=1.5\unit{m}`);
});

test('keys typed straight after Enter go into the new row (review #23)', async ({ page }) => {
  await freshSheet(page);
  await field(page, 1).click();
  await expect(field(page, 1)).toBeFocused();
  for (let k = 1; k <= 6; k++) {
    await page.keyboard.type(String(k)); // no delay between keys
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('7');
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('.row math-field')].map((x) => (x as unknown as { value: string }).value)), { timeout: 10_000 })
    .toEqual(['1', '2', '3', '4', '5', '6', '7']);
});

test('text inserted in one go (dictation, IME) reaches the field (review #24)', async ({ page }) => {
  await freshSheet(page);
  await field(page, 1).click();
  await expect(field(page, 1)).toBeFocused();
  await page.keyboard.insertText('6m+2');
  await expect(field(page, 1)).toHaveJSProperty('value', '6m+2');
});

test('a second table gets its own names, x₂ and y₂ (review #1)', async ({ page }) => {
  await openSample(page);
  // the sample sheet already has a table with x₁ / y₁
  await page.getByRole('button', { name: /Add/ }).first().click();
  await page.getByRole('button', { name: /Table/ }).click();
  const headers = page.locator('.row.type-table').last().locator('math-field');
  await expect(headers.first()).toHaveJSProperty('value', 'x_{2}');
  await expect(page.locator('.result.error, .col-error')).toHaveCount(0);
});

test('a value typed past the slider’s range widens it (review #12)', async ({ page }) => {
  await openSample(page);
  // sample row 4: L = 1.5 m, slider 0 to 3
  const row = page.locator('.row').nth(3);
  const f = row.locator('math-field');
  await f.click();
  await expect(f).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('L=5m', { delay: 25 });
  await page.locator('.title-input').click();
  await expect(row.getByLabel('Slider maximum')).toHaveValue('10');
  await expect(row.getByLabel('Slider value')).toHaveValue('5');
});

test('unit, Tab, Enter typed fast leaves clean unit chips', async ({ page }) => {
  await freshSheet(page);
  await field(page, 1).click();
  await expect(field(page, 1)).toBeFocused();
  for (const v of ['6m', '2m']) {
    await page.keyboard.type(v);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  }
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('.row math-field')].map((x) => (x as unknown as { value: string }).value)))
    .toEqual([String.raw`6\unit{m}`, String.raw`2\unit{m}`, '']);
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
  // drag row 2 by its number (the margin) onto row 1
  const handle = page.locator('.row').nth(1).locator('.gutter .num');
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
  await openSample(page);
  // the sample worksheet evaluates without errors: σ = F / A shown in MPa
  await expect(page.locator('.row-result .result').filter({ hasText: 'MPa' }).first()).toContainText('300');
  await expect(page.locator('.result.error, .col-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a first visit: an empty sheet with the start card; an example goes into the row', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title-input')).toHaveValue('Untitled worksheet');
  await expect(page.locator('.row')).toHaveCount(1);
  const card = page.getByRole('region', { name: 'Getting started' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '6 kN / 20 mm²' }).click();
  await expect(card).toBeHidden();
  await expect(result(page, 1)).toContainText('0.3');
  await expect(result(page, 1)).toContainText('kN/mm²');
  await expect(field(page, 1)).toBeFocused();
  // the one-time tip about the unit button; Got it, and it stays gone
  const tip = page.locator('.row-notice.tip');
  await expect(tip).toContainText('Click the unit');
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(result(page, 1)).toContainText('kN/mm²');
  await expect(tip).toHaveCount(0);
});

test('the tour: every step done with Show me, then Finish goes back and removes the Tour sheet', async ({ page }) => {
  await page.goto('/');
  await typeRow(page, 1, '2+2');
  await page.getByRole('button', { name: 'Worksheets' }).click();
  await page.getByRole('button', { name: 'Take the tour' }).click();
  const coach = page.getByRole('dialog', { name: 'Tour' });
  await expect(page.locator('.title-input')).toHaveValue('Tour');
  const titles: string[] = [];
  for (let k = 0; k < 7; k++) {
    const title = (await coach.locator('h2').textContent())!;
    titles.push(title);
    await coach.getByRole('button', { name: 'Show me' }).click();
    await expect(coach.locator('.coach-done')).toBeVisible();
    await coach.getByRole('button', { name: 'Next →' }).click();
    await expect(coach.locator('h2')).not.toHaveText(title);
  }
  expect(titles).toEqual([
    'Numbers carry units',
    'Units do the arithmetic',
    'Show it your way',
    'Mistakes are caught',
    'Change one, update all',
    'Reuse an answer',
    'Functions and constants',
  ]);
  // the worksheet the tour built: no ⚠ left over, F changed, σ in MPa, #3 · 2
  await expect(page.locator('.result.error')).toHaveCount(0);
  await expect(page.locator('.row-result .result').filter({ hasText: 'MPa' }).first()).toContainText('400');
  await expect(coach.locator('h2')).toHaveText('That’s the tour');
  await coach.getByRole('button', { name: 'Finish' }).click();
  await expect(coach).toBeHidden();
  await expect(page.locator('.title-input')).toHaveValue('Untitled worksheet');
  await expect(result(page, 1)).toContainText('4');
  await page.getByRole('button', { name: 'Worksheets' }).click();
  await expect(page.locator('.menu-ws')).toHaveCount(1);
});

test('the tour moves on by itself once a step is done, and ✕ ends it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Take the 2-minute tour/ }).click();
  const coach = page.getByRole('dialog', { name: 'Tour' });
  await expect(coach.locator('h2')).toHaveText('Numbers carry units');
  await typeRow(page, 1, 'F=6kN');
  await expect(coach.locator('h2')).toHaveText('Units do the arithmetic');
  await coach.getByRole('button', { name: 'End the tour' }).click();
  await expect(coach).toBeHidden();
  await expect(page.locator('.title-input')).toHaveValue('Untitled worksheet');
  await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible();
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
    await openSample(page);
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

test.describe('phone keyboards', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the unit menu opens without the phone keyboard; tapping its search box brings it up', async ({ page }) => {
    await openSample(page);
    await page.locator('.row-result .unit-chip').first().tap();
    const search = page.getByPlaceholder(/type a unit/);
    await expect(search).toBeVisible();
    await expect(search).not.toBeFocused();
    await search.tap();
    await expect(search).toBeFocused();
  });
  test('a button in the keyboard’s tab bar hides it, and stays after switching tabs', async ({ page }) => {
    await openSample(page);
    const field = page.locator('.row math-field').nth(1);
    await field.tap();
    const kb = page.locator('.ML__keyboard.is-visible');
    await expect(kb).toBeVisible();
    const hide = page.getByRole('button', { name: 'Hide keyboard' });
    await expect(hide).toBeVisible();
    await page.locator('.ML__keyboard [data-layer]').filter({ hasText: /^abc$/ }).locator('visible=true').first().tap();
    await expect(hide).toBeVisible();
    await hide.tap();
    await expect(kb).toBeHidden();
    await expect(field).not.toBeFocused();
  });
  test('a swipe that starts on a field scrolls without raising the keyboard; a tap edits', async ({ page }) => {
    await openSample(page);
    const field = page.locator('.row math-field').nth(1);
    const box = (await field.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    // a touch that moves, then is taken over by scrolling (the browser cancels the pointer)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 15 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    await expect(field).not.toBeFocused();
    await expect(page.locator('.ML__keyboard.is-visible')).toHaveCount(0);
    // a tap does edit it
    await field.tap();
    await expect(field).toBeFocused();
    await expect(page.locator('.ML__keyboard.is-visible')).toBeVisible();
  });
  test('on-screen: x then 1 is x₁, and the next key leaves the subscript', async ({ page }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Worksheets' }).tap();
    await page.getByRole('button', { name: '+ New worksheet' }).tap();
    const f = page.locator('.row math-field').first();
    await f.tap();
    const key = (label: string) => page.locator(`.MLK__layer.is-visible div[tabindex="-1"][aria-label="${label}"]`).last();
    const tab = async (label: RegExp, shows: string) =>
      expect(async () => {
        await page.locator('.ML__keyboard [data-layer]').filter({ hasText: label }).locator('visible=true').first().tap();
        await expect(key(shows)).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
    await tab(/^abc$/, 'x');
    await key('x').tap();
    await key('1').tap(); // the letters page has a row of digits
    await key('2').tap();
    await tab(/^123$/, '+');
    await key('+').tap();
    await expect(f).toHaveJSProperty('value', 'x_{12}+');
    // on-screen ".": m then . is ṁ; 2 then . is a decimal point
    await tab(/^abc$/, 'm');
    await key('m').tap();
    await tab(/^123$/, '.');
    await key('.').tap();
    await key('2').tap();
    await key('.').tap();
    await key('5').tap();
    await expect(f).toHaveJSProperty('value', String.raw`x_{12}+\dot{m}2.5`);
  });
  test('the row being edited stays visible above the on-screen keyboard', async ({ page }) => {
    await openSample(page);
    // (row 4 of the sample sits where the keyboard will cover it)
    const field = page.locator('.row math-field').nth(3);
    await field.tap();
    // wait for the keyboard to finish sliding in: its bottom at the bottom of the screen
    const plate = page.locator('.ML__keyboard .MLK__backdrop');
    await expect(async () => {
      const k = (await plate.boundingBox())!;
      expect(Math.abs(k.y + k.height - 844)).toBeLessThan(2);
    }).toPass({ timeout: 3000 });
    const visible = async (el: typeof field) => {
      const f = (await el.boundingBox())!;
      const k = (await plate.boundingBox())!;
      const head = (await page.locator('.app-head').boundingBox())!;
      expect(f.y + f.height).toBeLessThanOrEqual(k.y);
      expect(f.y).toBeGreaterThanOrEqual(head.y + head.height);
    };
    await expect(() => visible(field)).toPass({ timeout: 2000 });
    // still visible after typing a new row with ↵
    await page.locator('.MLK__layer.is-visible .dim-return').first().tap();
    const next = page.locator('.row math-field').nth(4); // the new row, right after it
    await expect(next).toBeFocused();
    await expect(() => visible(next)).toPass({ timeout: 2000 });
  });
});

test.describe('phone ÷', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the on-screen ÷ after a unit chip divides by what comes next', async ({ page }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Worksheets' }).tap();
    await page.getByRole('button', { name: '+ New worksheet' }).tap();
    await page.locator('.row math-field').first().tap();
    const key = (sel: string, text?: RegExp) =>
      (text ? page.locator(`.MLK__layer.is-visible ${sel}`).filter({ hasText: text }) : page.locator(`.MLK__layer.is-visible ${sel}`)).first();
    await page.locator('.MLK__layer.is-visible div[tabindex="-1"]').filter({ has: page.locator('span.ML__cmr', { hasText: /^5$/ }) }).last().tap();
    // switch keyboard page, retrying until it shows (a tab tap is sometimes lost under load)
    const tab = async (label: RegExp, shows: () => ReturnType<typeof key>) =>
      expect(async () => {
        await page.locator('.ML__keyboard [data-layer]').filter({ hasText: label }).locator('visible=true').first().tap();
        await expect(shows()).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
    await tab(/^m kg$/, () => key('div[tabindex="-1"]', /^m$/));
    await key('div[tabindex="-1"]', /^m$/).tap();
    await tab(/^123$/, () => key('.dim-divide'));
    await key('.dim-divide').tap();
    await tab(/^m kg$/, () => key('div[tabindex="-1"]', /^s$/));
    await key('div[tabindex="-1"]', /^s$/).tap();
    await expect(page.locator('.row math-field').first()).toHaveJSProperty('value', String.raw`5\frac{\unit{m}}{\unit{s}}`);
  });
});
