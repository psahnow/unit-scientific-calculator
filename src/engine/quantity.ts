// Quantity: hidden SI magnitude + dimension + display unit expression (DESIGN.md §5).
import * as N from './num';
import { type Num } from './num';
import { type Dim, DIMLESS, dimMul, dimDiv, dimPow, dimEq, isDimlessLoose, dimName } from './dim';
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

export function describe(q: { dim: Dim; unit: UnitExpr }): string {
  const u = formatUnit(q.unit);
  return u ? `${dimName(q.dim)} (${u})` : dimName(q.dim);
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

/** Check a target unit is a valid display unit for q. Returns an error message or null. */
export function checkConvertible(q: Quantity, unit: UnitExpr): string | null {
  const ud = unitDim(unit);
  if (!dimEq(ud, q.dim)) return `Can't show ${dimName(q.dim)} in ${formatUnit(unit)} (${dimName(ud)})`;
  const single = unit.length === 1 && unit[0].power === 1 ? getUnit(unit[0].id) : undefined;
  if (q.tempKind === 'absolute' && single?.tempKind === 'delta')
    return 'An absolute temperature needs an absolute unit (K, °C, °F, °R)';
  if (q.tempKind !== 'absolute' && single?.tempKind === 'absolute' && dimEq(q.dim, single.dim))
    return 'A temperature difference needs a difference unit (K, Δ°C, Δ°F, °R)';
  return null;
}

export function convertTo(q: Quantity, unit: UnitExpr): Quantity {
  const err = checkConvertible(q, unit);
  if (err) throw new CalcError(err);
  return { ...q, unit };
}

const ABS_TEMP_MSG = (op: string) =>
  `Can't ${op} an absolute temperature (°C/°F); use K or a temperature difference (Δ°C)`;

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
    throw new CalcError("Can't add two absolute temperatures; did you mean a temperature difference (Δ°C)?");
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
  if (b.tempKind === 'absolute') throw new CalcError("Can't subtract an absolute temperature from a difference");
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

export function mul(a: Quantity, b: Quantity): Quantity {
  if (a.tempKind === 'absolute' || b.tempKind === 'absolute') throw new CalcError(ABS_TEMP_MSG('multiply'));
  return finishProduct(N.mul(a.si, b.si), dimMul(a.dim, b.dim), a.unit.concat(b.unit));
}

export function div(a: Quantity, b: Quantity): Quantity {
  if (a.tempKind === 'absolute' || b.tempKind === 'absolute') throw new CalcError(ABS_TEMP_MSG('divide'));
  return finishProduct(
    N.div(a.si, b.si),
    dimDiv(a.dim, b.dim),
    a.unit.concat(b.unit.map((t) => ({ id: t.id, power: -t.power }))),
  );
}

function finishProduct(si: Num, d: Dim, unit: UnitExpr): Quantity {
  const s = simplify(unit, d);
  return { si, dim: s.dim, unit: s.unit };
}

export function pow(a: Quantity, e: Quantity): Quantity {
  if (!isDimlessLoose(e.dim)) throw new CalcError(`Exponent must be dimensionless; got ${describe(e)}`);
  if (a.tempKind === 'absolute') throw new CalcError(ABS_TEMP_MSG('raise'));
  if (dimEq(a.dim, DIMLESS)) return scalar(N.pow(a.si, e.si));
  const p = N.toNumber(e.si);
  const fr = N.toFraction(p);
  if (!fr) throw new CalcError('A quantity with units can only be raised to a rational power');
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
