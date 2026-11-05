import { create } from 'zustand';
import type { Row, TableColumn } from '../engine/worksheet';
import type { Notation } from '../engine/format';

export interface Settings {
  angle: 'rad' | 'deg';
  sigFigs: number;
  notation: Notation;
  exactDefault: boolean; // show non-terminating exact results as fractions
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = { angle: 'rad', sigFigs: 10, notation: 'auto', exactDefault: true, theme: 'system' };

export interface Worksheet {
  schema: 1;
  id: string;
  title: string;
  rows: Row[];
  settings: Settings;
  updated: number;
}

export type RowType = Row['type'];

export const uid = () => Math.random().toString(36).slice(2, 10);

const UNDO_LIMIT = 200;

interface State {
  ws: Worksheet;
  index: { id: string; title: string; updated: number }[];
  past: Row[][];
  future: Row[][];
  mergeKey: string | null;
  focusId: string | null;
  focusNonce: number;

  setTitle(t: string): void;
  setSettings(p: Partial<Settings>): void;
  addRow(type: RowType, afterId?: string | null, opts?: { parent?: string; focus?: boolean; latex?: string }): string;
  updateRow(id: string, patch: Partial<Row>, mergeKey?: string): void;
  deleteRow(id: string): void;
  duplicateRow(id: string): void;
  moveRow(id: string, beforeId: string | null, parent?: string): void;
  setFocus(id: string | null): void;
  focusRelative(id: string, delta: number): void;
  setAllCollapsed(c: boolean): void;
  undo(): void;
  redo(): void;
  newWorksheet(): void;
  openWorksheet(id: string): void;
  deleteWorksheet(id: string): void;
  importWorksheet(json: string): void;
}

function sampleWorksheet(): Worksheet {
  const f = uid();
  const t = uid();
  return {
    schema: 1,
    id: uid(),
    title: 'Beam check',
    updated: Date.now(),
    settings: { ...DEFAULT_SETTINGS },
    rows: [
      { id: f, type: 'folder', title: 'Beam inputs' },
      { id: uid(), type: 'expr', latex: 'F=6\\unit{kN}', parent: f },
      { id: uid(), type: 'expr', latex: 'A=20\\unit{mm}^{2}', parent: f },
      { id: uid(), type: 'expr', latex: 'L=1.5\\unit{m}', parent: f, slider: { min: '0', max: '3', step: '0.1' } },
      { id: uid(), type: 'note', text: 'Stress check — results come out in the units of the expression. Use the unit chip to switch.' },
      { id: uid(), type: 'expr', latex: '\\sigma=\\frac{F}{A}' },
      { id: uid(), type: 'expr', latex: 'M=F\\cdot L' },
      { id: uid(), type: 'expr', latex: 'f\\left(x\\right)=x^{2}\\cdot4\\frac{\\unit{N}}{\\unit{m}^{2}}' },
      { id: uid(), type: 'expr', latex: 'f\\left(L\\right)' },
      { id: uid(), type: 'expr', latex: '20\\unit{\\degree C}+5\\unit{\\Delta\\degree C}' },
      {
        id: t,
        type: 'table',
        columns: [
          { id: uid(), header: 'x_{1}', unit: 'mm', values: ['10', '20', '30', ''] },
          { id: uid(), header: 'y_{1}=f\\left(x_{1}\\right)', unit: 'µN', values: [] },
        ],
      },
      { id: uid(), type: 'expr', latex: '' },
    ],
  };
}

function blankWorksheet(): Worksheet {
  return { schema: 1, id: uid(), title: 'Untitled worksheet', updated: Date.now(), settings: { ...DEFAULT_SETTINGS }, rows: [{ id: uid(), type: 'expr', latex: '' }] };
}

// ── Persistence ──────────────────────────────────────────────────────────────
const LS_INDEX = 'usc:worksheets';
const LS_CURRENT = 'usc:current';
const lsWs = (id: string) => `usc:ws:${id}`;

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}
function lsDel(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function migrate(raw: unknown): Worksheet {
  const w = raw as Partial<Worksheet>;
  if (!w || typeof w !== 'object' || !Array.isArray(w.rows)) throw new Error('Not a worksheet file');
  const rows = (w.rows as Row[]).filter((r) => r && typeof r.id === 'string' && ['expr', 'note', 'folder', 'table'].includes(r.type));
  return {
    schema: 1,
    id: typeof w.id === 'string' ? w.id : uid(),
    title: typeof w.title === 'string' ? w.title : 'Imported worksheet',
    rows: rows.length ? rows : [{ id: uid(), type: 'expr', latex: '' }],
    settings: { ...DEFAULT_SETTINGS, ...(w.settings ?? {}) },
    updated: Date.now(),
  };
}

function loadIndex(): State['index'] {
  try {
    return JSON.parse(lsGet(LS_INDEX) ?? '[]');
  } catch {
    return [];
  }
}
function loadWs(id: string): Worksheet | null {
  try {
    const s = lsGet(lsWs(id));
    return s ? migrate(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

function initial(): { ws: Worksheet; index: State['index'] } {
  const index = loadIndex();
  const cur = lsGet(LS_CURRENT);
  const ws = (cur && loadWs(cur)) || (index[0] && loadWs(index[0].id)) || sampleWorksheet();
  return { ws, index };
}

export function exportWorksheet(ws: Worksheet): string {
  const { schema, title, settings, rows } = ws;
  return JSON.stringify({ schema, title, settings, rows }, null, 2);
}

// ── Store ────────────────────────────────────────────────────────────────────
const init = initial();

export const useStore = create<State>((set, get) => {
  /** Apply a row change with an undo snapshot (merged when mergeKey repeats). */
  const commit = (rows: Row[], mergeKey: string | null = null) => {
    const s = get();
    const merge = mergeKey !== null && s.mergeKey === mergeKey;
    set({
      ws: { ...s.ws, rows, updated: Date.now() },
      past: merge ? s.past : [...s.past, s.ws.rows].slice(-UNDO_LIMIT),
      future: [],
      mergeKey,
    });
  };

  const descendants = (rows: Row[], id: string) => rows.filter((r) => r.parent === id).map((r) => r.id);

  return {
    ws: init.ws,
    index: init.index,
    past: [],
    future: [],
    mergeKey: null,
    focusId: null,
    focusNonce: 0,

    setTitle(title) {
      set({ ws: { ...get().ws, title, updated: Date.now() } });
    },
    setSettings(p) {
      set({ ws: { ...get().ws, settings: { ...get().ws.settings, ...p }, updated: Date.now() } });
    },
    addRow(type, afterId, opts = {}) {
      const rows = [...get().ws.rows];
      const id = uid();
      let row: Row;
      if (type === 'expr') row = { id, type, latex: opts.latex ?? '' };
      else if (type === 'note') row = { id, type, text: '' };
      else if (type === 'folder') row = { id, type, title: 'Folder' };
      else
        row = {
          id,
          type: 'table',
          columns: [
            { id: uid(), header: 'x_{1}', values: ['', '', ''] },
            { id: uid(), header: 'y_{1}', values: ['', '', ''] },
          ] as TableColumn[],
        };
      let idx = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : rows.length;
      if (afterId) {
        const after = rows[idx - 1];
        if (after?.type === 'folder' && !after.collapsed) row.parent = after.id;
        else if (after?.type === 'folder') idx += descendants(rows, after.id).length;
        else if (after?.parent && type !== 'folder') row.parent = after.parent;
      }
      if (opts.parent !== undefined && type !== 'folder') row.parent = opts.parent;
      if (type === 'folder') delete row.parent;
      rows.splice(idx, 0, row);
      commit(rows);
      if (opts.focus !== false) set({ focusId: id, focusNonce: get().focusNonce + 1 });
      return id;
    },
    updateRow(id, patch, mergeKey) {
      const rows = get().ws.rows.map((r) => (r.id === id ? ({ ...r, ...patch } as Row) : r));
      commit(rows, mergeKey ?? null);
    },
    deleteRow(id) {
      const s = get();
      const rows = s.ws.rows;
      const idx = rows.findIndex((r) => r.id === id);
      const target = rows[idx];
      let next = rows.filter((r) => r.id !== id);
      // deleting a folder keeps its contents (moved out)
      if (target?.type === 'folder') next = next.map((r) => (r.parent === id ? ({ ...r, parent: undefined } as Row) : r));
      if (!next.length) next = [{ id: uid(), type: 'expr', latex: '' }];
      commit(next);
      const focusTarget = next[Math.max(0, idx - 1)];
      set({ focusId: focusTarget?.id ?? null, focusNonce: s.focusNonce + 1 });
    },
    duplicateRow(id) {
      const rows = [...get().ws.rows];
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return;
      const copy = JSON.parse(JSON.stringify(rows[idx])) as Row;
      copy.id = uid();
      if (copy.type === 'table') copy.columns = copy.columns.map((c) => ({ ...c, id: uid() }));
      rows.splice(idx + 1, 0, copy);
      commit(rows);
    },
    moveRow(id, beforeId, parent) {
      const rows = [...get().ws.rows];
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0 || id === beforeId) return;
      const moving = rows[idx];
      const block = moving.type === 'folder' ? [moving, ...rows.filter((r) => r.parent === id)] : [moving];
      const rest = rows.filter((r) => !block.includes(r));
      if (moving.type !== 'folder') block[0] = { ...moving, parent } as Row;
      let at = beforeId ? rest.findIndex((r) => r.id === beforeId) : rest.length;
      if (at < 0) at = rest.length;
      rest.splice(at, 0, ...block);
      commit(rest);
    },
    setFocus(id) {
      set({ focusId: id });
    },
    focusRelative(id, delta) {
      const s = get();
      const visible = visibleRows(s.ws.rows).filter((r) => r.type === 'expr' || r.type === 'note');
      const i = visible.findIndex((r) => r.id === id);
      const t = visible[i + delta];
      if (t) set({ focusId: t.id, focusNonce: s.focusNonce + 1 });
    },
    setAllCollapsed(c) {
      commit(get().ws.rows.map((r) => (r.type === 'folder' ? { ...r, collapsed: c } : r)));
    },
    undo() {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({ ws: { ...s.ws, rows: prev, updated: Date.now() }, past: s.past.slice(0, -1), future: [s.ws.rows, ...s.future], mergeKey: null });
    },
    redo() {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ ws: { ...s.ws, rows: next, updated: Date.now() }, past: [...s.past, s.ws.rows], future: s.future.slice(1), mergeKey: null });
    },
    newWorksheet() {
      saveNow();
      set({ ws: blankWorksheet(), past: [], future: [], mergeKey: null });
    },
    openWorksheet(id) {
      saveNow();
      const ws = loadWs(id);
      if (ws) set({ ws, past: [], future: [], mergeKey: null });
    },
    deleteWorksheet(id) {
      lsDel(lsWs(id));
      const index = get().index.filter((w) => w.id !== id);
      lsSet(LS_INDEX, JSON.stringify(index));
      set({ index });
      if (get().ws.id === id) {
        const nextWs = (index[0] && loadWs(index[0].id)) || blankWorksheet();
        set({ ws: nextWs, past: [], future: [] });
      }
    },
    importWorksheet(json) {
      saveNow();
      const ws = migrate(JSON.parse(json));
      ws.id = uid();
      set({ ws, past: [], future: [], mergeKey: null });
    },
  };
});

export function visibleRows(rows: Row[]): Row[] {
  const collapsed = new Set(rows.filter((r) => r.type === 'folder' && r.collapsed).map((r) => r.id));
  return rows.filter((r) => !(r.parent && collapsed.has(r.parent)));
}

function saveNow() {
  const { ws, index } = useStore.getState();
  lsSet(lsWs(ws.id), JSON.stringify(ws));
  lsSet(LS_CURRENT, ws.id);
  const entry = { id: ws.id, title: ws.title, updated: ws.updated };
  const next = [entry, ...index.filter((w) => w.id !== ws.id)];
  lsSet(LS_INDEX, JSON.stringify(next));
  if (JSON.stringify(next) !== JSON.stringify(index)) useStore.setState({ index: next });
}

let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.ws === prev.ws) return;
  clearTimeout(timer);
  timer = setTimeout(saveNow, 500);
});
if (typeof window !== 'undefined') window.addEventListener('beforeunload', saveNow);
