// Regressions from the manual validation report.
import { describe, it, expect, afterEach } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { unitCandidates } from '../src/engine/units/candidates';
import { setCurrentPackages } from '../src/engine/units/packages';
import { fromUnit } from '../src/engine/quantity';
import * as N from '../src/engine/num';

const r = String.raw;
function run(rows: Row[], packages?: string[]) {
  return evaluateWorksheet(rows, { angle: 'rad', packages });
}
function show(rows: Row[], id: string, packages?: string[]) {
  const res = run(rows, packages).rows.get(id);
  if (!res || res.kind !== 'value') return res?.kind === 'error' ? 'error: ' + res.message : String(res?.kind);
  if (res.value.t !== 'q') return 'list';
  const f = formatQuantity(res.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}
const one = (latex: string, packages?: string[]) => show([{ id: 'x', type: 'expr', latex }], 'x', packages);

afterEach(() => setCurrentPackages([]));

describe('toolbox keys as MathLive writes them (findings 1–2)', () => {
  it('\\operatorname{\\mathrm{…}} works', () => {
    expect(one(r`\operatorname{\mathrm{erf}}\left(0.5\right)`)).toBe('0.5204998778');
    expect(one(r`\operatorname{\mathrm{nCr}}\left(5,2\right)`)).toBe('10');
    expect(one(r`\operatorname{\mathrm{mean}}\left(\left[1,2,3\right]\right)`)).toBe('2');
    expect(one(r`\operatorname{\mathrm{round}}\left(2.6\right)`)).toBe('3');
  });
});

describe('spelled-out unit names (finding 9)', () => {
  it('5 newton, 3 metres, 2 kilonewtons, 4 feet', () => {
    expect(one('5newton')).toBe('5 N');
    expect(one('3metres')).toBe('3 m');
    expect(one('3meters')).toBe('3 m');
    expect(one('2kilonewtons')).toBe('2 kN');
    expect(one('4feet')).toBe('4 ft');
  });
});

describe('package and scope explanations (findings 14, 17, 18)', () => {
  it('2Torr with Chemistry off says the unit is in a package that is off', () => {
    const res = run([{ id: 'x', type: 'expr', latex: '2Torr' }], []);
    const row = res.rows.get('x');
    expect(row?.kind === 'error' && row.message).toBe('“Torr” is a unit from Physics / Chemistry, which is off for this worksheet');
    expect(res.packageHints.get('x')).toMatchObject({ unit: 'Torr', typed: true });
  });
  it('an undefined name that exists only in another folder says so', () => {
    const rows: Row[] = [
      { id: 'A', type: 'folder', title: 'Folder' },
      { id: 'a1', type: 'expr', latex: r`F=3\unit{N}`, parent: 'A', scope: 'folder' },
      { id: 'B', type: 'folder', title: 'Folder' },
      { id: 'b1', type: 'expr', latex: r`F=5\unit{N}`, parent: 'B', scope: 'folder' },
      { id: 'x', type: 'expr', latex: r`\frac{F}{2}` },
    ];
    // farad off (no Electrical): F has no fallback meaning, so it's an error that names the folders
    expect(show(rows, 'x', [])).toBe('error: “F” is only defined inside “Folder (row 1)”, “Folder (row 3)”: make it global, or move this row into that folder');
  });
});

describe('unit dropdown candidates (finding 19)', () => {
  const fmt = (v: number) => String(v);
  const texts = (q: ReturnType<typeof fromUnit>) => unitCandidates(q, q.unit, fmt).flatMap((g) => g.items.map((c) => c.text));
  it('offers µN for forces', () => {
    expect(texts(fromUnit(N.exact(4n, 10000n), [{ id: 'N', power: 1 }]))).toContain('µN');
  });
  it('does not offer data sizes for plain numbers', () => {
    const t = texts(fromUnit(N.exact(10n), []));
    expect(t.some((x) => /bit|B$/.test(x))).toBe(false);
  });
});

describe('table input columns accept any unit (finding 5)', () => {
  it('a plain-number column given mm becomes lengths', () => {
    const rows: Row[] = [
      {
        id: 't',
        type: 'table',
        columns: [
          { id: 'c1', header: 'x_{1}', unit: 'mm', values: ['10', '20'] },
          { id: 'c2', header: r`y_{1}=2x_{1}`, values: [] },
        ],
      },
    ];
    const col = run(rows).columns.get('c2');
    expect(col?.values?.map((q) => formatQuantity(q).value + ' ' + formatQuantity(q).unit)).toEqual(['20 mm', '40 mm']);
  });
});
