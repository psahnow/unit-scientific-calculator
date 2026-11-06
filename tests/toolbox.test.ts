import { describe, it, expect } from 'vitest';
import { evaluateWorksheet } from '../src/engine/worksheet';
import { GROUPS } from '../src/ui/toolbox.data';

const r = String.raw;
function evaluates(latex: string): string {
  const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex }], { angle: 'rad' }).rows.get('x');
  return res?.kind === 'error' ? res.message : 'ok';
}

/** Fill a key's placeholders the way a user would, with values its function accepts. */
function example(insert: string): string {
  let first = '0.5';
  if (/mean|median|stdev|var|sum|count|min|max|hypot/.test(insert)) first = r`\left[1,2,3\right]`;
  else if (/nCr|nPr|gcd|lcm|mod/.test(insert)) first = '6';
  else if (/acosh|cosh\^|sec\^|csc\^|arcsec|arccsc/.test(insert)) first = '2';
  let l = insert.replace('#0', first).replace(/#\?/g, '2');
  if (l.startsWith('^') || l === '!') l = '3' + l; // postfix keys act on the value before the caret
  if (l.includes(r`\degree`)) l = '30' + l;
  // a Greek letter is a name: check it can be defined and used
  if (/^\\[A-Za-z]+$/.test(l) && !['\\pi'].includes(l)) l = `${l}=2`;
  return l;
}

describe('toolbox keys', () => {
  const keys = GROUPS.flatMap((g) => g.keys.map((k) => ({ ...k, group: g.label })));
  it('has keys in every group', () => {
    for (const g of GROUPS) expect(g.keys.length).toBeGreaterThan(0);
  });
  for (const k of keys) {
    it(`${k.group}: ${k.label} → ${k.insert}`, () => {
      expect(evaluates(example(k.insert))).toBe('ok');
    });
  }
});
