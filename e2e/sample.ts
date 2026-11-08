// The old "Beam check" sample (before D60), kept as a test fixture: many checks need a sheet with
// a folder, a slider, a note, a function and a table already in it.
import type { Page } from '@playwright/test';

const r = String.raw;
export const SAMPLE = {
  schema: 1,
  id: 'sample',
  title: 'Beam check',
  updated: 1,
  settings: { angle: 'rad', sigFigs: 10, notation: 'auto', sciAbove: 12, packages: [], exactDefault: true, units: [] },
  rows: [
    { id: 'f', type: 'folder', title: 'Beam inputs' },
    { id: 'r1', type: 'expr', latex: r`F=6\unit{kN}`, parent: 'f' },
    { id: 'r2', type: 'expr', latex: r`A=20\unit{mm}^{2}`, parent: 'f' },
    { id: 'r3', type: 'expr', latex: r`L=1.5\unit{m}`, parent: 'f', slider: { min: '0', max: '3', step: '0.1' } },
    { id: 'r4', type: 'note', text: 'Stress check — results come out in the units of the expression. Use the unit chip to switch.' },
    { id: 'r5', type: 'expr', latex: r`\sigma=\frac{F}{A}`, displayUnit: 'MPa' },
    { id: 'r6', type: 'expr', latex: r`M=F\cdot L` },
    { id: 'r7', type: 'expr', latex: r`f\left(x\right)=x^{2}\cdot4\frac{\unit{N}}{\unit{m}^{2}}` },
    { id: 'r8', type: 'expr', latex: r`f\left(L\right)` },
    { id: 'r9', type: 'expr', latex: r`20\unit{\degree C}+5\unit{\Delta\degree C}` },
    {
      id: 't',
      type: 'table',
      columns: [
        { id: 'c1', header: 'x_{1}', unit: 'mm', values: ['10', '20', '30', ''] },
        { id: 'c2', header: r`y_{1}=f\left(x_{1}\right)`, unit: 'µN', values: [] },
      ],
    },
    { id: 'r10', type: 'expr', latex: '' },
  ],
};

/** Open the app on a given worksheet, with the one-time tips already dismissed. */
export async function openSheet(page: Page, sheet: { id: string; title: string }) {
  await page.addInitScript((ws) => {
    if (localStorage.getItem('dimensional:ws:' + ws.id)) return;
    localStorage.setItem('dimensional:ws:' + ws.id, JSON.stringify(ws));
    localStorage.setItem('dimensional:worksheets', JSON.stringify([{ id: ws.id, title: ws.title, updated: 1 }]));
    localStorage.setItem('dimensional:current', ws.id);
    localStorage.setItem('dimensional:tips', JSON.stringify(['unit', 'func', 'folder', 'table', 'ref']));
  }, sheet);
  await page.goto('/');
  await page.waitForSelector('.row math-field');
}

/** Open the app on the sample sheet. */
export const openSample = (page: Page) => openSheet(page, SAMPLE);
