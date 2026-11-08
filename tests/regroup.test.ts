// Grouping a division while typing (D66): 6 m / s is 6 (m/s); 6 m / 3 s is (6 m)/(3 s).
import { describe, it, expect } from 'vitest';
import { regroups, isValueDenominator } from '../src/ui/regroup';
import { evaluateWorksheet } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
const apply = (latex: string, vars: string[] = [], ours: (numerator: string) => boolean = () => false) => {
  let out = latex;
  for (const g of regroups(latex, vars, ours).reverse()) out = out.slice(0, g.s) + g.latex + out.slice(g.e);
  return out;
};

describe('which denominators are values', () => {
  it('units alone are not; a number, constant, brackets or a defined name is', () => {
    expect(isValueDenominator(r`\unit{s}`, [])).toBe(false);
    expect(isValueDenominator(r`\unit{s}^2`, [])).toBe(false);
    expect(isValueDenominator(r`\unit{s}\unit{m}`, [])).toBe(false);
    expect(isValueDenominator('', [])).toBe(false);
    expect(isValueDenominator(r`3\unit{s}`, [])).toBe(true);
    expect(isValueDenominator(r`\const{g}`, [])).toBe(true);
    expect(isValueDenominator(r`\left(1+x\right)`, [])).toBe(true);
    expect(isValueDenominator('t', ['t'])).toBe(true);
    expect(isValueDenominator('F_{1}', ['F_1'])).toBe(true);
    expect(isValueDenominator(r`\Delta t`, ['t'])).toBe(true);
    // letters that aren't a defined name are units still being typed (k → kg)
    expect(isValueDenominator('k', [])).toBe(false);
    expect(isValueDenominator('kg', ['t'])).toBe(false);
  });
});

describe('regrouping', () => {
  it('a value over a value: the quantity goes on top', () => {
    expect(apply(r`6\frac{\unit{m}}{3\unit{s}}`)).toBe(r`\frac{6\unit{m}}{3\unit{s}}`);
    expect(apply(r`6.5\frac{\unit{m}}{3}`)).toBe(r`\frac{6.5\unit{m}}{3}`);
    expect(apply(r`6\frac{\unit{m}}{t}`, ['t'])).toBe(r`\frac{6\unit{m}}{t}`);
    expect(apply(r`12\frac{\unit{kN}\unit{m}}{2\unit{s}^{2}}`)).toBe(r`\frac{12\unit{kN}\unit{m}}{2\unit{s}^{2}}`);
  });
  it('a unit per unit stays as typed', () => {
    for (const l of [r`6\frac{\unit{m}}{\unit{s}}`, r`6\frac{\unit{m}}{\unit{s}^{2}}`, r`6\frac{\unit{m}}{k}`, r`6\frac{\unit{m}}{}`]) expect(apply(l)).toBe(l);
  });
  it('only the number right before moves: 2·6 m / 3 s and x + 6 m / 3 s', () => {
    expect(apply(r`2\cdot6\frac{\unit{m}}{3\unit{s}}`)).toBe(r`2\cdot\frac{6\unit{m}}{3\unit{s}}`);
    expect(apply(r`x+6\frac{\unit{m}}{3\unit{s}}`)).toBe(r`x+\frac{6\unit{m}}{3\unit{s}}`);
    // a name or a subscript before the fraction isn't a number to move
    expect(apply(r`x_{6}\frac{\unit{m}}{3}`)).toBe(r`x_{6}\frac{\unit{m}}{3}`);
  });
  it('back again when the denominator is units once more, for fractions this field moved', () => {
    const ours = (n: string) => n === r`6\unit{m}`;
    expect(apply(r`\frac{6\unit{m}}{\unit{s}}`, [], ours)).toBe(r`6\frac{\unit{m}}{\unit{s}}`);
    expect(apply(r`\frac{6\unit{m}}{}`, [], ours)).toBe(r`6\frac{\unit{m}}{}`);
    // a fraction typed that way on purpose is left alone
    expect(apply(r`\frac{6\unit{m}}{\unit{s}}`)).toBe(r`\frac{6\unit{m}}{\unit{s}}`);
  });
  it('fractions without units, and fractions inside fractions, are left alone', () => {
    for (const l of [r`\frac{1}{3}`, r`6\frac{1}{3}`, r`\frac{\frac{1}{2}}{3}`]) expect(apply(l)).toBe(l);
  });
  it('either way, the answer is the same', () => {
    const val = (latex: string) => {
      const v = evaluateWorksheet([{ id: 'a', type: 'expr', latex }], { angle: 'rad' }).rows.get('a')!;
      if (v.kind !== 'value' || v.value.t !== 'q') throw new Error(latex);
      const f = formatQuantity(v.value.q);
      return `${f.value} ${f.unit}`;
    };
    for (const l of [r`6\frac{\unit{m}}{3\unit{s}}`, r`2\cdot6\frac{\unit{m}}{3\unit{s}}`, r`12\frac{\unit{kN}\unit{m}}{2\unit{s}^{2}}`])
      expect(val(apply(l))).toBe(val(l));
  });
});
