// Function inputs with a declared unit: F(l: m) = … (D52).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
function show(...lines: string[]): string {
  const rows: Row[] = lines.map((latex, i) => ({ id: 'r' + i, type: 'expr', latex }));
  const v = evaluateWorksheet(rows, { angle: 'rad' }).rows.get('r' + (lines.length - 1))!;
  if (v.kind === 'error') return 'error: ' + v.message;
  if (v.kind !== 'value') return v.kind;
  if (v.value.t === 'list') return '[' + v.value.items.map((q) => formatQuantity(q).value).join(', ') + '] ' + formatQuantity(v.value.items[0]).unit;
  const f = formatQuantity((v.value as unknown as { q: never }).q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

const F = r`F\left(l:\unit{m}\right)=2\cdot l`;

describe('typed function inputs', () => {
  it('converts an input of the right dimension to the declared unit', () => {
    expect(show(F, r`F\left(3\unit{in}\right)`)).toBe('0.1524 m');
    expect(show(F, r`F\left(250\unit{mm}\right)`)).toBe('0.5 m');
  });
  it('reads a plain number in the declared unit', () => {
    expect(show(F, r`F\left(3\right)`)).toBe('6 m');
  });
  it('refuses another dimension, saying what it needs', () => {
    expect(show(F, r`F\left(2\unit{kg}\right)`)).toMatch(/^error: F needs l to be a length, like m, not a mass \(kg\)/);
  });
  it('several typed inputs, compound units, and untyped ones alongside', () => {
    const P = r`P\left(F:\unit{kN},A:\unit{mm}^2,k\right)=\frac{k\cdot F}{A}`;
    expect(show(P, r`P\left(6000\unit{N},2\unit{cm}^2,1\right)`)).toBe('0.03 kN/mm²');
    expect(show(P, r`P\left(6,200,2\right)`)).toBe('0.06 kN/mm²');
  });
  it('lists: each item is converted', () => {
    expect(show(F, r`F\left(\left[1,2\right]\unit{ft}\right)`)).toBe('[0.6096, 1.2192] m');
  });
  it('temperatures: a °C input takes a kelvin value as a temperature', () => {
    expect(show(r`g\left(T:\unit{\degree C}\right)=T`, r`g\left(300\unit{K}\right)`)).toBe('26.85 °C');
    expect(show(r`g\left(T:\unit{\degree C}\right)=T`, r`g\left(20\right)`)).toBe('20 °C');
  });
  it('typed as plain letters, the unit is still a unit (not a variable)', () => {
    expect(show('m=5', r`G\left(l:m\right)=l`, r`G\left(2\unit{ft}\right)`)).toBe('0.6096 m');
  });
  it('a type must be a unit', () => {
    expect(show(r`H\left(l:3\right)=l`)).toMatch(/^error: After “l:” put a unit/);
    expect(show(r`H\left(l:\right)=l`)).toMatch(/^error: Put a unit after “l:”/);
  });
  it('real: a plain number, without units (D54)', () => {
    const R = r`R\left(k:real,L:\unit{m}\right)=k\cdot L`;
    expect(show(R, r`R\left(3,2\right)`)).toBe('6 m');
    expect(show(R, r`R\left(50\unit{\%},2\right)`)).toBe('1 m');
    expect(show(R, r`R\left(3\unit{m},2\right)`)).toMatch(/^error: R needs k to be a plain number, without units, not a length/);
  });
  it('untyped functions are unchanged', () => {
    expect(show(r`f\left(x\right)=2x`, r`f\left(3\unit{in}\right)`)).toBe('6 in');
  });
});
