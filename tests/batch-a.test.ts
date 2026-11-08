// Pre-release fixes, part 1 (D31).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
function show(lines: (string | { latex: string; unit?: string })[], packages: string[] = []) {
  const rows: Row[] = lines.map((l, i) =>
    typeof l === 'string' ? { id: 'r' + i, type: 'expr', latex: l } : { id: 'r' + i, type: 'expr', latex: l.latex, displayUnit: l.unit },
  );
  const res = evaluateWorksheet(rows, { angle: 'rad', packages });
  const v = res.rows.get('r' + (lines.length - 1));
  if (!v || v.kind !== 'value') return v?.kind === 'error' ? 'error: ' + v.message : String(v?.kind);
  if (v.value.t !== 'q') return 'list';
  const f = formatQuantity(v.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

describe('E-notation', () => {
  it('is a number', () => {
    expect(show(['6.02e23'])).toBe('6.02×10²³');
    expect(show(['1.5E-3'])).toBe('0.0015');
    expect(show(['2e+3'])).toBe('2000');
    expect(show([r`3e5\unit{Pa}`])).toBe('300000 Pa');
  });
  it('e without digits after it is still Euler’s number', () => {
    expect(show(['2e'])).toBe('5.436563657');
  });
});

describe('words from packages that are off', () => {
  it('say so instead of splitting into other units', () => {
    expect(show(['2slug'])).toBe('error: “slug” is in the Mechanical engineering unit set, which is off for this worksheet');
    expect(show(['2slug'], ['mechanical'])).toBe('2 slug');
  });
  it('words that read naturally letter by letter still do', () => {
    expect(show(['2VA'])).toBe('2 V·A');
  });
});

describe('recursion', () => {
  it('explains once', () => {
    const msg = show([r`f\left(x\right)=f\left(x\right)`, r`f\left(1\right)`]);
    expect(msg).toMatch(/^error: “f” keeps calling itself/);
    expect((msg.match(/f: /g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe('percent in products', () => {
  it('is just the number', () => {
    expect(show([r`20\%\cdot50`])).toBe('10');
    expect(show([r`50\%\cdot2\unit{m}`])).toBe('1 m');
    expect(show([r`20\%+5\%`])).toBe('25 %');
    expect(show([r`50\%`])).toBe('50 %');
  });
});

describe('spelled-out names and frequency', () => {
  it('celsius, fahrenheit, gallons, horsepower', () => {
    expect(show(['20celsius'])).toBe('20 °C');
    expect(show(['68fahrenheit'])).toBe('68 °F');
    expect(show(['5gallons'])).toBe('5 gal');
    expect(show(['3horsepower'])).toBe('3 hp');
  });
  it('1/time is a frequency', () => {
    expect(show([r`\frac{1}{2\unit{ms}}`])).toBe('0.5 kHz');
    expect(show([r`\frac{1}{4\unit{s}}`])).toBe('0.25 Hz');
    expect(show([r`3000\unit{rpm}`])).toBe('3000 rpm');
  });
});

describe('lb note', () => {
  it('a bare lb says it was read as pound-mass', () => {
    const res = evaluateWorksheet([{ id: 'x', type: 'expr', latex: '5lb' }], { angle: 'rad', packages: [] });
    expect(res.infos.get('x')).toMatch(/pound-mass/);
  });
});
