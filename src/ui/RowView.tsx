// One row of the list: its margin (number, warnings, switches, drag), the row itself, and a crash
// boundary. It is memoized, so typing in one row re-renders only the rows whose own data changed.
import { memo, type DragEvent } from 'react';
import type { ColumnResult, Row, RowResult } from '../engine/worksheet';
import type { ChipFix } from '../engine/ast';
import type { FormatOptions, ValueView } from '../engine/format';
import { useStore } from '../state/store';
import { ExpressionRow, NoteRow, FolderRow, HoverTip, GutterTools } from './rows';
import { TableRow } from './TableRow';
import { RowBoundary } from './ErrorBoundary';
import type { Tip } from './tour';

/**
 * Everything about a row that comes from the calculation. App rebuilds these after each
 * recalculation but hands back the *same object* when nothing in it changed (see stableRowData in
 * App.tsx), so a row whose answer is unchanged is skipped by React.memo.
 */
export interface RowData {
  num: number;
  result?: RowResult;
  chips?: ChipFix[];
  vars: string[];
  shadows: boolean;
  notice?: string;
  info?: string;
  packageHint?: { unit: string; packages: string[]; typed?: boolean };
  tip?: Tip;
  /** The folder this row belongs to, for the scope switch's tooltip. */
  folderTitle?: string;
  /** For a folder: how many rows it holds. */
  childCount: number;
  /** For a table: the results of its columns. */
  columns?: Map<string, ColumnResult>;
}

/** Drag and drop of rows by their margin (D58): one stable object shared by every row. */
export interface DragApi {
  down(id: string): void;
  up(): void;
  start(e: DragEvent): void;
  over(e: DragEvent, id: string): void;
  drop(e: DragEvent, id: string): void;
  end(): void;
}

export interface RowViewProps {
  row: Row;
  data: RowData;
  fmt: FormatOptions;
  view: ValueView;
  /** This row uses the name defined in the row being edited. */
  usesFocus: boolean;
  dragging: boolean;
  dropTarget: boolean;
  drag: DragApi;
  rename(rowId: string, name: string): string | undefined;
}

export const RowView = memo(function RowView({ row, data, fmt, view, usesFocus, dragging, dropTarget, drag, rename }: RowViewProps) {
  // only this row's own "is it the one being edited" is subscribed to
  const focused = useStore((s) => s.focusId === row.id);
  const res = data.result;
  const isErr = res?.kind === 'error';
  const cls = [
    'row',
    `type-${row.type}`,
    usesFocus && 'uses-focus',
    row.type === 'expr' && !row.latex.trim() && 'is-empty',
    row.parent && 'in-folder',
    focused && 'focused',
    dropTarget && 'drop-target',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      data-row-id={row.id}
      className={cls}
      draggable={dragging}
      onDragStart={drag.start}
      onDragOver={(e) => drag.over(e, row.id)}
      onDrop={(e) => drag.drop(e, row.id)}
      onDragEnd={drag.end}
    >
      {/* the whole margin moves the row (D58), apart from its switches */}
      <div
        className={`gutter ${isErr ? 'err' : ''}`}
        title="Drag to move this row"
        onMouseDown={(e) => {
          if ((e.target as Element).closest('.gutter-btn')) return;
          drag.down(row.id);
        }}
        onMouseUp={drag.up}
      >
        {isErr ? (
          <HoverTip text={res.message} kind="error" align="left">
            <span className="num">⚠</span>
          </HoverTip>
        ) : (
          <span className="num" title={res?.kind === 'value' && !res.defName ? `Row ${data.num}. Type #${data.num} to use its answer elsewhere` : undefined}>
            {data.num}
          </span>
        )}
        {row.type === 'expr' && <GutterTools row={row} result={res} fmt={fmt} shadows={data.shadows} folderTitle={data.folderTitle} />}
      </div>
      <RowBoundary resetKey={JSON.stringify(row)}>
        {row.type === 'expr' && (
          <ExpressionRow
            row={row}
            ctx={{
              result: res,
              chips: data.chips,
              fmt,
              vars: data.vars,
              number: data.num,
              shadows: data.shadows,
              rename,
              notice: data.notice,
              info: data.info,
              packageHint: data.packageHint,
              tip: data.tip,
              view,
            }}
          />
        )}
        {row.type === 'note' && <NoteRow row={row} />}
        {row.type === 'folder' && <FolderRow row={row} count={data.childCount} />}
        {row.type === 'table' && <TableRow row={row} cols={data.columns ?? new Map()} fmt={fmt} vars={data.vars} tip={data.tip} />}
      </RowBoundary>
    </div>
  );
});
