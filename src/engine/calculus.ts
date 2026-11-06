// Numeric calculus on plain numbers (DESIGN.md §5.10). Units are handled by the caller:
// these work on SI magnitudes, so ∫ F dx in N and m comes out in N·m.

export class NumericError extends Error {}

type Fn = (x: number) => number;

function check(v: number, x: number): number {
  if (!Number.isFinite(v)) throw new NumericError(`the expression is undefined at ${fmt(x)}`);
  return v;
}
const fmt = (x: number) => (Math.abs(x) < 1e-4 || Math.abs(x) >= 1e6 ? x.toExponential(4) : String(Number(x.toPrecision(6))));

// ── Integration: adaptive Gauss–Kronrod (7-point Gauss, 15-point Kronrod) ──
const XK = [
  0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440, 0.586087235467691130,
  0.405845151377397167, 0.207784955007898468, 0,
];
const WK = [
  0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919, 0.169004726639267903,
  0.190350578064785410, 0.204432940075298892, 0.209482141084727828,
];
const WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

function gk15(f: Fn, a: number, b: number): { value: number; error: number } {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  const fc = check(f(c), c);
  let k = fc * WK[7];
  let g = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XK[j];
    const x1 = c - dx;
    const x2 = c + dx;
    const s = check(f(x1), x1) + check(f(x2), x2);
    k += WK[j] * s;
    if (j % 2 === 1) g += WG[(j - 1) / 2] * s;
  }
  return { value: k * h, error: Math.abs((k - g) * h) };
}

/** ∫ₐᵇ f(x) dx on a finite interval. */
function integrateFinite(f: Fn, a: number, b: number): number {
  const tolRel = 1e-12;
  type Seg = { a: number; b: number; value: number; error: number };
  const first = gk15(f, a, b);
  const segs: Seg[] = [{ a, b, ...first }];
  for (let iter = 0; iter < 2000; iter++) {
    const total = segs.reduce((s, x) => s + x.value, 0);
    const err = segs.reduce((s, x) => s + x.error, 0);
    if (err <= Math.max(tolRel * Math.abs(total), 1e-300)) return total;
    // split the worst segment
    let wi = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].error > segs[wi].error) wi = i;
    const w = segs[wi];
    const m = (w.a + w.b) / 2;
    if (m === w.a || m === w.b) break;
    segs.splice(wi, 1, { a: w.a, b: m, ...gk15(f, w.a, m) }, { a: m, b: w.b, ...gk15(f, m, w.b) });
  }
  const total = segs.reduce((s, x) => s + x.value, 0);
  const err = segs.reduce((s, x) => s + x.error, 0);
  if (err > 1e-6 * Math.max(1, Math.abs(total))) throw new NumericError("the integral doesn't converge");
  return total;
}

/** ∫ₐᵇ f(x) dx; a and b may be ±∞. */
export function integrate(f: Fn, a: number, b: number): number {
  if (a === b) return 0;
  if (a > b) return -integrate(f, b, a);
  const fa = Number.isFinite(a);
  const fb = Number.isFinite(b);
  if (fa && fb) return integrateFinite(f, a, b);
  try {
    return integrateInfinite(f, a, b, fa, fb);
  } catch (e) {
    if (e instanceof NumericError) throw new NumericError("the integral doesn't converge (it may be infinite)");
    throw e;
  }
}

function integrateInfinite(f: Fn, a: number, b: number, fa: boolean, fb: boolean): number {
  if (fa) return integrateFinite((t) => f(a + t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1); // [a, ∞)
  if (fb) return integrateFinite((t) => f(b - t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1); // (−∞, b]
  return integrateFinite((t) => (f(t / (1 - t * t)) * (1 + t * t)) / ((1 - t * t) * (1 - t * t)), -1, 1);
}

// ── Differentiation: Ridders' extrapolation of central differences ──
export function derivative(f: Fn, x: number, scale: number, order: 1 | 2 = 1): number {
  if (order === 2) return derivative((y) => derivative(f, y, scale, 1), x, scale, 1);
  const CON = 1.4;
  const CON2 = CON * CON;
  const NTAB = 12;
  let h = 0.05 * Math.max(Math.abs(x), scale);
  const a: number[][] = Array.from({ length: NTAB }, () => new Array(NTAB).fill(0));
  const cd = (hh: number) => (check(f(x + hh), x + hh) - check(f(x - hh), x - hh)) / (2 * hh);
  a[0][0] = cd(h);
  let err = Infinity;
  let ans = a[0][0];
  for (let i = 1; i < NTAB; i++) {
    h /= CON;
    a[0][i] = cd(h);
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const e = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
      if (e <= err) {
        err = e;
        ans = a[j][i];
      }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= 2 * err) break;
  }
  const ref = Math.max(Math.abs(a[0][0]), Math.abs(f(x)) / Math.max(Math.abs(x), scale));
  return snapTo(ans, ref);
}

// ── Limits: polynomial (Neville) extrapolation of f(a ± h) as h → 0 ──
let seenMax = 0;
function oneSide(g: Fn, h0: number): number {
  const hs: number[] = [];
  const vs: number[] = [];
  let best = NaN;
  let bestErr = Infinity;
  for (let k = 0; k < 14; k++) {
    const h = h0 / Math.pow(2, k);
    let v: number;
    try {
      v = g(h);
    } catch {
      continue;
    }
    if (Number.isNaN(v)) continue;
    if (!Number.isFinite(v)) return v;
    hs.push(h);
    vs.push(v);
    seenMax = Math.max(seenMax, Math.abs(v));
    // Neville: extrapolate the last few points to h = 0
    const n = Math.min(hs.length, 6);
    const H = hs.slice(-n);
    const P = vs.slice(-n);
    for (let m = 1; m < n; m++)
      for (let i = n - 1; i >= m; i--) P[i] = (H[i] * P[i - 1] - H[i - m] * P[i]) / (H[i] - H[i - m]);
    const est = P[n - 1];
    if (Number.isFinite(best)) {
      const e = Math.abs(est - best);
      if (e < bestErr) bestErr = e;
    }
    best = est;
  }
  if (!vs.length) throw new NumericError("the expression can't be evaluated near that point");
  // divergence: values growing without bound
  // divergence: the last few values grow steadily in size with one sign (1/x, 1/√x, ln x …)
  if (vs.length >= 6) {
    const tail = vs.slice(-6);
    const growing = tail.every((v, i) => i === 0 || (Math.abs(v) > Math.abs(tail[i - 1]) && Math.sign(v) === Math.sign(tail[0])));
    const last = tail[5];
    if (growing && Math.abs(last) > 1.5 * Math.abs(tail[0]) && Math.abs(last - tail[4]) >= 0.9 * Math.abs(tail[4] - tail[3]))
      return last > 0 ? Infinity : -Infinity;
  }
  return best;
}

/** lim f(x) as x → a. dir: approach from one side only. a may be ±∞. */
export function limit(f: Fn, a: number, scale: number, dir?: '+' | '-'): number {
  seenMax = 0;
  const snap = (v: number) => snapTo(v, seenMax);
  if (a === Infinity) return snap(oneSide((t) => f(1 / t), 1 / Math.max(1, scale)));
  if (a === -Infinity) return snap(oneSide((t) => f(-1 / t), 1 / Math.max(1, scale)));
  const h0 = 0.01 * Math.max(Math.abs(a), scale);
  const right = dir === '-' ? NaN : oneSide((h) => f(a + h), h0);
  const left = dir === '+' ? NaN : oneSide((h) => f(a - h), h0);
  if (dir === '+') return snap(right);
  if (dir === '-') return snap(left);
  const agree =
    (right === left) || Math.abs(right - left) <= 1e-6 * Math.max(1, Math.abs(right), Math.abs(left));
  if (!agree)
    throw new NumericError(`the limit doesn't exist: from the left it is ≈ ${fmt(left)}, from the right ≈ ${fmt(right)}`);
  return snap(Number.isFinite(right) ? (right + left) / 2 : right);
}

/** Round extrapolation noise: 0.9999999999998 → 1, 0.33333333333 → 1/3. */
function snapTo(v: number, ref = 0): number {
  if (!Number.isFinite(v)) return v;
  // zero relative to the size of the values involved (values may be tiny in SI, e.g. µN/mm)
  if (ref > 0 && Math.abs(v) < 1e-10 * ref) return 0;
  const tol = 1e-9 * Math.abs(v);
  for (let d = 1; d <= 12; d++) {
    const n = Math.round(v * d);
    if (Math.abs(v - n / d) < tol) return n / d;
  }
  return v;
}
