import { describe, it, expect } from 'vitest';
import { evaluateWorksheet } from '../src/engine/worksheet';
import { GROUPS } from '../src/ui/toolbox.data';

const r = String.raw;
function evaluates(latex: string): string {
  // x = 1 so derivative keys have a point to work at
  const res = evaluateWorksheet(
    [
      { id: 'x0', type: 'expr', latex: 'x=1' },
      { id: 'x', type: 'expr', latex },
    ],
    { angle: 'rad' },
  ).rows.get('x');
  return res?.kind === 'error' ? res.message : 'ok';
}

/** Fill a key's placeholders the way a user would, with values its function accepts. */
function example(insert: string): string {
  if (['<', '>', r`\le`, r`\ge`].includes(insert)) return r`\left\{1` + insert + r`2:1,0\right\}`;
  if (insert === r`\infty`) return r`\int_{0}^{\infty}e^{-x}\,\mathrm{d}x`;
  if (insert.includes('solve')) return insert.replace('#0', 'x^2').replace('#?', '2');
  if (insert.includes('roots')) return insert.replace('#0', 'x^2-1');
  let first = '0.5';
  if (insert.includes('infty')) first = 'e^{-x}';
  if (/\\(sum|prod)_/.test(insert)) first = '1';
  else if (/mean|median|stdev|var|sum|count|min|max|hypot/.test(insert)) first = r`\left[1,2,3\right]`;
  else if (/nCr|nPr|gcd|lcm|mod/.test(insert)) first = '6';
  else if (/acosh|cosh\^|sec\^|csc\^|arcsec|arccsc/.test(insert)) first = '2';
  let l = insert.replace('#0', first).replace(/#\?/g, '2');
  if (l.startsWith('^') || l === '!') l = '3' + l; // postfix keys act on the value before the caret
  if (l.includes(r`\degree`)) l = '30' + l;
  // a Greek letter is a name: check it can be defined and used
  if (/^\\[A-Za-z]+$/.test(l) && l !== r`\pi`) l = `${l}=2`;
  return l;
}

describe('toolbox keys', () => {
  const keys = GROUPS.flatMap((g) => g.keys.map((k) => ({ ...k, group: g.label })));
  it('has keys in every group', () => {
    for (const g of GROUPS) if (!g.browser) expect(g.keys.length).toBeGreaterThan(0);
  });
  for (const k of keys) {
    it(`${k.group}: ${k.label} → ${k.insert}`, () => {
      expect(evaluates(example(k.insert))).toBe('ok');
    });
  }
});
