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

describe('on-screen keyboard keys', () => {
  const keys = DIMENSIONAL_LAYOUTS.flatMap((layout) =>
    typeof layout === 'string'
      ? []
      : (layout as { label?: string; rows: unknown[][] }).rows.flat().flatMap((k) => {
          if (typeof k === 'string') return [];
          const key = k as { insert?: string; latex?: string; label?: string };
          const ins = key.insert ?? key.latex;
          return ins ? [{ tab: (layout as { label?: string }).label, label: key.label ?? ins, ins }] : [];
        }),
  );
  it('has keys on every Dimensional tab', () => expect(keys.length).toBeGreaterThan(80));
  for (const k of keys) {
    const ex = example(k.ins);
    if (ex === null) continue;
    it(`${k.tab}: ${k.label} → ${k.ins}`, () => expect(evaluates(ex)).toBe('ok'));
  }
});
