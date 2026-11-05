import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity, DEFAULT_FORMAT } from '../src/engine/format';
import { parseUnitExpr, formatUnit, unitFactor } from '../src/engine/units/registry';
import * as N from '../src/engine/num';
import { UNITS } from '../src/engine/units/units.data';

type Line = string | { latex: string; unit?: string };

function run(lines: Line[], angle: 'rad' | 'deg' = 'rad') {
  const rows: Row[] = lines.map((l, i) =>
    typeof l === 'string' ? { id: 'r' + i, type: 'expr', latex: l } : { id: 'r' + i, type: 'expr', latex: l.latex, displayUnit: l.unit },
  );
  return evaluateWorksheet(rows, { angle });
}

/** Evaluate and return "value unit" of the last row (or the error message). */
function calc(lines: Line[] | Line, angle: 'rad' | 'deg' = 'rad', opts = DEFAULT_FORMAT): string {
  const ls = Array.isArray(lines) ? lines : [lines];
  const res = run(ls, angle);
  const r = res.rows.get('r' + (ls.length - 1))!;
  if (r.kind === 'error') return 'ERR: ' + r.message;
  if (r.kind !== 'value') return r.kind;
  if (r.value.t === 'list') return '[' + r.value.items.map((q) => formatQuantity(q, opts).value).join(', ') + '] ' + formatUnit(r.value.items[0]?.unit ?? []);
  const f = formatQuantity(r.value.q, opts);
  return (f.value + ' ' + f.unit).trim();
}

describe('basic arithmetic', () => {
  it('exact rationals', () => {
    expect(calc('1+2')).toBe('3');
    expect(calc('\\frac{1}{3}')).toBe('1/3');
    expect(calc('0.1+0.2')).toBe('0.3');
    expect(calc('2^{10}')).toBe('1024');
    expect(calc('\\sqrt{2}')).toBe('1.414213562');
    expect(calc('\\sqrt{16}')).toBe('4');
    expect(calc('5!')).toBe('120');
    expect(calc('2\\left(3+4\\right)')).toBe('14');
    expect(calc('-3^{2}')).toBe('−9');
  });
});

describe('units (spec §11)', () => {
  it('6 N / 2 mm² → 3 N/mm²', () => {
    expect(calc(['X=6\\unit{N}', 'A=2\\unit{mm}^{2}', '\\frac{X}{A}'])).toBe('3 N/mm²');
  });
  it('display unit dropdown → MPa, psi', () => {
    expect(calc(['X=6\\unit{N}', 'A=2\\unit{mm}^{2}', { latex: '\\frac{X}{A}', unit: 'MPa' }])).toBe('3 MPa');
    expect(calc(['X=6\\unit{N}', 'A=2\\unit{mm}^{2}', { latex: '\\frac{X}{A}', unit: 'psi' }])).toBe('435.1132132 psi');
  });
  it('first operand unit for addition', () => {
    expect(calc('2\\unit{m}+30\\unit{mm}')).toBe('2.03 m');
    expect(calc('30\\unit{mm}+2\\unit{m}')).toBe('2030 mm');
  });
  it('smart simplify', () => {
    expect(calc('\\left(2\\unit{kg}\\right)\\left(3\\frac{\\unit{m}}{\\unit{s}^{2}}\\right)')).toBe('6 N');
    expect(calc('5\\unit{N}\\cdot2\\unit{m}')).toBe('10 N·m');
    expect(calc('3\\unit{mm}\\cdot2\\unit{m}')).toBe('6000 mm²');
    expect(calc('\\frac{5\\unit{mm}}{1\\unit{m}}')).toBe('0.005');
    expect(calc('\\frac{3\\unit{m}}{3\\unit{m}}')).toBe('1');
  });
  it('6 N → lbf is exact', () => {
    const res = run([{ latex: 'F=6\\unit{N}', unit: 'lbf' }]);
    const r = res.rows.get('r0')!;
    if (r.kind !== 'value' || r.value.t !== 'q') throw new Error('bad');
    const f = formatQuantity(r.value.q);
    expect(f.raw.kind).toBe('exact');
    expect(f.value).toBe('1.348853659');
  });
  it('dimension errors', () => {
    expect(calc('5\\unit{m}+3\\unit{s}')).toMatch(/Can't add length \(m\) and time \(s\)/);
    expect(calc('\\sin\\left(5\\unit{N}\\right)')).toMatch(/sin expects an angle/);
  });
  it('implicit unit chips from bare letters (D17)', () => {
    expect(calc('6N')).toBe('6 N');
    expect(calc('2mm')).toBe('2 mm');
    expect(calc(['F=10\\unit{N}', '\\frac{F}{N}'])).toBe('10');
    expect(calc('5kN')).toBe('5 kN');
    expect(calc('3ft+6in')).toBe('3.5 ft');
  });
  it('defined single-letter variables win over units', () => {
    expect(calc(['m=3', '2m'])).toBe('6');
    expect(calc(['m=3', '2\\unit{m}'])).toBe('2 m');
    expect(calc(['m=3', 'm\\cdot2'])).toBe('6');
  });
  it('powers bind to the unit', () => {
    expect(calc('2\\unit{m}^{2}')).toBe('2 m²');
    expect(calc('\\sqrt{4\\unit{mm}^{2}}')).toBe('2 mm');
  });
});

describe('temperature', () => {
  it('affine rules', () => {
    expect(calc('20\\unit{\\degree C}+5\\unit{\\Delta\\degree C}')).toBe('25 °C');
    expect(calc('20\\unit{\\degree C}+5\\unit{\\degree C}')).toMatch(/two absolute temperatures/);
    expect(calc('30\\unit{\\degree C}-10\\unit{\\degree C}')).toBe('20 Δ°C');
    expect(calc({ latex: '100\\unit{\\degree C}', unit: '°F' })).toBe('212 °F');
    expect(calc({ latex: '0\\unit{\\degree C}', unit: 'K' })).toBe('273.15 K');
    expect(calc('2\\cdot20\\unit{\\degree C}')).toMatch(/absolute temperature/);
  });
});

describe('angles', () => {
  it('angle-tagged trig ignores mode', () => {
    expect(calc('\\sin\\left(30\\unit{\\degree}\\right)')).toBe('0.5');
    expect(calc('\\sin\\left(30\\unit{\\degree}\\right)', 'deg')).toBe('0.5');
    expect(calc('\\sin\\left(30^{\\circ}\\right)')).toBe('0.5');
  });
  it('bare numbers use mode', () => {
    expect(calc('\\sin\\left(30\\right)', 'deg')).toBe('0.5');
    expect(calc('\\cos\\left(\\pi\\right)')).toBe('−1');
  });
  it('inverse trig returns angle', () => {
    expect(calc('\\arcsin\\left(0.5\\right)', 'deg')).toBe('30 °');
  });
  it('arc length drops radian', () => {
    expect(calc('2\\unit{rad}\\cdot3\\unit{m}')).toBe('6 m');
  });
});

describe('variables, functions, inheritance', () => {
  it('display unit inheritance (D10)', () => {
    expect(calc(['X=6\\unit{N}', 'A=2\\unit{mm}^{2}', { latex: 'Y=\\frac{X}{A}', unit: 'MPa' }, 'Z=2Y'])).toBe('6 MPa');
    expect(calc([{ latex: 'F=6\\unit{N}', unit: 'lbf' }, 'G=2F'])).toBe('2.697707317 lbf');
  });
  it('user functions with units', () => {
    expect(calc(['f\\left(x\\right)=x^{2}\\cdot4\\frac{\\unit{N}}{\\unit{m}^{2}}', 'f\\left(3\\unit{m}\\right)'])).toBe('36 N');
  });
  it('cycles and undefined', () => {
    expect(calc(['a=b', 'b=a'])).toMatch(/Circular/);
    expect(calc('q+1')).toMatch(/not defined/);
    expect(calc(['a=1', 'a=2', 'a'])).toMatch(/more than once/);
  });
  it('subscripted names', () => {
    expect(calc(['F_{1}=2\\unit{kN}', 'F_{1}\\cdot2'])).toBe('4 kN');
  });
});

describe('lists', () => {
  it('broadcasting and stats', () => {
    expect(calc('\\left[1,2,3\\right]\\unit{m}')).toBe('[1, 2, 3] m');
    expect(calc('\\left[1\\unit{m},20\\unit{mm}\\right]')).toBe('[1, 0.02] m');
    expect(calc(['L=\\left[1,2,3\\right]\\unit{m}', '\\operatorname{mean}\\left(L\\right)'])).toBe('2 m');
    expect(calc(['L=\\left[1,2,3\\right]\\unit{m}', '2L'])).toBe('[2, 4, 6] m');
  });
});

describe('constants', () => {
  it('g0 and c', () => {
    expect(calc('10\\unit{kg}\\cdot\\const{g_{0}}')).toBe('98.0665 N');
    expect(calc('\\const{c}')).toBe('299792458 m/s');
  });
});

describe('unit parsing', () => {
  it('free-form', () => {
    expect(formatUnit(parseUnitExpr('N/mm^2'))).toBe('N/mm²');
    expect(formatUnit(parseUnitExpr('J/(kg·K)'))).toBe('J/(kg·K)');
    expect(formatUnit(parseUnitExpr('kip/in²'))).toBe('kip/in²');
    expect(formatUnit(parseUnitExpr('lbf ft'))).toBe('lbf·ft');
  });
  it('round-trips for every catalogue unit', () => {
    for (const u of UNITS) {
      const f = unitFactor(parseUnitExpr(u.id));
      expect(N.toNumber(f)).toBeCloseTo(N.toNumber(u.factor), 12);
    }
  });
});
