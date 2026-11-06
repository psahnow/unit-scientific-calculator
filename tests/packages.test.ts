import { describe, it, expect, afterEach } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { suggestionsFor } from '../src/engine/suggest';
import { unitCandidates } from '../src/engine/units/candidates';
import { PACKAGES, setCurrentPackages, packagesOf } from '../src/engine/units/packages';
import { UNIT_BY_ID, UNITS } from '../src/engine/units/units.data';
import { getUnit } from '../src/engine/units/registry';
import { fromUnit } from '../src/engine/quantity';
import * as N from '../src/engine/num';

const r = String.raw;
function calc(latex: string, packages: string[], extra: Row[] = []) {
  const rows: Row[] = [...extra, { id: 'x', type: 'expr', latex }];
  const res = evaluateWorksheet(rows, { angle: 'rad', packages });
  const v = res.rows.get('x');
  const shown = !v || v.kind !== 'value' ? (v?.kind === 'error' ? 'error: ' + v.message : String(v?.kind)) : v.value.t === 'q' ? `${formatQuantity(v.value.q).value} ${formatQuantity(v.value.q).unit}`.trim() : 'list';
  return { shown, hint: res.packageHints.get('x'), chips: res.chips.get('x') };
}

afterEach(() => setCurrentPackages([]));

describe('unit packages (D26)', () => {
  it('every package unit exists in the catalogue', () => {
    for (const p of PACKAGES) for (const id of p.units) expect(UNIT_BY_ID.has(id), `${p.id}: ${id}`).toBe(true);
  });

  it('the base set keeps everyday units', () => {
    for (const id of ['m', 'kg', 's', 'N', 'Pa', 'MPa', 'J', 'W', 'kWh', 'psi', 'lbf', 'ft', 'in', '°C', '°F', 'L', 'gal', 'V', 'A', 'Ω', 'Hz', 'bar', 'atm', 'mph'])
      expect(packagesOf(getUnit(id)), id).toEqual([]);
  });

  it('bare letters only become package units when the package is on', () => {
    expect(calc('2Torr', []).shown).toMatch(/^error/);
    expect(calc('2Torr', ['chemistry']).shown).toBe('2 Torr');
    expect(calc('2Torr', ['physics']).shown).toBe('2 Torr'); // packages overlap
    expect(calc('3kip', []).shown).toMatch(/^error/);
    expect(calc('3kip', ['mechanical']).shown).toBe('3 kip');
  });

  it('prefixed package units follow their package', () => {
    expect(calc('5mM', []).shown).toMatch(/^error/);
    expect(calc('5mM', ['chemistry']).shown).toBe('5 mM');
  });

  it('a letter run falls back to base units when the longer unit is off', () => {
    // VA (volt-ampere) is Electrical; without it, VA reads as V·A
    expect(calc('2VA', []).shown).toBe('2 V·A');
    expect(calc('2VA', ['electrical']).shown).toBe('2 VA');
  });

  it('chips from a disabled package still calculate, with a hint naming the package', () => {
    const off = calc(r`2\unit{Torr}`, []);
    expect(off.shown).toBe('2 Torr');
    expect(off.hint).toEqual({ unit: 'Torr', packages: ['physics', 'chemistry'] });
    expect(calc(r`2\unit{Torr}`, ['chemistry']).hint).toBeUndefined();
  });

  it('new package units convert correctly', () => {
    expect(N.toNumber(fromUnit(N.exact(1n), [{ id: 'Ci', power: 1 }]).si)).toBe(3.7e10);
    expect(N.toNumber(fromUnit(N.exact(1n), [{ id: 'M', power: 1 }]).si)).toBe(1000); // mol/m³
    expect(UNITS.some((u) => u.id === 'Gy')).toBe(true);
  });

  it('autocomplete and dropdowns only offer enabled units', () => {
    expect(suggestionsFor('Tor', [], true).some((s) => s.label === 'Torr')).toBe(false);
    setCurrentPackages(['chemistry']);
    expect(suggestionsFor('Tor', [], true).some((s) => s.label === 'Torr')).toBe(true);
    setCurrentPackages([]);
    const q = fromUnit(N.exact(1n), [{ id: 'kPa', power: 1 }]);
    const fmt = (v: number) => String(v);
    const has = (id: string) => unitCandidates(q, q.unit, fmt).some((g) => g.items.some((c) => c.text === id));
    expect(has('psi')).toBe(true);
    expect(has('Torr')).toBe(false);
    expect(has('ksi')).toBe(false);
    setCurrentPackages(['mechanical']);
    expect(has('ksi')).toBe(true);
  });

  it('with no package list the engine allows every unit (API default)', () => {
    const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex: '2Torr' }], { angle: 'rad' });
    expect(res.rows.get('x')?.kind).toBe('value');
  });
});
