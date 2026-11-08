import { describe, it, expect } from 'vitest';
import { evaluateWorksheet } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { parseUnitExpr } from '../src/engine/units/registry';
import { CONSTANTS } from '../src/engine/units/constants.data';
import { COMPOUNDS } from '../src/engine/units/candidates';

const r = String.raw;
const one = (latex: string) => {
  const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex }], { angle: 'rad', packages: [] }).rows.get('x');
  if (!res || res.kind !== 'value') return res?.kind === 'error' ? 'error: ' + res.message : String(res?.kind);
  if (res.value.t !== 'q') return 'list';
  const f = formatQuantity(res.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
};

describe('constants and compound units', () => {
  it('every constant evaluates', () => {
    for (const c of CONSTANTS) expect(one(r`\const{${c.latex}}`), c.key).not.toMatch(/^error/);
  });
  it('G is the gravitational constant', () => {
    expect(one(r`\const{G}`)).toBe('6.6743×10⁻¹¹ m³/(kg·s²)');
  });
  it('ln needs a plain number, so ln(G) explains why, and ln(G in its units) works', () => {
    expect(one(r`\ln\left(\const{G}\right)`)).toBe(
      'error: ln needs a plain number, but this has units (m³/(kg·s²)). Divide by a unit to use its value, like ln(x / 1 m)',
    );
    expect(one(r`\ln\left(\frac{\const{G}}{\unit{m}^3/\left(\unit{kg}\cdot\unit{s}^2\right)}\right)`)).toBe('−23.43017169');
  });
  it('every dropdown compound parses, including powers before ")"', () => {
    for (const c of COMPOUNDS) expect(() => parseUnitExpr(c), c).not.toThrow();
    expect(parseUnitExpr('(kg*s^2)')).toEqual([
      { id: 'kg', power: 1 },
      { id: 's', power: 2 },
    ]);
    expect(parseUnitExpr('m^(1/2)')).toEqual([{ id: 'm', power: 0.5 }]);
  });
});
