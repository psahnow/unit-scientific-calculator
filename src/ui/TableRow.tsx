import { TipLine } from './Onboarding';
import type { Tip } from './tour';
import type { Row, ColumnResult, TableColumn } from '../engine/worksheet';
import { formatQuantity, type FormatOptions } from '../engine/format';
import { formatUnit, parseUnitExpr } from '../engine/units/registry';
import { useStore, uid } from '../state/store';
import { MathInput } from './MathInput';
import { UnitButton } from './UnitDropdown';
import { RowMenu } from './rows';

type TableRowT = Extract<Row, { type: 'table' }>;

export function TableRow({ row, cols, fmt, vars, tip }: { row: TableRowT; cols: Map<string, ColumnResult>; fmt: FormatOptions; vars: string[]; tip?: Tip }) {
  const setCols = (columns: TableColumn[], merge?: string) => useStore.getState().updateRow(row.id, { columns }, merge);
  const nRows = Math.max(...row.columns.map((c) => (cols.get(c.id)?.isInput ? c.values.length : (cols.get(c.id)?.values?.length ?? 0))), 1);

  /** Paste rows of tab-, comma- or semicolon-separated values (from a spreadsheet or CSV), starting at a cell (D34). */
  const pasteBlock = (ci: number, ri: number, text: string) => {
    const lines = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((l, i, a) => l.trim() || i < a.length - 1);
    const sep = /\t/.test(text) ? '\t' : /;/.test(text) ? ';' : ',';
    const grid = lines.map((l) => l.split(sep).map((v) => v.trim()));
    const inputCols = row.columns.map((c, i) => ({ c, i })).filter(({ c }) => cols.get(c.id)?.isInput !== false);
    const start = inputCols.findIndex(({ i }) => i === ci);
    const columns = [...row.columns];
    grid.forEach((cells, dr) =>
      cells.forEach((v, dc) => {
        const target = inputCols[start + dc];
        if (!target) return;
        const col = columns[target.i];
        const values = [...col.values];
        while (values.length <= ri + dr) values.push('');
        values[ri + dr] = v;
        columns[target.i] = { ...col, values };
      }),
    );
    for (let i = 0; i < columns.length; i++)
      if (columns[i].values[columns[i].values.length - 1] !== '') columns[i] = { ...columns[i], values: [...columns[i].values, ''] };
    setCols(columns);
  };

  const setCell = (ci: number, ri: number, v: string) => {
    const columns = row.columns.map((c, i) => {
      if (i !== ci) return c;
      const values = [...c.values];
      while (values.length <= ri) values.push('');
      values[ri] = v;
      // keep one empty trailing row for entry
      if (values[values.length - 1] !== '') values.push('');
      return { ...c, values };
    });
    setCols(columns, `cell-${row.id}-${ci}-${ri}`);
  };

  return (
    <div className="row-body table-body">
      <div className="table-scroll">
        <table className="calc-table">
          <thead>
            <tr>
              {row.columns.map((c, ci) => {
                const res = cols.get(c.id);
                const q = res?.values?.[0];
                let autoUnit = q?.unit ?? [];
                try {
                  if (c.unit) autoUnit = res?.isInput ? parseUnitExpr(c.unit) : autoUnit;
                } catch {
                  /* bad unit */
                }
                return (
                  <th key={c.id}>
                    <div className="th-inner">
                      <MathInput
                        latex={c.header}
                        vars={vars}
                        ariaLabel={`Column ${ci + 1} header`}
                        onChange={(latex) =>
                          latex !== c.header &&
                          setCols(
                            row.columns.map((x) => (x.id === c.id ? { ...x, header: latex } : x)),
                            `hdr-${c.id}`,
                          )
                        }
                        onEnter={() => {}}
                        onMoveOut={() => {}}
                        onDeleteEmpty={() => {}}
                        onFocus={() => {}}
                        onBlur={() => {}}
                      />
                      <UnitButton
                        q={q}
                        autoUnit={autoUnit}
                        current={c.unit ? formatUnit(safeParse(c.unit)) : q ? formatUnit(q.unit) : ''}
                        userChosen={!!c.unit}
                        label="unit"
                        muted={!c.unit}
                        anyUnit={!!cols.get(c.id)?.isInput}
                        onPick={(u) => setCols(row.columns.map((x) => (x.id === c.id ? { ...x, unit: u } : x)))}
                      />
                      {row.columns.length > 1 && (
                        <button className="icon-btn small" title="Remove column" onClick={() => setCols(row.columns.filter((x) => x.id !== c.id))}>
                          ✕
                        </button>
                      )}
                    </div>
                    {res?.error && (
                      <div className="col-error" title={res.error}>
                        ⚠ {res.error}
                      </div>
                    )}
                  </th>
                );
              })}
              <th className="add-col">
                <button
                  className="icon-btn"
                  title="Add column"
                  onClick={() => setCols([...row.columns, { id: uid(), header: nextHeader(row.columns), values: [] }])}
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: nRows }, (_, ri) => (
              <tr key={ri}>
                {row.columns.map((c, ci) => {
                  const res = cols.get(c.id);
                  if (res?.isInput !== false)
                    return (
                      <td key={c.id}>
                        <input
                          className="cell"
                          value={c.values[ri] ?? ''}
                          onChange={(e) => setCell(ci, ri, e.target.value)}
                          onPaste={(e) => {
                            const text = e.clipboardData.getData('text/plain');
                            if (!/[\t\n,;]/.test(text.trim())) return; // a single value: normal paste
                            e.preventDefault();
                            pasteBlock(ci, ri, text);
                          }}
                          aria-label={`Row ${ri + 1} column ${ci + 1}`}
                        />
                      </td>
                    );
                  const q = res.values?.[ri];
                  return (
                    <td key={c.id} className="computed">
                      {q ? formatQuantity(q, fmt).value : ''}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip && <TipLine tip={tip} />}
      <div className="row-actions">
        <RowMenu id={row.id} />
      </div>
    </div>
  );
}

function safeParse(u: string) {
  try {
    return parseUnitExpr(u);
  } catch {
    return [];
  }
}

function nextHeader(cols: TableColumn[]): string {
  const letters = 'xyzuvwabcdpq';
  for (const l of letters) if (!cols.some((c) => c.header.startsWith(l + '_'))) return `${l}_{1}`;
  return `t_{${cols.length + 1}}`;
}
