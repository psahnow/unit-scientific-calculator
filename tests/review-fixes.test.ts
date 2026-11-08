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
    expect(res.infos.get('b')).toMatch(/m is your variable m, not the unit meter/);
    // a name that is also a unit, used as a name, gets no note
    expect(evalRows([e('a', r`A=2\unit{m}^2`), e('b', r`\frac{6}{A}`)]).infos.get('b')).toBeUndefined();
  });
  it('#5 a display unit from a package that is off is refused', () => {
    const res = evalRows([e('a', r`300\unit{MPa}`, { displayUnit: 'ksi' } as Partial<Row>)], []);
    const v = res.rows.get('a')!;
    expect(v.kind === 'value' && v.unitError).toMatch(/ksi is in the Mechanical engineering unit set, which is off/);
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
  it('#8 automatic fractions only for plain numbers; quantities with units show decimals', () => {
    expect(show(evalRows([e('a', r`3\unit{ft}+1\unit{m}`)]), 'a')).toBe('6.280839895 ft');
    expect(show(evalRows([e('a', r`1\unit{ft}\cdot1\unit{in}`)]), 'a')).toBe('0.08333333333 ft²');
    expect(show(evalRows([e('a', r`\frac{1}{3}`)]), 'a')).toBe('1/3');
    // the fraction is still there on request
    const v = evalRows([e('a', r`3\unit{ft}+1\unit{m}`)]).rows.get('a')!;
    if (v.kind !== 'value' || v.value.t !== 'q') throw new Error();
    expect(formatQuantity(v.value.q, { sigFigs: 10, notation: 'auto', mode: 'fraction' }).value).toBe('2393/381');
  });
  it('#10 whole numbers follow the significant figures', () => {
    const v = evalRows([e('a', r`123456\unit{m}`)]).rows.get('a')!;
    if (v.kind !== 'value' || v.value.t !== 'q') throw new Error();
    expect(formatQuantity(v.value.q, { sigFigs: 3, notation: 'auto', mode: 'auto' }).value).toBe('123000');
    expect(formatQuantity(v.value.q, { sigFigs: 10, notation: 'auto', mode: 'auto' }).value).toBe('123456');
    expect(formatQuantity(v.value.q, { sigFigs: 6, notation: 'auto', mode: 'auto' }).value).toBe('123456');
  });
  it('#13 a typo that only reads as three or more units is an error', () => {
    expect(show(evalRows([e('a', '1mplus1s')]), 'a')).toMatch(/^error: “mplus” isn't a unit or a name/);
    // two-unit compounds still work
    expect(show(evalRows([e('a', '5kNm')]), 'a')).toBe('5 kN·m');
    expect(show(evalRows([e('a', '2Nmm')]), 'a')).toBe('2 N·mm');
  });
  it('#7 rounding is symmetric: half away from zero', () => {
    for (const [x, want] of [['2.5', '3'], ['-2.5', '−3'], ['-0.5', '−1'], ['1.49', '1'], ['-1.49', '−1']])
      expect(show(evalRows([e('a', r`\operatorname{round}\left(${x}\right)`)]), 'a'), x).toBe(want);
  });
});
