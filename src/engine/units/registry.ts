// Unit lookup (with SI prefix expansion), unit-expression helpers and formatting.
import { type Dim, DIMLESS, dimMul, dimPow, dimEq } from '../dim';
import { type Num, ONE, mul, powRational, toFraction, float, toNumber } from '../num';
import { UNITS, UNIT_BY_ID, SI_PREFIXES, BINARY_PREFIXES, type UnitDef } from './units.data';

export type { UnitDef };
export interface UnitTerm {
  id: string;
  power: number;
}
export type UnitExpr = UnitTerm[];

const aliasMap = new Map<string, UnitDef>();
for (const u of UNITS) {
  aliasMap.set(u.id, u);
  for (const a of u.aliases) if (!aliasMap.has(a)) aliasMap.set(a, u);
}
const synth = new Map<string, UnitDef | null>();

// Spelled-out names (newton, metres, kilonewtons) for bare letters (D29). Single-word names only.
const nameMap = new Map<string, UnitDef>();
for (const u of UNITS) {
  const n = u.name.toLowerCase();
  if (!/^[a-zå]+$/.test(n) || n.length < 4) continue;
  for (const v of [n, n.replace(/metre$/, 'meter'), n.replace(/litre$/, 'liter')]) if (!nameMap.has(v)) nameMap.set(v, u);
}
for (const [k, id] of [
  ['feet', 'ft'], ['inches', 'in'], ['inch', 'in'], ['foot', 'ft'], ['pounds', 'lbm'], ['pound', 'lbm'], ['hours', 'h'], ['hour', 'h'],
  ['minutes', 'min'], ['seconds', 's'], ['degrees', '°'], ['celsius', '°C'], ['centigrade', '°C'], ['fahrenheit', '°F'], ['rankine', '°R'],
  ['gallon', 'gal'], ['gallons', 'gal'], ['atmosphere', 'atm'], ['atmospheres', 'atm'], ['horsepower', 'hp'], ['calorie', 'cal'],
  ['calories', 'cal'], ['btu', 'BTU'], ['btus', 'BTU'], ['tons', 'ton'], ['days', 'd'], ['day', 'd'], ['weeks', 'wk'], ['week', 'wk'],
  ['years', 'yr'], ['year', 'yr'], ['microns', 'µm'], ['micron', 'µm'], ['kips', 'kip'], ['thou', 'mil'],
] as const) {
  const u = UNIT_BY_ID.get(id);
  if (u) nameMap.set(k, u);
}
const PREFIX_WORDS: Record<string, string> = { kilo: 'k', mega: 'M', giga: 'G', milli: 'm', micro: 'µ', nano: 'n', centi: 'c', pico: 'p' };

function lookupName(s: string): UnitDef | undefined {
  if (s.length < 4 || !/^[a-zA-Z]+$/.test(s)) return undefined;
  const w = s.toLowerCase();
  const one = (x: string) => nameMap.get(x) ?? (x.endsWith('s') ? nameMap.get(x.slice(0, -1)) : undefined) ?? (x.endsWith('es') ? nameMap.get(x.slice(0, -2)) : undefined);
  const direct = one(w);
  if (direct) return direct;
  for (const [word, p] of Object.entries(PREFIX_WORDS)) {
    if (!w.startsWith(word)) continue;
    const base = one(w.slice(word.length));
    if (base?.prefixable) return lookupUnit(p + base.id);
  }
  return undefined;
}

/** Normalise micro/omega variants and ASCII spellings. */
export function normalizeSymbol(s: string): string {
  return s
    .replace(/μ/g, 'µ') // Greek mu → micro sign
    .replace(/Ω/g, 'Ω')
    .replace(/\s+/g, '')
    .replace(/^deg(?=[CFR]$)/, '°');
}

export function lookupUnit(raw: string): UnitDef | undefined {
  const s = normalizeSymbol(raw);
  const direct = aliasMap.get(s);
  if (direct) return direct;
  if (synth.has(s)) return synth.get(s) ?? undefined;
  let found: UnitDef | undefined;
  const tryPrefixes = (list: [string, Num][], str: string) => {
    for (const [p, pf] of list) {
      if (!str.startsWith(p) || str.length === p.length) continue;
      const base = UNIT_BY_ID.get(str.slice(p.length)) ?? aliasMap.get(str.slice(p.length));
      if (base && base.prefixable && (list === SI_PREFIXES || base.category === 'Data')) {
        return makePrefixed(p, pf, base);
      }
    }
    return undefined;
  };
  found = tryPrefixes(SI_PREFIXES, s) ?? tryPrefixes(BINARY_PREFIXES, s) ?? lookupName(s);
  // ASCII 'u' for micro: um, uF, us…
  if (!found && s.startsWith('u') && s.length > 1) found = tryPrefixes(SI_PREFIXES, 'µ' + s.slice(1));
  synth.set(s, found ?? null);
  return found;
}

const PREFIX_NAMES: Record<string, string> = {
  Q: 'quetta', R: 'ronna', Y: 'yotta', Z: 'zetta', E: 'exa', P: 'peta', T: 'tera', G: 'giga', M: 'mega',
  k: 'kilo', h: 'hecto', da: 'deca', d: 'deci', c: 'centi', m: 'milli', µ: 'micro', n: 'nano', p: 'pico',
  f: 'femto', a: 'atto', z: 'zepto', y: 'yocto', r: 'ronto', q: 'quecto', Ki: 'kibi', Mi: 'mebi', Gi: 'gibi', Ti: 'tebi',
};

function makePrefixed(p: string, pf: Num, base: UnitDef): UnitDef {
  const id = p + base.id;
  const existing = UNIT_BY_ID.get(id);
  if (existing) return existing;
  const isKg = id === 'kg';
  const def: UnitDef = {
    id,
    aliases: [],
    name: (PREFIX_NAMES[p] ?? p) + base.name,
    dim: base.dim,
    factor: mul(pf, base.factor),
    system: base.system,
    category: base.category,
    base: isKg || undefined,
    prefixOf: base.id,
  };
  UNIT_BY_ID.set(id, def);
  return def;
}

export function getUnit(id: string): UnitDef {
  const u = UNIT_BY_ID.get(id) ?? lookupUnit(id);
  if (!u) throw new Error(`Unknown unit '${id}'`);
  return u;
}

export function unitDim(e: UnitExpr): Dim {
  let d = DIMLESS;
  for (const t of e) d = dimMul(d, dimPow(getUnit(t.id).dim, t.power));
  return d;
}

export function unitFactor(e: UnitExpr): Num {
  let f = ONE;
  for (const t of e) {
    const u = getUnit(t.id);
    const fr = Number.isInteger(t.power) ? ([t.power, 1] as [number, number]) : toFraction(t.power);
    f = mul(f, fr ? powRational(u.factor, fr[0], fr[1]) : float(Math.pow(toNumber(u.factor), t.power)));
  }
  return f;
}

/** Single offset unit (°C, °F) at power 1 — the only case where offsets apply. */
export function offsetUnit(e: UnitExpr): UnitDef | undefined {
  if (e.length !== 1 || e[0].power !== 1) return undefined;
  const u = getUnit(e[0].id);
  return u.offset ? u : undefined;
}

export function unitExprEq(a: UnitExpr, b: UnitExpr): boolean {
  return a.length === b.length && a.every((t, i) => t.id === b[i].id && Math.abs(t.power - b[i].power) < 1e-12);
}

export function sameDim(a: UnitExpr, b: UnitExpr) {
  return dimEq(unitDim(a), unitDim(b));
}

// ── Formatting ───────────────────────────────────────────────────────────────
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '.': '·', '/': 'ᐟ' };
export function superscript(n: number | string): string {
  const s = typeof n === 'number' ? powerString(n) : n;
  return [...s].map((c) => SUP[c] ?? c).join('');
}
function powerString(p: number): string {
  if (Number.isInteger(p)) return String(p);
  const fr = toFraction(p);
  return fr ? `${fr[0]}/${fr[1]}` : String(p);
}

function termStr(t: UnitTerm, abs = false): string {
  const p = abs ? Math.abs(t.power) : t.power;
  return t.id + (p === 1 ? '' : superscript(p));
}

export function formatUnit(e: UnitExpr): string {
  if (!e.length) return '';
  const num = e.filter((t) => t.power > 0);
  const den = e.filter((t) => t.power < 0);
  if (!num.length) return den.map((t) => termStr(t)).join('·');
  const n = num.map((t) => termStr(t)).join('·');
  if (!den.length) return n;
  const d = den.map((t) => termStr(t, true)).join('·');
  return `${n}/${den.length > 1 ? `(${d})` : d}`;
}

// ── Free-form unit-expression parsing (dropdown search, saved display units) ─
/** Parse strings like "N/mm^2", "kip/in²", "J/(kg·K)", "lbf ft", "N*m". */
export function parseUnitExpr(input: string): UnitExpr {
  const s = input
    .trim()
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => '^' + [...m].map((c) => '0123456789-'['⁰¹²³⁴⁵⁶⁷⁸⁹⁻'.indexOf(c)]).join(''));
  let i = 0;
  const peek = () => s[i];
  const ws = () => {
    while (s[i] === ' ') i++;
  };
  function atom(): UnitExpr {
    ws();
    if (peek() === '(') {
      i++;
      const e = product();
      ws();
      if (peek() !== ')') throw new Error('Missing )');
      i++;
      return powSuffix(e);
    }
    if (peek() === '1') {
      i++;
      return [];
    }
    const m = /^[A-Za-zµμΩ°Δ%‰′″Åα-ωΑ-Ω_]+[A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) throw new Error(`Unexpected '${s.slice(i)}'`);
    let sym = m[0];
    // allow trailing digits only after underscore (H2O style)
    if (/\d$/.test(sym) && !lookupUnit(sym)) sym = sym.replace(/\d+$/, '');
    i += sym.length;
    const u = lookupUnit(sym);
    if (!u) throw new Error(`Unknown unit '${sym}'`);
    return powSuffix([{ id: u.id, power: 1 }]);
  }
  function powSuffix(e: UnitExpr): UnitExpr {
    ws();
    if (peek() === '^') {
      i++;
      // ^2 or ^(1/2); a ")" only belongs to the exponent if the exponent opened one: (kg·s^2) keeps its ")"
      const m = /^(?:\((-?\d+(?:\.\d+)?(?:\/\d+)?)\)|(-?\d+(?:\.\d+)?(?:\/\d+)?))/.exec(s.slice(i));
      if (!m) throw new Error('Bad exponent');
      i += m[0].length;
      const [a, b] = (m[1] ?? m[2]).split('/');
      const p = Number(a) / (b ? Number(b) : 1);
      return e.map((t) => ({ id: t.id, power: t.power * p }));
    }
    return e;
  }
  function product(): UnitExpr {
    let e = atom();
    for (;;) {
      ws();
      const c = peek();
      if (c === '*' || c === '·' || c === '⋅' || c === '.') {
        i++;
        e = e.concat(atom());
      } else if (c === '/') {
        i++;
        e = e.concat(atom().map((t) => ({ id: t.id, power: -t.power })));
      } else if (c !== undefined && c !== ')') {
        e = e.concat(atom()); // juxtaposition
      } else return e;
    }
  }
  const e = product();
  if (i < s.length) throw new Error(`Unexpected '${s.slice(i)}'`);
  return combine(e);
}

/** Merge repeated ids, drop zero powers (order of first appearance kept). */
export function combine(e: UnitExpr): UnitExpr {
  const out: UnitExpr = [];
  for (const t of e) {
    const ex = out.find((o) => o.id === t.id);
    if (ex) ex.power = Math.round((ex.power + t.power) * 1e9) / 1e9;
    else out.push({ ...t });
  }
  return out.filter((t) => Math.abs(t.power) > 1e-12);
}

export function allUnits(): UnitDef[] {
  return UNITS;
}

/** Expand catalogue + common prefixes, for autocomplete / dropdowns. */
let expanded: UnitDef[] | null = null;
export function expandedUnits(): UnitDef[] {
  if (expanded) return expanded;
  const out: UnitDef[] = [];
  for (const u of UNITS) {
    if (u.id === 'g') {
      out.push(getUnit('kg'));
    }
    out.push(u);
    for (const p of u.commonPrefixes ?? []) {
      const pu = lookupUnit(p + u.id);
      if (pu && !out.includes(pu)) out.push(pu);
    }
  }
  expanded = out;
  return out;
}

// kg is the coherent base unit of mass.
getUnit('kg').base = true;
