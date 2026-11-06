import { useRef, useState, type ReactNode } from 'react';
import type { Row, RowResult } from '../engine/worksheet';
import { applyChips } from '../engine/worksheet';
import type { ChipFix } from '../engine/ast';
import { formatQuantity, hasFractionForm, type FormatOptions } from '../engine/format';
import { displayValue } from '../engine/quantity';
import { formatUnit } from '../engine/units/registry';
import { MathInput } from './MathInput';
import { UnitButton } from './UnitDropdown';
import { useStore } from '../state/store';
import { varLatex } from '../engine/suggest';
import { PACKAGE_BY_ID } from '../engine/units/packages';

export interface RowCtx {
  result?: RowResult;
  chips?: ChipFix[];
  fmt: FormatOptions;
  vars: string[];
  number: number;
  /** This folder-scoped definition hides a global of the same name inside its folder. */
  shadows?: boolean;
  /** A warning to show under the row (D24 scope hints). */
  notice?: string;
  /** Information to show under the row (how something was read). */
  info?: string;
  /** Rename this row's defined name everywhere it's used; returns an error message or undefined (D37). */
  onRename?(newName: string): string | undefined;
  /** This row uses the name defined in the focused row. */
  usesFocus?: boolean;
  /** A unit chip on this row comes from packages that are off (D26). */
  packageHint?: { unit: string; packages: string[]; typed?: boolean };
}

type ExprRow = Extract<Row, { type: 'expr' }>;

export function ExpressionRow({ row, ctx }: { row: ExprRow; ctx: RowCtx }) {
  const s = useStore();
  const focused = s.focusId === row.id;
  const session = useRef(0);
  const r = ctx.result;
  // unit conversions default to decimal (spec §5.2); the a/b toggle still offers the fraction
  const mode = row.displayMode ?? (row.displayUnit ? 'decimal' : ctx.fmt.mode);
  const fmt = { ...ctx.fmt, mode };

  const onBlur = () => {
    session.current++;
    // auto-chip bare unit letters (D17)
    const st = useStore.getState();
    const cur = st.ws.rows.find((x) => x.id === row.id) as ExprRow | undefined;
    if (cur && ctx.chips?.length && cur.latex === row.latex) {
      const next = applyChips(cur.latex, ctx.chips);
      if (next !== cur.latex) st.updateRow(row.id, { latex: next }, `edit-${row.id}-${session.current - 1}`);
    }
    if (st.focusId === row.id) st.setFocus(null);
  };

  const q = r?.kind === 'value' ? (r.value.t === 'q' ? r.value.q : r.value.items[0]) : undefined;
  const unitText = q ? formatUnit(q.unit) : '';
  const sliderMatch = /^(.*=\s*)(-?\d+(?:\.\d+)?)(.*)$/s.exec(row.latex);

  let resultEl: ReactNode = null;
  let copyText = '';
  const missing = r?.kind === 'error' ? /^“(.+)” isn't defined yet/.exec(r.message)?.[1] : undefined;
  if (r?.kind === 'func' && r.outUnit !== undefined)
    // what the function gives, when its unit doesn't depend on the inputs (D53)
    resultEl = (
      <div className="result func-out" title={`${r.name}( ) gives ${r.outUnit ? r.outUnit : 'a plain number'}`}>
        <span className="eq">→</span>
        {r.outUnit ? <span className="func-unit">{r.outUnit}</span> : <span className="func-none">plain number</span>}
      </div>
    );
  if (r?.kind === 'error')
    resultEl = (
      <div className="result error" title={r.message}>
        ⚠ {r.message}
        {missing && (
          <button
            className="quick-fix"
            title={`Add a row above that defines ${missing}`}
            onClick={() => {
              const st = useStore.getState();
              const i = st.ws.rows.findIndex((x) => x.id === row.id);
              const prev = i > 0 ? st.ws.rows[i - 1].id : null;
              const id = st.addRow('expr', prev, { latex: `${varLatex(missing)}=`, parent: row.parent });
              if (prev === null) st.moveRow(id, row.id, row.parent);
            }}
          >
            + Add {missing} =
          </button>
        )}
      </div>
    );
  else if (r?.kind === 'value' && q) {
    const unitBtn = (
      <UnitButton
        q={q}
        autoUnit={r.autoUnit}
        current={unitText}
        userChosen={!!row.displayUnit}
        onPick={(u) => s.updateRow(row.id, { displayUnit: u })}
      />
    );
    {
      const val =
        r.value.t === 'q'
          ? formatQuantity(r.value.q, fmt).value
          : '[' + r.value.items.map((x) => formatQuantity(x, fmt).value).join(', ') + ']';
      copyText = unitText ? `${val} ${unitText}` : val;
      resultEl = (
        <div className="result">
          <span className="eq">=</span>
          <span className="val">{typesetNumber(val)}</span>
          {unitText || r.value.t === 'list' || row.displayUnit ? unitBtn : <UnitButton {...{ q, autoUnit: r.autoUnit, current: '', userChosen: !!row.displayUnit, muted: true, label: ' ', onPick: (u) => s.updateRow(row.id, { displayUnit: u }) }} />}
          {r.unitError && (
            <HoverTip text={r.unitError} kind="warn">
              <span className="warn">⚠</span>
            </HoverTip>
          )}
          {r.unitNote && (
            // a warning that is there but out of the way: hover (or tap / focus) to read it (D45)
            <span className="unit-note" tabIndex={0} role="button" aria-label={`Warning: ${r.unitNote}`}>
              !
              <span className="unit-note-tip" role="tooltip">
                {r.unitNote}
              </span>
            </span>
          )}
        </div>
      );
    }
  }

  const defName = r?.kind === 'value' || r?.kind === 'error' ? r.defName : r?.kind === 'func' ? r.name : undefined;
  const actions = (
    <div className="row-actions">
      {r?.kind === 'value' && r.literal && sliderMatch && (
        <button
          className={`icon-btn ${row.slider ? 'on' : ''}`}
          title={row.slider ? 'Remove slider' : 'Make slider'}
          aria-label={row.slider ? 'Remove slider' : 'Make slider'}
          onClick={() => {
            if (row.slider) s.updateRow(row.id, { slider: undefined });
            else {
              const v = Number(sliderMatch[2]);
              const max = v === 0 ? 10 : Math.abs(v) * 2;
              s.updateRow(row.id, { slider: { min: v < 0 ? String(-max) : '0', max: String(max), step: String(niceStep(max)) } });
            }
          }}
        >
          ⟷
        </button>
      )}
      {copyText && <CopyButton text={copyText} />}
      {ctx.onRename && defName && <RenameButton name={defName} onRename={ctx.onRename} />}
      <RowMenu id={row.id} />
    </div>
  );

  return (
    <div className={`row-body col ${row.slider ? 'has-slider' : ''}`}>
      <div className="row-top">
        <div className="row-line">
          <MathInput
            latex={row.latex}
            vars={ctx.vars}
            focusNonce={focused ? s.focusNonce : 0}
            ariaLabel={`Expression ${ctx.number}`}
            onChange={(latex) => {
              if (latex !== row.latex) s.updateRow(row.id, { latex }, `edit-${row.id}-${session.current}`);
            }}
            onEnter={() => s.addRow('expr', row.id)}
            onMoveRow={(d) => s.moveRowBy(row.id, d)}
            onMoveOut={(d) => s.focusRelative(row.id, d === 'up' ? -1 : 1)}
            onDeleteEmpty={() => s.deleteRow(row.id)}
            onFocus={() => s.setFocus(row.id)}
            onBlur={onBlur}
          />
        </div>
        {actions}
      </div>
      {resultEl && <div className="row-result">{resultEl}</div>}
      {ctx.packageHint && (
        <div className="row-notice" role="note">
          <span aria-hidden>ⓘ</span> {ctx.packageHint.unit} is a unit from{' '}
          {ctx.packageHint.packages.map((id) => PACKAGE_BY_ID.get(id)?.name ?? id).join(' / ')}, which is off for this worksheet.{' '}
          {ctx.packageHint.typed ? 'Turn it on to use it here.' : 'This chip still calculates, but the unit isn’t offered when typing.'}{' '}
          {ctx.packageHint.packages.map((id) => (
            <button
              key={id}
              className="link-btn"
              onClick={() => {
                const st = useStore.getState();
                st.setSettings({ packages: [...st.ws.settings.packages, id] });
              }}
            >
              Turn on {PACKAGE_BY_ID.get(id)?.name ?? id}
            </button>
          ))}
        </div>
      )}
      {ctx.info && !ctx.notice && (
        <div className="row-notice info" role="note">
          <span aria-hidden>ⓘ</span> {ctx.info}
        </div>
      )}
      {ctx.notice && (
        <div className="row-notice" role="note">
          <span aria-hidden>⚠</span> {ctx.notice}
        </div>
      )}
      {row.slider && sliderMatch && (
        <Slider row={row} match={sliderMatch} unit={r?.kind === 'value' ? formatUnit(r.autoUnit) : ''} />
      )}
    </div>
  );
}

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '−' };

/** "1.5×10⁻³" → 1.5 × 10<sup>−3</sup>, with a true minus sign. */
/**
 * An error or warning mark whose message shows on hover, tap or keyboard focus (D55), the same way
 * for the row's ⚠ in the margin, a result's unit warning and the kelvin note.
 */
export function HoverTip({ text, kind, align = 'right', children }: { text: string; kind: 'error' | 'warn'; align?: 'left' | 'right'; children: ReactNode }) {
  return (
    <span className={`hover-tip tip-${kind} tip-${align}`} tabIndex={0} role="button" aria-label={`${kind === 'error' ? 'Error' : 'Warning'}: ${text}`}>
      {children}
      <span className="hover-tip-text" role="tooltip">
        {text}
      </span>
    </span>
  );
}

/**
 * The row's switches, in the margin under its number (D57):
 * - scope, for a definition inside a folder: a globe when the name is visible everywhere, a
 *   highlighted folder when it is kept inside this folder;
 * - a/b, when the answer has a fraction form: fraction or decimal.
 * They show on hover and while the row is edited; a folder scope or a fraction stays visible.
 */
export function GutterTools({ row, ctx, folderTitle }: { row: ExprRow; ctx: RowCtx; folderTitle?: string }) {
  const s = useStore();
  const r = ctx.result;
  const mode = row.displayMode ?? (row.displayUnit ? 'decimal' : ctx.fmt.mode);
  const q = r?.kind === 'value' && r.value.t === 'q' ? r.value.q : undefined;
  const fracAvail = !!q && hasFractionForm(displayValue(q));
  const showsFraction = !!q && fracAvail && formatQuantity(q, { ...ctx.fmt, mode }).value.includes('/');
  const defName = r?.kind === 'value' || r?.kind === 'error' ? r.defName : r?.kind === 'func' ? r.name : undefined;
  const local = row.scope === 'folder';
  const where = folderTitle ? `“${folderTitle}”` : 'this folder';
  if (!(row.parent && defName) && !fracAvail) return null;
  return (
    <div className="gutter-tools">
      {row.parent && defName && (
        <button
          className={`gutter-btn scope ${local ? 'on' : ''}`}
          title={
            local
              ? `${defName} is only defined inside ${where}${ctx.shadows ? ', where it replaces the global one' : ''}. Click to make it visible everywhere.`
              : `${defName} is visible everywhere. Click to keep it inside ${where}, so other folders can use the name for something else.`
          }
          aria-label={local ? `${defName}: only in ${where}. Make it visible everywhere` : `${defName}: visible everywhere. Keep it inside ${where}`}
          aria-pressed={local}
          onClick={() => s.updateRow(row.id, { scope: local ? undefined : 'folder' })}
        >
          {local ? (
            <svg viewBox="0 0 20 16" aria-hidden>
              <path d="M1.5 3.5a1 1 0 0 1 1-1h4.6l1.8 2h8.6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="6.3" />
              <ellipse cx="8" cy="8" rx="2.6" ry="6.3" />
              <path d="M1.9 6h12.2M1.9 10h12.2" />
            </svg>
          )}
        </button>
      )}
      {fracAvail && (
        <button
          className={`gutter-btn frac ${showsFraction ? 'on' : ''}`}
          title={showsFraction ? 'Shown as a fraction. Click for a decimal.' : 'Shown as a decimal. Click for a fraction.'}
          aria-label={showsFraction ? 'Show as a decimal' : 'Show as a fraction'}
          aria-pressed={showsFraction}
          onClick={() => s.updateRow(row.id, { displayMode: showsFraction ? 'decimal' : 'fraction' })}
        >
          a/b
        </button>
      )}
    </div>
  );
}

export function typesetNumber(text: string): ReactNode {
  const frac = /^(-?)(\d+)\/(\d+)$/.exec(text);
  if (frac)
    return (
      <>
        {frac[1] && '−'}
        <span className="frac">
          <span className="fnum">{frac[2]}</span>
          <span className="fden">{frac[3]}</span>
        </span>
      </>
    );
  const parts = text.replace(/-/g, '−').split(/(×10[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)/);
  return parts.map((p, i) =>
    p.startsWith('×10') ? (
      <span key={i} className="sci">
        <span className="times">×</span>10<sup>{[...p.slice(3)].map((c) => SUP[c] ?? c).join('')}</sup>
      </span>
    ) : (
      p
    ),
  );
}

/** Rename a defined name everywhere it means this definition (D37). */
function RenameButton({ name, onRename }: { name: string; onRename(n: string): string | undefined }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [err, setErr] = useState<string | undefined>();
  const submit = () => {
    const e = onRename(value);
    if (e) setErr(e);
    else setOpen(false);
  };
  return (
    <>
      <button className="icon-btn" title={`Rename ${name} everywhere`} aria-label="Rename" onClick={() => (setOpen(!open), setValue(name), setErr(undefined))}>
        ✎
      </button>
      {open && (
        <div className="rename-pop" role="dialog" aria-label={`Rename ${name}`}>
          <label>
            Rename <b>{name}</b> to
          </label>
          <input
            autoFocus
            value={value}
            onChange={(e) => (setValue(e.target.value), setErr(undefined))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setOpen(false);
            }}
            aria-label="New name"
          />
          {err && <span className="err">{err}</span>}
          <span className="muted">Every row that uses this {name} changes too. Use F_1 for a subscript.</span>
          <button className="text-btn strong" onClick={submit}>
            Rename
          </button>
        </div>
      )}
    </>
  );
}

/** Copy a result as plain text, e.g. "3.280839895 yd" (D33). */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn"
      title={done ? 'Copied' : `Copy result: ${text}`}
      aria-label="Copy result"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/−/g, '-'));
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      {done ? '✓' : '⎘'}
    </button>
  );
}

function niceStep(max: number) {
  const raw = max / 100;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? raw;
}

function Slider({ row, match, unit }: { row: ExprRow; match: RegExpExecArray; unit: string }) {
  const s = useStore();
  const cfg = row.slider!;
  const drag = useRef(0);
  const val = Number(match[2]);
  const setVal = (v: number) => {
    const decimals = (cfg.step.split('.')[1] ?? '').length;
    const txt = v.toFixed(decimals).replace(/^-0(\.0+)?$/, '0');
    s.updateRow(row.id, { latex: match[1] + txt + match[3] }, `slider-${row.id}-${drag.current}`);
  };
  const bound = (k: 'min' | 'max' | 'step', v: string) => s.updateRow(row.id, { slider: { ...cfg, [k]: v } });
  return (
    <div className="slider">
      <input className="bound" value={cfg.min} onChange={(e) => bound('min', e.target.value)} aria-label="Slider minimum" />
      <input
        type="range"
        min={Number(cfg.min)}
        max={Number(cfg.max)}
        step={Number(cfg.step) || 'any'}
        value={val}
        onPointerDown={() => drag.current++}
        onChange={(e) => setVal(Number(e.target.value))}
        aria-label="Slider value"
      />
      <input className="bound" value={cfg.max} onChange={(e) => bound('max', e.target.value)} aria-label="Slider maximum" />
      <span className="slider-unit">{unit}</span>
      <label className="step">
        step <input className="bound" value={cfg.step} onChange={(e) => bound('step', e.target.value)} aria-label="Slider step" />
      </label>
    </div>
  );
}

export function RowMenu({ id }: { id: string }) {
  const s = useStore();
  return (
    <>
      <button className="icon-btn" title="Duplicate" aria-label="Duplicate row" onClick={() => s.duplicateRow(id)}>
        ⧉
      </button>
      <button className="icon-btn danger" title="Delete" aria-label="Delete row" onClick={() => s.deleteRow(id)}>
        ✕
      </button>
    </>
  );
}

export function NoteRow({ row }: { row: Extract<Row, { type: 'note' }> }) {
  const s = useStore();
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = s.focusId === row.id;
  return (
    <div className="row-body note-body">
      <div className="row-line">
        <textarea
          ref={(el) => {
            ref.current = el;
            if (el) {
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
              if (focused && document.activeElement !== el && s.focusNonce) el.focus();
            }
          }}
          className="note-input"
          value={row.text}
          placeholder="Note"
          rows={1}
          onChange={(e) => s.updateRow(row.id, { text: e.target.value }, `note-${row.id}`)}
          onFocus={() => s.setFocus(row.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              s.addRow('expr', row.id);
            }
            if (e.key === 'Backspace' && !row.text) {
              e.preventDefault();
              s.deleteRow(row.id);
            }
            // ↑ on the first line / ↓ on the last line go to the row above / below, as in expression
            // rows. A long note that wraps: let the browser move the caret, and leave only if it
            // couldn't move any further
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              const el = e.currentTarget;
              const up = e.key === 'ArrowUp';
              const at = el.selectionStart;
              if (at !== el.selectionEnd) return;
              const lineH = parseFloat(getComputedStyle(el).lineHeight) || 20;
              const oneLine = el.scrollHeight <= lineH * 1.6 + 8;
              const edge = up ? !el.value.slice(0, at).includes('\n') : !el.value.slice(at).includes('\n');
              if (edge && (oneLine || at === (up ? 0 : el.value.length))) {
                e.preventDefault();
                s.focusRelative(row.id, up ? -1 : 1);
              } else if (edge)
                setTimeout(() => {
                  if (el.selectionStart === at && document.activeElement === el) s.focusRelative(row.id, up ? -1 : 1);
                }, 0);
            }
          }}
        />
      </div>
      <div className="row-actions">
        <RowMenu id={row.id} />
      </div>
    </div>
  );
}

export function FolderRow({ row, count }: { row: Extract<Row, { type: 'folder' }>; count: number }) {
  const s = useStore();
  return (
    <div className="row-body folder-body">
      <div className="row-line">
        <button
          className="folder-toggle"
          onClick={() => s.updateRow(row.id, { collapsed: !row.collapsed })}
          aria-label={row.collapsed ? 'Expand folder' : 'Collapse folder'}
          aria-expanded={!row.collapsed}
        >
          {row.collapsed ? '▸' : '▾'}
        </button>
        <svg className="folder-icon" viewBox="0 0 20 16" aria-hidden focusable="false">
          <path d="M1.5 3.5a1 1 0 0 1 1-1h4.6l1.8 2h8.6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <input
          className="folder-title"
          value={row.title}
          onChange={(e) => s.updateRow(row.id, { title: e.target.value }, `folder-${row.id}`)}
          aria-label="Folder title"
        />
        {row.collapsed && <span className="folder-count">{count} item{count === 1 ? '' : 's'}</span>}
      </div>
      <div className="row-actions">
        <button className="icon-btn" title="Add expression in folder" aria-label="Add expression in folder" onClick={() => s.addRow('expr', row.id, { parent: row.id })}>
          +
        </button>
        <RowMenu id={row.id} />
      </div>
    </div>
  );
}
