import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';

const r = String.raw;
let n = 0;
const expr = (latex: string, extra: Partial<Extract<Row, { type: 'expr' }>> = {}): Row => ({ id: 'r' + n++, type: 'expr', latex, ...extra });
const folder = (id: string): Row => ({ id, type: 'folder', title: id });

function show(rows: Row[], id: string): string {
  const res = evaluateWorksheet(rows, { angle: 'rad' }).rows.get(id);
  if (!res || res.kind !== 'value') return res?.kind === 'error' ? 'error: ' + res.message : String(res?.kind);
  if (res.value.t !== 'q') return 'list';
  const f = formatQuantity(res.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

describe('folder scope (D24)', () => {
  it('lets each folder define its own F', () => {
    const a = expr(r`2F`, { parent: 'A' });
    const b = expr(r`2F`, { parent: 'B' });
    const rows = [
      folder('A'), expr(r`F=3\unit{N}`, { parent: 'A', scope: 'folder' }), a,
      folder('B'), expr(r`F=5\unit{N}`, { parent: 'B', scope: 'folder' }), b,
    ];
    expect(show(rows, a.id)).toBe('6 N');
    expect(show(rows, b.id)).toBe('10 N');
  });

  it('folder definitions shadow a global one only inside the folder', () => {
    const top = expr(r`2F`);
    const inA = expr(r`2F`, { parent: 'A' });
    const inB = expr(r`2F`, { parent: 'B' });
    const local = expr(r`F=3\unit{N}`, { parent: 'A', scope: 'folder' });
    const rows = [expr(r`F=1\unit{N}`), top, folder('A'), local, inA, folder('B'), inB];
    expect(show(rows, top.id)).toBe('2 N');
    expect(show(rows, inA.id)).toBe('6 N');
    expect(show(rows, inB.id)).toBe('2 N');
    expect(evaluateWorksheet(rows, { angle: 'rad' }).shadows.has(local.id)).toBe(true);
  });

  it('folder-scoped names are not visible outside', () => {
    const top = expr(r`G=2x`);
    const rows = [folder('A'), expr(r`x=3\unit{N}`, { parent: 'A', scope: 'folder' }), top];
    expect(show(rows, top.id)).toMatch(/^error/);
    // …and outside the folder F goes back to meaning the farad
    const farad = expr(r`2F`);
    expect(show([folder('A'), expr(r`F=3\unit{N}`, { parent: 'A', scope: 'folder' }), farad], farad.id)).toBe('2 F');
  });

  it('globals defined in a folder are computed in that folder (lexical)', () => {
    const use = expr(r`G`);
    const rows = [folder('A'), expr(r`F=3\unit{N}`, { parent: 'A', scope: 'folder' }), expr(r`G=2F`, { parent: 'A' }), use];
    expect(show(rows, use.id)).toBe('6 N');
  });

  it('functions see the scope they were defined in', () => {
    const call = expr(r`f(2)`, { parent: 'B' });
    const rows = [
      folder('A'), expr(r`k=10`, { parent: 'A', scope: 'folder' }), expr(r`f(x)=k\cdot x`, { parent: 'A' }),
      folder('B'), expr(r`k=1`, { parent: 'B', scope: 'folder' }), call,
    ];
    expect(show(rows, call.id)).toBe('20');
  });

  it('two globals with one name still clash; two folder-scoped ones in one folder clash too', () => {
    const g = expr(r`F=1`);
    const l = expr(r`F=3`, { parent: 'A', scope: 'folder' });
    const rows = [g, expr(r`F=2`), folder('A'), l, expr(r`F=4`, { parent: 'A', scope: 'folder' })];
    expect(show(rows, g.id)).toMatch(/defined more than once$/);
    expect(show(rows, l.id)).toMatch(/defined more than once in this folder/);
  });

  it('a folder-scoped row moved out of its folder becomes global', () => {
    const use = expr(r`2F`);
    const rows = [expr(r`F=3`, { scope: 'folder' }), use];
    expect(show(rows, use.id)).toBe('6');
  });
});
