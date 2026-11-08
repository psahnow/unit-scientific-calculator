// Vectors and complex numbers, optional per worksheet (D63).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row, type EvalSettings } from '../src/engine/worksheet';
import { formatValue } from '../src/engine/format';

const r = String.raw;
const fmt = { sigFigs: 10, notation: 'auto' as const, mode: 'auto' as const };
/** The last row's answer, written as the app writes it. */
function calc(lines: string[], s: Partial<EvalSettings>, alt = false): string {
  const rows: Row[] = lines.map((latex, i) => ({ id: 'r' + i, type: 'expr', latex }));
  const v = evaluateWorksheet(rows, { angle: 'rad', ...s }).rows.get('r' + (lines.length - 1))!;
  if (v.kind === 'error') return 'error: ' + v.message;
  if (v.kind !== 'value') return v.kind;
  const f = formatValue(v.value, fmt, { alt, angle: s.angle ?? 'rad', imag: s.imaginary });
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}
const V = { vectors: true };
const C = { imaginary: 'i' as const };

describe('vectors', () => {
  it('three ways to write one, with a unit for the whole vector', () => {
    expect(calc([r`\left(3,4\right)`], V)).toBe('(3, 4)');
    expect(calc([r`\left\langle3,4\right\rangle`], V)).toBe('(3, 4)');
    expect(calc([r`3i+4j`], V)).toBe('(3, 4)');
    expect(calc([r`3e_{1}+4e_{2}`], V)).toBe('(3, 4)');
    expect(calc([r`\left(3,4\right)\unit{N}`], V)).toBe('(3, 4) N');
    expect(calc([r`\left(3\unit{m},40\unit{cm}\right)`], V)).toBe('(3, 0.4) m');
  });
  it('arithmetic: sums pad with zeros, products are dot products, × is the cross product', () => {
    expect(calc([r`i+j+k`], V)).toBe('(1, 1, 1)');
    expect(calc([r`\left(1,2\right)+k`], V)).toBe('(1, 2, 1)');
    expect(calc([r`2\left(1,2\right)`], V)).toBe('(2, 4)');
    expect(calc([r`\left(1,2\right)/3`], V)).toBe('(1/3, 2/3)');
    expect(calc([r`\left(1,2,3\right)\cdot\left(4,5,6\right)`], V)).toBe('32');
    expect(calc([r`i\times j`], V)).toBe('(0, 0, 1)');
    expect(calc([r`\operatorname{cross}\left(j,k\right)`], V)).toBe('(1, 0, 0)');
    expect(calc([r`\left(1,2\right)^2`], V)).toBe('5');
    expect(calc([r`\left|\left(3,4\right)\right|`], V)).toBe('5');
    expect(calc([r`\operatorname{norm}\left(\left(1,1\right)\right)`], V)).toBe('1.414213562');
  });
  it('units carry through: torque r × F, work F · d', () => {
    const lines = [r`F=\left(3,4,0\right)\unit{N}`, r`r=\left(0,0,2\right)\unit{m}`];
    expect(calc([...lines, r`r\times F`], V)).toMatch(/^\(−8, 6, 0\) (N·m|m·N)$/);
    expect(calc([...lines, r`F\cdot\left(1,0,0\right)\unit{m}`], V)).toMatch(/^3 (N·m|J)$/);
    expect(calc([...lines, r`\left|F\right|`], V)).toBe('5 N');
  });
  it('the other written form: 3î + 4ĵ, and eₙ past three dimensions', () => {
    expect(calc([r`\left(3,-4\right)`], V, true)).toBe('3î − 4ĵ');
    expect(calc([r`\left(0,1,0\right)`], V, true)).toBe('ĵ');
    expect(calc([r`\left(3,4\right)\unit{N}`], V, true)).toBe('(3î + 4ĵ) N');
    expect(calc([r`\left(1,0,0,2\right)`], V, true)).toBe('e₁ + 2e₄');
  });
  it('mistakes are explained', () => {
    expect(calc([r`\left(1\unit{m},2\unit{s}\right)`], V)).toMatch(/^error: Every part of a vector needs the same kind of unit/);
    expect(calc([r`\left(1,2\right)+3`], V)).toMatch(/^error: Can't add a vector and a single value/);
    expect(calc([r`\sin\left(i\right)`], V)).toMatch(/^error: .*not vectors/);
    expect(calc([r`\left(1,2,3,4\right)\times i`], V)).toMatch(/^error: The cross product/);
    expect(calc([r`\left(1,2\right)^3`], V)).toMatch(/^error: A vector can only be squared/);
  });
  it('your own i, j, k win, and with vectors off nothing changes', () => {
    expect(calc(['i=5', 'i+1'], V)).toBe('6');
    expect(calc([r`\left(1,2\right)`], {})).toBe('[1, 2]');
    expect(calc(['3i'], {})).toMatch(/isn't defined yet.*turn on complex numbers or vectors/);
  });
});

describe('complex numbers', () => {
  it('arithmetic stays exact where it can', () => {
    expect(calc([r`3+4i`], C)).toBe('3 + 4i');
    expect(calc([r`\left(1+2i\right)\left(3-i\right)`], C)).toBe('5 + 5i');
    expect(calc([r`\frac{1}{i}`], C)).toBe('−i');
    expect(calc([r`i^2`], C)).toBe('−1');
    expect(calc([r`\left(1+2i\right)^3`], C)).toBe('−11 − 2i');
    expect(calc([r`\frac{1+i}{1-i}`], C)).toBe('i');
  });
  it('roots and logs of negatives, Euler', () => {
    expect(calc([r`\sqrt{-4}`], C)).toBe('2i');
    expect(calc([r`\ln\left(-1\right)`], C)).toBe('3.141592654i');
    expect(calc([r`e^{i\pi}`], C)).toBe('−1');
    expect(calc([r`\left|3+4i\right|`], C)).toBe('5');
    expect(calc([r`\operatorname{conj}\left(3+4i\right)`], C)).toBe('3 − 4i');
    expect(calc([r`\operatorname{re}\left(3+4i\right)`], C)).toBe('3');
    expect(calc([r`\operatorname{im}\left(3+4i\right)`], C)).toBe('4');
    expect(calc([r`\operatorname{arg}\left(1+i\right)`], { ...C, angle: 'deg' })).toBe('45 °');
  });
  it('units: impedance times current is a voltage', () => {
    expect(calc([r`Z=\left(3+4i\right)\unit{\Omega}`, r`Z\cdot2\unit{A}`], C)).toBe('(6 + 8i) V');
    expect(calc([r`Z=\left(3+4i\right)\unit{\Omega}`, r`\left|Z\right|`], C)).toBe('5 Ω');
  });
  it('polar input and output follow RAD/DEG', () => {
    expect(calc([r`2\angle90\unit{\degree}`], C)).toBe('2i');
    expect(calc([r`2\angle90`], { ...C, angle: 'deg' })).toBe('2i');
    expect(calc([r`3+4i`], { ...C, angle: 'deg' }, true)).toBe('5∠53.13010235°');
    expect(calc([r`3+4i`], C, true)).toBe('5∠0.927295218 rad');
  });
  it('j for electrical work', () => {
    expect(calc([r`3+4j`], { imaginary: 'j' })).toBe('3 + 4j');
    expect(calc([r`j^2`], { imaginary: 'j' })).toBe('−1');
    expect(calc(['3i'], { imaginary: 'j' })).toMatch(/isn't defined yet/);
  });
  it('what complex numbers can’t do is said, not guessed', () => {
    expect(calc([r`\sin\left(i\right)`], C)).toMatch(/^error: sin doesn't work with complex numbers/);
    expect(calc([r`\left\{i<2:1,0\right\}`], C)).toMatch(/^error: .*not a complex number/);
    expect(calc([r`2\angle90`], {})).toMatch(/turn on complex numbers/);
  });
  it('never both: complex numbers win if a saved file asks for both', () => {
    expect(calc([r`i^2`], { imaginary: 'i', vectors: true })).toBe('−1');
  });
});
