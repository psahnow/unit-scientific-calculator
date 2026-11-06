// Smart simplify (DESIGN.md §5.4). Only the display unit changes; the SI magnitude never does.
import { type Dim, dimEq, isDimless, dropAngle, dim } from './dim';
import { type UnitExpr, getUnit, combine, unitDim, unitFactor, lookupUnit } from './units/registry';
import { UNITS, SI_PREFIXES, type UnitDef } from './units/units.data';
import { isExact, cmp } from './num';

const COLLAPSE_TARGETS = UNITS.filter((u) => u.coherentNamed);

function isCoherent(id: string) {
  const u = getUnit(id);
  return (u.base || u.coherentNamed) && isExact(u.factor) && u.factor.n === 1n && u.factor.d === 1n;
}

/** A named coherent unit or a prefixed one (MPa, kN, mJ). */
function isNamed(id: string) {
  const u = getUnit(id);
  return !!u.coherentNamed || COLLAPSE_TARGETS.some((t) => t.id !== id && id.endsWith(t.id) && dimEq(t.dim, u.dim));
}

const FORCE_OR_POWER = COLLAPSE_TARGETS.filter((u) => u.id === 'N' || u.id === 'W');

function keepAsWritten(e: UnitExpr, target: UnitDef) {
  if (target.id === 'Pa') return true;
  if (target.id === 'J') return e.some((t) => FORCE_OR_POWER.some((f) => dimEq(f.dim, getUnit(t.id).dim)));
  // already a single named unit of that dimension in the product (e.g. kept from the input)
  return false;
}

/** The target unit, prefixed so the value is unchanged (kPa·m² → kN); undefined if no prefix fits. */
function prefixedFor(target: UnitDef, e: UnitExpr): string | undefined {
  const f = unitFactor(e);
  if (!isExact(f)) return undefined;
  if (cmp(f, target.factor) === 0) return target.id;
  for (const [p] of SI_PREFIXES) {
    const u = lookupUnit(p + target.id);
    if (u && dimEq(u.dim, target.dim) && cmp(u.factor, f) === 0) return u.id;
  }
  return undefined;
}

export interface Simplified {
  unit: UnitExpr;
  dim: Dim;
}

export function simplify(input: UnitExpr, d: Dim): Simplified {
  // Ratio units (%, ‰, ppm, µε) drop out of products: their value is already in the magnitude.
  let e = input.filter((t) => getUnit(t.id).category !== 'Ratio' || input.length === 1);

  // 1. Cancel identical units.
  e = combine(e);

  // 2. Merge same-dimension units into the first one's unit (D16): mm·m → mm².
  //    Dimensionless units (bit, B) are left alone.
  const merged: UnitExpr = [];
  for (const t of e) {
    const td = getUnit(t.id).dim;
    const target = isDimless(td) ? undefined : merged.find((m) => dimEq(getUnit(m.id).dim, td));
    if (target) target.power = Math.round((target.power + t.power) * 1e9) / 1e9;
    else merged.push({ ...t });
  }
  e = merged.filter((t) => Math.abs(t.power) > 1e-12);

  // 3/4. Collapse messy coherent forms (≥2 base-unit factors) into a named unit: kg·m/s² → N.
  //      Products of named units the user typed (N·m, N/mm²) are kept.
  const baseCount = e.filter((t) => getUnit(t.id).base).length;
  if (e.length >= 2 && baseCount >= 2 && e.every((t) => isCoherent(t.id))) {
    const target = COLLAPSE_TARGETS.find((u) => dimEq(u.dim, d));
    if (target) e = [{ id: target.id, power: 1 }];
  }

  // 4b. A named unit combined so the result is a *different* named unit collapses to it:
  //     MPa·mm² → N, V·A → W, Pa·m³ → J, J/s → W. Conventional compound forms stay as written:
  //     stresses (N/mm², D16) and torque/energy built from force·length or power·time (N·m, kW·h; D13).
  if (e.length >= 2 && e.some((t) => isNamed(t.id))) {
    const target = COLLAPSE_TARGETS.find((u) => dimEq(u.dim, d));
    if (target && !keepAsWritten(e, target)) {
      const id = prefixedFor(target, e);
      if (id) e = [{ id, power: 1 }];
    }
  }

  // 4c. 1/ms, 1/s → kHz, Hz (D31). Only exactly time⁻¹ (rad/s and rpm keep their angle).
  if (e.length === 1 && e[0].power === -1 && dimEq(getUnit(e[0].id).dim, dim({ T: 1 })) && dimEq(d, dim({ T: -1 }))) {
    const hz = prefixedFor(getUnit('Hz'), e);
    if (hz) e = [{ id: hz, power: 1 }];
  }

  // 6. Angles: arc length & tangential velocity drop the radian (rad·m → m, rad·m/s → m/s).
  let outDim = d;
  const hasLength = e.some((t) => getUnit(t.id).dim.L !== 0 && t.power > 0 && getUnit(t.id).dim.A === 0);
  const angleTerms = e.filter((t) => getUnit(t.id).dim.A !== 0);
  if (hasLength && angleTerms.length && d.A > 0) {
    e = e.filter((t) => getUnit(t.id).dim.A === 0);
    outDim = dropAngle(d);
  }

  // Safety: the unit must describe the dimension (fallback to raw combine).
  if (!dimEq(unitDim(e), outDim)) return { unit: combine(input), dim: d };
  return { unit: e, dim: outDim };
}
