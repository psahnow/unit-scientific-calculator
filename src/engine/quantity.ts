// Quantity: hidden SI magnitude + dimension + display unit expression (DESIGN.md §5).
import * as N from './num';
import { type Num } from './num';
import { type Dim, DIMLESS, dimMul, dimDiv, dimPow, dimEq, isDimlessLoose, kindOf } from './dim';
import {
  type UnitExpr,
  unitDim,
  unitFactor,
  offsetUnit,
  getUnit,
  formatUnit,
  combine,
} from './units/registry';
import { simplify } from './simplify';

export type TempKind = 'absolute' | 'delta';

export interface Quantity {
  si: Num;
  dim: Dim;
  unit: UnitExpr;
  tempKind?: TempKind;
}

export class CalcError extends Error {}

export const scalar = (n: Num): Quantity => ({ si: n, dim: DIMLESS, unit: [] });

/** A value's kind for messages: "a force (kN)", "a plain number", or "a value in kg·m" when it has no everyday name. */
export function describe(q: { dim: Dim; unit: UnitExpr }): string {
  const u = formatUnit(q.unit);
  const k = kindOf(q.dim);
  if (!k) return u ? `a value in ${u}` : 'a value';
  return u ? `${k} (${u})` : k;
}

/** Build a quantity from a value expressed in `unit`. */
export function fromUnit(value: Num, unit: UnitExpr): Quantity {
  const off = offsetUnit(unit);
  if (off) {
    return {
      si: N.add(N.mul(value, off.factor), off.offset!),
      dim: off.dim,
      unit,
      tempKind: 'absolute',
    };
  }
  const q: Quantity = { si: N.mul(value, unitFactor(unit)), dim: unitDim(unit), unit };
  if (unit.length === 1 && unit[0].power === 1 && getUnit(unit[0].id).tempKind === 'delta') q.tempKind = 'delta';
  return q;
}

/** Numeric value of q expressed in its display unit. */
export function displayValue(q: Quantity): Num {
  const off = offsetUnit(q.unit);
  if (q.tempKind === 'absolute' && off) return N.div(N.sub(q.si, off.offset!), off.factor);
  return N.div(q.si, unitFactor(q.unit));
}

/**
 * The one exception to "absolute temperatures need absolute units" (D45): a plain value in kelvin
 * (300 K, not a computed difference or a Δ unit) may be shown in °C or °F, read as an absolute
 * temperature. It comes with kelvinNote, since K also measures temperature changes.
 */
export function kelvinAsAbsolute(q: Quantity, unit: UnitExpr): boolean {
  if (q.tempKind || q.unit.length !== 1 || q.unit[0].power !== 1) return false;
  const from = getUnit(q.unit[0].id);
  const to = unit.length === 1 && unit[0].power === 1 ? getUnit(unit[0].id) : undefined;
  return (from.id === 'K' || from.prefixOf === 'K') && to?.tempKind === 'absolute';
}

/** Why reading a kelvin value as a temperature can mislead (shown under the result). */
export function kelvinNote(unit: UnitExpr): string {
  const u = formatUnit(unit);
  return `Read as a temperature. If this is a change in temperature (ΔT), show it in K or Δ${u} instead: a change of 10 K is 10 Δ°C, not −263.15 °C.`;
}

/** Check a target unit is a valid display unit for q. Returns an error message or null. */
export function checkConvertible(q: Quantity, unit: UnitExpr): string | null {
  if (kelvinAsAbsolute(q, unit)) return null;
  const ud = unitDim(unit);
  if (!dimEq(ud, q.dim)) return `Can't show ${kindOf(q.dim) ?? 'this value'} in ${formatUnit(unit)}, which is ${kindOf(ud) ?? 'something else'}`;
  const single = unit.length === 1 && unit[0].power === 1 ? getUnit(unit[0].id) : undefined;
  if (q.tempKind === 'absolute' && single?.tempKind === 'delta')
    return 'This is a temperature: show it in K, °C, °F or °R';
  if (q.tempKind !== 'absolute' && single?.tempKind === 'absolute' && dimEq(q.dim, single.dim))
    return 'This is a temperature difference: show it in K, Δ°C, Δ°F or °R';
  return null;
}

export function convertTo(q: Quantity, unit: UnitExpr): Quantity {
  const err = checkConvertible(q, unit);
  if (err) throw new CalcError(err);
  if (kelvinAsAbsolute(q, unit)) return { ...q, unit, tempKind: 'absolute' };
  return { ...q, unit };
}

const ABS_TEMP_MSG = (op: string) =>
  `Can't ${op} a temperature in °C or °F. Use K, or a temperature difference (Δ°C)`;

function deltaOf(unit: UnitExpr): UnitExpr {
  const off = offsetUnit(unit);
  if (off?.id === '°C') return [{ id: 'Δ°C', power: 1 }];
  if (off?.id === '°F') return [{ id: 'Δ°F', power: 1 }];
  return unit;
}

function requireSameDim(a: Quantity, b: Quantity, verb: string) {
  if (dimEq(a.dim, b.dim)) return;
  if (isDimlessLoose(a.dim) && isDimlessLoose(b.dim)) return; // rad ↔ number
  throw new CalcError(`Can't ${verb} ${describe(a)} and ${describe(b)}`);
}

export function add(a: Quantity, b: Quantity): Quantity {
  requireSameDim(a, b, 'add');
  const si = N.add(a.si, b.si);
  if (a.tempKind === 'absolute' && b.tempKind === 'absolute')
    throw new CalcError("Can't add two temperatures. To add a change, make it a difference: 20 °C + 5 Δ°C");
  if (a.tempKind === 'absolute') return { si, dim: a.dim, unit: a.unit, tempKind: 'absolute' };
  if (b.tempKind === 'absolute') return { si, dim: b.dim, unit: b.unit, tempKind: 'absolute' };
  const unit = a.unit.length || !b.unit.length ? a.unit : b.unit;
  return { si, dim: a.dim.A === 0 && b.dim.A !== 0 && !a.unit.length ? b.dim : a.dim, unit, tempKind: a.tempKind ?? b.tempKind };
}

export function sub(a: Quantity, b: Quantity): Quantity {
  requireSameDim(a, b, 'subtract');
  if (a.tempKind === 'absolute' && b.tempKind === 'absolute') {
    // abs − abs → difference, shown in the delta form of the first unit
    return { si: N.sub(a.si, b.si), dim: a.dim, unit: deltaOf(a.unit), tempKind: 'delta' };
  }
  if (b.tempKind === 'absolute') throw new CalcError("Can't subtract a temperature from a temperature difference");
  return add(a, neg(b));
}

export function neg(a: Quantity): Quantity {
  if (a.tempKind === 'absolute') {
    // −(20 °C): negate the displayed value, keep it absolute
    const v = N.neg(displayValue(a));
    return fromUnit(v, a.unit);
  }
  return { ...a, si: N.neg(a.si) };
}

/** %, ‰, ppm, µε are how a ratio is shown; in a product the value is already in the number (D31). */
const noRatio = (u: UnitExpr) => u.filter((t) => getUnit(t.id).category !== 'Ratio');

export function mul(a: Quantity, b: Quantity): Quantity {
  if (a.tempKind === 'absolute' || b.tempKind === 'absolute') throw new CalcError(ABS_TEMP_MSG('multiply'));
  return finishProduct(N.mul(a.si, b.si), dimMul(a.dim, b.dim), noRatio(a.unit).concat(noRatio(b.unit)));
}

export function div(a: Quantity, b: Quantity): Quantity {
  if (a.tempKind === 'absolute' || b.tempKind === 'absolute') throw new CalcError(ABS_TEMP_MSG('divide'));
  return finishProduct(
    N.div(a.si, b.si),
    dimDiv(a.dim, b.dim),
    noRatio(a.unit).concat(noRatio(b.unit).map((t) => ({ id: t.id, power: -t.power }))),
  );
}

function finishProduct(si: Num, d: Dim, unit: UnitExpr): Quantity {
  const s = simplify(unit, d);
  return { si, dim: s.dim, unit: s.unit };
}

export function pow(a: Quantity, e: Quantity): Quantity {
  if (!isDimlessLoose(e.dim)) throw new CalcError(`A power must be a plain number, not ${describe(e)}`);
  if (a.tempKind === 'absolute') throw new CalcError(ABS_TEMP_MSG('raise'));
  if (dimEq(a.dim, DIMLESS)) return scalar(N.pow(a.si, e.si));
  const p = N.toNumber(e.si);
  const fr = N.toFraction(p);
  if (!fr) throw new CalcError('A value with units can only be raised to a simple fractional power, like 2 or 1/2');
  const si = N.powRational(a.si, fr[0], fr[1]);
  return finishProduct(si, dimPow(a.dim, p), a.unit.map((t) => ({ id: t.id, power: t.power * p })));
}

export function root(a: Quantity, n: number): Quantity {
  return pow(a, scalar(N.exact(1n, BigInt(n))));
}

export function cmp(a: Quantity, b: Quantity): number {
  requireSameDim(a, b, 'compare');
  return N.cmp(a.si, b.si);
}

/** Apply a magnitude-only function preserving units (abs, floor in display unit, …). */
export function mapDisplay(a: Quantity, fn: (v: Num) => Num): Quantity {
  return fromUnitKeep(fn(displayValue(a)), a);
}
function fromUnitKeep(v: Num, like: Quantity): Quantity {
  if (like.tempKind === 'absolute') return fromUnit(v, like.unit);
  return { si: N.mul(v, unitFactor(like.unit)), dim: like.dim, unit: like.unit, tempKind: like.tempKind };
}

export function withUnitNormalized(q: Quantity): Quantity {
  return { ...q, unit: combine(q.unit) };
}

export function isScalar(q: Quantity) {
  return isDimlessLoose(q.dim) && q.dim.A === 0;
}
