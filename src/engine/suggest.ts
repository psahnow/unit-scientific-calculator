// Autocomplete suggestions for the math input (DESIGN.md §4.2).
import { expandedUnits as allExpanded, normalizeSymbol, lookupUnit as lookupAny } from './units/registry';
import { isUnitOn } from './units/packages';

// only units from the worksheet's enabled packages (D26)
const lookupUnit = (s: string) => {
  const u = lookupAny(s);
  return u && isUnitOn(u) ? u : undefined;
};
const expandedUnits = () => allExpanded().filter(isUnitOn);
import { CONSTANTS } from './units/constants.data';
import { LETTER_FUNCS } from './parser';
import { symbolToLatex } from './latex';

export interface Suggestion {
  kind: 'unit' | 'const' | 'func' | 'var';
  label: string; // shown symbol
  detail: string; // name
  insert: string; // LaTeX to insert
}

const FUNC_LATEX: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot', asin: '\\arcsin', acos: '\\arccos',
  atan: '\\arctan', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
  ln: '\\ln', log: '\\log', exp: '\\exp', min: '\\min', max: '\\max',
};

export function suggestionsFor(prefixRaw: string, vars: Iterable<string>, afterNumber: boolean): Suggestion[] {
  const prefix = normalizeSymbol(prefixRaw);
  if (!prefix) return [];
  const lp = prefix.toLowerCase();
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (!out.some((o) => o.kind === s.kind && o.label === s.label)) out.push(s);
  };

  // A name the worksheet already defines comes first, even after a number: the variable wins (D21).
  const varList = [...vars];
  if (varList.includes(prefix)) add({ kind: 'var', label: prefix, detail: 'variable', insert: varLatex(prefix) });
  // dotted names (ṁ) come after the unit of the same letter, below (D61)
  const dotted = /^\p{L}$/u.test(prefix) ? [prefix + '̇', prefix + '̈'] : [];
  if (!afterNumber)
    for (const v of varList)
      if (v !== prefix && v.toLowerCase().startsWith(lp) && !dotted.some((d) => v.startsWith(d))) add({ kind: 'var', label: v, detail: 'variable', insert: varLatex(v) });

  // Ambiguous symbols (lb → lbm / lbf) always prompt (D20).
  const exact = lookupUnit(prefix);
  if (exact?.ambiguous && (prefix === 'lb' || prefix === 'lbs')) {
    for (const id of exact.ambiguous) {
      const u = lookupUnit(id)!;
      add({ kind: 'unit', label: u.id, detail: u.name, insert: `\\unit{${symbolToLatex(u.id)}}` });
    }
  }
  if (exact && !exact.ambiguous) add({ kind: 'unit', label: exact.id, detail: exact.name, insert: `\\unit{${symbolToLatex(exact.id)}}` });

  // ṁ under m, and any defined ṁ₁, m̈ … after it. After a number it multiplies: 6 · ṁ, never a
  // unit-like 6ṁ. Added at the end, once we know the letter has other suggestions: a lone x with
  // nothing else to offer gets no list (Tab would otherwise turn x into ẋ)
  const dotAt = out.length;
  const dotSugs: Suggestion[] = [];
  if (dotted.length) {
    const times = afterNumber ? '\\cdot' : '';
    const dot = dotted[0];
    dotSugs.push({ kind: 'var', label: dot, detail: varList.includes(dot) ? 'variable' : `${prefix} dot (or type ${prefix}.)`, insert: times + varLatex(dot) });
    for (const v of varList) if (v !== dot && dotted.some((d) => v.startsWith(d))) dotSugs.push({ kind: 'var', label: v, detail: 'variable', insert: times + varLatex(v) });
  }
  const dotDefined = dotSugs.some((s) => s.detail === 'variable');

  if (!afterNumber) {
    for (const f of LETTER_FUNCS)
      if (f.startsWith(lp) && f.length > 1)
        add({ kind: 'func', label: f, detail: 'function', insert: `${FUNC_LATEX[f] ?? `\\operatorname{${f}}`}\\left(#0\\right)` });
  }
  const units = expandedUnits();
  // symbol prefix matches (case-sensitive first), then name matches
  for (const u of units) if (u.id.startsWith(prefix) || u.aliases.some((a) => a.startsWith(prefix))) add(unitSug(u.id, u.name));
  for (const u of units) if (u.id.toLowerCase().startsWith(lp)) add(unitSug(u.id, u.name));
  if (lp.length >= 2) for (const u of units) if (u.name.toLowerCase().startsWith(lp)) add(unitSug(u.id, u.name));
  for (const c of CONSTANTS)
    if (c.key.toLowerCase().startsWith(lp) || (lp.length >= 3 && c.name.toLowerCase().includes(lp)))
      add({ kind: 'const', label: c.key, detail: c.name, insert: `\\const{${c.latex}}` });
  if (dotSugs.length && (out.length || dotDefined)) out.splice(dotAt, 0, ...dotSugs.filter((s) => !out.some((o) => o.label === s.label)));
  return out.slice(0, 12);
}

function unitSug(id: string, name: string): Suggestion {
  return { kind: 'unit', label: id, detail: name, insert: `\\unit{${symbolToLatex(id)}}` };
}

export function varLatex(name: string): string {
  const [base, sub] = name.split('_');
  const b = symbolToLatex(base);
  return sub ? `${b}_{${sub}}` : b;
}
