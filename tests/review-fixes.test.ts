// Fixes from the November 2026 review (D59).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
function evalRows(rows: Row[], packages?: string[]) {
  return evaluateWorksheet(rows, { angle: 'rad', ...(packages ? { packages } : {}) });
}
function show(res: ReturnType<typeof evalRows>, id: string) {
  const v = res.rows.get(id)!;
  if (v.kind === 'error') return 'error: ' + v.message;
  if (v.kind !== 'value' || v.value.t !== 'q') return v.kind;
  const f = formatQuantity(v.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}
const e = (id: string, latex: string, extra: Partial<Row> = {}): Row => ({ id, type: 'expr', latex, ...extra }) as Row;

describe('review fixes', () => {
  it('#2 a folder-only name used outside its folder is an error, not a unit', () => {
    const rows: Row[] = [{ id: 'f', type: 'folder', title: 'Beam inputs' }, e('l', r`L=1.5\unit{m}`, { parent: 'f', scope: 'folder' } as Partial<Row>), e('m', r`M=6\unit{kN}\cdot L`)];
    expect(show(evalRows(rows), 'm')).toMatch(/^error: L is only defined inside “Beam inputs”/);
  });
  it('#3 a variable written right after a number says it is the variable, not the unit', () => {
    const res = evalRows([e('a', 'm=5'), e('b', '3m')]);
    expect(show(res, 'b')).toBe('15');
    expect(res.infos.get('b')).toMatch(/m is your variable m, not the unit metre/);
    // a name that is also a unit, used as a name, gets no note
    expect(evalRows([e('a', r`A=2\unit{m}^2`), e('b', r`\frac{6}{A}`)]).infos.get('b')).toBeUndefined();
  });
  it('#5 a display unit from a package that is off is refused', () => {
    const res = evalRows([e('a', r`300\unit{MPa}`, { displayUnit: 'ksi' } as Partial<Row>)], []);
    const v = res.rows.get('a')!;
    expect(v.kind === 'value' && v.unitError).toMatch(/ksi is a unit from Mechanical engineering, which is off/);
    expect(show(res, 'a')).toBe('300 MPa');
    // …and allowed when the package is on
    expect(show(evalRows([e('a', r`300\unit{MPa}`, { displayUnit: 'ksi' } as Partial<Row>)], ['mechanical']), 'a')).toMatch(/ksi$/);
  });
  it('#6 solve says when there are other solutions', () => {
    const res = evalRows([e('a', r`\operatorname{solve}\left(x^2=4,x\right)`)]);
    expect(show(res, 'a')).toBe('2');
    expect(res.infos.get('a')).toMatch(/there is another: −2\. roots\( \) lists them all/);
    expect(evalRows([e('a', r`\operatorname{solve}\left(2x=4,x\right)`)]).infos.get('a')).toBeUndefined();
  });
  it('#7 rounding is symmetric: half away from zero', () => {
    for (const [x, want] of [['2.5', '3'], ['-2.5', '−3'], ['-0.5', '−1'], ['1.49', '1'], ['-1.49', '−1']])
      expect(show(evalRows([e('a', r`\operatorname{round}\left(${x}\right)`)]), 'a'), x).toBe(want);
  });
});
