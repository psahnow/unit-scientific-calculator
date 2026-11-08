// Tokenizer for the LaTeX subset MathLive emits, plus unit/const chip macros.

export type Tok =
  | { t: 'num'; v: string; s: number; e: number }
  | { t: 'letter'; v: string; s: number; e: number }
  | { t: 'op'; v: string; s: number; e: number; cross?: boolean } // + - * / = , ! % ^ _ | ∠; × is marked cross (D63)
  | { t: 'open'; v: '(' | '[' | '|' | '{' | '⟨'; s: number; e: number }
  | { t: 'close'; v: ')' | ']' | '|' | '}' | '⟩'; s: number; e: number }
  | { t: 'cmd'; v: string; s: number; e: number; arg?: string }
  | { t: 'unit'; v: string; s: number; e: number }
  | { t: 'const'; v: string; s: number; e: number }
  | { t: 'rowref'; v: string; s: number; e: number }; // #3: the value of row 3 (D56)

export const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', hbar: 'ħ',
};
const GREEK_TO_CMD: Record<string, string> = Object.fromEntries(Object.entries(GREEK).map(([k, v]) => [v, k]));

const SKIP = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle', 'limits', 'nolimits', 'bigl', 'bigr', 'Bigl', 'Bigr', 'left', 'right', 'mleft', 'mright']);
const TIMES = new Set(['cdot', 'times', 'ast', 'cdotp']);
/** Comparison commands → operator tokens (piecewise conditions, D27). */
const CMP_CMDS: Record<string, string> = { lt: '<', gt: '>', le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥', ne: '≠', neq: '≠' };

/** Find index of matching '}' for a '{' at position i. */
export function matchBrace(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return src.length - 1;
}

/** Convert chip content LaTeX (e.g. "\\mu m", "\\degree C", "gal_{UK}") to a unit symbol. */
export function latexToSymbol(latex: string): string {
  return latex
    .replace(/\\(dot|ddot)\s*\{([^{}]*)\}/g, (_, d: string, x: string) => x + DOTS[d])
    .replace(/\\(degree|circ)\s*/g, '°')
    .replace(/\\operatorname\{([^}]*)\}/g, '$1')
    .replace(/\\(mathrm|text|mathit)\{([^}]*)\}/g, '$2')
    .replace(/\\([A-Za-z]+)\s*/g, (_, n) => GREEK[n] ?? (n === 'prime' ? '′' : n === '%' ? '%' : n))
    .replace(/\\%/g, '%')
    .replace(/[{}\s]/g, '')
    .replace(/μ/g, 'µ');
}

/** Combining marks for dotted names (D61): ṁ is m + U+0307, ẍ is x + U+0308. */
export const DOTS: Record<string, string> = { dot: '̇', ddot: '̈' };
const DOT_CMD: Record<string, string> = { '̇': 'dot', '̈': 'ddot' };

/** Convert a unit/const symbol back to chip-content LaTeX. */
export function symbolToLatex(sym: string): string {
  let out = '';
  let last = 0; // where the previous character's LaTeX starts, so a combining dot can wrap it
  for (const ch of sym) {
    if (DOT_CMD[ch]) {
      out = `${out.slice(0, last)}\\${DOT_CMD[ch]}{${out.slice(last).trim()}}`;
      continue;
    }
    last = out.length;
    if (ch === '°') out += '\\degree ';
    else if (ch === 'µ') out += '\\mu ';
    else if (ch === '%') out += '\\%';
    else if (GREEK_TO_CMD[ch]) out += `\\${GREEK_TO_CMD[ch]} `;
    else out += ch;
  }
  out = out.trim();
  // subscripts: gal_UK → gal_{UK}
  return out.replace(/_([^_{}]+)$/, '_{$1}');
}

export function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const s = i;
    if (c === ' ' || c === '\t' || c === '\n' || c === '&') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) {
        j++;
        // MathLive digit grouping "{,}" or "\," inside numbers
        if (src.startsWith('{,}', j) && /[0-9]/.test(src[j + 3] ?? '')) j += 3;
      }
      // E-notation: 6.02e23, 1.5E-3, 2e+5 (D31). A digit must follow, so 2e alone is still 2·e.
      const ex = /^[eE][+\-−]?[0-9]+/.exec(src.slice(j));
      if (ex && j > i) j += ex[0].length;
      toks.push({ t: 'num', v: src.slice(i, j).replace(/\{,\}/g, '').replace('−', '-'), s, e: j });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      toks.push({ t: 'letter', v: c, s, e: i + 1 });
      i++;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1];
      let j = i + m[0].length;
      if (name === 'unit' || name === 'const' || name === 'operatorname' || name === 'mathrm' || name === 'text' || name === 'mathit' || name === 'mathbf' || name === 'placeholder') {
        while (src[j] === ' ') j++;
        let content = '';
        if (src[j] === '{') {
          const end = matchBrace(src, j);
          content = src.slice(j + 1, end);
          j = end + 1;
        }
        if (name === 'unit') toks.push({ t: 'unit', v: latexToSymbol(content), s, e: j });
        else if (name === 'const') toks.push({ t: 'const', v: latexToSymbol(content), s, e: j });
        else if (name === 'operatorname')
          // MathLive writes \operatorname{\mathrm{erf}}: keep just the letters
          toks.push({ t: 'cmd', v: content.replace(/\\(mathrm|text|mathit|mathbf|operatorname)\s*/g, '').replace(/[{}\s]/g, ''), s, e: j });
        else if (name === 'placeholder') {
          /* empty slot */
        } else {
          // \mathrm{mm} etc: tokenize contents as letters, keep original positions approximate
          const inner = tokenize(content);
          for (const t of inner) toks.push({ ...t, s: -1, e: -1 } as Tok);
        }
        i = j;
        continue;
      }
      if (name === 'dot' || name === 'ddot') {
        // ṁ, ẍ (D61): a dotted letter is a letter of its own, written with a combining dot
        while (src[j] === ' ') j++;
        let content = src[j] ?? '';
        if (src[j] === '{') {
          const end = matchBrace(src, j);
          content = src.slice(j + 1, end);
          j = end + 1;
        } else j++;
        const inner = tokenize(content);
        if (inner.length === 1 && inner[0].t === 'letter') toks.push({ t: 'letter', v: inner[0].v + DOTS[name], s, e: j });
        else for (const t of inner) toks.push({ ...t, s: -1, e: -1 } as Tok);
        i = j;
        continue;
      }
      i = j;
      if (name === '#') {
        // #3 or #{12}: a row reference (D56)
        const m2 = /^{?s*([0-9]+)s*}?/.exec(src.slice(i));
        if (m2) {
          toks.push({ t: 'rowref', v: m2[1], s, e: i + m2[0].length });
          i += m2[0].length;
        } else toks.push({ t: 'rowref', v: '', s, e: i });
        continue;
      }
      if (/^(left|right|mleft|mright)$/.test(name) && src[i] === '.') i++; // null delimiter
      if (SKIP.has(name)) continue;
      if (TIMES.has(name)) toks.push({ t: 'op', v: '*', s, e: i, ...(name === 'times' ? { cross: true } : {}) });
      else if (name === 'angle' || name === 'measuredangle') toks.push({ t: 'op', v: '∠', s, e: i });
      else if (name === 'langle') toks.push({ t: 'open', v: '⟨', s, e: i });
      else if (name === 'rangle') toks.push({ t: 'close', v: '⟩', s, e: i });
      else if (name === 'div') toks.push({ t: 'op', v: '/', s, e: i });
      else if (name === '%') toks.push({ t: 'op', v: '%', s, e: i });
      else if (name === 'lbrack') toks.push({ t: 'open', v: '[', s, e: i });
      else if (name === 'rbrack') toks.push({ t: 'close', v: ']', s, e: i });
      else if (name === 'lvert' || name === 'vert' || name === 'mid') toks.push({ t: 'open', v: '|', s, e: i });
      else if (name === 'rvert') toks.push({ t: 'close', v: '|', s, e: i });
      else if (name === '{') toks.push({ t: 'open', v: '{', s, e: i });
      else if (name === '}') toks.push({ t: 'close', v: '}', s, e: i });
      else if (name === 'lbrace') toks.push({ t: 'open', v: '{', s, e: i });
      else if (name === 'rbrace') toks.push({ t: 'close', v: '}', s, e: i });
      else if (CMP_CMDS[name]) toks.push({ t: 'op', v: CMP_CMDS[name], s, e: i });
      else if (name === 'to' || name === 'rightarrow' || name === 'longrightarrow') toks.push({ t: 'op', v: '→', s, e: i });
      else if (name === 'colon') toks.push({ t: 'op', v: ':', s, e: i });
      else if (name === 'differentialD') toks.push({ t: 'letter', v: 'd', s, e: i });
      else if (name === 'degree' || name === 'circ') toks.push({ t: 'letter', v: '°', s, e: i });
      else if (name === 'exponentialE') toks.push({ t: 'letter', v: 'e', s, e: i });
      else if (name === 'prime') toks.push({ t: 'letter', v: '′', s, e: i });
      else if (GREEK[name]) toks.push({ t: 'letter', v: GREEK[name], s, e: i });
      else toks.push({ t: 'cmd', v: name, s, e: i });
      continue;
    }
    if (c === '(' || c === '[') toks.push({ t: 'open', v: c, s, e: i + 1 });
    else if (c === ')' || c === ']') toks.push({ t: 'close', v: c, s, e: i + 1 });
    else if (c === '{') toks.push({ t: 'open', v: '{', s, e: i + 1 });
    else if (c === '}') toks.push({ t: 'close', v: '}', s, e: i + 1 });
    else if (c === '|') toks.push({ t: 'open', v: '|', s, e: i + 1 });
    else if ('+-*/=,!^_%:<>'.includes(c)) toks.push({ t: 'op', v: c, s, e: i + 1 });
    else if ('≤≥≠→'.includes(c)) toks.push({ t: 'op', v: c, s, e: i + 1 });
    else if (c === '−') toks.push({ t: 'op', v: '-', s, e: i + 1 });
    else if (c === '·') toks.push({ t: 'op', v: '*', s, e: i + 1 });
    else if (c === '×') toks.push({ t: 'op', v: '*', s, e: i + 1, cross: true });
    else if (c === '∠') toks.push({ t: 'op', v: '∠', s, e: i + 1 });
    else if (c === '⟨') toks.push({ t: 'open', v: '⟨', s, e: i + 1 });
    else if (c === '⟩') toks.push({ t: 'close', v: '⟩', s, e: i + 1 });
    else if (c === "'") {
      /* ignore primes */
    } else if (/[µμΩ°Δαβγδεζηθικλνξπρστυφχψωħ′″‰Å]/.test(c)) toks.push({ t: 'letter', v: c, s, e: i + 1 });
    // anything else: ignore
    i++;
  }
  return toks;
}
