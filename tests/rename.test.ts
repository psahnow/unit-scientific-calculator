// "Used by", rename and the DEG hint (D37).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, renameDefinition, type Row } from '../src/engine/worksheet';

const r = String.raw;
const ev = (rows: Row[], angle: 'rad' | 'deg' = 'rad') => evaluateWorksheet(rows, { angle, packages: [] });
const expr = (id: string, latex: string, extra: Partial<Extract<Row, { type: 'expr' }>> = {}): Row => ({ id, type: 'expr', latex, ...extra });

describe('references', () => {
  it('records uses of row-defined names, not bound variables', () => {
    const rows = [expr('a', r`x=2`), expr('b', r`x^2+\int_{0}^{1}t\,dt`), expr('c', r`f\left(t\right)=t\cdot x`), expr('d', r`f\left(3\right)`)];
    const res = ev(rows);
    expect(res.refs.get('b')!.map((x) => x.name)).toEqual(['x']);
    expect(res.refs.get('c')!.map((x) => x.name)).toEqual(['x']);
    expect(res.refs.get('d')!.map((x) => x.name)).toEqual(['f']);
  });
});

describe('rename', () => {
  it('renames the definition and every use', () => {
    const rows = [expr('a', r`F=6\unit{kN}`), expr('b', r`\frac{F}{2}`), expr('c', r`g\left(F\right)=F^2`), expr('d', r`F\cdot3+F`)];
    const out = renameDefinition(rows, ev(rows), 'a', 'P') as Row[];
    expect(out.map((x) => (x as { latex: string }).latex)).toEqual([r`P=6\unit{kN}`, r`\frac{P}{2}`, r`g\left(F\right)=F^2`, r`P\cdot3+P`]);
  });
  it('handles subscripts and Greek', () => {
    const rows = [expr('a', r`F_{1}=2`), expr('b', r`F_{1}+1`)];
    const out = renameDefinition(rows, ev(rows), 'a', 'σ_y') as Row[];
    expect((out[0] as { latex: string }).latex).toMatch(/^\\sigma\s*_\{y\}=2$/);
    expect((out[1] as { latex: string }).latex).toMatch(/^\\sigma\s*_\{y\}\+1$/);
  });
  it('only touches rows that mean the same definition (folders)', () => {
    const rows: Row[] = [
      expr('g', r`F=1`),
      { id: 'A', type: 'folder', title: 'A' },
      expr('l', r`F=5`, { parent: 'A', scope: 'folder' }),
      expr('in', r`2F`, { parent: 'A' }),
      expr('out', r`3F`),
    ];
    const out = renameDefinition(rows, ev(rows), 'g', 'G') as Row[];
    const latex = Object.fromEntries(out.filter((x) => x.type === 'expr').map((x) => [x.id, (x as { latex: string }).latex]));
    expect(latex).toEqual({ g: 'G=1', l: 'F=5', in: '2F', out: '3G' });
  });
  it('refuses names that are taken or not names', () => {
    const rows = [expr('a', 'x=1'), expr('b', 'y=2')];
    expect(renameDefinition(rows, ev(rows), 'a', 'y')).toMatch(/already defined/);
    expect(renameDefinition(rows, ev(rows), 'a', 'abc')).toMatch(/one letter/);
  });
});

describe('DEG hint', () => {
  it('appears for trig of plain numbers and inverse trig in DEG mode only', () => {
    const rows = [expr('a', r`\sin\left(30\right)`), expr('b', r`\sin\left(30\unit{\degree}\right)`), expr('c', r`\arcsin\left(0.5\right)`)];
    const deg = ev(rows, 'deg');
    expect(deg.infos.get('a')).toMatch(/DEG mode/);
    expect(deg.infos.get('b')).toBeUndefined();
    expect(deg.infos.get('c')).toMatch(/DEG mode/);
    expect(ev(rows, 'rad').infos.size).toBe(0);
  });
});
