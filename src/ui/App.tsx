import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { evaluateWorksheet, renameDefinition, definitionScope, type Row, type WorksheetResult } from '../engine/worksheet';
import { Shortcuts } from './Help';
import { Coach, StartCard } from './Onboarding';
import { activeTip } from './tour';
import type { FormatOptions } from '../engine/format';
import { useStore, visibleRows, LS_TOOLBOX, type RowType } from '../state/store';
import { TopBar } from './TopBar';
import { RowView, type DragApi, type RowData } from './RowView';
import { Toolbox, ToolboxButton } from './Toolbox';
import { BrandMark } from './Brand';
import { VarPanel } from './VarPanel';
import { usePopover } from './usePopover';

const NO_VARS: string[] = [];

/** JSON for the few small, rebuilt-each-time parts of a row's data (chips, hints, a table's columns). */
function json(x: unknown): string {
  return JSON.stringify(x, (_k, v) =>
    typeof v === 'bigint' ? `${v}n` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : v instanceof Map ? [...v] : v,
  );
}

/**
 * Whether a row's data is unchanged. The calculation hands back the same answer object for a row
 * whose answer can't have changed (D65), so answers compare by identity; the rest are short strings
 * and small lists. A table's columns are worked out afresh each time, so only they are compared by content.
 */
function sameData(a: RowData, b: RowData, aVars: string, bVars: string): boolean {
  return (
    a.num === b.num &&
    a.result === b.result &&
    aVars === bVars &&
    a.shadows === b.shadows &&
    a.notice === b.notice &&
    a.info === b.info &&
    a.folderTitle === b.folderTitle &&
    a.childCount === b.childCount &&
    a.tip?.id === b.tip?.id &&
    a.tip?.text === b.tip?.text &&
    json(a.chips ?? null) === json(b.chips ?? null) &&
    json(a.packageHint ?? null) === json(b.packageHint ?? null) &&
    (a.columns === b.columns || json(a.columns ?? null) === json(b.columns ?? null))
  );
}

/**
 * The calculation's answer for each row, with the *same object* reused whenever a row's data came
 * out the same as last time. Every recalculation builds new result objects even for rows it did not
 * change, which would defeat React.memo on the rows; comparing by content avoids that, so typing in
 * one row re-renders only the rows whose answer changed.
 */
function useRowData(rows: Row[], result: WorksheetResult, varsFor: (scope: string | null) => string[], tip: ReturnType<typeof activeTip>) {
  const cache = useRef(new Map<string, { vars: string; data: RowData }>());
  return useMemo(() => {
    const prev = cache.current;
    const next = new Map<string, { vars: string; data: RowData }>();
    const out = new Map<string, RowData>();
    const varsKey = new Map<string | null, string>();
    const childCounts = new Map<string, number>();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) if (r.parent) childCounts.set(r.parent, (childCounts.get(r.parent) ?? 0) + 1);
    rows.forEach((row, k) => {
      const scope = row.parent ?? null;
      const hasVars = row.type === 'expr' || row.type === 'table';
      const parent = row.parent ? byId.get(row.parent) : undefined;
      let columns: RowData['columns'];
      if (row.type === 'table') {
        columns = new Map();
        for (const c of row.columns) {
          const cr = result.columns.get(c.id);
          if (cr) columns.set(c.id, cr);
        }
      }
      const data: RowData = {
        num: k + 1,
        result: result.rows.get(row.id),
        chips: result.chips.get(row.id),
        vars: hasVars ? varsFor(scope) : NO_VARS,
        shadows: result.shadows.has(row.id),
        notice: result.notices.get(row.id),
        info: result.infos.get(row.id),
        packageHint: result.packageHints.get(row.id),
        tip: tip?.rowId === row.id ? tip : undefined,
        folderTitle: parent?.type === 'folder' ? parent.title : undefined,
        childCount: childCounts.get(row.id) ?? 0,
        columns,
      };
      if (hasVars && !varsKey.has(scope)) varsKey.set(scope, data.vars.join('\u0001'));
      const vars = hasVars ? varsKey.get(scope)! : '';
      const hit = prev.get(row.id);
      const entry = hit && sameData(hit.data, data, hit.vars, vars) ? hit : { vars, data };
      next.set(row.id, entry);
      out.set(row.id, entry.data);
    });
    cache.current = next;
    return out;
  }, [rows, result, varsFor, tip]);
}

export function App() {
  const ws = useStore((s) => s.ws);
  const theme = useStore((s) => s.theme);
  const focusId = useStore((s) => s.focusId);
  const tour = useStore((s) => s.tour);
  const tipsSeen = useStore((s) => s.tipsSeen);
  const storageError = useStore((s) => s.storageError);
  const { rows, settings } = ws;
  // the store's actions never change, so reading them here does not subscribe to anything
  const actions = useStore.getState();
  // (autocomplete and unit dropdowns follow this worksheet's unit sets, D26: the store installs them)
  // recalculating a big sheet (integrals, solves) can take tens of ms: let typing stay responsive and
  // recalculate just after, in the background (D38)
  const calcRows = useDeferredValue(rows);
  // each calculation starts from the last one for this worksheet: rows whose text and inputs are
  // unchanged keep their answers without being worked out again (D65)
  const lastResult = useRef<{ wsId: string; result: WorksheetResult } | null>(null);
  const result = useMemo(() => {
    const prev = lastResult.current?.wsId === ws.id ? lastResult.current.result : undefined;
    const next = evaluateWorksheet(
      calcRows,
      { angle: settings.angle, packages: settings.packages, units: settings.units, vectors: settings.vectors, imaginary: settings.imaginary },
      prev,
    );
    lastResult.current = { wsId: ws.id, result: next };
    return next;
  }, [ws.id, calcRows, settings.angle, settings.packages, settings.units, settings.vectors, settings.imaginary]);
  // how vectors and complex numbers are written (D63)
  const view = useMemo(() => ({ angle: settings.angle, imag: settings.imaginary }), [settings.angle, settings.imaginary]);
  const fmt: FormatOptions = useMemo(
    () => ({ sigFigs: settings.sigFigs, notation: settings.notation, sciAbove: settings.sciAbove, mode: settings.exactDefault ? 'auto' : 'decimal' }),
    [settings.sigFigs, settings.notation, settings.sciAbove, settings.exactDefault],
  );
  // names visible from each folder (folder-scoped definitions only count inside their folder)
  const varsFor = useMemo(() => {
    const cache = new Map<string | null, string[]>();
    return (scope: string | null) => {
      if (!cache.has(scope)) cache.set(scope, result.varsIn(scope));
      return cache.get(scope)!;
    };
  }, [result]);

  // theme
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(el).getPropertyValue('--bg').trim());
  }, [theme]);

  const [shortcuts, setShortcuts] = useState(false);
  const [toolbox, setToolbox] = useState(() => {
    try {
      return localStorage.getItem(LS_TOOLBOX) === '1';
    } catch {
      return false;
    }
  });
  const toggleToolbox = useCallback((v: boolean) => {
    setToolbox(v);
    try {
      localStorage.setItem(LS_TOOLBOX, v ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  }, []);
  const toolboxRef = useRef(toolbox);
  useEffect(() => {
    toolboxRef.current = toolbox;
  }, [toolbox]);

  // global shortcuts and undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // Ctrl+/ shortcuts, Ctrl+. functions drawer: from anywhere (D37)
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShortcuts((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        toggleToolbox(!toolboxRef.current);
        return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    const onCustom = (e: Event) => {
      if ((e as CustomEvent).detail === 'redo') useStore.getState().redo();
      else useStore.getState().undo();
    };
    const onShortcuts = () => setShortcuts((v) => !v);
    window.addEventListener('keydown', onKey);
    window.addEventListener('dimensional-undo', onCustom);
    window.addEventListener('dimensional-shortcuts', onShortcuts);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dimensional-undo', onCustom);
      window.removeEventListener('dimensional-shortcuts', onShortcuts);
    };
  }, [toggleToolbox]);

  // "used by": while a definition row is focused, mark the rows that use its name (D37)
  const focusRes = focusId ? result.rows.get(focusId) : undefined;
  const focusName = focusRes?.kind === 'value' || focusRes?.kind === 'error' ? focusRes.defName : focusRes?.kind === 'func' ? focusRes.name : undefined;
  const focusRow = focusId ? rows.find((r) => r.id === focusId) : undefined;
  const focusLevel = focusRow ? (definitionScope(focusRow) ?? 'global') : null;
  const usesFocus = (id: string) =>
    !!focusName && id !== focusId && !!result.refs.get(id)?.some((x) => x.name === focusName) && result.resolves(id, focusName) === focusLevel;

  // rename is called from any row: one stable function that looks at the latest result when called
  const latest = useRef({ result });
  useLayoutEffect(() => {
    latest.current = { result };
  });
  const rename = useCallback((id: string, name: string) => {
    const st = useStore.getState();
    const out = renameDefinition(st.ws.rows, latest.current.result, id, name);
    if (typeof out === 'string') return out;
    st.setRows(out);
    return undefined;
  }, []);

  // moving rows by their margin (D58)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const dragFromHandle = useRef(false);
  const drag = useMemo<DragApi>(() => {
    const pick = (id: string | null) => {
      dragIdRef.current = id;
      setDragId(id);
    };
    const clear = () => {
      pick(null);
      setDropId(null);
    };
    return {
      down(id) {
        dragFromHandle.current = true;
        pick(id);
      },
      up() {
        dragFromHandle.current = false;
        pick(null);
      },
      start(e: DragEvent) {
        if (!dragFromHandle.current) return e.preventDefault();
        e.dataTransfer.effectAllowed = 'move';
      },
      over(e, id) {
        if (!dragIdRef.current) return;
        e.preventDefault();
        setDropId(id);
      },
      drop(e, id) {
        e.preventDefault();
        const from = dragIdRef.current;
        if (from && from !== id) {
          const st = useStore.getState();
          const all = st.ws.rows;
          const target = all.find((r) => r.id === id);
          const moving = all.find((r) => r.id === from);
          if (target?.type === 'folder' && moving?.type !== 'folder') {
            const idx = all.findIndex((r) => r.id === id);
            st.moveRow(from, all[idx + 1]?.id ?? null, id);
          } else st.moveRow(from, id, moving?.type === 'folder' ? undefined : target?.parent);
        }
        clear();
      },
      end() {
        clear();
        dragFromHandle.current = false;
      },
    };
  }, []);

  const visible = visibleRows(rows);
  // one inline tip at a time, never during the tour (D60)
  const tip = useMemo(() => (tour ? null : activeTip(calcRows, result, tipsSeen)), [tour, calcRows, result, tipsSeen]);
  const rowData = useRowData(rows, result, varsFor, tip);

  const anyFolder = rows.some((r) => r.type === 'folder');
  const anyCollapsed = rows.some((r) => r.type === 'folder' && r.collapsed);
  return (
    <div className={`app ${toolbox ? 'with-toolbox' : ''}`}>
      {/* top bar and toolbar stay pinned together while the list scrolls */}
      <header className="app-head">
        <TopBar />
        <div className="toolbar">
          <AddMenu />
          {anyFolder && (
            <button className="text-btn" onClick={() => actions.setAllCollapsed(!anyCollapsed)}>
              ⊟ {anyCollapsed ? 'Expand' : 'Collapse'} folders
            </button>
          )}
          <ToolboxButton open={toolbox} onToggle={() => toggleToolbox(!toolbox)} />
        </div>
        <Coach result={result} toolbox={toolbox} openToolbox={() => toggleToolbox(true)} />
      </header>
      {storageError && (
        <div className="storage-banner" role="alert">
          ⚠ {storageError}
        </div>
      )}
      {/* only on paper: a calc-sheet heading (D36) */}
      <div className="print-head" aria-hidden>
        <span className="print-brand">Dimensional</span>
        <span className="print-title">{ws.title}</span>
        <span className="print-date">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <div className="sheet-wrap">
        <VarPanel rows={calcRows} result={result} fmt={fmt} view={view} />
        <main className="list" aria-label="Expressions">
          {visible.map((row) => (
            <RowView
              key={row.id}
              row={row}
              // every row keeps its number, as in a spreadsheet (folded rows too): #n means this row (D56)
              data={rowData.get(row.id)!}
              fmt={fmt}
              view={view}
              usesFocus={usesFocus(row.id)}
              dragging={dragId === row.id}
              dropTarget={dropId === row.id && dragId !== row.id}
              drag={drag}
              rename={rename}
            />
          ))}
          <StartCard />
          <button className="add-bottom" onClick={() => actions.addRow('expr', rows[rows.length - 1]?.id ?? null, { parent: undefined })}>
            + Add expression
          </button>
        </main>
      </div>
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-main">
            <span className="footer-brand">
              <BrandMark className="footer-mark" />
              Dimensional<span className="footer-tag">every number knows its units</span>
            </span>
            <span className="footer-meta">
              Nothing leaves your browser · MIT license · by{' '}
              <a href="https://perrysahnow.com" target="_blank" rel="noreferrer">
                Perry Sahnow
              </a>
              {' · '}
              <span className="footer-build" title="The version of Dimensional, and the commit it was built from">
                v{__APP_VERSION__} (
                {__APP_COMMIT_URL__ ? (
                  <a href={__APP_COMMIT_URL__} target="_blank" rel="noreferrer">
                    {__APP_COMMIT__}
                  </a>
                ) : (
                  __APP_COMMIT__
                )}
                )
              </span>
            </span>
          </div>
          <div className="footer-tips kbd-only">
            Type units after numbers (6N, 2 mm^2) · Tab inserts a suggestion · Backspace on a unit chip turns it back into letters · Ctrl / for shortcuts
          </div>
        </div>
      </footer>
      {toolbox && <Toolbox onClose={() => toggleToolbox(false)} />}
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
    </div>
  );
}

function AddMenu() {
  const { open, setOpen, ref } = usePopover();
  const add = (t: RowType) => {
    const st = useStore.getState();
    st.addRow(t, st.focusId ?? st.ws.rows[st.ws.rows.length - 1]?.id ?? null);
    setOpen(false);
  };
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="text-btn strong" onClick={() => setOpen(!open)} aria-haspopup="menu">
        + Add ▾
      </button>
      {open && (
        <div className="popover left" role="menu">
          <button className="menu-item" onClick={() => add('expr')}>
            𝑥 Expression
          </button>
          <button className="menu-item" onClick={() => add('note')}>
            " Note
          </button>
          <button className="menu-item" onClick={() => add('folder')}>
            📁 Folder
          </button>
          <button className="menu-item" onClick={() => add('table')}>
            ▦ Table
          </button>
        </div>
      )}
    </div>
  );
}
