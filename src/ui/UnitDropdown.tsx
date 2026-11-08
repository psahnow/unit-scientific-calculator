import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Quantity } from '../engine/quantity';
import { checkConvertible, convertTo, displayValue } from '../engine/quantity';
import { unitCandidates } from '../engine/units/candidates';
import { parseUnitExpr, formatUnit, getUnit, type UnitExpr } from '../engine/units/registry';
import { isUnitOn, offPackageMessage } from '../engine/units/packages';
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
  /** Accept any unit (a table input column of plain numbers: the unit says what they mean). */
  anyUnit?: boolean;
}

export function UnitButton(p: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="unit-wrap" ref={ref}>
      <button
        ref={btn}
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
      {open && createPortal(<UnitMenu {...p} anchor={btn} menuRef={menu} close={() => setOpen(false)} />, document.body)}
    </div>
  );
}

const GAP = 4;
const MARGIN = 8;

/** Fixed-position the menu under (or above) its button, kept inside the window. */
function usePlacement(anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLDivElement | null>) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    // the menu's natural height, measured once when it opens: after that its height is set by
    // placing it, so measuring again would read back our own (bordered, slightly smaller) height and
    // shrink it a little on every scroll
    let natural = 0;
    const place = (e?: Event) => {
      // scrolling the list inside the menu doesn't move anything
      if (e?.type === 'scroll' && e.target instanceof Node && menu.current?.contains(e.target)) return;
      const a = anchor.current?.getBoundingClientRect();
      const m = menu.current;
      if (!a || !m) return;
      if (!natural) natural = m.scrollHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const width = Math.min(290, vw - 2 * MARGIN);
      // right-align with the button, then clamp to the window
      const left = Math.max(MARGIN, Math.min(a.right - width, vw - width - MARGIN));
      // the sticky header is the top of the usable window: the menu never runs up under it (D59)
      const head = document.querySelector('.app-head')?.getBoundingClientRect().bottom ?? 0;
      const below = vh - a.bottom - GAP - MARGIN;
      const above = a.top - GAP - MARGIN - head;
      const want = Math.min(420, natural);
      const down = below >= want || below >= above;
      const maxHeight = Math.max(160, Math.min(420, down ? below : above));
      setStyle({
        position: 'fixed',
        left,
        width,
        maxHeight,
        // opened upward, its height is fixed: filtering the list doesn't pull its top edge down
        ...(down ? { top: a.bottom + GAP } : { bottom: vh - a.top + GAP, height: Math.min(want, maxHeight) }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, menu]);
  return style;
}

function UnitMenu(p: Props & { close(): void; anchor: RefObject<HTMLButtonElement | null>; menuRef: RefObject<HTMLDivElement | null> }) {
  const style = usePlacement(p.anchor, p.menuRef);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const fmt = (v: number) => formatFloat(v, { sigFigs: 6, notation: 'auto', mode: 'decimal' });
  const groups = useMemo(() => (p.q ? unitCandidates(p.q, p.autoUnit, fmt) : []), [p.q, p.autoUnit]);

  // free-form entry
  let custom: { text: string; ok: boolean; parsed: boolean; msg?: string; preview?: string } | null = null;
  const qtrim = query.trim();
  if (qtrim) {
    try {
      const e = parseUnitExpr(qtrim);
      const err = offPackageMessage(e, getUnit, isUnitOn) ?? (p.q && !p.anyUnit ? checkConvertible(p.q, e) : null);
      custom = {
        text: formatUnit(e),
        ok: !err,
        parsed: true,
        msg: err ?? undefined,
        preview: p.q && !err && !p.anyUnit ? fmt(toNumber(displayValue(convertTo(p.q, e)))) : undefined,
      };
    } catch (e) {
      custom = { text: qtrim, ok: false, parsed: false, msg: (e as Error).message };
    }
  }
  const searchRef = useRef<HTMLInputElement>(null);
  // the menu is hidden until it is placed, so focus the search box once it is visible. Not on touch
  // screens: that would open the phone's keyboard, and usually a unit is picked from the list; tap
  // the search box to type one
  useEffect(() => {
    if (style.visibility === 'hidden') return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    searchRef.current?.focus();
  }, [style.visibility]);
  const lq = qtrim.toLowerCase();
  const filtered = groups
    .map((g) => ({ ...g, items: g.items.filter((c) => !lq || c.text.toLowerCase().includes(lq)) }))
    .filter((g) => g.items.length);
  const flat = filtered.flatMap((g) => g.items.map((c) => c.text));
  const pick = (t: string | undefined) => {
    p.onPick(t);
    p.close();
  };
  // a listed unit as it is stored: the automatic unit means "automatic", and "(none)" (a plain
  // number) is stored as 1, which parses as no unit — its label would not
  const items = filtered.flatMap((g) => g.items);
  const choose = (text: string) => {
    const c = items.find((x) => x.text === text);
    const t = c ? formatUnit(c.expr) : text;
    pick(t === formatUnit(p.autoUnit) ? undefined : t || '1');
  };

  return (
    <div className="unit-menu" role="listbox" ref={p.menuRef} style={style}>
      <input
        ref={searchRef}
        className="unit-search"
        placeholder="type a unit… (e.g. kip/in^2)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            p.close();
            p.anchor.current?.focus();
          }
          if (e.key === 'ArrowDown') setHi(Math.min(hi + 1, flat.length - 1));
          if (e.key === 'ArrowUp') setHi(Math.max(hi - 1, 0));
          if (e.key === 'Enter') {
            if (custom?.ok && !flat.includes(custom.text)) pick(custom.text);
            // a real unit that doesn't fit: don't silently pick something else
            else if (custom?.parsed && !custom.ok) return;
            else if (flat[hi]) choose(flat[hi]);
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
                className={`unit-item ${formatUnit(c.expr) === p.current ? 'current' : ''} ${flat[hi] === c.text ? 'hi' : ''}`}
                onClick={() => choose(c.text)}
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
