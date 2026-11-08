// Row references: #3 is the answer of row 3 (D56).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { renumberRefs } from '../src/engine/rowrefs';

const r = String.raw;
function showAll(rows: Row[]): string[] {
  const res = evaluateWorksheet(rows, { angle: 'rad' });
  return rows.map((row) => {
    const v = res.rows.get(row.id);
    if (!v || v.kind === 'none') return '';
    if (v.kind === 'error') return 'error: ' + v.message;
    if (v.kind !== 'value' || v.value.t !== 'q') return v.kind;
    const f = formatQuantity(v.value.q);
    return f.unit ? `${f.value} ${f.unit}` : f.value;
  });
}
const expr = (id: string, latex: string): Row => ({ id, type: 'expr', latex });

describe('#n row references', () => {
  it('a plain calculation row has a value by its number', () => {
    const out = showAll([expr('a', r`6\unit{m}`), expr('b', r`2\unit{m}`), expr('c', r`\#1\cdot\#2`)]);
    expect(out[2]).toBe('12 m²');
  });
  it('refers forward too, and follows the row’s display unit', () => {
    const rows: Row[] = [expr('a', r`\#2+1\unit{mm}`), { id: 'b', type: 'expr', latex: r`2\unit{m}`, displayUnit: 'mm' }];
    expect(showAll(rows)[0]).toBe('2001 mm');
  });
  it('definitions are used by name, not number', () => {
    const out = showAll([expr('a', r`a=6\unit{m}`), expr('b', r`\#1`)]);
    expect(out[1]).toBe('error: Row 1 defines a: use a rather than #1');
  });
  it('notes, folders, empty rows, missing rows', () => {
    const out = showAll([{ id: 'n', type: 'note', text: 'hi' }, expr('e', ''), expr('x', r`\#1`), expr('y', r`\#2`), expr('z', r`\#9`)]);
    expect(out[2]).toBe('error: Row 1 is a note, so #1 has no value');
    expect(out[3]).toBe('error: Row 2 is empty');
    expect(out[4]).toBe('error: There’s no row 9');
  });
  it('circular references are caught', () => {
    const out = showAll([expr('a', r`\#2+1`), expr('b', r`\#1+1`)]);
    expect(out[0]).toMatch(/Circular|error/);
    expect(out[1]).toMatch(/Circular|error/);
  });
  it('#{12} braces work too, and works inside functions', () => {
    const rows: Row[] = Array.from({ length: 11 }, (_, k) => expr('r' + k, String(k + 1)));
    rows.push(expr('f', r`f\left(x\right)=x+\#{3}`), expr('g', r`f\left(10\right)`));
    expect(showAll(rows)[12]).toBe('13');
  });
});

describe('references follow their rows when rows move', () => {
  const ids = (rows: Row[]) => rows.map((x) => x.id);
  it('a moved row keeps being referred to', () => {
    const before: Row[] = [expr('a', '5'), expr('b', '7'), expr('c', r`\#1+\#2`)];
    // move c to the top: c, a, b
    const moved = [before[2], before[0], before[1]];
    const after = renumberRefs(before, moved);
    expect(ids(after)).toEqual(['c', 'a', 'b']);
    expect((after[0] as { latex: string }).latex).toBe(r`\#2+\#3`);
    expect(showAll(after)[0]).toBe('12');
  });
  it('inserting a row above shifts the numbers', () => {
    const before: Row[] = [expr('a', '5'), expr('c', r`2\cdot\#1`)];
    const inserted = [expr('new', '1'), ...before];
    const after = renumberRefs(before, inserted);
    expect((after[2] as { latex: string }).latex).toBe(r`2\cdot\#2`);
    expect(showAll(after)[2]).toBe('10');
  });
  it('deleting the referred row leaves a clear error, not another row’s value', () => {
    const before: Row[] = [expr('a', '5'), expr('b', '9'), expr('c', r`\#1`)];
    const after = renumberRefs(before, [before[1], before[2]]);
    expect((after[1] as { latex: string }).latex).toBe(r`\#0`);
    expect(showAll(after)[1]).toMatch(/was deleted/);
  });
  it('text edits leave references alone', () => {
    const before: Row[] = [expr('a', '5'), expr('c', r`\#1`)];
    const edited = [expr('a', '6'), before[1]];
    expect(renumberRefs(before, edited)).toBe(edited);
  });
});
