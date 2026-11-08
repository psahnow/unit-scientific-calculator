import { describe, it, expect } from 'vitest';
import { evaluateWorksheet } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
function calc(latex: string): string {
  const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex }], { angle: 'rad' }).rows.get('x');
  if (!res || res.kind !== 'value') return res?.kind === 'error' ? 'error: ' + res.message : String(res?.kind);
  if (res.value.t !== 'q') return 'list';
  const f = formatQuantity(res.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}
const op = (name: string, args: string) => r`\operatorname{${name}}\left(${args}\right)`;

describe('toolbox functions', () => {
  it('gamma, typed as Γ or gamma', () => {
    expect(calc(r`\Gamma\left(5\right)`)).toBe('24');
    expect(calc(r`\Gamma\left(0.5\right)`)).toBe('1.772453851');
    expect(calc(op('gamma', '4.5'))).toBe('11.6317284');
    expect(calc(r`\Gamma\left(0\right)`)).toMatch(/^error/);
    expect(calc(r`\Gamma\left(2\unit{m}\right)`)).toMatch(/^error/);
  });
  it('error function', () => {
    expect(calc(op('erf', '0.5'))).toBe('0.5204998778');
    expect(calc(op('erf', '3'))).toBe('0.9999779095');
    expect(calc(op('erfc', '3'))).toBe('0.000022090497');
  });
  it('inverse hyperbolic', () => {
    expect(calc(op('asinh', '1'))).toBe('0.881373587');
    expect(calc(op('acosh', '2'))).toBe('1.316957897');
    expect(calc(op('atanh', '0.5'))).toBe('0.5493061443');
    expect(calc(op('atanh', '1'))).toMatch(/^error/);
  });
  it('combinatorics and number theory are exact', () => {
    expect(calc(op('nCr', '5,2'))).toBe('10');
    expect(calc(op('nPr', '5,2'))).toBe('20');
    expect(calc(op('nCr', '30,15'))).toBe('155117520');
    expect(calc(op('gcd', '12,18'))).toBe('6');
    expect(calc(op('lcm', '4,6,10'))).toBe('60');
    expect(calc(op('nCr', '5.5,2'))).toMatch(/^error/);
  });
});
