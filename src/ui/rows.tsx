import { useRef, type ReactNode } from 'react';
import type { Row, RowResult } from '../engine/worksheet';
import { applyChips } from '../engine/worksheet';
import type { ChipFix } from '../engine/ast';
import { formatQuantity, hasFractionForm, type FormatOptions } from '../engine/format';
import { displayValue } from '../engine/quantity';
import { formatUnit } from '../engine/units/registry';
import { MathInput } from './MathInput';
import { UnitButton } from './UnitDropdown';
import { useStore } from '../state/store';

export interface RowCtx {
  result?: RowResult;
  chips?: ChipFix[];
  fmt: FormatOptions;
  vars: string[];
  number: number;
  /** This folder-scoped definition hides a global of the same name inside its folder. */
  shadows?: boolean;
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
  const fracAvail = r?.kind === 'value' && r.value.t === 'q' && hasFractionForm(displayValue(r.value.q));
  const sliderMatch = /^(.*=\s*)(-?\d+(?:\.\d+)?)(.*)$/s.exec(row.latex);

  let resultEl: ReactNode = null;
  if (r?.kind === 'error') resultEl = <div className="result error" title={r.message}>⚠ {r.message}</div>;
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
      resultEl = (
        <div className="result">
          <span className="eq">=</span>
          <span className="val">{typesetNumber(val)}</span>
          {unitText || r.value.t === 'list' || row.displayUnit ? unitBtn : <UnitButton {...{ q, autoUnit: r.autoUnit, current: '', userChosen: !!row.displayUnit, muted: true, label: ' ', onPick: (u) => s.updateRow(row.id, { displayUnit: u }) }} />}
          {r.unitError && <span className="warn" title={r.unitError}>⚠</span>}
        </div>
      );
    }
  }

  const actions = (
    <div className="row-actions">
      {fracAvail && (
        <button
          className="icon-btn"
          title="Toggle fraction / decimal"
          onClick={() => s.updateRow(row.id, { displayMode: mode === 'fraction' ? 'decimal' : mode === 'decimal' ? 'fraction' : ctx.fmt.mode === 'auto' && /\//.test(formatQuantity(q!, fmt).value) ? 'decimal' : 'fraction' })}
        >
          a/b
        </button>
      )}
      {r?.kind === 'value' && r.literal && sliderMatch && (
        <button
          className={`icon-btn ${row.slider ? 'on' : ''}`}
          title={row.slider ? 'Remove slider' : 'Make slider'}
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
      <RowMenu id={row.id} />
    </div>
  );

  const defName = r?.kind === 'value' || r?.kind === 'error' ? r.defName : r?.kind === 'func' ? r.name : undefined;
  const local = row.scope === 'folder';
  const scopeBtn =
    row.parent && defName ? (
      <button
        className={`scope-btn ${local ? 'local' : ''}`}
        title={
          local
            ? `“${defName}” is only defined inside this folder${ctx.shadows ? ' (it overrides the global one here)' : ''}. Click to make it global.`
            : `“${defName}” is global. Click to limit it to this folder, so other folders can define their own.`
        }
        aria-pressed={local}
        onClick={() => s.updateRow(row.id, { scope: local ? undefined : 'folder' })}
      >
        {local ? '▣ folder' : '◎ global'}
      </button>
    ) : null;

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
            onMoveOut={(d) => s.focusRelative(row.id, d === 'up' ? -1 : 1)}
            onDeleteEmpty={() => s.deleteRow(row.id)}
            onFocus={() => s.setFocus(row.id)}
            onBlur={onBlur}
          />
        </div>
        {scopeBtn}
        {actions}
      </div>
      {resultEl && <div className="row-result">{resultEl}</div>}
      {row.slider && sliderMatch && (
        <Slider row={row} match={sliderMatch} unit={r?.kind === 'value' ? formatUnit(r.autoUnit) : ''} />
      )}
    </div>
  );
}

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '−' };

/** "1.5×10⁻³" → 1.5 × 10<sup>−3</sup>, with a true minus sign. */
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
      <button className="icon-btn" title="Duplicate" onClick={() => s.duplicateRow(id)}>
        ⧉
      </button>
      <button className="icon-btn danger" title="Delete" onClick={() => s.deleteRow(id)}>
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
        <span className="folder-icon">📁</span>
        <input
          className="folder-title"
          value={row.title}
          onChange={(e) => s.updateRow(row.id, { title: e.target.value }, `folder-${row.id}`)}
          aria-label="Folder title"
        />
        {row.collapsed && <span className="folder-count">{count} item{count === 1 ? '' : 's'}</span>}
      </div>
      <div className="row-actions">
        <button className="icon-btn" title="Add expression in folder" onClick={() => s.addRow('expr', row.id, { parent: row.id })}>
          +
        </button>
        <RowMenu id={row.id} />
      </div>
    </div>
  );
}
