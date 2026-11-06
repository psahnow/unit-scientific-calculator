import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
/** Evaluate rows; return the last one as "value unit" (or "error: …"). */
function calc(...lines: string[]): string {
  const rows: Row[] = lines.map((latex, i) => ({ id: 'r' + i, type: 'expr', latex }));
  const res = evaluateWorksheet(rows, { angle: 'rad' }).rows.get('r' + (lines.length - 1));
  if (!res || res.kind !== 'value') return res?.kind === 'error' ? 'error: ' + res.message : String(res?.kind);
  if (res.value.t !== 'q') return 'list';
  const f = formatQuantity(res.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

describe('integrals', () => {
  it('definite integrals', () => {
    expect(calc(r`\int_{0}^{1}x^2\,dx`)).toBe('0.3333333333');
    expect(calc(r`\int_{0}^{\pi}\sin\left(x\right)\,\mathrm{d}x`)).toBe('2');
    expect(calc(r`\int_{1}^{2}\frac{1}{t}dt`)).toBe('0.6931471806');
  });
  it('carry units: ∫ F dx is work, ∫ x dx over metres is m²', () => {
    expect(calc(r`\int_{0}^{2\unit{m}}5\unit{N}\,dx`)).toBe('10 N·m');
    expect(calc(r`\int_{0}^{3\unit{m}}x\,dx`)).toBe('4.5 m²');
    expect(calc(r`k=200\unit{N}/\unit{m}`, r`\int_{0}^{10\unit{mm}}k\cdot x\,dx`)).toBe('10 N·mm');
  });
  it('infinite limits', () => {
    expect(calc(r`\int_{0}^{\infty}e^{-x}dx`)).toBe('1');
    expect(calc(r`\int_{-\infty}^{\infty}e^{-x^2}dx`)).toBe('1.772453851');
  });
  it('variable limits inside a function', () => {
    expect(calc(r`F\left(t\right)=\int_{0}^{t}x\,dx`, r`F\left(2\right)`)).toBe('2');
  });
  it('needs dx and limits', () => {
    expect(calc(r`\int_{0}^{1}x^2`)).toMatch(/^error: End the integral/);
    expect(calc(r`\int x\,dx`)).toMatch(/^error: This integral needs both limits/);
  });
});

describe('derivatives', () => {
  it('at the current value of x', () => {
    expect(calc('x=3', r`\frac{d}{dx}x^2`)).toBe('6');
    expect(calc('x=1', r`\frac{d^2}{dx^2}x^3`)).toBe('6');
  });
  it('inside functions', () => {
    expect(calc(r`g\left(x\right)=\frac{\mathrm{d}}{\mathrm{d}x}\sin\left(x\right)`, r`g\left(0\right)`)).toBe('1');
  });
  it('carry units', () => {
    expect(calc(r`t=2\unit{s}`, r`\frac{d}{dt}\left(5\unit{m}/\unit{s}^2\cdot t^2\right)`)).toBe('20 m/s');
  });
  it('explains a missing value', () => {
    expect(calc(r`\frac{d}{dx}x^2`)).toMatch(/current value of x/);
  });
  it('ordinary fractions still work', () => {
    expect(calc(r`d=4`, r`\frac{d}{2}`)).toBe('2');
  });
});

describe('limits', () => {
  it('removable singularities and infinity', () => {
    expect(calc(r`\lim_{x\to0}\frac{\sin\left(x\right)}{x}`)).toBe('1');
    expect(calc(r`\lim_{x\to\infty}\left(1+\frac{1}{x}\right)^{x}`)).toBe('2.718281828');
    expect(calc(r`\lim_{x\to1}\frac{x^2-1}{x-1}`)).toBe('2');
  });
  it('one-sided and divergent', () => {
    expect(calc(r`\lim_{x\to0^{+}}\frac{1}{x}`)).toBe('∞');
    expect(calc(r`\lim_{x\to0^{-}}\frac{\left|x\right|}{x}`)).toBe('−1');
    expect(calc(r`\lim_{x\to0}\frac{\left|x\right|}{x}`)).toMatch(/doesn't exist/);
  });
});

describe('Σ and Π', () => {
  it('sums and products are exact', () => {
    expect(calc(r`\sum_{x=3}^{12}x`)).toBe('75');
    expect(calc(r`\prod_{n=1}^{5}n`)).toBe('120');
    expect(calc(r`\sum_{n=1}^{4}\frac{1}{n}`)).toBe('25/12');
  });
  it('with units and an empty range', () => {
    expect(calc(r`\sum_{n=1}^{3}n\unit{m}`)).toBe('6 m');
    expect(calc(r`\sum_{n=5}^{1}n`)).toBe('0');
  });
  it('the list function sum( ) still works', () => {
    expect(calc(r`\sum\left(\left[1,2,3\right]\right)`)).toBe('6');
  });
});

describe('piecewise', () => {
  const abs = r`\left\{x<0:-x,x\right\}`;
  it('picks the first matching case, else the otherwise value', () => {
    expect(calc('x=-2', abs)).toBe('2');
    expect(calc('x=5', abs)).toBe('5');
    expect(calc('x=5', r`\left\{x<0:-x\right\}`)).toMatch(/No piecewise case/);
  });
  it('chained, ≤ and units', () => {
    expect(calc('x=5', r`\left\{0<x<10:1,0\right\}`)).toBe('1');
    expect(calc('x=5', r`\left\{x\le5:1,0\right\}`)).toBe('1');
    expect(calc(r`F=3\unit{kN}`, r`\left\{F>2\unit{kN}:\unit{N},0\right\}`)).toBe('1 N');
    expect(calc(r`F=3\unit{kN}`, r`\left\{F>2\unit{m}:1,0\right\}`)).toMatch(/Can't compare/);
  });
  it('in functions', () => {
    expect(calc(r`f\left(x\right)=\left\{x<0:0,x^2\right\}`, r`f\left(-1\right)+f\left(3\right)`)).toBe('9');
  });
});

describe('divergent integrals', () => {
  it('say so', () => {
    expect(calc(String.raw`\int_{0}^{\infty}2\,dx`)).toMatch(/doesn't converge/);
  });
});
