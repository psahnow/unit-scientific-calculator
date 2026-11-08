// solve( ) and ans (D33).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
function show(...lines: string[]) {
  const rows: Row[] = lines.map((latex, i) => ({ id: 'r' + i, type: 'expr', latex }));
  const v = evaluateWorksheet(rows, { angle: 'rad', packages: [] }).rows.get('r' + (lines.length - 1));
  if (!v || v.kind !== 'value') return v?.kind === 'error' ? 'error: ' + v.message : String(v?.kind);
  if (v.value.t !== 'q') return 'list';
  const f = formatQuantity(v.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

describe('solve', () => {
  it('plain equations', () => {
    expect(show(r`\operatorname{solve}\left(x^2=2,x\right)`)).toBe('1.414213562');
    expect(show(r`solve\left(x^3-x=0,x,0.8\right)`)).toBe('1');
    expect(show(r`solve\left(\cos\left(x\right)=x,x\right)`)).toBe('0.7390851332');
  });
  it('in a range', () => {
    expect(show(r`solve\left(x^2=4,x,-5,0\right)`)).toBe('−2');
    expect(show(r`solve\left(x^2=-1,x,0,10\right)`)).toMatch(/no solution between/);
  });
  it('works out the unknown’s units: area for a stress', () => {
    expect(show(r`F=10\unit{kN}`, r`solve\left(\frac{F}{A}=250\unit{MPa},A\right)`)).toBe('0.00004 m²');
  });
  it('uses the units of a guess', () => {
    expect(show(r`solve\left(\frac{1}{2}\cdot9.81\unit{m}/\unit{s}^2\cdot t^2=20\unit{m},t,1\unit{s}\right)`)).toBe('2.019275109 s');
  });
  it('the defined variable gives the guess and units', () => {
    expect(show(r`d=10\unit{mm}`, r`solve\left(\pi\cdot\frac{d^2}{4}=100\unit{mm}^2,d\right)`)).toBe('11.28379167 mm');
  });
  it('explains mistakes', () => {
    expect(show(r`solve\left(x^2,x\right)`)).toMatch(/needs an equation with “=”/);
    expect(show(r`solve\left(x=2\right)`)).toMatch(/Write it like solve/);
    expect(show(r`solve\left(x+1\unit{m}=2\unit{s},x,1\unit{m}\right)`)).toMatch(/different kinds of unit|Can't add/);
    // x·m = 2 s does have an answer: x = 2 s/m
    expect(show(r`solve\left(x\unit{m}=2\unit{s},x\right)`)).toBe('2 s/m');
  });
});

describe('ans', () => {
  it('is the previous answer', () => {
    expect(show('2+3', r`ans\cdot2`)).toBe('10');
    expect(show(r`5\unit{m}`, '', r`ans+1\unit{m}`)).toBe('6 m');
  });
  it('explains when there is none', () => {
    expect(show('ans')).toMatch(/no row above has one/);
    expect(show('1/0', 'ans')).toMatch(/that row has an error/);
  });
});

describe('solve skips poles', () => {
  it('P/A = 250 MPa with A already defined near the answer', () => {
    expect(
      show(String.raw`P=12\unit{kN}`, String.raw`A=20\unit{mm}^2`, String.raw`\operatorname{\mathrm{solve}}\left(\frac{P}{A}=250\unit{MPa},A\right)`),
    ).toBe('48 mm²');
  });
  it('1/x = 2 from a negative guess still finds 0.5', () => {
    expect(show(String.raw`solve\left(\frac{1}{x}=2,x,-1\right)`)).toBe('0.5');
  });
});
