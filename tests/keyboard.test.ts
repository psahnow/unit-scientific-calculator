// Every key on the on-screen keyboard inserts something Dimensional understands (D40).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet } from '../src/engine/worksheet';
import { DIMENSIONAL_LAYOUTS } from '../src/ui/keyboard';

const r = String.raw;
function evaluates(latex: string): string {
  const res = evaluateWorksheet(
    [
      { id: 'x0', type: 'expr', latex: 'x=1' },
      { id: 'x', type: 'expr', latex },
    ],
    { angle: 'rad', packages: [] },
  ).rows.get('x');
  return res?.kind === 'error' ? res.message : 'ok';
}

/** Put the key's LaTeX in a small expression the way a user would use it. */
function example(ins: string): string | null {
  if (/^(<|>|\\le|\\ge)$/.test(ins)) return r`\left\{1` + ins + r`2:1,0\right\}`;
  if (ins === r`\infty`) return r`\int_{0}^{\infty}e^{-x}\,\mathrm{d}x`;
  if (['=', ',', '!', '.', '_{#0}', r`\%`].includes(ins)) return null; // only meaningful next to something else
  if (ins === 'x') return 'x+1'; // x is already defined on the test sheet
  if (ins.startsWith(r`\cdot`)) return '3' + ins.replace('#0', '2'); // ×10ⁿ follows a number
  if (ins.startsWith('#@')) return '3' + ins.slice(2).replace('#0', '2').replace(/#\?/g, '2'); // acts on the value before the caret
  if (ins.includes('solve')) return ins.replace('#0', 'x^2').replace('#?', '2');
  let first = '0.5';
  if (/\\(sum|prod)_/.test(ins)) first = '1';
  else if (/mean|min|max/.test(ins)) first = r`\left[1,2,3\right]`;
  else if (/nCr|nPr|gcd|lcm|mod/.test(ins)) first = '6'; // whole numbers
  const l = ins.replace('#0', first).replace(/#\?/g, '2');
  if ((/^\\[A-Za-z]+$/.test(l) && l !== r`\pi`) || /^[A-Za-z]$/.test(l)) return `${l}=2`; // a letter or Greek letter: a name
  return l;
}

type RawKey = string | { insert?: string; latex?: string; label?: string; width?: number; class?: string };
/** Every page of every tab: a tab is either rows, or several layers (pages) of rows. */
const pages = DIMENSIONAL_LAYOUTS.flatMap((layout) => {
  const l = layout as { label?: string; rows?: RawKey[][]; layers?: { id: string; rows: RawKey[][] }[] };
  return l.layers ? l.layers.map((x) => ({ name: `${l.label} (${x.id})`, rows: x.rows })) : [{ name: l.label ?? '?', rows: l.rows ?? [] }];
});
const widthOf = (k: RawKey) =>
  typeof k === 'string' ? (k === '[separator-5]' ? 0.5 : k === '[shift]' ? 1.5 : 1) : (k.width ?? 1);
const labelOf = (k: RawKey) =>
  typeof k === 'string' ? k.replace(/^\[(.*)\]$/, '$1').replace('*', '×').replace('/', '÷').replace('-', '−') : (k.label ?? k.latex ?? k.insert ?? '');

describe('on-screen keyboard layout', () => {
  it('every page is five rows of ten key-widths, ending in the same bottom row', () => {
    const bottom = JSON.stringify(pages[0].rows[4]);
    for (const p of pages) {
      expect(p.rows.length, p.name).toBe(5);
      for (const [i, row] of p.rows.entries()) expect(row.reduce((a, k) => a + widthOf(k), 0), `${p.name} row ${i + 1}`).toBe(10);
      expect(JSON.stringify(p.rows[4]), p.name).toBe(bottom);
    }
  });
  it('no key appears twice on a page', () => {
    for (const p of pages) {
      const labels = p.rows.flat().map(labelOf).filter((x) => x && !/^separator/.test(x) && x !== 'shift');
      const dupes = labels.filter((x, i) => labels.indexOf(x) !== i);
      expect(dupes, p.name).toEqual([]);
    }
  });
});

describe('on-screen keyboard keys', () => {
  const keys = pages.flatMap((p) =>
    p.rows.flat().flatMap((k) => {
      if (typeof k === 'string') return [];
      const ins = k.insert ?? k.latex;
      return ins ? [{ tab: p.name, label: k.label ?? ins, ins }] : [];
    }),
  );
  it('has keys on every Dimensional tab', () => expect(keys.length).toBeGreaterThan(80));
  for (const k of keys) {
    const ex = example(k.ins);
    if (ex === null) continue;
    it(`${k.tab}: ${k.label} → ${k.ins}`, () => expect(evaluates(ex)).toBe('ok'));
  }
});
