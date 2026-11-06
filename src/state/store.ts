import { create } from 'zustand';
import { renumberRefs } from '../engine/rowrefs';
import type { Row, TableColumn } from '../engine/worksheet';
import type { Notation } from '../engine/format';

export interface Settings {
  angle: 'rad' | 'deg';
  sigFigs: number;
  notation: Notation;
  /** Exponent at which Auto notation switches large values to ×10ⁿ. */
  sciAbove: number;
  /** Enabled unit packages for this worksheet (D26). Base units are always on. */
  packages: string[];
  exactDefault: boolean; // show non-terminating exact results as fractions
  /** Worksheet-defined units, e.g. { symbol: 'bag', definition: '25 kg' } (D34). */
  units: CustomUnit[];
}

export interface CustomUnit {
  symbol: string;
  definition: string;
}

export type Theme = 'system' | 'light' | 'dark';

export const DEFAULT_SETTINGS: Settings = { angle: 'rad', sigFigs: 10, notation: 'auto', sciAbove: 12, packages: [], exactDefault: true, units: [] };

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
  /** Light/dark is a per-browser preference (D32), not saved in worksheets. */
  theme: Theme;
  /** Set when this browser couldn't save (storage full, blocked or private mode). */
  storageError: string | null;
  setTheme(t: Theme): void;

  setTitle(t: string): void;
  setSettings(p: Partial<Settings>): void;
  addRow(type: RowType, afterId?: string | null, opts?: { parent?: string; focus?: boolean; latex?: string }): string;
  updateRow(id: string, patch: Partial<Row>, mergeKey?: string): void;
  deleteRow(id: string): void;
  duplicateRow(id: string): void;
  moveRow(id: string, beforeId: string | null, parent?: string): void;
  /** Move a row up (−1) or down (+1) past its neighbour, staying in its folder (D37). */
  moveRowBy(id: string, delta: -1 | 1): void;
  /** Replace every row in one undoable step (rename). */
  setRows(rows: Row[]): void;
  setFocus(id: string | null): void;
  focusRelative(id: string, delta: number): void;
  /** Put the caret in a row, opening its folder if it is collapsed (the variables panel, D50). */
  focusRow(id: string): void;
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
      { id: uid(), type: 'expr', latex: '\\sigma=\\frac{F}{A}', displayUnit: 'MPa' },
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
  const taken = new Set(loadIndex().map((w) => w.title));
  let title = 'Untitled worksheet';
  for (let n = 2; taken.has(title); n++) title = `Untitled worksheet ${n}`;
  return { schema: 1, id: uid(), title, updated: Date.now(), settings: { ...DEFAULT_SETTINGS }, rows: [{ id: uid(), type: 'expr', latex: '' }] };
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
function lsSet(k: string, v: string): boolean {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}
const LS_THEME = 'dimensional:theme';
function initialTheme(): Theme {
  const t = lsGet(LS_THEME);
  return t === 'dark' || t === 'system' || t === 'light' ? t : 'light';
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
  if (!w || typeof w !== 'object' || !Array.isArray(w.rows)) throw new Error("That file isn't a Dimensional worksheet");
  // Every field is checked, so a damaged or hand-edited file can't break the page (D32).
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
  const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const seen = new Set<string>();
  const freshId = (v: unknown) => {
    let id = typeof v === 'string' && v ? v : uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    return id;
  };
  const rows: Row[] = [];
  for (const r of w.rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const base = { id: freshId(r.id), parent: optStr(r.parent) };
    if (r.type === 'expr') {
      const s = r.slider as Record<string, unknown> | undefined;
      rows.push({
        ...base,
        type: 'expr',
        latex: str(r.latex),
        displayUnit: optStr(r.displayUnit),
        displayMode: ['auto', 'decimal', 'fraction'].includes(r.displayMode as string) ? (r.displayMode as 'auto') : undefined,
        slider: s && typeof s === 'object' ? { min: str(s.min, '0'), max: str(s.max, '10'), step: str(s.step, '0.1') } : undefined,
        scope: r.scope === 'folder' ? 'folder' : undefined,
      });
    } else if (r.type === 'note') rows.push({ ...base, type: 'note', text: str(r.text) });
    else if (r.type === 'folder') rows.push({ id: base.id, type: 'folder', title: str(r.title, 'Folder'), collapsed: r.collapsed === true });
    else if (r.type === 'table') {
      const cols = Array.isArray(r.columns) ? (r.columns as Record<string, unknown>[]) : [];
      const columns = cols
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          id: freshId(c.id),
          header: str(c.header, 'x'),
          unit: optStr(c.unit),
          values: Array.isArray(c.values) ? (c.values as unknown[]).map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')) : [],
        }));
      if (columns.length) rows.push({ ...base, type: 'table', columns });
    }
  }
  // a parent must be a folder in this worksheet
  const folders = new Set(rows.filter((r) => r.type === 'folder').map((r) => r.id));
  for (const r of rows) if (r.parent && !folders.has(r.parent)) delete r.parent;
  const s = (w.settings ?? {}) as Partial<Settings>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  const settings: Settings = {
    angle: s.angle === 'deg' ? 'deg' : 'rad',
    sigFigs: num(s.sigFigs, DEFAULT_SETTINGS.sigFigs, 1, 16),
    notation: ['auto', 'scientific', 'engineering'].includes(s.notation as string) ? (s.notation as Settings['notation']) : 'auto',
    sciAbove: num(s.sciAbove, DEFAULT_SETTINGS.sciAbove, 1, 21),
    packages: Array.isArray(s.packages) ? s.packages.filter((p): p is string => typeof p === 'string') : [],
    exactDefault: typeof s.exactDefault === 'boolean' ? s.exactDefault : DEFAULT_SETTINGS.exactDefault,
    units: Array.isArray(s.units) ? s.units.filter((u) => u && typeof u.symbol === 'string' && typeof u.definition === 'string') : [],
  };
  return {
    schema: 1,
    id: typeof w.id === 'string' ? w.id : uid(),
    title: typeof w.title === 'string' ? w.title : 'Imported worksheet',
    rows: rows.length ? rows : [{ id: uid(), type: 'expr', latex: '' }],
    settings,
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
    // rows added, removed or moved: keep every #n pointing at the same row (D56)
    rows = renumberRefs(s.ws.rows, rows);
    const merge = mergeKey !== null && s.mergeKey === mergeKey;
    set({
      ws: { ...s.ws, rows, updated: Date.now() },
      past: merge ? s.past : [...s.past, s.ws.rows].slice(-UNDO_LIMIT),
      future: [],
      mergeKey,
    });
  };

  /** The smallest k for which neither x_k nor y_k is a table column or a definition yet. */
  const freeTableIndex = (rows: Row[]) => {
    const used = new Set<string>();
    const note = (latex: string) => {
      const m = /^s*([xy])_{?s*([0-9]+)s*}?/.exec(latex);
      if (m) used.add(m[2]);
    };
    for (const r of rows) {
      if (r.type === 'table') r.columns.forEach((c) => note(c.header));
      else if (r.type === 'expr' && /=/.test(r.latex)) note(r.latex);
    }
    let k = 1;
    while (used.has(String(k))) k++;
    return k;
  };

  const descendants = (rows: Row[], id: string) => rows.filter((r) => r.parent === id).map((r) => r.id);

  return {
    ws: init.ws,
    index: init.index,
    past: [],
    future: [],
    mergeKey: null,
    focusId: null,
    theme: initialTheme(),
    storageError: lsSet('dimensional:probe', '1') ? null : "This browser isn't saving your work (storage is blocked or in a private window). Use Export to keep a copy.",
    setTheme(t) {
      lsSet(LS_THEME, t);
      set({ theme: t });
    },
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
      else {
        // the next free pair of names, so a second table doesn't redefine x₁ / y₁
        const n = freeTableIndex(rows);
        row = {
          id,
          type: 'table',
          columns: [
            { id: uid(), header: `x_{${n}}`, values: ['', '', ''] },
            { id: uid(), header: `y_{${n}}`, values: ['', '', ''] },
          ] as TableColumn[],
        };
      }
      let idx = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : rows.length;
      if (afterId) {
        const after = rows[idx - 1];
        if (after?.type === 'folder' && !after.collapsed) row.parent = after.id;
        else if (after?.type === 'folder') idx += descendants(rows, after.id).length;
        else if (after?.parent && type !== 'folder') row.parent = after.parent;
      }
      if ('parent' in opts && type !== 'folder') {
        if (opts.parent) row.parent = opts.parent;
        else delete row.parent;
      }
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
    moveRowBy(id, delta) {
      const rows = get().ws.rows;
      const me = rows.find((r) => r.id === id);
      if (!me) return;
      // siblings: rows at the same level (same folder, or top level where folders count as one block)
      const siblings = rows.filter((r) => (me.type === 'folder' ? r.type === 'folder' || !r.parent : r.parent === me.parent));
      const i = siblings.findIndex((r) => r.id === id);
      const other = siblings[i + delta];
      if (!other) return;
      if (delta === -1) get().moveRow(id, other.id, me.type === 'folder' ? undefined : me.parent);
      else {
        // insert after the neighbour (and after its children, if it's a folder)
        const block = other.type === 'folder' ? [other, ...rows.filter((r) => r.parent === other.id)] : [other];
        const after = rows[rows.indexOf(block[block.length - 1]) + 1];
        get().moveRow(id, after ? after.id : null, me.type === 'folder' ? undefined : me.parent);
      }
      set({ focusId: id, focusNonce: get().focusNonce + 1 });
    },
    setRows(rows) {
      commit(rows);
    },
    setFocus(id) {
      set({ focusId: id });
    },
    focusRow(id) {
      const rows = get().ws.rows;
      const parent = rows.find((r) => r.id === id)?.parent;
      const folder = parent ? rows.find((r) => r.id === parent) : undefined;
      if (folder?.type === 'folder' && folder.collapsed) commit(rows.map((r) => (r.id === folder.id ? { ...r, collapsed: false } : r)));
      set({ focusId: id, focusNonce: get().focusNonce + 1 });
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
  const { ws, index, storageError } = useStore.getState();
  const ok = lsSet(lsWs(ws.id), JSON.stringify(ws)) && lsSet(LS_CURRENT, ws.id);
  const err = ok ? null : "This browser isn't saving your work (storage is full, blocked or in a private window). Use Export to keep a copy.";
  if (err !== storageError) useStore.setState({ storageError: err });
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
