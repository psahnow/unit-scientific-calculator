// Smart simplify (DESIGN.md §5.4). Only the display unit changes; the SI magnitude never does.
import { type Dim, dimEq, isDimless, dropAngle } from './dim';
import { type UnitExpr, getUnit, combine, unitDim } from './units/registry';
import { UNITS } from './units/units.data';
import { isExact } from './num';

const COLLAPSE_TARGETS = UNITS.filter((u) => u.coherentNamed);

function isCoherent(id: string) {
  const u = getUnit(id);
  return (u.base || u.coherentNamed) && isExact(u.factor) && u.factor.n === 1n && u.factor.d === 1n;
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
