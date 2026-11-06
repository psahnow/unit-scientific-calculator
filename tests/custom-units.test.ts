// Worksheet-defined units (D34).
import { describe, it, expect, afterEach } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { setCustomUnits, lookupUnit } from '../src/engine/units/registry';

const r = String.raw;
function show(units: { symbol: string; definition: string }[], ...lines: (string | { latex: string; unit?: string })[]) {
  const rows: Row[] = lines.map((l, i) => (typeof l === 'string' ? { id: 'r' + i, type: 'expr', latex: l } : { id: 'r' + i, type: 'expr', latex: l.latex, displayUnit: l.unit }));
  const res = evaluateWorksheet(rows, { angle: 'rad', packages: [], units });
  const v = res.rows.get('r' + (lines.length - 1));
  if (!v || v.kind !== 'value') return v?.kind === 'error' ? 'error: ' + v.message : String(v?.kind);
  if (v.value.t !== 'q') return 'list';
  const f = formatQuantity(v.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}
afterEach(() => setCustomUnits([]));

describe('custom units', () => {
  const bag = [{ symbol: 'bag', definition: '25 kg' }];
  it('typed after a number, and converted to and from', () => {
    expect(show(bag, '4bag')).toBe('4 bag');
    expect(show(bag, { latex: '4bag', unit: 'kg' })).toBe('100 kg');
    expect(show(bag, { latex: r`50\unit{kg}`, unit: 'bag' })).toBe('2 bag');
  });
  it('can build on each other and on compound units', () => {
    const defs = [
      { symbol: 'ksf', definition: 'kip/ft^2' },
      { symbol: 'pallet', definition: '40 bag' },
      { symbol: 'bag', definition: '25 kg' },
    ];
    // pallet is defined before bag exists: that one reports an error, the rest work
    const errs = setCustomUnits(defs);
    expect(errs[1]).toMatch(/Unknown unit 'bag'/);
    expect(errs[0]).toBeUndefined();
    expect(errs[2]).toBeUndefined();
  });
  it('reports bad definitions', () => {
    const errs = setCustomUnits([
      { symbol: 'm', definition: '2 ft' },
      { symbol: 'x1', definition: '2 ft' },
      { symbol: 'hot', definition: '5 °C' },
      { symbol: 'ok', definition: '3 ft' },
    ]);
    expect(errs[0]).toMatch(/already a unit/);
    expect(errs[1]).toMatch(/letters only/);
    expect(errs[2]).toMatch(/°C/);
    expect(errs[3]).toBeUndefined();
  });
  it('are removed when the worksheet no longer defines them', () => {
    setCustomUnits(bag);
    expect(lookupUnit('bag')).toBeDefined();
    setCustomUnits([]);
    expect(lookupUnit('bag')).toBeUndefined();
  });
});
