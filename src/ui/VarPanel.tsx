// Variables panel (D50): on wide screens, the left margin lists every name the worksheet defines
// with its value, grouped by folder. Click one to go to its row.
import type { ReactNode } from 'react';
import type { Row, WorksheetResult } from '../engine/worksheet';
import { formatQuantity, type FormatOptions } from '../engine/format';
import { useStore } from '../state/store';

interface Item {
  id: string;
  name: string;
  value?: string;
  unit?: string;
  kind: 'value' | 'func' | 'error';
}

/** T_1 → T with a subscript 1; α stays α. */
function nameNode(name: string): ReactNode {
  const m = /^([^_]+)_\{?([^}]*)\}?$/.exec(name);
  return m ? (
    <>
      {m[1]}
      <sub>{m[2]}</sub>
    </>
  ) : (
    name
  );
}

export function VarPanel({ rows, result, fmt }: { rows: Row[]; result: WorksheetResult; fmt: FormatOptions }) {
  const focusRow = useStore((s) => s.focusRow);
  const groups: { title?: string; items: Item[] }[] = [];
  const byFolder = new Map<string | undefined, { title?: string; items: Item[] }>();
  const group = (parent: string | undefined) => {
    let g = byFolder.get(parent);
    if (!g) {
      const f = parent ? rows.find((r) => r.id === parent) : undefined;
      g = { title: f?.type === 'folder' ? f.title : undefined, items: [] };
      byFolder.set(parent, g);
      groups.push(g);
    }
    return g;
  };
  for (const row of rows) {
    if (row.type !== 'expr') continue;
    const r = result.rows.get(row.id);
    if (!r) continue;
    if (r.kind === 'value' && r.defName) {
      let value: string;
      let unit = '';
      if (r.value.t === 'q') {
        const f = formatQuantity(r.value.q, fmt);
        value = f.value;
        unit = f.unit;
      } else {
        value = `[${r.value.items.length} values]`;
        unit = r.value.items[0] ? formatQuantity(r.value.items[0], fmt).unit : '';
      }
      group(row.parent).items.push({ id: row.id, name: r.defName, value, unit, kind: 'value' });
    } else if (r.kind === 'func') group(row.parent).items.push({ id: row.id, name: r.name, kind: 'func' });
    else if (r.kind === 'error' && r.defName) group(row.parent).items.push({ id: row.id, name: r.defName, kind: 'error' });
  }
  const shown = groups.filter((g) => g.items.length);
  const jump = (id: string) => {
    focusRow(id);
    // after the folder opens and the row has the caret, bring it to the middle of the screen
    requestAnimationFrame(() => document.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  return (
    <aside className="var-panel" aria-label="Variables">
      <div className="var-panel-head">Variables</div>
      {!shown.length && <p className="var-empty">Names you define, like F = 6 kN, are listed here.</p>}
      {shown.map((g, gi) => (
        <section key={gi} className="var-group">
          {g.title && <div className="var-group-title">{g.title}</div>}
          <ul>
            {g.items.map((it) => (
              <li key={it.id}>
                <button className={`var-item ${it.kind}`} onClick={() => jump(it.id)} title="Go to this row">
                  <span className="var-name">
                    {nameNode(it.name)}
                    {it.kind === 'func' && <span className="var-args">( )</span>}
                  </span>
                  {it.kind === 'value' && (
                    <span className="var-value">
                      {it.value}
                      {it.unit && <span className="var-unit"> {it.unit}</span>}
                    </span>
                  )}
                  {it.kind === 'func' && <span className="var-value var-muted">function</span>}
                  {it.kind === 'error' && <span className="var-value var-err">⚠</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
