// Numeric calculus on plain numbers (DESIGN.md §5.10). Units are handled by the caller:
// these work on SI magnitudes, so ∫ F dx in N and m comes out in N·m.

export class NumericError extends Error {}

type Fn = (x: number) => number;

function check(v: number, x: number): number {
  if (!Number.isFinite(v)) throw new NumericError(`can't be worked out: the expression is undefined at ${fmt(x)}`);
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
  if (err > 1e-6 * Math.max(1, Math.abs(total))) throw new NumericError("doesn't converge");
  // not converged to full precision (a singular end point, say): show only the digits the error
  // estimate vouches for (D43)
  return roundToError(total, err);
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
    if (e instanceof NumericError) throw new NumericError("doesn't converge (it may be infinite)");
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
  const { value, ref } = derivativeEstimate(f, x, scale, order);
  // Ridders' own error estimate is often 0, so it can't be trusted. Over 30 000 random smooth
  // functions (polynomials, sin in radians and degrees, exp) the error stayed below 1×10⁻¹¹
  // (first) and 7×10⁻¹⁰ (second derivative) of the function's scale; show only digits inside
  // 1×10⁻⁹ and 1×10⁻⁸ of it. Only used when the symbolic derivative doesn't apply (D43, D44).
  const scaleOf = Math.max(Math.abs(value), ref);
  return roundToError(snapTo(value, ref), (order === 1 ? 1e-9 : 1e-8) * scaleOf);
}

/** The derivative with Ridders' own error estimate (absolute), before any rounding. */
export function derivativeEstimate(f: Fn, x: number, scale: number, order: 1 | 2 = 1): { value: number; err: number; ref: number } {
  // Ridders' tableau from five starting steps; take the median. One start can stop on a wrong
  // value while reporting a tiny error (d/dx sin(x) at x = 97; sin of degrees at 30), so neither the
  // first step nor the smallest reported error can be trusted alone (D43, D44). The second
  // difference divides by h², so its starts stay larger.
  const base = 0.05 * Math.max(Math.abs(x), scale);
  const starts = order === 1 ? [base, base / 8, base / 64, base / 512, base / 4096] : [base * 2, base * 1.4, base, base / 1.4, base / 2];
  const runs = starts.map((h0) => ridders(f, x, h0, order)).sort((p, q) => p.ans - q.ans);
  const best = runs[2];
  const ref = Math.max(Math.abs(best.a00), Math.abs(f(x)) / Math.pow(Math.max(Math.abs(x), scale), order));
  return { value: best.ans, err: Math.abs(runs[3].ans - runs[1].ans), ref };
}

function ridders(f: Fn, x: number, h: number, order: 1 | 2): { ans: number; err: number; a00: number } {
  const CON = 1.4;
  const CON2 = CON * CON;
  const NTAB = 12;
  const a: number[][] = Array.from({ length: NTAB }, () => new Array(NTAB).fill(0));
  // central differences: both have error series in even powers of h, as the extrapolation needs.
  // The second derivative uses (f(x+h) − 2f(x) + f(x−h)) / h² directly: differentiating a
  // numerical derivative again lost up to 4 digits (D43).
  const fx = order === 2 ? check(f(x), x) : 0;
  const cd =
    order === 1
      ? (hh: number) => (check(f(x + hh), x + hh) - check(f(x - hh), x - hh)) / (2 * hh)
      : (hh: number) => (check(f(x + hh), x + hh) - 2 * fx + check(f(x - hh), x - hh)) / (hh * hh);
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
  return { ans, err, a00: a[0][0] };
}

// ── Limits: polynomial (Neville) extrapolation of f(a ± h) as h → 0 ──
let seenMax = 0;
/** Last one-sided estimate's error (the change between successive extrapolations). */
let lastErr = 0;
function oneSide(g: Fn, h0: number): number {
  const hs: number[] = [];
  const vs: number[] = [];
  let best = NaN;
  let bestErr = Infinity;
  let prev = NaN;
  lastErr = 0;
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
    // keep the estimate that changed least from the one before: as h shrinks, rounding noise
    // (1 − cos x near 0) eventually swamps the values, and the last estimate is the worst (D43)
    if (Number.isFinite(prev)) {
      const e = Math.abs(est - prev);
      if (e < bestErr) {
        bestErr = e;
        best = est;
      }
    } else if (Number.isNaN(best)) best = est;
    prev = est;
  }
  lastErr = Number.isFinite(bestErr) ? bestErr : 0;
  if (!vs.length) throw new NumericError("can't be worked out: the expression is undefined near that point");
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
  // show only the digits the extrapolation settled on
  const done = (v: number, err: number) => (Number.isFinite(v) ? roundToError(snap(v), Math.max(err, 1e-13 * Math.abs(v))) : v);
  if (a === Infinity) return done(oneSide((t) => f(1 / t), 1 / Math.max(1, scale)), 4 * lastErr);
  if (a === -Infinity) return done(oneSide((t) => f(-1 / t), 1 / Math.max(1, scale)), 4 * lastErr);
  const h0 = 0.01 * Math.max(Math.abs(a), scale);
  const right = dir === '-' ? NaN : oneSide((h) => f(a + h), h0);
  const errR = lastErr;
  const left = dir === '+' ? NaN : oneSide((h) => f(a - h), h0);
  const errL = lastErr;
  if (dir === '+') return done(right, 4 * errR);
  if (dir === '-') return done(left, 4 * errL);
  const agree =
    (right === left) || Math.abs(right - left) <= 1e-6 * Math.max(1, Math.abs(right), Math.abs(left));
  if (!agree)
    throw new NumericError(`doesn't exist: from the left it is ≈ ${fmt(left)}, from the right ≈ ${fmt(right)}`);
  if (!Number.isFinite(right)) return snap(right);
  return done((right + left) / 2, Math.max(Math.abs(right - left), 4 * errR, 4 * errL));
}

/**
 * Round v to the decimal place of its error, so no digit beyond what the method can vouch for is
 * shown: 0.616357556 ± 8×10⁻⁹ → 0.61635756 (D43).
 */
export function roundToError(v: number, err: number): number {
  if (!Number.isFinite(v) || !(err > 0) || !Number.isFinite(err)) return v;
  const q = Math.pow(10, Math.ceil(Math.log10(err)));
  return Number((Math.round(v / q) * q).toPrecision(15));
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


// ── Root finding (D33): Brent's method inside a bracket; without one, search outward from a guess ──
function brent(f: Fn, a: number, b: number, fa: number, fb: number): number {
  let c = a, fc = fa, d = b - a, e = d;
  for (let iter = 0; iter < 200; iter++) {
    if (Math.sign(fb) === Math.sign(fc)) {
      c = a; fc = fa; d = b - a; e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a; fa = fb; fb = fc; fc = fa;
    }
    const tol = 2 * Number.EPSILON * Math.abs(b) + 1e-300;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) {
        p = 2 * m * s; q = 1 - s;
      } else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d; d = p / q;
      } else {
        d = m; e = m;
      }
    } else {
      d = m; e = m;
    }
    a = b; fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
    if (!Number.isFinite(fb)) throw new NumericError(`can't be worked out: the equation is undefined at ${fmt(b)}`);
  }
  return b;
}

const safe = (f: Fn) => (x: number) => {
  try {
    const v = f(x);
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
};

/** A root of f (f(x) = 0). With lo/hi: inside that range. Otherwise the root nearest the guess. */
export function findRoot(f: Fn, guess: number, scale: number, lo?: number, hi?: number): number {
  const g = safe(f);
  if (lo !== undefined && hi !== undefined) {
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    const fa = g(a), fb = g(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (Number.isFinite(fa) && Number.isFinite(fb) && Math.sign(fa) !== Math.sign(fb)) return brent(g, a, b, fa, fb);
    // scan the range for a sign change
    const n = 400;
    let px = a, pv = fa;
    for (let k = 1; k <= n; k++) {
      const x = a + ((b - a) * k) / n, v = g(x);
      if (Number.isFinite(v) && Number.isFinite(pv) && Math.sign(v) !== Math.sign(pv)) return brent(g, px, x, pv, v);
      px = x; pv = v;
    }
    throw new NumericError(`has no solution between ${fmt(a)} and ${fmt(b)}: the two sides never cross there`);
  }
  const x0 = guess;
  const f0 = g(x0);
  if (f0 === 0) return x0;
  const s = Math.max(Math.abs(x0), scale) || 1;
  // walk outward on both sides, with growing steps, until the sign changes
  const brackets: { b: [number, number, number, number]; dist: number }[] = [];
  // four walks: steps growing away from the guess in both directions, and (for a non-zero guess)
  // multiplying toward 0 and toward ∞, which finds roots like A = 4·10⁻⁵ m² from a guess of 1 m²
  const walks: ((k: number) => number)[] = [(k) => x0 + s * 1e-3 * Math.pow(1.25, k), (k) => x0 - s * 1e-3 * Math.pow(1.25, k)];
  if (x0 !== 0) walks.push((k) => x0 * Math.pow(10, -k / 8), (k) => x0 * Math.pow(10, k / 8));
  for (const walk of walks) {
    let px = x0, pv = f0, found = 0;
    for (let k = 1; k <= 160 && found < 3; k++) {
      const x = walk(k);
      const v = g(x);
      if (Number.isFinite(v) && Number.isFinite(pv) && Math.sign(v) !== Math.sign(pv)) {
        // keep walking: this sign change may be a pole (P/A jumps across A = 0), not a solution
        brackets.push({ b: [px, x, pv, v], dist: Math.abs((px + x) / 2 - x0) });
        found++;
      }
      if (Number.isFinite(v)) { px = x; pv = v; }
    }
  }
  // nearest bracket first; accept only where the equation really balances (not at a pole)
  brackets.sort((a, b) => a.dist - b.dist);
  for (const { b } of brackets) {
    const root = brent(g, b[0], b[1], b[2], b[3]);
    const fr = g(root);
    if (Number.isFinite(fr) && Math.abs(fr) <= 1e-9 * Math.max(Math.abs(b[2]), Math.abs(b[3]))) return root;
  }
  // no sign change (e.g. a double root like x² = 0): try the secant method from the guess
  let a = x0, b = x0 + s * 0.01, fa = f0, fb = g(b);
  for (let k = 0; k < 100 && Number.isFinite(fa) && Number.isFinite(fb); k++) {
    if (fb === fa) break;
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b; fa = fb; b = c; fb = g(b);
    if (Math.abs(fb) < 1e-13 * (Math.abs(f0) || 1)) return b;
  }
  throw new NumericError("found no solution: the two sides don't meet near the guess. Give a guess or a range, like solve(…, x, 0, 10)");
}

/**
 * Every root of f in [a, b] (D51): sample the range finely, refine each sign change with Brent's
 * method, and keep it only if f really is near zero there (a sign change across a pole, as in
 * tan x, is not a root). Roots where f touches zero without crossing are found only if a sample
 * lands on them.
 */
export function findAllRoots(f: Fn, a: number, b: number, samples = 2000): number[] {
  const g = safe(f);
  if (a > b) [a, b] = [b, a];
  const xs: number[] = [];
  const vs: number[] = [];
  for (let k = 0; k <= samples; k++) {
    const x = a + ((b - a) * k) / samples;
    xs.push(x);
    vs.push(g(x));
  }
  const out: number[] = [];
  for (let k = 0; k <= samples; k++) {
    if (vs[k] === 0) out.push(xs[k]);
    if (k === samples) break;
    const [p, q] = [vs[k], vs[k + 1]];
    if (!Number.isFinite(p) || !Number.isFinite(q) || p === 0 || q === 0 || Math.sign(p) === Math.sign(q)) continue;
    const r = brent(g, xs[k], xs[k + 1], p, q);
    const fr = g(r);
    if (Number.isFinite(fr) && Math.abs(fr) <= 1e-8 * Math.max(Math.abs(p), Math.abs(q))) out.push(r);
  }
  // one root per place
  const tol = 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return out.sort((x, y) => x - y).filter((x, i, arr) => i === 0 || x - arr[i - 1] > tol);
}
