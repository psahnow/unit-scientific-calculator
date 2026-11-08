// The ⚙ Settings panel, in groups: how numbers look, unit sets, appearance, optional maths, custom units.
import { useEffect, useState } from 'react';
import { useStore, type Settings, type Theme } from '../state/store';
import { PACKAGES } from '../engine/units/packages';
import { getCustomUnitErrors } from '../engine/units/registry';
import { usePopover } from './usePopover';

/**
 * Significant figures, 1–16 (D59): a valid whole number applies at once; anything else is shown as
 * invalid with the range, and goes back to the current value when you leave the box — never
 * silently changed to something else.
 */
function SigFigsInput({ value, onChange }: { value: number; onChange(n: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 16;
  return (
    <label className={`sigfigs ${valid ? '' : 'invalid'}`}>
      Significant figures
      <input
        type="number"
        min={1}
        max={16}
        step={1}
        value={draft}
        aria-invalid={!valid}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isInteger(v) && v >= 1 && v <= 16) onChange(v);
        }}
        onBlur={() => setDraft(String(value))}
      />
      {!valid && <span className="field-hint">A whole number from 1 to 16</span>}
    </label>
  );
}

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'light', label: 'Light', hint: 'Paper' },
  { id: 'dark', label: 'Dark', hint: 'Graphite' },
  { id: 'system', label: 'System', hint: 'Follow this device' },
];

export function SettingsMenu() {
  const menu = usePopover();
  const st = useStore((s) => s.ws.settings);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const set = (p: Partial<Settings>) => useStore.getState().setSettings(p);
  // the store has already installed this worksheet's custom units: this only reads their messages
  const customErrors = getCustomUnitErrors();

  return (
    <div className="pop-wrap" ref={menu.ref}>
      <button
        className="icon-btn"
        title="Settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        ⚙
      </button>
      {menu.open && (
        <div className="popover right settings" role="dialog" aria-label="Settings">
          <fieldset className="packages">
            <legend>Number format</legend>
            <SigFigsInput value={st.sigFigs} onChange={(n) => set({ sigFigs: n })} />
            <label>
              Notation
              <select value={st.notation} onChange={(e) => set({ notation: e.target.value as Settings['notation'] })}>
                <option value="auto">Auto</option>
                <option value="scientific">Scientific</option>
                <option value="engineering">Engineering</option>
              </select>
              <small className="field-help">
                {st.notation === 'auto'
                  ? 'Plain numbers, switching to ×10ⁿ only for very large or small values.'
                  : st.notation === 'scientific'
                    ? 'Always one digit before the point: 6.43×10⁶.'
                    : 'Powers of ten in steps of three, to match k, M, G: 6.43×10⁶, 643×10³.'}
              </small>
            </label>
            <label title="With Auto notation, values this large or larger are shown as 6.43×10⁶">
              Scientific notation from
              <select value={st.sciAbove} disabled={st.notation !== 'auto'} onChange={(e) => set({ sciAbove: Number(e.target.value) })}>
                <option value={3}>10³</option>
                <option value={4}>10⁴</option>
                <option value={5}>10⁵</option>
                <option value={6}>10⁶</option>
                <option value={9}>10⁹</option>
                <option value={12}>10¹² (default)</option>
                <option value={21}>Never</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={st.exactDefault} onChange={(e) => set({ exactDefault: e.target.checked })} />
              <span>
                Show exact fractions (1/3)
                <small className="field-help">
                  Shows 1/3 instead of 0.3333… for plain numbers. Values with units always use decimals. A row’s a/b switch changes just that row.
                </small>
              </span>
            </label>
          </fieldset>

          <fieldset className="packages">
            <legend>Unit sets</legend>
            <p className="pk-help">Everyday metric and US units are always on. Add more for this worksheet:</p>
            {PACKAGES.map((p) => (
              <label key={p.id} className="check pk" title={p.description}>
                <input
                  type="checkbox"
                  checked={st.packages.includes(p.id)}
                  onChange={(e) => set({ packages: e.target.checked ? [...st.packages, p.id] : st.packages.filter((x) => x !== p.id) })}
                />
                <span>
                  {p.name}
                  <small>{p.description}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="packages custom-units">
            <legend>Custom units</legend>
            <p className="pk-help">Define your own units for this worksheet, like bag = 25 kg or ksf = kip/ft^2.</p>
            {(st.units ?? []).map((u, i) => (
              <div key={i} className="cu-row">
                <input
                  className="cu-sym"
                  value={u.symbol}
                  placeholder="bag"
                  aria-label={`Custom unit ${i + 1} symbol`}
                  onChange={(e) => set({ units: st.units.map((x, j) => (j === i ? { ...x, symbol: e.target.value } : x)) })}
                />
                <span>=</span>
                <input
                  className="cu-def"
                  value={u.definition}
                  placeholder="25 kg"
                  aria-label={`Custom unit ${i + 1} size`}
                  onChange={(e) => set({ units: st.units.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)) })}
                />
                <button className="icon-btn danger small" aria-label="Remove custom unit" onClick={() => set({ units: st.units.filter((_, j) => j !== i) })}>
                  ✕
                </button>
                {customErrors[i] && <span className="cu-err">{customErrors[i]}</span>}
              </div>
            ))}
            <button className="text-btn" onClick={() => set({ units: [...(st.units ?? []), { symbol: '', definition: '' }] })}>
              + Add a unit
            </button>
          </fieldset>

          {/* optional maths for this worksheet (D63): one at a time, since both use i */}
          <fieldset className="packages extra-math">
            <legend>Vectors and complex numbers</legend>
            <p className="pk-help">Off unless you need them. Only one can be on at a time, since both use i.</p>
            <label className="check pk" title={st.imaginary ? 'Turn off complex numbers first' : undefined}>
              <input
                type="checkbox"
                checked={!!st.vectors && !st.imaginary}
                disabled={!!st.imaginary}
                onChange={(e) => set({ vectors: e.target.checked || undefined })}
              />
              <span>
                Vectors
                <small>(3, 4) N, 3i + 4j, e₁ … eₙ. · is the dot product, × the cross product, |v| the length</small>
              </span>
            </label>
            <label className="check pk" title={st.vectors ? 'Turn off vectors first' : undefined}>
              <input
                type="checkbox"
                checked={!!st.imaginary}
                disabled={!!st.vectors}
                onChange={(e) => set({ imaginary: e.target.checked ? 'i' : undefined })}
              />
              <span>
                Complex numbers
                <small>3 + 4i, √−4 = 2i, 5∠53°; re, im, conj, arg</small>
              </span>
            </label>
            {st.imaginary && (
              <label className="imag-letter">
                Write √−1 as
                <select value={st.imaginary} onChange={(e) => set({ imaginary: e.target.value as 'i' | 'j' })}>
                  <option value="i">i</option>
                  <option value="j">j (electrical)</option>
                </select>
              </label>
            )}
          </fieldset>

          <fieldset className="packages">
            <legend>Appearance</legend>
            <div className="seg theme-seg" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.id} className={theme === t.id ? 'on' : ''} aria-pressed={theme === t.id} title={t.hint} onClick={() => setTheme(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <small className="field-help">Kept for this browser, not in the worksheet.</small>
          </fieldset>
        </div>
      )}
    </div>
  );
}
