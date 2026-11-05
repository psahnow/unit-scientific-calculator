import { useEffect, useMemo, useRef, useState } from 'react';
import type { Quantity } from '../engine/quantity';
import { checkConvertible, displayValue } from '../engine/quantity';
import { unitCandidates } from '../engine/units/candidates';
import { parseUnitExpr, formatUnit, type UnitExpr } from '../engine/units/registry';
import { formatFloat } from '../engine/format';
import { toNumber } from '../engine/num';

interface Props {
  q?: Quantity; // value being displayed (for candidates & previews)
  autoUnit: UnitExpr;
  current: string; // formatted current unit
  userChosen: boolean;
  onPick(unit: string | undefined): void;
  label?: string;
  muted?: boolean;
}

export function UnitButton(p: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="unit-wrap" ref={ref}>
      <button
        className={`unit-chip ${p.muted ? 'muted' : ''} ${p.userChosen ? 'chosen' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${p.current || 'no unit'}, change unit`}
        onKeyDown={(e) => {
          if (e.altKey && e.key === 'ArrowDown') setOpen(true);
        }}
        title="Change display unit"
      >
        {p.current || p.label || '—'}
        <span className="caret">▾</span>
      </button>
      {open && <UnitMenu {...p} close={() => setOpen(false)} />}
    </div>
  );
}

function UnitMenu(p: Props & { close(): void }) {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const fmt = (v: number) => formatFloat(v, { sigFigs: 6, notation: 'auto', mode: 'decimal' });
  const groups = useMemo(() => (p.q ? unitCandidates(p.q, p.autoUnit, fmt) : []), [p.q, p.autoUnit]);

  // free-form entry
  let custom: { text: string; ok: boolean; msg?: string; preview?: string } | null = null;
  const qtrim = query.trim();
  if (qtrim) {
    try {
      const e = parseUnitExpr(qtrim);
      const err = p.q ? checkConvertible(p.q, e) : null;
      custom = {
        text: formatUnit(e),
        ok: !err,
        msg: err ?? undefined,
        preview: p.q && !err ? fmt(toNumber(displayValue({ ...p.q, unit: e }))) : undefined,
      };
    } catch (e) {
      custom = { text: qtrim, ok: false, msg: (e as Error).message };
    }
  }
  const lq = qtrim.toLowerCase();
  const filtered = groups
    .map((g) => ({ ...g, items: g.items.filter((c) => !lq || c.text.toLowerCase().includes(lq)) }))
    .filter((g) => g.items.length);
  const flat = filtered.flatMap((g) => g.items.map((c) => c.text));
  const pick = (t: string | undefined) => {
    p.onPick(t);
    p.close();
  };

  return (
    <div className="unit-menu" role="listbox">
      <input
        autoFocus
        className="unit-search"
        placeholder="type a unit… (e.g. kip/in^2)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') p.close();
          if (e.key === 'ArrowDown') setHi(Math.min(hi + 1, flat.length - 1));
          if (e.key === 'ArrowUp') setHi(Math.max(hi - 1, 0));
          if (e.key === 'Enter') {
            if (custom?.ok && !flat.includes(custom.text)) pick(custom.text);
            else if (flat[hi]) pick(flat[hi]);
          }
        }}
      />
      {custom && !flat.includes(custom.text) && (
        <div className={`unit-custom ${custom.ok ? '' : 'bad'}`}>
          {custom.ok ? (
            <button className="unit-item" onClick={() => pick(custom!.text)}>
              <span>{custom.text}</span>
              <span className="preview">{custom.preview}</span>
            </button>
          ) : (
            <span className="hint">{custom.msg}</span>
          )}
        </div>
      )}
      <div className="unit-groups">
        {filtered.map((g) => (
          <div key={g.label} className="unit-group">
            <div className="unit-group-label">{g.label}</div>
            {g.items.map((c) => (
              <button
                key={c.text}
                className={`unit-item ${c.text === p.current ? 'current' : ''} ${flat[hi] === c.text ? 'hi' : ''}`}
                onClick={() => pick(c.text === formatUnit(p.autoUnit) ? undefined : c.text)}
              >
                <span>{c.text}</span>
                <span className="preview">{c.preview}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {p.userChosen && (
        <button className="unit-reset" onClick={() => pick(undefined)}>
          ↺ Reset to automatic ({formatUnit(p.autoUnit) || 'none'})
        </button>
      )}
    </div>
  );
}
