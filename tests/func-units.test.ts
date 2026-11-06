// A function whose inputs all have declared units shows the unit it gives, worked out by
// dimensional analysis of its body (D53).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatUnit } from '../src/engine/units/registry';

const r = String.raw;
function results(lines: string[]) {
  const rows: Row[] = lines.map((latex, i) => ({ id: 'r' + i, type: 'expr', latex }));
  return evaluateWorksheet(rows, { angle: 'rad' }).rows;
}
function outUnit(...lines: string[]): string | undefined | null {
  const res = results(lines).get('r' + (lines.length - 1))!;
  return res.kind === 'func' ? res.outUnit : null;
}

describe('function output units', () => {
  it('typed inputs: the unit the body gives', () => {
    expect(outUnit(r`F\left(l:\unit{m}\right)=2l`)).toBe('m');
    expect(outUnit(r`P\left(F:\unit{kN},A:\unit{mm}^2\right)=\frac{F}{A}`)).toBe('kN/mm²');
    expect(outUnit(r`W\left(m:\unit{kg}\right)=m\cdot9.81\unit{m}/\unit{s}^2`)).toBe('N');
    expect(outUnit(r`R\left(A:\unit{m}^2\right)=\sqrt{A}`)).toBe('m');
    expect(outUnit(r`S\left(x:\unit{m}\right)=\sin\left(\frac{x}{1\unit{m}}\right)`)).toBe('');
  });
  it('no sample values: works where a value would fail (1/(l − 1 m) at l = 1 m)', () => {
    expect(outUnit(r`G\left(l:\unit{m}\right)=\frac{1}{l-1\unit{m}}`)).toBe('m⁻¹');
  });
  it('uses the worksheet’s values and other typed functions', () => {
    expect(outUnit(r`E=200\unit{GPa}`, r`s\left(e:\unit{\%}\right)=E\cdot e`)).toBe('GPa');
    expect(outUnit(r`F\left(l:\unit{m}\right)=2l`, r`H\left(t:\unit{s}\right)=\frac{F\left(3\right)}{t}`)).toBe('m/s');
  });
  it('untyped inputs: nothing shown (it depends on what is passed in)', () => {
    expect(outUnit(r`f\left(x\right)=2x`)).toBeUndefined();
    expect(outUnit(r`g\left(x\right)=5\unit{N}\cdot\sin\left(x\right)`)).toBeUndefined();
    expect(outUnit(r`k\left(x:\unit{m},y\right)=x\cdot y`)).toBeUndefined();
  });
  it('a body whose units don’t add up shows nothing', () => {
    expect(outUnit(r`b\left(x:\unit{m}\right)=x+1\unit{s}`)).toBeUndefined();
  });
  it('agrees with what calling the function actually gives', () => {
    const bodies = [
      r`2l`,
      r`l^2\cdot3\unit{N}`,
      r`\frac{5\unit{kN}}{l}`,
      r`\sqrt{l\cdot2\unit{m}}`,
      r`\left|l\right|+3\unit{mm}`,
      r`\int_{0}^{l}x\,dx`,
      r`\ln\left(\frac{l}{1\unit{m}}\right)\cdot1\unit{s}`,
    ];
    for (const b of bodies) {
      const res = results([r`T\left(l:\unit{m}\right)=${b}`, r`T\left(2\unit{in}\right)`]);
      const f = res.get('r0')!;
      const v = res.get('r1')!;
      if (f.kind !== 'func' || v.kind !== 'value' || v.value.t !== 'q') throw new Error(b + ': ' + JSON.stringify(v.kind === 'error' ? v.message : v.kind));
      expect(f.outUnit, b).toBeDefined();
      // same unit text, so certainly the same dimension
      expect(f.outUnit, b).toBe(formatUnit(v.value.q.unit));
    }
  });
});
