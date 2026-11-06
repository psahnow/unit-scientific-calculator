// Unit dropdown candidates (DESIGN.md §6).
import { isUnitOn } from './packages';
import { dimEq, isDimless } from '../dim';
import { type Quantity, checkConvertible, convertTo, displayValue } from '../quantity';
import { type UnitExpr, expandedUnits, parseUnitExpr, formatUnit, unitExprEq, getUnit } from './registry';
import { toNumber } from '../num';

/** Registered compound units offered in dropdowns beyond single catalogue units. */
export const COMPOUNDS = [
  'N/mm^2', 'N/m^2', 'kN/m^2', 'kgf/cm^2', 'lbf/in^2', 'lbf/ft^2', 'kip/in^2',
  'N*m', 'kN*m', 'N*mm', 'lbf*ft', 'lbf*in', 'kip*ft', 'kip*in',
  'J/(kg*K)', 'kJ/(kg*K)', 'BTU/(lbm*°R)', 'W/(m*K)', 'BTU/(h*ft*°R)', 'W/(m^2*K)', 'BTU/(h*ft^2*°R)',
  'm/s', 'km/h', 'ft/s', 'ft/min', 'in/s', 'm/s^2', 'ft/s^2', 'in/s^2',
  'kg/m^3', 'g/cm^3', 'lbm/ft^3', 'lbm/in^3', 'slug/ft^3',
  'm^3/s', 'L/s', 'L/min', 'm^3/h', 'ft^3/s',
  'Pa*s', 'mPa*s', 'lbf*s/ft^2', 'm^2/s', 'ft^2/s',
  'kg/s', 'lbm/s', 'lbm/h', 'kg/h',
  'N/m', 'N/mm', 'kN/m', 'lbf/in', 'lbf/ft', 'kip/in',
  'm^2', 'cm^2', 'mm^2', 'km^2', 'in^2', 'ft^2', 'yd^2', 'mi^2',
  'm^3', 'cm^3', 'mm^3', 'in^3', 'ft^3', 'yd^3',
  'm^4', 'mm^4', 'cm^4', 'in^4', 'ft^4',
  'rad/s', 'rad/s^2', '°/s',
  'W/m^2', 'kW/m^2', 'BTU/(h*ft^2)', 'J/kg', 'kJ/kg', 'BTU/lbm', 'kWh/kg',
  'V/m', 'A/m^2', 'Ω*m', 'C/kg',
];

export interface Candidate {
  text: string; // formatted unit
  expr: UnitExpr;
  preview: string;
}
export interface CandidateGroup {
  label: string;
  items: Candidate[];
}

let compoundCache: UnitExpr[] | null = null;
function compounds(): UnitExpr[] {
  if (!compoundCache) {
    compoundCache = [];
    for (const c of COMPOUNDS) {
      try {
        compoundCache.push(parseUnitExpr(c));
      } catch {
        /* skip */
      }
    }
  }
  return compoundCache;
}

function system(e: UnitExpr): 'SI' | 'US' | 'Other' {
  const systems = e.map((t) => getUnit(t.id).system);
  if (systems.some((s) => s === 'US' || s === 'UK')) return 'US';
  if (systems.every((s) => s === 'SI' || s === 'SI-accepted')) return 'SI';
  return 'Other';
}

export function unitCandidates(
  q: Quantity,
  autoUnit: UnitExpr,
  fmt: (v: number) => string,
): CandidateGroup[] {
  const seen: UnitExpr[] = [];
  const mk = (e: UnitExpr): Candidate | null => {
    if (seen.some((s) => unitExprEq(s, e))) return null;
    if (checkConvertible(q, e)) return null;
    seen.push(e);
    const v = toNumber(displayValue(convertTo(q, e)));
    return { text: formatUnit(e) || '(none)', expr: e, preview: fmt(v) };
  };
  const suggested: Candidate[] = [];
  const push = (arr: Candidate[], e: UnitExpr) => {
    const c = mk(e);
    if (c) arr.push(c);
  };
  push(suggested, q.unit);
  push(suggested, autoUnit);

  // only units from the worksheet's enabled packages (D26); the current and automatic units always show
  const on = (e: UnitExpr) => e.every((t) => isUnitOn(getUnit(t.id)));
  // data sizes (bit, MB) are dimensionless too, but only make sense for values already in data units
  const isData = q.unit.some((t) => getUnit(t.id).category === 'Data');
  const singles = expandedUnits().filter(
    (u) => isUnitOn(u) && dimEq(u.dim, q.dim) && (u.category !== 'Ratio' || isDimless(q.dim)) && (u.category !== 'Data' || isData),
  );
  const pool: UnitExpr[] = [...singles.map((u) => [{ id: u.id, power: 1 }]), ...compounds().filter((c) => on(c) && !checkConvertible(q, c))];

  // nicest SI choices: value in [1, 1000)
  const niceSI = pool
    .filter((e) => system(e) === 'SI' && !checkConvertible(q, e))
    .map((e) => ({ e, v: Math.abs(toNumber(displayValue(convertTo(q, e)))) }))
    .filter((x) => x.v >= 1 && x.v < 1000)
    .slice(0, 2);
  for (const x of niceSI) push(suggested, x.e);

  const si: Candidate[] = [];
  const us: Candidate[] = [];
  const other: Candidate[] = [];
  for (const e of pool) {
    const s = system(e);
    push(s === 'SI' ? si : s === 'US' ? us : other, e);
  }
  if (isDimless(q.dim)) push(suggested, []);
  const groups: CandidateGroup[] = [
    { label: 'Suggested', items: suggested },
    { label: 'SI', items: si },
    { label: 'US customary / Imperial', items: us },
    { label: 'Other', items: other },
  ];
  return groups.filter((g) => g.items.length);
}
