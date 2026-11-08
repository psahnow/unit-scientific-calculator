// Dotted names: ṁ, ẍ, θ̇ (D61).
import { describe, it, expect } from 'vitest';
import { evaluateWorksheet, renameDefinition, type Row } from '../src/engine/worksheet';
import { formatQuantity } from '../src/engine/format';
import { latexToSymbol, symbolToLatex } from '../src/engine/latex';
import { varLatex, suggestionsFor } from '../src/engine/suggest';

const r = String.raw;
const e = (id: string, latex: string): Row => ({ id, type: 'expr', latex });
const ev = (rows: Row[]) => evaluateWorksheet(rows, { angle: 'rad', packages: [] });
function show(res: ReturnType<typeof ev>, id: string) {
  const v = res.rows.get(id)!;
  if (v.kind === 'error') return 'error: ' + v.message;
  if (v.kind !== 'value' || v.value.t !== 'q') return v.kind;
  const f = formatQuantity(v.value.q);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

describe('dotted names in suggestions', () => {
  const labels = (p: string, vars: string[], afterNumber: boolean) => suggestionsFor(p, vars, afterNumber).map((s) => s.label);
  it('only a dotted name defined in scope is offered, right after the unit', () => {
    expect(labels('m', [], false)).not.toContain('ṁ');
    expect(labels('g', ['ṁ'], false)).not.toContain('ġ');
    expect(labels('m', ['ṁ'], false).slice(0, 2)).toEqual(['m', 'ṁ']);
    expect(labels('m', ['ṁ'], true).slice(0, 2)).toEqual(['m', 'ṁ']);
  });
  it('after a number, ṁ is multiplied: 6 · ṁ', () => {
    expect(suggestionsFor('m', ['ṁ'], true).find((s) => s.label === 'ṁ')!.insert).toBe(r`\cdot\dot{m}`);
    expect(suggestionsFor('m', ['ṁ'], false).find((s) => s.label === 'ṁ')!.insert).toBe(r`\dot{m}`);
  });
  it('a defined ṁ is "variable" and still after the unit; defined ṁ₁ and m̈ follow', () => {
    const s = suggestionsFor('m', ['ṁ', 'ṁ_1', 'm̈'], false);
    expect(s.slice(0, 4).map((x) => [x.label, x.detail])).toEqual([
      ['m', 'meter'],
      ['ṁ', 'variable'],
      ['ṁ_1', 'variable'],
      ['m̈', 'variable'],
    ]);
  });
  it('a letter with nothing defined gets no list (x then Tab stays x)', () => {
    expect(labels('x', [], false)).toEqual([]);
    expect(labels('x', ['ẋ'], false)).toEqual(['ẋ']);
  });
});

describe('dotted names', () => {
  it('ṁ is its own name, apart from m (the unit) and m (a variable)', () => {
    const res = ev([e('a', r`\dot{m}=2\unit{kg}/\unit{s}`), e('b', r`\dot{m}\cdot3\unit{s}`), e('c', '5m'), e('d', 'm=4'), e('f', r`\dot{m}\cdot m`)]);
    expect(show(res, 'a')).toBe('2 kg/s');
    expect(show(res, 'b')).toBe('6 kg');
    expect(res.rows.get('a')).toMatchObject({ defName: 'ṁ' });
    expect(show(res, 'f')).toBe('8 kg/s');
  });
  it('double dots, Greek letters and subscripts', () => {
    const res = ev([
      e('a', r`\ddot{x}=9.8\unit{m}/\unit{s}^{2}`),
      e('b', r`\dot{\theta}=2`),
      e('c', r`\dot{\theta}\cdot\ddot{x}`),
      e('d', r`\dot{m}_{1}=5`),
      e('g', r`\dot{m}_{1}+1`),
    ]);
    expect(show(res, 'c')).toBe('19.6 m/s²');
    expect(show(res, 'g')).toBe('6');
    expect(res.varsIn(null)).toEqual(expect.arrayContaining(['ẍ', 'θ̇', 'ṁ_1']));
  });
  it('an undefined dotted name says so, with the dot', () => {
    expect(show(ev([e('a', r`\dot{Q}`)]), 'a')).toMatch(/“Q̇” isn't defined yet/);
  });
  it('a dotted name round-trips to LaTeX, so suggestions and renames write it back', () => {
    for (const name of ['ṁ', 'ẍ', 'θ̇', 'ṁ_1', 'Q̇_{in}'.replace(/[{}]/g, '')]) {
      const latex = varLatex(name);
      expect(latexToSymbol(latex), latex).toBe(name);
    }
    expect(symbolToLatex('ṁ')).toBe(r`\dot{m}`);
    expect(varLatex('θ̈')).toBe(r`\ddot{\theta}`);
  });
  it('renaming m to ṁ updates every use', () => {
    const rows = [e('a', r`m=2\unit{kg}`), e('b', r`3m`)];
    const out = renameDefinition(rows, ev(rows), 'a', 'ṁ');
    if (typeof out === 'string') throw new Error(out);
    expect(out.map((x) => (x as { latex: string }).latex)).toEqual([r`\dot{m}=2\unit{kg}`, r`3\dot{m}`]);
    expect(show(ev(out), 'b')).toBe('6 kg');
    // typed in the rename box as m.
    expect(renameDefinition(rows, ev(rows), 'a', 'm.')).toEqual(out);
    expect(renameDefinition(rows, ev(rows), 'a', 'x..')).not.toBeTypeOf('string');
  });
});
