import { describe, it, expect } from 'vitest';
import { evaluateWorksheet } from '../src/engine/worksheet';

const r = String.raw;
const msg = (latex: string) => {
  const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex }], { angle: 'rad' }).rows.get('x');
  return res?.kind === 'error' ? res.message : 'ok';
};

describe('plain-language errors (D28)', () => {
  it('Σ with no end value or nothing to add', () => {
    expect(msg(r`\sum_{i=0}`)).toBe('Σ needs an end value: type it above the Σ');
    expect(msg(r`\sum_{i=0}^{5}`)).toBe('Σ needs something to add up: type it after the Σ');
    expect(msg(r`\prod_{}^{5}n`)).toBe('Π needs a start below it, like n = 1');
    expect(msg(r`\sum_{i}^{5}i`)).toBe('Below the Σ, write the counter and where it starts, like n = 1');
  });
  it('an empty power left behind is ignored', () => {
    expect(msg(r`\int_{1}^{\infty}\frac{1}{x^{}}\,\mathrm{d}x`)).toMatch(/doesn't converge/); // ∫ 1/x diverges: the real answer
    expect(msg(r`\int_{1}^{2}\frac{1}{x^{}}\,\mathrm{d}x`)).toBe('ok');
    expect(msg(r`3^{}+1`)).toBe('ok');
  });
  it('empty fraction parts and stray symbols explain themselves', () => {
    expect(msg(r`\frac{}{2}`)).toMatch(/empty box/);
    expect(msg(r`2+`)).toMatch(/Something's missing/);
    expect(msg(r`2)`)).toMatch(/extra “\)”/);
    expect(msg(r`x<3`)).toMatch(/only go inside a piecewise/);
    expect(msg(r`a=b=2`)).toMatch(/Only one “=”/);
    expect(msg(r`\lim_{x\to}x`)).toMatch(/say where the variable goes/);
  });
});
