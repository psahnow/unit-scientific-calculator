// Import checks every field (D32).
import { describe, it, expect } from 'vitest';
import { migrate } from '../src/state/store';

describe('import validation', () => {
  it('rejects files that are not worksheets', () => {
    expect(() => migrate(null)).toThrow(/isn't a Dimensional worksheet/);
    expect(() => migrate({ title: 'x' })).toThrow(/isn't a Dimensional worksheet/);
  });

  it('repairs or drops malformed rows instead of crashing later', () => {
    const ws = migrate({
      title: 'Damaged',
      rows: [
        { id: 'a', type: 'expr', latex: 42 }, // latex not text
        { id: 'a', type: 'expr', latex: 'x=1' }, // duplicate id
        { id: 'b', type: 'note' }, // missing text
        { id: 'c', type: 'table', columns: 'nope' }, // unusable table: dropped
        { id: 'd', type: 'expr', latex: '2', parent: 'nowhere' }, // parent that isn't a folder
        { id: 'e', type: 'mystery' },
        'garbage',
        { id: 'f', type: 'table', columns: [{ id: 'k', header: 'x_1', values: [1, '2', null] }] },
      ],
      settings: { sigFigs: 999, notation: 'weird', packages: ['physics', 7], angle: 'deg' },
    });
    expect(ws.rows.map((r) => r.type)).toEqual(['expr', 'expr', 'note', 'expr', 'table']);
    const [a, a2, note, d, t] = ws.rows as any[];
    expect(a.latex).toBe('');
    expect(a2.id).not.toBe(a.id);
    expect(note.text).toBe('');
    expect(d.parent).toBeUndefined();
    expect(t.columns[0].values).toEqual(['1', '2', '']);
    expect(ws.settings).toMatchObject({ sigFigs: 16, notation: 'auto', packages: ['physics'], angle: 'deg' });
  });

  it('keeps a good worksheet as it was', () => {
    const good = {
      schema: 1,
      id: 'w',
      title: 'Beam',
      rows: [
        { id: 'f1', type: 'folder', title: 'Inputs', collapsed: true },
        { id: 'r1', type: 'expr', latex: 'F=6\\unit{kN}', parent: 'f1', displayUnit: 'lbf', scope: 'folder', slider: { min: '0', max: '10', step: '1' } },
      ],
      settings: { angle: 'rad', sigFigs: 4, notation: 'engineering', sciAbove: 6, packages: ['mechanical'], exactDefault: false },
    };
    const ws = migrate(good);
    expect(ws.rows).toEqual(good.rows);
    expect(ws.settings).toMatchObject(good.settings);
  });
});
