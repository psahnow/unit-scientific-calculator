import { describe, it, expect } from 'vitest';
import * as N from '../src/engine/num';
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
    expect(msg(r`x<3`)).toMatch(/only work inside { } cases/);
    expect(msg(r`a=b=2`)).toMatch(/Only one “=”/);
    expect(msg(r`\lim_{x\to}x`)).toMatch(/say where the variable goes/);
  });
});

describe('fractions MathLive writes without braces', () => {
  it('frac25 is 2/5, and the one-digit rule matches LaTeX', () => {
    const val = (latex: string) => {
      const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex }], { angle: 'rad', packages: [] }).rows.get('x');
      return res?.kind === 'value' && res.value.t === 'q' ? N.toNumber(res.value.q.si) : res?.kind === 'error' ? res.message : '?';
    };
    expect(val(String.raw`\frac25`)).toBe(0.4);
    expect(val(String.raw`\frac{12}{5}`)).toBe(2.4);
    expect(val(String.raw`\frac125`)).toBe(2.5); // \frac125 = (1/2)·5 in LaTeX
    expect(val(String.raw`\sqrt4`)).toBe(2);
    expect(val(String.raw`\frac{2}{5}\unit{m}`)).toBe(0.4);
  });
});
